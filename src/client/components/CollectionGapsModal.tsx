import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Modal } from "./Modal";
import { useCollectionGaps } from "../hooks/useCollectionGaps";
import type { CollectionGap } from "../lib/collectionGaps";
import type { MediaRow } from "../lib/types";

/**
 * "What else is in this collection?" — lists everything the source (a TMDB movie
 * franchise, or a show's season run) has that the library doesn't, each with an
 * Add. Scans on open: the user asked for this panel by name, so making them
 * press a second button to fill it would be a wasted click.
 *
 * No Dismiss here, unlike What's New. That scanner runs unprompted over the
 * whole library, so noise has to be suppressible; this one is opened deliberately
 * for one collection, and "I don't want that film" is already expressed by not
 * pressing Add.
 */
export function CollectionGapsModal({
  collectionId,
  collectionName,
  members,
  onClose,
}: {
  collectionId: string;
  collectionName: string;
  members: MediaRow[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { phase, progress, gaps, scan, add } = useCollectionGaps(collectionId);

  // Scan once, on open. `members` is a fresh array each render, so it must not
  // be a dependency — the collection is what identifies the scan.
  useEffect(() => {
    void scan(members);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan]);

  return (
    <Modal
      onClose={onClose}
      ariaLabel={t("gaps.title")}
      maxWidth="max-w-2xl"
      maxHeight="max-h-[80vh]"
      align="top"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 p-4 light:border-zinc-200">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t("gaps.title")}</h2>
          <p className="truncate text-xs text-zinc-500">{collectionName}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("add.close")}
          className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-800 light:text-zinc-500 light:hover:bg-zinc-100"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {phase === "scanning" || phase === "idle" ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            {progress > 0
              ? t("gaps.scanningCount", { done: progress })
              : t("gaps.scanning")}
          </p>
        ) : phase === "error" ? (
          <p className="py-8 text-center text-sm text-red-400 light:text-red-600">
            {t("gaps.error")}
          </p>
        ) : gaps.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            {t("gaps.empty")}
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-zinc-500">
              {t("gaps.found", { count: gaps.length })}
            </p>
            <ul className="space-y-2">
              {gaps.map((gap) => (
                <GapRow key={gap.externalId} gap={gap} onAdd={() => add(gap)} />
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}

function GapRow({ gap, onAdd }: { gap: CollectionGap; onAdd: () => Promise<void> }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = () => {
    setBusy(true);
    setFailed(false);
    void onAdd().catch(() => {
      setBusy(false);
      setFailed(true);
    });
  };

  return (
    <li className="flex gap-3 rounded-md p-2 hover:bg-zinc-800 light:hover:bg-zinc-100">
      <div className="h-20 w-14 shrink-0 overflow-hidden rounded bg-zinc-800 light:bg-zinc-100">
        {gap.coverUrl && (
          <img
            src={gap.coverUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {/* A season is labelled in the UI language rather than with TMDB's own
            name: the seasons proxy asks TMDB in zh-CN for every caller, so
            "第三季" would show up mid-sentence in an English UI. */}
        <p className="truncate text-sm font-medium">
          {gap.seasonNumber != null
            ? t("gaps.seasonLabel", { number: gap.seasonNumber })
            : gap.title}
        </p>
        <p className="truncate text-xs text-zinc-400 light:text-zinc-500">
          {gap.subtitle ?? t(`gaps.kind.${gap.kind}`)}
        </p>
        {failed && (
          <p className="text-xs text-red-400 light:text-red-600">
            {t("gaps.addFailed")}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-start">
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {busy ? t("add.adding") : t("add.addButton")}
        </button>
      </div>
    </li>
  );
}
