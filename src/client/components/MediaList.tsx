import { useTranslation } from "react-i18next";

import { useMediaList } from "../hooks/useMediaList";
import type { MediaFilters } from "../lib/api";
import { MediaCard } from "./MediaCard";

export function MediaList({ filters }: { filters: MediaFilters }) {
  const { t } = useTranslation();
  const { data, isPending, isError } = useMediaList(filters);

  if (isPending) {
    return (
      <p className="py-8 text-zinc-400 light:text-zinc-500">
        {t("list.loading")}
      </p>
    );
  }
  if (isError) {
    return (
      <p className="py-8 text-red-400 light:text-red-600">{t("list.error")}</p>
    );
  }

  const { items, total } = data;

  return (
    <>
      <p className="mb-3 text-xs text-zinc-500 light:text-zinc-600">
        {t("list.count", { shown: items.length, total })}
      </p>
      {items.length === 0 ? (
        <p className="py-8 text-zinc-400 light:text-zinc-500">
          {t("list.empty")}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((media) => (
            <MediaCard key={media.id} media={media} />
          ))}
        </div>
      )}
    </>
  );
}
