import { useQuery } from "@tanstack/react-query";

import { fetchCollectionRollups } from "../lib/api";

// Per-collection rollups (counts/dates/cover/name-samples), loaded once and
// cached. Payload is O(#collections), so this replaces the whole-library fetch
// the drill-down used to need for deriving collection names/covers/counts.
// Mutations invalidate ["collection-rollups"] alongside ["media"].
export function useCollectionRollups() {
  return useQuery({
    // Under the "media" prefix so add/delete/move/enrich invalidations (which
    // invalidate ["media"]) refresh the rollups too — counts/covers change.
    queryKey: ["media", "collection-rollups"],
    queryFn: fetchCollectionRollups,
  });
}
