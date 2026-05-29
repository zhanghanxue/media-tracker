import { describe, expect, it } from "vitest";

import { csvField, parseCsv, rowsToCsv, toCsv } from "./csv";

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

describe("parseCsv", () => {
  it("round-trips quoted fields, embedded commas/quotes, CJK, and a BOM", () => {
    const rows = [
      ["line", "title", "alt"],
      ["6", "海贼王, ONE PIECE", 'say "hi"'],
      ["7", "唐朝诡事录", ""],
    ];
    const text = "﻿" + rowsToCsv(rows);
    expect(parseCsv(text)).toEqual(rows);
  });

  it("keeps a blank line as an empty row (used as a section separator)", () => {
    expect(parseCsv("a\r\n\r\nb\r\n")).toEqual([["a"], [""], ["b"]]);
  });
});
