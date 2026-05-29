import { useMutation, useQueryClient } from "@tanstack/react-query";

import { refreshOngoingEpisodes } from "../lib/refreshOngoing";

// Refresh total_episodes for ongoing AniList/TMDB series. Invalidates the
// library so the new counts (and any rollups) show without a manual reload.
export function useRefreshOngoingEpisodes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: refreshOngoingEpisodes,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["media"] });
    },
  });
}
