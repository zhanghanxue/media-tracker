import { describe, expect, it } from "vitest";

import { autoRows, classify } from "./add";

// review.csv columns: line,type,status,region,platform,parts,title,alt,progress,
// video,bucket,match_source,match_id,match_score,match_title,alternatives
function row(over: Partial<Record<string, string>> = {}): string[] {
  const base = {
    line: "8", type: "animation", status: "in_progress", region: "japan", platform: "",
    parts: "", title: "x", alt: "", progress: "905", video: "", bucket: "auto",
    source: "bangumi", id: "350224", score: "1.00", mtitle: "y", alts: "",
  };
  const v = { ...base, ...over };
  return [v.line, v.type, v.status, v.region, v.platform, v.parts, v.title, v.alt,
    v.progress, v.video, v.bucket, v.source, v.id, v.score, v.mtitle, v.alts];
}

describe("autoRows", () => {
  it("keeps only AUTO data rows (drops labels/headers/review/none)", () => {
    const rows = [
      ["── AUTO (2) ──"], // section label
      ["line", "type"], // header
      row({ id: "1" }),
      row({ bucket: "review", id: "2" }),
      row({ bucket: "none", id: "3" }),
      row({ bucket: "auto", source: "tmdb", id: "" }), // no match id → dropped
      row({ id: "4" }),
    ];
    expect(autoRows(rows).map((r) => r.id)).toEqual(["1", "4"]);
  });

  it("splits bracket parts and reads the video flag", () => {
    const [r] = autoRows([row({ parts: "1|2|3", video: "yes" })]);
    expect(r!.parts).toEqual(["1", "2", "3"]);
    expect(r!.watching).toBe(true);
  });
});

describe("classify", () => {
  it("routes each source/type to the right plan", () => {
    expect(classify(autoRows([row({ source: "tmdb", type: "drama", id: "1" })])[0]!)).toBe("tmdb-show");
    expect(classify(autoRows([row({ source: "tmdb", type: "variety", id: "1" })])[0]!)).toBe("tmdb-show");
    expect(classify(autoRows([row({ source: "tmdb", type: "movie", id: "1" })])[0]!)).toBe("tmdb-movie");
    expect(classify(autoRows([row({ source: "igdb", type: "game", id: "1" })])[0]!)).toBe("igdb");
    expect(classify(autoRows([row({ source: "anilist", type: "animation", id: "1" })])[0]!)).toBe("anilist");
    expect(classify(autoRows([row({ source: "bangumi", type: "animation", id: "1" })])[0]!)).toBe("bangumi-resolve");
    expect(classify(autoRows([row({ source: "bangumi", type: "manga", id: "1" })])[0]!)).toBe("bangumi-resolve");
    expect(classify(autoRows([row({ source: "bangumi", type: "drama", id: "1" })])[0]!)).toBe("bangumi-direct");
  });
});
