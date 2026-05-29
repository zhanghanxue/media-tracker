// Client-side IGDB search helpers. The search itself goes through the Worker
// proxy (GET /api/igdb/search) because IGDB is key-bearing; the add then sends
// only { id, consumption_mode, platform } and the Worker fetches detail.

import type { IgdbGame } from "../../worker/sources/igdb";
import type { MediaPlatform } from "../../worker/db/schema";

export type { IgdbGame };

// IGDB's public image CDN (t_cover_big). Inlined rather than imported from the
// Worker's igdb client so the browser bundle doesn't pull in its token logic.
const IGDB_IMAGE_BASE = "https://images.igdb.com/igdb/image/upload/t_cover_big";

/** Cover URL for a search result (IGDB's public image CDN; re-hosted on add). */
export function igdbCover(game: IgdbGame): string | null {
  const imageId = game.cover?.image_id;
  return imageId ? `${IGDB_IMAGE_BASE}/${imageId}.jpg` : null;
}

/** Release year from IGDB's Unix-seconds `first_release_date`, or null. */
export function igdbYear(game: IgdbGame): number | null {
  if (!game.first_release_date) return null;
  return new Date(game.first_release_date * 1000).getUTCFullYear();
}

/** The game's platforms as a short display string (e.g. "PC, PS5, Switch"). */
export function igdbPlatformNames(game: IgdbGame): string {
  return (game.platforms ?? [])
    .map((p) => p.abbreviation || p.name)
    .filter(Boolean)
    .join(", ");
}

// Best-effort map of a game's IGDB platforms to one of our 5 buckets, for the
// auto-filled selector the user confirms before adding. Matches on platform
// names/abbreviations (IGDB's taxonomy is broad), priority: pc > console >
// handheld > mobile > arcade. Returns null when nothing recognizable.
export function guessPlatformBucket(game: IgdbGame): MediaPlatform | null {
  const text = (game.platforms ?? [])
    .map((p) => `${p.name ?? ""} ${p.abbreviation ?? ""}`)
    .join(" ")
    .toLowerCase();
  if (!text.trim()) return null;
  if (/windows|mac\b|macos|linux|\bpc\b|steam/.test(text)) return "pc";
  if (/switch|3ds|\bds\b|psp|vita|game ?boy|\bgb[ac]?\b|handheld|portable/.test(text))
    return "handheld";
  if (/ios|android|mobile|iphone|ipad/.test(text)) return "mobile";
  if (/arcade/.test(text)) return "arcade";
  if (/playstation|\bps[1-5]?\b|xbox|wii|gamecube|nintendo|sega|dreamcast|saturn|console|switch/.test(text))
    return "console";
  return null;
}

export interface IgdbSearchResponse {
  results: IgdbGame[];
}

export async function searchIgdbMedia(q: string): Promise<IgdbGame[]> {
  const res = await fetch(`/api/igdb/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`IGDB search failed (HTTP ${res.status})`);
  const data = (await res.json()) as IgdbSearchResponse;
  return data.results;
}
