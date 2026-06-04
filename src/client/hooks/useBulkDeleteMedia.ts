import { useMutation, useQueryClient } from "@tanstack/react-query";

async function bulkDelete(ids: number[]): Promise<number> {
  const res = await fetch("/api/media/bulk", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Bulk delete failed (HTTP ${res.status})`);
  const { deleted } = (await res.json()) as { deleted: number };
  return deleted;
}

// Delete many selected items at once. Refetches the library (so the cards
// disappear) and invalidates the collection tree + facets — counts, covers and
// genre options all shift when rows leave the library.
export function useBulkDeleteMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => bulkDelete(ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["media"], refetchType: "all" });
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
      void queryClient.invalidateQueries({ queryKey: ["facets"] });
    },
  });
}
