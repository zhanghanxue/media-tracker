import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  addVideoPartApi,
  updateVideoPartApi,
  deleteVideoPartApi,
  fetchVideoParts,
} from "../lib/videoParts";

// Video parts for one media row, keyed independently of the library list so
// adding/removing a URL only refetches the parts (not the whole library).
const partsKey = (mediaId: number) => ["media", mediaId, "parts"] as const;

export function useVideoParts(mediaId: number, enabled: boolean) {
  return useQuery({
    queryKey: partsKey(mediaId),
    queryFn: () => fetchVideoParts(mediaId),
    enabled,
  });
}

export function useAddVideoPart(mediaId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ url, title }: { url: string; title: string | null }) =>
      addVideoPartApi(mediaId, url, title),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: partsKey(mediaId) });
    },
  });
}

export function useUpdateVideoPart(mediaId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      partId,
      url,
      title,
    }: {
      partId: number;
      url: string;
      title: string | null;
    }) => updateVideoPartApi(mediaId, partId, url, title),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: partsKey(mediaId) });
    },
  });
}

export function useDeleteVideoPart(mediaId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (partId: number) => deleteVideoPartApi(mediaId, partId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: partsKey(mediaId) });
    },
  });
}
