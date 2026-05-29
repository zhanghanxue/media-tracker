import { describe, expect, it } from "vitest";

import { deriveContext, parseList, parseProgress, parseWork } from "./parse";

describe("deriveContext", () => {
  it("maps 动画 / 日漫 → in-progress Japanese animation", () => {
    expect(deriveContext("动画:", "日漫：")).toEqual({
      type: "animation",
      status: "planned",
      region: "japan",
      platform: null,
    });
  });

  it("maps 国漫 → Chinese animation", () => {
    expect(deriveContext("动画:", "国漫：").region).toBe("china");
  });

  it("treats a 电影 sub under 动画 as an (anime) movie, region japan", () => {
    const c = deriveContext("动画:", "电影：");
    expect(c.type).toBe("movie");
    expect(c.region).toBe("japan");
  });

  it("derives status completed from 已看完", () => {
    expect(deriveContext("动画(已看完):", null).status).toBe("completed");
    expect(deriveContext("电视剧(已看完):", null).type).toBe("drama");
  });

  it("maps the drama region sub-headers (国产→china, 韩剧→korea, 日剧→japan)", () => {
    expect(deriveContext("电视剧", "国产：").region).toBe("china");
    expect(deriveContext("电视剧", "韩剧：").region).toBe("korea");
    expect(deriveContext("电视剧", "日剧：").region).toBe("japan");
  });

  it("leaves 港台 region null (ambiguous HK/Taiwan)", () => {
    expect(deriveContext("电视剧", "港台剧：").region).toBeNull();
  });

  it("maps 综艺 → variety and 轻小说 → light_novel", () => {
    expect(deriveContext("综艺:", null).type).toBe("variety");
    expect(deriveContext("轻小说:", null).type).toBe("light_novel");
  });

  it("maps 游戏 / 手游 → game on mobile; 单机 → game, no platform", () => {
    expect(deriveContext("游戏:", "手游：")).toMatchObject({ type: "game", platform: "mobile" });
    expect(deriveContext("游戏:", "单机：")).toMatchObject({ type: "game", platform: null });
  });

  it("maps 动画电影(已看完) → completed movie", () => {
    expect(deriveContext("动画电影(已看完):", null)).toMatchObject({
      type: "movie",
      status: "completed",
    });
  });
});

describe("parseWork", () => {
  it("splits a bracket into series parts", () => {
    expect(parseWork("间谍过家家(2,3)")).toEqual({
      title: "间谍过家家",
      altTitles: [],
      parts: ["2", "3"],
    });
  });

  it("keeps named/mixed parts (seasons, OVAs, films)", () => {
    expect(parseWork("出包王女(1,2,OVA,Darkness)").parts).toEqual([
      "1",
      "2",
      "OVA",
      "Darkness",
    ]);
  });

  it("expands a franchise of distinct entries", () => {
    expect(parseWork("塞尔达(王国之泪,织梦岛,时之笛3D,御天之剑)").parts).toEqual([
      "王国之泪",
      "织梦岛",
      "时之笛3D",
      "御天之剑",
    ]);
  });

  it("treats '/' as alternate titles", () => {
    expect(parseWork("RWBY/红白黑黄(1,2,3)")).toEqual({
      title: "RWBY",
      altTitles: ["红白黑黄"],
      parts: ["1", "2", "3"],
    });
  });

  it("drops the empty member from a trailing comma like (1,)", () => {
    expect(parseWork("打工吧!魔王大人(1,)").parts).toEqual(["1"]);
  });

  it("keeps a {…} group as one member", () => {
    expect(parseWork("MC(地下城:{main,丛林觉醒,嚎风山巅},)").parts).toEqual([
      "地下城:{main,丛林觉醒,嚎风山巅}",
    ]);
  });

  it("unescapes markdown escapes in the title", () => {
    expect(parseWork("魁\\!\\!库洛马迪高校").title).toBe("魁!!库洛马迪高校");
  });
});

