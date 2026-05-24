# PRD — Media Tracker (v1)

- **Status:** ready-for-implementation
- **Scope:** v1 — single user, web app, AniList integration only
- **Related docs:** [DESIGN.md](./DESIGN.md) (locked design decisions + schema), [PLAN.md](./PLAN.md) (phase-by-phase build order), [TESTING.md](./TESTING.md) (testing strategy)

---

## Problem Statement

I have a large personal media collection — manga, light novels, anime, donghua, Western cartoons, dramas from various regions (C-drama, K-drama, J-drama), movies, console/PC games, and **mobile games with extensive plot story content** — tracked informally in a Google Doc that has grown past 1,000 entries.

The Google Doc has become effectively "write-only":

- **No way to filter** (e.g. "show me K-dramas I'm currently watching")
- **No search across the three languages I think in** (Chinese, English, Japanese) — I have to scroll manually
- **No cover images** — visual scanning is impossible
- **No clear progress tracking** — I record episodes in free-form text I can't query
- **Hard to use on phone** — Google Docs is unwieldy on a small screen
- **Hard to keep state in sync between my PC and phone** — I have to remember which device I last edited from

I need a tool that lets me actually *use* the data I've been accumulating, from both PC and phone, with a single source of truth.

## Solution

A responsive web app hosted on Cloudflare, accessed from one URL on both PC and phone, that:

- Stores each media item as a row in a single normalized schema across all media types
- Adds new items by searching external metadata APIs (AniList in v1; TMDB, IGDB, Bangumi added incrementally after v1 dogfood)
- Displays covers, multilingual titles, and progress on every item
- Provides faceted filtering (type, region, status, game platform) — multi-select within facets, AND across facets
- Searches across all four title columns (native, romaji, English, Chinese)
- Tracks game playthroughs with `platform` discriminator (`mobile` / `console` / `pc` / `handheld` / `arcade`) and `consumption_mode` (`playing` vs `watching`)
- Handles multi-part gameplay walkthroughs (common for mobile game plot walkthroughs on Bilibili) via a child table
- Switches UI between English and Simplified Chinese, with title display preferring the chosen UI language

Single-user, gated behind Cloudflare Access (Zero Trust). Both devices read/write the same Cloudflare-hosted D1 database, eliminating sync concerns.

---

## User Stories

### Adding new media (general)

1. As a user, I want to search for new anime by typing partial Japanese characters (e.g. "鬼滅"), so that I can find it without typing the English title.
2. As a user, I want to search for new anime by partial English title (e.g. "Demon"), so that I can find titles I know in English.
3. As a user, I want to search for new anime by romaji (e.g. "Kimetsu"), so that romaji-only searches work too.
4. As a user, I want to search for new manga via AniList, so that I can track my reading library alongside watching.
5. As a user, I want to search for new light novels via AniList, so that I can track novels.
6. As a user, I want search results to show cover images, so that I can visually confirm the correct entry before adding.
7. As a user, I want search results to show multilingual titles (romaji + english + native), so that I can identify the right entry across naming conventions.
8. As a user, I want to set the initial status (`planned` / `in_progress` / `completed`) when adding, so that new entries reflect my current state.
9. As a user, I want to be warned when adding a duplicate, so that I don't accidentally create double entries.
10. As a user, I want adding to feel instant after I click, so that bulk add sessions don't feel laggy.

### Adding new media (game-specific)

11. As a user, I want to designate a new game as `playing` (I play it) or `watching` (I watch others play it), so that the correct tracking shape is used.
12. As a user, I want to specify a game's platform (`mobile` / `console` / `pc` / `handheld` / `arcade`), so that I can filter by platform later.
13. As a user, I want to add multiple URLs for a game I'm watching, so that I can track scattered walkthrough videos (e.g. FGO plot walkthroughs on Bilibili are not in a single playlist).
14. As a user, I want to optionally label each video part with a title (e.g. "Part 7: Babylonia"), so that I can identify each part's content.
15. As a user, I want video parts to be ordered by `part_number` and reorderable, so that I can correct ordering after adding.

### Browsing the library

16. As a user, I want a single list view of all my media items, so that I have one place to see everything.
17. As a user, I want each item to show its cover image, status badge, and current progress, so that I can scan the state of my library at a glance.
18. As a user, I want the list sorted by `date_updated DESC` by default, so that recently-active items surface first.
19. As a user, I want to see a count of items currently matching the view, so that I know how big my filtered list is.

### Filtering

