"use client";

import { useState } from "react";
import type { Trip } from "@/lib/types/trip";
import { normalizeTripFromFirestore } from "@/lib/trips";
import { useI18n } from "@/components/providers/I18nProvider";

export function JsonImportExport({
  tripId,
  trip,
  onReplace,
}: {
  tripId: string;
  trip: Trip;
  onReplace: (next: Trip) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  function exportJson() {
    const payload = { ...trip, id: tripId };
    const json = JSON.stringify(payload, null, 2);
    setText(json);
    setMessage(null);
  }

  function importJson() {
    try {
      const raw = JSON.parse(text) as Record<string, unknown>;
      const next = normalizeTripFromFirestore(tripId, raw);
      onReplace(next);
      setMessage(null);
    } catch {
      setMessage(t("common.error"));
    }
  }

  async function pasteFromClipboard() {
    try {
      const clip = await navigator.clipboard.readText();
      setText(clip);
    } catch {
      setMessage(t("common.error"));
    }
  }

  async function copyExport() {
    const payload = { ...trip, id: tripId };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    } catch {
      setMessage(t("common.error"));
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {t("json.title")}
      </h2>
      <p className="mt-1 text-xs text-zinc-500">{t("json.hint")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium dark:border-zinc-700 dark:bg-zinc-900"
          onClick={exportJson}
        >
          {t("json.export")}
        </button>
        <button
          type="button"
          className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium dark:border-zinc-700 dark:bg-zinc-900"
          onClick={() => void copyExport()}
        >
          {t("common.copy")}
        </button>
        <button
          type="button"
          className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium dark:border-zinc-700 dark:bg-zinc-900"
          onClick={() => void pasteFromClipboard()}
        >
          {t("json.paste")}
        </button>
        <button
          type="button"
          className="rounded-xl bg-zinc-900 px-3 py-2 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900"
          onClick={importJson}
        >
          {t("json.import")}
        </button>
      </div>
      {message ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{message}</p>
      ) : null}
      <textarea
        className="mt-3 h-40 w-full rounded-xl border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
        dir="ltr"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
    </section>
  );
}
