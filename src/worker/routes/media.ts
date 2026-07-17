// POST /api/media — add a media item from a source API.
//
// AniList/Bangumi: the BROWSER does the source call (AniList blocks Cloudflare
// Worker egress IPs but allows CORS; Bangumi we keep browser-side too) and POSTs
// the resulting media object, which the Worker maps authoritatively.
//
// TMDB: key-bearing, so the WORKER calls it — the browser POSTs only { id,
// media_type } and the Worker fetches full detail before mapping.
//
// In all cases the Worker re-hosts the cover to R2 (best-effort) and inserts.
//
//   1. validate body { external_source, status, media } → 400
//   2. conflict probe (source, externalId)               → 409 + existing row
//   3. [tmdb/igdb only] fetch detail (503 unconfigured / 502 upstream / 404 missing)
//   4. map (400 if unclassifiable) → upload cover → insert → 201
//
// External boundaries the Worker makes: the cover CDN fetch (always), the TMDB
// detail fetch (tmdb adds), and the Twitch token + IGDB detail fetch (igdb adds);
// integration tests mock them via fetchMock. D1 and R2 are real bindings.

import { Hono } from "hono";

import type { AppEnv } from "../env";
import type { AuthVariables } from "../middleware/auth";
import {
  addVideoPart,
  bulkDeleteMedia,
  bulkUpdateMedia,
  deleteMedia,
  deleteVideoPart,
  updateVideoPart,
  ensureCollection,
  findByExternalRef,
  findById,
  getCollection,
  insertMedia,
  listMedia,
  listVideoParts,
  selectGenresColumn,
  selectRegionsColumn,
  selectMatchingCollectionIds,
  setCoverUrl,
  setTotalEpisodes,
  updateMedia,
} from "../db/media-repository";
import { tallyGenres, tallyRegions } from "../api/facets";
import { aniListToMediaRow } from "../sources/anilist-mapper";
import { bangumiToMediaRow } from "../sources/bangumi-mapper";
import { tmdbToMediaRow, tmdbSeasonToMediaRow } from "../sources/tmdb-mapper";
import { igdbToMediaRow } from "../sources/igdb-mapper";
import type { AniListMedia } from "../sources/anilist";
import type { BangumiSubject } from "../sources/bangumi";
import {
  getTmdbDetail,
  getTmdbSeason,
  type TmdbDetail,
  type TmdbSeasonDetail,
  type TmdbSeasonSummary,
} from "../sources/tmdb";
import { getIgdbDetail, type IgdbGame } from "../sources/igdb";
import {
  parseCreateMediaRequest,
  type IgdbAddRef,
  type TmdbAddRef,
} from "../api/validation";
import { parseListQuery } from "../api/list-query";
import {
  applyAutoComplete,
  applyAutoStart,
  applyCompletionFill,
  applyCompletionFillOnCreate,
  applyPlannedReset,
  parsePatchMediaRequest,
} from "../api/patch-media";
import { uploadCoverToR2 } from "../storage/covers";

export const mediaRoutes = new Hono<{
  Bindings: AppEnv;
  Variables: AuthVariables;
}>();

