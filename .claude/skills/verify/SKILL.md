---
name: verify
description: Build/launch/drive recipe for verifying media-tracker changes end-to-end in the browser.
---

# Verifying media-tracker

## Launch

```bash
npm run dev          # vite + cloudflare plugin, serves app AND worker API on http://localhost:5173
```

- Local D1 lives in `.wrangler/state/v3/d1` and already has demo seed data
  (a few anime/games/collections, ~5 in-progress items). No migration step
  needed unless the state dir was wiped (`npm run db:migrate:local`).
- Auth is bypassed locally (`LOCAL_DEV_BYPASS` via `.dev.vars`), so
  `curl http://localhost:5173/api/media?limit=2` works immediately — use it to
  confirm the server + DB are up before driving the UI.
- Startup takes ~10s (vite ready line appears in the output).

## Drive

Use the Chrome browser tools on `http://localhost:5173/`. Flows worth driving:

- **Home**: default view, sidebar type list, hint line above the grid.
- **Collections**: click a collection card body (not the ⚙) to drill in;
  browser back walks out (History API, no router — URL never changes).
- **Sidebar**: type click → facet view (region/genre/status); "← All types"
  returns.
- **Recommend modal**: header ✨ Recommend. `animation` hits real AniList from
  the BROWSER (needs network); movie/drama/variety/game need TMDB/Twitch keys
  in `.dev.vars`.
- **Add**: POSTs to local D1 only — safe, but it does mutate the local demo
  library.

## Gotchas

- The header "↻ Update episodes" button fires real TMDB/AniList calls and
  writes episode counts to the local DB — easy to hit by accident when
  clicking near the header.
- Page zoom changes between screenshots shift click coordinates — re-screenshot
  after any layout change before clicking.
- Prod diagnosis is READ-ONLY (see auto-memory): never POST to
  media.zhanghanxue.com — local dev only for mutation flows.
