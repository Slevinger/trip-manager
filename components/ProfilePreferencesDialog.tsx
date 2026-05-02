"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  ACTIVITY_TYPES,
  HOBBY_OPTIONS,
  LIFESTYLE_OPTIONS,
} from "@/components/manage/stepEditorConstants";
import { formatSnakeCaseLabel } from "@/components/manage/MultiSelectDialog";
import { useI18n } from "@/lib/i18n/context";
import type { UserPreferences } from "@/lib/types/trip";

type ProfilePreferencesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: UserPreferences;
  onSave: (next: UserPreferences) => void | Promise<void>;
};

export function ProfilePreferencesDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: ProfilePreferencesDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const [draft, setDraft] = useState<UserPreferences>(initial);
  const [customInputs, setCustomInputs] = useState({ hobbies: "", activities: "", lifestyle: "" });
  const [busy, setBusy] = useState(false);

  const hobbySet = useMemo(() => new Set(HOBBY_OPTIONS), []);
  const activitySet = useMemo(() => new Set(ACTIVITY_TYPES), []);
  const lifestyleSet = useMemo(() => new Set(LIFESTYLE_OPTIONS), []);

  useEffect(() => {
    if (!open) return;
    setDraft(initial);
    setCustomInputs({ hobbies: "", activities: "", lifestyle: "" });
  }, [open, initial]);

  if (!open) return null;

  const sectionPlaceholder: Record<keyof UserPreferences, string> = {
    hobbies: t("profile.placeholderHobbies"),
    activities: t("profile.placeholderActivities"),
    lifestyle: t("profile.placeholderLifestyle"),
  };

  function toggle(list: keyof UserPreferences, key: string) {
    setDraft((prev) => {
      const cur = prev[list];
      const nextList = cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key];
      return { ...prev, [list]: nextList };
    });
  }

  function addCustom(list: keyof UserPreferences) {
    const raw = customInputs[list].trim();
    if (!raw) return;
    const norm = raw.replace(/\s+/g, " ");
    setDraft((prev) => {
      const cur = prev[list];
      if (cur.includes(norm)) return prev;
      return { ...prev, [list]: [...cur, norm] };
    });
    setCustomInputs((s) => ({ ...s, [list]: "" }));
  }

  function removeCustom(list: keyof UserPreferences, key: string) {
    setDraft((prev) => ({ ...prev, [list]: prev[list].filter((x) => x !== key) }));
  }

  function renderSection(
    label: string,
    listKey: keyof UserPreferences,
    options: readonly string[],
    optionSet: Set<string>
  ) {
    const customSel = draft[listKey].filter((x) => !optionSet.has(x));
    return (
      <section className="space-y-2 border-b border-zinc-100 pb-4 last:border-b-0 dark:border-zinc-800">
        <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{label}</h3>
        <div className="flex flex-wrap gap-2">
          {options.map((opt) => {
            const on = draft[listKey].includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggle(listKey, opt)}
                className={
                  on
                    ? "rounded-full bg-violet-600 px-2.5 py-1 text-xs font-medium text-white"
                    : "rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                }
              >
                {formatSnakeCaseLabel(opt)}
              </button>
            );
          })}
        </div>
        {customSel.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {customSel.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => removeCustom(listKey, c)}
                className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-white dark:bg-zinc-700"
              >
                {c} ×
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
            placeholder={sectionPlaceholder[listKey]}
            value={customInputs[listKey]}
            onChange={(e) => setCustomInputs((s) => ({ ...s, [listKey]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom(listKey);
              }
            }}
          />
          <button
            type="button"
            onClick={() => addCustom(listKey)}
            className="shrink-0 rounded-xl border border-zinc-200 px-2 py-1 text-xs font-semibold dark:border-zinc-600"
          >
            {t("profile.add")}
          </button>
        </div>
      </section>
    );
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
        className="flex w-full max-w-xl flex-col rounded-t-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900 sm:my-4 sm:max-h-[min(92vh,780px)] sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <h2 id={titleId} className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {t("profile.title")}
          </h2>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            onClick={() => onOpenChange(false)}
          >
            {t("common.close")}
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("profile.intro")}</p>
          {renderSection(t("profile.hobbies"), "hobbies", HOBBY_OPTIONS, hobbySet)}
          {renderSection(t("profile.activities"), "activities", ACTIVITY_TYPES, activitySet)}
          {renderSection(t("profile.lifestyle"), "lifestyle", LIFESTYLE_OPTIONS, lifestyleSet)}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
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
