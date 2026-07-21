import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  scanWhatsNew,
  fetchDismissed,
  dismissSuggestion,
  type ScanProgress,
  type ScanScope,
  type Suggestion,
} from "../lib/whatsNew";
import { addMedia } from "../lib/api";
import { invalidateAfterAdd } from "../lib/invalidateAfterAdd";

type Phase = "idle" | "scanning" | "done" | "error";

// Drives the "What's New" scan. Manual trigger only (v2.0). Holds the scan
// lifecycle + the surfaced suggestions; add/dismiss mutate the list in place so
// the panel updates without a re-scan.
export function useWhatsNew() {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ScanProgress>({ done: 0, total: 0 });
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [checked, setChecked] = useState(0);

  // Scope defaults to "all"; the modal's section buttons pass "animation" /
  // "drama" / "variety" to scan just that slice (fewer seeds → quicker, lighter).
  const scan = useCallback(async (scope: ScanScope = "all") => {
    setPhase("scanning");
    setProgress({ done: 0, total: 0 });
    try {
      const dismissed = await fetchDismissed();
      const result = await scanWhatsNew(dismissed, setProgress, scope);
      setSuggestions(result.suggestions);
      setChecked(result.checked);
      setPhase("done");
    } catch {
      setPhase("error");
    }
  }, []);

  const keyOf = (s: Suggestion) => `${s.source}:${s.externalId}`;

  // Add a surfaced item via the existing add flow, then drop it from the panel.
  const add = useCallback(
    async (s: Suggestion) => {
      const input =
        s.addRef.source === "tmdb"
          ? {
              external_source: "tmdb" as const,
              status: "planned" as const,
              media: {
                id: s.addRef.showId,
                media_type: "tv" as const,
                season_number: s.addRef.seasonNumber,
              },
            }
          : {
              external_source: "anilist" as const,
              status: "planned" as const,
              media: s.addRef.media,
            };
      await addMedia(input);
      setSuggestions((prev) => prev.filter((x) => keyOf(x) !== keyOf(s)));
      invalidateAfterAdd(queryClient);
    },
    [queryClient],
  );

  // Persist a dismissal + drop it from the panel (so it won't reappear next scan).
  const dismiss = useCallback(async (s: Suggestion) => {
    await dismissSuggestion(s);
    setSuggestions((prev) => prev.filter((x) => keyOf(x) !== keyOf(s)));
  }, []);

  return { phase, progress, suggestions, checked, scan, add, dismiss };
}
