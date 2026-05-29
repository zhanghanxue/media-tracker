import { useMutation, useQueryClient } from "@tanstack/react-query";

import { setSeriesCoverApi } from "../lib/series";

// Pin (or clear) the collection cover for a whole series. Invalidates the
// library so every member card + the grouped SeriesCard pick up the new cover.
export function useSetSeriesCover() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      seriesId,
      coverUrl,
    }: {
      seriesId: string;
      coverUrl: string | null;
    }) => setSeriesCoverApi(seriesId, coverUrl),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["media"] });
    },
  });
}
