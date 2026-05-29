import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { useAniListSearch } from "../hooks/useAniListSearch";
import { useBangumiSearch } from "../hooks/useBangumiSearch";
import { useTmdbSearch } from "../hooks/useTmdbSearch";
import { useIgdbSearch } from "../hooks/useIgdbSearch";
import { useAddMedia } from "../hooks/useAddMedia";
import { useAddByChinese } from "../hooks/useAddByChinese";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { titleInLibrary, useLibraryTitleIndex } from "../hooks/useLibraryTitles";
import { bangumiCover } from "../lib/bangumiSearch";
import type { IgdbGame } from "../lib/igdbSearch";
import { autoLinkAniListSeries } from "../lib/seriesAutoLink";
import { TmdbResultRow } from "./TmdbResultRow";
import { IgdbResultRow } from "./IgdbResultRow";
import {
  fetchTmdbSeasons,
  tmdbDisplayTitle,
  tmdbOriginalTitle,
  type TmdbKind,
  type TmdbSearchResultRaw,
} from "../lib/tmdbSearch";
import { addMedia, type AniListSearchItem, type SearchType } from "../lib/api";
import type { BangumiSubject, BangumiType } from "../../worker/sources/bangumi";
import type { MediaConsumptionMode, MediaPlatform, MediaStatus } from "../../worker/db/schema";
import type { MediaRow } from "../lib/types";

// Where to search. AniList = English/Japanese (canonical, anime/manga). Bangumi =
// search by Chinese name (donghua/manhua AniList lacks). TMDB = movies/drama.
// IGDB = games. TMDB + IGDB are key-bearing → the Worker holds the key and
// fetches detail on add (the browser sends only ids + the user's choices).
type Source = "anilist" | "bangumi" | "tmdb" | "igdb";

// Statuses offered at add-time (paused is an edit-time state, omitted here).
const ADD_STATUSES: MediaStatus[] = [
  "planned",
  "in_progress",
  "completed",
  "dropped",
];

function metaLine(item: AniListSearchItem): string {
  const parts: string[] = [];
  if (item.format) parts.push(item.format);
  if (item.seasonYear) parts.push(String(item.seasonYear));
  if (item.episodes) parts.push(`${item.episodes} ep`);
  else if (item.chapters) parts.push(`${item.chapters} ch`);
  return parts.join(" · ");
}

