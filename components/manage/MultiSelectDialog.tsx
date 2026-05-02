"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/context";

export function formatSnakeCaseLabel(key: string): string {
  return key
    .split("_")
    .map((w) => (w.length ? w.slice(0, 1).toUpperCase() + w.slice(1) : ""))
    .join(" ");
}

type MultiSelectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  options: readonly string[] | string[];
  selected: string[];
  onSave: (next: string[]) => void | Promise<void>;
  formatLabel?: (key: string) => string;
  hint?: string;
  /** When set, shows a control that clears the trip-level override (caller closes dialog). */
  onClearOverride?: () => void;
  clearOverrideLabel?: string;
};

export function MultiSelectDialog({
  open,
  onOpenChange,
  title,
  options,
  selected,
  onSave,
  formatLabel = formatSnakeCaseLabel,
  hint,
  onClearOverride,
  clearOverrideLabel,
}: MultiSelectDialogProps) {
  const { t } = useI18n();
  const clearLabel = clearOverrideLabel ?? t("manage.useProfileDefaults");
  const titleId = useId();
  const optionSet = useMemo(() => new Set(options), [options]);
  const [draft, setDraft] = useState<string[]>(selected);
  const [customInput, setCustomInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(selected);
    setCustomInput("");
  }, [open, selected]);

  if (!open) return null;

  const customSelected = draft.filter((x) => !optionSet.has(x));

  function toggle(key: string) {
    setDraft((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  }

  function addCustom() {
    const v = customInput.trim();
    if (!v) return;
    const norm = v.replace(/\s+/g, " ");
    setDraft((prev) => (prev.includes(norm) ? prev : [...prev, norm]));
    setCustomInput("");
  }

  function removeCustom(key: string) {
    setDraft((prev) => prev.filter((x) => x !== key));
  }

  async function handleSave() {
    setBusy(true);
    try {
      await onSave(draft);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center overflow-y-auto overflow-x-hidden bg-black/50 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-labelledby={titleId}
        className="flex w-full max-w-lg flex-col rounded-t-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900 sm:my-4 sm:max-h-[min(92vh,720px)] sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <h2 id={titleId} className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {title}
          </h2>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            onClick={() => onOpenChange(false)}
          >
            {t("common.close")}
          </button>
        </div>

        <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {hint ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
          ) : null}

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{t("manage.suggested")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {options.map((opt) => {
                const on = draft.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggle(opt)}
                    className={
                      on
                        ? "rounded-full bg-violet-600 px-2.5 py-1 text-xs font-medium text-white"
                        : "rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                    }
                  >
                    {formatLabel(opt)}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{t("manage.custom")}</p>
            {customSelected.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {customSelected.map((c) => (
                  <li key={c}>
                    <button
                      type="button"
                      onClick={() => removeCustom(c)}
                      className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs font-medium text-white dark:bg-zinc-700"
                      title={t("common.remove")}
                    >
                      {c} ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-zinc-400">{t("manage.noCustomEntries")}</p>
            )}
            <div className="mt-2 flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                placeholder={t("manage.addCustomPlaceholder")}
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustom();
                  }
                }}
              />
              <button
                type="button"
                onClick={addCustom}
                className="shrink-0 rounded-xl border border-zinc-200 px-3 py-2 text-xs font-semibold dark:border-zinc-600"
              >
                {t("profile.add")}
              </button>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
          {onClearOverride ? (
            <button
              type="button"
              className="mr-auto rounded-xl border border-amber-200 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-800 dark:text-amber-100"
              onClick={() => {
                onClearOverride();
                onOpenChange(false);
              }}
            >
              {clearLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium dark:border-zinc-700"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() => void handleSave()}
          >
            {busy ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
