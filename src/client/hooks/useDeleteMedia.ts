import { useMutation, useQueryClient } from "@tanstack/react-query";

async function deleteMedia(id: number): Promise<void> {
  const res = await fetch(`/api/media/${id}`, { method: "DELETE" });
  // 204 = deleted; 404 = already gone — both mean "it's not in the library".
  if (!res.ok && res.status !== 404) {
    throw new Error(`Delete failed (HTTP ${res.status})`);
  }
}

// Deletes an entry, then refetches the library so the card disappears.
export function useDeleteMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteMedia(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["media"] });
    },
  });
}
