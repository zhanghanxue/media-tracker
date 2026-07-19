// Backfill franchise COLLECTIONS for existing loose movies + games.
//
// Auto-grouping (TMDB `belongs_to_collection` → "tmdb:collection:<id>", IGDB
// `collections[0]` → "igdb:collection:<id>") only runs at ADD time, so every
// film/game added before it shipped sits loose. This re-derives the franchise
// for each ungrouped movie/game and files them into the SAME deterministic
// collection ids a fresh add would produce — so a future "Rocky V" add joins
// the group this script created instead of splitting off a second one.
//
// Only rows with `collection_id IS NULL` are touched: an item you grouped by
// hand is never moved, and neither is anything already auto-grouped.
//
// A franchise is only created when it has **≥2 loose members in the library**
// (or when the group already exists, e.g. a recent add made it — then a lone
// straggler joins it). A one-film "collection" is noise, not grouping.
//
// REQUIRES the target Worker to support explicit source-derived ids on
// POST /api/collections (added on this branch). An older deployment ignores the
// `id` and mints a col:<uuid>, which would scatter each franchise into a
// throwaway group — so --commit probes the first create, undoes it, and aborts
// if the target is behind. Deploy first, then backfill.
//
// Auth: a Cloudflare Access SERVICE TOKEN (CF_ACCESS_CLIENT_ID/SECRET) to reach
// the gated app (not needed for a localhost --base), plus TMDB_API_KEY and
// TWITCH_CLIENT_ID/SECRET for the metadata lookups. Read from .dev.vars, same
// as the other backfills.
//
// Build + run (from repo root):
//   npx esbuild scripts/backfill-collections.ts --bundle --platform=node --format=esm \
//     --external:opencc-js --outfile=dist/backfill-collections.mjs && node dist/backfill-collections.mjs
//   node dist/backfill-collections.mjs                  # dry-run: report only
//   node dist/backfill-collections.mjs --commit         # apply
// Flags: --commit | --base URL | --limit N | --per MS | --movies-only | --games-only
//
// Idempotent: a re-run re-derives the same ids, finds the rows already grouped,
// and reports them as already-correct. Safe to run repeatedly.

import { existsSync, readFileSync } from "node:fs";

import { getTmdbCollectionName, getTmdbDetail } from "../src/worker/sources/tmdb";
import { getIgdbDetail } from "../src/worker/sources/igdb";
import {
  igdbIdOf,
  partitionGroups,
  selectCandidates,
  tmdbMovieIdOf,
  type PlanRow,
} from "./backfill/franchise-plan";
import { fetchAllMedia } from "./lib/fetch-all-media";

