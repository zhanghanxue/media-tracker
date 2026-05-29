import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { MediaPatch } from "../../worker/api/patch-media";
import type { MediaListResponse, MediaRow } from "../lib/types";

interface UpdateVars {
  id: number;
  patch: MediaPatch;
}

async function patchMedia(id: number, patch: MediaPatch): Promise<MediaRow> {
  const res = await fetch(`/api/media/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Update failed (HTTP ${res.status})`);
  return (await res.json()) as MediaRow;
}

// Replace the row with the given id across every cached ["media", …] list.
// Guard against non-list caches under the same prefix (e.g. the
// ["media","titles-index"] Set): only touch query data shaped like a list page.
function mapRow(
  queryClient: ReturnType<typeof useQueryClient>,
  id: number,
  transform: (row: MediaRow) => MediaRow,
): void {
  queryClient.setQueriesData<MediaListResponse>({ queryKey: ["media"] }, (old) => {
    if (!old || !Array.isArray((old as Partial<MediaListResponse>).items)) {
      return old;
    }
    return {
      ...old,
      items: old.items.map((it) => (it.id === id ? transform(it) : it)),
    };
  });
}

// Optimistic progress/status update. onMutate paints the change immediately
// (the +1 feels instant); onError rolls every list back; onSuccess replaces the
// row with the authoritative server version (so auto-completed status + bumped
// date_updated land). No invalidate, so the card doesn't jump/re-sort mid-tap.
export function useUpdateMedia() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: UpdateVars) => patchMedia(id, patch),

    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: ["media"] });
      const snapshots = queryClient.getQueriesData<MediaListResponse>({
        queryKey: ["media"],
      });
      mapRow(queryClient, id, (row) => ({ ...row, ...patch }) as MediaRow);
      return { snapshots };
    },

    onError: (_err, _vars, context) => {
      context?.snapshots.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },

    onSuccess: (serverRow) => {
      mapRow(queryClient, serverRow.id, () => serverRow);
    },
  });
}
