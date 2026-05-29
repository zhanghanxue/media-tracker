// Request validation for POST /api/media. Pure function — no I/O — so it's
// TDD'd in isolation (see validation.test.ts). The handler calls
// `parseCreateMediaRequest(await c.req.json())` and branches on `.ok`.
//
// Runtime enum arrays live here (schema.ts is types-only). Each is pinned to
// its schema type with `satisfies readonly <T>[]`, so adding a value to the
// type without adding it here — or vice versa — is a compile error.

import type {
  ExternalSource,
  MediaConsumptionMode,
  MediaPlatform,
  MediaStatus,
  MediaType,
} from "../db/schema";
import type { AniListMedia } from "../sources/anilist";
import type { BangumiSubject } from "../sources/bangumi";
import type { TmdbKind } from "../sources/tmdb";

// TMDB add contract: the browser only sends the id + kind; the Worker (which
// holds the key) fetches full detail and maps authoritatively. `id` is the
// TMDB numeric id; `media_type` discriminates movie vs tv (their ids collide).
export interface TmdbAddRef {
  id: number;
  media_type: TmdbKind;
  // tv only: when present, add that ONE season (pre-linked into the show's
  // series) instead of the whole show as a single row.
  season_number?: number;
}

export const TMDB_KINDS = ["movie", "tv"] as const satisfies readonly TmdbKind[];

// IGDB add contract: the browser sends the game id plus its two game-specific
// choices — consumption_mode (the Playing/Watching toggle) and platform (the
// bucket the user confirmed, auto-filled from IGDB's platforms in the browser;
// null = unset). The Worker fetches full detail and maps authoritatively.
export interface IgdbAddRef {
  id: number;
  consumption_mode: MediaConsumptionMode;
  platform: MediaPlatform | null;
}

export const CONSUMPTION_MODES = [
  "playing",
  "watching",
] as const satisfies readonly MediaConsumptionMode[];

export const MEDIA_PLATFORMS = [
  "mobile",
  "console",
  "pc",
  "handheld",
  "arcade",
] as const satisfies readonly MediaPlatform[];

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
  "variety",
] as const satisfies readonly MediaType[];

export const MEDIA_STATUSES = [
  "planned",
  "in_progress",
  "completed",
  "dropped",
  "paused",
] as const satisfies readonly MediaStatus[];

// The browser fetches the source's media object (AniList, or a Bangumi subject)
// and POSTs it here for the Worker to map + persist — the Worker can't call
// these APIs itself (AniList blocks Worker egress; Bangumi we keep browser-side
// too). `media` is that object; the server is authoritative for the mapping.
// Its shape is validated per `external_source`, so the route can map it with the
// matching mapper.
export interface CreateMediaRequest {
  external_source: ExternalSource;
  status: MediaStatus;
  media: AniListMedia | BangumiSubject | TmdbAddRef | IgdbAddRef;
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

  // Minimal shape check on the source payload, branched by source; the mapper
  // does the rest (and throws on an unclassifiable item, which the route turns
  // into a 400). All sources need a positive integer id (the conflict key).
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
    if (source === "anilist") {
      if (!isObject(media.title)) errors.push("media.title must be an object");
      if (!isObject(media.coverImage)) {
        errors.push("media.coverImage must be an object");
      }
    } else if (source === "bangumi") {
      if (typeof media.name !== "string" || media.name.trim() === "") {
        errors.push("media.name must be a non-empty string");
      }
      if (typeof media.type !== "number") {
        errors.push("media.type must be a number");
      }
    } else if (source === "tmdb") {
      if (!TMDB_KINDS.includes(media.media_type as TmdbKind)) {
        errors.push(`media.media_type must be one of: ${TMDB_KINDS.join(", ")}`);
      }
      if ("season_number" in media && media.season_number !== undefined) {
        const sn = media.season_number;
        if (typeof sn !== "number" || !Number.isInteger(sn) || sn < 0) {
          errors.push("media.season_number must be a non-negative integer");
        } else if (media.media_type !== "tv") {
          errors.push("media.season_number is only valid for tv");
        }
      }
    } else if (source === "igdb") {
      if (!CONSUMPTION_MODES.includes(media.consumption_mode as MediaConsumptionMode)) {
        errors.push(
          `media.consumption_mode must be one of: ${CONSUMPTION_MODES.join(", ")}`,
        );
      }
      // platform is optional but, when present, must be a known bucket or null.
      if ("platform" in media && media.platform !== null) {
        if (!MEDIA_PLATFORMS.includes(media.platform as MediaPlatform)) {
          errors.push(
            `media.platform must be null or one of: ${MEDIA_PLATFORMS.join(", ")}`,
          );
        }
      }
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
      media: media as unknown as
        | AniListMedia
        | BangumiSubject
        | TmdbAddRef
        | IgdbAddRef,
    },
  };
}
