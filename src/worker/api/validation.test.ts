import { describe, expect, it } from "vitest";

import { parseCreateMediaRequest } from "./validation";

const VALID = {
  external_source: "anilist",
  external_id: 101922,
  type: "animation",
  status: "planned",
};

describe("parseCreateMediaRequest — accepts valid input", () => {
  it("returns ok with the normalized value for a valid anime request", () => {
    const result = parseCreateMediaRequest(VALID);

    expect(result).toEqual({
      ok: true,
      value: {
        external_source: "anilist",
        external_id: "101922", // number coerced to string
        type: "animation",
        status: "planned",
      },
    });
  });

  it("accepts external_id as a numeric string and keeps it as a string", () => {
    const result = parseCreateMediaRequest({ ...VALID, external_id: "87216" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.external_id).toBe("87216");
    }
  });

  it("accepts every declared media type", () => {
    for (const type of [
      "animation",
      "manga",
      "light_novel",
      "drama",
      "movie",
      "game",
    ]) {
      const result = parseCreateMediaRequest({ ...VALID, type });
      expect(result.ok).toBe(true);
    }
  });
});

describe("parseCreateMediaRequest — rejects invalid input", () => {
  it("rejects a non-object body", () => {
    const result = parseCreateMediaRequest("not an object");
    expect(result).toEqual({
      ok: false,
      errors: ["request body must be a JSON object"],
    });
  });

  it("rejects null", () => {
    const result = parseCreateMediaRequest(null);
    expect(result.ok).toBe(false);
  });

  it("rejects an array body (arrays are objects in JS but not valid here)", () => {
    const result = parseCreateMediaRequest([1, 2, 3]);
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown external_source", () => {
    const result = parseCreateMediaRequest({ ...VALID, external_source: "mal" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        "external_source must be one of: anilist, tmdb, igdb, bangumi",
      );
    }
  });

  it("rejects an invalid status", () => {
    const result = parseCreateMediaRequest({ ...VALID, status: "banana" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith("status must be"))).toBe(
        true,
      );
    }
  });

  it("rejects an invalid type", () => {
    const result = parseCreateMediaRequest({ ...VALID, type: "podcast" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith("type must be"))).toBe(true);
    }
  });

  it("rejects external_id = 0, negatives, and floats", () => {
    for (const external_id of [0, -5, 3.14]) {
      const result = parseCreateMediaRequest({ ...VALID, external_id });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a non-numeric external_id string", () => {
    const result = parseCreateMediaRequest({ ...VALID, external_id: "abc" });
    expect(result.ok).toBe(false);
  });

  it("rejects a missing external_id", () => {
    const { external_id: _omit, ...withoutId } = VALID;
    const result = parseCreateMediaRequest(withoutId);
    expect(result.ok).toBe(false);
  });

  it("collects ALL errors at once, not just the first", () => {
    const result = parseCreateMediaRequest({
      external_source: "mal",
      external_id: -1,
      type: "podcast",
      status: "banana",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // One error per invalid field — proves we don't bail on the first.
      expect(result.errors).toHaveLength(4);
    }
  });
});
