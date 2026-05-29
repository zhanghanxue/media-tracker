// Phase 12 import parser. Turns the personal media list (娱乐列表.md) into
// normalized, source-agnostic records the matcher can resolve. PURE — no I/O —
// so it's unit-tested against real lines; the CLI (scripts/import.ts) reads the
// file and the matcher/runner consume parseList()'s output.
//
// The list is markdown:
//   # 动画:          ## 日漫：      ← top header = type(+status), sub = region
//   * 海贼王    905                  ← bullet: title + trailing progress
//   * 间谍过家家(2,3)                ← bracket = a series (members 2 & 3)
//   * RWBY/红白黑黄                  ← "/" = alternate titles
//   # 动画(已看完):                  ← "已看完" → status completed; completed
//   * 死神   火影   公主恋人          ←   sections pack 2-3 works per line (tabs)
//   * [神界:原罪(2)](https://…)  P1   ← a markdown link = a watched playthrough
//
// Disambiguation that depends on the section (not the line):
//   • completed sections → tab/2-space-separated tokens are SEPARATE works.
//   • in-progress sections → first token is the work, the rest is its progress.
// (Both use tabs; only the section tells "second work" from "progress note".)

import type {
  MediaConsumptionMode,
  MediaPlatform,
  MediaStatus,
  MediaType,
} from "../../src/worker/db/schema";

export interface ParsedProgress {
  /** The raw annotation as written (e.g. "905", "第8卷", "P1", "230309"). */
  raw: string;
  /** Parsed current episode, when the annotation is a plain count. */
  episode?: number;
  /** Parsed current chapter/volume, for books. */
  chapter?: number;
  /** Anything we couldn't parse to a number (game progress, dates, "07上"). */
  text?: string;
}

export interface ParsedEntry {
  type: MediaType;
  status: MediaStatus;
  region: string | null;
  platform: MediaPlatform | null;
  consumptionMode: MediaConsumptionMode | null;
  /** Primary search title (first of any "/"-separated alternates). */
  title: string;
  /** Remaining "/"-separated alternates (extra search terms). */
  altTitles: string[];
  /** Bracket members → a series (e.g. ["2","3"], ["王国之泪","织梦岛"]). [] = standalone. */
  parts: string[];
  progress: ParsedProgress | null;
  /** A video URL from a markdown link (watched playthrough), else null. */
  videoUrl: string | null;
  /** 1-based source line, for the review queue's traceability. */
  line: number;
}

interface SectionContext {
  type: MediaType;
  status: MediaStatus;
  region: string | null;
  platform: MediaPlatform | null;
}

// Section header → type/status/region/platform. Type comes from the top header
// (动画/漫画/游戏/综艺/轻小说/电视剧/电影); the sub header refines region (and,
// under 动画, can switch to anime-movie; under 游戏, sets the platform).
export function deriveContext(top: string, sub: string | null): SectionContext {
  const status: MediaStatus = /已看完/.test(top) ? "completed" : "planned";

  let type: MediaType;
  if (/动画电影/.test(top)) type = "movie";
  else if (/动画/.test(top)) type = "animation";
  else if (/漫画/.test(top)) type = "manga";
  else if (/轻小说/.test(top)) type = "light_novel";
  else if (/游戏/.test(top)) type = "game";
  else if (/综艺/.test(top)) type = "variety";
  else if (/电视剧/.test(top)) type = "drama";
  else if (/电影/.test(top)) type = "movie";
  else type = "animation";

  let region: string | null = type === "animation" ? "japan" : null;
  let platform: MediaPlatform | null = null;

  const s = sub ?? "";
  // Region from the sub-header. 港台 (HK/Taiwan) is deliberately left null —
  // it's ambiguous and the source/Bangumi infobox resolves it better.
  if (/日漫|日本|日剧/.test(s)) region = "japan";
  else if (/国漫|国产|大陆|内地/.test(s)) region = "china";
  else if (/韩/.test(s)) region = "korea";
  else if (/欧美|美/.test(s)) region = "usa";
  else if (/英/.test(s)) region = "uk";
  else if (/港台|港|台/.test(s)) region = null;

  // Under 动画, a 电影 sub-section is anime films → movie (keep the anime region).
  if (/电影/.test(s) && type === "animation") type = "movie";
  if (/手游/.test(s)) platform = "mobile";

  return { type, status, region, platform };
}

const BULLET = /^\s*[*\-]\s+/;
// Column / progress separator: a tab, or 2+ spaces (single spaces stay inside
// titles like "Yuri on ICE"). Full-width spaces count too.
const SEP = /(?:\t|　{2,}| {2,})+/;

