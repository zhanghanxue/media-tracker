// Validation + auto-complete for PATCH /api/media/:id. Both pure → unit-tested
// in the node project. The route fetches the existing row, runs the validated
// patch through applyAutoComplete, then hands the result to the repository.
//
// Patchable fields are the mutable subset of MediaRow.
//   - title_chinese / title_english / title_romaji / region ARE editable: the
//     enrichers write them (Chinese from Bangumi; a Latin title from Bangumi's
//     别名 aliases for Bangumi-direct rows), and they're the manual-correction
//     escape hatch when a match (or the default region "china") is wrong.
// Deliberately EXCLUDED:
//   - video_url: there is no such column — watching-mode video links live in
//     the media_video_parts child table (DESIGN/CLAUDE). PLAN.md's Phase 9 list
//     names it, but that predates the child-table decision; managing parts is a
//     separate endpoint, not part of this PATCH.
//   - type / external_id / cover_url / title_native: not user-editable here.

import type {
  MediaConsumptionMode,
  MediaInsert,
  MediaRow,
  MediaStatus,
} from "../db/schema";
import { MEDIA_STATUSES } from "./validation";

export interface MediaPatch {
  status?: MediaStatus;
  current_episode?: number | null;
  total_episodes?: number | null;
  current_chapter?: number | null;
  total_chapters?: number | null;
  game_progress?: string | null;
  consumption_mode?: MediaConsumptionMode | null;
  notes?: string | null;
  is_rewatching?: 0 | 1;
  title_chinese?: string | null;
  title_english?: string | null;
  title_romaji?: string | null;
  region?: string | null;
  // Series grouping: link (set id+name), move (change id+name), unlink (null).
  // Renaming a whole series goes through PATCH /api/series/:id, not here.
  series_id?: string | null;
  series_name?: string | null;
  season_number?: number | null;
}

export type PatchResult =
  | { ok: true; value: MediaPatch }
  | { ok: false; errors: string[] };

const NULLABLE_INT_FIELDS = [
  "current_episode",
  "total_episodes",
  "current_chapter",
  "total_chapters",
  "season_number",
] as const;

const NULLABLE_STRING_FIELDS = [
  "game_progress",
  "notes",
  "title_chinese",
  "title_english",
  "title_romaji",
  "region",
  "series_id",
  "series_name",
] as const;

const CONSUMPTION_MODES: MediaConsumptionMode[] = ["playing", "watching"];

const ALLOWED_FIELDS = new Set<string>([
  "status",
  ...NULLABLE_INT_FIELDS,
  ...NULLABLE_STRING_FIELDS,
  "consumption_mode",
  "is_rewatching",
]);

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

  if ("is_rewatching" in body) {
    const v = body.is_rewatching;
    if (v === 0 || v === 1) {
      patch.is_rewatching = v;
    } else {
      errors.push("is_rewatching must be 0 or 1");
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
