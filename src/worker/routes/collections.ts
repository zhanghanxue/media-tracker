// Collection routes (migration 0005). A collection is a real, nestable row
// (parent_id) that holds media items (media.collection_id) and/or other
// collections. Item ↔ collection linking is a media PATCH (collection_id);
// these endpoints manage the collections themselves + subtree bulk-edits.
//
//   GET    /api/collections        → all collections (client builds the tree)
//   POST   /api/collections        → create { name?, parent_id? }
//   PATCH  /api/collections/:id     → { name?, cover_url?, parent_id?, sort_order? }
//                                     and/or subtree bulk { region?, type?, genres? }
//   DELETE /api/collections/:id     → delete, re-parenting contents up to its parent

import { Hono } from "hono";

import type { AppEnv } from "../env";
import type { AuthVariables } from "../middleware/auth";
import type { MediaType } from "../db/schema";
import {
  collectionSubtreeIds,
  deleteCollection,
  getCollection,
  insertCollection,
  listCollections,
  selectCollectionRollups,
  updateCollection,
  updateSubtreeItemFields,
  type CollectionPatch,
  type SubtreeItemFields,
} from "../db/media-repository";
import { MEDIA_TYPES } from "../api/validation";
import { joinGenres } from "../sources/genres";

export const collectionsRoutes = new Hono<{
  Bindings: AppEnv;
  Variables: AuthVariables;
}>();

function asObject(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

// A nullable-string field: null clears; a string is trimmed (empty → null).
function coerceNullableString(raw: unknown, field: string): string | null {
  if (raw === null) return null;
  if (typeof raw === "string") {
    const t = raw.trim();
    return t === "" ? null : t;
  }
  throw new Error(`${field} must be a string or null`);
}

collectionsRoutes.get("/", async (c) => {
  const collections = await listCollections(c.env.DB);
  return c.json({ collections });
});

// Per-collection rollups (counts/dates/cover/name-samples) for the drill-down
// cards. Computed in SQL so the payload is O(#collections), letting the client
// render collection cards without fetching the whole library. Registered before
// "/:id" so "rollups" isn't captured as an id.
collectionsRoutes.get("/rollups", async (c) => {
  const rollups = await selectCollectionRollups(c.env.DB);
  return c.json({ rollups });
});

collectionsRoutes.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "request body must be valid JSON" }, 400);
  }
  const obj = asObject(body);

  let name: string | null;
  let parentId: string | null;
  try {
    name = "name" in obj ? coerceNullableString(obj.name, "name") : null;
    parentId = "parent_id" in obj ? coerceNullableString(obj.parent_id, "parent_id") : null;
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  if (parentId !== null && !(await getCollection(c.env.DB, parentId))) {
    return c.json({ error: `parent collection ${parentId} not found` }, 400);
  }

  const id = `col:${crypto.randomUUID()}`;
  const created = await insertCollection(c.env.DB, {
    id,
    name,
    parent_id: parentId,
    cover_url: null,
    sort_order: null,
  });
  return c.json(created, 201);
});

collectionsRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await getCollection(c.env.DB, id);
  if (!existing) return c.json({ error: `no collection with id ${id}` }, 404);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "request body must be valid JSON" }, 400);
  }
  const obj = asObject(body);

  const patch: CollectionPatch = {};
  const bulk: SubtreeItemFields = {};
  try {
    if ("name" in obj) patch.name = coerceNullableString(obj.name, "name");
    if ("cover_url" in obj) patch.cover_url = coerceNullableString(obj.cover_url, "cover_url");
    if ("sort_order" in obj) {
      const v = obj.sort_order;
      if (v === null) patch.sort_order = null;
      else if (typeof v === "number" && Number.isInteger(v)) patch.sort_order = v;
      else throw new Error("sort_order must be an integer or null");
    }
    if ("parent_id" in obj) {
      const parentId = coerceNullableString(obj.parent_id, "parent_id");
      if (parentId !== null) {
        if (parentId === id) throw new Error("a collection can't be its own parent");
        if (!(await getCollection(c.env.DB, parentId))) {
          throw new Error(`parent collection ${parentId} not found`);
        }
        // Cycle guard: the new parent must not live inside this collection's subtree.
        const subtree = await collectionSubtreeIds(c.env.DB, id);
        if (subtree.includes(parentId)) {
          throw new Error("can't move a collection into its own descendant");
        }
      }
      patch.parent_id = parentId;
    }

    // Subtree bulk item-fields.
    if ("region" in obj) bulk.region = coerceNullableString(obj.region, "region");
    if ("type" in obj) {
      if (!MEDIA_TYPES.includes(obj.type as MediaType)) {
        throw new Error(`type must be one of: ${MEDIA_TYPES.join(", ")}`);
      }
      bulk.type = obj.type as MediaType;
    }
    if ("genres" in obj) {
      const g = obj.genres;
      if (g === null) bulk.genres = null;
      else if (Array.isArray(g) && g.every((x) => typeof x === "string")) {
        bulk.genres = joinGenres(g as string[]);
      } else {
        throw new Error("genres must be an array of strings or null");
      }
    }
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  if (Object.keys(patch).length === 0 && Object.keys(bulk).length === 0) {
    return c.json({ error: "provide a collection field or a subtree field" }, 400);
  }

  const collection =
    Object.keys(patch).length > 0
      ? await updateCollection(c.env.DB, id, patch)
      : existing;
  const itemsUpdated =
    Object.keys(bulk).length > 0
      ? await updateSubtreeItemFields(c.env.DB, id, bulk)
      : 0;

  return c.json({ collection, itemsUpdated }, 200);
});

collectionsRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const removed = await deleteCollection(c.env.DB, id);
  if (!removed) return c.json({ error: `no collection with id ${id}` }, 404);
  return c.body(null, 204);
});
