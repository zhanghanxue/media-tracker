// Validation + auto-complete for PATCH /api/media/:id. Both pure → unit-tested
// in the node project. The route fetches the existing row, runs the validated
// patch through applyAutoComplete, then hands the result to the repository.
//
// Patchable fields are the mutable subset of MediaRow.
//   - title_chinese / title_english / title_romaji / region ARE editable: the
//     enrichers write them (Chinese from Bangumi; a Latin title from Bangumi's
//     别名 aliases for Bangumi-direct rows), and they're the manual-correction
//     escape hatch when a match (or the default region "china") is wrong.
//   - type IS editable: TMDB files every `tv` show under "drama", so reality /
//     variety shows land mistyped; the editor lets the user re-classify them.
// Deliberately EXCLUDED:
//   - video_url: there is no such column — watching-mode video links live in
//     the media_video_parts child table (DESIGN/CLAUDE). PLAN.md's Phase 9 list
//     names it, but that predates the child-table decision; managing parts is a
//     separate endpoint, not part of this PATCH.
//   - external_id / external_source / cover_url / title_native: the row's PRIMARY
//     source identity is NOT user-editable here — re-keying a row's source of
//     record is deliberately out of scope (it would orphan covers and break the
//     conflict probe). Instead, the cross-reference ids (anilist_id / tmdb_id /
//     igdb_id / bangumi_id) ARE editable: they link a row to its equivalent on
//     ANOTHER source without disturbing its primary source (PRD-v2 Issue A —
//     persisting a Bangumi anime's AniList link — and Feature C — a Bangumi
//     game's IGDB link). They're plain nullable strings.

import type {
  MediaConsumptionMode,
  MediaInsert,
  MediaPlatform,
  MediaRow,
  MediaStatus,
  MediaType,
} from "../db/schema";
import { MEDIA_PLATFORMS, MEDIA_STATUSES, MEDIA_TYPES } from "./validation";

export interface MediaPatch {
  status?: MediaStatus;
  type?: MediaType;
  current_episode?: number | null;
  total_episodes?: number | null;
  current_chapter?: number | null;
  total_chapters?: number | null;
  game_progress?: string | null;
  consumption_mode?: MediaConsumptionMode | null;
  platform?: MediaPlatform | null;
  notes?: string | null;
  is_rewatching?: 0 | 1;
  title_chinese?: string | null;
  title_english?: string | null;
  title_romaji?: string | null;
  region?: string | null;
  // Padded ISO `YYYY-MM-DD` air/release date (set by the backfill script or a
  // manual edit). Format-checked below; stored as-is.
  release_date?: string | null;
  // Sentinel-delimited genre string (set by the backfill script). Stored as-is.
  genres?: string | null;
  // Collection placement: link (set collection_id), move (change it), unlink
  // (null). sort_order positions the item among its collection's siblings.
  // A collection's own name/cover/parent are edited via PATCH /api/collections/:id.
  collection_id?: string | null;
  sort_order?: number | null;
  // Cross-reference ids to other sources (migration 0008). Editable: linking a
  // row to its equivalent elsewhere (Issue A / Feature C) without re-keying its
  // primary source. Plain nullable strings, validated like the other strings.
  anilist_id?: string | null;
  tmdb_id?: string | null;
  igdb_id?: string | null;
  bangumi_id?: string | null;
}

export type PatchResult =
  | { ok: true; value: MediaPatch }
  | { ok: false; errors: string[] };

const NULLABLE_INT_FIELDS = [
  "current_episode",
  "total_episodes",
  "current_chapter",
  "total_chapters",
  "sort_order",
] as const;

const NULLABLE_STRING_FIELDS = [
  "game_progress",
  "notes",
  "title_chinese",
  "title_english",
  "title_romaji",
  "region",
  "genres",
  "collection_id",
  // Cross-reference ids (migration 0008) — validated as nullable strings; added
  // to ALLOWED_FIELDS automatically since that set spreads this list.
  "anilist_id",
  "tmdb_id",
  "igdb_id",
  "bangumi_id",
] as const;

const CONSUMPTION_MODES: MediaConsumptionMode[] = ["playing", "watching"];

const ALLOWED_FIELDS = new Set<string>([
  "status",
  "type",
  ...NULLABLE_INT_FIELDS,
  ...NULLABLE_STRING_FIELDS,
  "consumption_mode",
  "platform",
  "is_rewatching",
  "release_date",
]);

