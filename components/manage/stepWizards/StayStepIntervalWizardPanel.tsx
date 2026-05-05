"use client";

import { DestinationsInput } from "@/components/manage/DestinationsInput";
import {
  appendGeoPickComment,
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
import { DateTimeRangeCalendar } from "@/components/dateRange/DateRangeCalendar";
import { appendStepInterval, destinationFromPlacePick } from "@/lib/canonicalStepBuilders";
import { useI18n } from "@/lib/i18n/context";
import { intlLocaleForApp } from "@/lib/i18n/messages";
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
  const { locale } = useI18n();
  const intlLocale = intlLocaleForApp(locale);
  const intervalIndex = Math.min(intervalIndexFromFrame(frame), draft.stepIntervals.length - 1);
  const interval = draft.stepIntervals[intervalIndex];
  const page = Math.min(
    Math.max(0, wizard.top?.step ?? 0),
    STAY_INTERVAL_WIZARD_PAGE_COUNT - 1
  );
  const direction = useWizardDirection(page);

  if (!interval || interval.intervalType !== "stay") {
    return (
      <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
        Invalid stay interval.
      </p>
    );
  }

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
    <div className="space-y-6">
      <WizardPage pageKey={page} direction={direction}>
        {page === 0 ? (
          <div className="space-y-5">
            <WizardPageHeading
              eyebrow={`Stay interval #${intervalIndex + 1}`}
              title="Tell us about this stay"
              subtitle="One stay block can hold multiple stays — each gets its own dates, place, and type."
              accent="violet"
            />

            <WizardField
              htmlFor="stay-interval-title"
              label="Interval title"
              hint="Short label shown on the itinerary timeline."
            >
              <input
                id="stay-interval-title"
                className={WIZARD_INPUT_CLASS_LARGE}
                placeholder="e.g., Sunset Resort, Bangtao"
                value={interval.title}
                onChange={(e) => patchIntervalAt(intervalIndex, { title: e.target.value })}
              />
            </WizardField>

            <WizardField
              label="Address for this period"
              hint="Pick a trip place or search for a new one — sets the map pin for this stay."
            >
              <DestinationsInput
                className={WIZARD_INPUT_CLASS}
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
            </WizardField>

            <WizardSection title="When are you there?" hint="Tap the dates to expand the calendar — adjust check-in and check-out time below.">
              <DateTimeRangeCalendar
                startIso={interval.startTime}
                endIso={interval.endTime}
                onChange={(startIso, endIso) =>
                  patchIntervalAt(intervalIndex, {
                    startTime: startIso || interval.startTime,
                    endTime: endIso || interval.endTime,
                  })
                }
                intlLocale={intlLocale}
                startLabel="Check-in"
                endLabel="Check-out"
                defaultStartTime="15:00"
                defaultEndTime="11:00"
                collapsible
              />
            </WizardSection>

            <WizardField
              htmlFor="stay-interval-type"
              label="Stay type"
              hint="Drives the icon on the map and itinerary."
            >
              <select
                id="stay-interval-type"
                className={WIZARD_SELECT_CLASS}
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
            </WizardField>
          </div>
        ) : (
          <div className="space-y-5">
            <WizardPageHeading
              eyebrow={`Stay interval #${intervalIndex + 1}`}
              title="Notes & price"
              subtitle="Anything you want surfaced on the itinerary — and an optional price for the budget view."
              accent="violet"
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <WizardField
                htmlFor="stay-interval-comment"
                label="Notes"
                optional
                hint="Picked addresses get logged here automatically."
              >
                <textarea
                  id="stay-interval-comment"
                  rows={6}
                  className={WIZARD_TEXTAREA_CLASS}
                  placeholder="Booking ref, host name, special requests…"
                  value={interval.comment ?? ""}
                  onChange={(e) =>
                    patchIntervalAt(intervalIndex, {
                      comment: e.target.value.trim() ? e.target.value : undefined,
                    })
                  }
                />
              </WizardField>

              <WizardSection title="Price" hint="Used for the trip budget view.">
                <WizardField htmlFor="stay-interval-price-amount" label="Amount" optional>
                  <input
                    id="stay-interval-price-amount"
                    type="number"
                    min={0}
                    step={0.01}
                    className={WIZARD_INPUT_CLASS}
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
                </WizardField>
                <WizardField htmlFor="stay-interval-price-currency" label="Currency">
                  <input
                    id="stay-interval-price-currency"
                    className={`${WIZARD_INPUT_CLASS} uppercase tracking-widest`}
                    placeholder={String(tripCurrency)}
                    value={interval.price?.currency ?? tripCurrency}
                    onChange={(e) => {
                      const currency = (e.target.value.trim() || tripCurrency) as CurrencyCode;
                      const amount = interval.price?.amount;
                      if (amount === undefined) return;
                      patchIntervalAt(intervalIndex, { price: { amount, currency } });
                    }}
                  />
                </WizardField>
              </WizardSection>
            </div>
          </div>
        )}
      </WizardPage>

      <WizardNavRow
        page={page}
        totalPages={STAY_INTERVAL_WIZARD_PAGE_COUNT}
        prevLabel={page <= 0 ? "Stay step" : "Previous"}
        nextLabel="Next"
        accent="violet"
        onPrev={() => (page <= 0 ? wizard.pop() : wizard.setTopStep(page - 1))}
        onNext={() => wizard.setTopStep(page + 1)}
        finalAction={{ label: "Add another hotel", onClick: addAnotherHotelPeriod }}
      />
    </div>
  );
}
