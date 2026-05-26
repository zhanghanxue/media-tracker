// One-shot smoke check against the live AniList GraphQL endpoint.
// Run: `npx tsx scripts/smoke-anilist.ts`
// Verifies PLAN.md Phase 3 acceptance — fixture-mocked unit tests don't cover
// the actual HTTP / DNS / GraphQL-parse path against the real service.

import { getAniListDetail, searchAniList } from "../src/worker/sources/anilist";
import { aniListToMediaRow } from "../src/worker/sources/anilist-mapper";

async function main() {
  console.log("→ searchAniList('鬼滅の刃', 'ANIME')");
  const results = await searchAniList("鬼滅の刃", "ANIME", { perPage: 3 });
  console.log(`  got ${results.length} results; first:`, {
    id: results[0]?.id,
    romaji: results[0]?.title.romaji,
    format: results[0]?.format,
  });
  if (results[0]?.title.romaji !== "Kimetsu no Yaiba") {
    throw new Error(
      `Expected first result romaji 'Kimetsu no Yaiba', got '${results[0]?.title.romaji}'`,
    );
  }

  console.log("\n→ getAniListDetail(101922, 'ANIME')");
  const detail = await getAniListDetail(101922, "ANIME");
  if (!detail) throw new Error("Expected detail to be non-null");
  console.log("  got:", {
    id: detail.id,
    romaji: detail.title.romaji,
    english: detail.title.english,
    format: detail.format,
    episodes: detail.episodes,
    countryOfOrigin: detail.countryOfOrigin,
  });

  console.log("\n→ aniListToMediaRow(detail, 'in_progress')");
  const row = aniListToMediaRow(detail, "in_progress");
  console.log("  mapped row:", {
    type: row.type,
    region: row.region,
    title_native: row.title_native,
    total_episodes: row.total_episodes,
    external_source: row.external_source,
    external_id: row.external_id,
  });

  console.log("\n✓ smoke check passed");
}

main().catch((err) => {
  console.error("✗ smoke check failed:", err);
  process.exit(1);
});
