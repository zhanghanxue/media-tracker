# Media Tracker

A bilingual (English / 简体中文) personal media tracker for films, drama, anime, manga, donghua, light novels and games — built as a single-user app on Cloudflare's edge stack, with a Letterboxd-style filter sidebar and grid.

## What it does

- Track what you've watched, read and played across seven media types, with status tracking, ratings and per-type detail.
- Filter and browse your library through a dense sidebar of filters (type, genre, status, source) over a poster grid.
- Bilingual UI built in from the start (i18next), with Chinese title conversion (OpenCC) and pinyin-aware sorting.
- Cover images stored in R2 and served from a dedicated custom domain.
- External metadata pulled from AniList, TMDB, IGDB and Bangumi behind a deliberately sequential integration design — each source is queried in a defined order so the best-quality data wins.

## Architecture

| Layer | Choice |
|---|---|
| Front end | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query |
| API | [Hono](https://hono.dev/) on Cloudflare Workers |
| Data | Cloudflare D1 (edge SQLite) with SQL migrations; covers in R2 |
| Auth | Cloudflare Access at the edge — the app itself does no auth (single-user by design) |
| i18n | react-i18next, opencc-js, pinyin-pro |

## Testing

Vitest with `@cloudflare/vitest-pool-workers` — integration tests run against a **real local D1 database**, not mocks, so SQL, migrations and query behaviour are exercised as they ship.

## Running locally

```bash
npm install
npm run db:migrate:local   # apply D1 migrations locally
npm run dev                # Vite dev server
npm test                   # Vitest (real D1 via workers-pool)
npm run typecheck
```

## Deployment

`npm run deploy` builds and ships the Worker to a custom domain via Wrangler. The live instance is a personal deployment behind Cloudflare Access — there is no public demo by design; the point of this repo is the code.

## Project docs

For maintainers: `PRD.md` / `PRD-v2.md` (product), `PLAN.md`, `DESIGN.md`, `TESTING.md`.
