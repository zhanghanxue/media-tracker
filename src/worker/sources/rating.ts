// Pure helpers to normalize each source's score into our 0–10 `source_rating`
// (migration 0009). A score of 0 means "no/insufficient votes" on every source
// we use (TMDB vote_average 0 = unvoted, Bangumi/IGDB/AniList 0 or null =
// unrated), so 0 collapses to null — an unrated item should sort with the other
// unrated ones, not below every 1-star item.

/** AniList averageScore / IGDB rating: a 0–100 integer. → 0–10, or null. */
export function ratingFrom100(score: number | null | undefined): number | null {
  if (typeof score !== "number" || !Number.isFinite(score) || score <= 0) return null;
  return Math.round((score / 10) * 10) / 10; // one decimal, e.g. 83 → 8.3
}

/** TMDB vote_average / Bangumi rating.score: already 0–10. Passed through, or null. */
export function ratingFrom10(score: number | null | undefined): number | null {
  if (typeof score !== "number" || !Number.isFinite(score) || score <= 0) return null;
  return Math.round(score * 10) / 10; // guard stray precision, e.g. 8.400001 → 8.4
}
