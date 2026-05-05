"use client";

import { useId, useMemo, useState, type ReactNode } from "react";

import { DestinationsInput } from "@/components/manage/DestinationsInput";
import {
  destinationFromPlacePick,
  destinationFromTypedLocation,
} from "@/lib/canonicalStepBuilders";
import { useI18n } from "@/lib/i18n/context";
import type { TripGroupedPlacePicks } from "@/lib/tripLocationCatalog";
import type { Destination, TransitStep, TransitStepInterval } from "@/lib/types/trip";
import { STEP_WIZARD_IDS } from "@/lib/wizardStack/types";
import type { WizardStackControls } from "@/lib/wizardStack/useWizardStack";

import {
  appendGeoPickComment,
  notesToText,
  textToNotes,
  useWizardDirection,
  WIZARD_INPUT_CLASS,
  WIZARD_INPUT_CLASS_LARGE,
  WIZARD_SELECT_CLASS,
  WIZARD_TEXTAREA_CLASS,
  WizardField,
  WizardNavRow,
  WizardPage,
  WizardPageHeading,
} from "./wizardShared";

const TRANSIT_STEP_WIZARD_PAGE_COUNT = 2;
const OTHER_OPTION_VALUE = "__other__";

export function TransitStepWizardPanel({
  draft,
  setDraft,
  wizard,
  tripPlaceGrouped,
  fromPlace,
  toPlace,
  setFromPlace,
  setToPlace,
  onRegisterNewDestination,
}: {
  draft: TransitStep;
  setDraft: (next: TransitStep | ((prev: TransitStep) => TransitStep)) => void;
  wizard: WizardStackControls;
  tripPlaceGrouped: TripGroupedPlacePicks;
  fromPlace: Destination;
  toPlace: Destination;
  setFromPlace: (d: Destination) => void;
  setToPlace: (d: Destination) => void;
  onRegisterNewDestination: (d: Destination) => void;
}) {
  const { t } = useI18n();
  const page = Math.min(
    Math.max(0, wizard.top?.step ?? 0),
    TRANSIT_STEP_WIZARD_PAGE_COUNT - 1
  );
  const direction = useWizardDirection(page);

  function appendCommentToFirstInterval(line: string) {
    setDraft((prev) => ({
      ...prev,
      stepIntervals: prev.stepIntervals.map((int, i) =>
        i === 0 && int.intervalType === "transit"
          ? ({ ...int, comment: appendGeoPickComment(int.comment, line) } as TransitStepInterval)
          : int
      ),
    }));
  }

  function goIntervalWizard() {
    wizard.push({
      id: STEP_WIZARD_IDS.transitStepIntervalWizard,
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
              eyebrow="Transit step"
              title="How are you getting there?"
              subtitle="Pick the stays this leg connects — flights, ferries, transfers, road trips."
              accent="sky"
            />

            <WizardField
              htmlFor="transit-step-title"
              label="Step title"
              hint="A short label for the trip plan. We'll generate one if you leave it blank."
            >
              <input
                id="transit-step-title"
                className={WIZARD_INPUT_CLASS_LARGE}
                placeholder="e.g., BKK → HKT flight"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </WizardField>

            <div className="grid gap-4 sm:grid-cols-2">
              <WizardField
                label="From"
                hint="Pick a saved stay, or search a fresh address for the departure."
              >
                <StayOrAddressPicker
                  current={fromPlace}
                  excludeDestinationId={toPlace.id}
                  tripPlaceGrouped={tripPlaceGrouped}
                  placeholder="Pick a stay or address…"
                  onPickStay={(destinationId) => {
                    if (destinationId === draft.fromStayId) return;
                    setDraft({ ...draft, fromStayId: destinationId });
                  }}
                  addressFallback={
                    <DestinationsInput
                      className={WIZARD_INPUT_CLASS}
                      placeholder="Search address…"
                      tripPlaceGrouped={tripPlaceGrouped}
                      onRegisterNewDestination={onRegisterNewDestination}
                      value={fromPlace.location}
                      onChange={(location) => {
                        setFromPlace(destinationFromTypedLocation(fromPlace, location));
                      }}
                      onPick={(pick) => {
                        const merged = destinationFromPlacePick(pick, { id: fromPlace.id });
                        const nameGuess = fromPlace.title.trim()
                          ? fromPlace.title
                          : merged.title;
                        setFromPlace({ ...merged, title: nameGuess });
                        if (merged.id !== draft.fromStayId) {
                          setDraft((prev) => ({ ...prev, fromStayId: merged.id }));
                        }
                        appendCommentToFirstInterval(`From: ${merged.location}`);
                      }}
                    />
                  }
                />
              </WizardField>
              <WizardField
                label="To"
                hint="Pick a saved stay, or search a fresh address for the arrival."
              >
                <StayOrAddressPicker
                  current={toPlace}
                  excludeDestinationId={fromPlace.id}
                  tripPlaceGrouped={tripPlaceGrouped}
                  placeholder="Pick a stay or address…"
                  onPickStay={(destinationId) => {
                    if (destinationId === draft.toStayId) return;
                    setDraft({ ...draft, toStayId: destinationId });
                  }}
                  addressFallback={
                    <DestinationsInput
                      className={WIZARD_INPUT_CLASS}
                      placeholder="Search address…"
                      tripPlaceGrouped={tripPlaceGrouped}
                      onRegisterNewDestination={onRegisterNewDestination}
                      value={toPlace.location}
                      onChange={(location) => {
                        setToPlace(destinationFromTypedLocation(toPlace, location));
                      }}
                      onPick={(pick) => {
                        const merged = destinationFromPlacePick(pick, { id: toPlace.id });
                        const nameGuess = toPlace.title.trim()
                          ? toPlace.title
                          : merged.title;
                        setToPlace({ ...merged, title: nameGuess });
                        if (merged.id !== draft.toStayId) {
                          setDraft((prev) => ({ ...prev, toStayId: merged.id }));
                        }
                        appendCommentToFirstInterval(`To: ${merged.location}`);
                      }}
                    />
                  }
                />
              </WizardField>
            </div>

            {/*
              Transit step's own registry pin (`targetDestinationId`) is auto-resolved by
              `compactBareTransitTargets` to point at the to-stay (or last leg's arrival),
              so no manual "leg place" UI is needed in the typical flow. See lib/i18n
              key `manage.transitStepPlaceHint` for the legacy explanation.
            */}
            <p className="sr-only">{t("manage.transitStepPlaceHint")}</p>
          </div>
        ) : (
          <div className="space-y-5">
            <WizardPageHeading
              eyebrow="Transit step"
              title="Anything to flag for this leg?"
              subtitle="Bag rules, gate quirks, transfer notes — stay-with-the-step reminders."
              accent="sky"
            />
            <WizardField
              htmlFor="transit-step-notes"
              label="Step notes"
              optional
              hint="One thought per line."
            >
              <textarea
                id="transit-step-notes"
                rows={5}
                className={WIZARD_TEXTAREA_CLASS}
                placeholder={"e.g.,\n2 checked bags\nGate B12\nMeet driver at exit"}
                value={notesToText(draft.notes)}
                onChange={(e) => setDraft({ ...draft, notes: textToNotes(e.target.value) })}
              />
            </WizardField>
          </div>
        )}
      </WizardPage>

      <WizardNavRow
        page={page}
        totalPages={TRANSIT_STEP_WIZARD_PAGE_COUNT}
        prevLabel={page <= 0 && wizard.canPop ? "Step type" : "Previous"}
        nextLabel="Next"
        accent="sky"
        prevDisabled={page <= 0 && !wizard.canPop}
        onPrev={() =>
          page <= 0 && wizard.canPop ? wizard.pop() : wizard.setTopStep(page - 1)
        }
        onNext={() => wizard.setTopStep(page + 1)}
        finalAction={{ label: "Transit interval", onClick: goIntervalWizard }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Stay-or-address picker — dropdown of trip stays with an address fallback. */
/* ------------------------------------------------------------------------- */

function StayOrAddressPicker({
  current,
  excludeDestinationId,
  tripPlaceGrouped,
  placeholder,
  onPickStay,
  addressFallback,
}: {
  current: Destination;
  /** Hide this destination id from the stay options (e.g. the opposite endpoint). */
  excludeDestinationId?: string;
  tripPlaceGrouped: TripGroupedPlacePicks;
  placeholder: string;
  onPickStay: (destinationId: string) => void;
  /** Rendered when "Other / search address" mode is active. */
  addressFallback: ReactNode;
}) {
  const selectId = useId();
  const stayOptions = useMemo(() => {
    return tripPlaceGrouped.stayGroups
      .map((g) => ({
        destinationId: g.centerPick.destinationId ?? g.centerPick.id,
        label: g.stayLabel,
        sublabel: g.centerPick.label !== g.stayLabel ? g.centerPick.label : undefined,
      }))
      .filter((opt) => Boolean(opt.destinationId));
  }, [tripPlaceGrouped.stayGroups]);

  const matchingStay = stayOptions.find(
    (opt) => opt.destinationId === current.id
  );

  const [forceOther, setForceOther] = useState(false);
  const showAddress = forceOther || (!matchingStay && Boolean(current.location || current.title));

  const selectValue = matchingStay
    ? matchingStay.destinationId
    : showAddress
      ? OTHER_OPTION_VALUE
      : "";

  return (
    <div className="space-y-2">
      <select
        id={selectId}
        className={WIZARD_SELECT_CLASS}
        value={selectValue}
        onChange={(e) => {
          const next = e.target.value;
          if (next === OTHER_OPTION_VALUE) {
            setForceOther(true);
            return;
          }
          if (!next) return;
          setForceOther(false);
          onPickStay(next);
        }}
      >
        {!selectValue ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {stayOptions.length > 0 ? (
          <optgroup label="Stays in this trip">
            {stayOptions
              .filter((opt) => opt.destinationId !== excludeDestinationId)
              .map((opt) => (
                <option key={opt.destinationId} value={opt.destinationId}>
                  {opt.sublabel ? `${opt.label} — ${opt.sublabel}` : opt.label}
                </option>
              ))}
          </optgroup>
        ) : null}
        <option value={OTHER_OPTION_VALUE}>Other / search an address…</option>
      </select>

      {matchingStay ? (
        <p className="px-1 text-xs leading-snug text-zinc-500 dark:text-zinc-400">
          {matchingStay.sublabel ?? matchingStay.label}
        </p>
      ) : null}

      {showAddress ? <div>{addressFallback}</div> : null}
    </div>
  );
}
