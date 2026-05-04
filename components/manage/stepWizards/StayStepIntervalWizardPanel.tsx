"use client";

import { DestinationsInput } from "@/components/manage/DestinationsInput";
import { appendGeoPickComment } from "@/components/manage/stepWizards/wizardShared";
import { appendStepInterval, destinationFromPlacePick } from "@/lib/canonicalStepBuilders";
import { datetimeLocalValueToIso, isoToDatetimeLocalValue } from "@/lib/isoDatetimeLocal";
import { intervalIndexFromFrame, STEP_WIZARD_IDS } from "@/lib/wizardStack/types";
import type { WizardFrame } from "@/lib/wizardStack/types";
import type { WizardStackControls } from "@/lib/wizardStack/useWizardStack";
import { destinationFromList } from "@/lib/tripDestinationRegistry";
import type { TripGroupedPlacePicks } from "@/lib/tripLocationCatalog";
import type { CurrencyCode, Destination, StayStep, StayType, Trip } from "@/lib/types/trip";
import { STAY_TYPES } from "@/components/manage/stepEditorConstants";

const STAY_INTERVAL_WIZARD_PAGE_COUNT = 2;

export function StayStepIntervalWizardPanel({
  frame,
  draft,
  setDraft,
  patchIntervalAt,
  wizard,
  tripStartIso,
  tripCurrency,
  tripPlaceGrouped,
  trip,
  onAppendDestinations,
}: {
  frame: WizardFrame;
  draft: StayStep;
  setDraft: (next: StayStep | ((prev: StayStep) => StayStep)) => void;
  patchIntervalAt: (index: number, patch: Record<string, unknown>) => void;
  wizard: WizardStackControls;
  tripStartIso: string;
  tripCurrency: CurrencyCode;
  tripPlaceGrouped: TripGroupedPlacePicks;
  trip: Trip;
  onAppendDestinations: (rows: Destination[]) => void;
}) {
  const intervalIndex = Math.min(intervalIndexFromFrame(frame), draft.stepIntervals.length - 1);
  const interval = draft.stepIntervals[intervalIndex];
  const page = Math.min(
    Math.max(0, wizard.top?.step ?? 0),
    STAY_INTERVAL_WIZARD_PAGE_COUNT - 1
  );

  if (!interval || interval.intervalType !== "stay") {
    return <p className="text-sm text-red-600">Invalid stay interval.</p>;
  }

  const intervalStart = isoToDatetimeLocalValue(interval.startTime);
  const intervalEnd = isoToDatetimeLocalValue(interval.endTime);
  const intervalLocationValue =
    (interval.location ?? "").trim() ||
    (interval.destinationId
      ? (destinationFromList(trip.destinations, interval.destinationId)?.location ?? "").trim()
      : "");

  function addAnotherHotelPeriod() {
    const { step: next, newDestinations } = appendStepInterval(draft, tripStartIso, trip);
    onAppendDestinations(newDestinations);
    const newIndex = next.stepIntervals.length - 1;
    setDraft(next);
    wizard.push({
      id: STEP_WIZARD_IDS.stayStepIntervalWizard,
      step: 0,
      payload: { intervalIndex: newIndex },
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs font-medium uppercase tracking-wide text-violet-600 dark:text-violet-400">
        Stay interval #{intervalIndex + 1}
      </p>

      {page === 0 ? (
        <>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Interval title
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              value={interval.title}
              onChange={(e) => patchIntervalAt(intervalIndex, { title: e.target.value })}
            />
          </label>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Location (this interval)
            <DestinationsInput
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              placeholder="Type at least 2 characters…"
              tripPlaceGrouped={tripPlaceGrouped}
              onRegisterNewDestination={(d) => onAppendDestinations([d])}
              value={intervalLocationValue}
              onChange={(location) =>
                patchIntervalAt(intervalIndex, {
                  location: location || undefined,
                  coordinates: undefined,
                  destinationId: undefined,
                })
              }
              onPick={(pick) => {
                const titleGuess =
                  interval.title.trim() || pick.label.split(",")[0]?.trim() || pick.label;
                const nextComment = appendGeoPickComment(interval.comment, pick.label);
                if (pick.destinationId) {
                  const merged = destinationFromPlacePick(pick, { id: pick.destinationId });
                  patchIntervalAt(intervalIndex, {
                    location: merged.location,
                    coordinates: merged.coordinates,
                    destinationId: merged.id,
                    comment: nextComment,
                    ...(interval.title.trim() ? {} : { title: titleGuess }),
                  });
                  return;
                }
                patchIntervalAt(intervalIndex, {
                  location: pick.label,
                  coordinates:
                    pick.lat != null && pick.lng != null
                      ? { lat: pick.lat, lon: pick.lng }
                      : undefined,
                  destinationId: undefined,
                  comment: nextComment,
                  ...(interval.title.trim() ? {} : { title: titleGuess }),
                });
              }}
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
            Stay type
            <select
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              value={interval.stayType}
              onChange={(e) =>
                patchIntervalAt(intervalIndex, { stayType: e.target.value as StayType })
              }
            >
              {STAY_TYPES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Interval comment
            <textarea
              rows={5}
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              placeholder="Notes for this stay period."
              value={interval.comment ?? ""}
              onChange={(e) =>
                patchIntervalAt(intervalIndex, {
                  comment: e.target.value.trim() ? e.target.value : undefined,
                })
              }
            />
          </label>
          <div className="space-y-3">
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Price (optional)</p>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Amount
              <input
                type="number"
                min={0}
                step={0.01}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                placeholder="0"
                value={interval.price === undefined ? "" : String(interval.price.amount)}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === "") {
                    patchIntervalAt(intervalIndex, { price: undefined });
                    return;
                  }
                  const amount = parseFloat(raw);
                  if (Number.isNaN(amount)) return;
                  patchIntervalAt(intervalIndex, {
                    price: {
                      amount,
                      currency: (interval.price?.currency ?? tripCurrency) as CurrencyCode,
                    },
                  });
                }}
              />
            </label>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Currency
              <input
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm uppercase dark:border-zinc-800 dark:bg-zinc-900"
                placeholder={String(tripCurrency)}
                value={interval.price?.currency ?? tripCurrency}
                onChange={(e) => {
                  const currency = (e.target.value.trim() || tripCurrency) as CurrencyCode;
                  const amount = interval.price?.amount;
                  if (amount === undefined) return;
                  patchIntervalAt(intervalIndex, { price: { amount, currency } });
                }}
              />
            </label>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => (page <= 0 ? wizard.pop() : wizard.setTopStep(page - 1))}
          className="rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
        >
          ← {page <= 0 ? "Stay step" : "Previous"}
        </button>
        <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
          Interval · {page + 1} / {STAY_INTERVAL_WIZARD_PAGE_COUNT}
        </p>
        {page < STAY_INTERVAL_WIZARD_PAGE_COUNT - 1 ? (
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
            onClick={addAnotherHotelPeriod}
            className="rounded-xl border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-900 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-100"
          >
            Add another hotel
          </button>
        )}
      </div>
    </div>
  );
}
