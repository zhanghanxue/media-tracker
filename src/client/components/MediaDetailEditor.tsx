import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { useUpdateMedia } from "../hooks/useUpdateMedia";
import { useDeleteMedia } from "../hooks/useDeleteMedia";
import { useRefreshCover } from "../hooks/useRefreshCover";
import { useCollections } from "../hooks/useCollections";
import { BangumiTitlePicker } from "./BangumiTitlePicker";
import { AniListTitlePicker, type PickedAniListTitles } from "./AniListTitlePicker";
import { IgdbLinkPicker, type PickedIgdbGame } from "./IgdbLinkPicker";
import { VideoPartsEditor } from "./VideoPartsEditor";
import { CollectionEditor } from "./CollectionEditor";
import { CollectionPicker } from "./CollectionPicker";
import { mediaProgress } from "../lib/progress";
import { REGION_FACETS, TYPE_FACETS } from "../lib/facets";
import { fetchMediaList, type MediaFilters } from "../lib/api";
import {
  childCollections,
  collectionName,
  directItems,
} from "../lib/collections";
import { displayTitle, uiLangFromI18n } from "../lib/displayTitle";
import { linkedSourcesOf } from "../lib/crossRef";
import type { MediaPatch } from "../../worker/api/patch-media";
import type {
  MediaConsumptionMode,
  MediaPlatform,
  MediaStatus,
  MediaType,
} from "../../worker/db/schema";
import type { Collection, MediaRow } from "../lib/types";

// The whole, unfiltered library — used to derive collection display names in the
// picker (so auto-named collections aren't all "(untitled)").
// Matches App's EMPTY_FILTERS exactly so the query key reuses the library the
// main list already loaded (no extra full-library fetch).
const ALL_LIBRARY_FILTERS: MediaFilters = {
  types: [],
  regions: [],
  statuses: [],
  genres: [],
  q: "",
  sort: "date_updated",
};

const STATUSES: MediaStatus[] = [
  "planned",
  "in_progress",
  "completed",
  "dropped",
  "paused",
];

const PLATFORMS: MediaPlatform[] = [
  "pc",
  "console",
  "handheld",
  "mobile",
  "arcade",
];

