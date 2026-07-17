// Integration tests for /api/collections (the nestable grouping tree) + the
// collection repository ops, via vitest-pool-workers (real D1).

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import app from "../index";
import {
  collectionSubtreeIds,
  ensureCollection,
  findById,
  getCollection,
  insertCollection,
  insertMedia,
} from "../db/media-repository";
import type { AniListMapperResult } from "../sources/anilist-mapper";
import type { Collection } from "../db/schema";

function row(externalId: string): AniListMapperResult {
  return {
    type: "animation",
    region: "japan",
    title_native: null,
    title_romaji: null,
    title_english: `Entry ${externalId}`,
    title_chinese: null,
    status: "planned",
    is_rewatching: 0,
    cover_url: null,
    external_id: externalId,
    external_source: "anilist",
    current_episode: null,
    total_episodes: null,
    current_chapter: null,
    total_chapters: null,
    runtime_minutes: null,
    release_date: null,
    source_rating: null,
    genres: null,
    platform: null,
    consumption_mode: null,
    collection_id: null,
    sort_order: null,
  };
}

async function linkItem(id: number, collectionId: string) {
  await env.DB.prepare("UPDATE media SET collection_id = ? WHERE id = ?")
    .bind(collectionId, id)
    .run();
}

const json = (method: string, path: string, body?: unknown) =>
  app.request(
    path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );

beforeEach(async () => {
  await env.DB.exec("DELETE FROM media");
  await env.DB.exec("DELETE FROM collections");
});

