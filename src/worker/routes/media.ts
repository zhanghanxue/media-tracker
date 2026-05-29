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
//   2. reject unimplemented sources (igdb)               → 501
//   3. conflict probe (source, externalId)               → 409 + existing row
//   4. [tmdb only] fetch detail (503 unconfigured / 502 upstream / 404 missing)
//   5. map (400 if unclassifiable) → upload cover → insert → 201
//
// External boundaries the Worker makes: the cover CDN fetch (always) and the
// TMDB detail fetch (tmdb adds only); integration tests mock both via fetchMock.
// D1 and R2 are real bindings.

import { Hono } from "hono";

import type { AppEnv } from "../env";
import type { AuthVariables } from "../middleware/auth";
import {
  deleteMedia,
  findByExternalRef,
  findById,
  insertMedia,
  listMedia,
  setCoverUrl,
  setTotalEpisodes,
  updateMedia,
} from "../db/media-repository";
import { aniListToMediaRow } from "../sources/anilist-mapper";
import { bangumiToMediaRow } from "../sources/bangumi-mapper";
import { tmdbToMediaRow, tmdbSeasonToMediaRow } from "../sources/tmdb-mapper";
import type { AniListMedia } from "../sources/anilist";
import type { BangumiSubject } from "../sources/bangumi";
import {
  getTmdbDetail,
  getTmdbSeason,
  type TmdbDetail,
  type TmdbSeasonDetail,
  type TmdbSeasonSummary,
} from "../sources/tmdb";
import { parseCreateMediaRequest, type TmdbAddRef } from "../api/validation";
import { parseListQuery } from "../api/list-query";
import {
  applyAutoComplete,
  applyAutoStart,
  applyCompletionFill,
  applyCompletionFillOnCreate,
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

  // v1.x implements AniList (EN/JP), Bangumi (Chinese donghua/manhua AniList
  // lacks) and TMDB (movies/drama). IGDB is accepted by validation but unwired —
  // 501 distinguishes "known but unbuilt" from "bad input".
  if (external_source === "igdb") {
    return c.json(
      { error: `source '${external_source}' is not implemented yet` },
      501,
    );
  }

  // The conflict key. TMDB movie ids and tv ids collide, so the key is kind-
  // prefixed ("movie:603"); a season add keys per season ("tv:1399:s2"); the
  // other sources use the bare id.
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

  let row;
  try {
    // Validation guarantees `media` matches `external_source`'s shape.
    row =
      external_source === "anilist"
        ? aniListToMediaRow(media as AniListMedia, status)
        : external_source === "bangumi"
          ? bangumiToMediaRow(media as BangumiSubject, status)
          : (media as TmdbAddRef).season_number !== undefined
            ? tmdbSeasonToMediaRow(
                tmdbDetail!,
                tmdbSeasonSummary!,
                tmdbSeason,
                status,
              )
            : tmdbToMediaRow(tmdbDetail!, (media as TmdbAddRef).media_type, status);
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

  const inserted = await insertMedia(c.env.DB, row);
  return c.json(inserted, 201);
});

// GET /api/media — list with filters, search, sort, pagination.
// Returns { items, total } where total ignores limit/offset.
mediaRoutes.get("/", async (c) => {
  const parsed = parseListQuery({
    type: c.req.queries("type"),
    region: c.req.queries("region"),
    status: c.req.queries("status"),
    q: c.req.query("q"),
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

  // Status conveniences (each a no-op when status was set explicitly): reaching
  // the total auto-completes; first progress on a planned item starts it; and
  // marking completed fills the count up to the total. Order matters — complete
  // is checked before start so hitting the total in one go completes (not starts).
  const finalPatch = applyCompletionFill(
    existing,
    applyAutoStart(existing, applyAutoComplete(existing, parsed.value)),
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
