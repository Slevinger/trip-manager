"use client";

import { appendStepInterval } from "@/lib/canonicalStepBuilders";
import {
  useWizardDirection,
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
import { useI18n } from "@/lib/i18n/context";
import { intlLocaleForApp } from "@/lib/i18n/messages";
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
  const { locale } = useI18n();
  const intlLocale = intlLocaleForApp(locale);
  const intervalIndex = Math.min(intervalIndexFromFrame(frame), draft.stepIntervals.length - 1);
  const interval = draft.stepIntervals[intervalIndex];
  const page = Math.min(
    Math.max(0, wizard.top?.step ?? 0),
    ACTIVITY_INTERVAL_WIZARD_PAGE_COUNT - 1
  );
  const direction = useWizardDirection(page);

  if (!interval || interval.intervalType !== "activity") {
    return (
      <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
        Invalid activity interval.
      </p>
    );
  }

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
    <div className="space-y-6">
      <WizardPage pageKey={page} direction={direction}>
        {page === 0 ? (
          <div className="space-y-5">
            <WizardPageHeading
              eyebrow={`Activity slot #${intervalIndex + 1}`}
              title="What's happening here?"
              subtitle="A single thing on the schedule — meal, tour, free time slot."
              accent="emerald"
            />

            <WizardField
              htmlFor="activity-interval-title"
              label="Slot title"
              hint="Shown on the timeline. Pick something specific you'll recognize."
            >
              <input
                id="activity-interval-title"
                className={WIZARD_INPUT_CLASS_LARGE}
                placeholder="e.g., Sunset dinner at Patong"
                value={interval.title}
                onChange={(e) => patchIntervalAt(intervalIndex, { title: e.target.value })}
              />
            </WizardField>

            <WizardSection title="When is it?" hint="Tap the dates to expand the calendar — fine-tune start and end time below.">
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
                startLabel="Starts"
                endLabel="Ends"
                defaultStartTime="10:00"
                defaultEndTime="12:00"
                collapsible
              />
            </WizardSection>

            <WizardField
              htmlFor="activity-interval-type"
              label="Activity type"
              hint="Drives the icon and color in the itinerary."
            >
              <select
                id="activity-interval-type"
                className={WIZARD_SELECT_CLASS}
                value={interval.activityType}
                onChange={(e) =>
                  patchIntervalAt(intervalIndex, {
                    activityType: e.target.value as ActivityType,
                  })
                }
              >
                {ACTIVITY_TYPES.map((at) => (
                  <option key={at} value={at}>
                    {at.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </WizardField>
          </div>
        ) : (
          <div className="space-y-5">
            <WizardPageHeading
              eyebrow={`Activity slot #${intervalIndex + 1}`}
              title="Notes"
              subtitle="Reservation refs, dress code, tips for the rest of the group."
              accent="emerald"
            />
            <WizardField
              htmlFor="activity-interval-comment"
              label="Slot notes"
              optional
              hint="Picked addresses get appended here automatically."
            >
              <textarea
                id="activity-interval-comment"
                rows={6}
                className={WIZARD_TEXTAREA_CLASS}
                placeholder="e.g., Reservation under Slevinger. Smart casual."
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
        totalPages={ACTIVITY_INTERVAL_WIZARD_PAGE_COUNT}
        prevLabel={page <= 0 ? "Activity step" : "Previous"}
        nextLabel="Next"
        accent="emerald"
        onPrev={() => (page <= 0 ? wizard.pop() : wizard.setTopStep(page - 1))}
        onNext={() => wizard.setTopStep(page + 1)}
        finalAction={{ label: "Add another slot", onClick: addAnotherActivitySlot }}
      />
    </div>
  );
}