describe("POST /api/collections", () => {
  it("creates a root collection with a col: id", async () => {
    const res = await json("POST", "/api/collections", { name: "MCU" });
    expect(res.status).toBe(201);
    const c = (await res.json()) as Collection;
    expect(c.id).toMatch(/^col:/);
    expect(c.name).toBe("MCU");
    expect(c.parent_id).toBeNull();
  });

  it("creates a nested collection under an existing parent", async () => {
    const mcu = (await (await json("POST", "/api/collections", { name: "MCU" })).json()) as Collection;
    const res = await json("POST", "/api/collections", { name: "Iron Man", parent_id: mcu.id });
    expect(res.status).toBe(201);
    expect(((await res.json()) as Collection).parent_id).toBe(mcu.id);
  });

  it("400s when the parent doesn't exist", async () => {
    const res = await json("POST", "/api/collections", { name: "x", parent_id: "col:ghost" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/collections", () => {
  it("returns all collections", async () => {
    await insertCollection(env.DB, { id: "col:a", name: "A", parent_id: null, cover_url: null, sort_order: null });
    await insertCollection(env.DB, { id: "col:b", name: "B", parent_id: "col:a", cover_url: null, sort_order: null });
    const res = await json("GET", "/api/collections");
    const { collections } = (await res.json()) as { collections: Collection[] };
    expect(collections.map((c) => c.id).sort()).toEqual(["col:a", "col:b"]);
  });
});

describe("PATCH /api/collections/:id — metadata + move", () => {
  it("renames, sets cover, and moves under a new parent", async () => {
    await insertCollection(env.DB, { id: "col:p", name: "Parent", parent_id: null, cover_url: null, sort_order: null });
    await insertCollection(env.DB, { id: "col:c", name: "Child", parent_id: null, cover_url: null, sort_order: null });

    const res = await json("PATCH", "/api/collections/col:c", {
      name: "Renamed",
      cover_url: "https://x/cover.jpg",
      parent_id: "col:p",
    });
    expect(res.status).toBe(200);
    const c = (await getCollection(env.DB, "col:c"))!;
    expect(c.name).toBe("Renamed");
    expect(c.cover_url).toBe("https://x/cover.jpg");
    expect(c.parent_id).toBe("col:p");
  });

  it("rejects a move that would create a cycle (parent into its own descendant)", async () => {
    // a → b → c ; moving a under c is a cycle
    await insertCollection(env.DB, { id: "col:a", name: "a", parent_id: null, cover_url: null, sort_order: null });
    await insertCollection(env.DB, { id: "col:b", name: "b", parent_id: "col:a", cover_url: null, sort_order: null });
    await insertCollection(env.DB, { id: "col:c", name: "c", parent_id: "col:b", cover_url: null, sort_order: null });

    const res = await json("PATCH", "/api/collections/col:a", { parent_id: "col:c" });
    expect(res.status).toBe(400);
    // unchanged
    expect((await getCollection(env.DB, "col:a"))!.parent_id).toBeNull();
  });

  it("rejects making a collection its own parent", async () => {
    await insertCollection(env.DB, { id: "col:s", name: "s", parent_id: null, cover_url: null, sort_order: null });
    const res = await json("PATCH", "/api/collections/col:s", { parent_id: "col:s" });
    expect(res.status).toBe(400);
  });

  it("404s for a missing collection", async () => {
    const res = await json("PATCH", "/api/collections/col:ghost", { name: "x" });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/collections/:id — subtree bulk edit", () => {
  it("applies region/type/genres to every item in the subtree (nested too)", async () => {
    await insertCollection(env.DB, { id: "col:mcu", name: "MCU", parent_id: null, cover_url: null, sort_order: null });
    await insertCollection(env.DB, { id: "col:im", name: "Iron Man", parent_id: "col:mcu", cover_url: null, sort_order: null });
    const loose = await insertMedia(env.DB, row("1")); // directly in MCU
    const nested = await insertMedia(env.DB, row("2")); // in Iron Man (sub-collection)
    const outside = await insertMedia(env.DB, row("3")); // not in the subtree
    await linkItem(loose.id, "col:mcu");
    await linkItem(nested.id, "col:im");

    const res = await json("PATCH", "/api/collections/col:mcu", {
      region: "usa",
      type: "movie",
      genres: ["Action", "Sci-Fi"],
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { itemsUpdated: number }).toMatchObject({ itemsUpdated: 2 });

    for (const id of [loose.id, nested.id]) {
      const m = (await findById(env.DB, id))!;
      expect(m.region).toBe("usa");
      expect(m.type).toBe("movie");
      expect(m.genres).toBe("|动作|科幻|"); // canonicalized via joinGenres
    }
    expect((await findById(env.DB, outside.id))!.region).toBe("japan"); // untouched
  });
});

describe("DELETE /api/collections/:id", () => {
  it("re-parents sub-collections + items up to the deleted node's parent", async () => {
    await insertCollection(env.DB, { id: "col:mcu", name: "MCU", parent_id: null, cover_url: null, sort_order: null });
    await insertCollection(env.DB, { id: "col:im", name: "Iron Man", parent_id: "col:mcu", cover_url: null, sort_order: null });
    await insertCollection(env.DB, { id: "col:sub", name: "Sub", parent_id: "col:im", cover_url: null, sort_order: null });
    const item = await insertMedia(env.DB, row("1"));
    await linkItem(item.id, "col:im");

    const res = await json("DELETE", "/api/collections/col:im");
    expect(res.status).toBe(204);

    expect(await getCollection(env.DB, "col:im")).toBeNull();
    // the sub-collection and the item move up to MCU
    expect((await getCollection(env.DB, "col:sub"))!.parent_id).toBe("col:mcu");
    expect((await findById(env.DB, item.id))!.collection_id).toBe("col:mcu");
  });

  it("404s for a missing collection", async () => {
    const res = await json("DELETE", "/api/collections/col:ghost");
    expect(res.status).toBe(404);
  });
});

describe("repository helpers", () => {
  it("ensureCollection is idempotent", async () => {
    await ensureCollection(env.DB, "tmdb:tv:1", "Show");
    await ensureCollection(env.DB, "tmdb:tv:1", "Ignored"); // no-op, keeps first
    const c = (await getCollection(env.DB, "tmdb:tv:1"))!;
    expect(c.name).toBe("Show");
  });

  it("collectionSubtreeIds returns the root + all descendants", async () => {
    await insertCollection(env.DB, { id: "col:a", name: "a", parent_id: null, cover_url: null, sort_order: null });
    await insertCollection(env.DB, { id: "col:b", name: "b", parent_id: "col:a", cover_url: null, sort_order: null });
    await insertCollection(env.DB, { id: "col:c", name: "c", parent_id: "col:b", cover_url: null, sort_order: null });
    await insertCollection(env.DB, { id: "col:other", name: "o", parent_id: null, cover_url: null, sort_order: null });
    const ids = (await collectionSubtreeIds(env.DB, "col:a")).sort();
    expect(ids).toEqual(["col:a", "col:b", "col:c"]);
  });
});