mediaRoutes.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "request body must be valid JSON" }, 400);
  }

  const parsed = parseCreateMediaRequest(body);
  if (!parsed.ok) {
    return c.json({ error: "validation failed", details: parsed.errors }, 400);
  }
  const { external_source, status, media } = parsed.value;

  // The conflict key. TMDB movie ids and tv ids collide, so the key is kind-
  // prefixed ("movie:603"); a season add keys per season ("tv:1399:s2"); the
  // other sources (AniList, Bangumi, IGDB) use the bare id.
  let externalId: string;
  if (external_source === "tmdb") {
    const ref = media as TmdbAddRef;
    externalId =
      ref.season_number !== undefined
        ? `tv:${ref.id}:s${ref.season_number}`
        : `${ref.media_type}:${ref.id}`;
  } else {
    externalId = String(media.id);
  }

  // Conflict probe: don't duplicate an item we already track. For TMDB this runs
  // BEFORE the (slower, key-bearing) detail fetch — a re-add costs no TMDB call.
  const existing = await findByExternalRef(c.env.DB, external_source, externalId);
  if (existing !== null) {
    return c.json(existing, 409);
  }

  // TMDB is Worker-side: fetch full detail here (the browser only sent id+kind).
  // Kept outside the mapping try/catch so an upstream failure surfaces as 502/503
  // rather than a misleading "couldn't classify" 400.
  let tmdbDetail: TmdbDetail | null = null;
  let tmdbSeason: TmdbSeasonDetail | null = null;
  let tmdbSeasonSummary: TmdbSeasonSummary | undefined;
  if (external_source === "tmdb") {
    if (!c.env.TMDB_API_KEY) {
      return c.json({ error: "TMDB integration is not configured" }, 503);
    }
    const ref = media as TmdbAddRef;
    try {
      tmdbDetail = await getTmdbDetail(ref.id, ref.media_type, {
        apiKey: c.env.TMDB_API_KEY,
        images: true, // need posters across languages to pick the origin cover
      });
      if (tmdbDetail !== null && ref.season_number !== undefined) {
        tmdbSeason = await getTmdbSeason(ref.id, ref.season_number, {
          apiKey: c.env.TMDB_API_KEY,
          images: true,
        });
      }
    } catch {
      return c.json({ error: "TMDB request failed" }, 502);
    }
    if (tmdbDetail === null) {
      return c.json({ error: "media not found on TMDB" }, 404);
    }
    if (ref.season_number !== undefined) {
      tmdbSeasonSummary = tmdbDetail.seasons?.find(
        (s) => s.season_number === ref.season_number,
      );
      if (!tmdbSeasonSummary) {
        return c.json({ error: "no such season on TMDB" }, 404);
      }
    }
  }

  // IGDB is also Worker-side (Twitch-OAuth-bearing): fetch full detail here from
  // the id the browser sent. Same failure-mapping shape as TMDB.
  let igdbGame: IgdbGame | null = null;
  if (external_source === "igdb") {
    const clientId = c.env.TWITCH_CLIENT_ID;
    const clientSecret = c.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return c.json({ error: "IGDB integration is not configured" }, 503);
    }
    const ref = media as IgdbAddRef;
    try {
      igdbGame = await getIgdbDetail(ref.id, { clientId, clientSecret });
    } catch {
      return c.json({ error: "IGDB request failed" }, 502);
    }
    if (igdbGame === null) {
      return c.json({ error: "game not found on IGDB" }, 404);
    }
  }

  let row;
  try {
    // Validation guarantees `media` matches `external_source`'s shape.
    if (external_source === "anilist") {
      row = aniListToMediaRow(media as AniListMedia, status);
    } else if (external_source === "bangumi") {
      row = bangumiToMediaRow(media as BangumiSubject, status);
    } else if (external_source === "igdb") {
      const ref = media as IgdbAddRef;
      row = igdbToMediaRow(igdbGame!, {
        status,
        consumptionMode: ref.consumption_mode,
        platform: ref.platform,
        titleChinese: ref.title_chinese ?? null,
      });
    } else if ((media as TmdbAddRef).season_number !== undefined) {
      row = tmdbSeasonToMediaRow(
        tmdbDetail!,
        tmdbSeasonSummary!,
        tmdbSeason,
        status,
      );
    } else {
      row = tmdbToMediaRow(tmdbDetail!, (media as TmdbAddRef).media_type, status);
    }
  } catch {
    // Mappers throw on an item they can't classify (unknown AniList format /
    // unsupported Bangumi subject type).
    return c.json(
      { error: "could not classify this media (unknown type/format)" },
      400,
    );
  }

  // Adding something already finished → seed progress to its total (mirrors the
  // PATCH-time auto-fill, so a "completed" add doesn't need a manual progress fix).
  row = applyCompletionFillOnCreate(row);

  // Re-host the cover to R2. On any upstream failure uploadCoverToR2 returns
  // the original URL (graceful degradation), so the row always has a usable
  // cover_url. Skip entirely when AniList gave us no cover.
  if (row.cover_url) {
    row.cover_url = await uploadCoverToR2(c.env, row.cover_url, {
      externalSource: external_source,
      externalId,
    });
  }

  // A mapper-assigned collection_id (TMDB whole-show seasons → "tmdb:tv:<id>")
  // must point at a real collection row before the FK is set. Idempotent across
  // the show's seasons; name stays null so the client auto-derives it.
  if (row.collection_id) {
    await ensureCollection(c.env.DB, row.collection_id);
  }

  const inserted = await insertMedia(c.env.DB, row);
  return c.json(inserted, 201);
});

