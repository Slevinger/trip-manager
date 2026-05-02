"use client";

import { appendStepInterval } from "@/lib/canonicalStepBuilders";
import { datetimeLocalValueToIso, isoToDatetimeLocalValue } from "@/lib/isoDatetimeLocal";
import { intervalIndexFromFrame, STEP_WIZARD_IDS } from "@/lib/wizardStack/types";
import type { WizardFrame } from "@/lib/wizardStack/types";
import type { WizardStackControls } from "@/lib/wizardStack/useWizardStack";
import type { ActivityStep, ActivityType, Destination, Trip } from "@/lib/types/trip";
import { ACTIVITY_TYPES } from "@/components/manage/stepEditorConstants";

const ACTIVITY_INTERVAL_WIZARD_PAGE_COUNT = 2;

export function ActivityStepIntervalWizardPanel({
  frame,
  draft,
  setDraft,
  patchIntervalAt,
  wizard,
  tripStartIso,
  trip,
  onAppendDestinations,
}: {
  frame: WizardFrame;
  draft: ActivityStep;
  setDraft: (next: ActivityStep | ((prev: ActivityStep) => ActivityStep)) => void;
  patchIntervalAt: (index: number, patch: Record<string, unknown>) => void;
  wizard: WizardStackControls;
  tripStartIso: string;
  trip: Trip;
  onAppendDestinations: (rows: Destination[]) => void;
}) {
  const intervalIndex = Math.min(intervalIndexFromFrame(frame), draft.stepIntervals.length - 1);
  const interval = draft.stepIntervals[intervalIndex];
  const page = Math.min(
    Math.max(0, wizard.top?.step ?? 0),
    ACTIVITY_INTERVAL_WIZARD_PAGE_COUNT - 1
  );

  if (!interval || interval.intervalType !== "activity") {
    return <p className="text-sm text-red-600">Invalid activity interval.</p>;
  }

  const intervalStart = isoToDatetimeLocalValue(interval.startTime);
  const intervalEnd = isoToDatetimeLocalValue(interval.endTime);

  function addAnotherActivitySlot() {
    const { step: next, newDestinations } = appendStepInterval(draft, tripStartIso, trip);
    onAppendDestinations(newDestinations);
    const newIndex = next.stepIntervals.length - 1;
    setDraft(next);
    wizard.push({
      id: STEP_WIZARD_IDS.activityStepIntervalWizard,
      step: 0,
      payload: { intervalIndex: newIndex },
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
        Activity slot #{intervalIndex + 1}
      </p>

      {page === 0 ? (
        <>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Slot title
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              value={interval.title}
              onChange={(e) => patchIntervalAt(intervalIndex, { title: e.target.value })}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Start
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                value={intervalStart}
                onChange={(e) =>
                  patchIntervalAt(intervalIndex, {
                    startTime: datetimeLocalValueToIso(e.target.value),
                  })
                }
              />
            </label>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              End
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                value={intervalEnd}
                onChange={(e) =>
                  patchIntervalAt(intervalIndex, {
                    endTime: datetimeLocalValueToIso(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Activity type
            <select
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              value={interval.activityType}
              onChange={(e) =>
                patchIntervalAt(intervalIndex, { activityType: e.target.value as ActivityType })
              }
            >
              {ACTIVITY_TYPES.map((at) => (
                <option key={at} value={at}>
                  {at}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Slot comment
          <textarea
            rows={3}
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            value={interval.comment ?? ""}
            onChange={(e) =>
              patchIntervalAt(intervalIndex, {
                comment: e.target.value.trim() ? e.target.value : undefined,
              })
            }
          />
        </label>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => (page <= 0 ? wizard.pop() : wizard.setTopStep(page - 1))}
          className="rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
        >
          ← {page <= 0 ? "Activity step" : "Previous"}
        </button>
        <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
          Slot · {page + 1} / {ACTIVITY_INTERVAL_WIZARD_PAGE_COUNT}
        </p>
        {page < ACTIVITY_INTERVAL_WIZARD_PAGE_COUNT - 1 ? (
          <button
            type="button"
            onClick={() => wizard.setTopStep(page + 1)}
            className="rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
          >
            Next →
          </button>
        ) : (
          <button
            type="button"
            onClick={addAnotherActivitySlot}
            className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-100"
          >
            Add another slot
          </button>
        )}
      </div>
    </div>
  );
}
