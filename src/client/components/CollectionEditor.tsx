import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { MediaType } from "../../worker/db/schema";
import { splitGenres } from "../../worker/sources/genres";
import { REGION_FACETS, TYPE_FACETS } from "../lib/facets";
import { fetchMediaList, type MediaFilters } from "../lib/api";
import { uiLangFromI18n } from "../lib/displayTitle";
import { Modal } from "./Modal";
import { useCloseOnBack } from "../hooks/useCloseOnBack";
import { useCollections } from "../hooks/useCollections";
import {
  collectionName,
  directItems,
  childCollections,
  subtreeCollectionIds,
  subtreeItems,
  type CollectionPatch,
} from "../lib/collections";
import type { Collection, MediaRow, UiLang } from "../lib/types";
import {
  useCreateCollection,
  useDeleteCollection,
  useUpdateCollection,
} from "../hooks/useCollectionMutations";

// The whole, UNFILTERED library — the editor needs every item to derive names,
// subtree rollups and the cover gallery regardless of any active search/filter.
// Matches App's EMPTY_FILTERS exactly so the query key reuses the library the
// main list already loaded (no extra full-library fetch).
const ALL_FILTERS: MediaFilters = {
  types: [],
  regions: [],
  statuses: [],
  genres: [],
  q: "",
  sort: "date_updated",
};

