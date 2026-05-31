// Shared genre normalization + storage encoding, used by every source mapper
// and the backfill script.
//
// Storage format (migration 0004): a SENTINEL-DELIMITED string `|A|B|C|`. The
// leading/trailing `|` lets `genres LIKE '%|RPG|%'` match the whole token
// exactly — without the sentinels a search for "RPG" could false-match a genre
// whose name merely contains "RPG". NULL when there are no genres.
//
// We keep each source's NATIVE genre names (the user picked "source-native +
// light cleanup"): facets are scoped per media type, so a game's "RPG" never
// has to reconcile with an anime's "Slice of Life". `cleanupGenre` only fixes
// the handful of names that are awkward to read or filter on.

const SENTINEL = "|";

// Per-name cleanup. Keyed by the raw source name; only the obvious offenders.
// IGDB labels its RPG genre "Role-playing (RPG)" — the parenthetical is what
// people actually filter on, so collapse it to the short form.
const CLEANUP: Record<string, string> = {
  "Role-playing (RPG)": "RPG",
  "Turn-based strategy (TBS)": "Strategy",
  "Real Time Strategy (RTS)": "Strategy",
  "Hack and slash/Beat 'em up": "Hack and slash",
  "Science Fiction": "Sci-Fi",
};

/** Normalize a single raw genre name: trim, drop empties, apply the cleanup map. */
export function cleanupGenre(raw: string): string {
  const name = raw.trim();
  return CLEANUP[name] ?? name;
}

/**
 * Clean a list of raw genre names → de-duplicated, sentinel-free, order-preserving.
 * Drops anything blank or containing the sentinel (defensive: a genre name with
 * a literal `|` would corrupt the encoding).
 */
export function normalizeGenres(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const g = cleanupGenre(r);
    if (!g || g.includes(SENTINEL) || seen.has(g)) continue;
    seen.add(g);
    out.push(g);
  }
  return out;
}

/**
 * Encode genres for storage: `|A|B|` (sentinel-wrapped), or NULL when empty.
 * Applies normalizeGenres first, so callers can pass raw source names directly.
 */
export function joinGenres(raw: readonly string[]): string | null {
  const list = normalizeGenres(raw);
  if (list.length === 0) return null;
  return SENTINEL + list.join(SENTINEL) + SENTINEL;
}

/** Decode a stored `|A|B|` string back to display names (for facet tallying). */
export function splitGenres(stored: string | null): string[] {
  if (!stored) return [];
  return stored.split(SENTINEL).filter(Boolean);
}

/**
 * The `LIKE` pattern that matches rows whose genre set contains `genre`.
 * Escapes LIKE wildcards in the genre name so it's used with `ESCAPE '\'`
 * (consistent with the title search) and matches the token literally.
 */
export function genreLikePattern(genre: string): string {
  const escaped = genre.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `%${SENTINEL}${escaped}${SENTINEL}%`;
}
