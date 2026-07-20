import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useLevelItems } from "../hooks/useLevelItems";
import { useCollections } from "../hooks/useCollections";
import { useCollectionRollups } from "../hooks/useCollectionRollups";
import { useMatchingCollections } from "../hooks/useMatchingCollections";
import {
  useSessionAddedCollectionIds,
  useSessionAddedItems,
  useSessionMovedCollectionIds,
} from "../hooks/useSessionAdded";
import { useCreateCollection } from "../hooks/useCollectionMutations";
import { uiLangFromI18n } from "../lib/displayTitle";
import { compareTitleKeys, levelTitleKey } from "../lib/levelSort";
import { pinyinKey, resolveTitleSort, zhSortTitle } from "../lib/pinyinSort";
import { usePinyinReady } from "../hooks/usePinyinReady";
import {
  childCollections,
  collectionCoverFromRollup,
  collectionNameFromSamples,
  collectionPath,
  rollupStatus,
  subtreeRollup,
  subtreeStatusPriority,
} from "../lib/collections";
import { STATUS_SORT_PRIORITY } from "../../worker/api/list-query";
import { COLLECTION_ROOT, type CollectionRollup, type MediaFilters } from "../lib/api";
import { effectiveLevelFilters, isExplicitFiltering } from "../lib/homeFilter";
import type { Collection, MediaRow } from "../lib/types";
import { MediaCard } from "./MediaCard";
import { CollectionCard } from "./CollectionCard";
import { CollectionEditor } from "./CollectionEditor";
import { BulkActionBar } from "./BulkActionBar";

