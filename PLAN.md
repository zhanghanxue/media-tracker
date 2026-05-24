# Media Tracker — Implementation Plan (v1)

Phase-by-phase build order to ship v1. Each phase is a self-contained chunk you can hand to Claude Code with the section title as the prompt context. Designed for the AI-writes-code-and-I-review workflow.

**Reference:** [DESIGN.md](./DESIGN.md) — the locked design decisions this plan implements.

---

## Prerequisites (one-time setup)

Before any code:

- [ ] **Cloudflare account** (free tier sufficient) — sign up at `dash.cloudflare.com`
- [ ] **A domain managed by Cloudflare DNS** — Cloudflare Access requires a custom domain proxied through CF. The `*.workers.dev` subdomain that Workers gives you for free does **not** work with Zero Trust Access reliably. If you don't have a domain, register one (Cloudflare Registrar is fine, ~$10/yr for `.com`) or transfer DNS for one you already own.
- [ ] **Cloudflare Zero Trust enabled** on the account (free for up to 50 users)
- [ ] **Node.js 20+** and **npm** on the dev machine (you already have Node 25)
- [ ] **`wrangler` CLI** installed globally or use `npx wrangler` (recommended: `npm i -g wrangler`)
- [ ] **AniList**: no account or API key needed; their GraphQL endpoint is public

**Decision point inside this phase:** what's the production domain? (`media.yourname.com`? something else?) This decides the Access policy hostname and the Worker route.

---

## Phase 0 — Project scaffolding

**Goal:** initialize a React + Vite + TypeScript + Hono + Cloudflare Workers project in the existing folder, with D1 + R2 bindings declared.

**Deliverables:**
- `package.json` with dependencies: `react`, `react-dom`, `hono`, `i18next`, `react-i18next`, `vite`, `vitest`, `@cloudflare/vite-plugin`, `@cloudflare/workers-types`, `typescript`, `wrangler`
- `vite.config.ts` with the Cloudflare Vite plugin (mirrors what `java-knowledge-flashcard` does — copy the pattern)
- `wrangler.toml` declaring:
  - the Worker name (`media-tracker`)
  - D1 database binding (named `DB`)
  - R2 bucket binding (named `COVERS`)
  - environment vars stub for any future secrets
- `tsconfig.json`, `tsconfig.node.json`
- `src/worker/index.ts` (empty Hono app skeleton)
- `src/client/` — Vite-React entry, empty App component
- `.gitignore` (`node_modules`, `.wrangler`, `dist`, `.env*`)
- `index.html`

**Decisions inside:**
- **Package manager:** stick with `npm` (your other project uses it, lockfile already familiar) unless you want to switch
- **Wrangler env:** start with a single environment; add `staging` only if you feel friction

**Acceptance:**
- `npm run dev` starts both Vite frontend and Worker locally via the Cloudflare Vite plugin
- `curl http://localhost:8787/api/health` (or whatever local port the plugin chooses) returns a JSON response from the Worker
- `npm run build` succeeds with no errors

**Reference for the AI agent:** the existing `D:/Projects/java-knowledge-flashcard` project has the same stack working — copy its scaffolding patterns rather than inventing from scratch.

---

## Phase 1 — Worker shell + Cloudflare Access auth

**Goal:** deploy a minimal Worker behind Cloudflare Access; verify that requests without a valid CF Access JWT are rejected.

**Deliverables:**
- `wrangler.toml`: route configured for the production domain
- Cloudflare Access policy configured (via Cloudflare dashboard) — application type "self-hosted", hostname = your chosen domain, policy = "allow email == <your-email>"
- `src/worker/middleware/auth.ts`: reads `Cf-Access-Jwt-Assertion` header, optionally verifies the JWT signature against CF's JWKS (recommended for defense-in-depth — CF blocks unauthorized requests at the edge, but verifying in-app prevents bypass if someone misconfigures the route)
- `GET /api/health` returns `{ ok: true, user: <email-from-header> }`
- Deployed to Cloudflare (`wrangler deploy`)

