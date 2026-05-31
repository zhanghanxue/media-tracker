# Media Tracker — v2 Feature Specs

Beyond the v1 PRD. Two requested features, specced PRD-style before any code. Both
extend the existing per-source integrations (AniList / TMDB / IGDB / Bangumi) and
must respect the v1 constraints: **AniList is browser-side** (Worker egress is
blocked), **TMDB/IGDB are Worker-side** (key-bearing), **Workers Free plan = 10 ms
CPU** per request, and source **rate limits** (AniList ~90/min, Bangumi strict,
TMDB generous, IGDB ~4/sec). No premature cross-source abstraction — each feature
branches per type to its source, the same as the add flow.

---

## Feature A — "What's New" scanner (new seasons / sequels)

### Problem
Shows in the library get new seasons (TMDB) or sequels (AniList) after they were
added. Today the only way to notice is to re-search by hand. There's already a
narrower precedent — `RefreshEpisodesButton` / `useRefreshOngoingEpisodes` updates
*episode counts* for ongoing items — but nothing finds whole new seasons/sequels.

### User stories
- As a user, I press one button and get a list of "you don't have this yet" items
  for shows already in my library, each addable in one click.
- I can dismiss a suggestion so it doesn't keep reappearing.
- The scan doesn't freeze the app or get me rate-limited.

### Approach (per source)
- **TMDB tv (drama / variety):** for each `tv:ID` / `tv:ID:sN` row, re-fetch show
  detail (`getTmdbDetail`), diff its season list against the `tv:ID:sN` rows held →
  surface missing seasons. Worker-side (has the key). Cheap, reliable.
- **AniList (animation):** new "seasons" are separate **sequel entries**. Reuse
  `getAniListRelations` (already exists) to walk `SEQUEL` edges per anime; flag any
  whose AniList id isn't in the library. Browser-side. `autoLinkAniListSeries`
  already knows how to group the result once added.
- **Out of scope (v2.0):** movies (no seasons), manga/light-novel (volume bumps —
  separate feature), games (sequels — lower value, revisit later).

### Scale & rate-limit handling (the crux)
A full-library scan is ~hundreds of external calls. Mitigations:
- **Scope the seed set:** only `animation` / `drama` / `variety`, and likely only
  non-`dropped` items (optionally only `completed` + `in_progress`).
- **Throttled background scan with progress** (mirror the backfill scripts'
  cadence), not a synchronous button — AniList especially must be paced.
- **Cache results + a "last scanned" timestamp** so re-checks are periodic (e.g.
  weekly), not every click. CPU is *not* the bottleneck here (aggregation is
  trivial); external call volume + rate limits are.

### Data / endpoints
- New Worker endpoint for the TMDB diff (Worker-side); AniList relation-walk stays
  in the browser, like the add flow.
- **Open:** where dismissals live. Options: a small `dismissed_suggestions` table
  keyed by `(source, external_id)`; or no persistence in v2.0 (results are
  transient, dismiss = add or ignore, re-scan re-shows). Lean: start transient,
  add dismissal persistence only if it's noisy.

### UX
Top-bar "Check for updates" button → progress indicator → a results panel grouped
by show: "{Show} — Season 3 available" / "{Anime} — sequel ‘…’ available" with an
Add button (reuses the existing TMDB-season / AniList add paths).

### Open decisions
1. Seed scope: all non-dropped vs only completed/in-progress?
2. Dismissal persistence: transient vs stored?
3. Trigger: manual only (v2.0) vs also scheduled later?

---

## Feature B — Recommendations (source-native aggregation)

### Problem
The user wants 10–15 fresh suggestions per type, grounded in what they already
track, addable in one click. Engine choice (decided): **source-native
aggregation** — no LLM, no API key, every suggestion is a real, addable entry.

### User stories
- As a user, I pick a type (anime / game / drama / movie / variety) and get 10–15
  recommendations I don't already own.
- Each shows a cover + title + *why* ("because you have X, Y").
- I add any of them in one click.

### Approach
1. **Seed selection (capped):** take a bounded set of that type's library items —
   e.g. up to ~15–20 seeds, preferring `completed` then `in_progress`, newest
   first — to keep external calls bounded.
2. **Per-source recommendations** (per type → its source):
   - `animation` → **AniList** `Media.recommendations` (browser-side). *New
     GraphQL field to add.*
   - `movie` / `drama` / `variety` → **TMDB** `/{movie|tv}/{id}/recommendations`
     (Worker-side). *New client method.* (Variety recs on TMDB may be thin — flag.)
   - `game` → **IGDB** `similar_games` field (Worker-side). *Add the field to the
     existing IGDB query.*
3. **Aggregate & rank:** tally each candidate across seeds (count + source score),
   **exclude anything already in the library** (by external id, then title via the
   existing `normalizeTitle` / Simplified-fold helpers), sort, take top 10–15.
4. Return candidates with cover/title/ids + the seed(s) that surfaced them.

### Scale / CPU
Bounded seeds (~15–20) × one recs call each = small. Aggregation is light → well
under the 10 ms Worker budget for the TMDB/IGDB side; AniList runs in the browser.
Per-type → per-source keeps it within the no-shared-abstraction rule.

### Data / endpoints
- Worker: `GET /api/recommendations?type=movie|drama|variety|game` (TMDB/IGDB
  branches).
- Browser: AniList recommendations for `animation` (egress-blocked from the
  Worker), mirroring how the add flow keeps AniList client-side.
- Reuse `findExistingExternalIds` + title-normalization for the library-exclusion
  filter.

### UX
A type button row (anime / game / drama / movie / variety) → "Recommend" →
a grid of 10–15 cards (cover, title, "because you liked …", Add). Same card +
add affordances as the Add modal.

### Open decisions
1. Seed ranking: completed-first, or weight by recency / a future rating field?
2. Variety fallback when TMDB recs are sparse — accept fewer, or borrow from
   adjacent drama recs?
3. Surface the "why" (seed attribution) in v2.0, or just the list?

---

## Build order (proposed)
Recommendations (B) is the more self-contained, lower-risk first slice — bounded
calls, no persistence, no scheduling. The "What's New" scanner (A) needs the
rate-limit/scan/caching machinery, so it benefits from being second. Each ships
independently and gets its own review, per the v1 sequential-ship rule.

## Feature C — For games added from Bangumi ability to reference to IGDB items

## Feature D — Ordering updates
Currently only able to order by release date oldest to newest, need to have newest to oldest as well,
same for alphabetical order, need to be able to order from Z to A as well

## ISSUE A — Anime Link from Bangumi Search added item to AniList
Even chosen the item that correctly link to the item in AniList, it is not correctly 'saved' in the DB
No matter how many times I tried saving the edit page and do couple of hard refresh
on the page.
