import { useMutation, useQueryClient } from "@tanstack/react-query";

import { addMedia, type AddMediaInput } from "../lib/api";

// Adds a media item, then invalidates both the library list (so the new card
// appears) and the AniList search results (so its row re-renders as "already
// added").
export function useAddMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddMediaInput) => addMedia(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["media"] });
      void queryClient.invalidateQueries({ queryKey: ["anilist-search"] });
    },
  });
}
