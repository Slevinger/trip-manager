"use client";

import { DestinationsInput } from "@/components/manage/DestinationsInput";
import {
  appendStepInterval,
  destinationFromPlacePick,
  destinationFromTypedLocation,
} from "@/lib/canonicalStepBuilders";
import {
  useWizardDirection,
  WIZARD_INPUT_CLASS,
  WIZARD_INPUT_CLASS_LARGE,
  WIZARD_SELECT_CLASS,
  WIZARD_TEXTAREA_CLASS,
  WizardField,
  WizardNavRow,
  WizardPage,
  WizardPageHeading,
  WizardSection,
} from "@/components/manage/stepWizards/wizardShared";
import {
  mergeCalendarIsoPair,
  StartTimeAndDuration,
} from "@/components/dateRange/DateRangeCalendar";
import type { TripGroupedPlacePicks } from "@/lib/tripLocationCatalog";
import { useI18n } from "@/lib/i18n/context";
import { intlLocaleForApp } from "@/lib/i18n/messages";
import { intervalIndexFromFrame, STEP_WIZARD_IDS } from "@/lib/wizardStack/types";
import type { WizardFrame } from "@/lib/wizardStack/types";
import type { WizardStackControls } from "@/lib/wizardStack/useWizardStack";
import type {
  Destination,
  TransitStep,
  TransitStepInterval,
  TransitType,
  Trip,
} from "@/lib/types/trip";
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
  tripPlaceGrouped,
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
  tripPlaceGrouped: TripGroupedPlacePicks;
  getRow: (id: string | undefined) => Destination;
  setRow: (id: string, row: Destination) => void;
  onAppendDestinations: (rows: Destination[]) => void;
}) {
  const { locale } = useI18n();
  const intlLocale = intlLocaleForApp(locale);
  const intervalIndex = Math.min(intervalIndexFromFrame(frame), draft.stepIntervals.length - 1);
  const interval = draft.stepIntervals[intervalIndex];
  const page = Math.min(
    Math.max(0, wizard.top?.step ?? 0),
    TRANSIT_INTERVAL_WIZARD_PAGE_COUNT - 1
  );
  const direction = useWizardDirection(page);

  if (!interval || interval.intervalType !== "transit") {
    return (
      <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
        Invalid transit interval.
      </p>
    );
  }

  const ti = interval as TransitStepInterval;
  const legFromId = ti.fromDestinationId ?? draft.fromStayId;
  const legToId = ti.toDestinationId ?? draft.toStayId;

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
    <div className="space-y-6">
      <WizardPage pageKey={page} direction={direction}>
        {page === 0 ? (
          <div className="space-y-5">
            <WizardPageHeading
              eyebrow={`Transit interval #${intervalIndex + 1}`}
              title="Tell us about this leg"
              subtitle="Set the times, the start and end address, and the mode of transit."
              accent="sky"
            />

            <WizardField
              htmlFor="transit-interval-title"
              label="Leg title"
              hint="Shows up on the itinerary list."
            >
              <input
                id="transit-interval-title"
                className={WIZARD_INPUT_CLASS_LARGE}
                placeholder="e.g., TG203 BKK→HKT"
                value={interval.title}
                onChange={(e) => patchIntervalAt(intervalIndex, { title: e.target.value })}
              />
            </WizardField>

            <WizardSection title="When does it run?" hint="Pick the departure time and how long the leg takes — we'll compute the arrival.">
              <StartTimeAndDuration
                startIso={interval.startTime}
                endIso={interval.endTime}
                onChange={(startIso, endIso) => {
                  const merged = mergeCalendarIsoPair(
                    interval.startTime,
                    interval.endTime,
                    startIso,
                    endIso
                  );
                  patchIntervalAt(intervalIndex, {
                    startTime: merged.startIso,
                    endTime: merged.endIso,
                  });
                }}
                intlLocale={intlLocale}
                startLabel="Departs"
                durationLabel="Duration"
              />
            </WizardSection>

            <div className="grid gap-4 sm:grid-cols-2">
              <WizardField label="Leg from — address">
                <DestinationsInput
                  className={WIZARD_INPUT_CLASS}
                  placeholder="Pick or search…"
                  tripPlaceGrouped={tripPlaceGrouped}
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
              </WizardField>
              <WizardField label="Leg to — address">
                <DestinationsInput
                  className={WIZARD_INPUT_CLASS}
                  placeholder="Pick or search…"
                  tripPlaceGrouped={tripPlaceGrouped}
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
              </WizardField>
            </div>

            <WizardField
              htmlFor="transit-interval-mode"
              label="Transit mode"
              hint="Drives the icon, color and routing logic."
            >
              <select
                id="transit-interval-mode"
                className={WIZARD_SELECT_CLASS}
                value={interval.transitType}
                onChange={(e) =>
                  patchIntervalAt(intervalIndex, { transitType: e.target.value as TransitType })
                }
              >
                {TRANSIT_TYPES.map((tt) => (
                  <option key={tt} value={tt}>
                    {tt.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </WizardField>
          </div>
        ) : (
          <div className="space-y-5">
            <WizardPageHeading
              eyebrow={`Transit interval #${intervalIndex + 1}`}
              title="Anything to remember?"
              subtitle="Confirmation numbers, gate info, transfer instructions — all live with this leg."
              accent="sky"
            />
            <WizardField
              htmlFor="transit-interval-comment"
              label="Leg notes"
              optional
              hint="Picked addresses are appended automatically."
            >
              <textarea
                id="transit-interval-comment"
                rows={6}
                className={WIZARD_TEXTAREA_CLASS}
                placeholder="e.g., Confirm at airline 24h prior. Driver waits 15 min."
                value={interval.comment ?? ""}
                onChange={(e) =>
                  patchIntervalAt(intervalIndex, {
                    comment: e.target.value.trim() ? e.target.value : undefined,
                  })
                }
              />
            </WizardField>
          </div>
        )}
      </WizardPage>

      <WizardNavRow
        page={page}
        totalPages={TRANSIT_INTERVAL_WIZARD_PAGE_COUNT}
        prevLabel={page <= 0 ? "Transit step" : "Previous"}
        nextLabel="Next"
        accent="sky"
        onPrev={() => (page <= 0 ? wizard.pop() : wizard.setTopStep(page - 1))}
        onNext={() => wizard.setTopStep(page + 1)}
        finalAction={{ label: "Add another transit", onClick: addAnotherTransitInterval }}
      />
    </div>
  );
}
