import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  lookupChineseTitle,
  lookupLatinTitle,
  needsChineseTitle,
  needsLatinTitle,
  saveChineseTitle,
  saveLatinTitle,
} from "../lib/enrich";
import type { MediaListResponse, MediaRow } from "../lib/types";

export type EnrichState =
  | { phase: "idle" }
  | { phase: "running"; done: number; total: number }
  | { phase: "done"; filled: number; skippedTitles: string[] }
  | { phase: "none" }
  | { phase: "error" };

// One-shot title backfill, sequential (gentle on Bangumi; library is small):
//   • AniList rows missing a Chinese title → look up name_cn on Bangumi.
//   • Bangumi-direct rows missing a Latin title → mine the 别名 alias infobox,
//     so English mode isn't stuck on the native (Japanese/Chinese) name.
// Rows with no confident match stay as-is (fix by hand in the editor). The
// terminal status auto-clears so the trigger button returns to its label.
export function useEnrichTitles() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<EnrichState>({ phase: "idle" });

  const run = async () => {
    setState({ phase: "running", done: 0, total: 0 });

    // Each candidate is tagged with which kind of title it's missing.
    let candidates: Array<{ row: MediaRow; kind: "zh" | "latin" }>;
    try {
      // Single broad page — fine for a single-user library; limit clamps at 200.
      const res = await fetch("/api/media?limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as MediaListResponse;
      candidates = data.items.flatMap(
        (row): Array<{ row: MediaRow; kind: "zh" | "latin" }> => {
          if (needsChineseTitle(row)) return [{ row, kind: "zh" }];
          if (needsLatinTitle(row)) return [{ row, kind: "latin" }];
          return [];
        },
      );
    } catch {
      finish({ phase: "error" });
      return;
    }

    if (candidates.length === 0) {
      finish({ phase: "none" });
      return;
    }

    let filled = 0;
    const skippedTitles: string[] = [];
    for (let i = 0; i < candidates.length; i++) {
      setState({ phase: "running", done: i, total: candidates.length });
      const { row, kind } = candidates[i]!;
      const label = row.title_native ?? row.title_romaji ?? `#${row.id}`;
      try {
        if (kind === "zh") {
          const cn = await lookupChineseTitle(row);
          if (cn) {
            await saveChineseTitle(row.id, cn);
            filled++;
          } else skippedTitles.push(label);
        } else {
          const latin = await lookupLatinTitle(row);
          if (latin) {
            await saveLatinTitle(row.id, latin);
            filled++;
          } else skippedTitles.push(label);
        }
      } catch {
        // A single failed lookup/patch shouldn't abort the whole run.
        skippedTitles.push(label);
      }
    }

    if (skippedTitles.length > 0) {
      console.warn(
        `[enrich] No title matched for ${skippedTitles.length}:`,
        skippedTitles,
      );
    }

    await queryClient.invalidateQueries({ queryKey: ["media"] });

    // Keep the skipped list on screen until dismissed (the user needs to read
    // it and fix those by hand); auto-clear only when there's nothing to report.
    setState({ phase: "done", filled, skippedTitles });
    if (skippedTitles.length === 0) {
      window.setTimeout(() => setState({ phase: "idle" }), 5000);
    }
  };

  // Terminal "none"/"error" states auto-clear so the button returns to normal.
  const finish = (terminal: EnrichState) => {
    setState(terminal);
    window.setTimeout(() => setState({ phase: "idle" }), 5000);
  };

  const dismiss = () => setState({ phase: "idle" });

  return { state, run, dismiss };
}
