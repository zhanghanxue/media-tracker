# PRD-v2 Implementation — Working State

Active build of PRD-v2.md. Round 1 = **Issue A + Feature C + Feature D + select-mode UX**.
Round 2 (later) = Feature A (What's New scanner) + Feature B (Recommendations).

## LOCKED DECISIONS (from user)
1. **Cross-reference columns** (Issue A + Feature C are ONE feature). Add 4 nullable TEXT
   columns: `anilist_id, tmdb_id, igdb_id, bangumi_id`. **Additive only — NO backfill**,
   `external_source`/`external_id` left untouched (zero risk to existing ~1.2k rows).
   - Issue A root cause: the editor's "AniList" button (`AniListTitlePicker`) only copies
     english/romaji TITLES — stores NO id ("does not re-key the row's source"). AND PATCH
     validator (`patch-media.ts`) excludes external_id/external_source. So the link never
     persisted. Fix: store the picked id in `anilist_id` (anime/manga) / `igdb_id` (game),
     allow those in PATCH, show the persisted link in the editor so user can SEE it stuck.
   - Reads "the AniList id of a row" via helper that falls back to external_id when AniList
     is the primary source: `anilistIdOf(row) = row.external_source==='anilist' ? row.external_id : row.anilist_id` (same for the others).
2. **Feature D sorting** — expand the dropdown (NO arrow toggle). Add: Release (newest),
   Title (Z–A). Sort direction is currently baked per-key in `media-query-builder.ts`
   SORT_CLAUSES + mirrored in `MediaList.tsx` client interleave (lines ~159-195).
3. **Rating** — EXTERNAL SOURCE RATING ONLY (user picked this). ONE column:
   `source_rating REAL` (normalized 0–10; each mapper sets it from its source's score).
   NO my_rating, NO editor rating widget. Sort: `Rating (high→low)` and `Rating (low→high)`,
   NULLs last: `source_rating IS NULL, source_rating DESC|ASC`. No backfill in the migration
   → existing rows source_rating NULL until a paced backfill script (USER runs it, not me).
   Source score fields to normalize: AniList averageScore 0–100 → /10 (must add averageScore
   to MEDIA_FIELDS + AniListMedia type — not currently fetched); TMDB vote_average (already
   0–10); Bangumi rating.score (0–10); IGDB rating 0–100 → /10.
4. **Select-mode UX** — make the New/Select/Edit toolbar (`MediaList.tsx` ~201-234) sticky
   under the header so select mode is reachable while scrolled. Header is `sticky top-0 h-14 z-10`.

## ARCHITECTURE FACTS (verified)
- Real tree: `src/worker/*` (Hono) + `src/client/*` (React). NOT src/server.
- Schema: `src/worker/db/schema.ts` (types) mirrors `migrations/*.sql`. Migrations go to
  0007. Next: **0008_add_cross_reference_ids.sql**, **0009_add_ratings.sql**.
- `MediaRow` has ONE `external_id`/`external_source`. TMDB ids kind-prefixed ("movie:603",
  "tv:1399:s2"); others bare.
- `MediaInsert` = column subset every mapper produces. updateMedia/bulkUpdateMedia in
  `media-repository.ts` build dynamic SET from MediaPatch keys (validator-gated → safe), so
  adding fields to MediaPatch auto-works in the repo. INSERT_COLUMNS list (repo ~22-45)
  must add `source_rating` (mappers set it); my_rating + cross-ref ids NOT inserted (NULL).
- PATCH validation: `src/worker/api/patch-media.ts` — MediaPatch interface, NULLABLE_STRING_FIELDS,
  NULLABLE_INT_FIELDS, ALLOWED_FIELDS set, per-field checks. source_rating NOT user-editable.
- Sort whitelist parse: `src/worker/api/list-query.ts` SORT_KEYS (currently date_updated,
  date_added, release_date, title, title_zh). Builder: `src/worker/api/media-query-builder.ts`
  SORT_CLAUSES record. Client dropdown: `src/client/App.tsx` SORT_OPTIONS (date_updated,
  date_added, release_date, title — note title_zh NOT exposed in UI today).
- Client interleave re-sort in `MediaList.tsx` handles collection cards + items together;
  currently special-cases `sort==='title'` (collator) and `release_date` (asc). MUST extend
  for new keys. Collections have no rating → sort last on rating.
- i18n: `src/client/locales/en.json` + `zh-Hans.json`. sort.* keys at line ~34. editor.* ~75.
- AniList source rating: `AniListMedia.averageScore` (0–100) → /10 for source_rating.
  AniListTitlePicker.tsx returns `PickedAniListTitles {english,romaji}` — extend to add `id`.
- IGDB: search via `/api/igdb/search` (useIgdbSearch + igdbSearch.ts: igdbCover, igdbYear).
  IgdbGame has `rating` (0–100) → /10. No existing IGDB *link* picker (IgdbResultRow is
  add-flow). Build a small IgdbLinkPicker (search→pick id) for the editor.
- Editor: `src/client/components/MediaDetailEditor.tsx` (~607 lines). save() builds patch of
  changed fields only. Add: my_rating widget (1–10, clearable), cross-ref sections
  (anime/manga→AniList sets anilist_id; game→IGDB sets igdb_id), show persisted link.
- TMDB rating: `vote_average` (0–10, already 0-10). Bangumi: `rating.score` (0–10). IGDB:
  `rating` (0–100 → /10). AniList: averageScore (0–100 → /10). Need to read each mapper +
  source type to wire source_rating: tmdb-mapper, bangumi-mapper, igdb-mapper, anilist-mapper.

## TESTING (per TESTING.md)
- Pure fns (TDD): media-query-builder sort clauses, list-query sort parse, patch-media
  validation of new fields. Repo (spec-first, REAL D1): link persistence + cross-ref.
- Test files live beside source: `*.test.ts` in worker/api, worker/db, worker/sources.

## PROGRESS — Round 1 COMPLETE & GREEN (544 tests pass, typecheck clean, vite build exit 0)
- [x] Slice 1 (Issue A + Feature C): migration 0008 (anilist_id/tmdb_id/igdb_id/bangumi_id,
      additive, NO backfill). schema.ts MediaRow + 4 cols. patch-media.ts: 4 ids in
      NULLABLE_STRING_FIELDS. crossRef.ts helpers (fall back to external_id when primary).
      AniListTitlePicker returns id; new IgdbLinkPicker. Editor sets anilist_id/igdb_id, shows
      "✓ Linked" + unlink. Regression tests in media-repository.test.ts.
- [x] Slice 2 (Feature D sort): reverse keys release_date_desc/title_desc/title_zh_desc +
      rating_desc/rating_asc through list-query → builder → App → MediaList interleave → i18n.
- [x] Slice 2b (rating): EXTERNAL SOURCE rating ONLY (no user rating). migration 0009
      (source_rating REAL + index). sources/rating.ts (ratingFrom100 /10, ratingFrom10 passthrough,
      0→null). All 4 mappers set source_rating. AniList averageScore + IGDB rating added to queries.
- [x] Slice 3: sticky toolbar (sticky top-14) in MediaList.tsx.
- [x] BACKFILL SCRIPT (user runs): scripts/backfill-source-ratings.ts. READ-ONLY — emits reviewable
      dist/backfill-source-ratings.sql of idempotent non-clobbering UPDATEs; does NOT write the DB.

## ROUND 2 (in progress) — decisions LOCKED
Order: B (Recommendations) first, then A (What's New scanner). PRD says B = NO persistence,
NO scheduling, NO migration — just endpoint + aggregation + UI.
- B defaults: show the "why" (because-you-have); seeds completed-first then in_progress, newest,
  capped ~20. anime→AniList Media.recommendations (browser); movie/drama/variety→TMDB
  /{movie|tv}/{id}/recommendations (worker); game→IGDB similar_games (worker). Aggregate+rank+
  library-exclude via findExistingExternalIds + normalizeTitle. GET /api/recommendations?type=…
- A defaults: manual trigger only (no cron); dismissals PERSISTENT (dismissed_suggestions table,
  keyed (source, external_id)) — that's the ONE Round-2 migration, in slice 2b not B.
- CONSTRAINT (user): do NOT edit MediaCard.tsx, AddMediaModal.tsx, or the *ResultRow files.
  Build standalone new components; reuse addMedia()/useAddMedia without touching the add modal.

### Round 2a — Feature B (Recommendations) DONE & GREEN (557 tests, typecheck clean, build exit 0)
- Pure core: `src/worker/api/recommend.ts` (aggregateRecommendations + sourceIdOf) + tests.
- Sources: tmdb.ts getTmdbRecommendations + vote_average on TmdbSearchResultRaw; igdb.ts
  getIgdbSimilarGames + similar_games on IgdbGame; anilist.ts getAniListRecommendations.
- Repo: selectRecommendationSeeds (completed-first, in_progress, newest, cap 20, needs a source id),
  selectLibraryIdentities (all primary+cross-ref keys + titles for exclusion).
- Endpoint: `GET /api/recommendations?type=movie|drama|variety|game` (routes/recommend.ts, wired in
  index.ts). animation → 400 (browser-side). 503 if source key absent; 502 on upstream fail.
- Browser: client/lib/recommend.ts (anime computed in-browser via AniList; others hit the worker;
  reuses the SAME pure aggregator). useRecommendations + useAddRecommendation hooks.
- UI: RecommendModal.tsx (standalone; type row → grid of cards w/ cover/title/"because you have X"
  /Add). Button in App.tsx header. i18n en+zh `recommend.*`. Did NOT touch MediaCard/AddMediaModal.
- Tests: api/recommend.test.ts (9) + routes/recommend.test.ts (4, real D1 + mocked TMDB).

### Extra (user mid-round request) — video links for drama/variety DONE
Add-on alongside episode tracking (NOT a replacement). VideoPartsEditor is already generic +
backend media_video_parts endpoints are type-agnostic → pure gating change in MediaDetailEditor:
a collapsed "+ Add video links (optional)" toggle for type drama/variety, below the episode field.
i18n editor.videoLinksShow/Hide. (Overrides the old CLAUDE.md "drama tracks by episode not URLs"
note — now an opt-in add-on per user.)

### Round 2b — Feature A (What's New scanner) — NOT STARTED
Next: migration for dismissed_suggestions (persistent, keyed (source, external_id)); TMDB season-diff
(worker) + AniList sequel-walk (browser, reuse getAniListRelations); throttled scan w/ progress;
manual trigger only; results panel grouped by show w/ Add + Dismiss.
