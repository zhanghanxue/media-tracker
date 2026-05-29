// Series routes. A "series" isn't its own table — it's the set of media rows
// sharing a `series_id`, with `series_name` denormalized onto each. Linking /
// moving / unlinking a single row happens via PATCH /api/media/:id (series_id +
// series_name in the patch). The only series-level operation that spans rows is
// a rename, which lives here.

import { Hono } from "hono";

import type { AppEnv } from "../env";
import type { AuthVariables } from "../middleware/auth";
import { renameSeries, setSeriesCover } from "../db/media-repository";

export const seriesRoutes = new Hono<{
  Bindings: AppEnv;
  Variables: AuthVariables;
}>();

// PATCH /api/series/:id  { name?, cover_url? } → update every member of the
// series. `name` renames (denormalized series_name); `cover_url` pins the
// collection cover (denormalized series_cover_url). Either field may be a
// non-empty string or null (null clears that override → revert to auto). At
// least one must be present. 200 { updated } on success; 404 when no row
// carries that series_id.
seriesRoutes.patch("/:id", async (c) => {
  const seriesId = c.req.param("id");
  if (!seriesId) {
    return c.json({ error: "series id is required" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "request body must be valid JSON" }, 400);
  }
  const obj =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  const hasName = "name" in obj;
  const hasCover = "cover_url" in obj;
  if (!hasName && !hasCover) {
    return c.json({ error: "provide name and/or cover_url" }, 400);
  }

  // null clears the override; a string must be non-empty after trimming.
  const coerce = (raw: unknown, field: string): string | null | undefined => {
    if (raw === null) return null;
    if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
    throw new Error(`${field} must be a non-empty string or null`);
  };

  let nameValue: string | null | undefined;
  let coverValue: string | null | undefined;
  try {
    if (hasName) nameValue = coerce(obj.name, "name");
    if (hasCover) coverValue = coerce(obj.cover_url, "cover_url");
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  // Both updates target the same members, so each returns the member count;
  // take whichever ran (they agree). 0 ⇒ no row carries this series_id.
  let updated = 0;
  if (hasName) updated = await renameSeries(c.env.DB, seriesId, nameValue!);
  if (hasCover) updated = await setSeriesCover(c.env.DB, seriesId, coverValue!);

  if (updated === 0) {
    return c.json({ error: `no series with id ${seriesId}` }, 404);
  }
  return c.json({ updated }, 200);
});
