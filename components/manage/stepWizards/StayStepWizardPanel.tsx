"use client";

import { useEffect, useState } from "react";

import { DestinationsInput } from "@/components/manage/DestinationsInput";
import {
  destinationFromPlacePick,
  destinationFromTypedLocation,
} from "@/lib/canonicalStepBuilders";
import { useI18n } from "@/lib/i18n/context";
import type { TripGroupedPlacePicks } from "@/lib/tripLocationCatalog";
import type { Destination, StayStep } from "@/lib/types/trip";
import { STEP_WIZARD_IDS } from "@/lib/wizardStack/types";
import type { WizardStackControls } from "@/lib/wizardStack/useWizardStack";

import {
  appendGeoPickComment,
  notesToText,
  textToNotes,
  useWizardDirection,
  WIZARD_INPUT_CLASS,
  WIZARD_INPUT_CLASS_LARGE,
  WIZARD_TEXTAREA_CLASS,
  WizardField,
  WizardNavRow,
  WizardPage,
  WizardPageHeading,
  WizardSection,
} from "./wizardShared";

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
  const direction = useWizardDirection(page);

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
    <div className="space-y-6">
      <WizardPage pageKey={page} direction={direction}>
        {page === 0 ? (
          <div className="space-y-5">
            <WizardPageHeading
              eyebrow="Stay step"
              title="Where will you be staying?"
              subtitle="Give the step a name and pin the place — hotel, resort, or area you're sleeping in."
              accent="violet"
            />

            <WizardField
              htmlFor="stay-step-title"
              label="Step title"
              hint="Shows up in the itinerary list and on the map."
            >
              <input
                id="stay-step-title"
                className={WIZARD_INPUT_CLASS_LARGE}
                placeholder="e.g., Phuket — Bangtao villa"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </WizardField>

            <WizardField
              htmlFor="stay-step-place-name"
              label="Place name"
              hint="A short label for the property — used as the map pin title."
            >
              <input
                id="stay-step-place-name"
                className={WIZARD_INPUT_CLASS}
                placeholder="Hotel, villa or rental name"
                value={mainPlace.title}
                onChange={(e) => setMainPlace({ ...mainPlace, title: e.target.value })}
              />
            </WizardField>

            <WizardField
              label="Search address"
              hint="Pick from your trip's saved places, or search Google + OpenStreetMap to drop a new pin."
            >
              <DestinationsInput
                className={WIZARD_INPUT_CLASS}
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
            </WizardField>

            <WizardSection
              title={t("manage.stayAreaCenterLabel")}
              hint={t("manage.stayAreaCenterHint")}
            >
              <DestinationsInput
                className={WIZARD_INPUT_CLASS}
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
              {draft.areaCenterDestinationId ? (
                <button
                  type="button"
                  onClick={onClearAreaCenter}
                  className="self-start text-xs font-medium text-violet-600 underline decoration-violet-300 underline-offset-2 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200"
                >
                  {t("manage.stayAreaCenterClear")}
                </button>
              ) : null}
            </WizardSection>
          </div>
        ) : (
          <div className="space-y-5">
            <WizardPageHeading
              eyebrow="Stay step"
              title="Anything to remember?"
              subtitle="Notes appear with this step on the itinerary — booking refs, check-in tips, hosts."
              accent="violet"
            />

            <WizardField
              htmlFor="stay-step-notes"
              label="Step notes"
              optional
              hint="One thought per line."
            >
              <textarea
                id="stay-step-notes"
                rows={5}
                className={WIZARD_TEXTAREA_CLASS}
                placeholder={"e.g.,\nCheck-in 3pm\nBooking ref #ABC123\nFront desk speaks English"}
                value={notesToText(draft.notes)}
                onChange={(e) => setDraft({ ...draft, notes: textToNotes(e.target.value) })}
              />
            </WizardField>
          </div>
        )}
      </WizardPage>

      <WizardNavRow
        page={page}
        totalPages={STAY_STEP_WIZARD_PAGE_COUNT}
        prevLabel={page <= 0 && wizard.canPop ? "Step type" : "Previous"}
        nextLabel="Next"
        accent="violet"
        prevDisabled={page <= 0 && !wizard.canPop}
        onPrev={() =>
          page <= 0 && wizard.canPop ? wizard.pop() : wizard.setTopStep(page - 1)
        }
        onNext={() => wizard.setTopStep(page + 1)}
        finalAction={{ label: "Stay interval", onClick: goIntervalWizard }}
      />
    </div>
  );
}
