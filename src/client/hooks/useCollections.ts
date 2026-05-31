import { useQuery } from "@tanstack/react-query";

import { listCollectionsApi } from "../lib/collections";

// The full collection list (the client builds the tree). Cached under
// ["collections"]; mutations invalidate it alongside ["media"].
export function useCollections() {
  return useQuery({
    queryKey: ["collections"],
    queryFn: listCollectionsApi,
  });
}
