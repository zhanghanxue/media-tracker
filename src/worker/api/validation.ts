// Request validation for POST /api/media. Pure function — no I/O — so it's
// TDD'd in isolation (see validation.test.ts). The handler calls
// `parseCreateMediaRequest(await c.req.json())` and branches on `.ok`.
//
// Runtime enum arrays live here (schema.ts is types-only). Each is pinned to
// its schema type with `satisfies readonly <T>[]`, so adding a value to the
// type without adding it here — or vice versa — is a compile error.

import type {
  ExternalSource,
  MediaStatus,
  MediaType,
} from "../db/schema";
import type { AniListMedia } from "../sources/anilist";

export const EXTERNAL_SOURCES = [
  "anilist",
  "tmdb",
  "igdb",
  "bangumi",
] as const satisfies readonly ExternalSource[];

export const MEDIA_TYPES = [
  "animation",
  "manga",
  "light_novel",
  "drama",
  "movie",
  "game",
] as const satisfies readonly MediaType[];

export const MEDIA_STATUSES = [
  "planned",
  "in_progress",
  "completed",
  "dropped",
  "paused",
] as const satisfies readonly MediaStatus[];

// The browser fetches the AniList media object (search/detail share the same
// field set) and POSTs it here for the Worker to map + persist — the Worker
// can't call AniList itself (egress IPs are blocked). `media` is that object;
// the server is authoritative for the mapping (aniListToMediaRow).
export interface CreateMediaRequest {
  external_source: ExternalSource;
  status: MediaStatus;
  media: AniListMedia;
}

export type ValidationResult =
  | { ok: true; value: CreateMediaRequest }
  | { ok: false; errors: string[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCreateMediaRequest(body: unknown): ValidationResult {
  if (!isObject(body)) {
    return { ok: false, errors: ["request body must be a JSON object"] };
  }

  const errors: string[] = [];

  const source = body.external_source;
  if (!EXTERNAL_SOURCES.includes(source as ExternalSource)) {
    errors.push(
      `external_source must be one of: ${EXTERNAL_SOURCES.join(", ")}`,
    );
  }

  const status = body.status;
  if (!MEDIA_STATUSES.includes(status as MediaStatus)) {
    errors.push(`status must be one of: ${MEDIA_STATUSES.join(", ")}`);
  }

  // Minimal shape check on the source payload; aniListToMediaRow does the rest
  // (and throws on an unclassifiable format, which the route turns into a 400).
  const media = body.media;
  if (!isObject(media)) {
    errors.push("media must be an object");
  } else {
    if (
      typeof media.id !== "number" ||
      !Number.isInteger(media.id) ||
      media.id <= 0
    ) {
      errors.push("media.id must be a positive integer");
    }
    if (!isObject(media.title)) errors.push("media.title must be an object");
    if (!isObject(media.coverImage)) {
      errors.push("media.coverImage must be an object");
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      external_source: source as ExternalSource,
      status: status as MediaStatus,
      media: media as unknown as AniListMedia,
    },
  };
}
