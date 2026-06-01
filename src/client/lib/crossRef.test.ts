import { describe, it, expect } from "vitest";
import { linkedSourcesOf, anilistIdOf, bangumiIdOf } from "./crossRef";
import type { MediaRow } from "./types";

// Minimal row factory — only the ref columns linkedSourcesOf reads matter.
function row(over: Partial<MediaRow>): MediaRow {
  return {
    external_source: null,
    external_id: null,
    anilist_id: null,
    tmdb_id: null,
    igdb_id: null,
    bangumi_id: null,
    ...over,
  } as MediaRow;
}

describe("linkedSourcesOf", () => {
  it("returns nothing for a manual entry (no links)", () => {
    expect(linkedSourcesOf(row({}))).toEqual([]);
  });

  it("returns the single primary source from external_id (pre-0008 row)", () => {
    const out = linkedSourcesOf(row({ external_source: "anilist", external_id: "101922" }));
    expect(out).toEqual([{ source: "anilist", id: "101922", primary: true }]);
  });

  it("lists primary + cross-references, primary first", () => {
    // Added from AniList, then cross-referenced to Bangumi in the editor.
    const out = linkedSourcesOf(
      row({ external_source: "anilist", external_id: "100", bangumi_id: "200" }),
    );
    expect(out).toEqual([
      { source: "anilist", id: "100", primary: true },
      { source: "bangumi", id: "200", primary: false },
    ]);
  });

  it("reads a cross-reference even when the primary source differs", () => {
    // Bangumi-sourced game linked to IGDB (Feature C).
    const out = linkedSourcesOf(
      row({ external_source: "bangumi", external_id: "b1", igdb_id: "1020" }),
    );
    expect(out.map((l) => `${l.source}:${l.id}`)).toEqual(["bangumi:b1", "igdb:1020"]);
    expect(out.find((l) => l.source === "igdb")!.primary).toBe(false);
  });

  it("single-source id helpers still resolve primary-or-crossref", () => {
    const r = row({ external_source: "bangumi", external_id: "b1", anilist_id: "55" });
    expect(anilistIdOf(r)).toBe("55"); // cross-ref
    expect(bangumiIdOf(r)).toBe("b1"); // primary
  });
});
