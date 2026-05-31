# Media Tracker — Design Decisions

Personal media tracker for **single user, two devices (PC + phone)**. Tracks media consumed, currently consuming, and planned across:
**manga, light novels, animation (anime / donghua / Western cartoon), drama (C-drama / K-drama / J-drama / etc.), movies, games.**

Output of a mentor-grilling design session — every decision below is locked unless re-opened explicitly.

---

## 1. Deployment shape — Responsive web app + server-of-record

One URL, hosted on Cloudflare, accessed by PC browser and phone browser (install as PWA on phone).

- **Why:** single source of truth eliminates sync problems; no merge conflicts between devices; "you always see what you just wrote" on every load.
- **Industry convergence:** every personal-tracker that survived (Letterboxd, AniList, MAL, Trakt, Bangumi) is web-first.
- **What would flip this:** genuine offline-first need (subway/flight updates) — not your case.

## 2. Auth — Cloudflare Access (Zero Trust)

Reverse-proxy auth in front of the Worker. Cloudflare handles login (Google / email OTP); Worker reads a signed `Cf-Access-Jwt-Assertion` header. **Zero auth code in the application.**

- **Free** up to 50 users on the Cloudflare free plan.
- **Why:** eliminates an entire category of app-level auth bugs (session fixation, password leaks, broken recovery flows) because there is no auth code in the app. Industry calls this the BeyondCorp / Zero Trust pattern.
- **What would flip this:** desire to be independent of Cloudflare's auth edge — not relevant here since the stack already lives on CF.

## 3. Metadata source — Multi-API, sequential ship (Path A.2)

All four metadata APIs are needed long-term (you have 1000+ entries spanning every type). Build them **one at a time, ship between each**, not all in parallel.

| Type | Source API |
|---|---|
| `animation` (region=japan), `manga`, `light_novel` | **AniList** (GraphQL, no key) |
| `movie`, `drama`, `animation` (region=usa/uk/canada) | **TMDB** (free API key) |
| `game` | **IGDB** (Twitch OAuth, free) |
| Chinese-title enrichment for Japanese works, donghua | **Bangumi** (data enricher) |

- **Why sequential:** premature abstraction is the #1 failure mode of AI-assisted multi-integration work. Building one integration end-to-end and shipping it before starting the next gives you real-data feedback that informs each subsequent API client. The "unified MediaProvider interface" written before the second integration is always wrong.
- **What would flip this:** team of reviewers + fixed spec up front — not your case.

**Fetch-location decision (learned in Phase 11 dogfood, 2026-05-29):** *where* each API call runs is a per-source decision, not "always proxy through the Worker":
- **AniList → browser-direct.** AniList blocks Cloudflare Worker egress IPs (HTTP 403 "API temporarily disabled" to Workers; 200 to normal IPs) but sends permissive CORS (`Access-Control-Allow-Origin: *`). So the browser calls AniList directly and POSTs the resulting media object to the Worker, which maps + persists it. The Worker never calls AniList. (This corrected the original "AniList has no CORS, proxy via the Worker" assumption — wrong on both counts.)
- **Bangumi → browser-direct (shipped 2026-05-29).** Both search endpoints and the subject-detail endpoint send `Access-Control-Allow-Origin: *` and need no auth for reads; the v0 `POST /v0/search/subjects` preflight is also allowed (verified). So search + Chinese-title enrichment run in the browser, same as AniList. Note the two search endpoints are **complementary**: v0 ranks well + indexes romaji (great for Latin/romaji queries) but returns 0 for CJK keywords; the legacy endpoint handles kanji/Chinese but is flaky — query v0 by romaji/English first, fall back to legacy by native.
- **Secret-bearing APIs (TMDB = API key; IGDB = Twitch OAuth) → Worker-side, mandatory.** A key/secret must never reach the browser, so those calls stay server-side — and must be watched for the same Worker-egress-block class of problem. **TMDB shipped this way 2026-05-29:** the browser hits `/api/tmdb/search` (Worker proxies with the `TMDB_API_KEY` bearer secret), and on add it POSTs only `{ id, media_type }` — the Worker fetches full detail (with `append_to_response=translations` to pull EN/中文/native titles in one call) and maps authoritatively. This is the first source that *inverts* the AniList/Bangumi browser-direct pattern. Movie & TV ids share a numeric space, so the conflict key is kind-prefixed (`movie:496243`).
- **Cover images (§10):** the Worker still tries to re-host to R2, but if the image CDN also blocks Workers, `uploadCoverToR2` gracefully falls back to the upstream URL, so a row always has a usable `cover_url`.

## 4. Schema shape — Single `media` table + type discriminator + nullable per-type columns

One table holds every media type. Type-specific fields (`current_episode`, `current_chapter`, `game_progress`, etc.) are nullable and only populated for relevant rows.

