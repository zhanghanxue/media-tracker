// POST /api/media — add a media item from an external source.
//
// Flow (AniList is the only wired source in v1):
//   1. validate body                         → 400 on bad input
//   2. reject non-AniList valid sources       → 501 (tmdb/igdb/bangumi land later)
//   3. reject AniList-incompatible types      → 400 (anilist has no drama/movie/game)
//   4. conflict probe (source, external_id)   → 409 + existing row
//   5. fetch detail from AniList              → 404 if the id doesn't exist
//   6. map → upload cover to R2 → insert      → 201 + inserted row
//
// External boundaries (AniList GraphQL, the cover CDN) are reached via the
// global fetch; the integration test mocks them with `fetchMock` from
// cloudflare:test. D1 and R2 are real bindings.

import { Hono } from "hono";

import type { AppEnv } from "../env";
import type { AuthVariables } from "../middleware/auth";
import type { MediaType } from "../db/schema";
import { findByExternalRef, insertMedia } from "../db/media-repository";
import { aniListToMediaRow } from "../sources/anilist-mapper";
import { getAniListDetail, type AniListMediaType } from "../sources/anilist";
import { parseCreateMediaRequest } from "../api/validation";
import { uploadCoverToR2 } from "../storage/covers";

// AniList only knows ANIME and MANGA. Our richer `type` taxonomy collapses to
// one of those for the detail fetch; the mapper later derives the *precise*
// stored type from AniList's `format` (e.g. NOVEL → light_novel). A type with
// no AniList equivalent (drama/movie/game) returns null → 400.
function anilistEndpointType(type: MediaType): AniListMediaType | null {
  if (type === "animation") return "ANIME";
  if (type === "manga" || type === "light_novel") return "MANGA";
  return null;
}

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
  const { external_source, external_id, type, status } = parsed.value;

  // v1 only implements AniList. Other valid sources are accepted by validation
  // but not yet wired — 501 distinguishes "known but unbuilt" from "bad input".
  if (external_source !== "anilist") {
    return c.json(
      { error: `source '${external_source}' is not implemented yet` },
      501,
    );
  }

  const endpointType = anilistEndpointType(type);
  if (endpointType === null) {
    return c.json(
      { error: `type '${type}' is not available from anilist` },
      400,
    );
  }

  // Conflict probe: don't duplicate an item we already track.
  const existing = await findByExternalRef(c.env.DB, external_source, external_id);
  if (existing !== null) {
    return c.json(existing, 409);
  }

  const detail = await getAniListDetail(Number(external_id), endpointType);
  if (detail === null) {
    return c.json(
      { error: `anilist has no ${endpointType} with id ${external_id}` },
      404,
    );
  }

  const row = aniListToMediaRow(detail, status);

  // Re-host the cover to R2. On any upstream failure uploadCoverToR2 returns
  // the original URL (graceful degradation), so the row always has a usable
  // cover_url. Skip entirely when AniList gave us no cover.
  if (row.cover_url) {
    row.cover_url = await uploadCoverToR2(c.env, row.cover_url, {
      externalSource: external_source,
      externalId: external_id,
    });
  }

  const inserted = await insertMedia(c.env.DB, row);
  return c.json(inserted, 201);
});
