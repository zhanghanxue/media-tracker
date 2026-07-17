import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchMediaByIds } from "../lib/api";
import { getSessionAddedIds, subscribeSessionAdds } from "../lib/sessionAdds";
import type { MediaRow } from "../lib/types";

/** Ids added this session, newest first (reactive). */
export function useSessionAddedIds(): number[] {
  return useSyncExternalStore(subscribeSessionAdds, getSessionAddedIds);
}

/**
 * The session-added rows, newest add first. Lives under the ["media"] prefix
 * so every add/edit/delete invalidation refetches it — a pinned card therefore
 * always shows the row's CURRENT state (status edits included), and a deleted
 * row simply drops out of the response.
 */
export function useSessionAddedItems(enabled: boolean): MediaRow[] {
  const ids = useSessionAddedIds();
  const { data = [] } = useQuery({
    queryKey: ["media", "session-added", ids],
    queryFn: () => fetchMediaByIds(ids),
    enabled: enabled && ids.length > 0,
  });
  if (!enabled || ids.length === 0) return [];
  // The server returns rows in its own order — restore add order (newest first).
  const byId = new Map(data.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is MediaRow => row !== undefined);
}