**Decisions inside:**
- **JWT verification:** verify signature in the Worker, or trust the CF header? Recommendation: **verify**. CF Access at the edge is the primary defense, but in-Worker verification prevents bypass scenarios (e.g., if someone removes the Access policy or changes the route). ~20 lines of code using `jose` library or CF's own helper.
- **CF Access: AUD Tag vs Application ID (gotcha — burned us in v1).** The dashboard exposes two similar-looking identifiers per application:
  - `Application ID` — UUID format (e.g. `b2140886-3d76-460c-bb0d-6c304f996ec4`)
  - `Application Audience (AUD) Tag` — 64-char hex (e.g. `6677cb04ab4c526c4091ca4edb1aca98a395188dd2cbe34e029222076d630abd`)

  The JWT issued for authenticated requests carries the **AUD Tag** in its `aud` claim, NOT the Application ID. `jose.jwtVerify({ audience: <Application ID> })` rejects every valid token with `JWTClaimValidationFailed`. The value passed to `jwtVerify` must be the 64-char hex one. Sanity check: hitting the production URL unauth'd produces a 302 redirect whose `kid` query parameter exposes the actual AUD tag CF Access uses for this app — if `config.ts` doesn't match that string, JWT verification will fail.
- **Local dev auth bypass:** when running `npm run dev`, you won't have CF Access. Add a `LOCAL_DEV_BYPASS=1` env var that injects a fake user header — but disable in production.

**Acceptance:**
- `curl https://<domain>/api/health` from a browser logged in via CF Access returns OK
- `curl https://<domain>/api/health` without CF Access cookies returns 401/redirect
- Local `npm run dev` works without CF Access (bypass active)

---

## Phase 2 — Schema + D1 migration

**Goal:** create the `media` and `media_video_parts` tables in D1, apply via `wrangler d1 migrations apply`.

**Deliverables:**
- `migrations/0001_create_media.sql` — copy the full schema from `DESIGN.md` § "Proposed schema (v1)". This includes:
  - `media` table (with `platform` column for games and all five indexes: `type+status`, `region`, `date_updated`, `platform`)
  - `media_video_parts` child table (with foreign key to `media` and `ON DELETE CASCADE`)
  - Index on `media_video_parts(media_id)`
- `wrangler.toml`: add `[[d1_databases]]` entry pointing at a real D1 database (create it first via `wrangler d1 create media-tracker-db`)
- A `package.json` script: `"db:migrate": "wrangler d1 migrations apply media-tracker-db"`
- Run migration locally (via `--local` flag) and on production

**Decisions inside:**
- **Single migration file vs split:** put both tables (`media`, `media_video_parts`) in `0001_create_media.sql`. They're co-created and the foreign key requires `media` to exist first; one file with statements in the right order is cleaner than splitting into `0001_` + `0002_`.
- **Indexes:** the schema in DESIGN.md proposes five indexes. Confirm these match your most-common query patterns. If you anticipate filtering by `external_source` (e.g. "show me everything from AniList"), add an index on that too.
- **Naming convention for migrations:** stick with the `NNNN_description.sql` pattern wrangler expects.
- **Foreign key enforcement:** SQLite requires `PRAGMA foreign_keys = ON` per-connection for `ON DELETE CASCADE` to actually cascade. D1 enables this by default in production but verify in tests — the cascade behavior on `media_video_parts` when a `media` row is deleted is part of the contract.

**Acceptance:**
- `wrangler d1 execute media-tracker-db --command='SELECT name FROM sqlite_master WHERE type="table"'` shows both `media` and `media_video_parts` tables locally and on production
- A test row can be inserted into `media`, plus 2-3 child rows into `media_video_parts`, and selected back via a JOIN
- Deleting the parent `media` row cascades and removes the child `media_video_parts` rows (verifies foreign-key behavior)

---

## Phase 3 — AniList GraphQL client

**Goal:** typed AniList client for two operations: search by title, fetch detail by ID.