20. As a user, I want to filter by one or more media types, so that I can focus on (e.g.) just `animation` + `manga`.
21. As a user, I want to filter by one or more regions, so that I can find "all K-drama" or "all Japanese animation."
22. As a user, I want to filter by status, so that I can see only what I'm currently consuming.
23. As a user, I want to filter games by platform (especially mobile), so that I can find specifically my mobile games.
24. As a user, I want filters to combine AND across facets and OR within a facet, so that "Korean drama in progress" is one selection set producing `type='drama' AND region='korea' AND status='in_progress'`.
25. As a user, I want to see counts next to each filter option, so that I know how much each filter would show before clicking.
26. As a user, I want to clear all filters with one click, so that I can reset back to the full library.

### Searching

27. As a user, I want to search my library by partial Japanese characters, so that "鬼滅" finds "鬼滅の刃."
28. As a user, I want to search by Chinese characters, so that "鬼灭" finds the same entry under its Chinese localization.
29. As a user, I want to search by partial English title, so that "demon" finds "Demon Slayer."
30. As a user, I want to search by romaji, so that "kimetsu" finds the entry.
31. As a user, I want search to combine with active filters, so that I can search within (e.g.) "in progress" only.

### Updating progress

32. As a user, I want a one-tap "+1" on each card to increment current episode/chapter, so that updating progress is fast — especially on mobile.
33. As a user, I want progress updates to apply optimistically in the UI (without a full reload), so that the app feels responsive.
34. As a user, I want the status to auto-flip to `completed` when I reach the final episode/chapter, so that I don't have to manually update it.
35. As a user, I want to edit free-text `game_progress` (e.g. "Chapter 7: Yoshiwara") for playing-mode games, so that I can record specific narrative position.
36. As a user, I want to navigate to a specific video part for watching-mode games, so that I can resume where I left off.
37. As a user, I want to track which video part I'm currently on, so that I know where I left off in a multi-part walkthrough.
38. As a user, I want to mark an entry as `is_rewatching` separately from `completed`, so that re-consumption is tracked without losing original completion.
39. As a user, I want to set status to `dropped` or `paused` without losing the progress I'd already recorded, so that I can resume or revisit later.
40. As a user, I want to manually edit any field on an entry (corrections, notes), so that I'm not locked into API-fetched data.

### Bilingual UI

41. As a user, I want to toggle the UI between English and Simplified Chinese with one click, so that I can read in my preferred language.
42. As a user, I want titles to display in my chosen UI language preferentially (Chinese UI shows Chinese titles when available; English UI shows English titles when available), so that the list reads naturally in either mode.
43. As a user, I want titles to fall back to the next-available language if my preferred title is missing, so that nothing displays blank.
44. As a user, I want my language preference persisted (localStorage), so that I don't re-select it every visit.
45. As a user, I want the UI to default to my browser's language on first visit, so that the default is sensible.

### Cover images

46. As a user, I want covers to load fast on both PC and mobile, so that scrolling the list is smooth.
47. As a user, I want covers to remain available even if upstream APIs change their URLs, so that my library survives over years.
48. As a user, if a cover fails to load, I want a placeholder, so that the layout doesn't break.

### Authentication

49. As a user, I want only I can access my tracker, so that my media history remains private.
50. As a user, I want to log in once on each device and stay logged in, so that I'm not re-authenticating every visit.

### Cross-device

51. As a user, I want changes made on my phone to appear immediately on my PC (and vice versa), so that the tracker has one source of truth.
52. As a user, I want to use the app from home wifi or cellular data, so that I'm not restricted by network location.

### Bulk import

53. As a user, I want to bulk-import the AniList-covered portion of my existing 1000+-entry Google Doc, so that I don't have to manually re-enter everything.
54. As a user, I want low-confidence import matches flagged for manual review, so that wrong matches don't pollute my library.
55. As a user, I want the import script to be resumable, so that an interruption doesn't force me to restart from zero.

### Mobile

56. As a user on mobile, I want filters accessible via a collapsible drawer, so that they don't dominate a small screen.
57. As a user on mobile, I want touch targets ≥44px, so that taps are reliably accurate.

### Performance

58. As a user, I want filter/list/search operations to feel near-instant (<200ms perceived), so that browsing the library is fluid.

---

## Implementation Decisions

Refer to [DESIGN.md](./DESIGN.md) for full reasoning. Summary:

### Stack

- **Frontend:** React + Vite + TypeScript
- **Server:** Hono on Cloudflare Workers
- **Database:** Cloudflare D1 (SQLite on edge)
- **Object storage:** Cloudflare R2 (cover images)
- **Auth:** Cloudflare Access (Zero Trust, reverse-proxy)
- **i18n:** `react-i18next`, locales `en` + `zh-Hans` (Simplified Chinese)
- **Testing:** Vitest + `@cloudflare/vitest-pool-workers` (see TESTING.md)

