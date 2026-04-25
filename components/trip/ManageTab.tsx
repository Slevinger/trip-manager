"use client";

import { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { Trip, TripStep } from "@/lib/types/trip";
import { StepList } from "@/components/trip/StepList";
import { StepDialog } from "@/components/trip/StepDialog";
import { JsonImportExport } from "@/components/trip/JsonImportExport";
import { PrototypeDraftImport } from "@/components/trip/PrototypeDraftImport";
import { useTripDocument } from "@/components/providers/TripDocumentProvider";
import { useI18n } from "@/components/providers/I18nProvider";
import { createEmptyStep } from "@/lib/tripDefaults";

export function ManageTab() {
  const { trip, persist } = useTripDocument();
  const { t } = useI18n();
  const [editing, setEditing] = useState<TripStep | null>(null);
  const latestTrip = useRef<Trip | null>(null);

  useEffect(() => {
    latestTrip.current = trip;
  }, [trip]);

  if (!trip) return null;

  const doc = trip;

  function addStep() {
    const order = doc.steps.length
      ? Math.max(...doc.steps.map((s) => s.order)) + 1
      : 0;
    const step = { ...createEmptyStep(order), id: uuidv4() };
    persist({ ...doc, steps: [...doc.steps, step] });
    setEditing(step);
  }

  function deleteStep(stepId: string) {
    const steps = doc.steps
      .filter((s) => s.id !== stepId)
      .map((s, idx) => ({ ...s, order: idx }));
    persist({ ...doc, steps });
  }

  function setActive(stepId: string) {
    const steps = doc.steps.map((s) => {
      if (s.id === stepId) return { ...s, status: "active" as const };
      if (s.status === "active") return { ...s, status: "todo" as const };
      return s;
    });
    persist({ ...doc, autoCurrentByDate: false, steps });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
          {t("manage.tripTitle")}
          <input
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            value={doc.title}
            onChange={(e) => persist({ ...doc, title: e.target.value })}
          />
        </label>
        <label className="mt-4 block text-xs font-medium text-zinc-700 dark:text-zinc-200">
          {t("manage.tripStart")}
          <input
            type="date"
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            value={doc.tripStart}
            onChange={(e) => persist({ ...doc, tripStart: e.target.value })}
          />
        </label>
        <label className="mt-4 flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-100">
          <input
            type="checkbox"
            checked={doc.smartTimeline}
            onChange={(e) =>
              persist({ ...doc, smartTimeline: e.target.checked })
            }
          />
          <span>{t("manage.smartTimeline")}</span>
        </label>
        <p className="mt-1 text-xs text-zinc-500">{t("manage.smartTimelineHelp")}</p>
        <label className="mt-4 flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-100">
          <input
            type="checkbox"
            checked={doc.autoCurrentByDate}
            onChange={(e) =>
              persist({ ...doc, autoCurrentByDate: e.target.checked })
            }
          />
          <span>{t("manage.autoCurrent")}</span>
        </label>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {t("manage.stepsTitle")}
          </h2>
          <button
            type="button"
            onClick={addStep}
            className="rounded-xl bg-zinc-900 px-3 py-2 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900"
          >
            {t("manage.addStep")}
          </button>
        </div>
        <StepList
          trip={doc}
          onEdit={(s) => setEditing(s)}
          onDelete={deleteStep}
          onSetActive={setActive}
        />
      </section>

      <PrototypeDraftImport
        trip={doc}
        onApply={(next) => persist({ ...next, id: doc.id })}
      />

      <JsonImportExport
        tripId={doc.id}
        trip={doc}
        onReplace={(next) => persist({ ...next, id: doc.id })}
      />

      {editing ? (
        <StepDialog
          key={editing.id}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={(saved) => {
            const base = latestTrip.current;
            if (!base) return;
            const steps = base.steps.map((s) =>
              s.id === saved.id ? saved : s
            );
            persist({ ...base, steps });
          }}
        />
      ) : null}
    </div>
  );
}
