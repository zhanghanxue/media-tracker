// Phase 12 bulk-add CLI — reads the confirmed review.csv and adds its AUTO rows
// to the LIVE library. DRY-RUN by default (prints the plan, writes nothing);
// pass --commit to actually POST. The real run needs a Cloudflare Access SERVICE
// TOKEN in .dev.vars / env (CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET).
//
//   node dist/import-add.mjs                 # dry-run plan
//   node dist/import-add.mjs --commit --limit 20   # add the first 20 (careful run)
//   node dist/import-add.mjs --commit        # add all AUTO rows
// Flags: --csv PATH | --base URL | --limit N | --commit

import { existsSync, readFileSync } from "node:fs";

import { parseCsv } from "./import/csv";
import {
  addEntry, autoRows, classify, PLAN_LABEL, type AddDeps, type AddOutcome, type PlanKind,
} from "./import/add";

interface Args {
  csv: string;
  base: string;
  limit: number | null;
  commit: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { csv: "review.csv", base: "https://media.zhanghanxue.com", limit: null, commit: false };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === "--commit") a.commit = true;
    else if (v === "--csv") a.csv = argv[++i] ?? a.csv;
    else if (v === "--base") a.base = argv[++i] ?? a.base;
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

function tally<T>(xs: T[], key: (x: T) => string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of xs) m[key(x)] = (m[key(x)] ?? 0) + 1;
  return m;
}

async function makeSimplifier(): Promise<(s: string) => string> {
  try {
    const mod: any = await import("opencc-js");
    const convert = (mod.Converter ?? mod.default?.Converter)({ from: "t", to: "cn" });
    return (s: string) => convert(s);
  } catch {
    return (s: string) => s;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.csv)) {
    console.error(`review file not found: ${args.csv}`);
    process.exitCode = 1;
    return;
  }

  let rows = autoRows(parseCsv(readFileSync(args.csv, "utf8")));
  if (args.limit) rows = rows.slice(0, args.limit);

  console.error(`AUTO rows: ${rows.length}`);
  console.error("plan:", tally(rows, (r) => PLAN_LABEL[classify(r)]));
  console.error("by type:", tally(rows, (r) => r.type));
  console.error("by status:", tally(rows, (r) => r.status));

  if (!args.commit) {
    const shows = rows.filter((r) => classify(r) === "tmdb-show").length;
    console.error(
      `\nDRY-RUN — nothing written. ${rows.length} adds (+ ${shows} TMDB shows expand to all their seasons).`,
    );
    console.error("Re-run with --commit (and CF_ACCESS_CLIENT_ID/SECRET set) to write to the live library.");
    return;
  }

  // --- commit path: needs the service token ---
  const env = { ...loadDotenv(".dev.vars"), ...process.env };
  const id = env.CF_ACCESS_CLIENT_ID;
  const secret = env.CF_ACCESS_CLIENT_SECRET;
  if (!id || !secret) {
    console.error("\n--commit needs CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET (Zero Trust → Service Auth).");
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
    if (!res.ok && res.status !== 409) {
      throw new Error(`${method} ${path} → HTTP ${res.status} ${JSON.stringify(json)}`);
    }
    return { status: res.status, json };
  };

  // Fail fast with a clear diagnosis before attempting any writes.
  try {
    const health = await request("GET", "/api/health");
    console.error(`auth OK (as ${health.json?.user ?? "service-token"})`);
  } catch (e) {
    console.error(`\nauth preflight failed: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }
  const deps: AddDeps = {
    post: (path, body) => request("POST", path, body),
    patch: (path, body) => request("PATCH", path, body),
    tmdbSeasons: async (tvId) => {
      const { json } = await request("GET", `/api/tmdb/tv/${tvId}/seasons`);
      return (json?.seasons ?? []) as Array<{ season_number: number }>;
    },
    simplify: await makeSimplifier(),
  };

  console.error(`\nCOMMIT → ${args.base} …`);
  const outcomes: AddOutcome[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    outcomes.push(await addEntry(rows[i]!, deps));
    if ((i + 1) % 10 === 0 || i + 1 === rows.length) {
      process.stderr.write(`  ${i + 1}/${rows.length}\r`);
    }
  }
  console.error("\n\noutcomes:", tally(outcomes, (o) => o));
  const errs = outcomes.filter((o) => o === "error").length;
  console.error(errs ? `${errs} errored — re-run is safe (409s skip what's already added).` : "all good.");
}

await main();
