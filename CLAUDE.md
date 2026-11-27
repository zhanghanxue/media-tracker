# Media Tracker — Project Context for AI Agents

Personal media tracker for one user (single-user web app, accessed from PC and phone). Tracks manga, light novels, animation (anime / donghua / Western cartoon), drama (C-drama / K-drama / J-drama / etc.), movies, and games (with mobile/console/PC/handheld/arcade platform discriminator).

**Repo:** [github.com/zhanghanxue/media-tracker](https://github.com/zhanghanxue/media-tracker) (public)

---

## Read these before implementing or testing

1. **[PLAN.md](./PLAN.md)** — 13-phase build order (Prerequisites + Phase 0–12) with per-phase deliverables and acceptance criteria. **Implement phases sequentially.** Each phase is self-contained.
2. **[DESIGN.md](./DESIGN.md)** — 16 locked architectural decisions + full SQL schema. Read before changing the data model, schema, or stack.
3. **[PRD.md](./PRD.md)** — Problem statement, ~58 user stories, implementation + testing decisions summary, out-of-scope items, domain glossary.
4. **[TESTING.md](./TESTING.md)** — Test strategy by module class. **Mandatory reading before writing any test.** Tells you when to TDD vs spec-first vs test-after, what to mock vs not, what patterns look like tests but aren't.

---

## How to know which phase to work on

Default: ask the user which phase. Or check `git log` against PLAN.md's Phase 0–12 list to infer the next uncompleted phase. If the user says "implement the next phase," it's the lowest-numbered phase whose deliverables aren't committed yet.

---

## Stack (locked — don't change without re-grilling)

- **Frontend:** React + Vite + TypeScript
- **Server:** Hono on Cloudflare Workers
- **Database:** Cloudflare D1 (SQLite on edge)
- **Object storage:** Cloudflare R2 (cover images)
- **Auth:** Cloudflare Access (Zero Trust reverse-proxy)
- **i18n:** `react-i18next`, locales `en` + `zh-Hans` (Simplified Chinese)
- **Testing:** Vitest + `@cloudflare/vitest-pool-workers`

---

## Key constraints to respect

- **Single user.** No multi-user features, no user management, no sharing.
- **Server-of-record web app.** No local-first / sync architecture (deliberately rejected during design).
- **Auth at the edge, never in the app.** Worker reads `Cf-Access-Jwt-Assertion` header; no password/JWT/session code in the app.
- **No premature abstraction across metadata sources.** Each source (AniList, TMDB, IGDB, Bangumi) stands alone. A unified `MetadataSource` interface emerges (if it makes sense) only *after* the second source ships — not before.
- **No React component tests in v1.** UI churn rate is too high; component tests calcify. Reintroduce at v2 via Playwright e2e for 3-5 core flows once UX stabilizes.
- **Use real D1 in tests** via `@cloudflare/vitest-pool-workers`. Never mock the database.
- **Mock only at external boundaries** — AniList GraphQL endpoint, upstream image fetch URL. Never mock internal modules.
- **Don't add coverage tracking, thresholds, or `--coverage` flags.** v1 policy is no coverage gate. See TESTING.md § Coverage policy.
- **Bilingual UI is from day 1.** Every user-visible string goes through `t()` — no hardcoded English strings. This is much cheaper than retrofitting.

---

## Type taxonomy (6 types)

`animation, manga, light_novel, drama, movie, game`

- `animation` covers anime + donghua + Western cartoon, discriminated by `region`
- `drama` covers C-drama / K-drama / J-drama / Tw-drama / Thai-drama / etc., discriminated by `region`
- `game` further discriminated by `platform` (`mobile` / `console` / `pc` / `handheld` / `arcade`) AND `consumption_mode` (`playing` / `watching`)

`media_video_parts` child table is used **only for games in watching mode** (mobile-game plot walkthroughs on Bilibili routinely scatter across separate uploads, not playlists). Other watching-content types (animation, drama) track via episode numbers, not URLs.

---

## Deep modules — the unit of work

The six modules in PRD.md § "Implementation Decisions → Deep modules" are the units of work. Build them per the TESTING.md strategy:

| Module class | Strategy | Modules |
|---|---|---|
| Pure functions | **TDD** | `TitleDisplay`, `FilterQueryBuilder`, `AnilistMapper` |
| Repository | **Spec-first hybrid** | `MediaRepository` |
| External integrations | **Test-after with captured fixtures** | `AnilistClient`, `CoverStorage` |
| Worker handlers (Hono routes) | **Integration test via pool-workers** | (route handlers, not deep modules) |
| React components | **No tests in v1** | (UI layer) |

---

## Sister project for stack reference

`D:/Projects/java-knowledge-flashcard` on this dev machine uses the same stack (React + Vite + Vitest + Hono + Cloudflare Workers). **Copy its scaffolding patterns where they fit** — wrangler.toml shape, vite.config.ts plugin setup, tsconfig.json, package.json scripts. Saves re-inventing scaffolding.

---

## Author identity

- GitHub: `zhanghanxue`
- Email for commits: `17045734+zhanghanxue@users.noreply.github.com` (per-repo, already configured in `.git/config` — don't override globally)

---

## What NOT to do

- **Don't commit secrets or personal data — this repository is public.** No API keys, tokens, `.dev.vars`, personal e-mail addresses, or private material (study notes, personal lists). Check every commit before it leaves the machine.
- **Don't introduce a new framework / build tool / state library** beyond DESIGN.md § 15 ("Frontend stack — Reuse existing")
- **Don't add features beyond the user stories in PRD.md** — if a user asks for something missing, flag it as out-of-scope or as a v2 candidate
- **Don't ship multiple metadata API integrations in one phase** — the A.2 sequential-ship architecture is the explicit decision. AniList ships first, alone. TMDB, IGDB, Bangumi come in their own later phases.
- **Don't add the `video_url` column back to the `media` table** — it was deliberately moved to the `media_video_parts` child table. The child table handles both single-URL and multi-URL cases uniformly.
- **Don't merge phases** — each phase ships independently and gets reviewed independently
- **Don't skip Phase 11 (dogfood)** — it's the entire point of the sequential-ship architecture; skipping it defeats the design choice
- **Don't unify the metadata APIs into a shared interface in v1** — see "No premature abstraction" above
- **Don't change the schema without updating DESIGN.md § "Proposed schema (v1)" in the same commit** — DESIGN.md is the source of truth for the schema

---

## Common questions / quick references

| Question | Answer |
|---|---|
| Where does the database schema live? | `DESIGN.md` § "Proposed schema (v1)" — canonical. Migration files mirror it. |
| Where do API contracts live? | `PLAN.md` per phase — each endpoint phase specifies request/response shapes. |
| Where do the user stories live? | `PRD.md` § "User Stories" — 58 numbered stories. |
| How do I write a test for module X? | `TESTING.md` § "Approach by module class" — find X's class, follow the strategy. |
| Should I prototype this UI first? | Only if the UX pattern is genuinely uncertain. Most v1 UI patterns are specified (Letterboxd-style filter sidebar + grid layout). Skip prototyping unless the user explicitly asks for it. |
| Should I use TDD for this code? | TDD only for pure functions per TESTING.md. Don't use it universally. |
