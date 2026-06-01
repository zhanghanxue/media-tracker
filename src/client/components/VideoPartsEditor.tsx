import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  useAddVideoPart,
  useUpdateVideoPart,
  useDeleteVideoPart,
  useVideoParts,
} from "../hooks/useVideoParts";
import type { MediaVideoPart } from "../lib/videoParts";

// Manage the URL list for a watching-mode item (e.g. a game watched as a
// multi-part playthrough — FGO, a letsplay split across many videos). Lists the
// parts (clickable), with an add row and per-part edit / remove.
export function VideoPartsEditor({ mediaId }: { mediaId: number }) {
  const { t } = useTranslation();
  const { data: parts = [], isLoading } = useVideoParts(mediaId, true);
  const add = useAddVideoPart(mediaId);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  const submit = () => {
    const u = url.trim();
    if (!u) return;
    add.mutate(
      { url: u, title: title.trim() || null },
      {
        onSuccess: () => {
          setUrl("");
          setTitle("");
        },
      },
    );
  };

  return (
    <div className="text-sm">
      <span className="mb-1 block text-zinc-400 light:text-zinc-500">
        {t("editor.videoParts")}
      </span>

      {isLoading ? (
        <p className="text-xs text-zinc-500">{t("editor.videoPartsLoading")}</p>
      ) : parts.length === 0 ? (
        <p className="text-xs text-zinc-500">{t("editor.videoPartsEmpty")}</p>
      ) : (
        <ul className="space-y-1">
          {parts.map((p) => (
            <PartRow key={p.id} mediaId={mediaId} part={p} />
          ))}
        </ul>
      )}

      <div className="mt-2 space-y-1">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t("editor.videoPartUrl")}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs light:border-zinc-300 light:bg-white"
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={t("editor.videoPartTitle")}
            className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs light:border-zinc-300 light:bg-white"
          />
          <button
            type="button"
            onClick={submit}
            disabled={add.isPending || url.trim() === ""}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {t("editor.videoPartAdd")}
          </button>
        </div>
      </div>
    </div>
  );
}

// One part: a clickable link with Edit + Remove; Edit swaps it inline for url /
// title inputs with Save / Cancel. part_number is fixed (not edited here).
function PartRow({ mediaId, part }: { mediaId: number; part: MediaVideoPart }) {
  const { t } = useTranslation();
  const update = useUpdateVideoPart(mediaId);
  const del = useDeleteVideoPart(mediaId);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(part.url);
  const [title, setTitle] = useState(part.title ?? "");

  const startEdit = () => {
    setUrl(part.url);
    setTitle(part.title ?? "");
    setEditing(true);
  };

  const save = () => {
    const u = url.trim();
    if (!u) return;
    update.mutate(
      { partId: part.id, url: u, title: title.trim() || null },
      { onSuccess: () => setEditing(false) },
    );
  };

  if (editing) {
    return (
      <li className="space-y-1 rounded-md bg-zinc-800/40 p-1.5 text-xs light:bg-zinc-100">
        <input
          type="url"
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder={t("editor.videoPartUrl")}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 light:border-zinc-300 light:bg-white"
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder={t("editor.videoPartTitle")}
            className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 light:border-zinc-300 light:bg-white"
          />
          <button
            type="button"
            onClick={save}
            disabled={update.isPending || url.trim() === ""}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {t("editor.videoPartSave")}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="shrink-0 rounded-md px-2 py-1.5 text-zinc-400 hover:text-zinc-200"
          >
            {t("editor.cancel")}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 text-xs">
      <span className="shrink-0 text-zinc-500">{part.part_number}.</span>
      <a
        href={part.url}
        target="_blank"
        rel="noreferrer"
        title={part.url}
        className="min-w-0 flex-1 truncate text-blue-400 hover:underline light:text-blue-600"
      >
        {part.title || part.url}
      </a>
      <button
        type="button"
        onClick={startEdit}
        aria-label={t("editor.videoPartEdit")}
        className="shrink-0 text-zinc-500 hover:text-zinc-200"
      >
        ✎
      </button>
      <button
        type="button"
        onClick={() => del.mutate(part.id)}
        disabled={del.isPending}
        aria-label={t("editor.videoPartRemove")}
        className="shrink-0 text-zinc-500 hover:text-red-400 disabled:opacity-50"
      >
        ✕
      </button>
    </li>
  );
}
