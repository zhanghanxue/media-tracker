// Phase 12 import runner — READ-ONLY pipeline.
//
//   parse 娱乐列表.md  →  match each entry against the live source search APIs
//   →  write review.csv (you confirm matches there before any add).
//
// This stage NEVER writes to the library / production — it only reads public
// (or key-bearing read) search endpoints and emits a CSV. The bulk-add stage
// (POST to the live API) is a separate, gated script.
//
// Run (from the repo root):
//   npx esbuild scripts/import.ts --bundle --platform=node --format=esm \
//     --external:opencc-js --outfile=dist/import-run.mjs && node dist/import-run.mjs
// Flags: --sample (≈N per type) | --limit N | --per N | --file PATH | --out PATH
//
// Credentials (TMDB / IGDB search) are read from .dev.vars at runtime — they
// stay in the file; nothing is printed.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { parseList, type ParsedEntry } from "./import/parse";
import { matchEntry, type MatchResult } from "./import/match";
import { buildSearch } from "./import/sources";
import { toCsv } from "./import/csv";

interface Args {
  file: string;
  out: string;
  sample: boolean;
  perType: number;
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { file: "娱乐列表.md", out: "review.csv", sample: false, perType: 5, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === "--sample") a.sample = true;
    else if (v === "--file") a.file = argv[++i] ?? a.file;
    else if (v === "--out") a.out = argv[++i] ?? a.out;
    else if (v === "--per") a.perType = Number(argv[++i] ?? a.perType);
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
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

async function makeSimplifier(): Promise<(s: string) => string> {
  try {
    const mod: any = await import("opencc-js");
    const Converter = mod.Converter ?? mod.default?.Converter;
    const convert = Converter({ from: "t", to: "cn" });
    return (s: string) => convert(s);
  } catch {
    return (s: string) => s; // OpenCC unavailable → no Traditional folding
  }
}

function stratifiedSample(entries: ParsedEntry[], perType: number): ParsedEntry[] {
  const seen = new Map<string, number>();
  const out: ParsedEntry[] = [];
  for (const e of entries) {
    const n = seen.get(e.type) ?? 0;
    if (n < perType) {
      out.push(e);
      seen.set(e.type, n + 1);
    }
  }
  return out;
}

function tally<T>(xs: T[], key: (x: T) => string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of xs) m[key(x)] = (m[key(x)] ?? 0) + 1;
  return m;
}

const REVIEW_HEADERS = [
  "line", "type", "status", "region", "platform", "parts",
  "title", "alt", "progress", "video", "bucket",
  "match_source", "match_id", "match_score", "match_title", "alternatives",
];

function toRow(r: MatchResult): string[] {
  const e = r.entry;
  const top = r.candidates[0];
  const others = r.candidates
    .slice(1, 4)
    .map((c) => `${c.source}:${c.id}(${c.score.toFixed(2)}) ${c.titles[0] ?? ""}`)
    .join(" | ");
  return [
    String(e.line), e.type, e.status, e.region ?? "", e.platform ?? "", e.parts.join("|"),
    e.title, e.altTitles.join("|"), e.progress?.raw ?? "", e.videoUrl ? "yes" : "", r.bucket,
    top?.source ?? "", top?.id ?? "", top ? top.score.toFixed(2) : "", top?.titles[0] ?? "", others,
  ];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.file)) {
    console.error(`List file not found: ${args.file}`);
    process.exit(1);
  }
  const md = readFileSync(args.file, "utf8");
  const all = parseList(md);

  let entries = all;
  if (args.sample) entries = stratifiedSample(all, args.perType);
  else if (args.limit) entries = all.slice(0, args.limit);

  const env = loadDotenv(".dev.vars");
  const creds = {
    tmdbApiKey: env.TMDB_API_KEY,
    twitchId: env.TWITCH_CLIENT_ID,
    twitchSecret: env.TWITCH_CLIENT_SECRET,
  };
  console.error(
    `creds: TMDB=${creds.tmdbApiKey ? "yes" : "NO"} IGDB=${creds.twitchId && creds.twitchSecret ? "yes" : "NO"}`,
  );

  const simplify = await makeSimplifier();
  const search = buildSearch(creds);

  console.error(`Parsed ${all.length} entries; matching ${entries.length}…`);
  const started = Date.now();
  const results: MatchResult[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    try {
      results.push(await matchEntry(entries[i]!, search, { simplify }));
    } catch {
      results.push({ entry: entries[i]!, bucket: "none", candidates: [] });
    }
    if ((i + 1) % 10 === 0 || i + 1 === entries.length) {
      process.stderr.write(`  ${i + 1}/${entries.length}\r`);
    }
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  const csv = toCsv(REVIEW_HEADERS, results.map(toRow));
  writeFileSync(args.out, "﻿" + csv, "utf8");

  console.error(`\n\nDone in ${secs}s → ${args.out}`);
  console.error("by bucket:", tally(results, (r) => r.bucket));
  console.error("by type:  ", tally(results, (r) => r.entry.type));
  const matched = results.filter((r) => r.bucket !== "none").length;
  console.error(`matched (auto+review): ${matched}/${results.length}`);
}

await main();
