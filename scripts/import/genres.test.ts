import { describe, expect, it } from "vitest";

import { encodeGenres, needsGenres, type LibRow } from "./genres";

function row(over: Partial<LibRow> = {}): LibRow {
  return {
    id: 1,
    type: "animation",
    external_source: "anilist",
    external_id: "123",
    genres: null,
    ...over,
  };
}

describe("needsGenres", () => {
  it("true when sourced but genres null/empty", () => {
    expect(needsGenres(row({ genres: null }))).toBe(true);
    expect(needsGenres(row({ genres: "" }))).toBe(true);
  });

  it("false once genres are present", () => {
    expect(needsGenres(row({ genres: "|RPG|" }))).toBe(false);
  });

  it("false for manual rows with no source identity", () => {
    expect(needsGenres(row({ external_source: null }))).toBe(false);
    expect(needsGenres(row({ external_id: null }))).toBe(false);
  });
});

describe("encodeGenres", () => {
  it("encodes to the sentinel form (canonicalized), null when empty", () => {
    expect(encodeGenres(["RPG", "Action"])).toBe("|角色扮演|动作|");
    expect(encodeGenres([])).toBeNull();
  });
});
