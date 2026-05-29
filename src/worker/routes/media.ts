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
  updateMedia,
} from "../db/media-repository";
import { aniListToMediaRow } from "../sources/anilist-mapper";
import { bangumiToMediaRow } from "../sources/bangumi-mapper";
import { tmdbToMediaRow } from "../sources/tmdb-mapper";
import type { AniListMedia } from "../sources/anilist";
import type { BangumiSubject } from "../sources/bangumi";
import { getTmdbDetail, type TmdbDetail } from "../sources/tmdb";
import { parseCreateMediaRequest, type TmdbAddRef } from "../api/validation";
import { parseListQuery } from "../api/list-query";
import {
  applyAutoComplete,
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
  // prefixed ("movie:603"); the other sources use the bare id.
  const externalId =
    external_source === "tmdb"
      ? `${(media as TmdbAddRef).media_type}:${(media as TmdbAddRef).id}`
      : String(media.id);

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
  if (external_source === "tmdb") {
    if (!c.env.TMDB_API_KEY) {
      return c.json({ error: "TMDB integration is not configured" }, 503);
    }
    try {
      const ref = media as TmdbAddRef;
      tmdbDetail = await getTmdbDetail(ref.id, ref.media_type, {
        apiKey: c.env.TMDB_API_KEY,
      });
    } catch {
      return c.json({ error: "TMDB request failed" }, 502);
    }
    if (tmdbDetail === null) {
      return c.json({ error: "media not found on TMDB" }, 404);
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

  // Two complementary conveniences: reaching the total auto-completes, and
  // marking completed fills the count up to the total.
  const finalPatch = applyCompletionFill(
    existing,
    applyAutoComplete(existing, parsed.value),
  );
  const updated = await updateMedia(c.env.DB, id, finalPatch);
  if (updated === null) {
    // Row vanished between read and write (single-user app: effectively never).
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
