import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Modal } from "./Modal";
import { useWhatsNew } from "../hooks/useWhatsNew";
import type { ScanScope, Suggestion } from "../lib/whatsNew";

// The scannable sections. "all" is the whole library; the others scan just that
// slice (quicker, lighter on the sources). Games are absent — game sequels are
// out of scope for the scanner.
const SCOPES: ScanScope[] = ["all", "animation", "drama", "variety"];

// Feature A UI. A "Check for updates" button → progress → a results panel grouped
// by show ("{Show} — {Season/Sequel} available") with Add + Dismiss. Standalone;
// reuses the add flow via the hook. Mirrors the other modals' shell/styles.
export function WhatsNewModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { phase, progress, suggestions, checked, scan, add, dismiss } = useWhatsNew();
  // Remember which section is being scanned, to label its button "Scanning…".
  const [activeScope, setActiveScope] = useState<ScanScope | null>(null);

  const runScan = (scope: ScanScope) => {
    setActiveScope(scope);
    void scan(scope);
  };

  return (
    <Modal
      onClose={onClose}
      ariaLabel={t("whatsNew.title")}
      maxWidth="max-w-2xl"
      maxHeight="max-h-[80vh]"
      align="top"
    >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 p-4 light:border-zinc-200">
          <h2 className="text-base font-semibold">{t("whatsNew.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("add.close")}
            className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-800 light:text-zinc-500 light:hover:bg-zinc-100"
          >
            ✕
          </button>
        </div>

        <div className="shrink-0 space-y-3 border-b border-zinc-800 p-4 light:border-zinc-200">
          <p className="text-xs text-zinc-500">{t("whatsNew.intro")}</p>
          {/* Per-section scan buttons — scan just one slice for a quicker, lighter
              run, or "All" for the whole library. */}
          <div className="flex flex-wrap gap-2">
            {SCOPES.map((scope) => {
              const scanningThis = phase === "scanning" && activeScope === scope;
              return (
                <button
                  key={scope}
                  type="button"
                  onClick={() => runScan(scope)}
                  disabled={phase === "scanning"}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {scanningThis
                    ? t("whatsNew.scanning", { done: progress.done, total: progress.total })
                    : t(`whatsNew.scope.${scope}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {phase === "idle" ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {t("whatsNew.idle")}
            </p>
          ) : phase === "scanning" ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {t("whatsNew.scanning", { done: progress.done, total: progress.total })}
            </p>
          ) : phase === "error" ? (
            <p className="py-8 text-center text-sm text-red-400 light:text-red-600">
              {t("whatsNew.error")}
            </p>
          ) : suggestions.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {t("whatsNew.empty", { count: checked })}
            </p>
          ) : (
            <ul className="space-y-2">
              {suggestions.map((s) => (
                <SuggestionRow
                  key={`${s.source}:${s.externalId}`}
                  suggestion={s}
                  onAdd={() => add(s)}
                  onDismiss={() => dismiss(s)}
                />
              ))}
            </ul>
          )}
        </div>
    </Modal>
  );
}

function SuggestionRow({
  suggestion,
  onAdd,
  onDismiss,
}: {
  suggestion: Suggestion;
  onAdd: () => Promise<void>;
  onDismiss: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<null | "add" | "dismiss">(null);

  const run = (which: "add" | "dismiss", fn: () => Promise<void>) => {
    setBusy(which);
    void fn().catch(() => setBusy(null));
  };

  return (
    <li className="flex gap-3 rounded-md p-2 hover:bg-zinc-800 light:hover:bg-zinc-100">
      <div className="h-20 w-14 shrink-0 overflow-hidden rounded bg-zinc-800 light:bg-zinc-100">
        {suggestion.coverUrl && (
          <img
            src={suggestion.coverUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{suggestion.forTitle}</p>
        <p className="truncate text-xs text-zinc-400 light:text-zinc-500">
          {suggestion.kind === "sequel"
            ? t("whatsNew.sequelAvailable", { label: suggestion.label })
            : t("whatsNew.seasonAvailable", { label: suggestion.label })}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => run("add", onAdd)}
          disabled={busy !== null}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {busy === "add" ? t("add.adding") : t("add.addButton")}
        </button>
        <button
          type="button"
          onClick={() => run("dismiss", onDismiss)}
          disabled={busy !== null}
          className="text-[11px] text-zinc-500 hover:text-zinc-300 hover:underline disabled:opacity-50"
        >
          {t("whatsNew.dismiss")}
        </button>
      </div>
    </li>
  );
}
