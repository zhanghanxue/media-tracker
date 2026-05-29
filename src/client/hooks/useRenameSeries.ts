import { useMutation, useQueryClient } from "@tanstack/react-query";

import { renameSeriesApi } from "../lib/series";

// Rename a whole series (all members). Invalidates the library so every member
// card + the series index pick up the new name.
export function useRenameSeries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ seriesId, name }: { seriesId: string; name: string | null }) =>
      renameSeriesApi(seriesId, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["media"] });
    },
  });
}