// A padded ISO date, e.g. "2026-04-17" (the only shape the mappers / backfill
// produce). Light guard so a malformed date can't poison the sort column.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePatchMediaRequest(body: unknown): PatchResult {
  if (!isObject(body)) {
    return { ok: false, errors: ["request body must be a JSON object"] };
  }

  const errors: string[] = [];
  const patch: MediaPatch = {};

  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key)) errors.push(`unknown field: ${key}`);
  }

  if ("status" in body) {
    const v = body.status;
    if (!MEDIA_STATUSES.includes(v as MediaStatus)) {
      errors.push(`status must be one of: ${MEDIA_STATUSES.join(", ")}`);
    } else {
      patch.status = v as MediaStatus;
    }
  }

  if ("type" in body) {
    const v = body.type;
    if (!MEDIA_TYPES.includes(v as MediaType)) {
      errors.push(`type must be one of: ${MEDIA_TYPES.join(", ")}`);
    } else {
      patch.type = v as MediaType;
    }
  }

  for (const field of NULLABLE_INT_FIELDS) {
    if (field in body) {
      const v = body[field];
      if (v === null) {
        patch[field] = null;
      } else if (typeof v === "number" && Number.isInteger(v) && v >= 0) {
        patch[field] = v;
      } else {
        errors.push(`${field} must be a non-negative integer or null`);
      }
    }
  }

  for (const field of NULLABLE_STRING_FIELDS) {
    if (field in body) {
      const v = body[field];
      if (v === null || typeof v === "string") {
        patch[field] = v;
      } else {
        errors.push(`${field} must be a string or null`);
      }
    }
  }

  if ("consumption_mode" in body) {
    const v = body.consumption_mode;
    if (v === null || CONSUMPTION_MODES.includes(v as MediaConsumptionMode)) {
      patch.consumption_mode = v as MediaConsumptionMode | null;
    } else {
      errors.push("consumption_mode must be 'playing', 'watching', or null");
    }
  }

  if ("platform" in body) {
    const v = body.platform;
    if (v === null || MEDIA_PLATFORMS.includes(v as MediaPlatform)) {
      patch.platform = v as MediaPlatform | null;
    } else {
      errors.push(`platform must be null or one of: ${MEDIA_PLATFORMS.join(", ")}`);
    }
  }

  if ("is_rewatching" in body) {
    const v = body.is_rewatching;
    if (v === 0 || v === 1) {
      patch.is_rewatching = v;
    } else {
      errors.push("is_rewatching must be 0 or 1");
    }
  }

  if ("release_date" in body) {
    const v = body.release_date;
    if (v === null || (typeof v === "string" && ISO_DATE_RE.test(v))) {
      patch.release_date = v;
    } else {
      errors.push("release_date must be an ISO date (YYYY-MM-DD) or null");
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, errors: ["no updatable fields provided"] };
  }

  return { ok: true, value: patch };
}

/**
 * Auto-transition to "completed" when progress reaches the total — UNLESS the
 * caller set `status` explicitly in the same request (manual override wins).
 * Applies to whichever dimension the item tracks: episodes (animation/drama/
 * movie/watching-game) or chapters (manga/light_novel). Uses the MERGED view
 * (patch value if the key is present — even null — else the existing value),
 * so setting just current_episode against an existing total still completes.
 *
 * One-way: it only ever ADDS completed; it never reverts a status.
 */
export function applyAutoComplete(
  existing: MediaRow,
  patch: MediaPatch,
): MediaPatch {
  if (patch.status !== undefined) return patch; // explicit override

  const merged = <K extends keyof MediaPatch>(key: K) =>
    key in patch ? patch[key] : (existing[key as keyof MediaRow] as unknown);

  const ep = merged("current_episode") as number | null;
  const epTotal = merged("total_episodes") as number | null;
  const ch = merged("current_chapter") as number | null;
  const chTotal = merged("total_chapters") as number | null;

  const episodesDone = ep != null && epTotal != null && ep >= epTotal;
  const chaptersDone = ch != null && chTotal != null && ch >= chTotal;

  if (episodesDone || chaptersDone) {
    return { ...patch, status: "completed" };
  }
  return patch;
}

/**
 * Auto-transition a "planned" item to "in_progress" the first time progress is
 * recorded — so tapping +1 (or setting an episode/chapter) on a planned item
 * moves it to in-progress without a manual status change. Like applyAutoComplete:
 * skipped when the caller set `status` explicitly (or applyAutoComplete already
 * set it — completing trumps starting), and one-way (only planned → in_progress,
 * never the reverse). Triggers on a positive current_episode/current_chapter.
 */
export function applyAutoStart(
  existing: MediaRow,
  patch: MediaPatch,
): MediaPatch {
  if (patch.status !== undefined) return patch; // explicit / already auto-completed
  if (existing.status !== "planned") return patch;

  const ep = patch.current_episode;
  const ch = patch.current_chapter;
  const started =
    (typeof ep === "number" && ep > 0) || (typeof ch === "number" && ch > 0);

  return started ? { ...patch, status: "in_progress" } : patch;
}

/**
 * The inverse of applyAutoComplete: when the caller marks an item "completed",
 * fill the progress count up to its known total (so you don't have to set the
 * episode/chapter by hand). Fills whichever dimension has a known total
 * (episodes for animation/drama/movie, chapters for manga/light_novel). Skips a
 * dimension if the same request already set its current value explicitly
 * (manual override wins) or if the total is unknown.
 */
export function applyCompletionFill(
  existing: MediaRow,
  patch: MediaPatch,
): MediaPatch {
  if (patch.status !== "completed") return patch;

  const result = { ...patch };

  const epTotal =
    "total_episodes" in patch ? patch.total_episodes : existing.total_episodes;
  if (
    epTotal != null &&
    !("current_episode" in patch) &&
    existing.current_episode !== epTotal
  ) {
    result.current_episode = epTotal;
  }

  const chTotal =
    "total_chapters" in patch ? patch.total_chapters : existing.total_chapters;
  if (
    chTotal != null &&
    !("current_chapter" in patch) &&
    existing.current_chapter !== chTotal
  ) {
    result.current_chapter = chTotal;
  }

  return result;
}

/**
 * The create-time twin of applyCompletionFill: when an item is ADDED with
 * status "completed", it's been fully consumed, so seed its progress to the
 * known total (the source mappers leave current_* null). Fills only the
 * dimension that has a total; leaves current_* null when the total is unknown.
 */
export function applyCompletionFillOnCreate(row: MediaInsert): MediaInsert {
  if (row.status !== "completed") return row;
  return {
    ...row,
    current_episode: row.current_episode ?? row.total_episodes,
    current_chapter: row.current_chapter ?? row.total_chapters,
  };
}
