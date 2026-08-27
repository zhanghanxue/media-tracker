// Pure helpers for the manual poster picker. No I/O — the route fetches TMDB's
// `images.posters`, these decide what to offer and validate what comes back.
//
// The picker exists because cover selection is automatic at add time (see
// tmdb-mapper's pickPosterPath: origin-language, highest-voted, else TMDB's
// default). That is right almost always and costs the user nothing, but when it
// is wrong there was no recourse short of re-adding the item. This is the
// on-demand override — the automatic pick stays the default forever.

import type { TmdbImage } from "../sources/tmdb";

/** How many posters the chooser offers. Enough to find a good one, few enough
 *  that the grid stays a glance rather than a scroll. */
export const MAX_POSTER_CHOICES = 24;

/** A poster offered to the user. `path` is what POST /cover takes back. */
export interface PosterChoice {
  path: string;
  /** TMDB's language tag for the art, or null for textless. */
  language: string | null;
  voteAverage: number;
}

/**
 * A TMDB poster path — "/wJVfG0J3mavCcDar2Jwnba96ohN.jpg". Validated rather
 * than accepting a full URL so the cover setter can only ever be pointed at
 * TMDB's own image host.
 */
export function isTmdbPosterPath(value: string): boolean {
  return /^\/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$/i.test(value);
}

/**
 * The posters worth offering, best first.
 *
 * Ordered by vote average descending — TMDB's community score is the only
 * quality signal on the payload, and the top of the list is what the user
 * actually looks at. Language is NOT ranked: the whole point of opening the
 * picker is that the automatic origin-language choice wasn't wanted, so
 * pre-sorting by language again would bury the alternatives.
 *
 * Malformed paths are dropped here rather than at POST time, so the UI can't
 * offer something the setter would then reject.
 */
export function selectPosterChoices(
  posters: TmdbImage[] | undefined,
): PosterChoice[] {
  return (posters ?? [])
    .filter((p) => typeof p.file_path === "string" && isTmdbPosterPath(p.file_path))
    .map((p) => ({
      path: p.file_path,
      language: p.iso_639_1 ?? null,
      voteAverage: p.vote_average ?? 0,
    }))
    .sort((a, b) => b.voteAverage - a.voteAverage)
    .slice(0, MAX_POSTER_CHOICES);
}
