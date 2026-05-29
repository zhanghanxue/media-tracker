import { useTranslation } from "react-i18next";

import { useRefreshOngoingEpisodes } from "../hooks/useRefreshOngoingEpisodes";

// Header control: refresh total_episodes for ongoing series (AniList anime like
// One Piece, TMDB dramas) to their newest aired count. One tap; the label
// reflects progress / the result count.
export function RefreshEpisodesButton() {
  const { t } = useTranslation();
  const m = useRefreshOngoingEpisodes();

  const label = m.isPending
    ? t("refresh.running")
    : m.isSuccess
      ? t("refresh.done", { updated: m.data.updated, checked: m.data.checked })
      : m.isError
        ? t("refresh.error")
        : t("refresh.button");

  return (
    <button
      type="button"
      onClick={() => m.mutate()}
      disabled={m.isPending}
      title={t("refresh.button")}
      className="hidden rounded-md px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-60 sm:block light:text-zinc-600 light:hover:bg-zinc-100"
    >
      {label}
    </button>
  );
}
