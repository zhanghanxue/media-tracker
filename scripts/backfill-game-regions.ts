// Backfill the `region` column for GAME rows from IGDB's developer country.
// Early adds had only 8 curated regions mapped (everything else → null), so
// e.g. CDPR games got hand-set to usa/uk; the country map is now much wider
// (igdb-mapper.ts § COUNTRY_NUM_TO_REGION) and this re-derives every game's
// region from its IGDB link. DRY-RUN by default: prints every would-be change
// (old → new) plus the games it CAN'T fix — no IGDB link, or IGDB has no
// company country — for manual editing via the editor's region "Other…" field.
//
// Auth: a Cloudflare Access SERVICE TOKEN (CF_ACCESS_CLIENT_ID/SECRET) to reach
// the gated app (not needed for a localhost --base), plus TWITCH_CLIENT_ID/
// SECRET for IGDB. The SCRIPT reads them from .dev.vars, same as the other
// backfills.
//
// Build + run (from repo root):
//   npx esbuild scripts/backfill-game-regions.ts --bundle --platform=node --format=esm \
//     --external:opencc-js --outfile=dist/backfill-game-regions.mjs && node dist/backfill-game-regions.mjs
//   node dist/backfill-game-regions.mjs                 # dry-run: report only
//   node dist/backfill-game-regions.mjs --commit        # apply the changes
// Flags: --commit | --base URL | --limit N | --per MS
//
// Idempotent: a re-run derives the same regions, so already-patched rows show
// up as "already-correct" and nothing is re-written.

import { existsSync, readFileSync } from "node:fs";

import { getIgdbDetail } from "../src/worker/sources/igdb";
import { igdbDeveloperRegion, igdbRegion } from "../src/worker/sources/igdb-mapper";

interface GameRow {
  id: number;
  type: string;
  region: string | null;
  external_source: string | null;
  external_id: string | null;
  igdb_id: string | null;
  title_english: string | null;
  title_romaji: string | null;
  title_native: string | null;
  title_chinese: string | null;
}

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const titleOf = (r: GameRow) =>
  r.title_english ?? r.title_romaji ?? r.title_native ?? r.title_chinese ?? `#${r.id}`;

