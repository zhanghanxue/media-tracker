import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PosterChoice } from "../../worker/api/poster-choices";

export type { PosterChoice };

// TMDB's poster CDN. Inlined (like igdbSearch's IGDB_IMAGE_BASE) rather than
// imported from the Worker's tmdb client, and at w185 rather than w500 — a
// chooser grid renders two dozen thumbnails at ~44px wide, so pulling full-size
// art for all of them would be wasteful. The COVER that gets stored is still
// re-hosted from w500 server-side.
const TMDB_THUMB_BASE = "https://image.tmdb.org/t/p/w185";

/** Thumbnail URL for a poster choice. */
export function posterThumbUrl(choice: PosterChoice): string {
  return `${TMDB_THUMB_BASE}${choice.path}`;
}

async function fetchPosterChoices(id: number): Promise<PosterChoice[]> {
  const res = await fetch(`/api/media/${id}/posters`);
  if (!res.ok) throw new Error(`Poster list failed (HTTP ${res.status})`);
  return ((await res.json()) as { posters: PosterChoice[] }).posters;
}

/**
 * TMDB's posters for one item, fetched lazily — `enabled` stays false until the
 * user actually opens the chooser, so browsing the library never pays for it.
 */
export function usePosterChoices(id: number, enabled: boolean) {
  return useQuery({
    queryKey: ["media", "posters", id],
    queryFn: () => fetchPosterChoices(id),
    enabled,
    staleTime: 10 * 60_000,
  });
}

/** Pin one of TMDB's posters as the item's cover. */
export function useSetCover(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (posterPath: string) => {
      const res = await fetch(`/api/media/${id}/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poster_path: posterPath }),
      });
      if (!res.ok) throw new Error(`Set cover failed (HTTP ${res.status})`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["media"] });
    },
  });
}
