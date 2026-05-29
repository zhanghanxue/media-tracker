// "Update newest episodes" for ongoing series. For each in-progress item whose
// source can report a live count, refresh total_episodes to the newest value:
//   • AniList anime — browser fetches the latest aired episode (AniList is
//     browser-direct) and POSTs it; covers long-runners like One Piece whose
//     `episodes` is null until they finish.
//   • TMDB tv (drama) — the Worker holds the key, so we POST with no body and it
//     fetches number_of_episodes / the season's episode_count itself.
// Movies and Bangumi-direct rows are skipped (no reliable live count). Only
// total_episodes changes — never your current progress — and no date bump.

import { getAniListLatestEpisode } from "../../worker/sources/anilist";
import type { MediaListResponse, MediaRow } from "./types";

export interface RefreshSummary {
  checked: number;
  updated: number;
}

async function postRefresh(id: number, total?: number): Promise<boolean> {
  const res = await fetch(`/api/media/${id}/refresh-episodes`, {
    method: "POST",
    ...(total !== undefined
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ total_episodes: total }),
        }
      : {}),
  });
  return res.ok;
}

function isOngoingRefreshable(r: MediaRow): boolean {
  if (r.status !== "in_progress") return false;
  if (r.external_source === "anilist" && r.type === "animation") return true;
  // TMDB tv (drama); movie rows are "tv:" ... no — movies are "movie:", excluded.
  if (r.external_source === "tmdb" && (r.external_id ?? "").startsWith("tv:")) {
    return true;
  }
  return false;
}

export async function refreshOngoingEpisodes(): Promise<RefreshSummary> {
  const res = await fetch("/api/media?limit=200");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { items } = (await res.json()) as MediaListResponse;
  const ongoing = items.filter(isOngoingRefreshable);

  let updated = 0;
  for (const row of ongoing) {
    try {
      if (row.external_source === "anilist") {
        const total = await getAniListLatestEpisode(Number(row.external_id));
        if (total == null) continue;
        if (await postRefresh(row.id, total)) updated += 1;
      } else {
        // TMDB tv — let the Worker fetch the count.
        if (await postRefresh(row.id)) updated += 1;
      }
    } catch {
      // One row's failure (AniList hiccup, etc.) shouldn't sink the whole run.
    }
  }
  return { checked: ongoing.length, updated };
}
