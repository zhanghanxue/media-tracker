import { describe, expect, it } from "vitest";

import { igdbToMediaRow } from "./igdb-mapper";
import { extractIgdbGenres, type IgdbGame } from "./igdb";

const GAME: IgdbGame = {
  id: 1942,
  name: "The Witcher 3: Wild Hunt",
  cover: { id: 1, image_id: "co1wyy" },
  first_release_date: 1431993600,
  platforms: [{ id: 6, name: "PC (Microsoft Windows)" }],
};

describe("igdbToMediaRow", () => {
  it("maps to a game row carrying the chosen mode + platform", () => {
    const row = igdbToMediaRow(GAME, {
      status: "in_progress",
      consumptionMode: "playing",
      platform: "pc",
    });
    expect(row.type).toBe("game");
    expect(row.title_english).toBe("The Witcher 3: Wild Hunt");
    expect(row.title_native).toBeNull();
    expect(row.consumption_mode).toBe("playing");
    expect(row.platform).toBe("pc");
    expect(row.region).toBeNull(); // games carry no region
    expect(row.external_source).toBe("igdb");
    expect(row.external_id).toBe("1942"); // bare id (IGDB ids are globally unique)
    expect(row.status).toBe("in_progress");
  });

  it("derives release_date from first_release_date (Unix seconds → ISO)", () => {
    const row = igdbToMediaRow(GAME, {
      status: "planned",
      consumptionMode: "playing",
      platform: "pc",
    });
    expect(row.release_date).toBe("2015-05-19");
  });

  it("leaves release_date null when IGDB has no release date", () => {
    const row = igdbToMediaRow(
      { ...GAME, first_release_date: null },
      { status: "planned", consumptionMode: "playing", platform: "pc" },
    );
    expect(row.release_date).toBeNull();
  });

  it("builds the cover URL from cover.image_id", () => {
    const row = igdbToMediaRow(GAME, {
      status: "planned",
      consumptionMode: "playing",
      platform: null,
    });
    expect(row.cover_url).toBe(
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co1wyy.jpg",
    );
  });

  it("accepts a null platform and watching mode", () => {
    const row = igdbToMediaRow(GAME, {
      status: "planned",
      consumptionMode: "watching",
      platform: null,
    });
    expect(row.platform).toBeNull();
    expect(row.consumption_mode).toBe("watching");
  });

  it("handles a game with no cover", () => {
    const row = igdbToMediaRow(
      { id: 7, name: "Tetris" },
      { status: "completed", consumptionMode: "playing", platform: "handheld" },
    );
    expect(row.cover_url).toBeNull();
    expect(row.title_english).toBe("Tetris");
  });
});

describe("igdbToMediaRow — genres", () => {
  it("merges genres + themes and cleans the RPG label into the row", () => {
    const game: IgdbGame = {
      ...GAME,
      genres: [{ name: "Role-playing (RPG)" }, { name: "Adventure" }],
      themes: [{ name: "Fantasy" }],
    };
    expect(extractIgdbGenres(game)).toEqual([
      "Role-playing (RPG)",
      "Adventure",
      "Fantasy",
    ]);
    const row = igdbToMediaRow(game, {
      status: "planned",
      consumptionMode: "playing",
      platform: null,
    });
    expect(row.genres).toBe("|RPG|Adventure|Fantasy|");
  });

  it("leaves genres null when IGDB returns none", () => {
    const row = igdbToMediaRow(GAME, {
      status: "planned",
      consumptionMode: "playing",
      platform: null,
    });
    expect(row.genres).toBeNull();
  });
});

describe("igdbToMediaRow — Chinese title", () => {
  const base = {
    status: "planned" as const,
    consumptionMode: "playing" as const,
    platform: null,
  };
  const game: IgdbGame = {
    id: 1,
    name: "The Hungry Lamb",
    alternative_names: [
      { name: "饿殍：明末千里行" }, // simplified
      { name: "餓殍：明末千里行" }, // traditional
      { name: "飢えた子羊" }, // Japanese (has kana)
      { name: "The Hungry Lamb.exe" },
    ],
  };

  it("uses the browser-supplied (Simplified) title when present", () => {
    const row = igdbToMediaRow(game, { ...base, titleChinese: "饿殍：明末千里行" });
    expect(row.title_chinese).toBe("饿殍：明末千里行");
  });

  it("falls back to a Han-only alternative name (never the kana/Japanese one)", () => {
    const row = igdbToMediaRow(game, base);
    expect(row.title_chinese).not.toBeNull();
    expect(row.title_chinese).not.toBe("飢えた子羊");
    expect(/[぀-ヿ]/.test(row.title_chinese!)).toBe(false);
  });

  it("is null when there's no CJK alternative name", () => {
    const row = igdbToMediaRow(
      { id: 2, name: "Hades", alternative_names: [{ name: "Hades.exe" }] },
      base,
    );
    expect(row.title_chinese).toBeNull();
  });
});

describe("igdbToMediaRow — region from developer country", () => {
  const opts = {
    status: "planned" as const,
    consumptionMode: "playing" as const,
    platform: null,
  };

  it("derives region from the developer's ISO-numeric country (392 → japan)", () => {
    const row = igdbToMediaRow(
      {
        id: 1,
        name: "Elden Ring",
        involved_companies: [
          { publisher: true, company: { id: 1, country: 840 } }, // Bandai US
          { developer: true, company: { id: 2, country: 392 } }, // FromSoftware JP
        ],
      },
      opts,
    );
    expect(row.region).toBe("japan"); // developer wins over publisher
  });

  it("falls back to the publisher's country when no developer has one", () => {
    const row = igdbToMediaRow(
      {
        id: 2,
        name: "X",
        involved_companies: [{ publisher: true, company: { id: 3, country: 156 } }],
      },
      opts,
    );
    expect(row.region).toBe("china");
  });

  it("is null when IGDB has no usable country", () => {
    expect(igdbToMediaRow({ id: 3, name: "Y" }, opts).region).toBeNull();
    expect(
      igdbToMediaRow(
        { id: 4, name: "Z", involved_companies: [{ developer: true, company: { id: 9, country: null } }] },
        opts,
      ).region,
    ).toBeNull();
  });
});
