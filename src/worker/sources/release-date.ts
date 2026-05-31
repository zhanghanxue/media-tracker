// Normalize a source's release / first-air date to a uniform, sortable ISO
// string `YYYY-MM-DD`. The column is sorted lexicographically by SQLite, so a
// uniform width is what makes chronological ordering correct.
//
// Sources differ in granularity (AniList often has only a year; upcoming titles
// may lack month/day), so partials are PADDED: a missing month → 01, a missing
// day → 01. That keeps every value the same shape; a year-only "2026" becomes
// "2026-01-01" and still sorts before "2026-04-17". Returns null for missing or
// unparseable input (those rows sort last; see media-query-builder's clause).
//
// Pure — no I/O — so it's unit-tested in isolation (release-date.test.ts).

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** Build a padded ISO date from discrete parts (AniList `startDate`). A usable
 *  year is required; month/day fall back to 01 when absent or out of range. */
export function isoFromParts(
  year: number | null | undefined,
  month?: number | null,
  day?: number | null,
): string | null {
  if (typeof year !== "number" || !Number.isInteger(year) || year <= 0) {
    return null;
  }
  const mm = typeof month === "number" && month >= 1 && month <= 12 ? month : 1;
  const dd = typeof day === "number" && day >= 1 && day <= 31 ? day : 1;
  return `${pad(year, 4)}-${pad(mm, 2)}-${pad(dd, 2)}`;
}

/** Parse a source date string ("YYYY", "YYYY-MM", or "YYYY-MM-DD" — TMDB,
 *  Bangumi) into a padded ISO date. Anything else (blank, malformed) → null. */
export function isoFromString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/.exec(value.trim());
  if (!m) return null;
  return isoFromParts(
    Number(m[1]),
    m[2] !== undefined ? Number(m[2]) : null,
    m[3] !== undefined ? Number(m[3]) : null,
  );
}

/** Convert an IGDB `first_release_date` (Unix timestamp in SECONDS) to a padded
 *  ISO date in UTC. Null/non-finite → null. */
export function isoFromUnixSeconds(
  seconds: number | null | undefined,
): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const d = new Date(seconds * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
