// Phase 12 bulk-add — the GATED, production-writing stage. Reads the confirmed
// review.csv, takes only the AUTO rows, and adds them to the live library via
// the same /api/media flow the app uses. Authenticated with a Cloudflare Access
// SERVICE TOKEN (CF-Access-Client-Id/Secret) so the script can reach the gated
// app. DRY-RUN by default — it prints the plan and POSTs nothing; --commit does
// the writes. Idempotent: the app's (source, external_id) 409 means a re-run
// skips what's already there.
//
// Source handling (matches the app's own add semantics):
//   tmdb + drama/variety → add the WHOLE show → all current seasons (so seasons
//     newer than the list come along); tmdb + movie → the movie.
//   igdb → the game (watching if it had a video link, else playing).
//   anilist → fetch the media object (browser-direct) and post it.
//   bangumi + anime/manga/LN → resolve to the canonical AniList entry by native
//     name (add-by-Chinese), else add Bangumi-direct; other bangumi → direct.
// Progress + Chinese title are backfilled with a follow-up PATCH where known.

import { searchAniList, getAniListDetail } from "../../src/worker/sources/anilist";
import { getBangumiSubject } from "../../src/worker/sources/bangumi";
import { pickAniListMatch, pickLatinAlias } from "../../src/worker/sources/bangumi-mapper";
import { parseProgress } from "./parse";
import type { MediaType } from "../../src/worker/db/schema";

export interface AutoRow {
  line: string;
  type: MediaType;
  status: string;
  source: string;
  id: string;
  title: string;
  parts: string[];
  progressRaw: string;
  watching: boolean;
}

// Column indexes in REVIEW_HEADERS.
const COL = {
  line: 0, type: 1, status: 2, parts: 5, title: 6, progress: 8, video: 9,
  bucket: 10, source: 11, id: 12,
} as const;

/** Extract the AUTO data rows from a parsed review.csv (skips labels/headers/other buckets). */
export function autoRows(rows: string[][]): AutoRow[] {
  return rows
    .filter((r) => r[COL.bucket] === "auto" && r[COL.id])
    .map((r) => ({
      line: r[COL.line] ?? "",
      type: r[COL.type] as MediaType,
      status: r[COL.status] || "planned",
      source: r[COL.source] ?? "",
      id: r[COL.id] ?? "",
      title: r[COL.title] ?? "",
      parts: (r[COL.parts] ?? "").split("|").filter(Boolean),
      progressRaw: r[COL.progress] ?? "",
      watching: r[COL.video] === "yes",
    }));
}

const isBook = (t: MediaType) => t === "manga" || t === "light_novel";
const isAniListType = (t: MediaType) => t === "animation" || isBook(t);
const isTvShow = (t: MediaType) => t === "drama" || t === "variety";

export type PlanKind =
  | "tmdb-show"
  | "tmdb-movie"
  | "igdb"
  | "anilist"
  | "bangumi-resolve"
  | "bangumi-direct"
  | "unknown";

/** Pure classification of a row → what the commit step will do (for the dry-run). */
export function classify(row: AutoRow): PlanKind {
  if (row.source === "tmdb") return isTvShow(row.type) ? "tmdb-show" : "tmdb-movie";
  if (row.source === "igdb") return "igdb";
  if (row.source === "anilist") return "anilist";
  if (row.source === "bangumi") return isAniListType(row.type) ? "bangumi-resolve" : "bangumi-direct";
  return "unknown";
}

export const PLAN_LABEL: Record<PlanKind, string> = {
  "tmdb-show": "TMDB show → all seasons",
  "tmdb-movie": "TMDB movie",
  igdb: "IGDB game",
  anilist: "AniList (direct)",
  "bangumi-resolve": "Bangumi → resolve to AniList (else direct)",
  "bangumi-direct": "Bangumi-direct",
  unknown: "??? (no source)",
};

// --- Execution deps (injected, so the loop is testable / the HTTP is one place) ---

