import { describe, expect, it } from "vitest";

import { stripCollectionSuffix, stripSeriesWords } from "./collection-name";

describe("stripSeriesWords", () => {
  it("drops a dangling English grouping word", () => {
    expect(stripSeriesWords("Stranger Things Season")).toBe("Stranger Things");
    expect(stripSeriesWords("Doctor Who Series")).toBe("Doctor Who");
    expect(stripSeriesWords("The Wire Seasons")).toBe("The Wire");
  });

  it("is case-insensitive and handles brackets", () => {
    expect(stripSeriesWords("Rocky SERIES")).toBe("Rocky");
    expect(stripSeriesWords("Alien (Series)")).toBe("Alien");
    expect(stripSeriesWords("Alien（系列）Season")).toBe("Alien（系列）");
  });

  it("cleans up the separator the marker leaves behind", () => {
    expect(stripSeriesWords("Stranger Things: Season")).toBe("Stranger Things");
    expect(stripSeriesWords("Doctor Who — Series")).toBe("Doctor Who");
  });

  it("drops a dangling 第 — an ordinal with its ordinal sheared off", () => {
    // Longest common prefix of 庆余年 第一季 / 庆余年 第二季.
    expect(stripSeriesWords("庆余年 第")).toBe("庆余年");
    expect(stripSeriesWords("全职高手第")).toBe("全职高手");
  });

  it("strips repeatedly when more than one marker is trailing", () => {
    expect(stripSeriesWords("Doctor Who Series Season")).toBe("Doctor Who");
  });

  it("only strips a TRAILING marker, never mid-name", () => {
    expect(stripSeriesWords("Season of the Witch")).toBe("Season of the Witch");
    expect(stripSeriesWords("A Series of Unfortunate Events")).toBe(
      "A Series of Unfortunate Events",
    );
    expect(stripSeriesWords("第一滴血")).toBe("第一滴血");
  });

  it("respects word boundaries", () => {
    expect(stripSeriesWords("The Miniseries")).toBe("The Miniseries");
    expect(stripSeriesWords("Seasoning")).toBe("Seasoning");
  });

  it("leaves 'Collection' alone — TMDB names genuinely end in it", () => {
    expect(stripSeriesWords("Rocky Collection")).toBe("Rocky Collection");
  });

  it("leaves a bare trailing 系列 alone — usually part of the real name", () => {
    expect(stripSeriesWords("蜀山系列")).toBe("蜀山系列");
  });

  it("keeps the original when stripping would empty it", () => {
    expect(stripSeriesWords("Seasons")).toBe("Seasons");
    expect(stripSeriesWords("第")).toBe("第");
  });

  it("passes through a name with nothing to strip", () => {
    expect(stripSeriesWords("  Harry Potter  ")).toBe("Harry Potter");
    expect(stripSeriesWords("")).toBe("");
  });
});

describe("stripCollectionSuffix", () => {
  it("drops TMDB's trailing （系列） marker", () => {
    expect(stripCollectionSuffix("民国三部曲（系列）")).toBe("民国三部曲");
    expect(stripCollectionSuffix("新中国三部曲（系列）")).toBe("新中国三部曲");
    expect(stripCollectionSuffix("蜀山（系列）")).toBe("蜀山");
    expect(stripCollectionSuffix("汉尼拔·莱克特（系列）")).toBe("汉尼拔·莱克特");
  });

  it("handles the half-width variant and stray spacing", () => {
    expect(stripCollectionSuffix("蜀山(系列)")).toBe("蜀山");
    expect(stripCollectionSuffix("蜀山 （系列）")).toBe("蜀山");
    expect(stripCollectionSuffix("  蜀山（系列）  ")).toBe("蜀山");
  });

  it("leaves a name without the marker untouched", () => {
    expect(stripCollectionSuffix("民国三部曲")).toBe("民国三部曲");
    // "Collection" is deliberately left alone — it reads fine on a card.
    expect(stripCollectionSuffix("Rocky Collection")).toBe("Rocky Collection");
  });

  it("also drops a trailing English grouping word", () => {
    expect(stripCollectionSuffix("Rocky Series")).toBe("Rocky");
    expect(stripCollectionSuffix("The Wire Seasons")).toBe("The Wire");
  });

  it("only strips a TRAILING marker, never mid-string", () => {
    expect(stripCollectionSuffix("（系列）之外")).toBe("（系列）之外");
  });

  it("does not strip a bare 系列 — it may be part of the real name", () => {
    expect(stripCollectionSuffix("蜀山系列")).toBe("蜀山系列");
  });

  it("keeps the original when stripping would empty it", () => {
    expect(stripCollectionSuffix("（系列）")).toBe("（系列）");
  });

  it("passes through null/empty", () => {
    expect(stripCollectionSuffix(null)).toBeNull();
    expect(stripCollectionSuffix("")).toBeNull();
    expect(stripCollectionSuffix("   ")).toBeNull();
  });
});
