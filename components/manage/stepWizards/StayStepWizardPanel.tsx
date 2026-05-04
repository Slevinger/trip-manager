"use client";

import { useEffect, useState } from "react";
import { DestinationsInput } from "@/components/manage/DestinationsInput";
import { appendGeoPickComment, notesToText, textToNotes } from "@/components/manage/stepWizards/wizardShared";
import { useI18n } from "@/lib/i18n/context";
import { destinationFromPlacePick, destinationFromTypedLocation } from "@/lib/canonicalStepBuilders";
import type { TripGroupedPlacePicks } from "@/lib/tripLocationCatalog";
import { STEP_WIZARD_IDS } from "@/lib/wizardStack/types";
import type { WizardStackControls } from "@/lib/wizardStack/useWizardStack";
import type { Destination, StayStep } from "@/lib/types/trip";

const STAY_STEP_WIZARD_PAGE_COUNT = 2;

export function StayStepWizardPanel({
  draft,
  setDraft,
  wizard,
  tripPlaceGrouped,
  mainPlace,
  setMainPlace,
  areaCenterPlace,
  setAreaCenterPlace,
  allocateAreaCenterDestinationId,
  onClearAreaCenter,
  onRegisterNewDestination,
}: {
  draft: StayStep;
  setDraft: (next: StayStep | ((prev: StayStep) => StayStep)) => void;
  wizard: WizardStackControls;
  tripPlaceGrouped: TripGroupedPlacePicks;
  mainPlace: Destination;
  setMainPlace: (next: Destination) => void;
  /** Registry row for optional `areaCenterDestinationId`; omitted until the user edits area center. */
  areaCenterPlace: Destination | undefined;
  setAreaCenterPlace: (next: Destination) => void;
  allocateAreaCenterDestinationId: () => string;
  onClearAreaCenter: () => void;
  onRegisterNewDestination: (d: Destination) => void;
}) {
  const { t } = useI18n();
  /** Area center field before `draft.areaCenterDestinationId` exists — no registry row until pick / create. */
  const [areaCenterDraftLocation, setAreaCenterDraftLocation] = useState("");
  useEffect(() => {
    if (!draft.areaCenterDestinationId) setAreaCenterDraftLocation("");
  }, [draft.areaCenterDestinationId]);
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
            <DestinationsInput
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              placeholder="Type at least 2 characters…"
              tripPlaceGrouped={tripPlaceGrouped}
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
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-700 dark:bg-zinc-900/40">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              {t("manage.stayAreaCenterLabel")}
              <DestinationsInput
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                placeholder={t("manage.optional")}
                tripPlaceGrouped={tripPlaceGrouped}
                onRegisterNewDestination={onRegisterNewDestination}
                value={
                  draft.areaCenterDestinationId
                    ? (areaCenterPlace?.location ?? "").trim()
                    : areaCenterDraftLocation
                }
                onChange={(location) => {
                  if (draft.areaCenterDestinationId && areaCenterPlace) {
                    setAreaCenterPlace(destinationFromTypedLocation(areaCenterPlace, location));
                  } else {
                    setAreaCenterDraftLocation(location);
                  }
                }}
                onPick={(pick) => {
                  const id = allocateAreaCenterDestinationId();
                  const merged = destinationFromPlacePick(pick, { id });
                  const prevTitle =
                    (areaCenterPlace?.title ?? "").trim() ||
                    areaCenterDraftLocation.trim().split(",")[0]?.trim() ||
                    merged.title;
                  setAreaCenterPlace({ ...merged, title: prevTitle });
                  setAreaCenterDraftLocation("");
                  if (merged.id !== id) {
                    setDraft((prev) => {
                      const st = prev as StayStep;
                      return st.areaCenterDestinationId === merged.id
                        ? prev
                        : { ...st, areaCenterDestinationId: merged.id };
                    });
                  }
                }}
              />
            </label>
            <p className="mt-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
              {t("manage.stayAreaCenterHint")}
            </p>
            {draft.areaCenterDestinationId ? (
              <button
                type="button"
                onClick={onClearAreaCenter}
                className="mt-2 text-xs font-medium text-zinc-600 underline decoration-zinc-400 underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                {t("manage.stayAreaCenterClear")}
              </button>
            ) : null}
          </div>
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
