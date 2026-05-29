import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  guessPlatformBucket,
  igdbCover,
  igdbPlatformNames,
  igdbYear,
  type IgdbGame,
} from "../lib/igdbSearch";
import type { MediaPlatform } from "../../worker/db/schema";

const PLATFORMS: MediaPlatform[] = [
  "pc",
  "console",
  "handheld",
  "mobile",
  "arcade",
];

// One IGDB search result. The platform is auto-filled from IGDB's platforms
// (best-effort bucket guess) but shown as an editable selector so the user
// confirms / corrects it BEFORE adding — then the chosen bucket is sent with the
// add. Consumption mode (Playing/Watching) is chosen once at the modal level.
export function IgdbResultRow({
  game,
  maybeInLibrary,
  pending,
  onAdd,
}: {
  game: IgdbGame;
  maybeInLibrary: boolean;
  pending: boolean;
  onAdd: (platform: MediaPlatform | null) => void;
}) {
  const { t } = useTranslation();
  const [platform, setPlatform] = useState<MediaPlatform | "">(
    guessPlatformBucket(game) ?? "",
  );

  const cover = igdbCover(game);
  const year = igdbYear(game);
  const platformNames = igdbPlatformNames(game);

  return (
    <li className="flex gap-3 rounded-md p-2 hover:bg-zinc-800 light:hover:bg-zinc-100">
      <div className="h-20 w-14 shrink-0 overflow-hidden rounded bg-zinc-800 light:bg-zinc-100">
        {cover && (
          <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{game.name}</p>
        <p className="text-xs text-zinc-500">
          {[year, platformNames].filter(Boolean).join(" · ")}
        </p>
        {/* Auto-filled platform bucket — confirm or change before adding. */}
        <label className="mt-1 flex items-center gap-1 text-xs text-zinc-400 light:text-zinc-500">
          {t("add.platformLabel")}
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as MediaPlatform | "")}
            className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-100 light:border-zinc-300 light:bg-white light:text-zinc-900"
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
      <div className="flex shrink-0 flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => onAdd(platform === "" ? null : platform)}
          disabled={pending}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {pending ? t("add.adding") : t("add.addButton")}
        </button>
        {maybeInLibrary && (
          <span className="text-[10px] text-amber-400 light:text-amber-600">
            {t("add.maybeInLibrary")}
          </span>
        )}
      </div>
    </li>
  );
}
