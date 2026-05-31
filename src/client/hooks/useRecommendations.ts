import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchRecommendations,
  type Recommendation,
  type RecommendType,
} from "../lib/recommend";
import { addMedia, type AddMediaInput } from "../lib/api";
import type { MediaStatus } from "../../worker/db/schema";

// Fetch recommendations for a type. Disabled until a type is chosen (the panel
// passes null before the user picks one). Cached per type for the session so
// re-opening a type doesn't re-hit the sources; the panel offers a manual
// refetch. Long staleTime because the inputs (library + source recs) change slowly.
export function useRecommendations(type: RecommendType | null) {
  return useQuery({
    queryKey: ["recommendations", type],
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

// Add a recommended item. Invalidates the library (new card appears) + the
// recommendations cache (the added item drops off subsequent lists via the
// library-exclusion filter).
export function useAddRecommendation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rec: Recommendation) => addMedia(toAddInput(rec, "planned")),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["media"], refetchType: "all" });
      void queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    },
  });
}
