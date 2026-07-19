// Backfill `title_english` for TMDB movies/dramas added before the mapper fell
// back to the base (en-US) title — English-origin titles carry no `en` entry in
// TMDB's `translations`, so those rows imported with a null English title.
//
// Re-fetches each row's TMDB detail and re-runs the SAME add-time mapper
// (tmdbToMediaRow / tmdbSeasonToMediaRow) so the backfilled English title is
// IDENTICAL to what a fresh add would produce — including the season-composed
// "{show} {season}" form. Only touches TMDB rows whose title_english is empty
// (never clobbers a manual edit). DRY-RUN by default; --commit writes.
//
// Auth: a Cloudflare Access SERVICE TOKEN (reads the gated library + PATCHes).
// TMDB key is read by the SCRIPT from .dev.vars (the assistant never reads it).
//
// Build + run (from repo root):
//   npx esbuild scripts/backfill-tmdb-titles.ts --bundle --platform=node --format=esm \
//     --external:opencc-js --outfile=dist/backfill-tmdb-titles.mjs && node dist/backfill-tmdb-titles.mjs
//   node dist/backfill-tmdb-titles.mjs --commit --limit 10
//   node dist/backfill-tmdb-titles.mjs --commit
// Flags: --commit | --base URL | --limit N | --per MS

import { existsSync, readFileSync } from "node:fs";

import { getTmdbDetail, getTmdbSeason, type TmdbDetail } from "../src/worker/sources/tmdb";
import { tmdbToMediaRow, tmdbSeasonToMediaRow } from "../src/worker/sources/tmdb-mapper";
import { fetchAllMedia } from "./lib/fetch-all-media";

interface Args {
  base: string;
  limit: number | null;
  perMs: number;
  commit: boolean;
}

interface LibRow {
  id: number;
  external_source: string | null;
  external_id: string | null;
  title_english: string | null;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    base: "https://media.zhanghanxue.com",
    limit: null,
    perMs: 120,
    commit: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === "--commit") a.commit = true;
    else if (v === "--base") a.base = argv[++i] ?? a.base;
    else if (v === "--limit") a.limit = Number(argv[++i] ?? "0") || null;
    else if (v === "--per") a.perMs = Number(argv[++i] ?? a.perMs) || a.perMs;
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

// Parse a TMDB external_id → the work to fetch. "movie:603" | "tv:123" | "tv:123:s2".
type Ref =
  | { kind: "movie"; id: number }
  | { kind: "tv"; id: number }
  | { kind: "season"; id: number; season: number };

function parseRef(externalId: string): Ref | null {
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

/** Re-derive a row's English title using the exact add-time mapper. */
async function englishTitleFor(ref: Ref, apiKey: string): Promise<string | null> {
  const opts = { apiKey };
  if (ref.kind === "movie") {
    const d = await getTmdbDetail(ref.id, "movie", opts);
    return d ? tmdbToMediaRow(d, "movie", "planned").title_english : null;
  }
  if (ref.kind === "tv") {
    const d = await getTmdbDetail(ref.id, "tv", opts);
    return d ? tmdbToMediaRow(d, "tv", "planned").title_english : null;
  }
  // season row → recompose "{show} {season}" via the season mapper
  const show: TmdbDetail | null = await getTmdbDetail(ref.id, "tv", opts);
  if (!show) return null;
  const summary = (show.seasons ?? []).find((s) => s.season_number === ref.season);
  if (!summary) return null;
  const season = await getTmdbSeason(ref.id, ref.season, opts);
  return tmdbSeasonToMediaRow(show, summary, season, "planned").title_english;
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
  const apiKey = env.TMDB_API_KEY;
  if (!apiKey) {
    console.error("needs TMDB_API_KEY in .dev.vars to fetch detail.");
    process.exitCode = 1;
    return;
  }

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

  const all = await fetchAllMedia<LibRow>(request);
  let pending = all.filter(
    (r) =>
      r.external_source === "tmdb" &&
      !!r.external_id &&
      (r.title_english === null || r.title_english === ""),
  );
  console.error(`library: ${all.length} rows, ${pending.length} TMDB rows missing title_english`);
  console.error("missing by kind:", tally(pending, (r) => parseRef(r.external_id!)?.kind ?? "?"));

  if (args.limit) pending = pending.slice(0, args.limit);

  if (!args.commit) {
    console.error(`\nDRY-RUN — nothing written. ${pending.length} rows would be re-fetched + patched.`);
    console.error("Re-run with --commit to fill in the English titles.");
    return;
  }

  console.error(`\nCOMMIT → ${args.base} (throttle ${args.perMs}ms) …`);
  const outcomes: string[] = [];
  for (let i = 0; i < pending.length; i += 1) {
    const row = pending[i]!;
    let outcome = "skipped";
    try {
      const ref = parseRef(row.external_id!);
      const title = ref ? await englishTitleFor(ref, apiKey) : null;
      if (title) {
        await request("PATCH", `/api/media/${row.id}`, { title_english: title });
        outcome = "patched";
      } else {
        outcome = "no-title";
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
