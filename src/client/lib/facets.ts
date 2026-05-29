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

// Curated region set (the open-ended column accepts more, but these are the
// checkboxes we surface). Matches the AniList mapper's curated COUNTRY_TO_REGION.
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
