import { describe, expect, it } from "vitest";

import {
  findCollectionFromRelations,
  type AniListLibraryEntry,
} from "./collectionAutoLink";
import type { AniListRelationEdge } from "../../worker/sources/anilist";

function edge(
  relationType: string,
  id: number,
  format: AniListRelationEdge["node"]["format"],
): AniListRelationEdge {
  return { relationType, node: { id, type: "ANIME", format } };
}

// external_id → {row id, collection_id}
function lib(
  entries: Array<[string, AniListLibraryEntry]>,
): Map<string, AniListLibraryEntry> {
  return new Map(entries);
}

describe("findCollectionFromRelations", () => {
  it("adopts the collection_id of a placed SEQUEL TV neighbour", () => {
    const edges = [edge("SEQUEL", 20958, "TV")];
    const decision = findCollectionFromRelations(
      edges,
      lib([["20958", { id: 7, collection_id: "col:aot" }]]),
    );
    expect(decision).toEqual({ mode: "adopt", collectionId: "col:aot" });
  });

  it("creates a collection spanning loose neighbours when none is placed yet", () => {
    const edges = [edge("PREQUEL", 100, "TV")];
    const decision = findCollectionFromRelations(
      edges,
      lib([["100", { id: 3, collection_id: null }]]),
    );
    expect(decision).toEqual({ mode: "create", neighborIds: [3] });
  });

  it("prefers adopting a placed neighbour over creating, when both exist", () => {
    const edges = [edge("PREQUEL", 100, "TV"), edge("SEQUEL", 200, "TV")];
    const decision = findCollectionFromRelations(
      edges,
      lib([
        ["100", { id: 3, collection_id: null }],
        ["200", { id: 9, collection_id: "col:x" }],
      ]),
    );
    expect(decision).toEqual({ mode: "adopt", collectionId: "col:x" });
  });

  it("ignores non-chain relations (SPIN_OFF / ALTERNATIVE / ADAPTATION)", () => {
    const edges = [
      edge("SPIN_OFF", 21281, "TV"),
      edge("ALTERNATIVE", 20691, "MOVIE"),
      edge("ADAPTATION", 53390, "MANGA"),
    ];
    const decision = findCollectionFromRelations(
      edges,
      lib([
        ["21281", { id: 1, collection_id: "col:y" }],
        ["20691", { id: 2, collection_id: null }],
        ["53390", { id: 4, collection_id: null }],
      ]),
    );
    expect(decision).toBeNull();
  });

  it("excludes non-season formats (a MOVIE/OVA sequel doesn't auto-group)", () => {
    const edges = [edge("PREQUEL", 20811, "OVA"), edge("SEQUEL", 119113, "MOVIE")];
    const decision = findCollectionFromRelations(
      edges,
      lib([
        ["20811", { id: 5, collection_id: "col:z" }],
        ["119113", { id: 6, collection_id: null }],
      ]),
    );
    expect(decision).toBeNull();
  });

  it("allows a null-format neighbour (e.g. a not-yet-released sequel)", () => {
    const edges = [edge("SEQUEL", 300, null)];
    const decision = findCollectionFromRelations(
      edges,
      lib([["300", { id: 8, collection_id: null }]]),
    );
    expect(decision).toEqual({ mode: "create", neighborIds: [8] });
  });

  it("returns null when no qualifying neighbour is in the library", () => {
    const edges = [edge("SEQUEL", 20958, "TV")];
    expect(findCollectionFromRelations(edges, lib([]))).toBeNull();
  });
});
