import type { QueryClient } from "@tanstack/react-query";

/**
 * Refresh everything an add can change. Adds are the one mutation that can
 * create a collection as a SIDE EFFECT: the server stamps a deterministic
 * collection_id (IGDB series, TMDB franchise/season) and materializes the row
 * via ensureCollection, without saying so in the response. So an add must
 * invalidate the collection tree too, not just ["media"] — otherwise the new
 * collection's card can't render (MediaList resolves pinned collection ids
 * against the ["collections"] cache) and the item itself is invisible at Home,
 * which only lists loose (collection_id IS NULL) rows. Net effect before this:
 * the item silently disappeared until a page refresh.
 *
 * Every add path funnels through here so the two keys can't drift apart again.
 */
export function invalidateAfterAdd(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["media"], refetchType: "all" });
  void queryClient.invalidateQueries({ queryKey: ["collections"], refetchType: "all" });
}
