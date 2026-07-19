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

// Replace the row with the given id across every cached ["media", …] list —
// flat list pages ({ items, total }), infinite-query caches
// ({ pages: [{ items, total }], pageParams }) since the drill-down grid is an
// infinite query, AND bare MediaRow[] arrays (the ["media","session-added"]
// pins Home renders in place of the grid copy). Other caches under the prefix
// (the ["media","titles-index"] Set, ["media","collection-rollups"], …) either
// aren't list-shaped or hold rows with no matching id, so they're left as-is.
type InfiniteMedia = { pages: MediaListResponse[]; pageParams: unknown[] };

function mapRow(
  queryClient: ReturnType<typeof useQueryClient>,
  id: number,
  transform: (row: MediaRow) => MediaRow,
): void {
  const mapItems = (items: MediaRow[]) =>
    items.map((it) => (it.id === id ? transform(it) : it));

  queryClient.setQueriesData<unknown>({ queryKey: ["media"] }, (old: unknown) => {
    if (!old || typeof old !== "object") return old;
    // Bare MediaRow[] — the ["media","session-added"] pins. Home renders these
    // INSTEAD of the grid's copy of the same row, so skipping them left a
    // just-added card showing a stale status until a refresh. Safe against the
    // other array caches under the prefix (collection rollups, matching-
    // collection ids): mapItems only rewrites entries whose id matches.
    if (Array.isArray(old)) {
      const rows = old as MediaRow[];
      // Keep the array identity when nothing matched, so unrelated array caches
      // don't re-render on every tap.
      return rows.some((it) => it?.id === id) ? mapItems(rows) : old;
    }
    // Flat list page.
    if (Array.isArray((old as Partial<MediaListResponse>).items)) {
      const page = old as MediaListResponse;
      return { ...page, items: mapItems(page.items) };
    }
    // Infinite query — map every loaded page.
    if (Array.isArray((old as Partial<InfiniteMedia>).pages)) {
      const inf = old as InfiniteMedia;
      return {
        ...inf,
        pages: inf.pages.map((p) => ({ ...p, items: mapItems(p.items) })),
      };
    }
    return old;
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
