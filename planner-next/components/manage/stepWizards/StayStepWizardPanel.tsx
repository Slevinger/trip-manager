"use client";

import { DestinationPlaceSearchInput } from "@/components/manage/DestinationPlaceSearchInput";
import { STEP_WIZARD_IDS } from "@/lib/wizardStack/types";
import type { WizardStackControls } from "@/lib/wizardStack/useWizardStack";
import type { TripPlacePick } from "@/lib/tripLocationCatalog";
import { destinationFromPlacePick, destinationFromTypedLocation } from "@/lib/canonicalStepBuilders";
import type { Destination, StayStep } from "@/lib/types/trip";
import { appendGeoPickComment, notesToText, textToNotes } from "@/components/manage/stepWizards/wizardShared";

const STAY_STEP_WIZARD_PAGE_COUNT = 2;

export function StayStepWizardPanel({
  draft,
  setDraft,
  wizard,
  tripPlacePicks,
  mainPlace,
  setMainPlace,
  onRegisterNewDestination,
}: {
  draft: StayStep;
  setDraft: (next: StayStep | ((prev: StayStep) => StayStep)) => void;
  wizard: WizardStackControls;
  tripPlacePicks?: TripPlacePick[];
  mainPlace: Destination;
  setMainPlace: (next: Destination) => void;
  onRegisterNewDestination: (d: Destination) => void;
}) {
  const page = Math.min(
    Math.max(0, wizard.top?.step ?? 0),
    STAY_STEP_WIZARD_PAGE_COUNT - 1
  );

  function goIntervalWizard() {
    const td = mainPlace;
    setDraft((d) => ({
      ...d,
      stepIntervals: d.stepIntervals.map((int, i) =>
        i === 0 && int.intervalType === "stay" ? { ...int, location: td.location } : int
      ),
    }));
    wizard.push({
      id: STEP_WIZARD_IDS.stayStepIntervalWizard,
      step: 0,
      payload: { intervalIndex: 0 },
    });
  }

  return (
    <div className="space-y-4">
      {page === 0 ? (
        <>
          <p className="text-xs font-medium uppercase tracking-wide text-violet-600 dark:text-violet-400">
            Stay step
          </p>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Step title
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Place name
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              value={mainPlace.title}
              onChange={(e) => setMainPlace({ ...mainPlace, title: e.target.value })}
            />
          </label>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Search address (autocomplete)
            <DestinationPlaceSearchInput
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              placeholder="Type at least 2 characters…"
              localPicks={tripPlacePicks}
              onRegisterNewDestination={onRegisterNewDestination}
              value={mainPlace.location}
              onChange={(location) => {
                setMainPlace(destinationFromTypedLocation(mainPlace, location));
              }}
              onPick={(pick) => {
                const merged = destinationFromPlacePick(pick, { id: mainPlace.id });
                const titleGuess = mainPlace.title.trim() ? mainPlace.title : merged.title;
                const td = { ...merged, title: titleGuess };
                const int0 = draft.stepIntervals[0];
                const nextComment =
                  int0?.intervalType === "stay"
                    ? appendGeoPickComment(int0.comment, td.location)
                    : td.location;
                setMainPlace(td);
                setDraft({
                  ...draft,
                  ...(merged.id !== draft.targetDestinationId
                    ? { targetDestinationId: merged.id }
                    : {}),
                  title: draft.title.trim() ? draft.title : titleGuess,
                  stepIntervals: draft.stepIntervals.map((int, i) =>
                    i === 0 && int.intervalType === "stay"
                      ? { ...int, location: td.location, comment: nextComment }
                      : int
                  ),
                });
              }}
            />
          </label>
        </>
      ) : (
        <>
          <p className="text-xs font-medium uppercase tracking-wide text-violet-600 dark:text-violet-400">
            Stay step
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
          Stay step · {page + 1} / {STAY_STEP_WIZARD_PAGE_COUNT}
        </p>
        {page < STAY_STEP_WIZARD_PAGE_COUNT - 1 ? (
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
            className="rounded-xl border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-900 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-100"
          >
            Stay interval →
          </button>
        )}
      </div>
    </div>
  );
}
