"use client";

import { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { Trip, TripStep } from "@/lib/types/trip";
import { StepList } from "@/components/trip/StepList";
import { StepDialog } from "@/components/trip/StepDialog";
import { AttachmentManager } from "@/components/trip/AttachmentManager";
import { useTripDocument } from "@/components/providers/TripDocumentProvider";
import { useI18n } from "@/components/providers/I18nProvider";
import { createEmptyStep, createEmptyStepInsertedAfter } from "@/lib/tripDefaults";
import { GroupedNumberInput } from "@/components/trip/GroupedNumberInput";
import { TripDateTimeInput } from "@/components/trip/TripDateTimeInput";
import { instantFromParts } from "@/lib/timeline/dates";

export type ManageLockSession = { isYou: boolean; email: string } | null;

export function ManageTab({
  manageLockSession = null,
}: {
  manageLockSession?: ManageLockSession;
}) {
  const { trip, persist, canUndo, undo, canSaveToFirestore, saveNow } =
    useTripDocument();
  const { t } = useI18n();
  const [tripSaveError, setTripSaveError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    step: TripStep;
    isNew?: boolean;
  } | null>(null);
  const latestTrip = useRef<Trip | null>(null);

  useEffect(() => {
    latestTrip.current = trip;
  }, [trip]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, [contenteditable=true]")) return;
      if (!canUndo || !canSaveToFirestore) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canUndo, canSaveToFirestore, undo]);

  if (!trip) return null;

  const doc = trip;

  function normalizeStepOrder(steps: TripStep[]): TripStep[] {
    const enriched = steps.map((step, idx) => {
      const instant = instantFromParts({
        date: step.startDate.trim(),
        time: step.startTime.trim(),
      });
      return {
        step,
        originalOrder: step.order,
        originalIndex: idx,
        hasDate: Boolean(instant),
        dateMs: instant?.getTime() ?? 0,
      };
    });
    enriched.sort((a, b) => {
      if (a.hasDate && b.hasDate) {
        if (a.dateMs !== b.dateMs) return a.dateMs - b.dateMs;
        if (a.originalOrder !== b.originalOrder) return a.originalOrder - b.originalOrder;
        return a.originalIndex - b.originalIndex;
      }
      if (a.hasDate !== b.hasDate) return a.hasDate ? -1 : 1;
      if (a.originalOrder !== b.originalOrder) return a.originalOrder - b.originalOrder;
      return a.originalIndex - b.originalIndex;
    });
    return enriched.map((item, idx) => ({ ...item.step, order: idx }));
  }

  function persistNonInputChange(next: Trip) {
    setTripSaveError(null);
    persist(next);
    void saveNow().catch((err: unknown) => {
      setTripSaveError(err instanceof Error ? err.message : String(err));
    });
  }

  function addStep() {
    const sorted = [...doc.steps].sort((a, b) => a.order - b.order);
    const last = sorted.length ? sorted[sorted.length - 1] : null;
    const order = doc.steps.length
      ? Math.max(...doc.steps.map((s) => s.order)) + 1
      : 0;
    const base = last ? createEmptyStepInsertedAfter(last, order) : createEmptyStep(order);
    const step = { ...base, id: uuidv4() };
    persistNonInputChange({ ...doc, steps: normalizeStepOrder([...doc.steps, step]) });
    setEditing({ step, isNew: true });
  }

  function insertStepAfter(afterStepId: string) {
    const sorted = [...doc.steps].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((s) => s.id === afterStepId);
    if (idx < 0) return;
    const newStep = {
      ...createEmptyStepInsertedAfter(sorted[idx], 0),
      id: uuidv4(),
    };
    const withNew = [...sorted.slice(0, idx + 1), newStep, ...sorted.slice(idx + 1)];
    const renumbered = withNew.map((s, i) => ({ ...s, order: i }));
    persistNonInputChange({ ...doc, steps: normalizeStepOrder(renumbered) });
    setEditing({ step: newStep, isNew: true });
  }

  function deleteStep(stepId: string) {
    const steps = doc.steps
      .filter((s) => s.id !== stepId)
      .map((s, idx) => ({ ...s, order: idx }));
    persistNonInputChange({ ...doc, steps: normalizeStepOrder(steps) });
  }

  function setActive(stepId: string) {
    const steps = doc.steps.map((s) => {
      if (s.id === stepId) return { ...s, status: "active" as const };
      if (s.status === "active") return { ...s, status: "todo" as const };
      return s;
    });
    persistNonInputChange({
      ...doc,
      autoCurrentByDate: false,
      steps: normalizeStepOrder(steps),
    });
  }

  function reorderSteps(orderedStepIds: string[]) {
    if (!orderedStepIds.length) return;
    const byId = new Map(doc.steps.map((s) => [s.id, s] as const));
    const next = orderedStepIds
      .map((id) => byId.get(id))
      .filter((s): s is TripStep => Boolean(s))
      .map((s, idx) => ({ ...s, order: idx }));
    if (next.length !== doc.steps.length) return;
    persistNonInputChange({ ...doc, steps: normalizeStepOrder(next) });
  }

  return (
    <div className="relative">
      {manageLockSession ? (
        <div
          className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-200"
          role="status"
        >
          <span className="font-semibold text-zinc-900 dark:text-zinc-50">
            {t("manage.manageSession")}
          </span>
          <span className="mx-1.5 text-zinc-400 dark:text-zinc-500">—</span>
          {manageLockSession.isYou ? (
            <>
              {t("manage.manageSessionYou")}
              {manageLockSession.email
                ? ` · ${manageLockSession.email}`
                : ` · ${t("manage.manageSessionNoEmail")}`}
            </>
          ) : (
            <>
              {t("manage.manageSessionOther")}
              {manageLockSession.email
                ? ` · ${manageLockSession.email}`
                : ` · ${t("manage.manageSessionNoEmail")}`}
            </>
          )}
        </div>
      ) : null}
      <div className="space-y-6 pb-28">
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
          <TripDateTimeInput
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            date={doc.tripStartDate}
            time={doc.tripStartTime}
            onDateChange={(tripStartDate) => persist({ ...doc, tripStartDate })}
            onTimeChange={(tripStartTime) => persist({ ...doc, tripStartTime })}
          />
        </label>
        <label className="mt-4 block text-xs font-medium text-zinc-700 dark:text-zinc-200">
          {t("manage.tripBudget")}
          <GroupedNumberInput
            allowEmptyZero
            min={0}
            placeholder={t("common.optional")}
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            value={doc.budget}
            onChange={(n) => persist({ ...doc, budget: n })}
          />
        </label>
        <p className="mt-1 text-xs text-zinc-500">{t("manage.tripBudgetHint")}</p>
        <label className="mt-4 block text-xs font-medium text-zinc-700 dark:text-zinc-200">
          Manage tab password
          <input
            type="password"
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            value={doc.managePassword}
            onChange={(e) => persist({ ...doc, managePassword: e.target.value })}
            placeholder="Leave empty to keep Manage open"
          />
        </label>
        <p className="mt-1 text-xs text-zinc-500">
          If set, users must enter this password before opening Manage.
        </p>
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
          onEdit={(s) => setEditing({ step: s })}
          onDelete={deleteStep}
          onSetActive={setActive}
          onReorder={reorderSteps}
          onInsertAfter={insertStepAfter}
        />
      </section>

      <AttachmentManager
        title="Trip files (passports, plane tickets, reservations, receipts)"
        attachments={doc.tripAttachments}
        uploadPathPrefix={`trips/${doc.id}/trip-attachments`}
          onChange={(tripAttachments) =>
            persistNonInputChange({ ...doc, tripAttachments })
          }
      />

      {editing ? (
        <StepDialog
          tripId={doc.id}
          tripSteps={doc.steps}
          key={editing.step.id}
          initial={editing.step}
          isNewStep={Boolean(editing.isNew)}
          onClose={() => setEditing(null)}
          onSave={async (saved) => {
            const base = latestTrip.current;
            if (!base) return;
            const idx = base.steps.findIndex((s) => s.id === saved.id);
            const steps =
              idx === -1
                ? (() => {
                    const nextOrder = base.steps.length
                      ? Math.max(...base.steps.map((s) => s.order)) + 1
                      : 0;
                    return [...base.steps, { ...saved, order: nextOrder }];
                  })()
                : base.steps.map((s) => (s.id === saved.id ? saved : s));
            persist({ ...base, steps: normalizeStepOrder(steps) });
            await saveNow();
          }}
        />
      ) : null}
      </div>

      <div
        className="sticky bottom-0 z-30 -mx-4 mt-2 flex flex-col gap-2 border-t border-zinc-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-8px_rgba(0,0,0,0.08)] backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/95 dark:shadow-[0_-8px_24px_-8px_rgba(0,0,0,0.35)]"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {tripSaveError ? (
          <p className="text-xs font-medium text-red-600 dark:text-red-400">
            {tripSaveError}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          disabled={!canSaveToFirestore}
          title={
            canSaveToFirestore ? t("manage.saveHint") : t("manage.saveNothing")
          }
          onClick={() => {
            setTripSaveError(null);
            void saveNow().catch((err: unknown) => {
              setTripSaveError(
                err instanceof Error ? err.message : String(err)
              );
            });
          }}
          className="rounded-xl bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-900"
        >
          {t("manage.save")}
        </button>
        <button
          type="button"
          disabled={!canUndo || !canSaveToFirestore}
          title={t("manage.undoHint")}
          onClick={() => undo()}
          className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          {t("manage.undo")}
        </button>
        </div>
      </div>
    </div>
  );
}
