"use client";

import { useState } from "react";
import type { Trip } from "@/lib/types/trip";
import { prototypeDraftToTrip } from "@/lib/prototypeImport";
import { useI18n } from "@/components/providers/I18nProvider";

export function PrototypeDraftImport({
  trip,
  onApply,
}: {
  trip: Trip;
  onApply: (next: Trip) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  function run() {
    try {
      const raw = JSON.parse(text);
      const next = prototypeDraftToTrip(trip, raw);
      onApply({ ...next, id: trip.id });
      setMessage(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {t("manage.prototypeImportTitle")}
      </h2>
      <p className="mt-1 text-xs text-zinc-500">
        {t("manage.prototypeImportHint")}
      </p>
      <textarea
        className="mt-3 h-40 w-full rounded-xl border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
        dir="ltr"
        spellCheck={false}
        placeholder='{ "tripTitle": "", "tripStart": "2026-05-29T12:00", "steps": [] }'
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {message ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{message}</p>
      ) : null}
      <button
        type="button"
        className="mt-3 w-full rounded-xl bg-zinc-900 py-2 text-sm font-semibold text-white dark:bg-white dark:text-zinc-900"
        onClick={run}
      >
        {t("manage.prototypeImportApply")}
      </button>
    </section>
  );
}
