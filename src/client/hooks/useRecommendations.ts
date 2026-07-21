import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchRecommendations,
  removeFromRecommendationPools,
  type Recommendation,
  type RecommendType,
} from "../lib/recommend";
import { addMedia, type AddMediaInput } from "../lib/api";
import { invalidateAfterAdd } from "../lib/invalidateAfterAdd";
import type { MediaStatus } from "../../worker/db/schema";

// Fetch recommendations for a type. Disabled until a type is chosen (the panel
// passes null before the user picks one). The nonce is part of the key: the
// panel mints a fresh one per open (and when "换一批" wraps the pool), which
// forces a real refetch — the server/browser pipelines randomize seeds, so a
// new fetch means genuinely different recommendations. Within one nonce,
// switching type tabs back and forth still reuses the cache (no gratuitous
// AniList fan-outs).
export function useRecommendations(type: RecommendType | null, nonce: number) {
  return useQuery({
    queryKey: ["recommendations", type, nonce],
    queryFn: () => fetchRecommendations(type!),
    enabled: type !== null,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}

// Map a Recommendation's source-specific addRef to the add API's input. New adds
// default to "planned"; games default to playing/unset-platform (the add-modal
// defaults) — the editor can refine afterward.
function toAddInput(rec: Recommendation, status: MediaStatus): AddMediaInput {
  switch (rec.addRef.source) {
    case "anilist":
      return { external_source: "anilist", status, media: rec.addRef.media };
    case "tmdb":
      return {
        external_source: "tmdb",
        status,
        media: { id: rec.addRef.id, media_type: rec.addRef.kind },
      };
    case "igdb":
      return {
        external_source: "igdb",
        status,
        media: { id: rec.addRef.id, consumption_mode: "playing", platform: null },
      };
  }
}

// Add a recommended item. Invalidates the library (new card appears) and drops
// the item from the cached recommendation pools directly — NOT via invalidation,
// which would refetch the whole animation pipeline (slow AniList fan-out) while
// the stale pool keeps showing the added card. See removeFromRecommendationPools.
export function useAddRecommendation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rec: Recommendation) => addMedia(toAddInput(rec, "planned")),
    onSuccess: (_inserted, rec) => {
      invalidateAfterAdd(queryClient);
      removeFromRecommendationPools(queryClient, rec);
    },
  });
}
