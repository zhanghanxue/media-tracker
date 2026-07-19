// Backfill the `genres` column for existing library rows (added before genres
// were stored). Reads the LIVE library, re-fetches each row's source detail for
// its genres, and PATCHes them back. DRY-RUN by default (counts what needs
// backfilling, writes nothing); --commit does the fetch + PATCH.
//
// Auth: a Cloudflare Access SERVICE TOKEN (CF_ACCESS_CLIENT_ID/SECRET) is needed
// to reach the gated app — for BOTH dry-run (it reads the library) and commit.
// TMDB/IGDB detail also needs their keys; the SCRIPT reads them from .dev.vars
// (the assistant never does), same as the import runner.
//
// Build + run (from repo root):
//   npx esbuild scripts/backfill-genres.ts --bundle --platform=node --format=esm \
//     --external:opencc-js --outfile=dist/backfill-genres.mjs && node dist/backfill-genres.mjs
//   node dist/backfill-genres.mjs --commit --limit 10   # careful sample
//   node dist/backfill-genres.mjs --commit              # all rows missing genres
// Flags: --commit | --base URL | --limit N | --per MS
//
// Idempotent: rows that already have genres are skipped, so a re-run is safe and
// resumes where a previous run left off.

import { existsSync, readFileSync } from "node:fs";

import {
import { fetchAllMedia } from "./lib/fetch-all-media";
  encodeGenres,
  fetchGenresFor,
  needsGenres,
  type GenreCreds,
  type LibRow,
} from "./import/genres";

interface Args {
  base: string;
  limit: number | null;
  perMs: number;
  commit: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    base: "https://media.zhanghanxue.com",
    limit: null,
    perMs: 350,
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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const env = { ...loadDotenv(".dev.vars"), ...process.env };
  const id = env.CF_ACCESS_CLIENT_ID;
  const secret = env.CF_ACCESS_CLIENT_SECRET;
  if (!id || !secret) {
    console.error(
      "needs CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET (Zero Trust → Service Auth) to read the gated library.",
    );
    process.exitCode = 1;
    return;
  }
  const creds: GenreCreds = {
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
      redirect: "manual", // don't follow the Access login redirect (would look like 200)
    });
    if (res.status >= 300 && res.status < 400) {
      throw new Error(
        `Access redirect (HTTP ${res.status}) — the service token isn't accepted. Add it to the media-tracker app's Access policy (Action: Service Auth, Include: Service Token).`,
      );
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      throw new Error(
        `non-JSON response (HTTP ${res.status}) from ${path} — likely the Access login page; check the service token + policy.`,
      );
    }
    const json = await res.json().catch(() => null);
    if (!res.ok && res.status !== 409) {
      throw new Error(`${method} ${path} → HTTP ${res.status} ${JSON.stringify(json)}`);
    }
    return { status: res.status, json };
  };

  // Preflight: fail fast with a clear diagnosis before doing any work.
  try {
    const health = await request("GET", "/api/health");
    console.error(`auth OK (as ${health.json?.user ?? "service-token"})`);
  } catch (e) {
    console.error(`\nauth preflight failed: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  // Pull the whole library (the raised MAX_LIMIT lets one page hold it).
  const all = await fetchAllMedia<LibRow>(request);
  let pending = all.filter(needsGenres);
  console.error(`library: ${all.length} rows, ${pending.length} missing genres`);
  console.error("missing by source:", tally(pending, (r) => r.external_source ?? "?"));
  console.error("missing by type:", tally(pending, (r) => r.type));

  if (args.limit) pending = pending.slice(0, args.limit);

  if (!args.commit) {
    console.error(
      `\nDRY-RUN — nothing written. ${pending.length} rows would be re-fetched + patched.`,
    );
    console.error("Re-run with --commit to fetch each source's genres and store them.");
    return;
  }

  console.error(`\nCOMMIT → ${args.base} (throttle ${args.perMs}ms) …`);
  const outcomes: string[] = [];
  for (let i = 0; i < pending.length; i += 1) {
    const row = pending[i]!;
    let outcome = "skipped";
    try {
      const genres = await fetchGenresFor(row, creds);
      const encoded = encodeGenres(genres);
      if (encoded) {
        await request("PATCH", `/api/media/${row.id}`, { genres: encoded });
        outcome = "patched";
      } else {
        outcome = "no-genres"; // source returned nothing usable; leave NULL
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
  console.error(errs ? `${errs} errored — re-run is safe (already-patched rows are skipped).` : "done.");
}

await main();
