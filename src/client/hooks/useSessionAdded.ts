import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchMediaByIds } from "../lib/api";
import {
  getSessionAddedCollectionIds,
  getSessionAddedIds,
  selectSessionMovedCollectionIds,
  selectSessionPins,
  subscribeSessionAdds,
  subscribeSessionCollectionAdds,
} from "../lib/sessionAdds";
import type { MediaRow } from "../lib/types";

/** Ids added this session, newest first (reactive). */
export function useSessionAddedIds(): number[] {
  return useSyncExternalStore(subscribeSessionAdds, getSessionAddedIds);
}

/** Collection ids created this session, newest first (reactive). */
export function useSessionAddedCollectionIds(): string[] {
  return useSyncExternalStore(
    subscribeSessionCollectionAdds,
    getSessionAddedCollectionIds,
  );
}

/**
 * The session-added rows and their recorded add order. Lives under the ["media"]
 * prefix so every add/edit/delete invalidation refetches it — a pinned card
 * therefore always shows the row's CURRENT state (status edits included), and a
 * deleted row simply drops out of the response. Both selectors below derive from
 * this single query (React Query dedupes the shared key → one fetch).
 */
function useSessionAddedRows(enabled: boolean): {
  ids: number[];
  rows: MediaRow[];
} {
  const ids = useSessionAddedIds();
  const { data = [] } = useQuery({
    queryKey: ["media", "session-added", ids],
    queryFn: () => fetchMediaByIds(ids),
    enabled: enabled && ids.length > 0,
  });
  return { ids: enabled ? ids : [], rows: data };
}

/**
 * Session-added rows to pin at Home, newest add first — deleted rows and rows
 * moved into a collection are dropped (see selectSessionPins).
 */
export function useSessionAddedItems(enabled: boolean): MediaRow[] {
  const { ids, rows } = useSessionAddedRows(enabled);
  if (ids.length === 0) return [];
  return selectSessionPins(ids, rows);
}

/**
 * Collections that session-added rows have since been moved into — surfaced at
 * Home so a moved item stays reachable even when its target collection has no
 * in-progress content (which would otherwise keep it off the implicit-Home view).
 */
export function useSessionMovedCollectionIds(enabled: boolean): string[] {
  const { ids, rows } = useSessionAddedRows(enabled);
  if (ids.length === 0) return [];
  return selectSessionMovedCollectionIds(ids, rows);
}
