// Client-side view of the API contract. MediaRow is re-exported from the
// worker's schema (single source of truth — type-only import, erased at build,
// so no worker code leaks into the client bundle).

import type { MediaRow } from "../../worker/db/schema";

export type { MediaRow };

/** Shape returned by GET /api/media. */
export interface MediaListResponse {
  items: MediaRow[];
  total: number;
}

/** UI language collapsed to the two values the title-fallback rules care about. */
export type UiLang = "en" | "zh";
