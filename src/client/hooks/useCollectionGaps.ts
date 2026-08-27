import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { findCollectionGaps, type CollectionGap } from "../lib/collectionGaps";
import { addMedia, type AddMediaInput } from "../lib/api";
import { invalidateAfterAdd } from "../lib/invalidateAfterAdd";
import type { MediaPlatform } from "../../worker/db/schema";
import type { MediaRow } from "../lib/types";

type Phase = "idle" | "scanning" | "done" | "error";

/**
 * The POST body for adding a surfaced gap. Everything lands as `planned` — the
 * point of the panel is filling out a collection, not recording progress.
 *
 * Games default to `playing` with the platform the browser guessed from IGDB's
 * platform list; both are editable afterwards, and demanding the choice up front
 * would put a form in front of a one-click Add.
 */
function addInputFor(gap: CollectionGap): AddMediaInput {
  const ref = gap.addRef;
  switch (ref.source) {
    case "anilist":
      return { external_source: "anilist", status: "planned", media: ref.media };
    case "igdb":
      return {
        external_source: "igdb",
        status: "planned",
        media: {
          id: ref.id,
          consumption_mode: "playing",
          platform: (ref.platform as MediaPlatform | null) ?? null,
        },
      };
    case "tmdb":
      return {
        external_source: "tmdb",
        status: "planned",
        media:
          ref.mediaType === "movie"
            ? { id: ref.id, media_type: "movie" }
            : {
                id: ref.id,
                media_type: "tv",
                season_number: ref.seasonNumber,
              },
      };
  }
}

/**
 * Drives the "what else belongs in this collection" scan. Manual trigger, like
 * the What's New scanner — a collection view shouldn't spend TMDB calls just
 * because it was opened.
 *
 * `add` drops the row from the panel on success. The add route auto-files the
 * new item into this same collection (the mapper stamps the collection_id), so
 * the drill-down behind the panel picks it up from the invalidation.
 */
export function useCollectionGaps(collectionId: string | null) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("idle");
  const [gaps, setGaps] = useState<CollectionGap[]>([]);
  // Upstream lookups completed. An anime chain walk is a dozen-plus paced
  // requests, so a bare "checking…" reads as hung.
  const [progress, setProgress] = useState(0);

  const scan = useCallback(
    async (members: MediaRow[]) => {
      setPhase("scanning");
      setProgress(0);
      try {
        setGaps(await findCollectionGaps(collectionId, members, setProgress));
        setPhase("done");
      } catch {
        setPhase("error");
      }
    },
    [collectionId],
  );

  const add = useCallback(
    async (gap: CollectionGap) => {
      await addMedia(addInputFor(gap));
      setGaps((prev) => prev.filter((g) => g.externalId !== gap.externalId));
      invalidateAfterAdd(queryClient);
    },
    [queryClient],
  );

  return { phase, progress, gaps, scan, add };
}