// Data-gating wrapper: self-fetches the library + collection list (so the editor
// can open from anywhere — a collection card OR a buried item's detail editor)
// and only mounts the form once both are loaded, so its state seeds correctly.
export function CollectionEditor({
  collectionId,
  onClose,
  onDeleted,
}: {
  collectionId: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { i18n } = useTranslation();
  const lang = uiLangFromI18n(i18n.language);
  // Mobile back-swipe (history back) closes the editor instead of leaving the
  // app. Lives on this wrapper (mounted = open), not the inner form, so the
  // brief data-loading gap is covered too.
  useCloseOnBack(onClose);
  const { data: allCollections } = useCollections();
  const { data: library } = useQuery({
    queryKey: ["media", ALL_FILTERS, null],
    queryFn: () => fetchMediaList(ALL_FILTERS),
  });

  if (!allCollections || !library) return null; // brief load; modal not shown yet
  const collection = allCollections.find((c) => c.id === collectionId);
  if (!collection) {
    onClose(); // deleted out from under us
    return null;
  }
  return (
    <CollectionEditorForm
      collection={collection}
      allCollections={allCollections}
      items={library.items}
      lang={lang}
      onClose={onClose}
      onDeleted={onDeleted}
    />
  );
}

// Edit a whole collection: rename, pin a cover, move it under another
// collection (searchable + cycle-guarded), bulk-set its subtree's
// region/type/genres, spin off a sub-collection, or delete it (contents
// re-parent up). All changes apply across every descendant where relevant.
function CollectionEditorForm({
  collection,
  allCollections,
  items,
  lang,
  onClose,
  onDeleted,
}: {
  collection: Collection;
  allCollections: Collection[];
  items: MediaRow[];
  lang: UiLang;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateCollection();
  const create = useCreateCollection();
  const del = useDeleteCollection();

  const labelOf = (c: Collection) =>
    collectionName(
      c,
      directItems(items, c.id),
      childCollections(allCollections, c.id).map((g) => g.name ?? ""),
      lang,
      t("collection.untitled"),
    );

  const sub = subtreeItems(items, allCollections, collection.id);
  const derivedName = labelOf(collection);

  const seedType = (sub[0]?.type ?? "") as MediaType | "";
  const seedRegion = sub[0]?.region ?? "";
  const seedGenres = splitGenres(sub[0]?.genres ?? null).join(", ");

  const [name, setName] = useState(collection.name ?? "");
  const [parentId, setParentId] = useState<string>(collection.parent_id ?? "");
  const [showParentPicker, setShowParentPicker] = useState(false);
  const [parentQuery, setParentQuery] = useState("");
  const [type, setType] = useState<MediaType | "">(seedType);
  const [region, setRegion] = useState<string>(seedRegion);
  const [genres, setGenres] = useState<string>(seedGenres);
  const [newSub, setNewSub] = useState("");

  // Valid parents: every collection except this one and its descendants (moving
  // into a descendant would make a cycle — the server rejects it too).
  const banned = subtreeCollectionIds(allCollections, collection.id);
  const parentQ = parentQuery.trim().toLowerCase();
  const parentMatches = allCollections.filter(
    (c) => !banned.has(c.id) && labelOf(c).toLowerCase().includes(parentQ),
  );
  const parentLabel =
    parentId === ""
      ? t("collection.rootLevel")
      : labelOf(allCollections.find((c) => c.id === parentId) ?? collection);

  const coverChoices = sub.filter((m) => m.cover_url);

  const save = () => {
    const patch: CollectionPatch = {};
    if (name.trim() !== (collection.name ?? "")) {
      patch.name = name.trim() === "" ? null : name.trim();
    }
    const nextParent = parentId === "" ? null : parentId;
    if (nextParent !== (collection.parent_id ?? null)) patch.parent_id = nextParent;
    if (type !== seedType) patch.type = type || undefined;
    if (region !== seedRegion) patch.region = region === "" ? null : region;
    if (genres !== seedGenres) {
      patch.genres = genres.split(",").map((g) => g.trim()).filter(Boolean);
    }
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    update.mutate({ id: collection.id, patch }, { onSuccess: onClose });
  };

  const pickCover = (url: string | null) =>
    update.mutate({ id: collection.id, patch: { cover_url: url } });

  const addSub = () => {
    create.mutate(
      { name: newSub.trim() || null, parentId: collection.id },
      { onSuccess: () => setNewSub("") },
    );
  };

  const remove = () => {
    if (!window.confirm(t("collection.confirmDelete"))) return;
    del.mutate(collection.id, { onSuccess: onDeleted });
  };

  const labelCls = "mb-1 block text-zinc-400 light:text-zinc-500";
  const fieldCls =
    "w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 light:border-zinc-300 light:bg-white";

  return (
    <Modal
      onClose={onClose}
      ariaLabel={t("collection.edit")}
      maxWidth="max-w-sm"
      // The outer CollectionEditor wrapper already owns this overlay's history
      // entry (it mounts before the data loads).
      closeOnBack={false}
    >
        <h2 className="shrink-0 border-b border-zinc-800 px-4 py-3 text-base font-semibold leading-snug light:border-zinc-200">
          {derivedName}
        </h2>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <label className="block text-sm">
          <span className={labelCls}>{t("collection.name")}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            // When no explicit name is set, show the auto-derived name as the
            // placeholder so it's clear what's being overridden (and that blank
            // keeps deriving from the contents).
            placeholder={collection.name ? t("collection.namePlaceholder") : derivedName}
            className={fieldCls}
          />
          <p className="mt-1 text-[11px] text-zinc-500">{t("collection.nameHint")}</p>
        </label>

        <div className="text-sm">
          <span className={labelCls}>{t("collection.moveUnder")}</span>
          <button
            type="button"
            onClick={() => setShowParentPicker((v) => !v)}
            className={`${fieldCls} flex items-center justify-between text-left`}
          >
            <span className="truncate">{parentLabel}</span>
            <span className="text-zinc-500">▾</span>
          </button>
          {showParentPicker && (
            <div className="mt-1 rounded-md border border-zinc-700 bg-zinc-950/40 p-2 light:border-zinc-300 light:bg-white">
              <input
                type="search"
                autoFocus
                value={parentQuery}
                onChange={(e) => setParentQuery(e.target.value)}
                placeholder={t("collection.parentSearchPlaceholder")}
                className="mb-2 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm light:border-zinc-300 light:bg-white"
              />
              <ul className="max-h-44 space-y-1 overflow-y-auto">
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setParentId("");
                      setShowParentPicker(false);
                      setParentQuery("");
                    }}
                    className="w-full rounded p-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-800 light:text-zinc-600 light:hover:bg-zinc-100"
                  >
                    {t("collection.rootLevel")}
                  </button>
                </li>
                {parentMatches.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setParentId(c.id);
                        setShowParentPicker(false);
                        setParentQuery("");
                      }}
                      className="w-full truncate rounded p-1.5 text-left text-sm hover:bg-zinc-800 light:hover:bg-zinc-100"
                    >
                      {labelOf(c)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Subtree bulk metadata. */}
        <fieldset className="space-y-3 rounded-md border border-zinc-800 p-2 light:border-zinc-200">
          <legend className="px-1 text-xs text-zinc-500">
            {t("collection.bulkLegend", { count: sub.length })}
          </legend>
          <label className="block text-sm">
            <span className={labelCls}>{t("editor.type")}</span>
            <select value={type} onChange={(e) => setType(e.target.value as MediaType)} className={fieldCls}>
              {type === "" && <option value="">—</option>}
              {TYPE_FACETS.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`type.${ty}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className={labelCls}>{t("editor.region")}</span>
            <select value={region} onChange={(e) => setRegion(e.target.value)} className={fieldCls}>
              <option value="">{t("editor.regionNone")}</option>
              {(region && !REGION_FACETS.includes(region)
                ? [region, ...REGION_FACETS]
                : REGION_FACETS
              ).map((r) => (
                <option key={r} value={r}>
                  {t(`region.${r}`, r)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className={labelCls}>{t("collection.genres")}</span>
            <input
              type="text"
              value={genres}
              onChange={(e) => setGenres(e.target.value)}
              placeholder={t("collection.genresPlaceholder")}
              className={fieldCls}
            />
          </label>
        </fieldset>

        {/* Pick a cover from the subtree's item art. */}
        {coverChoices.length > 0 && (
          <div className="text-sm">
            <span className={labelCls}>{t("collection.cover")}</span>
            <div className="flex flex-wrap gap-1.5">
              {coverChoices.slice(0, 12).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => pickCover(m.cover_url)}
                  className={`h-16 w-11 overflow-hidden rounded ring-2 ${
                    collection.cover_url === m.cover_url ? "ring-amber-400" : "ring-transparent hover:ring-blue-500"
                  }`}
                >
                  <img src={m.cover_url!} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
              {collection.cover_url && (
                <button
                  type="button"
                  onClick={() => pickCover(null)}
                  className="h-16 w-11 rounded border border-zinc-700 text-xs text-zinc-500 light:border-zinc-300"
                >
                  {t("collection.coverAuto")}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Spin off a sub-collection. */}
        <div className="text-sm">
          <span className={labelCls}>{t("collection.newSub")}</span>
          <div className="flex gap-2">
            <input
              type="text"
              value={newSub}
              onChange={(e) => setNewSub(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSub()}
              placeholder={t("collection.newSubPlaceholder")}
              className={fieldCls}
            />
            <button
              type="button"
              onClick={addSub}
              disabled={create.isPending}
              className="shrink-0 rounded-md bg-zinc-700 px-3 text-sm text-white hover:bg-zinc-600 disabled:opacity-50"
            >
              ＋
            </button>
          </div>
        </div>

        {/* Destructive action stays in the scrolling body — deliberately not in
            the pinned footer next to Save. */}
        <div className="pt-1">
          <button
            type="button"
            onClick={remove}
            className="rounded-md px-2 py-1.5 text-sm text-red-400 hover:bg-red-500/10 light:text-red-600"
          >
            {t("collection.delete")}
          </button>
        </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3 light:border-zinc-200">
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
    </Modal>
  );
}