export interface AddDeps {
  // POST/PATCH/GET against the live app (service-token-authenticated).
  post: (path: string, body: unknown) => Promise<{ status: number; json: any }>;
  patch: (path: string, body: unknown) => Promise<{ status: number; json: any }>;
  tmdbSeasons: (id: string) => Promise<Array<{ season_number: number }>>;
  simplify: (s: string) => string;
}

export type AddOutcome = "added" | "exists" | "skipped" | "error";

// Resolve a Bangumi subject to a canonical AniList media (or null), à la add-by-Chinese.
async function resolveAniList(subject: any, type: MediaType) {
  const latin = pickLatinAlias(subject.infobox);
  const aniType = isBook(type) ? "MANGA" : "ANIME";
  const targets = [subject.name, latin];
  for (const q of [String(subject.name ?? "").normalize("NFKC"), latin].filter(Boolean) as string[]) {
    try {
      const results = await searchAniList(q, aniType, { perPage: 10 });
      const m = pickAniListMatch(targets, results);
      if (m) return m;
    } catch {
      /* try next query */
    }
  }
  return null;
}

export async function addEntry(row: AutoRow, deps: AddDeps): Promise<AddOutcome> {
  const status = row.status;
  try {
    if (row.source === "tmdb") {
      if (isTvShow(row.type)) {
        const seasons = await deps.tmdbSeasons(row.id);
        const targets =
          seasons.length > 1 ? seasons.map((s) => s.season_number) : [undefined];
        for (const sn of targets) {
          await deps.post("/api/media", {
            external_source: "tmdb", status,
            media: { id: Number(row.id), media_type: "tv", ...(sn !== undefined ? { season_number: sn } : {}) },
          });
        }
      } else {
        await deps.post("/api/media", {
          external_source: "tmdb", status, media: { id: Number(row.id), media_type: "movie" },
        });
      }
      return "added";
    }

    if (row.source === "igdb") {
      await deps.post("/api/media", {
        external_source: "igdb", status,
        media: { id: Number(row.id), consumption_mode: row.watching ? "watching" : "playing", platform: null },
      });
      return "added";
    }

    if (row.source === "anilist") {
      const media = await getAniListDetail(Number(row.id), isBook(row.type) ? "MANGA" : "ANIME");
      if (!media) return "skipped";
      const res = await deps.post("/api/media", { external_source: "anilist", status, media });
      await backfill(res.json, row, deps, null);
      return res.status === 409 ? "exists" : "added";
    }

    // bangumi
    const subject = await getBangumiSubject(Number(row.id));
    if (!subject) return "skipped";
    if (isAniListType(row.type)) {
      const match = await resolveAniList(subject, row.type);
      if (match) {
        const res = await deps.post("/api/media", { external_source: "anilist", status, media: match });
        await backfill(res.json, row, deps, subject.name_cn ?? null);
        return res.status === 409 ? "exists" : "added";
      }
    }
    const res = await deps.post("/api/media", { external_source: "bangumi", status, media: subject });
    await backfill(res.json, row, deps, null);
    return res.status === 409 ? "exists" : "added";
  } catch {
    return "error";
  }
}

// After an add, PATCH the current episode/chapter (from the list's progress note)
// and a Simplified Chinese title (when we resolved a Bangumi subject to AniList,
// which ships no Chinese title). Best-effort — never fails the add.
async function backfill(
  added: { id?: number; current_episode?: number | null; current_chapter?: number | null },
  row: AutoRow,
  deps: AddDeps,
  chineseFromBangumi: string | null,
): Promise<void> {
  if (!added?.id) return;
  const patch: Record<string, unknown> = {};
  const prog = parseProgress(row.progressRaw, row.type);
  if (prog?.episode && !added.current_episode) patch.current_episode = prog.episode;
  if (prog?.chapter && !added.current_chapter) patch.current_chapter = prog.chapter;
  if (chineseFromBangumi) patch.title_chinese = deps.simplify(chineseFromBangumi.trim());
  if (Object.keys(patch).length === 0) return;
  try {
    await deps.patch(`/api/media/${added.id}`, patch);
  } catch {
    /* best-effort */
  }
}
