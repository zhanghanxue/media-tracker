// Backfill `source_rating` (migration 0009) for rows added before the mappers
// derived it. For each row whose source_rating is still NULL, re-fetch its source
// detail and re-run the SAME add-time mapper, so the backfilled rating is
// IDENTICAL to what a fresh add would now produce. Covers all four sources:
//   • anilist — getAniListDetail (works here: AniList blocks the WORKER's egress
//     IPs, but this script runs on your machine, so it can call AniList directly)
//   • bangumi — getBangumiSubject (v0 detail; rating.score, 0–10)
//   • tmdb    — getTmdbDetail / getTmdbSeason (vote_average, 0–10; needs TMDB_API_KEY)
//   • igdb    — getIgdbDetail (rating, 0–100; needs TWITCH_CLIENT_ID / _SECRET)
//
// WHY THIS ONE EMITS SQL INSTEAD OF PATCHing (unlike backfill-release-dates.ts):
// `source_rating` is intentionally NOT a PATCHable field — there is no user-rating
// surface, so the write API won't accept it. So this script is READ-ONLY against
// your library and the sources: it NEVER touches the database. It writes a
// reviewable .sql file of idempotent UPDATEs; YOU inspect it, then apply it with
// wrangler. Nothing is mutated until you run that wrangler command yourself.
//
// Each statement is `UPDATE media SET source_rating = <v> WHERE id = <id> AND
// source_rating IS NULL;` — so re-applying is safe and it never clobbers a value
// that's already set. Rows whose source has no score are left NULL (sort last).
//
// Build + run (from repo root):
//   npx esbuild scripts/backfill-source-ratings.ts --bundle --platform=node --format=esm \
//     --external:opencc-js --outfile=dist/backfill-source-ratings.mjs && node dist/backfill-source-ratings.mjs
// Then REVIEW the emitted file and apply it yourself:
//   wrangler d1 execute media-tracker-db --remote --file=dist/backfill-source-ratings.sql
//   (use --local to target the local dev DB instead of prod)
// Flags: --out PATH | --base URL | --limit N | --per MS | --source anilist|bangumi|tmdb|igdb
//
// Auth: a Cloudflare Access SERVICE TOKEN (reads the gated library only — no write
// scope is used). Source keys are read by the SCRIPT from .dev.vars.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { getAniListDetail } from "../src/worker/sources/anilist";
import { aniListToMediaRow } from "../src/worker/sources/anilist-mapper";
import { getBangumiSubject } from "../src/worker/sources/bangumi";
import { bangumiToMediaRow } from "../src/worker/sources/bangumi-mapper";
import { getIgdbDetail } from "../src/worker/sources/igdb";
import { igdbToMediaRow } from "../src/worker/sources/igdb-mapper";
import { getTmdbDetail, getTmdbSeason } from "../src/worker/sources/tmdb";
import {
  tmdbToMediaRow,
  tmdbSeasonToMediaRow,
} from "../src/worker/sources/tmdb-mapper";

type Source = "anilist" | "bangumi" | "tmdb" | "igdb";

interface Args {
  base: string;
  out: string;
  limit: number | null;
  perMs: number;
  source: Source | null;
}

interface LibRow {
  id: number;
  type: string | null;
  external_source: string | null;
  external_id: string | null;
  source_rating: number | null;
}

function parseArgs(argv: string[]): Args {
  // 700ms default: AniList (~90 req/min) and Bangumi both rate-limit; a one-time
  // backfill favors completing over speed. Lower with --per for TMDB/IGDB-only runs.
  const a: Args = {
    base: "https://media.zhanghanxue.com",
    out: "dist/backfill-source-ratings.sql",
    limit: null,
    perMs: 700,
    source: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === "--base") a.base = argv[++i] ?? a.base;
    else if (v === "--out") a.out = argv[++i] ?? a.out;
    else if (v === "--limit") a.limit = Number(argv[++i] ?? "0") || null;
    else if (v === "--per") a.perMs = Number(argv[++i] ?? a.perMs) || a.perMs;
    else if (v === "--source") a.source = (argv[++i] ?? null) as Source | null;
  }
  return a;
}

