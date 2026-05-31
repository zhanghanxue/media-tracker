// One-off diagnostic: search TMDB for a show through the deployed Worker and
// inspect its seasons (to see why a multi-season add might fail). Read-only —
// hits GET endpoints only, never POSTs (so it does NOT add anything). Reads the
// CF Access service token from .dev.vars itself; prints nothing secret.
//
//   npx esbuild scripts/tmdb-probe.ts --bundle --platform=node --format=esm \
//     --external:opencc-js --outfile=dist/tmdb-probe.mjs && node dist/tmdb-probe.mjs "현지에서 먹힐까"

import { existsSync, readFileSync } from "node:fs";

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

const BASE = "https://media.zhanghanxue.com";

async function main() {
  const env = { ...loadDotenv(".dev.vars"), ...process.env };
  const headers = {
    "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID ?? "",
    "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET ?? "",
  };
  const query = process.argv[2] ?? "현지에서 먹힐까";

  const get = async (path: string) => {
    const res = await fetch(BASE + path, { headers, redirect: "manual" });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // leave null
    }
    return { status: res.status, json, text };
  };

  const search = await get(`/api/tmdb/search?q=${encodeURIComponent(query)}&kind=tv`);
  console.log(`search "${query}" → HTTP ${search.status}`);
  const results = (search.json as { results?: unknown[] })?.results ?? [];
  for (const r of results.slice(0, 6) as Array<Record<string, unknown>>) {
    console.log(
      `  id=${r.id}  ${r.name ?? r.original_name}  (orig: ${r.original_name})  first_air=${r.first_air_date}`,
    );
  }
  if (results.length === 0) {
    console.log("  (no results)");
    return;
  }

  // Inspect the seasons of the top hit (what handleAddTmdbShow would iterate).
  const top = results[0] as { id: number; name?: string };
  console.log(`\nseasons of top hit id=${top.id} (${top.name}):`);
  const seasons = await get(`/api/tmdb/tv/${top.id}/seasons`);
  console.log(`  GET /tv/${top.id}/seasons → HTTP ${seasons.status}`);
  const list = (seasons.json as { seasons?: Array<Record<string, unknown>> })?.seasons ?? [];
  for (const s of list) {
    console.log(
      `    season ${s.season_number}: "${s.name}"  episodes=${s.episode_count}  air=${s.air_date}`,
    );
  }
  console.log(`  (${list.length} addable season(s))`);

  // With --add, replicate what the Add-show button does: POST each season. This
  // MUTATES the library (adds the show). Prints each season's HTTP status so a
  // failure mode (502/400/CPU) is visible.
  if (process.argv.includes("--add")) {
    console.log(`\n--add: posting ${list.length} season(s) of id=${top.id} …`);
    for (const s of list) {
      const body = JSON.stringify({
        external_source: "tmdb",
        status: "planned",
        media: { id: top.id, media_type: "tv", season_number: s.season_number },
      });
      const res = await fetch(BASE + "/api/media", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body,
        redirect: "manual",
      });
      const text = await res.text();
      let note = "";
      try {
        const j = JSON.parse(text) as Record<string, unknown>;
        note = (j.error as string) ?? (j.title as string) ?? `id=${j.id}`;
      } catch {
        note = text.slice(0, 120);
      }
      console.log(`    season ${s.season_number} → HTTP ${res.status}  ${note}`);
    }
  }
}

await main();
