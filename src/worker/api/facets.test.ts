import { describe, expect, it } from "vitest";

import { tallyGenres } from "./facets";

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
