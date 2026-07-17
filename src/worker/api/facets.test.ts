import { describe, expect, it } from "vitest";

import { tallyGenres, tallyRegions } from "./facets";

describe("tallyGenres", () => {
  it("counts distinct genres across stored sentinel strings, ignoring nulls", () => {
    const rows = ["|RPG|Action|", "|RPG|", null, "|Action|Adventure|", ""];
    expect(tallyGenres(rows)).toEqual([
      { value: "Action", count: 2 },
      { value: "RPG", count: 2 },
      { value: "Adventure", count: 1 },
    ]);
  });

  it("sorts by count desc then name asc", () => {
    const rows = ["|B|", "|A|", "|A|", "|C|"];
    expect(tallyGenres(rows).map((g) => g.value)).toEqual(["A", "B", "C"]);
  });

  it("returns [] when nothing carries genres", () => {
    expect(tallyGenres([null, "", null])).toEqual([]);
  });
});

describe("tallyRegions", () => {
  it("counts distinct region slugs, ignoring null/empty (the __unset__ bucket)", () => {
    const rows = ["japan", "poland", null, "japan", ""];
    expect(tallyRegions(rows)).toEqual([
      { value: "japan", count: 2 },
      { value: "poland", count: 1 },
    ]);
  });

  it("sorts by count desc then name asc", () => {
    expect(tallyRegions(["uk", "china", "china", "japan"]).map((r) => r.value)).toEqual(
      ["china", "japan", "uk"],
    );
  });

  it("returns [] when no row has a region", () => {
    expect(tallyRegions([null, "", null])).toEqual([]);
  });
});
