import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  useAddVideoPart,
  useDeleteVideoPart,
  useVideoParts,
} from "../hooks/useVideoParts";

// Manage the URL list for a watching-mode item (e.g. a game watched as a
// multi-part playthrough — FGO, a letsplay split across many videos). Lists the
// parts (clickable), with an add row and per-part remove.
export function VideoPartsEditor({ mediaId }: { mediaId: number }) {
  const { t } = useTranslation();
  const { data: parts = [], isLoading } = useVideoParts(mediaId, true);
  const add = useAddVideoPart(mediaId);
  const del = useDeleteVideoPart(mediaId);
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
            <li key={p.id} className="flex items-center gap-2 text-xs">
              <span className="shrink-0 text-zinc-500">{p.part_number}.</span>
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                title={p.url}
                className="min-w-0 flex-1 truncate text-blue-400 hover:underline light:text-blue-600"
              >
                {p.title || p.url}
              </a>
              <button
                type="button"
                onClick={() => del.mutate(p.id)}
                disabled={del.isPending}
                aria-label={t("editor.videoPartRemove")}
                className="shrink-0 text-zinc-500 hover:text-red-400 disabled:opacity-50"
              >
                ✕
              </button>
            </li>
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