### Schema

See DESIGN.md § "Proposed schema (v1)" for full SQL. High-level shape:

- One `media` table with `type` discriminator + nullable per-type columns
- One `media_video_parts` child table, used **only for games in watching mode**
- Indexes on `(type, status)`, `region`, `date_updated DESC`, `platform`, and `media_video_parts(media_id)`

### Type taxonomy (6 types)

`animation, manga, light_novel, drama, movie, game`

- `animation` covers anime + donghua + Western cartoon; `region` discriminates
- `drama` covers C/K/J/Tw/Thai/etc.; `region` discriminates
- `game` further discriminated by `platform` (mobile/console/pc/handheld/arcade) AND by `consumption_mode` (playing/watching)

### Metadata source order (sequential, ship-between)

1. **AniList** → `animation` (jp), `manga`, `light_novel` — **v1 only API**
2. TMDB → `movie`, `drama`, `animation` (usa/uk/canada) — v2
3. IGDB → `game` — v2
4. Bangumi → Chinese title enrichment + donghua — v2

### Deep modules (testable in isolation)

| Module | Interface (rough) |
|---|---|
| `TitleDisplay` | Pure function: `displayTitle(media, lang) → string` with fallback rules |
| `FilterQueryBuilder` | Pure function: `(filterParams) → { sql, bindings }`; AND-across-facets, OR-within |
| `AnilistMapper` | Pure function: `aniListToMediaRow(detail) → Partial<MediaRow>` |
| `AnilistClient` | GraphQL wrapper: `searchAnime`, `searchManga`, `getDetail` |
| `CoverStorage` | `uploadCover(sourceUrl, key) → r2Url`; idempotent via R2 `head()`; fallback to upstream URL on upstream failure |
| `MediaRepository` | All D1 access for `media` and `media_video_parts`; methods: `insert`, `update`, `get(id)`, `list(filter)`, `search(q, filter)`, `addVideoParts(mediaId, parts)`, `getVideoParts(mediaId)` |

**Explicitly NOT a module up front:** no unified `MetadataSource` abstraction across AniList/TMDB/IGDB/Bangumi. Each source stands alone in v1; any shared abstraction (if it makes sense) emerges *after* the second integration ships — this is the explicit anti-premature-abstraction position from the design grilling.

### Filter UI

Faceted sidebar with checkbox groups per facet (type, region, status, game platform). **AND across facets, OR within.** Counts shown per option. Matches the Letterboxd / AniList / MAL convention.

### Search

LIKE across the 4 title columns (`title_native`, `title_romaji`, `title_english`, `title_chinese`). Adequate at expected scale (1,000–5,000 items). CJK matches work because Chinese/Japanese characters are meaningful per-character.

### Progress increment UX

One-tap "+1" on episodic content (animation, drama, manga, light_novel, game in watching mode). Optimistic UI updates. Status auto-transitions to `completed` when `current_episode == total_episodes` (or chapter equivalents).

### Cover storage

Images downloaded to R2 at item-add time, served from Cloudflare CDN. Decouples archive from upstream API URL lifecycle. R2 free tier (10 GB / 1M Class A ops per month) covers expected scale at $0.

---

## Testing Decisions

Full operational reference in [TESTING.md](./TESTING.md). Summary:

- **Pyramid weighted toward pure-function unit tests + repository integration tests**
- **No React component tests in v1** — UI churn rate too high; reintroduce at v2 via Playwright e2e for 3-5 core flows once UX patterns stabilize
- Vitest + `@cloudflare/vitest-pool-workers` for real D1 in test mode (no mocked DB)
- Mock **only at external boundaries** (AniList API, upstream image fetch); never internal modules
- **TDD** for pure functions; **spec-first hybrid** for repository; **test-after with captured fixtures** for external integrations
- **No coverage tracking in v1**; report-only at month 3+; CI gate never (or only if external users join)
- Tests must assert **external behavior**, not implementation details
- AI-generated tests require human review for assertion meaningfulness — reject patterns like `expect(result).toBeDefined()`, `expect(mock).toHaveBeenCalled()`, or any test that passes whether the implementation is right or wrong

**Modules getting tests in v1 (priority order):**

1. `TitleDisplay`, `FilterQueryBuilder`, `AnilistMapper` (Priority 1, pure functions)
2. `MediaRepository` (Priority 2, real-D1 integration)
3. `AnilistClient` (Priority 3, mocked fetch + captured fixtures)
4. `CoverStorage` (Priority 4, mocked R2 + mocked upstream)

