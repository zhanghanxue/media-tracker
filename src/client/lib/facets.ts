// Facet option values for the filter sidebar. Values MUST match the server
// enums (validated by GET /api/media); human labels come from i18n keys
// (`type.<value>`, `status.<value>`, `region.<value>`).

import type { MediaStatus, MediaType } from "../../worker/db/schema";

export const TYPE_FACETS: readonly MediaType[] = [
  "animation",
  "manga",
  "light_novel",
  "drama",
  "movie",
  "game",
  "variety",
];

export const STATUS_FACETS: readonly MediaStatus[] = [
  "planned",
  "in_progress",
  "completed",
  "dropped",
  "paused",
];

// Sentinel region facet for rows with no region set (mirrors REGION_UNSET in
// worker/api/list-query.ts) — the "fix these by hand" bucket. The server maps it
// to `region IS NULL OR region = ''`. FILTER-ONLY: it's a query concept, not a
// real region, so the sidebar appends it to its region list but it is NOT in
// REGION_FACETS (the editor dropdowns, which set a real region value).
export const REGION_UNSET = "__unset__";

// Curated region set the EDITORS offer (real regions only). The open-ended
// column accepts more; matches the AniList mapper's curated COUNTRY_TO_REGION.
export const REGION_FACETS: readonly string[] = [
  "japan",
  "china",
  "korea",
  "taiwan",
  "hong_kong",
  "usa",
  "uk",
  "thailand",
];