// GET /api/media — list with filters, search, sort, pagination.
// Returns { items, total } where total ignores limit/offset.
mediaRoutes.get("/", async (c) => {
  const parsed = parseListQuery({
    id: c.req.queries("id"),
    type: c.req.queries("type"),
    region: c.req.queries("region"),
    status: c.req.queries("status"),
    genre: c.req.queries("genre"),
    q: c.req.query("q"),
    collection: c.req.query("collection"),
    sort: c.req.query("sort"),
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  if (!parsed.ok) {
    return c.json({ error: "invalid query", details: parsed.errors }, 400);
  }

  const page = await listMedia(c.env.DB, parsed.value);
  return c.json(page);
});

// GET /api/media/facets — the distinct genres AND regions present in the
// library, optionally scoped to one or more media types
// (?type=game&type=animation). Powers the dynamic filter options: pick a type,
// see only that type's genres, plus any free-text "Other…" regions its rows
// carry. Computed server-side because the client only loads a slice and
// couldn't see them all.
mediaRoutes.get("/facets", async (c) => {
  const types = (c.req.queries("type") ?? [])
    .map((t) => t.trim())
    .filter(Boolean);
  const [genreRows, regionRows] = await Promise.all([
    selectGenresColumn(c.env.DB, types),
    selectRegionsColumn(c.env.DB, types),
  ]);
  return c.json({
    genres: tallyGenres(genreRows),
    regions: tallyRegions(regionRows),
  });
});

// GET /api/media/matching-collections — DISTINCT collection ids whose direct
// items match the filters/search. Powers the drill-down's "which collection
// cards to show" under an active filter, without shipping the matching items.
// Registered before "/:id" so "matching-collections" isn't captured as an id.
mediaRoutes.get("/matching-collections", async (c) => {
  const parsed = parseListQuery({
    type: c.req.queries("type"),
    region: c.req.queries("region"),
    status: c.req.queries("status"),
    genre: c.req.queries("genre"),
    q: c.req.query("q"),
  });
  if (!parsed.ok) {
    return c.json({ error: "invalid query", details: parsed.errors }, 400);
  }
  const collection_ids = await selectMatchingCollectionIds(c.env.DB, parsed.value);
  return c.json({ collection_ids });
});

// GET /api/media/:id — single record (used by the detail view later).
mediaRoutes.get("/:id", async (c) => {
  const idParam = c.req.param("id");
  if (!/^[1-9][0-9]*$/.test(idParam)) {
    return c.json({ error: "id must be a positive integer" }, 400);
  }

  const row = await findById(c.env.DB, Number(idParam));
  if (row === null) {
    return c.json({ error: `no media with id ${idParam}` }, 404);
  }
  return c.json(row);
});

// PATCH /api/media/:id — update mutable fields (status / progress / notes / …).
// Bumps date_updated; auto-completes when progress reaches total unless status
// is set explicitly. Returns the updated row.
// PATCH /api/media/bulk — apply ONE validated patch to many rows at once (the
// selection bulk action: add a set of items to a collection, set their status,
// etc.). Body: { ids: number[], patch: {...same fields as PATCH /:id...} }.
// Registered before /:id so "bulk" isn't captured as an id param.
mediaRoutes.patch("/bulk", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "request body must be valid JSON" }, 400);
  }
  const obj =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  const rawIds = obj.ids;
  if (
    !Array.isArray(rawIds) ||
    rawIds.length === 0 ||
    !rawIds.every((n) => typeof n === "number" && Number.isInteger(n) && n > 0)
  ) {
    return c.json({ error: "ids must be a non-empty array of positive integers" }, 400);
  }
  const ids = rawIds as number[];

  const parsed = parsePatchMediaRequest(obj.patch);
  if (!parsed.ok) {
    return c.json({ error: "validation failed", details: parsed.errors }, 400);
  }

  // Guard the FK: a non-null collection_id must reference a real collection
  // (else the bulk would orphan every selected item).
  if (typeof parsed.value.collection_id === "string") {
    if (!(await getCollection(c.env.DB, parsed.value.collection_id))) {
      return c.json({ error: `collection ${parsed.value.collection_id} not found` }, 400);
    }
  }

  const updated = await bulkUpdateMedia(c.env.DB, ids, parsed.value);
  return c.json({ updated }, 200);
});