interface Row extends PlanRow {
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
  moviesOnly: boolean;
  gamesOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    base: "https://media.zhanghanxue.com",
    limit: null,
    perMs: 350,
    commit: false,
    moviesOnly: false,
    gamesOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === "--commit") a.commit = true;
    else if (v === "--movies-only") a.moviesOnly = true;
    else if (v === "--games-only") a.gamesOnly = true;
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
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = val;
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const titleOf = (r: Row) =>
  r.title_english ??
  r.title_romaji ??
  r.title_native ??
  r.title_chinese ??
  `#${r.id}`;

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
  const tmdbKey = env.TMDB_API_KEY;
  const twitchId = env.TWITCH_CLIENT_ID;
  const twitchSecret = env.TWITCH_CLIENT_SECRET;
  const wantMovies = !args.gamesOnly;
  const wantGames = !args.moviesOnly;
  if (wantMovies && !tmdbKey) {
    console.error("needs TMDB_API_KEY in .dev.vars (or pass --games-only).");
    process.exitCode = 1;
    return;
  }
  if (wantGames && (!twitchId || !twitchSecret)) {
    console.error(
      "needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET (IGDB) in .dev.vars (or pass --movies-only).",
    );
    process.exitCode = 1;
    return;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
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
      throw new Error(
        `${method} ${path} → HTTP ${res.status} ${JSON.stringify(json)}`,
      );
    }
    return { status: res.status, json };
  };

  const all = await fetchAllMedia<Row>(request);

  // Collections that already exist — a loose straggler may join one of these
  // even when it's the only loose member of its franchise.
  const { json: colPage } = await request("GET", "/api/collections");
  const allCollections = (colPage?.collections ?? []) as {
    id: string;
    name: string | null;
    name_zh: string | null;
  }[];
  const existingIds = new Set(allCollections.map((c) => c.id));

  const loose = all.filter((r) => r.collection_id === null);
  const candidates = selectCandidates(all, {
    movies: wantMovies,
    games: wantGames,
  }) as Row[];
  const scoped = args.limit ? candidates.slice(0, args.limit) : candidates;

  console.error(
    `library: ${all.length} rows, ${loose.length} ungrouped, ${candidates.length} linked movie/game candidates`,
  );
  console.error(
    `resolving ${scoped.length} against TMDB/IGDB (throttle ${args.perMs}ms)…\n`,
  );

  // derived collection id → member rows
  const groups = new Map<string, { rows: Row[]; name: string | null }>();
  const standalone: Row[] = [];
  const errors: { row: Row; why: string }[] = [];

  for (let i = 0; i < scoped.length; i += 1) {
    const row = scoped[i]!;
    try {
      let key: string | null = null;
      let name: string | null = null;
      if (row.type === "movie") {
        const detail = await getTmdbDetail(tmdbMovieIdOf(row)!, "movie", {
          apiKey: tmdbKey!,
        });
        const franchise = detail?.belongs_to_collection ?? null;
        if (franchise) {
          key = `tmdb:collection:${franchise.id}`;
          name = franchise.name ?? null;
        }
      } else {
        const game = await getIgdbDetail(igdbIdOf(row)!, {
          clientId: twitchId!,
          clientSecret: twitchSecret!,
        });
        const series = game?.collections?.[0] ?? null;
        if (series) {
          key = `igdb:collection:${series.id}`;
          name = series.name ?? null;
        }
      }
      if (key === null) standalone.push(row);
      else {
        const g = groups.get(key) ?? { rows: [], name: null };
        g.rows.push(row);
        g.name = g.name ?? name;
        groups.set(key, g);
      }
    } catch (e) {
      errors.push({ row, why: (e as Error).message });
    }
    if ((i + 1) % 10 === 0 || i + 1 === scoped.length) {
      process.stderr.write(`  ${i + 1}/${scoped.length}\r`);
    }
    await sleep(args.perMs);
  }

  // --- Naming pass -----------------------------------------------------------
  // Two gaps to close on EXISTING franchise groups, neither reachable from the
  // filing pass above (it only looks at rows with collection_id IS NULL, and a
  // filed group has no loose members left):
  //
  //   1. no name at all — the client falls back to longest-common-prefix, which
  //      gives "建" for 建国大业/建党伟业/建军大业 and, with no shared prefix, one
  //      member's own title (a group named after a film inside it).
  //   2. no name_zh — the group reads in English in a Chinese UI.
  //
  // The English name comes from a MEMBER's detail (same calls as the filing
  // pass); the Chinese one from TMDB's collection endpoint, which is the only
  // place the localized name lives. IGDB has no localized names, so its groups
  // keep name_zh null and the client derives a Chinese name from the members —
  // which is where that derivation actually works well (开拓者).
  //
  // Only MISSING fields are written; an operator-set name is never overwritten.
  const FRANCHISE_ID = /^(?:tmdb|igdb):collection:\d+$/;
  const membersByCollection = new Map<string, Row[]>();
  for (const r of all) {
    if (!r.collection_id || !FRANCHISE_ID.test(r.collection_id)) continue;
    const list = membersByCollection.get(r.collection_id) ?? [];
    list.push(r);
    membersByCollection.set(r.collection_id, list);
  }
  const needsNaming = allCollections.filter((c) => {
    if (!FRANCHISE_ID.test(c.id) || !membersByCollection.has(c.id)) return false;
    return !c.name || (c.id.startsWith("tmdb:") && !c.name_zh);
  });

  const renames: {
    id: string;
    to: string | null;
    toZh: string | null;
    sample: string;
  }[] = [];
  for (const col of needsNaming) {
    const members = membersByCollection.get(col.id)!;
    let en: string | null = null;
    // Any member resolves the franchise name; try until one answers.
    if (!col.name) {
      for (const m of members) {
        try {
          if (col.id.startsWith("tmdb:") && tmdbMovieIdOf(m) !== null) {
            const d = await getTmdbDetail(tmdbMovieIdOf(m)!, "movie", {
              apiKey: tmdbKey!,
            });
            en = d?.belongs_to_collection?.name ?? null;
          } else if (col.id.startsWith("igdb:") && igdbIdOf(m) !== null) {
            const g = await getIgdbDetail(igdbIdOf(m)!, {
              clientId: twitchId!,
              clientSecret: twitchSecret!,
            });
            en = g?.collections?.[0]?.name ?? null;
          }
        } catch {
          // try the next member
        }
        await sleep(args.perMs);
        if (en) break;
      }
    }

    let zh: string | null = null;
    if (col.id.startsWith("tmdb:") && !col.name_zh) {
      try {
        zh = await getTmdbCollectionName(Number(col.id.split(":").pop()), {
          apiKey: tmdbKey!,
          language: "zh-CN",
        });
      } catch {
        // keep null — the client falls back to deriving from the members
      }
      // Untranslated collections echo the English name; storing a copy would
      // just freeze it, so leave name_zh null and let derivation try.
      if (zh && zh === (en ?? col.name)) zh = null;
      await sleep(args.perMs);
    }

    if (en || zh) {
      renames.push({
        id: col.id,
        to: en,
        toZh: zh,
        sample: titleOf(members[0]!),
      });
    }
  }

  if (renames.length) {
    console.error(`
collections to name (${renames.length}):`);
    for (const r of renames) {
      const parts = [
        r.to ? `name "${r.to}"` : null,
        r.toZh ? `name_zh "${r.toZh}"` : null,
      ].filter(Boolean);
      console.error(`  ${r.id} → ${parts.join(" + ")}   (e.g. ${r.sample})`);
    }
  }

  const { actionable, singletons } = partitionGroups(groups, existingIds);

  console.error(`\nfranchises to file (${actionable.length}):`);
  for (const [key, g] of actionable) {
    const verb = existingIds.has(key) ? "join existing" : "create";
    console.error(`  ${verb} ${key}${g.name ? ` (${g.name})` : ""}`);
    for (const row of g.rows) console.error(`      + ${titleOf(row)}`);
  }
  if (singletons.length) {
    console.error(
      `\nskipped — only one loose member, not worth a collection (${singletons.length}):`,
    );
    for (const [key, g] of singletons) {
      console.error(`  ${titleOf(g.rows[0]!)} → ${key}${g.name ? ` (${g.name})` : ""}`);
    }
  }
  if (standalone.length) {
    console.error(`\nno franchise upstream — left loose (${standalone.length}).`);
  }
  if (errors.length) {
    console.error(`\nlookup errored (${errors.length}) — re-run to retry:`);
    for (const { row, why } of errors) console.error(`  ${titleOf(row)}: ${why}`);
  }

  const totalItems = actionable.reduce((n, [, g]) => n + g.rows.length, 0);
  if (!args.commit) {
    console.error(
      `\nDRY-RUN — nothing written. Re-run with --commit to file ${totalItems} item(s) into ${actionable.length} collection(s)` +
        (renames.length
          ? ` and name ${renames.length} existing collection(s)`
          : "") +
        `.`,
    );
    return;
  }

  console.error(`\nCOMMIT → ${args.base} …`);
  let filed = 0;
  let renamed = 0;

  // Rename first: these groups already exist and only their label is wrong, so
  // they apply even when the filing pass below has nothing left to do.
  for (const r of renames) {
    try {
      await request("PATCH", `/api/collections/${encodeURIComponent(r.id)}`, {
        ...(r.to ? { name: r.to } : {}),
        ...(r.toZh ? { name_zh: r.toZh } : {}),
      });
      renamed += 1;
    } catch (e) {
      console.error(`  RENAME failed ${r.id}: ${(e as Error).message}`);
    }
    await sleep(150);
  }
  for (const [key, g] of actionable) {
    try {
      // Create the collection first — a media.collection_id pointing at a row
      // that doesn't exist would drop the items out of the UI entirely (the
      // tree is built from real collection rows). Idempotent: an existing id
      // comes back 200.
      //
      // Store the SOURCE's franchise name ("Beiyang Trilogy", "Pathfinder"),
      // same as the add path. Leaving it null hands the client a
      // longest-common-prefix guess, which yields "建" for the New China Trilogy
      // and, with no shared prefix, names the group after one of its own films.
      const { status: createStatus, json: created } = await request(
        "POST",
        "/api/collections",
        { id: key, name: g.name },
      );
      // 200 = the group already existed, and POST does NOT touch its name. A
      // group created before names were stored still carries null, so backfill
      // it here — that's what renames the franchises filed by an earlier run.
      // An operator-set name is never overwritten.
      if (createStatus === 200 && g.name) {
        const existingName = (created as { name?: string | null } | null)?.name;
        if (!existingName) {
          await request("PATCH", `/api/collections/${encodeURIComponent(key)}`, {
            name: g.name,
          });
          renamed += 1;
        }
      }
      // An OLDER deployed Worker ignores the `id` field and mints a col:<uuid>
      // instead, which would silently scatter each franchise into a throwaway
      // group. Undo that row and stop: the target needs the explicit-id support
      // from this branch deployed first.
      const madeId = (created as { id?: string } | null)?.id;
      if (madeId !== key) {
        // Report what actually happened — never claim a cleanup that failed.
        let cleanup = "no stray row was created";
        if (madeId) {
          try {
            await request(
              "DELETE",
              `/api/collections/${encodeURIComponent(madeId)}`,
            );
            cleanup = `the stray collection ${madeId} was removed`;
          } catch (e) {
            cleanup = `WARNING: could not remove the stray collection ${madeId} (${(e as Error).message}) — delete it by hand`;
          }
        }
        console.error(
          `\nABORTED — ${args.base} ignored the explicit collection id (got ${madeId ?? "nothing"} for ${key}).\n` +
            `That Worker predates explicit source-derived ids on POST /api/collections; deploy this branch first, then re-run.\n` +
            `Nothing was filed; ${cleanup}.`,
        );
        process.exitCode = 1;
        return;
      }
      // Bulk PATCH re-checks the FK server-side, so a failed create can't
      // silently orphan the items.
      await request("PATCH", "/api/media/bulk", {
        ids: g.rows.map((r) => r.id),
        patch: { collection_id: key },
      });
      filed += g.rows.length;
    } catch (e) {
      console.error(`  FAILED ${key}: ${(e as Error).message}`);
    }
    await sleep(150);
  }
  console.error(
    `filed ${filed}/${totalItems} item(s)` +
      (renamed ? `, named ${renamed} existing collection(s)` : "") +
      ". done.",
  );
}

await main();
