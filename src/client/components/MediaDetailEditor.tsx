import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { useUpdateMedia } from "../hooks/useUpdateMedia";
import { useDeleteMedia } from "../hooks/useDeleteMedia";
import { useSeriesIndex } from "../hooks/useSeriesIndex";
import { useRenameSeries } from "../hooks/useRenameSeries";
import { BangumiTitlePicker } from "./BangumiTitlePicker";
import { AniListTitlePicker } from "./AniListTitlePicker";
import { mediaProgress } from "../lib/progress";
import { REGION_FACETS } from "../lib/facets";
import { newSeriesId } from "../lib/series";
import { displayTitle, uiLangFromI18n } from "../lib/displayTitle";
import type { MediaPatch } from "../../worker/api/patch-media";
import type { MediaStatus } from "../../worker/db/schema";
import type { MediaRow } from "../lib/types";

const STATUSES: MediaStatus[] = [
  "planned",
  "in_progress",
  "completed",
  "dropped",
  "paused",
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
  const lang = uiLangFromI18n(i18n.language);
  const headerTitle = displayTitle(media, lang);

  const handleDelete = () => {
    if (!window.confirm(t("editor.confirmDelete"))) return;
    del.mutate(media.id, { onSuccess: onClose });
  };

  const handleAniListPick = (titles: {
    english: string | null;
    romaji: string | null;
  }) => {
    if (titles.english) setTitleEnglish(titles.english);
    if (titles.romaji) setTitleRomaji(titles.romaji);
    setShowAniListPicker(false);
  };

  const isGamePlaying =
    media.type === "game" && media.consumption_mode === "playing";

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

  // Series grouping. These apply IMMEDIATELY (their own mutations), separate from
  // the Save button which handles status/progress/titles. series_id is just a
  // grouping tag — linking/moving/unlinking never touches the entry's own data.
  const [seriesId, setSeriesId] = useState(media.series_id);
  const [seriesName, setSeriesName] = useState(media.series_name ?? "");
  const [showSeriesPicker, setShowSeriesPicker] = useState(false);
  const [seriesQuery, setSeriesQuery] = useState("");
  const seriesIndex = useSeriesIndex();
  const renameSeries = useRenameSeries();

  const applySeries = (id: string | null, name: string | null) => {
    setSeriesId(id);
    setSeriesName(name ?? "");
    update.mutate(
      {
        id: media.id,
        patch: {
          series_id: id,
          series_name: name,
          ...(id === null ? { season_number: null } : {}),
        },
      },
      {
        // A series change is structural (regroups the list, adds a new series to
        // the picker), so — unlike a +1 — invalidate so both the grouped library
        // and the series index refetch instead of needing a manual page refresh.
        onSuccess: () =>
          void queryClient.invalidateQueries({ queryKey: ["media"] }),
      },
    );
    setShowSeriesPicker(false);
    setSeriesQuery("");
  };
  const createSeries = () => {
    // override = the typed name, or null to auto-name from members per-language.
    applySeries(newSeriesId(), seriesQuery.trim() || null);
  };
  const commitRename = () => {
    const n = seriesName.trim();
    const current = media.series_name ?? "";
    if (seriesId && n !== current) {
      // Empty → clear the override (revert to the auto-derived per-language name).
      renameSeries.mutate({ seriesId, name: n === "" ? null : n });
    }
  };
  const seriesQ = seriesQuery.trim().toLowerCase();
  const seriesMatches = seriesIndex.filter(
    (s) => s.id !== seriesId && s.name.toLowerCase().includes(seriesQ),
  );
  const seriesExactMatch = seriesIndex.some((s) => s.name.toLowerCase() === seriesQ);
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
    update.mutate({ id: media.id, patch }, { onSuccess: onClose });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-sm space-y-4 rounded-lg bg-zinc-900 p-4 ring-1 ring-zinc-700 light:bg-white light:ring-zinc-200"
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
          {/* Provenance: which source this row is linked to, so it's not a
              guess. Bangumi-direct means AniList had no matching entry. */}
          <p className="mt-1 text-xs text-zinc-500">
            {media.external_source === "anilist"
              ? t("editor.sourceAniList", { id: media.external_id })
              : media.external_source === "bangumi"
                ? t("editor.sourceBangumi", { id: media.external_id })
                : t("editor.sourceManual")}
          </p>
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

        {/* Series grouping — applies immediately (not via Save). */}
        <div className="text-sm">
          <span className="mb-1 block text-zinc-400 light:text-zinc-500">
            {t("series.section")}
          </span>

          {seriesId ? (
            <div className="space-y-2 rounded-md border border-zinc-700 bg-zinc-800/30 p-2 light:border-zinc-300 light:bg-zinc-50">
              <input
                type="text"
                value={seriesName}
                onChange={(e) => setSeriesName(e.target.value)}
                onBlur={commitRename}
                placeholder={t("series.namePlaceholder")}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 light:border-zinc-300 light:bg-white"
              />
              <p className="text-[11px] text-zinc-500">{t("series.note")}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowSeriesPicker((v) => !v)}
                  className="rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700 light:bg-zinc-100 light:text-zinc-700"
                >
                  {t("series.relink")}
                </button>
                <button
                  type="button"
                  onClick={() => applySeries(null, null)}
                  className="rounded-md px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 light:text-red-600"
                >
                  {t("series.unlink")}
                </button>
              </div>
            </div>
          ) : (
            !showSeriesPicker && (
              <button
                type="button"
                onClick={() => setShowSeriesPicker(true)}
                className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500"
              >
                {t("series.link")}
              </button>
            )
          )}

          {showSeriesPicker && (
            <div className="mt-2 rounded-md border border-zinc-700 bg-zinc-950/40 p-2 light:border-zinc-300 light:bg-white">
              <input
                type="search"
                autoFocus
                value={seriesQuery}
                onChange={(e) => setSeriesQuery(e.target.value)}
                placeholder={t("series.searchPlaceholder")}
                className="mb-2 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm light:border-zinc-300 light:bg-white"
              />
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {seriesMatches.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => applySeries(s.id, s.override)}
                      className="flex w-full items-center justify-between rounded p-1.5 text-left text-sm hover:bg-zinc-800 light:hover:bg-zinc-100"
                    >
                      <span className="truncate">{s.name}</span>
                      <span className="shrink-0 text-xs text-zinc-500">
                        {t("series.seasons", { count: s.count })}
                      </span>
                    </button>
                  </li>
                ))}
                {!seriesExactMatch && (
                  <li>
                    <button
                      type="button"
                      onClick={createSeries}
                      className="w-full rounded p-1.5 text-left text-sm text-blue-400 hover:bg-zinc-800 light:text-blue-600 light:hover:bg-zinc-100"
                    >
                      {seriesQuery.trim()
                        ? t("series.create", { name: seriesQuery.trim() })
                        : t("series.createAuto")}
                    </button>
                  </li>
                )}
              </ul>
              <button
                type="button"
                onClick={() => {
                  setShowSeriesPicker(false);
                  setSeriesQuery("");
                }}
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
  );
}
