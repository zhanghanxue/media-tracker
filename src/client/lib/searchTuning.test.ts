import { describe, expect, it } from "vitest";

import { isSearchable } from "./searchTuning";

describe("isSearchable", () => {
  it("rejects Latin queries below the minimum", () => {
    expect(isSearchable("")).toBe(false);
    expect(isSearchable("f")).toBe(false);
    expect(isSearchable("fr")).toBe(false);
  });

  it("accepts Latin queries at the minimum", () => {
    expect(isSearchable("fri")).toBe(true);
    expect(isSearchable("frieren")).toBe(true);
  });

  it("accepts two-character CJK, which is a whole title", () => {
    expect(isSearchable("死神")).toBe(true);
    expect(isSearchable("进击")).toBe(true);
    expect(isSearchable("ワン")).toBe(true);
    expect(isSearchable("나기")).toBe(true);
  });

  it("still rejects a single CJK character", () => {
    expect(isSearchable("死")).toBe(false);
  });

  it("treats mixed script as CJK-dense", () => {
    expect(isSearchable("Fate 剧场版")).toBe(true);
    expect(isSearchable("剧场")).toBe(true);
  });

  it("ignores surrounding whitespace", () => {
    expect(isSearchable("  fr  ")).toBe(false);
    expect(isSearchable("  fri  ")).toBe(true);
    expect(isSearchable("  死神  ")).toBe(true);
  });
});