**Deliverables:**
- `src/worker/sources/anilist.ts` exporting:
  - `searchAniList(query: string, type: 'ANIME' | 'MANGA'): Promise<AniListSearchResult[]>`
  - `getAniListDetail(id: number, type: 'ANIME' | 'MANGA'): Promise<AniListDetail>`
- TypeScript types for AniList's `Media` response (only the fields you need: `id`, `title.{romaji,english,native}`, `coverImage.extraLarge`, `episodes`, `chapters`, `volumes`, `format`, `season`, `seasonYear`, `countryOfOrigin`)
- A mapping function: `aniListToMediaRow(detail: AniListDetail, status: Status): Partial<MediaRow>` — maps AniList's response to your schema (type discriminator logic: format='MANGA' or 'NOVEL' → `type='manga'`/`'light_novel'`; everything else for ANIME → `type='animation'`; region from `countryOfOrigin`)
- Unit tests with mocked AniList responses (a few real captured responses saved as JSON fixtures in `test/fixtures/anilist/`)

**Decisions inside:**
- **GraphQL client choice:** raw `fetch` with a typed wrapper is fine — don't pull in `graphql-request` or `urql` for two queries. Hand-write the query strings.
- **Rate limit handling:** AniList caps at ~90 req/min. Add a simple retry-with-backoff on 429. For search-as-you-type later, debounce on the client.
- **Light novel vs manga distinction:** AniList's `format` field has values `NOVEL` (light novel) and `MANGA` / `ONE_SHOT` / `MANHWA` / `MANHUA`. Map `NOVEL` → `light_novel`, all others under `MANGA` type → `manga`. (Yes, this means manhua technically gets `type='manga'` — it's a different media but uses the same data shape. If you want to disambiguate later, region tells you.)

**Acceptance:**
- `searchAniList('鬼滅の刃', 'ANIME')` returns at least one result with romaji "Kimetsu no Yaiba"
- `getAniListDetail(101922, 'ANIME')` returns the full detail
- All unit tests pass with mocked responses

---

## Phase 4 — R2 cover-upload pipeline

**Goal:** internal function that takes an upstream image URL, downloads it, uploads to R2, returns the public R2 URL.

**Deliverables:**
- `src/worker/storage/covers.ts` exporting:
  - `uploadCoverToR2(env: Env, sourceUrl: string, mediaId: string | number): Promise<string>` — fetches `sourceUrl`, puts to R2 under key like `covers/<mediaId>.<ext>`, returns the resulting URL
- R2 bucket setup: create the bucket via `wrangler r2 bucket create media-tracker-covers`; configure a custom domain or use the R2.dev public URL
- Idempotency: same `mediaId` + same source URL → don't re-upload if already in R2 (check via `env.COVERS.head(key)`)
- Error handling: if upstream fetch fails, return the upstream URL as fallback (graceful degradation)

**Decisions inside:**
- **R2 access pattern:** public bucket (via R2.dev URL or custom domain) vs signed URLs per request? **Public** for cover images — they're not sensitive, and signed URLs add latency. Use a custom subdomain (`covers.yourdomain.com`) for cleanliness.
- **Image transformation:** resize to a max dimension at upload time, or store original and use Cloudflare Image Transformations on the fly? For v1, **store original.** Image Transformations cost extra; covers are already small.
- **Key naming:** `covers/{mediaId}.jpg` or `covers/{external_source}/{external_id}.jpg`? The second is more durable if you ever rebuild the DB — recommend that pattern.

**Acceptance:**
- Given a real AniList cover URL, `uploadCoverToR2` returns a working R2 URL that displays in a browser
- Calling it twice for the same `(source, external_id)` is a no-op on the second call (no re-upload)
- Upstream 404s don't break the flow — fallback URL is returned

---

## Phase 5 — POST /api/media (add)

**Goal:** add a new media item by fetching from the source API + uploading cover + inserting row.

