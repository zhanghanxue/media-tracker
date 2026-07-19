import { describe, expect, it } from "vitest";

import { stripCollectionSuffix } from "./collection-name";

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
    // The English marker is a separate word, deliberately left alone.
    expect(stripCollectionSuffix("Rocky Collection")).toBe("Rocky Collection");
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
