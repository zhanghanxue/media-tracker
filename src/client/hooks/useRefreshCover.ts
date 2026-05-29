import { useMutation, useQueryClient } from "@tanstack/react-query";

// Re-pull the origin-language poster for a TMDB item (POST /api/media/:id/
// refresh-cover) and overwrite its cached R2 cover. The response is the updated
// row with a cache-busted cover_url; invalidate the library so the new art shows
// without a manual refresh. TMDB-only — the editor only renders the button for
// TMDB rows, so a 422 here means a stale/odd row, surfaced as a thrown error.
async function refreshCoverApi(id: number): Promise<void> {
  const res = await fetch(`/api/media/${id}/refresh-cover`, { method: "POST" });
  if (!res.ok) throw new Error(`Refresh cover failed (HTTP ${res.status})`);
}

export function useRefreshCover() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => refreshCoverApi(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["media"] });
    },
  });
}
