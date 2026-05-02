"use client";

import { DestinationPlaceSearchInput } from "@/components/manage/DestinationPlaceSearchInput";
import { appendStepInterval, destinationFromPlacePick, destinationFromTypedLocation } from "@/lib/canonicalStepBuilders";
import type { TripPlacePick } from "@/lib/tripLocationCatalog";
import { datetimeLocalValueToIso, isoToDatetimeLocalValue } from "@/lib/isoDatetimeLocal";
import { intervalIndexFromFrame, STEP_WIZARD_IDS } from "@/lib/wizardStack/types";
import type { WizardFrame } from "@/lib/wizardStack/types";
import type { WizardStackControls } from "@/lib/wizardStack/useWizardStack";
import type { Destination, TransitStep, TransitStepInterval, TransitType, Trip } from "@/lib/types/trip";
import { TRANSIT_TYPES } from "@/components/manage/stepEditorConstants";

const TRANSIT_INTERVAL_WIZARD_PAGE_COUNT = 2;

export function TransitStepIntervalWizardPanel({
  frame,
  draft,
  setDraft,
  patchIntervalAt,
  wizard,
  tripStartIso,
  trip,
  tripPlacePicks,
  getRow,
  setRow,
  onAppendDestinations,
}: {
  frame: WizardFrame;
  draft: TransitStep;
  setDraft: (next: TransitStep | ((prev: TransitStep) => TransitStep)) => void;
  patchIntervalAt: (index: number, patch: Record<string, unknown>) => void;
  wizard: WizardStackControls;
  tripStartIso: string;
  trip: Trip;
  tripPlacePicks?: TripPlacePick[];
  getRow: (id: string | undefined) => Destination;
  setRow: (id: string, row: Destination) => void;
  onAppendDestinations: (rows: Destination[]) => void;
}) {
  const intervalIndex = Math.min(intervalIndexFromFrame(frame), draft.stepIntervals.length - 1);
  const interval = draft.stepIntervals[intervalIndex];
  const page = Math.min(
    Math.max(0, wizard.top?.step ?? 0),
    TRANSIT_INTERVAL_WIZARD_PAGE_COUNT - 1
  );

  if (!interval || interval.intervalType !== "transit") {
    return <p className="text-sm text-red-600">Invalid transit interval.</p>;
  }

  const ti = interval as TransitStepInterval;
  const legFromId = ti.fromDestinationId ?? draft.fromStayId;
  const legToId = ti.toDestinationId ?? draft.toStayId;

  const intervalStart = isoToDatetimeLocalValue(interval.startTime);
  const intervalEnd = isoToDatetimeLocalValue(interval.endTime);

  function addAnotherTransitInterval() {
    const { step: next, newDestinations } = appendStepInterval(draft, tripStartIso, trip);
    onAppendDestinations(newDestinations);
    const newIndex = next.stepIntervals.length - 1;
    setDraft(next);
    wizard.push({
      id: STEP_WIZARD_IDS.transitStepIntervalWizard,
      step: 0,
      payload: { intervalIndex: newIndex },
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs font-medium uppercase tracking-wide text-sky-600 dark:text-sky-400">
        Transit interval #{intervalIndex + 1}
      </p>

      {page === 0 ? (
        <>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Leg title
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
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Leg from (address)
              <DestinationPlaceSearchInput
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                placeholder="Pick trip place or search…"
                localPicks={tripPlacePicks}
                onRegisterNewDestination={(d) => onAppendDestinations([d])}
                value={getRow(legFromId).location}
                onChange={(location) => {
                  const cur = getRow(legFromId);
                  setRow(legFromId, destinationFromTypedLocation(cur, location));
                }}
                onPick={(pick) => {
                  const merged = destinationFromPlacePick(pick, { id: legFromId });
                  const cur = getRow(legFromId);
                  const title = (cur.title ?? "").trim() ? cur.title : merged.title;
                  setRow(merged.id, { ...merged, title });
                  const fallback = draft.fromStayId;
                  patchIntervalAt(intervalIndex, {
                    fromDestinationId:
                      merged.id !== fallback ? merged.id : undefined,
                  });
                }}
              />
            </label>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Leg to (address)
              <DestinationPlaceSearchInput
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                placeholder="Pick trip place or search…"
                localPicks={tripPlacePicks}
                onRegisterNewDestination={(d) => onAppendDestinations([d])}
                value={getRow(legToId).location}
                onChange={(location) => {
                  const cur = getRow(legToId);
                  setRow(legToId, destinationFromTypedLocation(cur, location));
                }}
                onPick={(pick) => {
                  const merged = destinationFromPlacePick(pick, { id: legToId });
                  const cur = getRow(legToId);
                  const title = (cur.title ?? "").trim() ? cur.title : merged.title;
                  setRow(merged.id, { ...merged, title });
                  const fallback = draft.toStayId;
                  patchIntervalAt(intervalIndex, {
                    toDestinationId:
                      merged.id !== fallback ? merged.id : undefined,
                  });
                }}
              />
            </label>
          </div>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Transit mode
            <select
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              value={interval.transitType}
              onChange={(e) =>
                patchIntervalAt(intervalIndex, { transitType: e.target.value as TransitType })
              }
            >
              {TRANSIT_TYPES.map((tt) => (
                <option key={tt} value={tt}>
                  {tt}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Leg comment
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
          ← {page <= 0 ? "Transit step" : "Previous"}
        </button>
        <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
          Interval · {page + 1} / {TRANSIT_INTERVAL_WIZARD_PAGE_COUNT}
        </p>
        {page < TRANSIT_INTERVAL_WIZARD_PAGE_COUNT - 1 ? (
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
            onClick={addAnotherTransitInterval}
            className="rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-900 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-100"
          >
            Add another transit
          </button>
        )}
      </div>
    </div>
  );
}
