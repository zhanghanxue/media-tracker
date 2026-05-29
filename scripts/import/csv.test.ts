import { describe, expect, it } from "vitest";

import { csvField, toCsv } from "./csv";

describe("csvField", () => {
  it("leaves plain values unquoted", () => {
    expect(csvField("唐朝诡事录")).toBe("唐朝诡事录");
  });
  it("quotes and doubles quotes for fields with commas/quotes/newlines", () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("toCsv", () => {
  it("joins headers + rows with CRLF and a trailing newline", () => {
    const csv = toCsv(["a", "b"], [["1", "x,y"]]);
    expect(csv).toBe('a,b\r\n1,"x,y"\r\n');
  });
});
