// Backfill `title_sort_zh` (migration 0012) for rows added before the mappers
// derived it. Unlike backfill-source-ratings.ts, this needs NO source calls: the
// pinyin key is computed purely from a row's EXISTING title columns, which the
// library already returns. So it's fully READ-ONLY against the library and the
// network — it fetches the rows, computes titleSortZh() (the SAME helper the
// mappers use, so a backfilled key is IDENTICAL to a fresh add's), and writes a
// reviewable .sql file of idempotent UPDATEs. Nothing is mutated until YOU apply
// that file with wrangler.
//
// Each statement is `UPDATE media SET title_sort_zh = '<pinyin>' WHERE id = <id>
// AND title_sort_zh IS NULL;` — non-clobbering, so re-applying is safe and a row
// that already has a key is never overwritten.
//
// Build + run (from repo root):
//   npx esbuild scripts/backfill-title-sort-zh.ts --bundle --platform=node --format=esm \
//     --external:opencc-js --outfile=dist/backfill-title-sort-zh.mjs && node dist/backfill-title-sort-zh.mjs
// Then REVIEW the emitted file and apply it yourself:
//   wrangler d1 execute media-tracker-db --remote --file=dist/backfill-title-sort-zh.sql
//   (use --local to target the local dev DB instead of prod)
// Flags: --out PATH | --base URL | --limit N
//
// Auth: a Cloudflare Access SERVICE TOKEN (reads the gated library only).

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { titleSortZh } from "../src/worker/sources/titleSortKey";

interface Args {
  base: string;
  out: string;
  limit: number | null;
}

interface LibRow {
  id: number;
  title_chinese: string | null;
  title_native: string | null;
  title_english: string | null;
  title_romaji: string | null;
  title_sort_zh: string | null;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    base: "https://media.zhanghanxue.com",
    out: "dist/backfill-title-sort-zh.sql",
    limit: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === "--base") a.base = argv[++i] ?? a.base;
    else if (v === "--out") a.out = argv[++i] ?? a.out;
    else if (v === "--limit") a.limit = Number(argv[++i] ?? "0") || null;
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

/** SQL string literal with single quotes doubled (D1/SQLite escaping). */
function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
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

  const headers = {
    "Content-Type": "application/json",
    "CF-Access-Client-Id": id,
    "CF-Access-Client-Secret": secret,
  };
  // READ-ONLY: only GETs; writes a .sql file, never PATCHes/POSTs.
  const get = async (path: string) => {
    const res = await fetch(args.base + path, { method: "GET", headers, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      throw new Error(`Access redirect (HTTP ${res.status}) — service token not accepted.`);
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
  let pending = all.filter((r) => r.title_sort_zh === null || r.title_sort_zh === undefined);
  console.error(`library: ${all.length} rows, ${pending.length} missing title_sort_zh`);
  if (args.limit) pending = pending.slice(0, args.limit);

  const stmts: string[] = [];
  let empty = 0;
  for (const row of pending) {
    const key = titleSortZh(row);
    if (!key) {
      empty += 1; // title-less row → leave NULL (the ORDER BY COALESCE handles it)
      continue;
    }
    // Idempotent + non-clobbering. id is a trusted integer from our own DB; key
    // is escaped. Re-applying is safe (… AND title_sort_zh IS NULL).
    stmts.push(
      `UPDATE media SET title_sort_zh = ${sqlStr(key)} WHERE id = ${row.id} AND title_sort_zh IS NULL;`,
    );
  }

  const header = [
    "-- Backfill title_sort_zh (migration 0012). Generated by",
    "-- scripts/backfill-title-sort-zh.ts — REVIEW before applying.",
    `-- ${stmts.length} UPDATE(s); each is idempotent (… AND title_sort_zh IS NULL).`,
    "-- Apply (prod):  wrangler d1 execute media-tracker-db --remote --file=" + args.out,
    "-- Apply (local): wrangler d1 execute media-tracker-db --local  --file=" + args.out,
    "",
  ].join("\n");
  writeFileSync(args.out, header + stmts.join("\n") + (stmts.length ? "\n" : ""), "utf8");

  console.error(`\nwrote ${stmts.length} UPDATE(s) → ${args.out}` + (empty ? ` (${empty} title-less row(s) left NULL)` : ""));
  console.error("REVIEW that file, then apply it yourself:");
  console.error(`  wrangler d1 execute media-tracker-db --remote --file=${args.out}`);
}

await main();