mediaRoutes.patch("/:id", async (c) => {
  const idParam = c.req.param("id");
  if (!/^[1-9][0-9]*$/.test(idParam)) {
    return c.json({ error: "id must be a positive integer" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "request body must be valid JSON" }, 400);
  }

  const parsed = parsePatchMediaRequest(body);
  if (!parsed.ok) {
    return c.json({ error: "validation failed", details: parsed.errors }, 400);
  }

  const id = Number(idParam);
  const existing = await findById(c.env.DB, id);
  if (existing === null) {
    return c.json({ error: `no media with id ${idParam}` }, 404);
  }

  // Status conveniences (each a no-op unless its trigger status applies): reaching
  // the total auto-completes; first progress on a planned item starts it; marking
  // completed fills the count up to the total; and moving back to planned clears
  // the recorded progress. Order matters — complete is checked before start so
  // hitting the total in one go completes (not starts); fill/reset key off mutually
  // exclusive statuses (completed vs planned), so their order is immaterial.
  const finalPatch = applyPlannedReset(
    existing,
    applyCompletionFill(
      existing,
      applyAutoStart(existing, applyAutoComplete(existing, parsed.value)),
    ),
  );
  const updated = await updateMedia(c.env.DB, id, finalPatch);
  if (updated === null) {
    // Row vanished between read and write (single-user app: effectively never).
    return c.json({ error: `no media with id ${idParam}` }, 404);
  }
  return c.json(updated, 200);
});

// POST /api/media/:id/refresh-cover — re-pull the origin-language poster for a
// TMDB item and overwrite its cached R2 cover. The origin-poster selection
// (tmdb-mapper) only runs on NEW adds, so existing rows keep whatever cover they
// had when added; this brings them up to date on demand. TMDB-only: AniList /
// Bangumi expose a single cover with no language variants (and the Worker can't
// re-fetch AniList anyway — it's browser-direct), so there's nothing to refresh.
mediaRoutes.post("/:id/refresh-cover", async (c) => {
  const idParam = c.req.param("id");
  if (!/^[1-9][0-9]*$/.test(idParam)) {
    return c.json({ error: "id must be a positive integer" }, 400);
  }

  const id = Number(idParam);
  const existing = await findById(c.env.DB, id);
  if (existing === null) {
    return c.json({ error: `no media with id ${idParam}` }, 404);
  }
  if (existing.external_source !== "tmdb") {
    return c.json(
      { error: "cover refresh is only supported for TMDB items" },
      422,
    );
  }
  if (!c.env.TMDB_API_KEY) {
    return c.json({ error: "TMDB integration is not configured" }, 503);
  }

  // external_id is "movie:ID", "tv:ID" or "tv:ID:sN" (kind-prefixed; seasons
  // suffixed). Anything else is a malformed legacy row we can't refresh.
  const match = /^(movie|tv):(\d+)(?::s(\d+))?$/.exec(existing.external_id ?? "");
  if (!match) {
    return c.json({ error: "this item has no refreshable TMDB id" }, 422);
  }
  const kind = match[1] as "movie" | "tv";
  const tmdbId = Number(match[2]);
  const seasonNumber = match[3] !== undefined ? Number(match[3]) : undefined;

  // Re-fetch detail (+ season) with poster images, then re-run the SAME mapper
  // the add flow uses so the origin-language selection is identical — we only
  // care about its cover_url here.
  let newCoverUrl: string | null;
  try {
    const detail = await getTmdbDetail(tmdbId, kind, {
      apiKey: c.env.TMDB_API_KEY,
      images: true,
    });
    if (detail === null) {
      return c.json({ error: "media not found on TMDB" }, 404);
    }
    if (seasonNumber !== undefined) {
      const summary = detail.seasons?.find(
        (s) => s.season_number === seasonNumber,
      );
      if (!summary) {
        return c.json({ error: "no such season on TMDB" }, 404);
      }
      const season = await getTmdbSeason(tmdbId, seasonNumber, {
        apiKey: c.env.TMDB_API_KEY,
        images: true,
      });
      newCoverUrl = tmdbSeasonToMediaRow(
        detail,
        summary,
        season,
        existing.status,
      ).cover_url;
    } else {
      newCoverUrl = tmdbToMediaRow(detail, kind, existing.status).cover_url;
    }
  } catch {
    return c.json({ error: "TMDB request failed" }, 502);
  }

  if (!newCoverUrl) {
    return c.json({ error: "TMDB has no poster for this item" }, 422);
  }

  // Overwrite the R2 object (same key), then cache-bust the stored URL with a
  // version query so the browser/CDN fetch the new bytes instead of the cached
  // ones (overwriting R2 alone doesn't change the URL).
  const rehosted = await uploadCoverToR2(
    c.env,
    newCoverUrl,
    { externalSource: "tmdb", externalId: existing.external_id! },
    { overwrite: true },
  );
  const busted = `${rehosted}${rehosted.includes("?") ? "&" : "?"}v=${Date.now()}`;

  const updated = await setCoverUrl(c.env.DB, id, busted);
  if (updated === null) {
    return c.json({ error: `no media with id ${idParam}` }, 404);
  }
  return c.json(updated, 200);
});

