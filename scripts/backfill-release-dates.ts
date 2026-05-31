// Backfill `release_date` for rows added before the mappers derived it. For each
// row whose release_date is still empty, re-fetch its source detail and re-run
// the SAME add-time mapper, so the backfilled date is IDENTICAL to what a fresh
// add would produce. Covers all four sources:
//   • anilist — getAniListDetail (works here: AniList blocks the WORKER's egress
//     IPs, but this script runs on your machine, so it can call AniList directly)
//   • bangumi — getBangumiSubject (v0 detail; `date`)
//   • tmdb    — getTmdbDetail / getTmdbSeason (needs TMDB_API_KEY)
//   • igdb    — getIgdbDetail (needs TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET)
// Only touches rows with a NULL/empty release_date (never clobbers a manual
// edit). DRY-RUN by default; --commit writes via PATCH /api/media/:id.
//
// Auth: a Cloudflare Access SERVICE TOKEN (reads the gated library + PATCHes).
// Source keys are read by the SCRIPT from .dev.vars (the assistant never reads them).
//
// Build + run (from repo root):
//   npx esbuild scripts/backfill-release-dates.ts --bundle --platform=node --format=esm \
//     --external:opencc-js --outfile=dist/backfill-release-dates.mjs && node dist/backfill-release-dates.mjs
//   node dist/backfill-release-dates.mjs --commit --limit 10
//   node dist/backfill-release-dates.mjs --commit
// Flags: --commit | --base URL | --limit N | --per MS | --source anilist|bangumi|tmdb|igdb

import { existsSync, readFileSync } from "node:fs";

import { getAniListDetail } from "../src/worker/sources/anilist";
import { aniListToMediaRow } from "../src/worker/sources/anilist-mapper";
import { getBangumiSubject } from "../src/worker/sources/bangumi";
import { bangumiToMediaRow } from "../src/worker/sources/bangumi-mapper";
import { getIgdbDetail } from "../src/worker/sources/igdb";
import { igdbToMediaRow } from "../src/worker/sources/igdb-mapper";
import {
  getTmdbDetail,
  getTmdbSeason,
  type TmdbDetail,
} from "../src/worker/sources/tmdb";
import {
  tmdbToMediaRow,
  tmdbSeasonToMediaRow,
} from "../src/worker/sources/tmdb-mapper";

type Source = "anilist" | "bangumi" | "tmdb" | "igdb";

interface Args {
  base: string;
  limit: number | null;
  perMs: number;
  commit: boolean;
  source: Source | null;
}

interface LibRow {
  id: number;
  type: string | null;
  external_source: string | null;
  external_id: string | null;
  release_date: string | null;
}

function parseArgs(argv: string[]): Args {
  // 700ms default: AniList (~90 req/min) and Bangumi both rate-limit; a one-time
  // backfill favors completing over speed. Lower with --per for TMDB/IGDB-only runs.
  const a: Args = {
    base: "https://media.zhanghanxue.com",
    limit: null,
    perMs: 700,
    commit: false,
    source: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === "--commit") a.commit = true;
    else if (v === "--base") a.base = argv[++i] ?? a.base;
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

/** Re-derive a row's release_date via the exact add-time mapper. Returns null
 *  when the source has no usable date (or the source can't be reached/configured). */
async function releaseDateFor(row: LibRow, keys: Keys): Promise<string | null> {
  const extId = row.external_id!;
  switch (row.external_source) {
    case "anilist": {
      const detail = await getAniListDetail(Number(extId), aniListType(row.type));
      return detail ? aniListToMediaRow(detail, "planned").release_date : null;
    }
    case "bangumi": {
      const subject = await getBangumiSubject(Number(extId));
      return subject ? bangumiToMediaRow(subject, "planned").release_date : null;
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
          }).release_date
        : null;
    }
    case "tmdb": {
      if (!keys.tmdbApiKey) return null;
      const ref = parseTmdbRef(extId);
      if (!ref) return null;
      const opts = { apiKey: keys.tmdbApiKey };
      if (ref.kind === "movie") {
        const d = await getTmdbDetail(ref.id, "movie", opts);
        return d ? tmdbToMediaRow(d, "movie", "planned").release_date : null;
      }
      if (ref.kind === "tv") {
        const d = await getTmdbDetail(ref.id, "tv", opts);
        return d ? tmdbToMediaRow(d, "tv", "planned").release_date : null;
      }
      // season row → recompose via the season mapper (season air_date)
      const show = await getTmdbDetail(ref.id, "tv", opts);
      if (!show) return null;
      const summary = (show.seasons ?? []).find((s) => s.season_number === ref.season);
      if (!summary) return null;
      const season = await getTmdbSeason(ref.id, ref.season, opts);
      return tmdbSeasonToMediaRow(show, summary, season, "planned").release_date;
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
  const request = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(args.base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
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
    if (!res.ok && res.status !== 409) {
      throw new Error(`${method} ${path} → HTTP ${res.status} ${JSON.stringify(json)}`);
    }
    return { status: res.status, json };
  };

  try {
    const health = await request("GET", "/api/health");
    console.error(`auth OK (as ${health.json?.user ?? "service-token"})`);
  } catch (e) {
    console.error(`\nauth preflight failed: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const { json: page } = await request("GET", "/api/media?limit=5000");
  const all = (page?.items ?? []) as LibRow[];
  let pending = all.filter(
    (r) =>
      !!r.external_source &&
      !!r.external_id &&
      (r.release_date === null || r.release_date === "") &&
      (args.source === null || r.external_source === args.source),
  );
  console.error(`library: ${all.length} rows, ${pending.length} missing release_date`);
  console.error("missing by source:", tally(pending, (r) => r.external_source ?? "?"));
  if (!keys.tmdbApiKey) console.error("note: TMDB_API_KEY absent → tmdb rows will be skipped.");
  if (!keys.twitchId || !keys.twitchSecret) {
    console.error("note: TWITCH_CLIENT_ID/SECRET absent → igdb rows will be skipped.");
  }

  if (args.limit) pending = pending.slice(0, args.limit);

  if (!args.commit) {
    console.error(`\nDRY-RUN — nothing written. ${pending.length} rows would be re-fetched + patched.`);
    console.error("Re-run with --commit to fill in the release dates.");
    return;
  }

  console.error(`\nCOMMIT → ${args.base} (throttle ${args.perMs}ms) …`);
  const outcomes: string[] = [];
  for (let i = 0; i < pending.length; i += 1) {
    const row = pending[i]!;
    let outcome = "skipped";
    try {
      const date = await releaseDateFor(row, keys);
      if (date) {
        await request("PATCH", `/api/media/${row.id}`, { release_date: date });
        outcome = "patched";
      } else {
        outcome = "no-date";
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
  console.error("\n\noutcomes:", tally(outcomes, (o) => o));
  const errs = outcomes.filter((o) => o === "error").length;
  console.error(errs ? `${errs} errored — re-run is safe (already-filled rows are skipped).` : "done.");
}

await main();
