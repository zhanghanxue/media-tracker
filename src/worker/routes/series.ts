// Series routes. A "series" isn't its own table — it's the set of media rows
// sharing a `series_id`, with `series_name` denormalized onto each. Linking /
// moving / unlinking a single row happens via PATCH /api/media/:id (series_id +
// series_name in the patch). The only series-level operation that spans rows is
// a rename, which lives here.

import { Hono } from "hono";

import type { AppEnv } from "../env";
import type { AuthVariables } from "../middleware/auth";
import { renameSeries } from "../db/media-repository";

export const seriesRoutes = new Hono<{
  Bindings: AppEnv;
  Variables: AuthVariables;
}>();

// PATCH /api/series/:id  { name } → rename every member of the series.
// 200 { updated } on success; 404 when no row carries that series_id.
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

  const name =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).name
      : undefined;
  // null clears the override (revert to auto-named); a string must be non-empty.
  let value: string | null;
  if (name === null) {
    value = null;
  } else if (typeof name === "string" && name.trim() !== "") {
    value = name.trim();
  } else {
    return c.json({ error: "name must be a non-empty string or null" }, 400);
  }

  const updated = await renameSeries(c.env.DB, seriesId, value);
  if (updated === 0) {
    return c.json({ error: `no series with id ${seriesId}` }, 404);
  }
  return c.json({ updated }, 200);
});