export function MediaList({
  filters,
  toolbar,
}: {
  filters: MediaFilters;
  // Search + sort + filter-drawer controls, hosted inside this component's
  // sticky bar rather than pinned as a second sticky layer of their own. Two
  // stacked sticky bars ate ~150px of a phone viewport and coupled their
  // heights: every change to one forced retuning the other's `top-*`.
  toolbar?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLangFromI18n(i18n.language);

  // Where we are in the tree (null = Home). Filtering keeps the tree — it just
  // narrows it to collections (and loose items) that contain a match.
  const [currentId, setCurrentId] = useState<string | null>(null);

  // Drill-down navigation goes through the History API so the browser's back
  // gesture (mobile edge-swipe / hardware back) walks back out level by level
  // instead of leaving the site. All in-app navigation (opening a collection,
  // breadcrumb jumps) must use navigateTo, never setCurrentId directly.
  const navigateTo = (id: string | null) => {
    if (id === currentId) return;
    window.history.pushState({ collectionId: id }, "");
    setCurrentId(id);
  };
  useEffect(() => {
    // Restores the level for BOTH directions (back and forward). Overlay
    // entries (useCloseOnBack) spread the underlying state, so their
    // collectionId matches the level they were opened from → no-op here.
    const onPop = (e: PopStateEvent) => {
      const state = e.state as { collectionId?: string | null } | null;
      setCurrentId(state?.collectionId ?? null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [editing, setEditing] = useState<Collection | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const filtering = isExplicitFiltering(filters);
  // Home default = in-progress only (implicit — cleared by any drill-down,
  // facet, or search). `effective` is what the level/match queries actually run.
  const { filters: baseEffective, implicitHome } = effectiveLevelFilters(
    filters,
    currentId,
  );
  // In a zh UI the single "Title A–Z/Z–A" option sorts by the pinyin-keyed
  // title_zh (issue #3); en keeps the English-first `title`. Resolve here so the
  // server AND the client interleave below use the SAME sort key.
  const effective = {
    ...baseEffective,
    sort: resolveTitleSort(baseEffective.sort, lang),
  };
  const activeSort = effective.sort;
  // Load pinyin-pro (dynamic) only when a zh title sort is active — the client
  // interleave keys collection cards + items by pinyin to match the server's
  // paginated order. Called unconditionally (before the early returns below) to
  // respect the rules of hooks.
  const wantsPinyinSort =
    activeSort === "title_zh" || activeSort === "title_zh_desc";
  const pinyinReady = usePinyinReady(wantsPinyinSort);
  const q = filters.q.trim().toLowerCase();
  const scope = currentId ?? COLLECTION_ROOT;

  // Drill-down data — all bounded, none load the whole library:
  //   • collections: the (small) tree   • rollups: per-collection summaries
  //   • level items: THIS level's items, paginated
  //   • matches: while filtering (incl. the implicit home filter)
  const { data: collections = [] } = useCollections();
  const { data: rollups = [], isPending: rollupsPending } = useCollectionRollups();
  const matchingIds = useMatchingCollections(effective, filtering || implicitHome);
  const {
    data: levelData,
    isPending: levelPending,
    isError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useLevelItems(effective, scope);
  // Session-added items, pinned to the front of the (implicit) Home view until
  // the page is refreshed — whatever their status.
  const pinnedItems = useSessionAddedItems(implicitHome);
  // Same for collections created this session: without a pin, a freshly-created
  // (empty) collection has no in-progress matches and would vanish at Home.
  // Plus collections a session-added item was just moved INTO — surfaced for the
  // same reason (so the moved item stays reachable at Home). Both get pinned to
  // the front of the implicit-Home view; the merged list dedupes an overlap.
  const createdColIds = useSessionAddedCollectionIds();
  const movedColIds = useSessionMovedCollectionIds(implicitHome);
  const sessionColIds = [...new Set([...movedColIds, ...createdColIds])];

  const rollupById = new Map<string, CollectionRollup>(
    rollups.map((r) => [r.collection_id, r]),
  );

  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };
  // Create a new (empty) collection at the CURRENT level.
  const createCol = useCreateCollection();
  const [creatingCol, setCreatingCol] = useState(false);
  const [newColName, setNewColName] = useState("");
  const submitNewCol = () => {
    createCol.mutate(
      { name: newColName.trim() || null, parentId: currentId },
      {
        onSuccess: () => {
          setNewColName("");
          setCreatingCol(false);
        },
      },
    );
  };

  // A collection's display name, derived from its rollup sample titles (so it
  // works without the whole library) + its child collections' names.
  const nameOf = (col: Collection): string =>
    collectionNameFromSamples(
      col,
      rollupById.get(col.id)?.sample_titles ?? [],
      childCollections(collections, col.id).map((g) => g.name ?? ""),
      lang,
      t("collection.untitled"),
    );

  // Wait for the first level page + the rollups (needed to render any card).
  if (levelPending || rollupsPending) {
    return <p className="py-8 text-zinc-400 light:text-zinc-500">{t("list.loading")}</p>;
  }
  if (isError) {
    return <p className="py-8 text-red-400 light:text-red-600">{t("list.error")}</p>;
  }

  // The level's items (every loaded page), and the grand total at this level.
  // Items already pinned (session adds) are dropped from the grid so they don't
  // render twice when they also match the level query — but the count keeps
  // them, since the pinned card still shows the row.
  const pinnedIdSet = new Set(pinnedItems.map((i) => i.id));
  const levelPageItems: MediaRow[] = (levelData?.pages ?? []).flatMap(
    (p) => p.items,
  );
  const loadedItems: MediaRow[] = levelPageItems.filter(
    (item) => !pinnedIdSet.has(item.id),
  );
  const levelTotal = levelData?.pages[0]?.total ?? 0;

  // While filtering, surface only collections with a matching item somewhere
  // inside (server-provided), PLUS those whose NAME matches the search — and
  // every ancestor of either, so they stay reachable from Home.
  const byId = new Map(collections.map((c) => [c.id, c]));
  const withMatches: Set<string> | null = (() => {
    if (!filtering && !implicitHome) return null;
    const set = new Set<string>();
    const addWithAncestors = (id: string) => {
      let cur: Collection | undefined = byId.get(id);
      while (cur && !set.has(cur.id)) {
        set.add(cur.id);
        cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
      }
    };
    for (const id of matchingIds) addWithAncestors(id);
    if (implicitHome) {
      for (const id of sessionColIds) addWithAncestors(id);
    }
    if (q) {
      for (const c of collections) {
        if (nameOf(c).toLowerCase().includes(q)) addWithAncestors(c.id);
      }
    }
    return set;
  })();

  const path = collectionPath(collections, currentId).map((c) => ({
    id: c.id,
    label: nameOf(c),
  }));
  const levelCols = childCollections(collections, currentId).filter(
    (c) => !withMatches || withMatches.has(c.id),
  );
  // Session-created collections at this level bypass the sort like session-added
  // items do: pinned to the front (newest first), the rest interleave as usual.
  const pinnedColIds = implicitHome ? sessionColIds : [];
  const pinnedColIdSet = new Set(pinnedColIds);
  const pinnedCols = pinnedColIds
    .map((id) => levelCols.find((c) => c.id === id))
    .filter((c): c is Collection => c !== undefined);
  const childCols = levelCols.filter((c) => !pinnedColIdSet.has(c.id));
  const current = currentId ? collections.find((c) => c.id === currentId) : null;

  // Interleave collection cards and items by the ACTIVE sort, so a freshly-added
  // item (newest date_updated) lands at the very top instead of below every
  // collection card. A collection sits at its subtree's newest activity (date
  // sorts) or earliest release. Items keep the server's order among themselves;
  // collections slot in by date relative to the loaded items.
  type Cell = { kind: "col"; col: Collection } | { kind: "item"; item: MediaRow };
  // Feature D: each sort has both directions. Recognize the reverse keys here so
  // the client interleave matches the server's ORDER BY for the paginated items.
  const statusSort = activeSort === "status";
  const titleSortEn = activeSort === "title" || activeSort === "title_desc";
  const titleSortZh =
    activeSort === "title_zh" || activeSort === "title_zh_desc";
  const titleSort = titleSortEn || titleSortZh;
  const releaseSort =
    activeSort === "release_date" || activeSort === "release_date_desc";
  const ratingSort =
    activeSort === "rating_desc" || activeSort === "rating_asc";
  const descRelease = activeSort === "release_date_desc";
  const descTitle = activeSort === "title_desc" || activeSort === "title_zh_desc";
  const descRating = activeSort === "rating_desc";
  // A cell's rating for the rating sort: items use source_rating; collections
  // have none, so they're treated as unrated and pushed to the end (NULLs last),
  // matching the server's `source_rating IS NULL` ordering for items.
  const cellRating = (cell: Cell): number | null =>
    cell.kind === "item" ? cell.item.source_rating : null;
  const cellDate = (cell: Cell): string => {
    if (cell.kind === "item") {
      const it = cell.item;
      if (activeSort === "date_added") return it.date_added ?? "";
      if (releaseSort) return it.release_date ?? "";
      return it.date_updated ?? "";
    }
    const roll = subtreeRollup(rollupById, collections, cell.col.id);
    // date_added has no per-collection rollup → use latestUpdated (≈ equal at add).
    return releaseSort ? (roll.earliestRelease ?? "") : (roll.latestUpdated ?? "");
  };
  // Title-sort key, mirroring the server's ORDER BY for the paginated items so
  // they keep server order across page boundaries. EN sort: the English-first
  // COALESCE + NOCASE key (levelSort.ts). ZH sort: the pinyin key — items use the
  // server-stored title_sort_zh (falling back to a client-computed one for a not-
  // yet-backfilled row), collections use client pinyin of their display name.
  // Both zh keys use the same pinyin transform as the server (pinyinSort.ts).
  const zhItemKey = (item: MediaRow): string =>
    item.title_sort_zh ?? pinyinKey(zhSortTitle(item));
  const cellTitleKey = (cell: Cell): string => {
    if (titleSortZh) {
      if (cell.kind === "item") return zhItemKey(cell.item);
      // Collection cards: pinyin of the display name once pinyin-pro has loaded
      // (pinyinReady) — until then a plain-lowercase fallback that self-corrects
      // on the re-render. Items are unaffected (they carry the server key).
      return pinyinReady
        ? pinyinKey(nameOf(cell.col))
        : nameOf(cell.col).toLowerCase();
    }
    return cell.kind === "item"
      ? levelTitleKey(cell.item)
      : nameOf(cell.col).toLowerCase();
  };
  // Status-sort rank, mirroring the server's CASE: items by their own status,
  // collections by the best status anywhere in their subtree.
  const cellStatusPriority = (cell: Cell): number =>
    cell.kind === "item"
      ? STATUS_SORT_PRIORITY[cell.item.status]
      : subtreeStatusPriority(
          subtreeRollup(rollupById, collections, cell.col.id),
        );

  const sortedCells: Cell[] = [
    ...childCols.map((col): Cell => ({ kind: "col", col })),
    ...loadedItems.map((item): Cell => ({ kind: "item", item })),
  ].sort((a, b) => {
    if (statusSort) {
      const pa = cellStatusPriority(a);
      const pb = cellStatusPriority(b);
      if (pa !== pb) return pa - pb;
      // Ties fall through to the date compare below (newest updated first),
      // matching the server's `…, date_updated DESC`.
    }
    if (titleSort) {
      const cmp = compareTitleKeys(cellTitleKey(a), cellTitleKey(b));
      return descTitle ? -cmp : cmp;
    }
    if (ratingSort) {
      const ra = cellRating(a);
      const rb = cellRating(b);
      // Unrated (and collections) always last, regardless of direction.
      if (ra === null && rb === null) return 0;
      if (ra === null) return 1;
      if (rb === null) return -1;
      if (ra === rb) return 0;
      return descRating ? rb - ra : ra - rb;
    }
    const da = cellDate(a);
    const db = cellDate(b);
    if (releaseSort) {
      // Undated always sorts LAST, regardless of direction; the dated tail flips.
      if (da === db) return 0;
      if (da === "") return 1;
      if (db === "") return -1;
      if (descRelease) return da < db ? 1 : -1;
      return da < db ? -1 : 1;
    }
    // date_updated / date_added: newest first.
    return da < db ? 1 : da > db ? -1 : 0;
  });

  // Session adds bypass the sort entirely: newest add first, ahead of the list.
  const cells: Cell[] = [
    ...pinnedItems.map((item): Cell => ({ kind: "item", item })),
    ...pinnedCols.map((col): Cell => ({ kind: "col", col })),
    ...sortedCells,
  ];

  const isEmpty = cells.length === 0;

  return (
    <>
      {/* Sticky just under the app header (h-14 = top-14) so the breadcrumb,
          search, sort and New / Select / Edit all stay reachable while scrolled
          down a long level. ONE sticky block, not several stacked ones: extra
          layers each cost viewport height and force manual `top-*` retuning
          whenever a neighbour's height changes.
          z below the header (z-10); opaque bg + a little vertical padding so
          cards don't show through when it's pinned.
          Below md it wraps to two rows (breadcrumb + buttons, then the
          toolbar); from md up it's a single row. */}
      <div className="sticky top-14 z-[5] -mx-1 mb-4 flex flex-wrap items-center gap-2 bg-zinc-950/95 px-1 py-2 backdrop-blur light:bg-zinc-50/95">
        <Breadcrumb path={path} onNavigate={navigateTo} homeLabel={t("collection.home")} />
        {toolbar && (
          <div className="order-last w-full min-w-0 md:order-none md:w-auto md:flex-1">
            {toolbar}
          </div>
        )}
        <div className="ml-auto flex shrink-0 gap-2 md:ml-0">
          {!selectMode && (
            <button
              type="button"
              onClick={() => setCreatingCol((v) => !v)}
              className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-700 light:hover:bg-zinc-100"
            >
              ＋ {t("collection.newHere")}
            </button>
          )}
          <button
            type="button"
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            className={`rounded-md border px-2 py-1 text-xs ${
              selectMode
                ? "border-blue-500 bg-blue-600 text-white"
                : "border-zinc-700 text-zinc-200 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-700 light:hover:bg-zinc-100"
            }`}
          >
            {selectMode ? t("bulk.exit") : t("bulk.select")}
          </button>
          {current && (
            <button
              type="button"
              onClick={() => setEditing(current)}
              className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-700 light:hover:bg-zinc-100"
            >
              ⚙ {t("collection.edit")}
            </button>
          )}
        </div>
      </div>

      {creatingCol && (
        <div className="mb-3 flex gap-2">
          <input
            type="text"
            autoFocus
            value={newColName}
            onChange={(e) => setNewColName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNewCol();
              if (e.key === "Escape") setCreatingCol(false);
            }}
            placeholder={
              currentId ? t("collection.newSubPlaceholder") : t("collection.newRootPlaceholder")
            }
            className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm light:border-zinc-300 light:bg-white"
          />
          <button
            type="button"
            onClick={submitNewCol}
            disabled={createCol.isPending}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {t("collection.createBtn")}
          </button>
        </div>
      )}

      {filtering && (
        <p className="mb-3 text-xs text-zinc-500 light:text-zinc-600">
          {t("list.count", { shown: levelPageItems.length, total: levelTotal })}
        </p>
      )}

      {implicitHome && (
        <p className="mb-3 text-xs text-zinc-500 light:text-zinc-600">
          {t("list.homeHint")}
        </p>
      )}

      {isEmpty ? (
        <p className="py-8 text-zinc-400 light:text-zinc-500">
          {implicitHome ? t("list.emptyHome") : t("list.empty")}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {cells.map((cell) => {
              if (cell.kind === "col") {
                const col = cell.col;
                const roll = subtreeRollup(rollupById, collections, col.id);
                return (
                  <CollectionCard
                    key={`c:${col.id}`}
                    collection={col}
                    name={nameOf(col)}
                    cover={collectionCoverFromRollup(col, rollupById.get(col.id))}
                    count={roll.count}
                    completed={roll.completed}
                    // Completion bar = completed items / total items in the
                    // subtree, which is meaningful for every type including games
                    // (completed games / total games). Shown for any non-empty
                    // collection.
                    showProgress={roll.count > 0}
                    status={rollupStatus(roll)}
                    childCount={childCollections(collections, col.id).length}
                    onOpen={() => {
                      // Drill in but KEEP the active search — the collection
                      // then shows only its matching items (the reason you
                      // opened it), not its full contents.
                      navigateTo(col.id);
                    }}
                    onEdit={() => setEditing(col)}
                  />
                );
              }
              return (
                <MediaCard
                  key={`m:${cell.item.id}`}
                  media={cell.item}
                  selectMode={selectMode}
                  selected={selected.has(cell.item.id)}
                  onToggleSelect={toggleSelect}
                />
              );
            })}
          </div>

          {hasNextPage && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
                className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50 light:border-zinc-300 light:text-zinc-700 light:hover:bg-zinc-100"
              >
                {isFetchingNextPage ? t("list.loading") : t("list.loadMore")}
              </button>
            </div>
          )}
        </>
      )}

      {selectMode && (
        <BulkActionBar
          ids={[...selected]}
          onClear={() => setSelected(new Set())}
          onDone={exitSelect}
        />
      )}

      {editing && (
        <CollectionEditor
          collectionId={editing.id}
          onClose={() => setEditing(null)}
          onDeleted={() => {
            setEditing(null);
            navigateTo(null);
          }}
        />
      )}
    </>
  );
}

function Breadcrumb({
  path,
  onNavigate,
  homeLabel,
}: {
  path: { id: string; label: string }[];
  onNavigate: (id: string | null) => void;
  homeLabel: string;
}) {
  return (
    <nav className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
      <button
        type="button"
        onClick={() => onNavigate(null)}
        className="rounded px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-800 light:text-zinc-600 light:hover:bg-zinc-100"
      >
        {homeLabel}
      </button>
      {path.map((c) => (
        <span key={c.id} className="flex min-w-0 items-center gap-1">
          <span className="text-zinc-600">/</span>
          <button
            type="button"
            onClick={() => onNavigate(c.id)}
            className="truncate rounded px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-800 light:text-zinc-600 light:hover:bg-zinc-100"
          >
            {c.label}
          </button>
        </span>
      ))}
    </nav>
  );
}
