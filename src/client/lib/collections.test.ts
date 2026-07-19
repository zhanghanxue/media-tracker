import { describe, expect, it } from "vitest";

import {
  collectionCoverFromRollup,
  collectionName,
  collectionNameFromSamples,
  collectionsWithItems,
  deriveName,
  rollupStatus,
  subtreeRollup,
  subtreeStatusPriority,
} from "./collections";
import type { CollectionRollup } from "./api";
import type { Collection, MediaRow } from "./types";

function col(id: string, parent: string | null): Collection {
  return { id, name: null, name_zh: null, parent_id: parent, cover_url: null, sort_order: null, date_added: "" };
}

function rollup(id: string, over: Partial<CollectionRollup> = {}): CollectionRollup {
  return {
    collection_id: id,
    direct_count: 0,
    completed_count: 0,
    planned_count: 0,
    in_progress_count: 0,
    dropped_count: 0,
    paused_count: 0,
    game_count: 0,
    latest_updated: null,
    earliest_release: null,
    sample_cover: null,
    sample_titles: [],
    ...over,
  };
}
function item(id: number, collectionId: string | null): MediaRow {
  return { id, collection_id: collectionId } as MediaRow;
}

describe("subtreeRollup", () => {
  // MCU > Iron Man ; MCU > Thor ; Star Wars (separate)
  const collections = [col("mcu", null), col("im", "mcu"), col("thor", "mcu"), col("sw", null)];
  const rollups = new Map([
    ["im", rollup("im", { direct_count: 3, completed_count: 3, planned_count: 0, game_count: 1 })],
    ["thor", rollup("thor", { direct_count: 2, completed_count: 0, planned_count: 2 })],
    ["sw", rollup("sw", { direct_count: 5, completed_count: 1, planned_count: 4, game_count: 5 })],
  ]);

  it("sums direct counts across the whole subtree (incl. the root)", () => {
    const r = subtreeRollup(rollups, collections, "mcu");
    expect(r.count).toBe(5); // 3 (im) + 2 (thor); mcu itself has no direct items
    expect(r.completed).toBe(3);
    expect(r.planned).toBe(2);
    expect(r.games).toBe(1); // 1 (im) + 0 (thor) — informational subtree aggregate
  });

  it("counts only the one collection when it has no children", () => {
    expect(subtreeRollup(rollups, collections, "sw")).toEqual({
      count: 5,
      completed: 1,
      planned: 4,
      inProgress: 0,
      dropped: 0,
      paused: 0,
      games: 5, // all-game collection → completion bar still shown by MediaList
      latestUpdated: null,
      earliestRelease: null,
    });
  });

  it("sums the full status histogram across the subtree", () => {
    const mixed = new Map([
      [
        "im",
        rollup("im", {
          direct_count: 3,
          in_progress_count: 1,
          dropped_count: 1,
          paused_count: 1,
        }),
      ],
      ["thor", rollup("thor", { direct_count: 1, in_progress_count: 1 })],
    ]);
    const r = subtreeRollup(mixed, collections, "mcu");
    expect(r.inProgress).toBe(2);
    expect(r.dropped).toBe(1);
    expect(r.paused).toBe(1);
  });

  it("rolls the newest update + earliest release across the subtree", () => {
    const dated = new Map([
      ["im", rollup("im", { direct_count: 1, latest_updated: "2026-05-30 10:00:00", earliest_release: "2008-05-02" })],
      ["thor", rollup("thor", { direct_count: 1, latest_updated: "2026-05-31 09:00:00", earliest_release: "2011-04-21" })],
    ]);
    const r = subtreeRollup(dated, collections, "mcu");
    expect(r.latestUpdated).toBe("2026-05-31 09:00:00"); // newest across subtree
    expect(r.earliestRelease).toBe("2008-05-02"); // oldest release across subtree
  });
});

