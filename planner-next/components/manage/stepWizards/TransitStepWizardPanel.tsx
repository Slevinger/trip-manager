"use client";

import { DestinationPlaceSearchInput } from "@/components/manage/DestinationPlaceSearchInput";
import { destinationFromPlacePick, destinationFromTypedLocation } from "@/lib/canonicalStepBuilders";
import { STEP_WIZARD_IDS } from "@/lib/wizardStack/types";
import type { WizardStackControls } from "@/lib/wizardStack/useWizardStack";
import type { TripPlacePick } from "@/lib/tripLocationCatalog";
import type { Destination, TransitStep } from "@/lib/types/trip";
import { appendGeoPickComment, notesToText, textToNotes } from "@/components/manage/stepWizards/wizardShared";

const TRANSIT_STEP_WIZARD_PAGE_COUNT = 2;

export function TransitStepWizardPanel({
  draft,
  setDraft,
  wizard,
  tripPlacePicks,
  fromPlace,
  toPlace,
  setFromPlace,
  setToPlace,
  onRegisterNewDestination,
}: {
  draft: TransitStep;
  setDraft: (next: TransitStep | ((prev: TransitStep) => TransitStep)) => void;
  wizard: WizardStackControls;
  tripPlacePicks?: TripPlacePick[];
  fromPlace: Destination;
  toPlace: Destination;
  setFromPlace: (d: Destination) => void;
  setToPlace: (d: Destination) => void;
  onRegisterNewDestination: (d: Destination) => void;
}) {
  const page = Math.min(
    Math.max(0, wizard.top?.step ?? 0),
    TRANSIT_STEP_WIZARD_PAGE_COUNT - 1
  );

  function goIntervalWizard() {
    wizard.push({
      id: STEP_WIZARD_IDS.transitStepIntervalWizard,
      step: 0,
      payload: { intervalIndex: 0 },
    });
  }

  return (
    <div className="space-y-4">
      {page === 0 ? (
        <>
          <p className="text-xs font-medium uppercase tracking-wide text-sky-600 dark:text-sky-400">
            Transit step
          </p>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Step title
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              From (name)
              <input
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                value={fromPlace.title}
                onChange={(e) => setFromPlace({ ...fromPlace, title: e.target.value })}
              />
            </label>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              To (name)
              <input
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                value={toPlace.title}
                onChange={(e) => setToPlace({ ...toPlace, title: e.target.value })}
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              From (search address)
              <DestinationPlaceSearchInput
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                placeholder="From…"
                localPicks={tripPlacePicks}
                onRegisterNewDestination={onRegisterNewDestination}
                value={fromPlace.location}
                onChange={(location) => {
                  setFromPlace(destinationFromTypedLocation(fromPlace, location));
                }}
                onPick={(pick) => {
                  const merged = destinationFromPlacePick(pick, { id: fromPlace.id });
                  const nameGuess = fromPlace.title.trim() ? fromPlace.title : merged.title;
                  const line = `From: ${merged.location}`;
                  const int0 = draft.stepIntervals[0];
                  const nextComment =
                    int0?.intervalType === "transit"
                      ? appendGeoPickComment(int0.comment, line)
                      : line;
                  setFromPlace({ ...merged, title: nameGuess });
                  setDraft({
                    ...draft,
                    ...(merged.id !== draft.fromStayId ? { fromStayId: merged.id } : {}),
                    stepIntervals: draft.stepIntervals.map((int, i) =>
                      i === 0 && int.intervalType === "transit"
                        ? { ...int, comment: nextComment }
                        : int
                    ),
                  });
                }}
              />
            </label>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              To (search address)
              <DestinationPlaceSearchInput
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                placeholder="To…"
                localPicks={tripPlacePicks}
                onRegisterNewDestination={onRegisterNewDestination}
                value={toPlace.location}
                onChange={(location) => {
                  setToPlace(destinationFromTypedLocation(toPlace, location));
                }}
                onPick={(pick) => {
                  const merged = destinationFromPlacePick(pick, { id: toPlace.id });
                  const nameGuess = toPlace.title.trim() ? toPlace.title : merged.title;
                  const line = `To: ${merged.location}`;
                  const int0 = draft.stepIntervals[0];
                  const nextComment =
                    int0?.intervalType === "transit"
                      ? appendGeoPickComment(int0.comment, line)
                      : line;
                  setToPlace({ ...merged, title: nameGuess });
                  setDraft({
                    ...draft,
                    ...(merged.id !== draft.toStayId ? { toStayId: merged.id } : {}),
                    stepIntervals: draft.stepIntervals.map((int, i) =>
                      i === 0 && int.intervalType === "transit"
                        ? { ...int, comment: nextComment }
                        : int
                    ),
                  });
                }}
              />
            </label>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs font-medium uppercase tracking-wide text-sky-600 dark:text-sky-400">
            Transit step
          </p>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Step notes (one line each)
            <textarea
              rows={3}
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              value={notesToText(draft.notes)}
              onChange={(e) => setDraft({ ...draft, notes: textToNotes(e.target.value) })}
            />
          </label>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        <button
          type="button"
          disabled={page <= 0 && !wizard.canPop}
          onClick={() =>
            page <= 0 && wizard.canPop
              ? wizard.pop()
              : wizard.setTopStep(page - 1)
          }
          className="rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-100"
        >
          ← {page <= 0 && wizard.canPop ? "Step type" : "Previous"}
        </button>
        <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
          Transit step · {page + 1} / {TRANSIT_STEP_WIZARD_PAGE_COUNT}
        </p>
        {page < TRANSIT_STEP_WIZARD_PAGE_COUNT - 1 ? (
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
            onClick={goIntervalWizard}
            className="rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-900 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-100"
          >
            Transit interval →
          </button>
        )}
      </div>
    </div>
  );
}
