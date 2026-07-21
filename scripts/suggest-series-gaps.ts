// Series-gap scan: for every game series already in your library, ask IGDB what
// ELSE is in that series and report the well-rated entries you don't own.
//
// Series are discovered from the GAMES, not from your collection ids. Newer adds
// auto-file into "igdb:collection:<id>" (see igdb-mapper) and those ids are IGDB
// series ids, but most of the library predates that and sits in hand-made or
// backfilled collections — keying on the id scheme would skip nearly all of it.
// So this asks IGDB which series each owned game belongs to (batched), unions
// that with the "igdb:collection:" ids, then walks each series in reverse: list
// its games, subtract what you already have, keep the ones worth your time.
//
// STRICTLY READ-ONLY. It GETs /api/media and queries IGDB; it never PATCHes,
// POSTs or touches the database, and it deliberately has no "add" mode — you add
// what you like through the UI. The output is a Markdown file for you to skim.
//
// What counts as a gap worth surfacing (all tunable):
//   • rating >= --min-rating (default 80/100) AND rating_count >= --min-votes
//     (default 50) — a 95 from 6 voters is noise, not a recommendation
//   • category is a main game / expansion / standalone expansion by default;
//     DLC, packs, bundles, ports, remakes and remasters are dropped as
//     re-listings of something you likely own (--categories to override)
//   • not an alternate EDITION of another entry (version_parent set)
//   • already released (--include-unreleased to see what's coming)
//   • not already in your library under ANY collection, matched on IGDB id
//     (primary source id for IGDB rows, else the igdb_id cross-reference)
//
// Build + run (from repo root):
//   npx esbuild scripts/suggest-series-gaps.ts --bundle --platform=node --format=esm \
//     --outfile=dist/suggest-series-gaps.mjs && node dist/suggest-series-gaps.mjs
// Flags: --out PATH | --base URL | --min-rating N | --min-votes N | --per MS
//        | --categories 0,2,4 | --include-unreleased | --limit N (series cap)
//
// Auth: a Cloudflare Access SERVICE TOKEN (CF_ACCESS_CLIENT_ID/SECRET) to read
// the gated library, plus TWITCH_CLIENT_ID/SECRET for IGDB. The SCRIPT reads
// them from .dev.vars, same as the other scripts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  getIgdbCollectionGames,
  getIgdbGameSeries,
  igdbGameTypeId,
  type IgdbGame,
} from "../src/worker/sources/igdb";
import { fetchAllMedia } from "./lib/fetch-all-media";

// IGDB game categories worth surfacing as a genuine gap: a new main game, an
// expansion, or a standalone expansion. Everything else (DLC 1, bundle 3,
// remake 8, remaster 9, port 10, fork 11, pack 13, update 14) re-packages
// something you probably already have.
const DEFAULT_CATEGORIES = [0, 2, 4];

const CATEGORY_LABEL: Record<number, string> = {
  0: "main game",
  1: "DLC",
  2: "expansion",
  3: "bundle",
  4: "standalone expansion",
  8: "remake",
  9: "remaster",
  10: "port",
  11: "fork",
  13: "pack",
  14: "update",
};

interface Args {
  base: string;
  out: string;
  minRating: number;
  minVotes: number;
  perMs: number;
  categories: number[];
  includeUnreleased: boolean;
  limit: number | null;
}

interface GameRow {
  id: number;
  type: string | null;
  title_english: string | null;
  title_romaji: string | null;
  title_native: string | null;
  title_chinese: string | null;
  external_source: string | null;
  external_id: string | null;
  igdb_id: string | null;
  collection_id: string | null;
}