export function parseList(markdown: string): ParsedEntry[] {
  const lines = markdown.split(/\r?\n/);
  let top = "";
  let sub: string | null = null;
  const out: ParsedEntry[] = [];

  lines.forEach((line, i) => {
    const header = line.match(/^(#{1,6})\s*(.*)$/);
    if (header) {
      const level = header[1]!.length;
      const text = header[2]!.trim();
      if (level === 1) {
        top = text;
        sub = null;
      } else {
        sub = text;
      }
      return;
    }
    if (!BULLET.test(line) || !top) return;
    out.push(...parseBulletLine(line, deriveContext(top, sub), i + 1));
  });

  return out;
}

function parseBulletLine(
  line: string,
  ctx: SectionContext,
  lineNo: number,
): ParsedEntry[] {
  // Strip the bullet marker and trailing markdown line-break spaces/backslashes.
  const body = line.replace(BULLET, "").replace(/[\\\s]+$/, "").trim();
  if (!body) return [];

  // A markdown link → a single watched-playthrough work: [title](url) + progress.
  const link = body.match(/^\[([^\]]+)\]\(([^)]+)\)\s*(.*)$/);
  if (link) {
    const [, label, url, rest] = link;
    return [makeEntry(ctx, label!, parseProgress(rest!, ctx.type), url!, lineNo)];
  }

  const raw = body.split(SEP).map((t) => t.trim()).filter(Boolean);
  // A title and its bracket are occasionally split by a tab ("转生史莱姆\t(1,)").
  // Re-attach a token that's just a dangling "(…)" to the previous work.
  const tokens: string[] = [];
  for (const tok of raw) {
    if (/^[(（]/.test(tok) && tokens.length > 0) {
      tokens[tokens.length - 1] += tok;
    } else {
      tokens.push(tok);
    }
  }
  if (tokens.length === 0) return [];

  const entries =
    ctx.status === "completed"
      ? // Completed sections lay out multiple works per line (tab columns).
        tokens.map((tok) => makeEntry(ctx, tok, null, null, lineNo))
      : // In-progress: one work + an optional trailing progress note.
        [
          makeEntry(
            ctx,
            tokens[0]!,
            parseProgress(tokens.slice(1).join(" "), ctx.type),
            null,
            lineNo,
          ),
        ];
  // Drop any entry that didn't yield a title (defensive — shouldn't happen now).
  return entries.filter((e) => e.title.trim() !== "");
}

function makeEntry(
  ctx: SectionContext,
  rawWork: string,
  progress: ParsedProgress | null,
  videoUrl: string | null,
  lineNo: number,
): ParsedEntry {
  const { title, altTitles, parts } = parseWork(rawWork);

  // A game watched via a video link is "watching"; other games default to
  // "playing"; non-games have no consumption mode.
  const consumptionMode: MediaConsumptionMode | null =
    ctx.type !== "game" ? null : videoUrl ? "watching" : "playing";

  // First recorded progress on a to-watch item means it's in progress.
  const status: MediaStatus =
    ctx.status === "completed"
      ? "completed"
      : progress
        ? "in_progress"
        : "planned";

  return {
    type: ctx.type,
    status,
    region: ctx.region,
    platform: ctx.platform,
    consumptionMode,
    title,
    altTitles,
    parts,
    progress,
    videoUrl,
    line: lineNo,
  };
}

// Split a work into its base title (+ "/" alternates) and bracket members.
export function parseWork(raw: string): {
  title: string;
  altTitles: string[];
  parts: string[];
} {
  const work = unescape(raw.trim());
  // The first (…) / （…） is the series bracket; the base is everything before.
  const m = work.match(/^(.*?)[(（](.+)[)）]\s*$/);
  let base = work;
  let parts: string[] = [];
  if (m) {
    base = m[1]!.trim();
    parts = splitParts(m[2]!);
  }
  const alts = base
    .split(/[/／]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    title: alts[0] ?? base,
    altTitles: alts.slice(1),
    parts,
  };
}

// Split bracket content on top-level commas, keeping {…} groups intact
// (e.g. "地下城:{main,丛林觉醒}" stays one member). Drops empty members from a
// trailing comma like "(1,)".
function splitParts(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of inner) {
    if (ch === "{" || ch === "｛") depth += 1;
    else if (ch === "}" || ch === "｝") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === "，") && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

export function parseProgress(
  raw: string,
  type: MediaType,
): ParsedProgress | null {
  const r = unescape(raw.trim());
  if (!r) return null;

  const isBook = type === "manga" || type === "light_novel";

  let m: RegExpMatchArray | null;
  if ((m = r.match(/第\s*(\d+)\s*卷/))) return { raw: r, chapter: Number(m[1]) };
  if ((m = r.match(/第?\s*(\d+)\s*[话話]/))) return { raw: r, chapter: Number(m[1]) };
  if ((m = r.match(/第?\s*(\d+)\s*[集話]/))) return { raw: r, episode: Number(m[1]) };

  // A bare count (< 6 digits, so a 6-digit date like 230309 stays text) → the
  // current episode (or chapter for books).
  if (/^\d{1,5}$/.test(r)) {
    return isBook ? { raw: r, chapter: Number(r) } : { raw: r, episode: Number(r) };
  }

  // Everything else (game progress "P1", dates, "07上") is free text.
  return { raw: r, text: r };
}

// Undo markdown escapes (\! \( \& …) the list uses.
function unescape(s: string): string {
  return s.replace(/\\([!()[\]{}&\\/])/g, "$1");
}
