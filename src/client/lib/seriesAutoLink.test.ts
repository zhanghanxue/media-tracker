import { describe, expect, it } from "vitest";

import {
  findSeriesFromRelations,
  type AniListLibraryEntry,
} from "./seriesAutoLink";
import type { AniListRelationEdge } from "../../worker/sources/anilist";

function edge(
  relationType: string,
  id: number,
  format: AniListRelationEdge["node"]["format"],
): AniListRelationEdge {
  return { relationType, node: { id, type: "ANIME", format } };
}

// external_id → {row id, series_id}
function lib(
  entries: Array<[string, AniListLibraryEntry]>,
): Map<string, AniListLibraryEntry> {
  return new Map(entries);
}

describe("findSeriesFromRelations", () => {
  it("adopts the series_id of a grouped SEQUEL TV neighbour", () => {
    const edges = [edge("SEQUEL", 20958, "TV")];
    const decision = findSeriesFromRelations(
      edges,
      lib([["20958", { id: 7, series_id: "series:aot" }]]),
    );
    expect(decision).toEqual({ mode: "adopt", seriesId: "series:aot" });
  });

  it("creates a series spanning ungrouped neighbours when none is grouped yet", () => {
    const edges = [edge("PREQUEL", 100, "TV")];
    const decision = findSeriesFromRelations(
      edges,
      lib([["100", { id: 3, series_id: null }]]),
    );
    expect(decision).toEqual({ mode: "create", neighborIds: [3] });
  });

  it("prefers adopting a grouped neighbour over creating, when both kinds exist", () => {
    const edges = [edge("PREQUEL", 100, "TV"), edge("SEQUEL", 200, "TV")];
    const decision = findSeriesFromRelations(
      edges,
      lib([
        ["100", { id: 3, series_id: null }],
        ["200", { id: 9, series_id: "series:x" }],
      ]),
    );
    expect(decision).toEqual({ mode: "adopt", seriesId: "series:x" });
  });

  it("ignores non-chain relations (SPIN_OFF / ALTERNATIVE / ADAPTATION)", () => {
    const edges = [
      edge("SPIN_OFF", 21281, "TV"),
      edge("ALTERNATIVE", 20691, "MOVIE"),
      edge("ADAPTATION", 53390, "MANGA"),
    ];
    const decision = findSeriesFromRelations(
      edges,
      lib([
        ["21281", { id: 1, series_id: "series:y" }],
        ["20691", { id: 2, series_id: null }],
        ["53390", { id: 4, series_id: null }],
      ]),
    );
    expect(decision).toBeNull();
  });

  it("excludes non-season formats (a MOVIE/OVA sequel doesn't auto-group)", () => {
    const edges = [edge("PREQUEL", 20811, "OVA"), edge("SEQUEL", 119113, "MOVIE")];
    const decision = findSeriesFromRelations(
      edges,
      lib([
        ["20811", { id: 5, series_id: "series:z" }],
        ["119113", { id: 6, series_id: null }],
      ]),
    );
    expect(decision).toBeNull();
  });

  it("allows a null-format neighbour (e.g. a not-yet-released sequel)", () => {
    const edges = [edge("SEQUEL", 300, null)];
    const decision = findSeriesFromRelations(
      edges,
      lib([["300", { id: 8, series_id: null }]]),
    );
    expect(decision).toEqual({ mode: "create", neighborIds: [8] });
  });

  it("returns null when no qualifying neighbour is in the library", () => {
    const edges = [edge("SEQUEL", 20958, "TV")];
    expect(findSeriesFromRelations(edges, lib([]))).toBeNull();
  });
});