export function AddMediaModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [source, setSource] = useState<Source>("anilist");
  const [searchType, setSearchType] = useState<SearchType>("ANIME");
  // Bangumi has its own sub-type: 2 anime/donghua · 1 book · 6 live-action (影视).
  const [bgmType, setBgmType] = useState<BangumiType>(2);
  const [tmdbKind, setTmdbKind] = useState<TmdbKind>("movie");
  // Games: are you Playing it (free-text progress) or Watching a playthrough
  // (episode counts)? Chosen once here; per-result platform is on the row.
  const [gameMode, setGameMode] = useState<MediaConsumptionMode>("playing");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<MediaStatus>("planned");
  const debouncedQuery = useDebouncedValue(input, 300);

  // Only the active source's query is non-empty, so only it fetches.
  const aniSearch = useAniListSearch(
    source === "anilist" ? debouncedQuery : "",
    searchType,
  );
  const bgmSearch = useBangumiSearch(
    source === "bangumi" ? debouncedQuery : "",
    bgmType,
  );
  const tmdbSearch = useTmdbSearch(
    source === "tmdb" ? debouncedQuery : "",
    tmdbKind,
  );
  const igdbSearch = useIgdbSearch(source === "igdb" ? debouncedQuery : "");

  const addMutation = useAddMedia();
  const addByChinese = useAddByChinese();
  const libraryTitles = useLibraryTitleIndex();
  const queryClient = useQueryClient();
  // The show whose seasons are being bulk-added (disables its button meanwhile).
  const [addingAllId, setAddingAllId] = useState<number | null>(null);
  // Transient note when a just-added anime auto-grouped into a series.
  const [autoLinkNotice, setAutoLinkNotice] = useState<string | null>(null);

  // After an AniList add (direct, or resolved from a Bangumi pick), try to group
  // the new row with a sequel/prequel already in the library. Best-effort.
  const runAutoLink = async (row: MediaRow) => {
    try {
      const res = await autoLinkAniListSeries(row);
      if (res.linked) {
        setAutoLinkNotice(res.created ? t("add.autoGrouped") : t("add.autoLinked"));
        void queryClient.invalidateQueries({ queryKey: ["media"] });
      }
    } catch {
      // Grouping is a convenience — never let it surface as an add failure.
    }
  };

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // AniList + TMDB both go through addMutation; only one source renders at a time.
  const pendingAddId = addMutation.isPending
    ? addMutation.variables?.media.id
    : undefined;
  const pendingBangumiId = addByChinese.isPending
    ? addByChinese.variables?.subject.id
    : undefined;

  const handleAdd = (item: AniListSearchItem) => {
    setAutoLinkNotice(null);
    addMutation.mutate(
      { external_source: "anilist", status, media: item },
      { onSuccess: (row) => void runAutoLink(row) },
    );
  };
  const handleAddBangumi = (subject: BangumiSubject) => {
    setAutoLinkNotice(null);
    // The Bangumi pick may resolve to a canonical AniList row; if so, auto-link
    // it too (runAutoLink no-ops for Bangumi-direct rows).
    addByChinese.mutate({ subject, status }, { onSuccess: (row) => void runAutoLink(row) });
  };
  const handleAddTmdb = (item: TmdbSearchResultRaw) => {
    addMutation.mutate({
      external_source: "tmdb",
      status,
      media: { id: item.id, media_type: tmdbKind },
    });
  };
  const handleAddIgdb = (game: IgdbGame, platform: MediaPlatform | null) => {
    addMutation.mutate({
      external_source: "igdb",
      status,
      media: { id: game.id, consumption_mode: gameMode, platform },
    });
  };
  const handleAddTmdbSeason = (item: TmdbSearchResultRaw, seasonNumber: number) => {
    addMutation.mutate({
      external_source: "tmdb",
      status,
      media: { id: item.id, media_type: "tv", season_number: seasonNumber },
    });
  };

  // The TMDB add currently in flight (show or season), to disable its button.
  const pendingTmdb =
    addMutation.isPending && addMutation.variables?.external_source === "tmdb"
      ? addMutation.variables.media
      : undefined;
  const pendingIgdbId =
    addMutation.isPending && addMutation.variables?.external_source === "igdb"
      ? addMutation.variables.media.id
      : undefined;

  // "Add" on a TV show splits it into seasons (what the user wants — not one row
  // with all episodes summed). A single-season show is added as one plain row.
  const handleAddTmdbShow = async (item: TmdbSearchResultRaw) => {
    setAddingAllId(item.id);
    try {
      const seasons = await fetchTmdbSeasons(item.id);
      if (seasons.length <= 1) {
        await addMedia({
          external_source: "tmdb",
          status,
          media: { id: item.id, media_type: "tv" },
        });
      } else {
        for (const s of seasons) {
          await addMedia({
            external_source: "tmdb",
            status,
            media: { id: item.id, media_type: "tv", season_number: s.season_number },
          });
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["media"] });
    } finally {
      setAddingAllId(null);
    }
  };

  const search =
    source === "anilist"
      ? aniSearch
      : source === "tmdb"
        ? tmdbSearch
        : source === "igdb"
          ? igdbSearch
          : bgmSearch;
  const placeholder =
    source === "anilist"
      ? t("add.searchPlaceholder")
      : source === "tmdb"
        ? t("add.searchPlaceholderTmdb")
        : source === "igdb"
          ? t("add.searchPlaceholderIgdb")
          : t("add.searchPlaceholderBangumi");
  const emptyMessage =
    source === "anilist"
      ? t("add.empty")
      : source === "tmdb"
        ? t("add.emptyTmdb")
        : source === "igdb"
          ? t("add.emptyIgdb")
          : t("add.emptyBangumi");

  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm ${
      active
        ? "bg-blue-600 text-white"
        : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 light:bg-zinc-100 light:text-zinc-600 light:hover:bg-zinc-200"
    }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-16"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-zinc-700 light:bg-white light:ring-zinc-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("add.title")}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 p-4 light:border-zinc-200">
          <h2 className="text-base font-semibold">{t("add.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("add.close")}
            className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-800 light:text-zinc-500 light:hover:bg-zinc-100"
          >
            ✕
          </button>
        </div>

        {/* Controls */}
        <div className="space-y-3 border-b border-zinc-800 p-4 light:border-zinc-200">
          {/* Source: AniList (EN/JP) · Bangumi (中文) · TMDB (影视) */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSource("anilist")}
              className={tabClass(source === "anilist")}
            >
              {t("add.sourceAniList")}
            </button>
            <button
              type="button"
              onClick={() => setSource("bangumi")}
              className={tabClass(source === "bangumi")}
            >
              {t("add.sourceBangumi")}
            </button>
            <button
              type="button"
              onClick={() => setSource("tmdb")}
              className={tabClass(source === "tmdb")}
            >
              {t("add.sourceTmdb")}
            </button>
            <button
              type="button"
              onClick={() => setSource("igdb")}
              className={tabClass(source === "igdb")}
            >
              {t("add.sourceIgdb")}
            </button>
          </div>

          {/* Sub-type toggle: Movie/TV for TMDB; Anime/Book/影视 for Bangumi
              (it also catches live-action); Anime/Manga for AniList. */}
          {source === "tmdb" ? (
            <div className="flex gap-2">
              {(["movie", "tv"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setTmdbKind(kind)}
                  className={tabClass(tmdbKind === kind)}
                >
                  {t(kind === "movie" ? "add.movie" : "add.tv")}
                </button>
              ))}
            </div>
          ) : source === "igdb" ? (
            <div className="flex gap-2">
              {(["playing", "watching"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setGameMode(mode)}
                  className={tabClass(gameMode === mode)}
                >
                  {t(mode === "playing" ? "add.playing" : "add.watching")}
                </button>
              ))}
            </div>
          ) : source === "bangumi" ? (
            <div className="flex gap-2">
              {([2, 1, 4, 6] as const).map((bt) => (
                <button
                  key={bt}
                  type="button"
                  onClick={() => setBgmType(bt)}
                  className={tabClass(bgmType === bt)}
                >
                  {t(
                    bt === 2
                      ? "add.anime"
                      : bt === 1
                        ? "add.manga"
                        : bt === 4
                          ? "type.game"
                          : "add.liveAction",
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex gap-2">
              {(["ANIME", "MANGA"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setSearchType(type)}
                  className={tabClass(searchType === type)}
                >
                  {t(type === "ANIME" ? "add.anime" : "add.manga")}
                </button>
              ))}
            </div>
          )}

          <input
            type="search"
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none light:border-zinc-300 light:bg-white light:text-zinc-900 light:placeholder:text-zinc-400"
          />

          <label className="flex items-center gap-2 text-sm text-zinc-300 light:text-zinc-600">
            {t("add.statusLabel")}
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as MediaStatus)}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100 light:border-zinc-300 light:bg-white light:text-zinc-900"
            >
              {ADD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4">
          {(addMutation.isError || addByChinese.isError) && (
            <p className="mb-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400 light:text-red-600">
              {t("add.addFailed")}
            </p>
          )}
          {autoLinkNotice && (
            <p className="mb-3 rounded-md bg-blue-500/10 px-3 py-2 text-xs text-blue-300 light:text-blue-700">
              {autoLinkNotice}
            </p>
          )}
          {debouncedQuery.trim().length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {emptyMessage}
            </p>
          ) : search.isPending ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {t("add.searching")}
            </p>
          ) : search.isError ? (
            <p className="py-8 text-center text-sm text-red-400 light:text-red-600">
              {t("add.error")}
            </p>
          ) : source === "anilist" ? (
            aniSearch.data!.results.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500">
                {t("add.noResults")}
              </p>
            ) : (
              <ul className="space-y-2">
                {aniSearch.data!.results.map((item) => (
                  <li
                    key={item.id}
                    className="flex gap-3 rounded-md p-2 hover:bg-zinc-800 light:hover:bg-zinc-100"
                  >
                    <div className="h-20 w-14 shrink-0 overflow-hidden rounded bg-zinc-800 light:bg-zinc-100">
                      {item.coverImage.extraLarge && (
                        <img
                          src={item.coverImage.extraLarge}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {item.title.romaji ??
                          item.title.english ??
                          item.title.native}
                      </p>
                      {item.title.english &&
                        item.title.english !== item.title.romaji && (
                          <p className="truncate text-xs text-zinc-400 light:text-zinc-500">
                            {item.title.english}
                          </p>
                        )}
                      {item.title.native && (
                        <p className="truncate text-xs text-zinc-400 light:text-zinc-500">
                          {item.title.native}
                        </p>
                      )}
                      <p className="text-xs text-zinc-500">{metaLine(item)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {item.alreadyAdded ? (
                        <span className="rounded px-2 py-1 text-xs text-zinc-500">
                          {t("add.alreadyAdded")}
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleAdd(item)}
                            disabled={pendingAddId === item.id}
                            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                          >
                            {pendingAddId === item.id
                              ? t("add.adding")
                              : t("add.addButton")}
                          </button>
                          {titleInLibrary(libraryTitles, [
                            item.title.native,
                            item.title.romaji,
                            item.title.english,
                          ]) && (
                            <span className="text-[10px] text-amber-400 light:text-amber-600">
                              {t("add.maybeInLibrary")}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : source === "tmdb" ? (
            tmdbSearch.data!.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500">
                {t("add.noResults")}
              </p>
            ) : (
              <ul className="space-y-2">
                {tmdbSearch.data!.map((item) => (
                  <TmdbResultRow
                    key={item.id}
                    item={item}
                    kind={tmdbKind}
                    maybeInLibrary={titleInLibrary(libraryTitles, [
                      tmdbDisplayTitle(item),
                      tmdbOriginalTitle(item),
                    ])}
                    pendingShow={
                      tmdbKind === "tv"
                        ? addingAllId === item.id
                        : pendingTmdb?.id === item.id &&
                          pendingTmdb.season_number === undefined
                    }
                    pendingSeason={
                      pendingTmdb?.id === item.id &&
                      pendingTmdb.season_number != null
                        ? pendingTmdb.season_number
                        : null
                    }
                    onAddShow={() =>
                      tmdbKind === "tv"
                        ? handleAddTmdbShow(item)
                        : handleAddTmdb(item)
                    }
                    onAddSeason={(n) => handleAddTmdbSeason(item, n)}
                  />
                ))}
              </ul>
            )
          ) : source === "igdb" ? (
            igdbSearch.data!.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500">
                {t("add.noResults")}
              </p>
            ) : (
              <ul className="space-y-2">
                {igdbSearch.data!.map((game) => (
                  <IgdbResultRow
                    key={game.id}
                    game={game}
                    maybeInLibrary={titleInLibrary(libraryTitles, [game.name])}
                    pending={pendingIgdbId === game.id}
                    onAdd={(platform) => handleAddIgdb(game, platform)}
                  />
                ))}
              </ul>
            )
          ) : bgmSearch.data!.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {t("add.noResults")}
            </p>
          ) : (
            <ul className="space-y-2">
              {bgmSearch.data!.map((s) => {
                const cover = bangumiCover(s);
                return (
                  <li
                    key={s.id}
                    className="flex gap-3 rounded-md p-2 hover:bg-zinc-800 light:hover:bg-zinc-100"
                  >
                    <div className="h-20 w-14 shrink-0 overflow-hidden rounded bg-zinc-800 light:bg-zinc-100">
                      {cover && (
                        <img
                          src={cover}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {s.name_cn || s.name}
                      </p>
                      {s.name_cn && s.name && s.name !== s.name_cn && (
                        <p className="truncate text-xs text-zinc-400 light:text-zinc-500">
                          {s.name}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <button
                        type="button"
                        onClick={() => handleAddBangumi(s)}
                        disabled={pendingBangumiId === s.id}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                      >
                        {pendingBangumiId === s.id
                          ? t("add.adding")
                          : t("add.addButton")}
                      </button>
                      {titleInLibrary(libraryTitles, [s.name, s.name_cn]) && (
                        <span className="text-[10px] text-amber-400 light:text-amber-600">
                          {t("add.maybeInLibrary")}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