Worker handlers (Hono routes) tested via integration through `vitest-pool-workers`. React components not tested.

**Prior art:** sister project `D:/Projects/java-knowledge-flashcard` uses Vitest in the same stack; reuse config patterns where they fit.

---

## Out of Scope

Explicitly NOT in v1:

| Out of scope | Notes / future plan |
|---|---|
| TMDB integration (movies, drama, Western cartoons) | v2; added after v1 dogfood completes |
| IGDB integration (games metadata) | v2 |
| Bangumi integration (Chinese title enrichment + donghua metadata) | v2 enricher |
| Offline-first / device-local data + sync | Not planned; server-of-record is the architectural choice |
| Genre / tag filtering | API returns genres for free, but exposing as filters deferred |
| Watch history / timeline of progress events | v1 stores only current state |
| Notes / reviews / ratings beyond a free-text `notes` field | v2 if desired |
| Touch gestures (swipe to mark complete, etc.) | v1 uses taps only |
| Auto-status transitions beyond "current == total → completed" | No calendar-driven status, no "start watching" detection |
| Search ranking by relevance | LIKE returns matches ordered by `date_updated DESC` |
| Prefix-match autocomplete in search | v2 via FTS5 if friction emerges |
| Simplified ↔ Traditional Chinese normalization in search | v2 via OpenCC if friction emerges |
| Multi-region / co-production support | Each entry has exactly one `region` |
| User invitations / sharing | Single-user app |
| Analytics on usage | Personal app, no analytics |
| Image transformations / resizing | v2 if R2 storage becomes a concern; covers stored as-fetched in v1 |
| Search by external_id (e.g. AniList ID) | v1 search is title-only |
| Multi-platform per game | Each game has exactly one `platform` |

---

## Further Notes

### Design principles encoded in this PRD

1. **Single source of truth over sync** — chose server-of-record web app over local-first with sync, accepting that genuine offline use isn't supported
2. **Auth at the edge, not in the app** — Cloudflare Access eliminates app-level auth code and the bug class that comes with it
3. **Domain consistency over surface convenience** — animation unified (anime + donghua + cartoon) mirrors how drama is modeled; games discriminated by `platform` extends the same pattern
4. **Ship vertical slices, not horizontal layers** — v1 ships AniList end-to-end (schema → fetch → store → display → search → filter → progress update), not "all API clients first, then UI"
5. **Self-host archival data** — covers in R2 rather than hotlinked, for 5+ year durability of the personal archive
6. **Build tests where verification is cheap** — pure functions and real-DB integration tests; skip UI tests where churn destroys their value
7. **AI-generated tests need human verification** — testing strategy designed around "tests YOU can quickly verify are correct," not "maximum coverage"
8. **Defer premature abstraction** — no unified `MetadataSource` interface until at least the second integration has shipped
9. **Promote v2 hatches to v1 when real evidence appears** — `media_video_parts` was originally a v2 hatch; FGO Bilibili walkthroughs surfaced the real need before v1 ships

### Domain glossary

Vocabulary used throughout this PRD, DESIGN.md, PLAN.md, and TESTING.md:

| Term | Meaning |
|---|---|
| Animation | Unified type covering anime, donghua, Western cartoons (discriminated by `region`) |
| Drama | TV-series-format live action (C-drama, K-drama, J-drama, etc.; discriminated by `region`) |
| Consumption mode | (Games only) `playing` (you play yourself) vs `watching` (you watch gameplay videos) |
| Platform | (Games only) `mobile` / `console` / `pc` / `handheld` / `arcade` |
| Region | Country of origin: `japan, china, korea, taiwan, hong_kong, usa, uk, ...` |
| Video part | One video URL in a multi-part walkthrough (games watching mode only); rows in `media_video_parts` table |
| Status | `planned, in_progress, completed, dropped, paused` |
| Rewatching | Boolean flag, separate from status — preserves prior completion record |
| Title (native/romaji/english/chinese) | Four parallel title columns for multilingual display and search |

### Implementation order

See [PLAN.md](./PLAN.md) Phases 0–12. **Critical:** dogfood for 1–2 weeks (Phase 11) before adding the second API integration. This is the entire point of the A.2 sequential-ship architecture — skipping it defeats the purpose.

### How to use this PRD

For each phase in PLAN.md:

1. Open Claude Code in this repo
2. Reference the phase by name; Claude reads PLAN.md, DESIGN.md, TESTING.md as needed
3. Claude implements; you review against the relevant user stories above
4. Run the phase's acceptance checks before merging
5. Commit, push, move to the next phase