describe("subtreeStatusPriority", () => {
  const counts = (over: Partial<Parameters<typeof subtreeStatusPriority>[0]>) => ({
    count: 1,
    inProgress: 0,
    planned: 0,
    completed: 0,
    dropped: 0,
    paused: 0,
    ...over,
  });

  it("ranks by the best status present (server priority order)", () => {
    // Any in-progress wins, even alongside lower statuses.
    expect(subtreeStatusPriority(counts({ inProgress: 1, completed: 5 }))).toBe(0);
    expect(subtreeStatusPriority(counts({ planned: 1, completed: 5 }))).toBe(1);
    expect(subtreeStatusPriority(counts({ completed: 2 }))).toBe(2);
    expect(subtreeStatusPriority(counts({ dropped: 1, paused: 1 }))).toBe(3);
    expect(subtreeStatusPriority(counts({ paused: 3 }))).toBe(4);
  });

  it("ranks an empty collection with planned", () => {
    expect(subtreeStatusPriority(counts({ count: 0 }))).toBe(1);
  });
});

describe("rollupStatus", () => {
  it("is completed only when every item is completed", () => {
    expect(rollupStatus({ count: 4, completed: 4, planned: 0 })).toBe("completed");
  });
  it("is planned only when every item is planned", () => {
    expect(rollupStatus({ count: 4, completed: 0, planned: 4 })).toBe("planned");
  });
  it("is in_progress for a mix", () => {
    expect(rollupStatus({ count: 4, completed: 2, planned: 1 })).toBe("in_progress");
  });
  it("is planned for an empty collection", () => {
    expect(rollupStatus({ count: 0, completed: 0, planned: 0 })).toBe("planned");
  });
});

// Per-language collection names (migration 0013). A franchise group stores the
// source's name in both languages; the zh UI must not fall straight through to
// the English one, because deriving from the members' Chinese titles is usually
// better (开拓者 beats "Pathfinder" for the IGDB groups, which have no localized
// name upstream).
describe("collectionName — language resolution", () => {
  const franchise: Collection = {
    id: "tmdb:collection:1158059",
    name: "Beiyang Trilogy",
    name_zh: "民国三部曲（系列）",
    parent_id: null,
    cover_url: null,
    sort_order: null,
    date_added: "",
  };
  const members: MediaRow[] = [
    { ...item(1, null), title_english: "Let the Bullets Fly", title_chinese: "让子弹飞" },
    { ...item(2, null), title_english: "Hidden Man", title_chinese: "邪不压正" },
  ];

  it("uses the English name in an en UI", () => {
    expect(collectionName(franchise, members, [], "en", "Untitled")).toBe(
      "Beiyang Trilogy",
    );
  });

  it("uses the Chinese name in a zh UI", () => {
    expect(collectionName(franchise, members, [], "zh", "Untitled")).toBe(
      "民国三部曲（系列）",
    );
  });

  it("never shows the zh name in an en UI", () => {
    const zhOnly = { ...franchise, name: null };
    // Falls through to derivation instead — deriveName returns the first
    // member's title when there is no shared prefix, never the zh name.
    expect(collectionName(zhOnly, members, [], "en", "Untitled")).toBe(
      "Let the Bullets Fly",
    );
  });

  it("falls back to the stored name in a zh UI when there is no zh name", () => {
    // Must NOT skip to derivation: `name` is also where an operator-typed name
    // lives, and derivation would silently override it.
    const noZh = { ...franchise, name_zh: null };
    expect(collectionName(noZh, members, [], "zh", "Untitled")).toBe(
      "Beiyang Trilogy",
    );
  });

  it("derives only when neither name is set", () => {
    const unnamed = { ...franchise, name: null, name_zh: null };
    expect(collectionName(unnamed, members, [], "zh", "Untitled")).toBe(
      // no shared prefix → the first member's title (the pre-0013 behavior
      // this migration exists to avoid)
      "让子弹飞",
    );
  });
});