describe("parseProgress", () => {
  it("reads a bare count as the current episode", () => {
    expect(parseProgress("905", "animation")).toEqual({ raw: "905", episode: 905 });
  });
  it("reads a bare count as a chapter for books", () => {
    expect(parseProgress("12", "manga")).toEqual({ raw: "12", chapter: 12 });
  });
  it("reads 第N卷 as a chapter/volume", () => {
    expect(parseProgress("第8卷", "light_novel")).toEqual({ raw: "第8卷", chapter: 8 });
  });
  it("keeps game progress / dates / markers as free text", () => {
    expect(parseProgress("P10", "game")).toEqual({ raw: "P10", text: "P10" });
    expect(parseProgress("230309", "variety")).toEqual({ raw: "230309", text: "230309" });
    expect(parseProgress("07上", "variety")).toEqual({ raw: "07上", text: "07上" });
  });
  it("returns null for an empty annotation", () => {
    expect(parseProgress("", "animation")).toBeNull();
  });
});

describe("parseList — integration", () => {
  const md = [
    "# 动画:",
    "",
    "## 日漫：",
    "* 越狱兔  ",
    "* 海贼王\t\t\t905  ",
    "* 间谍过家家(2,3)\t\t26  ",
    "",
    "## 国漫：",
    "* 天宝伏妖录  ",
    "",
    "# 游戏:",
    "## 单机：",
    "* [神界:原罪(2)](https://youtu.be/abc)\t\tP1  ",
    "* 巫师3(石之心,血与酒)\t\tP1  ",
    "## 手游：",
    "* 原神  ",
    "",
    "# 综艺:",
    "* 明星大侦探(8,9)\t\t230309  ",
    "",
    "# 动画(已看完):",
    "* 死神\t\t火影\t\t公主恋人  ",
    "* Fate(FSN, UBW, ZERO)  ",
  ].join("\n");

  const entries = parseList(md);
  const by = (title: string) => entries.find((e) => e.title === title)!;

  it("parses a plain in-progress anime with no progress as planned/japan", () => {
    expect(by("越狱兔")).toMatchObject({
      type: "animation",
      status: "planned",
      region: "japan",
      parts: [],
      progress: null,
    });
  });

  it("reads the trailing count as current episode → in_progress", () => {
    expect(by("海贼王")).toMatchObject({
      status: "in_progress",
      progress: { episode: 905 },
    });
  });

  it("captures bracket seasons + progress together", () => {
    expect(by("间谍过家家")).toMatchObject({
      parts: ["2", "3"],
      status: "in_progress",
      progress: { episode: 26 },
    });
  });

  it("switches region to china under 国漫", () => {
    expect(by("天宝伏妖录").region).toBe("china");
  });

  it("treats a linked game as a watched playthrough with the URL", () => {
    expect(by("神界:原罪")).toMatchObject({
      type: "game",
      consumptionMode: "watching",
      videoUrl: "https://youtu.be/abc",
      parts: ["2"],
      progress: { text: "P1" },
    });
  });

  it("defaults a non-linked single-player game to playing", () => {
    expect(by("巫师3")).toMatchObject({ type: "game", consumptionMode: "playing" });
  });

  it("sets mobile platform under 手游", () => {
    expect(by("原神")).toMatchObject({ type: "game", platform: "mobile" });
  });

  it("maps 综艺 → variety", () => {
    expect(by("明星大侦探").type).toBe("variety");
  });

  it("splits a completed multi-column line into separate works", () => {
    const titles = entries.filter((e) => e.line === 22).map((e) => e.title);
    expect(titles).toEqual(["死神", "火影", "公主恋人"]);
    expect(entries.filter((e) => e.line === 22).every((e) => e.status === "completed")).toBe(true);
  });

  it("treats a long bracketed franchise as one completed work", () => {
    expect(by("Fate")).toMatchObject({
      status: "completed",
      parts: ["FSN", "UBW", "ZERO"],
    });
  });
});
