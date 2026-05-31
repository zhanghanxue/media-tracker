// One-off: verify the new drill-down endpoints against production on the real
// library — correctness (counts) + that they return Ok (under the Worker CPU
// limit). Reads the CF Access service token from .dev.vars itself; prints only
// status/timing/sizes/counts, never secrets.
//
//   npx esbuild scripts/verify-endpoints.ts --bundle --platform=node --format=esm \
//     --external:opencc-js --outfile=dist/verify-endpoints.mjs && node dist/verify-endpoints.mjs

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

  const hit = async (label: string, path: string) => {
    const t0 = Date.now();
    const res = await fetch(BASE + path, { headers, redirect: "manual" });
    const ms = Date.now() - t0;
    const text = await res.text();
    let summary = "";
    try {
      const json = JSON.parse(text);
      if (Array.isArray(json.rollups)) {
        const samples = json.rollups.reduce(
          (n: number, r: { sample_titles: unknown[] }) => n + r.sample_titles.length,
          0,
        );
        summary = `rollups=${json.rollups.length}, sampleRows=${samples}`;
      } else if (Array.isArray(json.collection_ids)) {
        summary = `matching_collections=${json.collection_ids.length}`;
      } else if (Array.isArray(json.items)) {
        summary = `items=${json.items.length}, total=${json.total}`;
      }
    } catch {
      summary = `(non-JSON, ${text.length}B)`;
    }
    console.log(
      `${label.padEnd(26)} HTTP ${res.status}  ${String(ms).padStart(4)}ms  ${(text.length / 1024).toFixed(1)}KB  ${summary}`,
    );
  };

  await hit("collections/rollups", "/api/collections/rollups");
  await hit("matching (animation)", "/api/media/matching-collections?type=animation");
  await hit("level: root loose p1", "/api/media?collection=__root__&limit=60&offset=0");
  await hit("level: root loose p2", "/api/media?collection=__root__&limit=60&offset=60");
  // For comparison: the OLD whole-library request the app currently makes.
  await hit("OLD whole-library", "/api/media?limit=5000");
}

await main();