describe("collectionNameFromSamples", () => {
  const titled = { id: "x", name: "My Folder", name_zh: null, parent_id: null, cover_url: null, sort_order: null, date_added: "" };

  it("uses name_zh under the zh language", () => {
    const zh = { ...titled, name_zh: "我的文件夹" };
    expect(collectionNameFromSamples(zh, [], [], "zh", "Untitled")).toBe(
      "我的文件夹",
    );
    expect(collectionNameFromSamples(zh, [], [], "en", "Untitled")).toBe(
      "My Folder",
    );
  });

  it("prefers an explicit collection name", () => {
    expect(
      collectionNameFromSamples(titled, [], [], "en", "Untitled"),
    ).toBe("My Folder");
  });

  it("derives the common prefix of sample titles in the active language", () => {
    // Trailing separator (": ") is stripped → clean "Demon Slayer".
    const samples = [
      { title_native: null, title_romaji: null, title_english: "Demon Slayer: Mugen Train", title_chinese: null },
      { title_native: null, title_romaji: null, title_english: "Demon Slayer: Swordsmith Village", title_chinese: null },
    ];
    expect(
      collectionNameFromSamples(col("c", null), samples, [], "en", "Untitled"),
    ).toBe("Demon Slayer");
  });

  it("uses the Chinese title under the zh language", () => {
    const samples = [
      { title_native: null, title_romaji: null, title_english: "X", title_chinese: "鬼灭之刃 无限列车篇" },
      { title_native: null, title_romaji: null, title_english: "Y", title_chinese: "鬼灭之刃 锻刀村篇" },
    ];
    expect(
      collectionNameFromSamples(col("c", null), samples, [], "zh", "未命名"),
    ).toBe("鬼灭之刃");
  });

  it("falls back to the fallback when there are no samples or children", () => {
    expect(collectionNameFromSamples(col("c", null), [], [], "en", "Untitled")).toBe(
      "Untitled",
    );
  });
});

describe("collectionCoverFromRollup", () => {
  it("prefers a pinned cover over the rollup sample", () => {
    const pinned = { id: "x", name: null, name_zh: null, parent_id: null, cover_url: "pinned.jpg", sort_order: null, date_added: "" };
    expect(collectionCoverFromRollup(pinned, rollup("x", { sample_cover: "s.jpg" }))).toBe(
      "pinned.jpg",
    );
  });
  it("uses the rollup sample cover when none is pinned", () => {
    expect(collectionCoverFromRollup(col("x", null), rollup("x", { sample_cover: "s.jpg" }))).toBe(
      "s.jpg",
    );
  });
  it("is null when neither is set", () => {
    expect(collectionCoverFromRollup(col("x", null), undefined)).toBeNull();
  });
});

describe("collectionsWithItems", () => {
  // MCU > Iron Man ; MCU > Thor ; Star Wars (separate)
  const collections = [
    col("mcu", null),
    col("im", "mcu"),
    col("thor", "mcu"),
    col("sw", null),
  ];

  it("marks a collection and all its ancestors when it holds a matching item", () => {
    const set = collectionsWithItems([item(1, "im")], collections);
    expect([...set].sort()).toEqual(["im", "mcu"]); // Iron Man + its parent MCU
  });

  it("does not mark unrelated branches", () => {
    const set = collectionsWithItems([item(1, "im")], collections);
    expect(set.has("thor")).toBe(false);
    expect(set.has("sw")).toBe(false);
  });

  it("ignores loose items (collection_id null) and unknown ids", () => {
    const set = collectionsWithItems([item(1, null), item(2, "ghost")], collections);
    expect(set.size).toBe(0);
  });

  it("unions across multiple matches", () => {
    const set = collectionsWithItems([item(1, "im"), item(2, "sw")], collections);
    expect([...set].sort()).toEqual(["im", "mcu", "sw"]);
  });
});

describe("deriveName", () => {
  it("returns the longest common prefix, trimmed of separators", () => {
    expect(deriveName(["Iron Man", "Iron Man 2", "Iron Man 3"])).toBe("Iron Man");
  });
  it("falls back to the single title", () => {
    expect(deriveName(["Solo Movie"])).toBe("Solo Movie");
  });
  it("is empty for no titles", () => {
    expect(deriveName([])).toBe("");
  });
});
