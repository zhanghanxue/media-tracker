import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  createCollectionApi,
  deleteCollectionApi,
  setItemCollectionApi,
  updateCollectionApi,
  type CollectionPatch,
} from "../lib/collections";

// Collection mutations. All invalidate the library + the collection list (and
// the genre facets, since a subtree type/genre edit shifts the filter options)
// so cards, the tree, and filters refetch.
function useInvalidateTree() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["media"] });
    void queryClient.invalidateQueries({ queryKey: ["collections"] });
    void queryClient.invalidateQueries({ queryKey: ["facets"] });
  };
}

export function useCreateCollection() {
  const invalidate = useInvalidateTree();
  return useMutation({
    mutationFn: ({ name, parentId }: { name: string | null; parentId: string | null }) =>
      createCollectionApi(name, parentId),
    onSuccess: invalidate,
  });
}

export function useUpdateCollection() {
  const invalidate = useInvalidateTree();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: CollectionPatch }) =>
      updateCollectionApi(id, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteCollection() {
  const invalidate = useInvalidateTree();
  return useMutation({
    mutationFn: (id: string) => deleteCollectionApi(id),
    onSuccess: invalidate,
  });
}

export function useSetItemCollection() {
  const invalidate = useInvalidateTree();
  return useMutation({
    mutationFn: ({
      id,
      collectionId,
      sortOrder,
    }: {
      id: number;
      collectionId: string | null;
      sortOrder?: number | null;
    }) => setItemCollectionApi(id, collectionId, sortOrder),
    onSuccess: invalidate,
  });
}