**Deliverables:**
- `POST /api/media` endpoint accepting body:
  ```json
  {
    "external_source": "anilist",
    "external_id": 101922,
    "type": "animation",
    "status": "planned"
  }
  ```
- Server-side flow:
  1. Fetch detail from the appropriate source (currently only AniList wired up)
  2. Map to schema row
  3. Upload cover to R2 → get R2 URL
  4. Insert row to D1
  5. Return the inserted row
- Validation: required fields, valid enums (type, status)
- Conflict handling: if `(external_source, external_id)` already exists, return 409 with the existing row (don't duplicate)

**Decisions inside:**
- **Idempotency key:** use `(external_source, external_id)` as a soft unique constraint. Worth adding a UNIQUE index in a follow-up migration if you want DB-level enforcement.
- **What about non-AniList sources?** This endpoint is generic — it just needs `external_source` to know which API to call. For v1 it only supports `anilist`; calling with other sources returns 501 Not Implemented. Add TMDB / IGDB / Bangumi in their own phases later.

**Acceptance:**
- `POST /api/media` with a valid AniList ID inserts a row, uploads a cover, returns the full record
- A second POST with the same `(source, external_id)` returns the existing row + 409 status
- Invalid type/status returns 400 with a clear error

---

## Phase 6 — GET /api/media (list, filter, search)

**Goal:** list endpoint with all the filters from DESIGN.md § 14.

**Deliverables:**
- `GET /api/media` accepting query params:
  - `type[]` (repeatable: `?type=animation&type=manga`)
  - `region[]`
  - `status[]`
  - `q` (search query — applies LIKE across the 4 title columns)
  - `sort` (default: `date_updated DESC`)
  - `limit` (default 50, max 200)
  - `offset`
- SQL: builds the WHERE clause from the params; AND across facets, OR within (matches DESIGN.md decision)
- Response: `{ items: MediaRow[], total: number }`
- `GET /api/media/:id` for single-record fetch (useful for detail view later)

**Decisions inside:**
- **Pagination style:** offset-based for v1 (simpler). Switch to cursor-based only if the library grows past ~10k and offset queries get slow.
- **Total count:** return as a separate `total` field. For a list page with pagination, useful. Slight perf cost (extra COUNT query); negligible at your scale.

**Acceptance:**
- `GET /api/media?type=animation&region=japan&status=in_progress` returns only Japanese animation currently in progress
- `GET /api/media?q=demon` matches "Demon Slayer", "Demon's Souls", etc.
- `GET /api/media?q=鬼滅` matches "鬼滅の刃" via `title_native LIKE`

---

## Phase 7 — React shell + i18n

**Goal:** the UI scaffold: list page, filter sidebar, search bar, language toggle. **i18n wired in from the start** so no retrofit later.

**Deliverables:**
- `src/client/App.tsx` — layout with header (title + language toggle), sidebar (filters), main (list)
- `src/client/components/FilterSidebar.tsx` — checkbox groups for type / region / status
- `src/client/components/MediaList.tsx` — grid of MediaCard components
- `src/client/components/MediaCard.tsx` — cover image, title (using `displayTitle` helper), status badge, progress text
- `src/client/components/SearchBar.tsx` — debounced text input that updates the query param
- `src/client/i18n.ts` — i18next config with browser language detection + localStorage persistence
- `src/client/locales/en.json` and `src/client/locales/zh-Hans.json` — every UI string keyed
- `src/client/lib/displayTitle.ts` — implements the title display rules from DESIGN.md § 7:
  ```ts
  function displayTitle(media: MediaRow, lang: 'en' | 'zh'): string {
    if (lang === 'zh') return media.title_chinese ?? media.title_native ?? media.title_english ?? '';
    return media.title_english ?? media.title_romaji ?? media.title_native ?? '';
  }
  ```
- Language toggle component: a button or dropdown that calls `i18n.changeLanguage()` and persists choice
- State management: **React Query** (`@tanstack/react-query`) for server state. Don't reach for Redux/Zustand for v1 — server state via React Query covers 95% of needs.

**Decisions inside:**
- **Styling:** Tailwind? CSS modules? Plain CSS? Recommendation: **Tailwind** for speed (CF Workers + Vite supports it well via `@tailwindcss/vite`). Tell Claude Code explicitly if you want something else.
- **Mobile layout:** sidebar collapses to a drawer on narrow viewports. Use a CSS-only solution (peer/sibling selectors or a CSS-driven `details/summary` element); don't pull in a UI library for one drawer.
- **Cover image lazy loading:** use native `loading="lazy"` attribute on `<img>` tags.

**Acceptance:**
- Open the app in browser → list of media rendered with covers, titles, status
- Click checkbox in sidebar → list re-fetches with filter applied
- Type in search bar → results filter
- Click language toggle → all UI chrome flips between English and Simplified Chinese; titles preferentially shown in the toggled language

---

## Phase 8 — Add-media modal (AniList search → add)

**Goal:** UI to add a new item: type a title, see AniList matches, pick one, add it.

**Deliverables:**
- `src/client/components/AddMediaModal.tsx`
- Search input → debounced call to `GET /api/anilist/search?q=...&type=...` (new endpoint — proxy to AniList from the Worker, since AniList's GraphQL endpoint doesn't have CORS configured for arbitrary origins)
- Search type picker: ANIME / MANGA (since we're AniList-only in v1)
- Results list: cover, romaji + english + native titles, format, year, episodes
- Click a result → POST /api/media with the type/source/id → close modal → list refreshes
- Status selector at add-time: planned / in_progress / completed / dropped

**Decisions inside:**
- **Search debounce delay:** 300ms is a sane default
- **Empty state:** when no query, show a "type to search AniList" message
- **Already-added detection:** when results come back, check if the user already has each one — show "Already in library" instead of an Add button

**Acceptance:**
- Click "Add" button → modal opens
- Type "鬼滅" → AniList results appear within a second
- Click "Add to library" on a result → row appears in main list, modal closes

---

## Phase 9 — PATCH /api/media/:id (update progress / status)

**Goal:** backend endpoint to update mutable fields.

**Deliverables:**
- `PATCH /api/media/:id` accepting any subset of:
  - `status`
  - `current_episode`, `total_episodes`
  - `current_chapter`, `total_chapters`
  - `game_progress`
  - `consumption_mode`
  - `video_url`
  - `notes`
  - `is_rewatching`
- Server bumps `date_updated` on every PATCH
- Returns the updated row
- Validation: enum checks, integer checks, no nulling out required fields

**Decisions inside:**
- **Auto-status transition:** when `current_episode === total_episodes`, automatically set `status='completed'`? Recommend **yes**, with a manual override. Saves a tap.
- **Audit log / history:** v1 stores only current state. If you later want a timeline ("when did I finish each anime?"), that's a v2 child table — flag it in DESIGN.md known v2 hatches.

**Acceptance:**
- `PATCH /api/media/123 { current_episode: 5 }` updates the row, bumps date_updated
- `PATCH /api/media/123 { status: 'banana' }` returns 400
- When `current_episode = total_episodes`, status auto-transitions to `completed`

---

## Phase 10 — Progress increment UX

**Goal:** make updating progress one tap on mobile.

**Deliverables:**
- MediaCard component: show `current_episode / total_episodes` (or `current_chapter / total_chapters`, or `game_progress`) as a tappable element
- For episodic types: a "+1" button next to the progress display → calls PATCH with incremented value
- For games in playing mode: tap progress → opens a small inline editor for the free-text field
- Optimistic update: increment the number immediately in the UI, roll back if the request fails
- Long-press / right-click on progress → opens detail editor (set arbitrary episode, change status, edit notes)

**Decisions inside:**
- **Optimistic updates implementation:** React Query supports this natively via `onMutate` + `setQueryData`. Use that.
- **Touch target sizing:** the +1 button must be ≥44px square on mobile — Apple's HIG minimum. Don't compromise this for visual density.

**Acceptance:**
- On mobile: tap +1 → episode number increments, no full page reload, request goes out in background
- If you're on the last episode and tap +1: status flips to completed
- Long-press / right-click opens the detail editor

---

## Phase 11 — Deploy + dogfood (1–2 weeks)

**Goal:** use the v1 app as the actual primary tracker. Learn what's missing / annoying before building more.

**Activity, not a code deliverable:**
- `wrangler deploy` → app is live
- Add 30–50 items manually via the AniList search flow — your most-recent / currently-watching list
- Use the filters, the search, the progress increment on both PC and phone
- Keep a running list of frictions in a file (or just at the bottom of PLAN.md)
- After ~2 weeks: prioritize the friction list. Some become Phase 12+ work; some become trivial polish; some get deferred.

**Why this phase is mandatory:** the whole point of A.2 (sequential ship) is to gather real-usage signal before integrating the next API. Skipping this defeats the architecture choice.

**Likely findings (predict-then-verify):** progress increment is great on phone but slow when you watch 5 episodes in one sitting (need a +N option); the language toggle's title fallback rules feel wrong in N% of cases; filter combinations you didn't anticipate become muscle-memory; the sort needs more options than just `date_updated DESC`.

---

## Phase 12 — Bulk import from Google Doc (AniList subset)

**Goal:** migrate the anime/manga/LN portion of your 1000+-entry Google Doc into the live app.

**Deliverables:**
- Export your Google Doc to CSV (manual, one-time)
- `scripts/import.ts` — a Node script (not a Worker) that:
  1. Parses the CSV
  2. For each row tagged as anime/manga/LN: searches AniList by title (fuzzy)
  3. Picks the top match if confidence is high; flags low-confidence matches to a `review.csv` for you to manually resolve
  4. For each confirmed match: calls `POST /api/media` on your deployed app (passing through the CF Access cookie or a service token)
- Handles partial failure: writes a `progress.json` so reruns resume from where they left off

**Decisions inside:**
- **Auth for the script:** the cleanest path is a CF Access service token (Zero Trust → Service Auth → generate token). The script sets `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers. Documented in CF's Zero Trust docs.
- **Match confidence threshold:** start at 0.85 similarity (string-distance based); tune from there. Anything below goes to manual review.
- **Rate limiting:** AniList allows ~90 req/min. Throttle the script: ~1 req/second is safe.

**Acceptance:**
- Run `npm run import -- ./my-google-doc.csv` → progress logged per row; review.csv produced for ambiguous matches
- After resolution + re-run: all anime/manga/LN rows from the Doc are in the live app
- Counts match: rows in CSV ≈ rows in `media` table (minus low-confidence ones still awaiting review)

---

## After v1 ships

The whole v1 build is **AniList-only**. Subsequent integrations slot in incrementally:

1. **TMDB** (week 3?): movies, drama, Western cartoons. Same pattern as Phase 3 (new client) + Phase 5 (extend POST endpoint to handle source='tmdb') + Phase 8 (search picker gains TMDB option). No new schema work.
2. **IGDB** (week 4?): games. Includes the games-specific UI: consumption mode selector at add-time, `video_url` field on the form, free-text `game_progress` editor.
3. **Bangumi** (week 5?): enricher. Add a background job (or per-item button) that fetches the Chinese title from Bangumi for items where `title_chinese IS NULL` and `external_source = 'anilist'`.

The DESIGN.md "Known v2 escape hatches" table is the durable list of upgrades to consider once usage feedback says they matter.

---

## How to use this plan with Claude Code

For each phase:

1. Open Claude Code in this directory
2. Reference the phase by name: *"Implement Phase 0 from PLAN.md."* Claude will read the section.
3. Claude implements; you review the diff before committing.
4. Run the phase's acceptance checks before merging.
5. Commit, push, move to the next phase.

For phases that involve external setup (CF Access policy, DNS, R2 buckets), Claude can guide you through the dashboard clicks but cannot perform them directly — be ready to flip between Claude and the Cloudflare dashboard.