// POST /api/media/:id/refresh-episodes — update an ongoing item's total_episodes
// to its newest count. Two paths by source, because the Worker can't call every
// API itself:
//   • body { total_episodes } present → the browser already computed it (AniList
//     is browser-direct; the client sends nextAiringEpisode-1 / episodes).
//   • no body → the row must be TMDB (Worker holds the key): fetch detail/season
//     and read number_of_episodes / the season's episode_count.
// Never bumps date_updated (a bulk refresh shouldn't reorder the list).
mediaRoutes.post("/:id/refresh-episodes", async (c) => {
  const idParam = c.req.param("id");
  if (!/^[1-9][0-9]*$/.test(idParam)) {
    return c.json({ error: "id must be a positive integer" }, 400);
  }
  const id = Number(idParam);
  const existing = await findById(c.env.DB, id);
  if (existing === null) {
    return c.json({ error: `no media with id ${idParam}` }, 404);
  }

  // Optional body { total_episodes } — the browser-computed count (AniList).
  let bodyTotal: number | undefined;
  try {
    const raw = await c.req.json();
    if (raw && typeof raw === "object" && "total_episodes" in raw) {
      const v = (raw as Record<string, unknown>).total_episodes;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        return c.json({ error: "total_episodes must be a non-negative integer" }, 400);
      }
      bodyTotal = v;
    }
  } catch {
    // No / invalid JSON body → fall through to the source-fetch path.
  }

  let total: number | null = bodyTotal ?? null;

  if (total === null) {
    // No browser-supplied count → only a TMDB row can be refreshed server-side.
    if (existing.external_source !== "tmdb") {
      return c.json(
        { error: "provide total_episodes, or use a TMDB item" },
        422,
      );
    }
    if (!c.env.TMDB_API_KEY) {
      return c.json({ error: "TMDB integration is not configured" }, 503);
    }
    const match = /^tv:(\d+)(?::s(\d+))?$/.exec(existing.external_id ?? "");
    if (!match) {
      // Movies (and odd ids) have no episode count to refresh.
      return c.json({ error: "this item has no refreshable episode count" }, 422);
    }
    const tmdbId = Number(match[1]);
    const seasonNumber = match[2] !== undefined ? Number(match[2]) : undefined;
    try {
      const detail = await getTmdbDetail(tmdbId, "tv", { apiKey: c.env.TMDB_API_KEY });
      if (detail === null) return c.json({ error: "media not found on TMDB" }, 404);
      if (seasonNumber !== undefined) {
        const summary = detail.seasons?.find((s) => s.season_number === seasonNumber);
        total = summary?.episode_count ?? null;
      } else {
        total = detail.number_of_episodes ?? null;
      }
    } catch {
      return c.json({ error: "TMDB request failed" }, 502);
    }
  }

  if (total === null) {
    return c.json({ error: "no episode count available" }, 422);
  }

  const updated = await setTotalEpisodes(c.env.DB, id, total);
  if (updated === null) {
    return c.json({ error: `no media with id ${idParam}` }, 404);
  }
  return c.json(updated, 200);
});

// --- Video parts (watching-mode URL lists) ---------------------------------
// GET    /api/media/:id/parts          → { parts: [...] } (ordered)
// POST   /api/media/:id/parts { url, title? } → 201 the new part
// DELETE /api/media/:id/parts/:partId   → 204