// Long-press / right-click editor for a card: change status, set an arbitrary
// episode/chapter number, edit notes. Only changed fields are PATCHed.
export function MediaDetailEditor({
  media,
  onClose,
}: {
  media: MediaRow;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const update = useUpdateMedia();
  const del = useDeleteMedia();
  const refreshCover = useRefreshCover();
  const lang = uiLangFromI18n(i18n.language);
  const headerTitle = displayTitle(media, lang);

  const handleDelete = () => {
    if (!window.confirm(t("editor.confirmDelete"))) return;
    del.mutate(media.id, { onSuccess: onClose });
  };

  // Picking an AniList entry both fills the Latin titles AND persists the link as
  // anilist_id (PRD-v2 Issue A — previously only the titles were saved, so the
  // link silently vanished). Skip the link write when AniList is already this
  // row's primary source (its id is in external_id; nothing to cross-reference).
  const handleAniListPick = (picked: PickedAniListTitles) => {
    if (picked.english) setTitleEnglish(picked.english);
    if (picked.romaji) setTitleRomaji(picked.romaji);
    if (media.external_source !== "anilist") setAnilistId(String(picked.id));
    setShowAniListPicker(false);
  };

  // Feature C: link a game (typically Bangumi-sourced) to its IGDB entry. Stores
  // igdb_id only — Bangumi stays the source of record.
  const handleIgdbPick = (game: PickedIgdbGame) => {
    if (media.external_source !== "igdb") setIgdbId(String(game.id));
    setShowIgdbPicker(false);
  };

  const isGame = media.type === "game";
  // Game-only fields, staged here and saved with the rest. Declared before
  // isGamePlaying since the progress field's visibility depends on the mode.
  const [consumptionMode, setConsumptionMode] = useState<MediaConsumptionMode>(
    media.consumption_mode ?? "playing",
  );
  const [platform, setPlatform] = useState<MediaPlatform | "">(
    media.platform ?? "",
  );
  // Reactive to the in-editor consumption-mode toggle so the progress field
  // shows/hides as you switch Playing ↔ Watching.
  const isGamePlaying = isGame && consumptionMode === "playing";

  const kind = mediaProgress(media).kind; // episodes | chapters | text | none
  const dimension = isGamePlaying
    ? null
    : kind === "chapters"
      ? "chapter"
      : kind === "episodes"
        ? "episode"
        : null;
  const initialCount =
    dimension === "chapter"
      ? media.current_chapter
      : dimension === "episode"
        ? media.current_episode
        : null;
  // Read-only season/series total shown beside the editable current count.
  const total =
    dimension === "chapter"
      ? media.total_chapters
      : dimension === "episode"
        ? media.total_episodes
        : null;

  const [status, setStatus] = useState<MediaStatus>(media.status);
  // Type is editable: TMDB files every tv show as "drama", so reality shows come
  // in mistyped and the user re-classifies them (e.g. drama → variety).
  const [type, setType] = useState<MediaType>(media.type);
  const [count, setCount] = useState(
    initialCount != null ? String(initialCount) : "",
  );
  const [gameProgress, setGameProgress] = useState(media.game_progress ?? "");
  const [notes, setNotes] = useState(media.notes ?? "");
  // Chinese title + region: manual-correction escape hatch when a Bangumi
  // enrichment (or its default region "china") got it wrong.
  const [titleChinese, setTitleChinese] = useState(media.title_chinese ?? "");
  const [titleEnglish, setTitleEnglish] = useState(media.title_english ?? "");
  const [titleRomaji, setTitleRomaji] = useState(media.title_romaji ?? "");
  const [region, setRegion] = useState(media.region ?? "");
  const [showPicker, setShowPicker] = useState(false);
  const [showAniListPicker, setShowAniListPicker] = useState(false);
  // Cross-reference links (migration 0008), staged like the titles and saved with
  // the rest. anilist_id for anime/manga (Issue A); igdb_id for games (Feature C).
  const [anilistId, setAnilistId] = useState(media.anilist_id ?? "");
  const [igdbId, setIgdbId] = useState(media.igdb_id ?? "");
  const [showIgdbPicker, setShowIgdbPicker] = useState(false);
  // Optional drama/variety video-links add-on, collapsed by default.
  const [showVideoLinks, setShowVideoLinks] = useState(false);

  // Collection placement. Applies IMMEDIATELY (its own mutation), separate from
  // the Save button. collection_id is just a placement pointer — it never
  // touches the entry's own data.
  const [collectionId, setCollectionId] = useState(media.collection_id);
  const [showColPicker, setShowColPicker] = useState(false);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const { data: collections = [] } = useCollections();
  // The whole library so we can show the CURRENT collection's DERIVED name
  // (auto-named ones would otherwise read "(untitled)"). Unfiltered, shared cache.
  const { data: colLibrary } = useQuery({
    queryKey: ["media", ALL_LIBRARY_FILTERS, null],
    queryFn: () => fetchMediaList(ALL_LIBRARY_FILTERS),
  });
  const colItems = colLibrary?.items ?? [];

  const invalidateTree = () => {
    void queryClient.invalidateQueries({ queryKey: ["media"] });
    void queryClient.invalidateQueries({ queryKey: ["collections"] });
  };
  const assignCollection = (id: string | null) => {
    setCollectionId(id);
    update.mutate(
      { id: media.id, patch: { collection_id: id } },
      { onSuccess: invalidateTree },
    );
    setShowColPicker(false);
  };
  const colLabel = (c: Collection) =>
    collectionName(
      c,
      directItems(colItems, c.id),
      childCollections(collections, c.id).map((g) => g.name ?? ""),
      lang,
      t("collection.untitled"),
    );
  const currentCollection = collections.find((c) => c.id === collectionId) ?? null;
  // Seed the picker with a Latin title (best for Bangumi's v0 search).
  const pickerQuery =
    media.title_english ?? media.title_romaji ?? media.title_native ?? "";

  // If the current region isn't one of the curated facets, keep it selectable.
  const regionOptions =
    region && !REGION_FACETS.includes(region)
      ? [region, ...REGION_FACETS]
      : REGION_FACETS;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = () => {
    const patch: MediaPatch = {};
    if (status !== media.status) patch.status = status;
    if (type !== media.type) patch.type = type;
    if (notes !== (media.notes ?? "")) patch.notes = notes === "" ? null : notes;
    if (titleChinese !== (media.title_chinese ?? "")) {
      patch.title_chinese = titleChinese.trim() === "" ? null : titleChinese.trim();
    }
    if (titleEnglish !== (media.title_english ?? "")) {
      patch.title_english = titleEnglish.trim() === "" ? null : titleEnglish.trim();
    }
    if (titleRomaji !== (media.title_romaji ?? "")) {
      patch.title_romaji = titleRomaji.trim() === "" ? null : titleRomaji.trim();
    }
    if (region !== (media.region ?? "")) {
      patch.region = region === "" ? null : region;
    }

    // Cross-reference links (Issue A / Feature C) — included only when changed.
    const stagedAnilist = anilistId.trim() === "" ? null : anilistId.trim();
    if (stagedAnilist !== (media.anilist_id ?? null)) {
      patch.anilist_id = stagedAnilist;
    }
    const stagedIgdb = igdbId.trim() === "" ? null : igdbId.trim();
    if (stagedIgdb !== (media.igdb_id ?? null)) {
      patch.igdb_id = stagedIgdb;
    }

    if (isGame) {
      if (consumptionMode !== media.consumption_mode) {
        patch.consumption_mode = consumptionMode;
      }
      const plat = platform === "" ? null : platform;
      if (plat !== (media.platform ?? null)) patch.platform = plat;
    }

    if (isGamePlaying) {
      if (gameProgress !== (media.game_progress ?? "")) {
        patch.game_progress = gameProgress === "" ? null : gameProgress;
      }
    } else if (dimension) {
      const parsed = count.trim() === "" ? null : Math.max(0, Math.floor(Number(count)));
      const current =
        dimension === "chapter" ? media.current_chapter : media.current_episode;
      if (parsed !== current && Number.isFinite(parsed ?? 0)) {
        if (dimension === "chapter") patch.current_chapter = parsed;
        else patch.current_episode = parsed;
      }
    }

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    update.mutate(
      { id: media.id, patch },
      {
        onSuccess: () => {
          // A type change can move the item in/out of a type-filtered view and
          // shifts the per-type genre facets, so refetch both (a normal save's
          // in-place update would otherwise leave a filtered list stale).
          if (patch.type) {
            void queryClient.invalidateQueries({ queryKey: ["media"] });
            void queryClient.invalidateQueries({ queryKey: ["facets"] });
          }
          onClose();
        },
      },
    );
  };

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[85vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-lg bg-zinc-900 p-4 ring-1 ring-zinc-700 light:bg-white light:ring-zinc-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("editor.title")}
      >
        <div>
          <h2 className="text-base font-semibold leading-snug">
            {headerTitle || t("editor.title")}
          </h2>
          {/* Always show the native title as a secondary line (incl. Chinese
              mode) when it differs from the primary shown. */}
          {media.title_native && media.title_native !== headerTitle && (
            <p className="mt-0.5 text-xs text-zinc-400 light:text-zinc-500">
              {media.title_native}
            </p>
          )}
          {/* Provenance: EVERY source this row links to (its primary source plus
              any cross-references added in the editor), one line each — e.g.
              "Linked to AniList #x / Linked to Bangumi #y". "Manual entry" when
              it links to nothing. */}
          <div className="mt-1 space-y-0.5 text-xs text-zinc-500">
            {(() => {
              const links = linkedSourcesOf(media);
              if (links.length === 0) return <p>{t("editor.sourceManual")}</p>;
              return links.map((l) => (
                <p key={l.source}>
                  {t("editor.linkedSource", {
                    source: t(`editor.sourceName.${l.source}`),
                    id: l.id,
                  })}
                </p>
              ));
            })()}
          </div>
          {/* TMDB only: re-pull the origin-language poster (the selection that
              runs on new adds) and overwrite the cached cover for this row. */}
          {media.external_source === "tmdb" && (
            <button
              type="button"
              onClick={() => refreshCover.mutate(media.id)}
              disabled={refreshCover.isPending}
              className="mt-1 text-xs text-blue-400 hover:underline disabled:opacity-50 light:text-blue-600"
            >
              {refreshCover.isPending
                ? t("editor.refreshingCover")
                : t("editor.refreshCover")}
            </button>
          )}
          {refreshCover.isError && (
            <p className="mt-1 text-xs text-red-400 light:text-red-600">
              {t("editor.refreshCoverFailed")}
            </p>
          )}
        </div>

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-400 light:text-zinc-500">
            {t("editor.status")}
          </span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as MediaStatus)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 light:border-zinc-300 light:bg-white"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </label>

        {isGame && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="block">
              <span className="mb-1 block text-zinc-400 light:text-zinc-500">
                {t("editor.consumptionMode")}
              </span>
              <select
                value={consumptionMode}
                onChange={(e) =>
                  setConsumptionMode(e.target.value as MediaConsumptionMode)
                }
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 light:border-zinc-300 light:bg-white"
              >
                <option value="playing">{t("editor.playing")}</option>
                <option value="watching">{t("editor.watching")}</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-zinc-400 light:text-zinc-500">
                {t("editor.platform")}
              </span>
              <select
                value={platform}
                onChange={(e) =>
                  setPlatform(e.target.value as MediaPlatform | "")
                }
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 light:border-zinc-300 light:bg-white"
              >
                <option value="">{t("editor.regionNone")}</option>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {t(`platform.${p}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {/* Feature C: link a game (typically Bangumi-sourced) to its IGDB entry.
            Stores igdb_id only; the row's primary source stays as it was. */}
        {isGame && media.external_source !== "igdb" && (
          <div className="text-sm">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-zinc-400 light:text-zinc-500">
                {t("editor.igdbLink")}
              </span>
              <button
                type="button"
                onClick={() => setShowIgdbPicker((v) => !v)}
                className="text-xs text-blue-400 hover:underline light:text-blue-600"
              >
                {showIgdbPicker ? t("picker.close") : t("picker.buttonIgdb")}
              </button>
            </div>
            {igdbId && (
              <p className="flex items-center gap-2 text-xs text-emerald-400 light:text-emerald-600">
                {t("editor.linkedIgdb", { id: igdbId })}
                <button
                  type="button"
                  onClick={() => setIgdbId("")}
                  className="text-zinc-500 hover:text-zinc-300 hover:underline"
                >
                  {t("editor.unlinkRef")}
                </button>
              </p>
            )}
            {showIgdbPicker && (
              <div className="mt-2">
                <IgdbLinkPicker initialQuery={pickerQuery} onPick={handleIgdbPick} />
              </div>
            )}
          </div>
        )}

        {dimension && (
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-400 light:text-zinc-500">
              {t(dimension === "chapter" ? "editor.chapter" : "editor.episode")}
            </span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="1"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="w-24 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 light:border-zinc-300 light:bg-white"
              />
              {total != null && (
                <span className="text-zinc-400 light:text-zinc-500">
                  {t("editor.ofTotal", { total })}
                </span>
              )}
            </div>
          </label>
        )}

        {isGamePlaying && (
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-400 light:text-zinc-500">
              {t("editor.progress")}
            </span>
            <input
              type="text"
              value={gameProgress}
              onChange={(e) => setGameProgress(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 light:border-zinc-300 light:bg-white"
            />
          </label>
        )}

        {/* Watching-mode items track content as a list of video URLs
            (media_video_parts) — e.g. a game watched as a multi-part playthrough. */}
        {isGame && consumptionMode === "watching" && (
          <VideoPartsEditor mediaId={media.id} />
        )}

        {/* Optional video links for drama / variety — an ADD-ON alongside the
            episode tracking above, not a replacement (some shows scatter clips /
            full episodes across video sites). Collapsed by default so it doesn't
            clutter shows that don't use it; the same media_video_parts table. */}
        {(media.type === "drama" || media.type === "variety") && (
          <div className="text-sm">
            <button
              type="button"
              onClick={() => setShowVideoLinks((v) => !v)}
              className="text-xs text-blue-400 hover:underline light:text-blue-600"
            >
              {showVideoLinks
                ? t("editor.videoLinksHide")
                : t("editor.videoLinksShow")}
            </button>
            {showVideoLinks && (
              <div className="mt-2">
                <VideoPartsEditor mediaId={media.id} />
              </div>
            )}
          </div>
        )}

        <div className="text-sm">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-zinc-400 light:text-zinc-500">
              {t("editor.titleEnglish")}
            </span>
            <button
              type="button"
              onClick={() => setShowAniListPicker((v) => !v)}
              className="text-xs text-blue-400 hover:underline light:text-blue-600"
            >
              {showAniListPicker ? t("picker.close") : t("picker.buttonAniList")}
            </button>
          </div>
          <input
            type="text"
            value={titleEnglish}
            onChange={(e) => setTitleEnglish(e.target.value)}
            placeholder={t("editor.titleEnglishPlaceholder")}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 light:border-zinc-300 light:bg-white"
          />
          {showAniListPicker && (
            <div className="mt-2">
              <AniListTitlePicker
                mediaType={media.type}
                initialQuery={pickerQuery}
                onPick={handleAniListPick}
              />
            </div>
          )}
          {/* Persisted AniList cross-reference (Issue A): shows the link actually
              stuck. Only for non-AniList-primary rows — a native AniList row
              already shows its id in the provenance line above. */}
          {media.external_source !== "anilist" && anilistId && (
            <p className="mt-1 flex items-center gap-2 text-xs text-emerald-400 light:text-emerald-600">
              {t("editor.linkedAniList", { id: anilistId })}
              <button
                type="button"
                onClick={() => setAnilistId("")}
                className="text-zinc-500 hover:text-zinc-300 hover:underline"
              >
                {t("editor.unlinkRef")}
              </button>
            </p>
          )}
        </div>

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-400 light:text-zinc-500">
            {t("editor.titleRomaji")}
          </span>
          <input
            type="text"
            value={titleRomaji}
            onChange={(e) => setTitleRomaji(e.target.value)}
            placeholder={t("editor.titleRomajiPlaceholder")}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 light:border-zinc-300 light:bg-white"
          />
        </label>

        <div className="text-sm">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-zinc-400 light:text-zinc-500">
              {t("editor.titleChinese")}
            </span>
            <button
              type="button"
              onClick={() => setShowPicker((v) => !v)}
              className="text-xs text-blue-400 hover:underline light:text-blue-600"
            >
              {showPicker ? t("picker.close") : t("picker.button")}
            </button>
          </div>
          <input
            type="text"
            value={titleChinese}
            onChange={(e) => setTitleChinese(e.target.value)}
            placeholder={t("editor.titleChinesePlaceholder")}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 light:border-zinc-300 light:bg-white"
          />
          {showPicker && (
            <div className="mt-2">
              <BangumiTitlePicker
                mediaType={media.type}
                initialQuery={pickerQuery}
                onPick={(cn) => {
                  setTitleChinese(cn);
                  setShowPicker(false);
                }}
              />
            </div>
          )}
        </div>

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-400 light:text-zinc-500">
            {t("editor.type")}
          </span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as MediaType)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 light:border-zinc-300 light:bg-white"
          >
            {TYPE_FACETS.map((ty) => (
              <option key={ty} value={ty}>
                {t(`type.${ty}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-400 light:text-zinc-500">
            {t("editor.region")}
          </span>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 light:border-zinc-300 light:bg-white"
          >
            <option value="">{t("editor.regionNone")}</option>
            {regionOptions.map((r) => (
              <option key={r} value={r}>
                {t(`region.${r}`, r)}
              </option>
            ))}
          </select>
        </label>

        {/* Collection placement — applies immediately (not via Save). */}
        <div className="text-sm">
          <span className="mb-1 block text-zinc-400 light:text-zinc-500">
            {t("collection.section")}
          </span>

          {collectionId ? (
            <div className="space-y-2 rounded-md border border-zinc-700 bg-zinc-800/30 p-2 light:border-zinc-300 light:bg-zinc-50">
              <p className="truncate text-sm">
                {currentCollection ? colLabel(currentCollection) : collectionId}
              </p>
              <p className="text-[11px] text-zinc-500">{t("collection.note")}</p>
              <div className="flex flex-wrap gap-2">
                {/* Jump straight to THIS collection's editor — e.g. to nest it
                    under a master collection — without hunting for it by drilling. */}
                <button
                  type="button"
                  onClick={() => setEditingCollectionId(collectionId)}
                  className="rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700 light:bg-zinc-100 light:text-zinc-700"
                >
                  ⚙ {t("collection.edit")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowColPicker((v) => !v)}
                  className="rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700 light:bg-zinc-100 light:text-zinc-700"
                >
                  {t("collection.relink")}
                </button>
                <button
                  type="button"
                  onClick={() => assignCollection(null)}
                  className="rounded-md px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 light:text-red-600"
                >
                  {t("collection.unlink")}
                </button>
              </div>
            </div>
          ) : (
            !showColPicker && (
              <button
                type="button"
                onClick={() => setShowColPicker(true)}
                className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500"
              >
                {t("collection.link")}
              </button>
            )
          )}

          {showColPicker && (
            <div className="mt-2">
              <CollectionPicker excludeId={collectionId} onPick={assignCollection} />
              <button
                type="button"
                onClick={() => setShowColPicker(false)}
                className="mt-1 text-xs text-zinc-500 hover:text-zinc-300"
              >
                {t("picker.close")}
              </button>
            </div>
          )}
        </div>

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-400 light:text-zinc-500">
            {t("editor.notes")}
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 light:border-zinc-300 light:bg-white"
          />
        </label>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleDelete}
            disabled={del.isPending}
            className="rounded-md px-3 py-1.5 text-sm text-red-400 hover:bg-red-950/40 disabled:opacity-50 light:text-red-600 light:hover:bg-red-50"
          >
            {t("editor.delete")}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 light:text-zinc-600 light:hover:bg-zinc-100"
            >
              {t("editor.cancel")}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={update.isPending}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {t("editor.save")}
            </button>
          </div>
        </div>
      </div>
    </div>

    {editingCollectionId && (
      <CollectionEditor
        collectionId={editingCollectionId}
        onClose={() => setEditingCollectionId(null)}
        onDeleted={() => setEditingCollectionId(null)}
      />
    )}
    </>
  );
}
