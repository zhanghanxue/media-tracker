import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { MediaPatch } from "../../worker/api/patch-media";

async function bulkUpdate(ids: number[], patch: MediaPatch): Promise<number> {
  const res = await fetch("/api/media/bulk", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, patch }),
  });
  if (!res.ok) throw new Error(`Bulk update failed (HTTP ${res.status})`);
  const { updated } = (await res.json()) as { updated: number };
  return updated;
}

// Apply one patch to many selected items at once (add to a collection, set
// status…). Invalidates the library + collection tree so the regrouped view +
// genre facets refresh.
export function useBulkUpdateMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, patch }: { ids: number[]; patch: MediaPatch }) =>
      bulkUpdate(ids, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["media"] });
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
      void queryClient.invalidateQueries({ queryKey: ["facets"] });
    },
  });
}