// A game's IGDB id: its primary source id when IGDB-sourced, else the igdb_id
// cross-reference set in the editor. Null = no IGDB link at all.
function igdbIdOf(row: GameRow): number | null {
  const raw = row.external_source === "igdb" ? row.external_id : row.igdb_id;
  const id = Number(raw);
  return raw && Number.isFinite(id) && id > 0 ? id : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const env = { ...loadDotenv(".dev.vars"), ...process.env };
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(args.base);
  const id = env.CF_ACCESS_CLIENT_ID;
  const secret = env.CF_ACCESS_CLIENT_SECRET;
  if (!isLocal && (!id || !secret)) {
    console.error(
      "needs CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET (Zero Trust → Service Auth) to reach the gated library.",
    );
    process.exitCode = 1;
    return;
  }
  const twitchId = env.TWITCH_CLIENT_ID;
  const twitchSecret = env.TWITCH_CLIENT_SECRET;
  if (!twitchId || !twitchSecret) {
    console.error("needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET (IGDB) in .dev.vars.");
    process.exitCode = 1;
    return;
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (id && secret) {
    headers["CF-Access-Client-Id"] = id;
    headers["CF-Access-Client-Secret"] = secret;
  }
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
    if (!res.ok) {
      throw new Error(`${method} ${path} → HTTP ${res.status} ${JSON.stringify(json)}`);
    }
    return { status: res.status, json };
  };

  // Pull the whole library and keep the games.
  const { json: page } = await request("GET", "/api/media?limit=5000");
  const games = ((page?.items ?? []) as GameRow[]).filter((r) => r.type === "game");
  console.error(`library: ${page?.items?.length ?? 0} rows, ${games.length} games`);

  const linked = games.filter((g) => igdbIdOf(g) !== null);
  const noLink = games.filter((g) => igdbIdOf(g) === null);
  const scoped = args.limit ? linked.slice(0, args.limit) : linked;
  console.error(`${linked.length} have an IGDB link, ${noLink.length} don't (manual).`);
  console.error(`checking ${scoped.length} against IGDB (throttle ${args.perMs}ms)…\n`);

  const changes: { row: GameRow; to: string }[] = [];
  const publisherOnly: { row: GameRow; suggests: string }[] = [];
  const noCountry: GameRow[] = [];
  const errors: GameRow[] = [];
  let alreadyCorrect = 0;

  for (let i = 0; i < scoped.length; i += 1) {
    const row = scoped[i]!;
    try {
      const game = await getIgdbDetail(igdbIdOf(row)!, {
        clientId: twitchId,
        clientSecret: twitchSecret,
      });
      // The DEVELOPER's country may overwrite a set region; a publisher-derived
      // one is a weak signal (miHoYo publishes via a Singapore entity) and may
      // only fill blanks — a differing set value is reported, not changed.
      const devRegion = game ? igdbDeveloperRegion(game) : null;
      const anyRegion = game ? igdbRegion(game) : null;
      const derived = devRegion ?? (row.region ? null : anyRegion);
      if (derived && derived !== row.region) changes.push({ row, to: derived });
      else if (derived) alreadyCorrect += 1;
      else if (anyRegion && anyRegion !== row.region) {
        publisherOnly.push({ row, suggests: anyRegion });
      } else if (anyRegion) alreadyCorrect += 1;
      else noCountry.push(row);
    } catch {
      errors.push(row);
    }
    if ((i + 1) % 10 === 0 || i + 1 === scoped.length) {
      process.stderr.write(`  ${i + 1}/${scoped.length}\r`);
    }
    await sleep(args.perMs);
  }

  console.error(`\nalready correct: ${alreadyCorrect}`);
  if (changes.length) {
    console.error(`\nregion changes (${changes.length}):`);
    for (const { row, to } of changes) {
      console.error(`  ${titleOf(row)}: ${row.region ?? "—"} → ${to}`);
    }
  }
  if (publisherOnly.length) {
    console.error(
      `\nleft as-is — only the PUBLISHER's country differs, review by hand (${publisherOnly.length}):`,
    );
    for (const { row, suggests } of publisherOnly) {
      console.error(`  ${titleOf(row)}: keeps ${row.region ?? "—"} (publisher suggests ${suggests})`);
    }
  }
  if (noCountry.length) {
    console.error(`\nIGDB has no company country — set by hand (${noCountry.length}):`);
    for (const row of noCountry) {
      console.error(`  ${titleOf(row)} (currently ${row.region ?? "—"})`);
    }
  }
  if (noLink.length) {
    console.error(`\nno IGDB link — set by hand (${noLink.length}):`);
    for (const row of noLink) {
      console.error(`  ${titleOf(row)} (currently ${row.region ?? "—"}, source ${row.external_source ?? "manual"})`);
    }
  }
  if (errors.length) {
    console.error(`\nIGDB fetch errored (${errors.length}) — re-run to retry:`);
    for (const row of errors) console.error(`  ${titleOf(row)}`);
  }

  if (!args.commit) {
    console.error(
      `\nDRY-RUN — nothing written. Re-run with --commit to apply the ${changes.length} change(s).`,
    );
    return;
  }

  console.error(`\nCOMMIT → ${args.base} …`);
  let patched = 0;
  for (const { row, to } of changes) {
    try {
      await request("PATCH", `/api/media/${row.id}`, { region: to });
      patched += 1;
    } catch (e) {
      console.error(`  PATCH failed for ${titleOf(row)}: ${(e as Error).message}`);
    }
    await sleep(150);
  }
  console.error(`patched ${patched}/${changes.length}. done.`);
}

await main();