function loadDotenv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = val;
  }
  return out;
}

function tally<T>(xs: T[], key: (x: T) => string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of xs) m[key(x)] = (m[key(x)] ?? 0) + 1;
  return m;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A row's `type` → the AniList MediaType to query (manga/light_novel are books).
function aniListType(rowType: string | null): "ANIME" | "MANGA" {
  return rowType === "manga" || rowType === "light_novel" ? "MANGA" : "ANIME";
}

// TMDB external_id → the work to fetch: "movie:603" | "tv:123" | "tv:123:s2".
type TmdbRef =
  | { kind: "movie"; id: number }
  | { kind: "tv"; id: number }
  | { kind: "season"; id: number; season: number };

function parseTmdbRef(externalId: string): TmdbRef | null {
  const p = externalId.split(":");
  const id = Number(p[1]);
  if (!Number.isFinite(id)) return null;
  if (p[0] === "movie") return { kind: "movie", id };
  if (p[0] === "tv") {
    if (p[2]?.startsWith("s")) {
      const season = Number(p[2].slice(1));
      if (Number.isFinite(season)) return { kind: "season", id, season };
    }
    return { kind: "tv", id };
  }
  return null;
}

interface Keys {
  tmdbApiKey?: string;
  twitchId?: string;
  twitchSecret?: string;
}

/** Re-derive a row's source_rating via the exact add-time mapper. Returns null
 *  when the source has no score (or the source can't be reached/configured). */