mediaRoutes.get("/:id/parts", async (c) => {
  const idParam = c.req.param("id");
  if (!/^[1-9][0-9]*$/.test(idParam)) {
    return c.json({ error: "id must be a positive integer" }, 400);
  }
  const parts = await listVideoParts(c.env.DB, Number(idParam));
  return c.json({ parts });
});

mediaRoutes.post("/:id/parts", async (c) => {
  const idParam = c.req.param("id");
  if (!/^[1-9][0-9]*$/.test(idParam)) {
    return c.json({ error: "id must be a positive integer" }, 400);
  }
  const id = Number(idParam);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "request body must be valid JSON" }, 400);
  }
  const obj =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const url = typeof obj.url === "string" ? obj.url.trim() : "";
  if (url === "") {
    return c.json({ error: "url must be a non-empty string" }, 400);
  }
  const title =
    typeof obj.title === "string" && obj.title.trim() !== ""
      ? obj.title.trim()
      : null;

  // Parent must exist (FK would reject anyway, but a clean 404 is friendlier).
  if ((await findById(c.env.DB, id)) === null) {
    return c.json({ error: `no media with id ${idParam}` }, 404);
  }

  const part = await addVideoPart(c.env.DB, id, url, title);
  return c.json(part, 201);
});

mediaRoutes.delete("/:id/parts/:partId", async (c) => {
  const idParam = c.req.param("id");
  const partParam = c.req.param("partId");
  if (!/^[1-9][0-9]*$/.test(idParam) || !/^[1-9][0-9]*$/.test(partParam)) {
    return c.json({ error: "ids must be positive integers" }, 400);
  }
  const removed = await deleteVideoPart(
    c.env.DB,
    Number(idParam),
    Number(partParam),
  );
  if (!removed) {
    return c.json({ error: "no such video part" }, 404);
  }
  return c.body(null, 204);
});

// PATCH /api/media/:id/parts/:partId { url, title? } — edit a part's link/label.
// Same validation as the POST add (non-empty url, optional title); part_number
// isn't editable here. 200 with the updated part, 404 if it doesn't exist.
mediaRoutes.patch("/:id/parts/:partId", async (c) => {
  const idParam = c.req.param("id");
  const partParam = c.req.param("partId");
  if (!/^[1-9][0-9]*$/.test(idParam) || !/^[1-9][0-9]*$/.test(partParam)) {
    return c.json({ error: "ids must be positive integers" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "request body must be valid JSON" }, 400);
  }
  const obj =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const url = typeof obj.url === "string" ? obj.url.trim() : "";
  if (url === "") {
    return c.json({ error: "url must be a non-empty string" }, 400);
  }
  const title =
    typeof obj.title === "string" && obj.title.trim() !== ""
      ? obj.title.trim()
      : null;

  const updated = await updateVideoPart(
    c.env.DB,
    Number(idParam),
    Number(partParam),
    url,
    title,
  );
  if (updated === null) {
    return c.json({ error: "no such video part" }, 404);
  }
  return c.json(updated, 200);
});

// DELETE /api/media/bulk — remove many rows at once (the selection bulk-delete
// action). Body: { ids: number[] }. Registered before /:id so "bulk" isn't
// captured as an id param. Returns { deleted } — the count actually removed.
mediaRoutes.delete("/bulk", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "request body must be valid JSON" }, 400);
  }
  const obj =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  const rawIds = obj.ids;
  if (
    !Array.isArray(rawIds) ||
    rawIds.length === 0 ||
    !rawIds.every((n) => typeof n === "number" && Number.isInteger(n) && n > 0)
  ) {
    return c.json({ error: "ids must be a non-empty array of positive integers" }, 400);
  }

  const deleted = await bulkDeleteMedia(c.env.DB, rawIds as number[]);
  return c.json({ deleted }, 200);
});

// DELETE /api/media/:id — remove an entry (e.g. added by mistake). 204 on
// success, 404 if there's no such row.
mediaRoutes.delete("/:id", async (c) => {
  const idParam = c.req.param("id");
  if (!/^[1-9][0-9]*$/.test(idParam)) {
    return c.json({ error: "id must be a positive integer" }, 400);
  }

  const deleted = await deleteMedia(c.env.DB, Number(idParam));
  if (!deleted) {
    return c.json({ error: `no media with id ${idParam}` }, 404);
  }
  return c.body(null, 204);
});
