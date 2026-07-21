import { useMutation, useQueryClient } from "@tanstack/react-query";

import { addMedia, type AddMediaInput } from "../lib/api";
import { lookupChineseTitle, needsChineseTitle, saveChineseTitle } from "../lib/enrich";
import { invalidateAfterAdd } from "../lib/invalidateAfterAdd";

// Adds a media item, then invalidates the library list + collection tree (so
// the new card appears, even when the server auto-filed it into a series
// collection) and the AniList search results (so its row re-renders as "already
// added"). For a fresh AniList add it also auto-fills the Chinese title from
// Bangumi (best-effort, in the background) so new items match the enricher's
// behavior without a manual backfill.
export function useAddMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddMediaInput) => addMedia(input),
    onSuccess: async (row) => {
      invalidateAfterAdd(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["anilist-search"] });

      if (!needsChineseTitle(row)) return;
      try {
        const cn = await lookupChineseTitle(row);
        if (cn) {
          await saveChineseTitle(row.id, cn);
          void queryClient.invalidateQueries({ queryKey: ["media"], refetchType: "all" });
        }
      } catch {
        // Enrichment is a nicety — never fail an add over it.
      }
    },
  });
}