- **Why:** "filter by type AND region, sorted by date" is a one-line query on a single table. With separate-table-per-type, the headline list page is an 8-table UNION every render. Nullable columns cost ~nothing in SQLite.
- **Industry convergence:** single-table inheritance is the ORM default (Rails STI, Django, Ecto) at small-to-medium scale.
- **Anti-pattern avoided:** EAV (entity-attribute-value) modeling and per-API-source tables.

## 5. Region — Single normalized column

`region` is a column on every row, normalized at write-time (in each API mapping layer). Starter set:
`japan, china, korea, taiwan, hong_kong, usa, uk` — extend on demand.

- For `animation` + `donghua` + Chinese-origin works, this is also the primary discriminator between sub-genres (C/K/J-drama, anime/donghua/cartoon).
- **Anti-pattern avoided:** free-text without normalization (the "japan" / "Japan" / "JP" / "Japanese" data-quality bug).

## 6. Animation unified as one type

`type='animation'` covers anime + donghua + Western cartoon. `region` discriminates. Mirrors how `drama` is modeled.

- **Post-unification type set (6):** `animation, manga, light_novel, drama, movie, game`
- **Why:** domain consistency with drama. Future-proof when AniList expands donghua coverage. One filter handles "all animation" without `type IN (...)`.
- **Edge case:** Studio Ghibli films are `type='animation'` with `current_episode=1, total_episodes=1`, not `type='movie'`.

## 7. i18n — Bilingual UI with title display preference (Option B)

- **Library:** `i18next` + `react-i18next`
- **Locales:** `en` and `zh-Hans` (Simplified Chinese)
- **Toggle reach:** UI chrome AND media title display
- **Persistence:** localStorage
- **Auto-detect default:** `navigator.language`

**Title display rules:**
- English UI: `title_english || title_romaji || title_native`
- Chinese UI: `title_chinese || title_native || title_english`

- **Why "from day 1, not retrofit":** wrapping every string in `t()` is ~5% per-screen overhead when built in, ~50% overhead + long tail of missed strings when retrofitted.

## 8. Title schema — 4 columns

To support displaying titles in the user's preferred UI language regardless of the media's origin:

| Column | Content |
|---|---|
| `title_native` | Original-language title (Japanese for anime, Korean for K-drama, English for Western) |
| `title_romaji` | Latin transliteration (mostly Japanese; NULL for Western/Chinese origins) |
| `title_english` | English title (translated for non-English origins) |
| `title_chinese` | Chinese title (translated for non-Chinese origins; same as `title_native` for C-drama/donghua) |

**Data-side reality:** AniList returns native + romaji + english but not Chinese. **Bangumi is the source for Chinese titles (shipped 2026-05-29):** the "Fill Chinese titles" backfill + add-time auto-fill populate `title_chinese` from Bangumi (matched via the AniList native/romaji title), with a manual Bangumi search picker in the editor for the long tail. Items can still start `title_chinese = NULL` and rely on fallback until enriched.

**Sorting note (shipped 2026-05-29):** "Title A–Z" sorts **client-side** with locale collation — PINYIN order for Chinese, dictionary order for English — because SQLite can only code-point-order CJK, which gets pinyin backwards (死 < 火 by code point, but 火影 < 死神 by pinyin). The display-language picks the locale + the COALESCE fallback used for the sort key.

**~~Known v2 trigger~~ → DONE (2026-05-29):** Simplified vs Traditional Chinese mismatch. Bangumi's `name_cn` is sometimes Traditional (滅 vs 灭), which silently breaks Simplified search. Fixed exactly as predicted: **OpenCC `t`→`cn` normalization at write-time** (browser, lazy-loaded), so stored `title_chinese` is always Simplified.

## 9. Library search — LIKE-based, multi-column

```sql
SELECT * FROM media
WHERE title_native  LIKE '%' || ? || '%'
   OR title_romaji  LIKE '%' || ? || '%'
   OR title_english LIKE '%' || ? || '%'
   OR title_chinese LIKE '%' || ? || '%'
ORDER BY date_updated DESC LIMIT 50
```

- **Why:** at 1,000–5,000 items the LIKE scan is <10ms — faster than the HTTPS round-trip from your phone. Optimizing this would be optimizing a non-problem.
- **Why CJK works on LIKE:** Chinese/Japanese characters are meaningful per-character; no word tokenization needed.
- **What would flip this:** library passes ~50k items OR you want prefix-match autocomplete OR ranked-relevance results. Migration target: SQLite FTS5 virtual table.

## 10. Cover image storage — Cloudflare R2, downloaded at add-time

Worker fetches the upstream image at item-add, writes it to R2, stores R2 URL in `cover_url`.