async function sourceRatingFor(row: LibRow, keys: Keys): Promise<number | null> {
  const extId = row.external_id!;
  switch (row.external_source) {
    case "anilist": {
      const detail = await getAniListDetail(Number(extId), aniListType(row.type));
      return detail ? aniListToMediaRow(detail, "planned").source_rating : null;
    }
    case "bangumi": {
      const subject = await getBangumiSubject(Number(extId));
      return subject ? bangumiToMediaRow(subject, "planned").source_rating : null;
    }
    case "igdb": {
      if (!keys.twitchId || !keys.twitchSecret) return null;
      const game = await getIgdbDetail(Number(extId), {
        clientId: keys.twitchId,
        clientSecret: keys.twitchSecret,
      });
      return game
        ? igdbToMediaRow(game, {
            status: "planned",
            consumptionMode: "playing",
            platform: null,
          }).source_rating
        : null;
    }
    case "tmdb": {
      if (!keys.tmdbApiKey) return null;
      const ref = parseTmdbRef(extId);
      if (!ref) return null;
      const opts = { apiKey: keys.tmdbApiKey };
      if (ref.kind === "movie") {
        const d = await getTmdbDetail(ref.id, "movie", opts);
        return d ? tmdbToMediaRow(d, "movie", "planned").source_rating : null;
      }
      if (ref.kind === "tv") {
        const d = await getTmdbDetail(ref.id, "tv", opts);
        return d ? tmdbToMediaRow(d, "tv", "planned").source_rating : null;
      }
      // season row → recompose via the season mapper (carries the show's rating)
      const show = await getTmdbDetail(ref.id, "tv", opts);
      if (!show) return null;
      const summary = (show.seasons ?? []).find((s) => s.season_number === ref.season);
      if (!summary) return null;
      const season = await getTmdbSeason(ref.id, ref.season, opts);
      return tmdbSeasonToMediaRow(show, summary, season, "planned").source_rating;
    }
    default:
      return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...loadDotenv(".dev.vars"), ...process.env };
  const id = env.CF_ACCESS_CLIENT_ID;
  const secret = env.CF_ACCESS_CLIENT_SECRET;
  if (!id || !secret) {
    console.error("needs CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET (Zero Trust → Service Auth).");
    process.exitCode = 1;
    return;
  }
  const keys: Keys = {
    tmdbApiKey: env.TMDB_API_KEY,
    twitchId: env.TWITCH_CLIENT_ID,
    twitchSecret: env.TWITCH_CLIENT_SECRET,
  };

  const headers = {
    "Content-Type": "application/json",
    "CF-Access-Client-Id": id,
    "CF-Access-Client-Secret": secret,
  };
  // READ-ONLY: this script only ever issues GETs. It writes a .sql file; it never
  // PATCHes/POSTs to the library.
  const get = async (path: string) => {
    const res = await fetch(args.base + path, { method: "GET", headers, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      throw new Error(
        `Access redirect (HTTP ${res.status}) — service token not accepted (add it to the app's Access policy).`,
      );
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      throw new Error(`non-JSON response (HTTP ${res.status}) from ${path} — likely the Access login page.`);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status} ${JSON.stringify(json)}`);
    return json;
  };

  try {
    const health = await get("/api/health");
    console.error(`auth OK (as ${health?.user ?? "service-token"})`);
  } catch (e) {
    console.error(`\nauth preflight failed: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const page = await get("/api/media?limit=5000");
  const all = (page?.items ?? []) as LibRow[];
  let pending = all.filter(
    (r) =>
      !!r.external_source &&
      !!r.external_id &&
      (r.source_rating === null || r.source_rating === undefined) &&
      (args.source === null || r.external_source === args.source),
  );
  console.error(`library: ${all.length} rows, ${pending.length} missing source_rating`);
  console.error("missing by source:", tally(pending, (r) => r.external_source ?? "?"));
  if (!keys.tmdbApiKey) console.error("note: TMDB_API_KEY absent → tmdb rows will be skipped.");
  if (!keys.twitchId || !keys.twitchSecret) {
    console.error("note: TWITCH_CLIENT_ID/SECRET absent → igdb rows will be skipped.");
  }

  if (args.limit) pending = pending.slice(0, args.limit);

  console.error(`\nfetching scores (throttle ${args.perMs}ms) — READ-ONLY, no DB writes …`);
  const stmts: string[] = [];
  const outcomes: string[] = [];
  for (let i = 0; i < pending.length; i += 1) {
    const row = pending[i]!;
    let outcome = "skipped";
    try {
      const rating = await sourceRatingFor(row, keys);
      if (rating !== null && Number.isFinite(rating)) {
        // Idempotent + non-clobbering: the AND guard means re-applying is safe and
        // a row that already has a rating is never overwritten. id is a trusted
        // integer from our own DB; rating is a bounded number — no injection risk.
        stmts.push(
          `UPDATE media SET source_rating = ${rating} WHERE id = ${row.id} AND source_rating IS NULL;`,
        );
        outcome = "rated";
      } else {
        outcome = "no-score";
      }
    } catch {
      outcome = "error";
    }
    outcomes.push(outcome);
    if ((i + 1) % 10 === 0 || i + 1 === pending.length) {
      process.stderr.write(`  ${i + 1}/${pending.length}\r`);
    }
    await sleep(args.perMs);
  }

  const header = [
    "-- Backfill source_rating (migration 0009). Generated by",
    "-- scripts/backfill-source-ratings.ts — REVIEW before applying.",
    `-- ${stmts.length} UPDATE(s); each is idempotent (… AND source_rating IS NULL).`,
    "-- Apply (prod):  wrangler d1 execute media-tracker-db --remote --file=" + args.out,
    "-- Apply (local): wrangler d1 execute media-tracker-db --local  --file=" + args.out,
    "",
  ].join("\n");
  writeFileSync(args.out, header + stmts.join("\n") + (stmts.length ? "\n" : ""), "utf8");

  console.error("\n\noutcomes:", tally(outcomes, (o) => o));
  console.error(`\nwrote ${stmts.length} UPDATE(s) → ${args.out}`);
  console.error("REVIEW that file, then apply it yourself:");
  console.error(`  wrangler d1 execute media-tracker-db --remote --file=${args.out}`);
  const errs = outcomes.filter((o) => o === "error").length;
  if (errs) console.error(`(${errs} rows errored while fetching — re-running is safe; the SQL is non-clobbering.)`);
}

await main();
