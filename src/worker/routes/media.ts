// POST /api/media — add a media item the browser fetched from AniList.
//
// The browser does the AniList call (AniList blocks Cloudflare Worker egress
// IPs but allows CORS) and POSTs the resulting media object. The Worker maps it
// authoritatively, re-hosts the cover to R2 (best-effort), and inserts. It does
// NOT call AniList itself.
//
//   1. validate body { external_source, status, media } → 400
//   2. reject non-AniList sources                        → 501
//   3. conflict probe (source, media.id)                 → 409 + existing row
//   4. map (400 if unclassifiable) → upload cover → insert → 201
//
// The cover CDN fetch is the only external boundary the Worker still makes;
// the integration test mocks it with `fetchMock`. D1 and R2 are real bindings.

import { Hono } from "hono";

import type { AppEnv } from "../env";
import type { AuthVariables } from "../middleware/auth";
import {
  findByExternalRef,
  findById,
  insertMedia,
  listMedia,
  updateMedia,
} from "../db/media-repository";
import { aniListToMediaRow } from "../sources/anilist-mapper";
import { parseCreateMediaRequest } from "../api/validation";
import { parseListQuery } from "../api/list-query";
import {
  applyAutoComplete,
  applyCompletionFill,
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

  // v1 only implements AniList. Other valid sources are accepted by validation
  // but not yet wired — 501 distinguishes "known but unbuilt" from "bad input".
  if (external_source !== "anilist") {
    return c.json(
      { error: `source '${external_source}' is not implemented yet` },
      501,
    );
  }

  const externalId = String(media.id);

  // Conflict probe: don't duplicate an item we already track.
  const existing = await findByExternalRef(c.env.DB, external_source, externalId);
  if (existing !== null) {
    return c.json(existing, 409);
  }

  let row;
  try {
    row = aniListToMediaRow(media, status);
  } catch {
    // Mapper throws on a missing/unknown `format` it can't classify.
    return c.json(
      { error: "could not classify this media (missing or unknown format)" },
      400,
    );
  }

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
