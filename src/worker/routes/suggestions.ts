// Feature A ("What's New" scanner) — dismissal persistence. The scan itself runs
// in the browser (it walks AniList relations directly + TMDB seasons via the
// existing proxy), so the Worker only owns the dismissed-suggestions table:
//   GET  /api/suggestions/dismissed        → { dismissed: ["source:external_id", …] }
//   POST /api/suggestions/dismiss { source, external_id, kind } → 204
// Dismissals are keyed by the same (source, external_id) the scan surfaces, so the
// browser filters candidates by a direct membership test.

import { Hono } from "hono";

import type { AppEnv } from "../env";
import type { AuthVariables } from "../middleware/auth";
import {
  insertDismissedSuggestion,
  listDismissedSuggestionKeys,
} from "../db/media-repository";

export const suggestionsRoutes = new Hono<{
  Bindings: AppEnv;
  Variables: AuthVariables;
}>();

// The sources/kinds the scanner can dismiss — validated so a malformed body
// can't write junk identities into the table.
const DISMISS_SOURCES = new Set(["anilist", "tmdb"]);
const DISMISS_KINDS = new Set(["sequel", "new_season"]);

suggestionsRoutes.get("/dismissed", async (c) => {
  const dismissed = await listDismissedSuggestionKeys(c.env.DB);
  return c.json({ dismissed });
});

suggestionsRoutes.post("/dismiss", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "request body must be valid JSON" }, 400);
  }
  const obj =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  const source = obj.source;
  const externalId = obj.external_id;
  const kind = obj.kind;
  if (typeof source !== "string" || !DISMISS_SOURCES.has(source)) {
    return c.json({ error: "source must be 'anilist' or 'tmdb'" }, 400);
  }
  if (typeof externalId !== "string" || externalId.trim() === "") {
    return c.json({ error: "external_id must be a non-empty string" }, 400);
  }
  if (typeof kind !== "string" || !DISMISS_KINDS.has(kind)) {
    return c.json({ error: "kind must be 'sequel' or 'new_season'" }, 400);
  }

  await insertDismissedSuggestion(c.env.DB, source, externalId.trim(), kind);
  return c.body(null, 204);
});