function parseArgs(argv: string[]): Args {
  // 300ms ≈ 3.3 req/s, just under IGDB's 4 req/s ceiling.
  const a: Args = {
    base: "https://media.zhanghanxue.com",
    out: "dist/series-gaps.md",
    minRating: 80,
    minVotes: 50,
    perMs: 300,
    categories: DEFAULT_CATEGORIES,
    includeUnreleased: false,
    limit: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === "--base") a.base = argv[++i] ?? a.base;
    else if (v === "--out") a.out = argv[++i] ?? a.out;
    else if (v === "--min-rating") a.minRating = Number(argv[++i] ?? a.minRating) || a.minRating;
    else if (v === "--min-votes") a.minVotes = Number(argv[++i] ?? a.minVotes) || a.minVotes;
    else if (v === "--per") a.perMs = Number(argv[++i] ?? a.perMs) || a.perMs;
    else if (v === "--limit") a.limit = Number(argv[++i] ?? "0") || null;
    else if (v === "--include-unreleased") a.includeUnreleased = true;
    else if (v === "--categories") {
      const parsed = (argv[++i] ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
      if (parsed.length) a.categories = parsed;
    }
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

/** A row's IGDB id: its own when IGDB-sourced, else the editor cross-reference. */
function igdbIdOf(row: GameRow): number | null {
  const raw = row.external_source === "igdb" ? row.external_id : row.igdb_id;
  const id = Number(raw);
  return raw && Number.isFinite(id) && id > 0 ? id : null;
}

/** "igdb:collection:1234" → 1234; anything else → null. */
function seriesIdOf(collectionId: string | null): number | null {
  const m = /^igdb:collection:(\d+)$/.exec(collectionId ?? "");
  return m ? Number(m[1]) : null;
}

const year = (unixSeconds: number | null | undefined): string =>
  unixSeconds ? String(new Date(unixSeconds * 1000).getUTCFullYear()) : "TBA";

const kindLabel = (g: IgdbGame): string => {
  const kind = igdbGameTypeId(g);
  return kind === null ? "kind unknown" : (CATEGORY_LABEL[kind] ?? `type ${kind}`);
};

const cjkAlias = (g: IgdbGame): string | null =>
  g.alternative_names?.map((a) => a.name ?? "").find((n) => /[一-鿿]/.test(n)) ?? null;

interface Candidate {
  game: IgdbGame;
  released: boolean;
}

interface SeriesReport {
  seriesId: number;
  name: string;
  owned: string[];
  candidates: Candidate[];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const env = { ...loadDotenv(".dev.vars"), ...process.env };
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(args.base);
  const accessId = env.CF_ACCESS_CLIENT_ID;
  const accessSecret = env.CF_ACCESS_CLIENT_SECRET;
  if (!isLocal && (!accessId || !accessSecret)) {
    console.error(
      "needs CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET (Zero Trust → Service Auth) to read the gated library.",
    );
    process.exitCode = 1;
    return;
  }
  const clientId = env.TWITCH_CLIENT_ID;
  const clientSecret = env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET (IGDB) in .dev.vars.");
    process.exitCode = 1;
    return;
  }
  const creds = { clientId, clientSecret };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessId && accessSecret) {
    headers["CF-Access-Client-Id"] = accessId;
    headers["CF-Access-Client-Secret"] = accessSecret;
  }
  // GET-only by construction: this helper takes no body, so the script cannot
  // write to the library even by accident.
  const request = async (method: string, path: string) => {
    const res = await fetch(args.base + path, {
      method,
      headers,
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
    const json: any = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`${method} ${path} → HTTP ${res.status} ${JSON.stringify(json)}`);
    }
    return { status: res.status, json };
  };

  console.log(`reading library from ${args.base} …`);
  const all = await fetchAllMedia<GameRow>(request, {
    onProgress: (got, total) => process.stdout.write(`\r  ${got}/${total} rows`),
  });
  process.stdout.write("\n");

  const games = all.filter((r) => r.type === "game");
  // Ownership is matched across the WHOLE library, not per series: a game you
  // filed elsewhere (or that never got auto-grouped) must not resurface as a gap.
  const ownedIgdbIds = new Set<number>();
  for (const row of all) {
    const id = igdbIdOf(row);
    if (id !== null) ownedIgdbIds.add(id);
  }

  // Ask IGDB which series each owned game belongs to, in batches — this is what
  // makes the scan cover the whole library rather than only the auto-filed rows.
  const gamesByIgdbId = new Map<number, GameRow>();
  for (const row of games) {
    const id = igdbIdOf(row);
    if (id !== null) gamesByIgdbId.set(id, row);
  }
  const probeIds = [...gamesByIgdbId.keys()];
  const unlinked = games.length - probeIds.length;

  const seriesOwned = new Map<number, GameRow[]>();
  const seriesName = new Map<number, string>();
  const noteOwned = (sid: number, row: GameRow) => {
    const list = seriesOwned.get(sid) ?? [];
    if (!list.includes(row)) list.push(row);
    seriesOwned.set(sid, list);
  };

  const BATCH = 300; // under IGDB's 500-row response ceiling
  for (let i = 0; i < probeIds.length; i += BATCH) {
    const chunk = probeIds.slice(i, i + BATCH);
    process.stdout.write(
      `\r  resolving series ${Math.min(i + BATCH, probeIds.length)}/${probeIds.length} …`,
    );
    const resolved = await getIgdbGameSeries(chunk, creds);
    await sleep(args.perMs);
    for (const g of resolved) {
      const row = gamesByIgdbId.get(g.id);
      if (!row) continue;
      for (const col of g.collections ?? []) {
        noteOwned(col.id, row);
        if (col.name) seriesName.set(col.id, col.name);
      }
    }
  }
  process.stdout.write("\n");

  // Union in the auto-filed collection ids: covers a game IGDB no longer returns
  // (delisted/merged) whose row still carries the series id it was added with.
  for (const row of games) {
    const sid = seriesIdOf(row.collection_id);
    if (sid !== null) noteOwned(sid, row);
  }

  let seriesIds = [...seriesOwned.keys()];
  const totalSeries = seriesIds.length;
  if (args.limit !== null) seriesIds = seriesIds.slice(0, args.limit);
  console.log(
    `${games.length} games → ${totalSeries} IGDB series` +
      (args.limit !== null && totalSeries > seriesIds.length
        ? ` (scanning the first ${seriesIds.length} — --limit)`
        : "") +
      `; ${unlinked} game(s) have no IGDB link (not scannable).`,
  );

  const nowSeconds = Math.floor(Date.now() / 1000);
  const reports: SeriesReport[] = [];
  const failures: string[] = [];

  for (const [i, sid] of seriesIds.entries()) {
    const ownedRows = seriesOwned.get(sid) ?? [];
    const ownedTitles = ownedRows.map(titleOf);
    process.stdout.write(`\r  series ${i + 1}/${seriesIds.length} …`.padEnd(40));
    try {
      const members = await getIgdbCollectionGames(sid, { ...creds, limit: 500 });
      await sleep(args.perMs);

      // Named during series resolution; falls back to an owned title for a
      // series only reachable via a stamped collection id.
      const name =
        seriesName.get(sid) ??
        (ownedTitles[0] ? `${ownedTitles[0]} series` : `Series ${sid}`);

      const candidates: Candidate[] = [];
      for (const g of members) {
        if (ownedIgdbIds.has(g.id)) continue;
        if (g.version_parent) continue; // an edition re-listing, not a release
        const kind = igdbGameTypeId(g);
        // Unknown kind is kept (better a stray remaster than a silently dropped
        // sequel), but it's labelled as such in the report so you can eyeball it.
        if (kind !== null && !args.categories.includes(kind)) continue;
        const released = !!g.first_release_date && g.first_release_date <= nowSeconds;
        if (!released && !args.includeUnreleased) continue;
        if ((g.rating ?? 0) < args.minRating) continue;
        if ((g.rating_count ?? 0) < args.minVotes) continue;
        candidates.push({ game: g, released });
      }
      candidates.sort((a, b) => (b.game.rating ?? 0) - (a.game.rating ?? 0));
      if (candidates.length) {
        reports.push({ seriesId: sid, name, owned: ownedTitles, candidates });
      }
    } catch (err) {
      failures.push(`series ${sid} (${ownedTitles[0] ?? "?"}): ${(err as Error).message}`);
    }
  }
  process.stdout.write("\r".padEnd(42) + "\r");

  // Best series first, so the top of the report is the most worthwhile.
  reports.sort(
    (a, b) => (b.candidates[0]?.game.rating ?? 0) - (a.candidates[0]?.game.rating ?? 0),
  );
  const totalCandidates = reports.reduce((n, r) => n + r.candidates.length, 0);

  const lines: string[] = [
    "# Series gaps — well-rated games missing from your library",
    "",
    `Scanned ${seriesIds.length} game series across ${games.length} games.`,
    `Filters: rating >= ${args.minRating}/100, >= ${args.minVotes} votes, ` +
      `categories [${args.categories.map((c) => CATEGORY_LABEL[c] ?? c).join(", ")}]` +
      `${args.includeUnreleased ? ", unreleased included" : ", released only"}.`,
    "",
    `**${totalCandidates} candidate(s) across ${reports.length} series.**`,
    "",
    "Read-only report — nothing was added. Add what you want through the UI.",
    "",
  ];

  for (const r of reports) {
    lines.push(`## ${r.name}`);
    lines.push("");
    lines.push(`_You have: ${r.owned.join(", ")}_`);
    lines.push("");
    lines.push("| Missing | Year | Rating | Votes | Kind | Platforms |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const { game: g, released } of r.candidates) {
      const alias = cjkAlias(g);
      const title = alias ? `${g.name} (${alias})` : g.name;
      const platforms =
        g.platforms
          ?.map((p) => p.abbreviation ?? p.name ?? "")
          .filter(Boolean)
          .slice(0, 6)
          .join(", ") || "—";
      lines.push(
        `| [${title}](https://www.igdb.com/games/${g.id}) | ${year(g.first_release_date)}` +
          `${released ? "" : " (upcoming)"} | ${Math.round(g.rating ?? 0)} | ${g.rating_count ?? 0}` +
          ` | ${kindLabel(g)} | ${platforms} |`,
      );
    }
    lines.push("");
  }

  if (failures.length) {
    lines.push("## Series that failed to scan", "");
    for (const f of failures) lines.push(`- ${f}`);
    lines.push("");
  }

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, lines.join("\n"), "utf8");

  console.log(`\n${totalCandidates} candidate(s) across ${reports.length} series:`);
  for (const r of reports.slice(0, 10)) {
    const top = r.candidates
      .slice(0, 3)
      .map((c) => `${c.game.name} (${Math.round(c.game.rating ?? 0)})`)
      .join(", ");
    console.log(`  ${r.name}: ${top}${r.candidates.length > 3 ? ", …" : ""}`);
  }
  if (reports.length > 10) console.log(`  … and ${reports.length - 10} more series`);
  if (failures.length) console.log(`${failures.length} series failed to scan (listed in the report).`);
  console.log(`\nwrote ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
