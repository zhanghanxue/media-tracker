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

export interface CreateMediaRequest {
  external_source: ExternalSource;
  // Normalized to string — the `media.external_id` column is TEXT, and AniList
  // IDs arrive as numbers. We accept either and canonicalize to string.
  external_id: string;
  type: MediaType;
  status: MediaStatus;
}

export type ValidationResult =
  | { ok: true; value: CreateMediaRequest }
  | { ok: false; errors: string[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize `external_id` to a positive-integer string, or return null if it
 * isn't one. AniList IDs are positive integers; we accept a JSON number or a
 * numeric string and reject floats, zero, negatives, and junk.
 */
function normalizeExternalId(raw: unknown): string | null {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw <= 0) return null;
    return String(raw);
  }
  if (typeof raw === "string") {
    if (!/^[1-9][0-9]*$/.test(raw)) return null;
    return raw;
  }
  return null;
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

  const externalId = normalizeExternalId(body.external_id);
  if (externalId === null) {
    errors.push("external_id must be a positive integer");
  }

  const type = body.type;
  if (!MEDIA_TYPES.includes(type as MediaType)) {
    errors.push(`type must be one of: ${MEDIA_TYPES.join(", ")}`);
  }

  const status = body.status;
  if (!MEDIA_STATUSES.includes(status as MediaStatus)) {
    errors.push(`status must be one of: ${MEDIA_STATUSES.join(", ")}`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      external_source: source as ExternalSource,
      external_id: externalId as string,
      type: type as MediaType,
      status: status as MediaStatus,
    },
  };
}