- **Why:** durability. Over a 5-year horizon, ~1–5% of hotlinked URLs break (CDN reorgs, deprecated endpoints, account rate limits). Self-hosting decouples your archive from upstream lifecycle.
- **Industry convergence:** every surviving long-term tracker self-hosts (AniList, MAL, Letterboxd, Bangumi).
- **Side benefits:** R2 + Worker on the same edge = fewer DNS lookups; phone doesn't ping third parties every list-render (mild privacy win).
- **Free-tier:** 10 GB / 1M Class A ops per month — your scale is well below.

## 11. First API to integrate — AniList

Covers 3 of 6 types (`animation` where region=japan, `manga`, `light_novel`) and is the most-frequently-updated content type for weekly tracking.

- **Why first:** active-tracking rhythm (you'll feel the value daily); clean GraphQL API is a good architecture validator before tackling messier integrations (IGDB OAuth, Bangumi mixed-language docs); if your library skews heavily to anime/manga, you get the biggest migration chunk done in week 1.
- **Subsequent order (revised by usage feedback):** **Bangumi shipped first** (2026-05-29) — dogfooding showed ~40% of the real library is Chinese-named anime/manga, so Chinese-title support became the top need, not the last. It outgrew "enricher" into a full integration (search + add-by-Chinese + enrichment). **TMDB → IGDB** are next (unlock the games/movies ~60% majority). The original "Bangumi last as enricher" guess was wrong — real usage reordered it.

## 12. Game tracking — Polymorphic on consumption mode + platform discriminator

**Single row per game.** Two discriminating fields beyond the shared `type='game'`:

1. **`platform`** enum (`mobile` / `console` / `pc` / `handheld` / `arcade`) — required for games. Mirrors how `region` discriminates within `drama` and `animation`. "Show me only mobile games" becomes `WHERE type='game' AND platform='mobile'`.
2. **`consumption_mode`** enum (`'playing'` / `'watching'`) — discriminates whether you're playing the game yourself or watching someone else's gameplay videos.

**Field usage by consumption mode:**

- **`consumption_mode = 'playing'`** → free-text `game_progress` ("Chapter 7", "60%", "Yoshiwara") + the shared `status` enum
- **`consumption_mode = 'watching'`** → episodic columns (`current_episode` / `total_episodes`) for part-position tracking, plus rows in `media_video_parts` (child table) for the URLs of each video part

**Why a child table for video parts** (promoted from v2 to v1 based on real-world data — mobile game plot walkthroughs like FGO on Bilibili are routinely scattered across separate uploads, not organized into a single playlist):

```sql
CREATE TABLE media_video_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL,
  title TEXT,             -- optional; e.g. "Part 7: Babylonia"
  url TEXT NOT NULL,
  UNIQUE (media_id, part_number)
);
```

The child table handles both single-URL (one row) and multi-URL (many rows) walkthroughs uniformly — no dual-path query logic, and per-part metadata (title, future fields like duration) lives in real columns rather than a text blob.

**Scope:** `media_video_parts` is used **only for games in watching mode**. Other watching-content types (animation, drama, donghua) track via episode numbers directly — they have a canonical episode-count concept independent of where they're hosted. Game walkthroughs only exist as the creator's video parts. **URL-as-content vs Episode-as-content** is a real distinction that justifies the asymmetric treatment.

**Edge case:** if you play AND watch the same game, create two rows (one per mode).

## 13. Status enum

`planned | in_progress | completed | dropped | paused`

Mirrors AniList's well-tested set. Rewatching/replaying handled as a separate `is_rewatching` boolean flag, not a status — avoids enum bloat.

## 14. Filter UI — Faceted sidebar checkboxes

Sidebar with checkbox groups per facet (type, region, status). **AND across facets, OR within.**

Example: selecting `[animation, manga]` + `[japan, korea]` + `[in_progress]` produces
`type IN ('animation','manga') AND region IN ('japan','korea') AND status='in_progress'`.

Industry standard (Letterboxd, AniList, MAL). **Anti-pattern avoided:** structured-query syntax bars (`type:animation region:japan`) — powerful but require re-learning every session.

## 15. Frontend stack — Reuse existing

| Layer | Choice |
|---|---|
| UI | React + Vite + Vitest (TypeScript) |
| Server | Hono on Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Object storage | Cloudflare R2 |
| Auth | Cloudflare Access |
| i18n | react-i18next |

Reuses the toolchain already proven in `java-knowledge-flashcard`. **Avoid:** introducing a second stack for a personal project — pure tax.

## 16. Bulk-import strategy for the existing Google Doc

After v1 shell is up: export Google Doc → CSV → one-shot Node script that fuzzy-matches each row against AniList by title, flags low-confidence matches for manual review, bulk-inserts via the existing add endpoint. ~1 day of work.

---

## Proposed schema (v1)

```sql
CREATE TABLE media (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  type            TEXT NOT NULL,  -- animation | manga | light_novel | drama | movie | game
  region          TEXT,           -- japan | china | korea | usa | uk | taiwan | hong_kong | ...

  -- Multilingual titles
  title_native    TEXT,
  title_romaji    TEXT,
  title_english   TEXT,
  title_chinese   TEXT,

  -- Status & shared metadata
  status          TEXT NOT NULL,  -- planned | in_progress | completed | dropped | paused
  is_rewatching   INTEGER NOT NULL DEFAULT 0,
  cover_url       TEXT,           -- R2 URL
  external_id     TEXT,           -- ID in the source API
  external_source TEXT,           -- anilist | tmdb | igdb | bangumi
  notes           TEXT,

  -- Episodic progress: animation, drama, manga, light_novel, game (watching mode)
  current_episode INTEGER,
  total_episodes  INTEGER,
  current_chapter INTEGER,
  total_chapters  INTEGER,

  -- Game-specific
  platform         TEXT,          -- mobile | console | pc | handheld | arcade (games only)
  consumption_mode TEXT,          -- 'playing' | 'watching' (games only)
  game_progress    TEXT,          -- free text: "Chapter 7", "60%", "Yoshiwara" (playing mode only)
  -- Video URLs for watching-mode games live in media_video_parts (below), not on this row

  -- Movies
  runtime_minutes INTEGER,

  -- The work's actual air / release date (NOT library activity), padded ISO
  -- "YYYY-MM-DD" so SQLite's TEXT sort is chronological; NULL = unknown (sorts
  -- last). Set by every source mapper on add; backfilled via
  -- scripts/backfill-release-dates.ts. Migration 0007.
  release_date    TEXT,

  date_added      TEXT NOT NULL DEFAULT (datetime('now')),
  date_updated    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_media_type_status      ON media(type, status);
CREATE INDEX idx_media_region           ON media(region);
CREATE INDEX idx_media_date_updated     ON media(date_updated DESC);
CREATE INDEX idx_media_platform         ON media(platform);
CREATE INDEX idx_media_release_date     ON media(release_date);  -- migration 0007

-- Used only for games in watching mode (URL-as-content); other watching types use episode numbers
CREATE TABLE media_video_parts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id     INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  part_number  INTEGER NOT NULL,
  title        TEXT,                          -- optional; e.g. "Part 7: Babylonia"
  url          TEXT NOT NULL,
  UNIQUE (media_id, part_number)
);

CREATE INDEX idx_media_video_parts_media_id ON media_video_parts(media_id);
```

---

## Build order (week 1, v1)

1. Cloudflare project scaffolding (Worker + D1 + R2 bindings)
2. D1 migration: `media` table + indexes
3. Cloudflare Access policy on the domain (gated on your email)
4. Worker scaffold: Hono app, auth header check, `/api/health`
5. AniList GraphQL client: search by title, fetch detail
6. R2 cover-upload pipeline: fetch upstream image → put to R2 → return R2 URL
7. `POST /api/media` add endpoint
8. `GET /api/media` list + filter + search endpoints
9. React UI shell: list page, filter sidebar, add-search modal
10. i18n setup: `en.json`, `zh-Hans.json`, toggle component, title display helper
11. Deploy to Cloudflare. Use for 1–2 weeks.
12. Bulk-import script for AniList-covered subset of the Google Doc.

---

## Known v2 escape hatches

| Trigger | v2 response |
|---|---|
| Library >50k items, or want prefix-search / ranked relevance | Migrate LIKE to SQLite FTS5 virtual table |
| ~~Simplified / Traditional Chinese search mismatch~~ | ✅ DONE 2026-05-29 — OpenCC `t`→`cn` at write-time (browser) |
| Want offline access on the road | Add IndexedDB cache + background sync |
| Pinyin (vs code-point) sort for Chinese titles | ✅ DONE 2026-05-29 — client-side `localeCompare('zh')` |
| ~~Bangumi added~~ | ✅ DONE 2026-05-29 — full integration (search + add-by-Chinese + enricher) |
| ~~TMDB added~~ | ✅ DONE 2026-05-29 — movies + TV/drama. First Worker-side (key-bearing) source; titles via `translations`, region via `origin_country`, kind-prefixed conflict key. **IGDB** still pending |

---

## Open items not yet decided

- Exact filter/sort options beyond type, region, status (e.g. sort by date added vs date updated vs alphabetical)
- Whether to track watch history (timeline of progress events) or only current state
- Genre / tag support (genres come from APIs for free; question is whether to expose as filters)
- Notes / review / rating fields beyond `notes` text
- Mobile-specific UX (gesture-driven episode increment? swipe to mark complete?)

These can be decided incrementally as you use v1.
