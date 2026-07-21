import { useMutation, useQueryClient } from "@tanstack/react-query";

import { addByBangumiSubject } from "../lib/addByChinese";
import { invalidateAfterAdd } from "../lib/invalidateAfterAdd";
import type { BangumiSubject } from "../../worker/sources/bangumi";
import type { MediaStatus } from "../../worker/db/schema";

interface AddByChineseVars {
  subject: BangumiSubject;
  status: MediaStatus;
}

// Adds a Bangumi-searched item via the B-then-A routing, then refreshes the
// library + the Bangumi search results (so the picker can reflect state).
export function useAddByChinese() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ subject, status }: AddByChineseVars) =>
      addByBangumiSubject(subject, status),
    onSuccess: () => {
      invalidateAfterAdd(queryClient);
    },
  });
}
