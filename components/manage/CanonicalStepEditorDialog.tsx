"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DestinationsInput } from "@/components/manage/DestinationsInput";
import { ActivityStepIntervalWizardPanel } from "@/components/manage/stepWizards/ActivityStepIntervalWizardPanel";
import { StayStepIntervalWizardPanel } from "@/components/manage/stepWizards/StayStepIntervalWizardPanel";
import { StayStepWizardPanel } from "@/components/manage/stepWizards/StayStepWizardPanel";
import { StepWizardPanel } from "@/components/manage/stepWizards/StepWizardPanel";
import { TransitStepIntervalWizardPanel } from "@/components/manage/stepWizards/TransitStepIntervalWizardPanel";
import { TransitStepWizardPanel } from "@/components/manage/stepWizards/TransitStepWizardPanel";
import {
  appendGeoPickComment,
  notesToText,
  textToNotes,
} from "@/components/manage/stepWizards/wizardShared";
import {
  appendStepInterval,
  createStayStep,
  createTransitStep,
  destinationFromPlacePick,
  destinationFromTypedLocation,
  syncStepTimesFromIntervals,
} from "@/lib/canonicalStepBuilders";
import { newId } from "@/lib/canonicalIds";
import { stepIntervalEmoji } from "@/lib/stepIntervalUi";
import { collectStayGroupedTripPlacePicks } from "@/lib/tripLocationCatalog";
import {
  collectReferencedDestinationIdsFromStep,
  destinationFromList,
  mergeDestinationLists,
} from "@/lib/tripDestinationRegistry";
import { useI18n } from "@/lib/i18n/context";
import { intlLocaleForApp } from "@/lib/i18n/messages";
import {
  DateTimeRangeCalendar,
  mergeCalendarIsoPair,
  StartTimeAndDuration,
} from "@/components/dateRange/DateRangeCalendar";
import { STEP_WIZARD_IDS, type WizardFrame } from "@/lib/wizardStack/types";
import { useWizardStack } from "@/lib/wizardStack/useWizardStack";
import type {
  ActivityStep,
  ActivityType,
  CurrencyCode,
  Destination,
  StayStep,
  StayStepInterval,
  StayType,
  TransitStep,
  TransitStepInterval,
  TransitType,
  Trip,
  TripStep,
} from "@/lib/types/trip";
import { ACTIVITY_TYPES, STAY_TYPES, TRANSIT_TYPES } from "@/components/manage/stepEditorConstants";

const STEP_PRICE_CURRENCIES: CurrencyCode[] = ["THB", "USD", "EUR", "ILS", "GBP"];

function formatIntervalRangeShort(startIso: string, endIso: string): string {
  const a = new Date(startIso);
  const b = new Date(endIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "—";
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  return `${a.toLocaleString(undefined, opts)} – ${b.toLocaleString(undefined, opts)}`;
}

function intervalRowTitle(title: string): string {
  return title.trim() || "Untitled";
}

/** After removing `removeIndex`, which list index should stay selected. */
function nextIntervalSelectionAfterDelete(
  prevSelected: number,
  removeIndex: number,
  newLength: number
): number {
  if (newLength <= 0) return 0;
  if (removeIndex < prevSelected) return prevSelected - 1;
  if (removeIndex > prevSelected) return prevSelected;
  return Math.min(removeIndex, newLength - 1);
}

function computeInitialWizardStack(isNew: boolean, typeWizardFirst: boolean): WizardFrame[] {
  if (!isNew) return [{ id: STEP_WIZARD_IDS.flatEdit, step: 0 }];
  if (typeWizardFirst) return [{ id: STEP_WIZARD_IDS.stepWizard, step: 0 }];
  return [{ id: STEP_WIZARD_IDS.stepWizard, step: 0 }];
}

function headerLabel(wizardId: string | undefined, isNew: boolean): string {
  if (!isNew) {
    if (wizardId === STEP_WIZARD_IDS.stayStepIntervalWizard) return "Stay interval";
    if (wizardId === STEP_WIZARD_IDS.transitStepIntervalWizard) return "Transit interval";
    if (wizardId === STEP_WIZARD_IDS.activityStepIntervalWizard) return "Activity slot";
    return "Edit step";
  }
  switch (wizardId) {
    case STEP_WIZARD_IDS.stepWizard:
      return "New step";
    case STEP_WIZARD_IDS.stayStepWizard:
      return "New stay · step";
    case STEP_WIZARD_IDS.stayStepIntervalWizard:
      return "New stay · interval";
    case STEP_WIZARD_IDS.transitStepWizard:
      return "New transit · step";
    case STEP_WIZARD_IDS.transitStepIntervalWizard:
      return "New transit · interval";
    case STEP_WIZARD_IDS.activityStepIntervalWizard:
      return "New activity · slot";
    case STEP_WIZARD_IDS.flatEdit:
      return "New step";
    default:
      return "New step";
  }
}

export function CanonicalStepEditorDialog({
  open,
  tripStartIso,
  stepOrder,
  initial,
  isNew,
  /**
   * When `false`, new steps show “guided vs full” first, then the type wizard.
   * When `true` or omitted for a new step, opens the stay / transit type picker immediately.
   */
  startInWizard,
  trip,
  tripCurrency,
  tripSteps,
  initialDestinationSeeds,
  onClose,
  onSave,
}: {
  open: boolean;
  tripStartIso: string;
  stepOrder: number;
  initial: TripStep;
  isNew: boolean;
  startInWizard?: boolean;
  /** Trip default currency for interval price fields. */
  tripCurrency: CurrencyCode;
  /** Full trip (registry + steps) for interval append and place picks. */
  trip: Trip;
  /** All trip steps — used to suggest existing hotels / legs / activities in address fields. */
  tripSteps?: TripStep[];
  /** New-step destination rows not yet on `trip.destinations` (e.g. from {@link createStayStep}). */
  initialDestinationSeeds?: Destination[];
  onClose: () => void;
  onSave: (payload: { step: TripStep; destinationUpserts: Destination[] }) => void;
}) {
  const typeWizardFirst = isNew && startInWizard !== false;

  const wizard = useWizardStack(computeInitialWizardStack(isNew, typeWizardFirst));
  const [draft, setDraft] = useState<TripStep>(initial);
  const [destEdits, setDestEdits] = useState<Record<string, Destination>>({});
  /** Typed text for optional stay area center before a row exists — avoids allocating a destination id on every keystroke. */
  const [areaCenterDraftLocation, setAreaCenterDraftLocation] = useState("");
  const [flatEditingIntervalIndex, setFlatEditingIntervalIndex] = useState(0);
  const [intervalDeleteConfirmId, setIntervalDeleteConfirmId] = useState<string | null>(null);
  const prevOpen = useRef(false);

  const mergedDestinations = useMemo(
    () => mergeDestinationLists(trip.destinations, Object.values(destEdits)),
    [trip.destinations, destEdits]
  );
  const stepsForPicks = useMemo(() => {
    const base = tripSteps ?? trip.steps;
    if (isNew && !base.some((s) => s.id === draft.id)) return [...base, draft];
    return base;
  }, [tripSteps, trip.steps, isNew, draft]);
  const tripPlaceGrouped = useMemo(
    () => collectStayGroupedTripPlacePicks(stepsForPicks, mergedDestinations),
    [stepsForPicks, mergedDestinations]
  );
  const stayStepsForHostPicker = useMemo(
    () => stepsForPicks.filter((s): s is StayStep => s.stepType === "stay"),
    [stepsForPicks]
  );
  const { t, locale } = useI18n();
  const intlLocale = intlLocaleForApp(locale);

  useEffect(() => {
    const wasOpen = prevOpen.current;
    prevOpen.current = open;
    if (open && !wasOpen) {
      setDraft(initial);
      setFlatEditingIntervalIndex(0);
      setIntervalDeleteConfirmId(null);
      wizard.reset(computeInitialWizardStack(isNew, typeWizardFirst));
      const merged = mergeDestinationLists(trip.destinations, initialDestinationSeeds ?? []);
      const nextEdits: Record<string, Destination> = {};
      for (const id of collectReferencedDestinationIdsFromStep(initial)) {
        const row = merged.find((d) => d.id === id);
        nextEdits[id] = row ? { ...row } : { id, title: "", location: "", description: "" };
      }
      setDestEdits(nextEdits);
      setAreaCenterDraftLocation("");
    }
  }, [open, initial, isNew, typeWizardFirst, wizard.reset, trip.destinations, initialDestinationSeeds]);

  const topId = open ? wizard.top?.id : undefined;

  useEffect(() => {
    if (!open || !wizard.top) return;
    const id = wizard.top.id;
    const s = wizard.top.step;
    if (id === STEP_WIZARD_IDS.stepWizard && !typeWizardFirst) {
      if (s < 0 || s > 1) wizard.setTopStep(Math.min(1, Math.max(0, s)));
      return;
    }
    if (id === STEP_WIZARD_IDS.stepWizard && typeWizardFirst && s !== 0) {
      wizard.setTopStep(0);
      return;
    }
    if (id === STEP_WIZARD_IDS.stayStepWizard) {
      if (s < 0 || s > 1) wizard.setTopStep(Math.min(1, Math.max(0, s)));
      return;
    }
    if (id === STEP_WIZARD_IDS.stayStepIntervalWizard) {
      if (s < 0 || s > 1) wizard.setTopStep(Math.min(1, Math.max(0, s)));
      return;
    }
    if (id === STEP_WIZARD_IDS.transitStepWizard) {
      if (s < 0 || s > 1) wizard.setTopStep(Math.min(1, Math.max(0, s)));
      return;
    }
    if (id === STEP_WIZARD_IDS.transitStepIntervalWizard) {
      if (s < 0 || s > 1) wizard.setTopStep(Math.min(1, Math.max(0, s)));
      return;
    }
    if (id === STEP_WIZARD_IDS.activityStepIntervalWizard) {
      if (s < 0 || s > 1) wizard.setTopStep(Math.min(1, Math.max(0, s)));
    }
  }, [open, typeWizardFirst, wizard.top, wizard.setTopStep]);

  if (!open) return null;

  function overlayTrip(): Trip {
    return { ...trip, destinations: mergedDestinations, steps: trip.steps };
  }
  function rowFor(id: string | undefined): Destination {
    if (!id) return { id: "", title: "", location: "", description: "" };
    return destEdits[id] ?? { id, title: "", location: "", description: "" };
  }
  function setRow(id: string, row: Destination): void {
    setDestEdits((prev) => ({ ...prev, [id]: row }));
  }

  function seedStayStep(): void {
    const b = createStayStep(stepOrder, tripStartIso);
    for (const d of b.newDestinations) setRow(d.id, { ...d });
    setDraft(b.step);
  }
  function seedTransitStep(): void {
    const b = createTransitStep(stepOrder, tripStartIso);
    for (const d of b.newDestinations) setRow(d.id, { ...d });
    setDraft(b.step);
  }
  function appendDestinations(rows: Destination[]): void {
    for (const d of rows) setRow(d.id, { ...d });
  }

  function allocateStayAreaCenterId(): string {
    const s = draft as StayStep;
    if (s.areaCenterDestinationId) return s.areaCenterDestinationId;
    const nid = newId();
    appendDestinations([{ id: nid, title: "", location: "", description: "" }]);
    setDraft({ ...s, areaCenterDestinationId: nid });
    return nid;
  }

  function clearStayAreaCenter(): void {
    const s = draft as StayStep;
    setAreaCenterDraftLocation("");
    setDraft({ ...s, areaCenterDestinationId: undefined });
  }

  function commitSave() {
    const synced = syncStepTimesFromIntervals(draft);
    const ids = Array.from(collectReferencedDestinationIdsFromStep(synced));
    const upserts = ids
      .map((id) => {
        const edited = destEdits[id];
        if (edited?.id) return edited;
        return destinationFromList(mergedDestinations, id);
      })
      .filter((d): d is Destination => Boolean(d?.id));
    onSave({ step: synced, destinationUpserts: upserts });
    onClose();
  }

  function patchIntervalAt(index: number, patch: Record<string, unknown>): void {
    setDraft((d) => {
      const intervals = [...d.stepIntervals];
      const cur = intervals[index];
      if (!cur) return d;
      intervals[index] = { ...cur, ...patch } as typeof cur;
      return { ...d, stepIntervals: intervals } as TripStep;
    });
  }

  function removeIntervalAt(index: number): void {
    if (draft.stepIntervals.length <= 1) return;
    const prevSel = Math.min(flatEditingIntervalIndex, draft.stepIntervals.length - 1);
    const newLen = draft.stepIntervals.length - 1;
    const nextSel = nextIntervalSelectionAfterDelete(prevSel, index, newLen);
    setIntervalDeleteConfirmId(null);
    setDraft((d) => ({
      ...d,
      stepIntervals: d.stepIntervals.filter((_, idx) => idx !== index),
    }) as TripStep);
    setFlatEditingIntervalIndex(nextSel);
  }

  function openAddStayIntervalFromFlat(): void {
    if (draft.stepType !== "stay") return;
    const { step: next, newDestinations } = appendStepInterval(
      draft as StayStep,
      tripStartIso,
      overlayTrip()
    );
    for (const d of newDestinations) setRow(d.id, d);
    const newIndex = next.stepIntervals.length - 1;
    setDraft(next);
    setFlatEditingIntervalIndex(newIndex);
    wizard.push({
      id: STEP_WIZARD_IDS.stayStepIntervalWizard,
      step: 0,
      payload: { intervalIndex: newIndex },
    });
  }

  function openAddTransitIntervalFromFlat(): void {
    if (draft.stepType !== "transit") return;
    const { step: next, newDestinations } = appendStepInterval(
      draft as TransitStep,
      tripStartIso,
      overlayTrip()
    );
    for (const d of newDestinations) setRow(d.id, d);
    const newIndex = next.stepIntervals.length - 1;
    setDraft(next);
    setFlatEditingIntervalIndex(newIndex);
    wizard.push({
      id: STEP_WIZARD_IDS.transitStepIntervalWizard,
      step: 0,
      payload: { intervalIndex: newIndex },
    });
  }

  function openAddActivityIntervalFromFlat(): void {
    if (draft.stepType !== "activity") return;
    const { step: next, newDestinations } = appendStepInterval(
      draft as ActivityStep,
      tripStartIso,
      overlayTrip()
    );
    for (const d of newDestinations) setRow(d.id, d);
    const newIndex = next.stepIntervals.length - 1;
    setDraft(next);
    setFlatEditingIntervalIndex(newIndex);
    wizard.push({
      id: STEP_WIZARD_IDS.activityStepIntervalWizard,
      step: 0,
      payload: { intervalIndex: newIndex },
    });
  }

  function renderFlatEditor() {
    const intervals = draft.stepIntervals;
    const first = intervals[0];
    if (!first) return <p className="text-sm text-red-600">Invalid step (no intervals).</p>;

    const multiInterval = intervals.length > 1;
    const intervalIdx = multiInterval
      ? Math.min(flatEditingIntervalIndex, intervals.length - 1)
      : 0;
    const active = intervals[intervalIdx];
    if (!active) return <p className="text-sm text-red-600">Invalid step (no intervals).</p>;

    const stayIntervalAddressLine =
      draft.stepType === "stay" && active.intervalType === "stay"
        ? (() => {
            const st = active as StayStepInterval;
            if (st.location != null) return st.location;
            if (st.destinationId) return rowFor(st.destinationId).location ?? "";
            return "";
          })()
        : "";

    function patchActiveInterval(patch: Record<string, unknown>): void {
      patchIntervalAt(intervalIdx, patch);
    }

    const startLabel = multiInterval ? "Interval start" : "Start (primary interval)";
    const endLabel = multiInterval ? "Interval end" : "End (primary interval)";
    const commentLabel = multiInterval ? "Interval comment" : "Primary interval comment";
    const intervalTitleFieldLabel = multiInterval
      ? "Interval title"
      : draft.stepType === "stay"
        ? "Stay segment title"
        : draft.stepType === "transit"
          ? "Leg title"
          : "Activity slot title";

    return (
      <div className="space-y-4">
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Step title
          <input
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>

        {draft.stepType === "stay" ? (
          <>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Place name
              <input
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                value={rowFor((draft as StayStep).targetDestinationId).title}
                onChange={(e) => {
                  const d = draft as StayStep;
                  const cur = rowFor(d.targetDestinationId);
                  setRow(d.targetDestinationId, { ...cur, title: e.target.value });
                }}
              />
            </label>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Search address (autocomplete)
              <DestinationsInput
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                placeholder="Type at least 2 characters…"
                tripPlaceGrouped={tripPlaceGrouped}
                onRegisterNewDestination={(d) => appendDestinations([d])}
                value={rowFor((draft as StayStep).targetDestinationId).location}
                onChange={(location) => {
                  const d = draft as StayStep;
                  const cur = rowFor(d.targetDestinationId);
                  setRow(d.targetDestinationId, destinationFromTypedLocation(cur, location));
                }}
                onPick={(pick) => {
                  const d = draft as StayStep;
                  const cur = rowFor(d.targetDestinationId);
                  const merged = destinationFromPlacePick(pick, { id: d.targetDestinationId });
                  const titleGuess = cur.title.trim() ? cur.title : merged.title;
                  const td = { ...merged, title: titleGuess };
                  const intCur = d.stepIntervals[intervalIdx];
                  const nextComment =
                    intCur?.intervalType === "stay"
                      ? appendGeoPickComment(intCur.comment, td.location)
                      : td.location;
                  setRow(merged.id, td);
                  setDraft({
                    ...d,
                    ...(merged.id !== d.targetDestinationId ? { targetDestinationId: merged.id } : {}),
                    title: d.title.trim() ? d.title : titleGuess,
                    stepIntervals: d.stepIntervals.map((int, i) =>
                      i === intervalIdx && int.intervalType === "stay"
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
                  onRegisterNewDestination={(d) => appendDestinations([d])}
                  value={
                    (draft as StayStep).areaCenterDestinationId
                      ? rowFor((draft as StayStep).areaCenterDestinationId!).location
                      : areaCenterDraftLocation
                  }
                  onChange={(location) => {
                    const s = draft as StayStep;
                    if (s.areaCenterDestinationId) {
                      const id = s.areaCenterDestinationId;
                      setRow(id, destinationFromTypedLocation(rowFor(id), location));
                    } else {
                      setAreaCenterDraftLocation(location);
                    }
                  }}
                  onPick={(pick) => {
                    const d = draft as StayStep;
                    const id = allocateStayAreaCenterId();
                    const merged = destinationFromPlacePick(pick, { id });
                    const cur = rowFor(id);
                    const titleGuess = cur.title.trim() ? cur.title : merged.title;
                    setRow(merged.id, { ...merged, title: titleGuess });
                    setAreaCenterDraftLocation("");
                    setDraft({ ...d, areaCenterDestinationId: merged.id });
                  }}
                />
              </label>
              <p className="mt-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                {t("manage.stayAreaCenterHint")}
              </p>
              {(draft as StayStep).areaCenterDestinationId ? (
                <button
                  type="button"
                  onClick={clearStayAreaCenter}
                  className="mt-2 text-xs font-medium text-zinc-600 underline decoration-zinc-400 underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  {t("manage.stayAreaCenterClear")}
                </button>
              ) : null}
            </div>
          </>
        ) : null}

        {draft.stepType === "transit" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                From (name)
                <input
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                  value={rowFor((draft as TransitStep).fromStayId).title}
                  onChange={(e) => {
                    const d = draft as TransitStep;
                    const cur = rowFor(d.fromStayId);
                    setRow(d.fromStayId, { ...cur, title: e.target.value });
                  }}
                />
              </label>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                To (name)
                <input
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                  value={rowFor((draft as TransitStep).toStayId).title}
                  onChange={(e) => {
                    const d = draft as TransitStep;
                    const cur = rowFor(d.toStayId);
                    setRow(d.toStayId, { ...cur, title: e.target.value });
                  }}
                />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                From (search address)
                <DestinationsInput
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                  placeholder="From…"
                  tripPlaceGrouped={tripPlaceGrouped}
                  onRegisterNewDestination={(d) => appendDestinations([d])}
                  value={rowFor((draft as TransitStep).fromStayId).location}
                  onChange={(location) => {
                    const d = draft as TransitStep;
                    const cur = rowFor(d.fromStayId);
                    setRow(d.fromStayId, destinationFromTypedLocation(cur, location));
                  }}
                  onPick={(pick) => {
                    const d = draft as TransitStep;
                    const merged = destinationFromPlacePick(pick, { id: d.fromStayId });
                    const cur = rowFor(d.fromStayId);
                    const nameGuess = cur.title.trim() ? cur.title : merged.title;
                    const line = `From: ${merged.location}`;
                    const intCur = d.stepIntervals[intervalIdx];
                    const nextComment =
                      intCur?.intervalType === "transit"
                        ? appendGeoPickComment(intCur.comment, line)
                        : line;
                    setRow(merged.id, { ...merged, title: nameGuess });
                    setDraft({
                      ...d,
                      ...(merged.id !== d.fromStayId ? { fromStayId: merged.id } : {}),
                      stepIntervals: d.stepIntervals.map((int, i) =>
                        i === intervalIdx && int.intervalType === "transit"
                          ? { ...int, comment: nextComment }
                          : int
                      ),
                    });
                  }}
                />
              </label>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                To (search address)
                <DestinationsInput
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                  placeholder="To…"
                  tripPlaceGrouped={tripPlaceGrouped}
                  onRegisterNewDestination={(d) => appendDestinations([d])}
                  value={rowFor((draft as TransitStep).toStayId).location}
                  onChange={(location) => {
                    const d = draft as TransitStep;
                    const cur = rowFor(d.toStayId);
                    setRow(d.toStayId, destinationFromTypedLocation(cur, location));
                  }}
                  onPick={(pick) => {
                    const d = draft as TransitStep;
                    const merged = destinationFromPlacePick(pick, { id: d.toStayId });
                    const cur = rowFor(d.toStayId);
                    const nameGuess = cur.title.trim() ? cur.title : merged.title;
                    const line = `To: ${merged.location}`;
                    const intCur = d.stepIntervals[intervalIdx];
                    const nextComment =
                      intCur?.intervalType === "transit"
                        ? appendGeoPickComment(intCur.comment, line)
                        : line;
                    setRow(merged.id, { ...merged, title: nameGuess });
                    setDraft({
                      ...d,
                      ...(merged.id !== d.toStayId ? { toStayId: merged.id } : {}),
                      stepIntervals: d.stepIntervals.map((int, i) =>
                        i === intervalIdx && int.intervalType === "transit"
                          ? { ...int, comment: nextComment }
                          : int
                      ),
                    });
                  }}
                />
              </label>
            </div>
            <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
              {t("manage.transitStepPlaceHint")}
            </p>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              {t("manage.transitStepPlaceName")}
              <input
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                value={rowFor((draft as TransitStep).targetDestinationId).title}
                onChange={(e) => {
                  const d = draft as TransitStep;
                  setRow(d.targetDestinationId, {
                    ...rowFor(d.targetDestinationId),
                    title: e.target.value,
                  });
                }}
              />
            </label>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              {t("manage.transitStepPlaceAddress")}
              <DestinationsInput
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                placeholder={t("manage.optional")}
                tripPlaceGrouped={tripPlaceGrouped}
                onRegisterNewDestination={(d) => appendDestinations([d])}
                value={rowFor((draft as TransitStep).targetDestinationId).location}
                onChange={(location) => {
                  const d = draft as TransitStep;
                  setRow(
                    d.targetDestinationId,
                    destinationFromTypedLocation(rowFor(d.targetDestinationId), location)
                  );
                }}
                onPick={(pick) => {
                  const d = draft as TransitStep;
                  const merged = destinationFromPlacePick(pick, { id: d.targetDestinationId });
                  const cur = rowFor(d.targetDestinationId);
                  const titleGuess = cur.title.trim() ? cur.title : merged.title;
                  const td = { ...merged, title: titleGuess };
                  setRow(merged.id, td);
                  setDraft({
                    ...d,
                    ...(merged.id !== d.targetDestinationId ? { targetDestinationId: merged.id } : {}),
                  });
                }}
              />
            </label>
          </>
        ) : null}

        {draft.stepType === "activity" ? (
          <>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              <span className="block">{t("manage.activityHostStay")}</span>
              <span className="mt-0.5 block text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                {t("manage.activityHostStayHint")}
              </span>
              <select
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                value={(draft as ActivityStep).hostStayStepId ?? ""}
                onChange={(e) => {
                  const d = draft as ActivityStep;
                  const v = e.target.value.trim();
                  setDraft(() => {
                    const next = { ...d };
                    if (v) next.hostStayStepId = v;
                    else delete next.hostStayStepId;
                    return next;
                  });
                }}
              >
                <option value="">{t("manage.activityHostStayNone")}</option>
                {stayStepsForHostPicker.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title?.trim() || `Stay · ${s.order + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Activity place
              <input
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                value={rowFor((draft as ActivityStep).destinationId).title}
                onChange={(e) => {
                  const d = draft as ActivityStep;
                  const cur = rowFor(d.destinationId);
                  const next = { ...cur, title: e.target.value };
                  setRow(d.destinationId, next);
                  setRow(d.targetDestinationId, { ...rowFor(d.targetDestinationId), title: next.title });
                }}
              />
            </label>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Search address
              <DestinationsInput
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                placeholder="Where is this activity?"
                tripPlaceGrouped={tripPlaceGrouped}
                onRegisterNewDestination={(d) => appendDestinations([d])}
                value={rowFor((draft as ActivityStep).destinationId).location}
                onChange={(location) => {
                  const d = draft as ActivityStep;
                  const dest = destinationFromTypedLocation(rowFor(d.destinationId), location);
                  setRow(d.destinationId, dest);
                  setRow(d.targetDestinationId, { ...dest, id: d.targetDestinationId });
                }}
                onPick={(pick) => {
                  const d = draft as ActivityStep;
                  const merged = destinationFromPlacePick(pick, { id: d.destinationId });
                  const cur = rowFor(d.destinationId);
                  const titleGuess = cur.title.trim() ? cur.title : merged.title;
                  const dest = { ...merged, title: titleGuess };
                  const tgt = { ...dest, id: d.targetDestinationId, title: titleGuess };
                  const intCur = d.stepIntervals[intervalIdx];
                  const nextComment =
                    intCur?.intervalType === "activity"
                      ? appendGeoPickComment(intCur.comment, dest.location)
                      : dest.location;
                  setRow(dest.id, dest);
                  setRow(d.targetDestinationId, tgt);
                  setDraft({
                    ...d,
                    ...(dest.id !== d.destinationId ? { destinationId: dest.id } : {}),
                    title: d.title.trim() ? d.title : titleGuess,
                    stepIntervals: d.stepIntervals.map((int, i) =>
                      i === intervalIdx && int.intervalType === "activity"
                        ? { ...int, comment: nextComment }
                        : int
                    ),
                  });
                }}
              />
            </label>
          </>
        ) : null}

        {draft.stepType === "stay" ||
        draft.stepType === "transit" ||
        draft.stepType === "activity" ? (
          <div className="flex flex-wrap gap-2">
            {draft.stepType === "stay" ? (
              <button
                type="button"
                onClick={openAddStayIntervalFromFlat}
                className="rounded-xl border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-900 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-100"
              >
                Add stay interval…
              </button>
            ) : null}
            {draft.stepType === "transit" ? (
              <button
                type="button"
                onClick={openAddTransitIntervalFromFlat}
                className="rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-900 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-100"
              >
                Add transit leg…
              </button>
            ) : null}
            {draft.stepType === "activity" ? (
              <button
                type="button"
                onClick={openAddActivityIntervalFromFlat}
                className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-100"
              >
                Add activity slot…
              </button>
            ) : null}
          </div>
        ) : null}

        {multiInterval ? (
          <div>
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Intervals</p>
            <ul className="mt-2 space-y-2" role="listbox" aria-label="Select interval to edit">
              {intervals.map((int, i) => {
                const selected = i === intervalIdx;
                const rowTitle = intervalRowTitle(int.title);
                const confirmingDelete = intervalDeleteConfirmId === int.id;
                return (
                  <li key={int.id} className="space-y-1.5">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          setIntervalDeleteConfirmId(null);
                          setFlatEditingIntervalIndex(i);
                        }}
                        className={`min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                          selected
                            ? "border-violet-400 bg-violet-50 text-violet-950 dark:border-violet-600 dark:bg-violet-950/50 dark:text-violet-50"
                            : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600"
                        }`}
                      >
                        <span className="font-medium">
                          <span
                            className="mr-1.5"
                            aria-hidden
                            title={
                              int.intervalType === "transit"
                                ? int.transitType.replace(/_/g, " ")
                                : int.intervalType === "activity"
                                  ? int.activityType.replace(/_/g, " ")
                                  : int.intervalType
                            }
                          >
                            {stepIntervalEmoji(int)}
                          </span>
                          {i + 1}. {rowTitle}
                        </span>
                        <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                          {formatIntervalRangeShort(int.startTime, int.endTime)}
                        </span>
                      </button>
                      {intervals.length > 1 ? (
                        confirmingDelete ? (
                          <button
                            type="button"
                            className="shrink-0 self-start rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-[11px] font-medium text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
                            onClick={() => setIntervalDeleteConfirmId(null)}
                          >
                            Cancel
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="shrink-0 self-start rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] font-medium text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
                            onClick={(e) => {
                              e.stopPropagation();
                              setIntervalDeleteConfirmId(int.id);
                            }}
                            aria-label={`Delete interval: ${rowTitle}`}
                          >
                            Delete
                          </button>
                        )
                      ) : null}
                    </div>
                    {confirmingDelete ? (
                      <div
                        className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900/40 dark:bg-amber-950/30"
                        role="alert"
                      >
                        <p className="text-xs leading-snug text-amber-950 dark:text-amber-100">
                          Are you sure you want to delete this interval{" "}
                          <span className="font-semibold">“{rowTitle}”</span>?
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                            onClick={() => setIntervalDeleteConfirmId(null)}
                          >
                            No, keep it
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-red-300 bg-red-600 px-3 py-1.5 text-xs font-semibold text-white dark:border-red-800 dark:bg-red-700"
                            onClick={() => removeIntervalAt(i)}
                          >
                            Yes, delete interval
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {!multiInterval && draft.stepType === "stay" && active.intervalType === "stay" ? (
          <div className="rounded-xl border border-violet-200 bg-violet-50/70 px-3 py-2.5 dark:border-violet-800/60 dark:bg-violet-950/30">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              This stay&apos;s interval
            </p>
            <p className="mt-1 font-mono text-xs text-zinc-700 dark:text-zinc-300">
              {formatIntervalRangeShort(active.startTime, active.endTime)}
            </p>
            {stayIntervalAddressLine ? (
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{stayIntervalAddressLine}</p>
            ) : (
              <p className="mt-1 text-xs italic text-zinc-500 dark:text-zinc-500">No interval address yet</p>
            )}
            <p className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-500">
              Edit the segment title, dates, and interval address in the fields below.
            </p>
          </div>
        ) : null}

        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {intervalTitleFieldLabel}
          <input
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            value={active.title}
            onChange={(e) => patchActiveInterval({ title: e.target.value })}
          />
        </label>

        <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
          {draft.stepType === "transit" ? (
            <>
              <p className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                {startLabel} · {endLabel}
              </p>
              <StartTimeAndDuration
                startIso={active.startTime}
                endIso={active.endTime}
                onChange={(startIso, endIso) => {
                  const merged = mergeCalendarIsoPair(
                    active.startTime,
                    active.endTime,
                    startIso,
                    endIso
                  );
                  patchActiveInterval({
                    startTime: merged.startIso,
                    endTime: merged.endIso,
                  });
                }}
                intlLocale={intlLocale}
                startLabel={startLabel}
                durationLabel="Duration"
              />
            </>
          ) : (
            <>
              <p className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                {startLabel} → {endLabel}
              </p>
              <DateTimeRangeCalendar
                startIso={active.startTime}
                endIso={active.endTime}
                onChange={(startIso, endIso) => {
                  const merged = mergeCalendarIsoPair(
                    active.startTime,
                    active.endTime,
                    startIso,
                    endIso
                  );
                  patchActiveInterval({
                    startTime: merged.startIso,
                    endTime: merged.endIso,
                  });
                }}
                intlLocale={intlLocale}
                startLabel={startLabel}
                endLabel={endLabel}
                collapsible
              />
            </>
          )}
        </div>

        {draft.stepType === "stay" && active.intervalType === "stay" ? (
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Location (this interval)
            <DestinationsInput
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              placeholder="Type at least 2 characters…"
              tripPlaceGrouped={tripPlaceGrouped}
              onRegisterNewDestination={(d) => appendDestinations([d])}
              value={stayIntervalAddressLine}
              onChange={(location) =>
                patchActiveInterval({
                  location: location || undefined,
                  coordinates: undefined,
                  destinationId: undefined,
                })
              }
              onPick={(pick) => {
                const titleGuess =
                  active.title.trim() || pick.label.split(",")[0]?.trim() || pick.label;
                const nextComment =
                  active.intervalType === "stay"
                    ? appendGeoPickComment(active.comment, pick.label)
                    : pick.label;
                if (pick.destinationId) {
                  const merged = destinationFromPlacePick(pick, { id: pick.destinationId });
                  patchIntervalAt(intervalIdx, {
                    location: merged.location,
                    coordinates: merged.coordinates,
                    destinationId: merged.id,
                    comment: nextComment,
                    ...(active.title.trim() ? {} : { title: titleGuess }),
                  });
                  return;
                }
                patchIntervalAt(intervalIdx, {
                  location: pick.label,
                  coordinates:
                    pick.lat != null && pick.lng != null
                      ? { lat: pick.lat, lon: pick.lng }
                      : undefined,
                  destinationId: undefined,
                  comment: nextComment,
                  ...(active.title.trim() ? {} : { title: titleGuess }),
                });
              }}
            />
          </label>
        ) : null}

        {draft.stepType === "stay" ? (
          <>
            {active.intervalType === "stay" ? (
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Stay type
                <select
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                  value={active.stayType}
                  onChange={(e) =>
                    patchActiveInterval({ stayType: e.target.value as StayType })
                  }
                >
                  {STAY_TYPES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        ) : null}

        {draft.stepType === "transit" ? (
          <>
            {active.intervalType === "transit" ? (
              <>
                {(() => {
                  const tstep = draft as TransitStep;
                  const tint = active as TransitStepInterval;
                  const legFromId = tint.fromDestinationId ?? tstep.fromStayId;
                  const legToId = tint.toDestinationId ?? tstep.toStayId;
                  return (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Leg from (address)
                    <DestinationsInput
                      className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                      placeholder="Pick trip place or search…"
                      tripPlaceGrouped={tripPlaceGrouped}
                      onRegisterNewDestination={(d) => appendDestinations([d])}
                      value={rowFor(legFromId).location}
                      onChange={(location) => {
                        const cur = rowFor(legFromId);
                        setRow(legFromId, destinationFromTypedLocation(cur, location));
                      }}
                      onPick={(pick) => {
                        const tstep = draft as TransitStep;
                        const merged = destinationFromPlacePick(pick, { id: legFromId });
                        const cur = rowFor(legFromId);
                        const title = (cur.title ?? "").trim() ? cur.title : merged.title;
                        setRow(merged.id, { ...merged, title });
                        const fallback = tstep.fromStayId;
                        patchIntervalAt(intervalIdx, {
                          fromDestinationId:
                            merged.id !== fallback ? merged.id : undefined,
                        });
                      }}
                    />
                  </label>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Leg to (address)
                    <DestinationsInput
                      className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                      placeholder="Pick trip place or search…"
                      tripPlaceGrouped={tripPlaceGrouped}
                      onRegisterNewDestination={(d) => appendDestinations([d])}
                      value={rowFor(legToId).location}
                      onChange={(location) => {
                        const cur = rowFor(legToId);
                        setRow(legToId, destinationFromTypedLocation(cur, location));
                      }}
                      onPick={(pick) => {
                        const tstep = draft as TransitStep;
                        const merged = destinationFromPlacePick(pick, { id: legToId });
                        const cur = rowFor(legToId);
                        const title = (cur.title ?? "").trim() ? cur.title : merged.title;
                        setRow(merged.id, { ...merged, title });
                        const fallback = tstep.toStayId;
                        patchIntervalAt(intervalIdx, {
                          toDestinationId:
                            merged.id !== fallback ? merged.id : undefined,
                        });
                      }}
                    />
                  </label>
                </div>
                  );
                })()}
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Transit mode
                  <select
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                    value={active.transitType}
                    onChange={(e) =>
                      patchActiveInterval({ transitType: e.target.value as TransitType })
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
            ) : null}
          </>
        ) : null}

        {draft.stepType === "activity" ? (
          <>
            {active.intervalType === "activity" ? (
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Activity type
                <select
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                  value={active.activityType}
                  onChange={(e) =>
                    patchActiveInterval({ activityType: e.target.value as ActivityType })
                  }
                >
                  {ACTIVITY_TYPES.map((at) => (
                    <option key={at} value={at}>
                      {at}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        ) : null}

        {(draft.stepType === "stay" || draft.stepType === "transit" || draft.stepType === "activity") &&
        active &&
        "intervalType" in active ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              {t("manage.priceOptional")}
              <input
                type="number"
                min={0}
                step="any"
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                value={active.price != null ? String(active.price.amount) : ""}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === "") {
                    patchActiveInterval({ price: undefined });
                    return;
                  }
                  const n = Number(raw);
                  if (!Number.isFinite(n)) return;
                  patchActiveInterval({
                    price: {
                      amount: n,
                      currency: active.price?.currency ?? tripCurrency,
                    },
                  });
                }}
              />
            </label>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              {t("manage.priceCurrency")}
              <select
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                value={active.price?.currency ?? tripCurrency}
                onChange={(e) => {
                  const cur = e.target.value as CurrencyCode;
                  if (active.price) {
                    patchActiveInterval({ price: { ...active.price, currency: cur } });
                  }
                }}
                disabled={!active.price}
              >
                {[...new Set([tripCurrency, ...STEP_PRICE_CURRENCIES])].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {draft.stepType === "transit" ? (
          <div className="grid gap-2 sm:grid-cols-2 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              {t("manage.transitStepExtraFees")}
              <input
                type="number"
                min={0}
                step="any"
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                value={
                  (draft as TransitStep).totalManualPrice != null
                    ? String((draft as TransitStep).totalManualPrice!.amount)
                    : ""
                }
                onChange={(e) => {
                  const d = draft as TransitStep;
                  const raw = e.target.value.trim();
                  if (raw === "") {
                    setDraft({ ...d, totalManualPrice: undefined });
                    return;
                  }
                  const n = Number(raw);
                  if (!Number.isFinite(n)) return;
                  setDraft({
                    ...d,
                    totalManualPrice: {
                      amount: n,
                      currency: d.totalManualPrice?.currency ?? tripCurrency,
                    },
                  });
                }}
              />
            </label>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              {t("manage.priceCurrency")}
              <select
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                value={(draft as TransitStep).totalManualPrice?.currency ?? tripCurrency}
                onChange={(e) => {
                  const d = draft as TransitStep;
                  const cur = e.target.value as CurrencyCode;
                  if (!d.totalManualPrice) {
                    setDraft({ ...d, totalManualPrice: { amount: 0, currency: cur } });
                    return;
                  }
                  setDraft({
                    ...d,
                    totalManualPrice: { ...d.totalManualPrice, currency: cur },
                  });
                }}
                disabled={!(draft as TransitStep).totalManualPrice}
              >
                {[...new Set([tripCurrency, ...STEP_PRICE_CURRENCIES])].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {commentLabel}
          <textarea
            rows={2}
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            placeholder="Picked places are appended here automatically."
            value={active.comment ?? ""}
            onChange={(e) =>
              patchActiveInterval({
                comment: e.target.value === "" ? undefined : e.target.value,
              })
            }
          />
        </label>

        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Step notes (one line each)
          <textarea
            rows={3}
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            value={notesToText(draft.notes)}
            onChange={(e) => setDraft({ ...draft, notes: textToNotes(e.target.value) })}
          />
        </label>
      </div>
    );
  }

  const showSaveRow =
    wizard.top?.id === STEP_WIZARD_IDS.flatEdit ||
    wizard.top?.id === STEP_WIZARD_IDS.stayStepWizard ||
    wizard.top?.id === STEP_WIZARD_IDS.stayStepIntervalWizard ||
    wizard.top?.id === STEP_WIZARD_IDS.transitStepWizard ||
    wizard.top?.id === STEP_WIZARD_IDS.transitStepIntervalWizard ||
    wizard.top?.id === STEP_WIZARD_IDS.activityStepIntervalWizard;

  const showPopHint =
    isNew &&
    wizard.top &&
    wizard.top.id !== STEP_WIZARD_IDS.stepWizard &&
    wizard.stack.length > 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-zinc-900/70 backdrop-blur-sm wizard-overlay-in sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl ring-1 ring-zinc-200/60 wizard-pop-in dark:bg-zinc-950 dark:ring-zinc-800/60 sm:my-auto sm:max-h-[88vh] sm:rounded-3xl"
      >
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-zinc-100 bg-white/85 px-6 py-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
              {isNew ? "New step" : "Edit step"}
            </p>
            <div className="mt-0.5 truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {headerLabel(wizard.top?.id, isNew)}
            </div>
            {wizard.stack.length > 1 ? (
              <p
                className="mt-0.5 truncate font-mono text-[10px] leading-tight text-zinc-400 dark:text-zinc-500"
                title="Nested wizards: outer → inner. Pop with Back to return."
              >
                {wizard.stack.map((f) => f.id).join(" → ")}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M6 6 18 18" />
              <path d="M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
          {wizard.top?.id === STEP_WIZARD_IDS.stepWizard ? (
            <StepWizardPanel
              typeWizardFirst={typeWizardFirst}
              wizard={wizard}
              onClose={onClose}
              onStartStay={seedStayStep}
              onStartTransit={seedTransitStep}
              onStartStayFlatFull={() => {
                seedStayStep();
                wizard.reset([{ id: STEP_WIZARD_IDS.flatEdit, step: 0 }]);
              }}
            />
          ) : null}

          {wizard.top?.id === STEP_WIZARD_IDS.stayStepWizard && draft.stepType === "stay" ? (
            <StayStepWizardPanel
              draft={draft as StayStep}
              setDraft={setDraft as (next: StayStep | ((prev: StayStep) => StayStep)) => void}
              wizard={wizard}
              tripPlaceGrouped={tripPlaceGrouped}
              mainPlace={rowFor((draft as StayStep).targetDestinationId)}
              setMainPlace={(d) => {
                setRow(d.id, d);
                const s = draft as StayStep;
                if (d.id !== s.targetDestinationId) {
                  setDraft({ ...s, targetDestinationId: d.id });
                }
              }}
              areaCenterPlace={
                (draft as StayStep).areaCenterDestinationId
                  ? rowFor((draft as StayStep).areaCenterDestinationId)
                  : undefined
              }
              setAreaCenterPlace={(d) => setRow(d.id, d)}
              allocateAreaCenterDestinationId={allocateStayAreaCenterId}
              onClearAreaCenter={clearStayAreaCenter}
              onRegisterNewDestination={(d) => appendDestinations([d])}
            />
          ) : null}

          {wizard.top?.id === STEP_WIZARD_IDS.stayStepIntervalWizard &&
          draft.stepType === "stay" &&
          wizard.top ? (
            <StayStepIntervalWizardPanel
              frame={wizard.top}
              draft={draft as StayStep}
              setDraft={setDraft as (next: StayStep | ((prev: StayStep) => StayStep)) => void}
              patchIntervalAt={patchIntervalAt}
              wizard={wizard}
              tripStartIso={tripStartIso}
              tripCurrency={tripCurrency}
              tripPlaceGrouped={tripPlaceGrouped}
              trip={overlayTrip()}
              onAppendDestinations={appendDestinations}
            />
          ) : null}

          {wizard.top?.id === STEP_WIZARD_IDS.transitStepWizard && draft.stepType === "transit" ? (
            <TransitStepWizardPanel
              draft={draft as TransitStep}
              setDraft={setDraft as (next: TransitStep | ((prev: TransitStep) => TransitStep)) => void}
              wizard={wizard}
              tripCurrency={tripCurrency}
              tripPlaceGrouped={tripPlaceGrouped}
              fromPlace={rowFor((draft as TransitStep).fromStayId)}
              toPlace={rowFor((draft as TransitStep).toStayId)}
              setFromPlace={(d) => {
                setRow(d.id, d);
                const t = draft as TransitStep;
                if (d.id !== t.fromStayId) {
                  setDraft({ ...t, fromStayId: d.id });
                }
              }}
              setToPlace={(d) => {
                setRow(d.id, d);
                const t = draft as TransitStep;
                if (d.id !== t.toStayId) {
                  setDraft({ ...t, toStayId: d.id });
                }
              }}
              onRegisterNewDestination={(d) => appendDestinations([d])}
            />
          ) : null}

          {wizard.top?.id === STEP_WIZARD_IDS.transitStepIntervalWizard &&
          draft.stepType === "transit" &&
          wizard.top ? (
            <TransitStepIntervalWizardPanel
              frame={wizard.top}
              draft={draft as TransitStep}
              setDraft={setDraft as (next: TransitStep | ((prev: TransitStep) => TransitStep)) => void}
              patchIntervalAt={patchIntervalAt}
              wizard={wizard}
              tripStartIso={tripStartIso}
              tripCurrency={tripCurrency}
              trip={overlayTrip()}
              tripPlaceGrouped={tripPlaceGrouped}
              getRow={rowFor}
              setRow={setRow}
              onAppendDestinations={appendDestinations}
            />
          ) : null}

          {wizard.top?.id === STEP_WIZARD_IDS.activityStepIntervalWizard &&
          draft.stepType === "activity" &&
          wizard.top ? (
            <ActivityStepIntervalWizardPanel
              frame={wizard.top}
              draft={draft as ActivityStep}
              setDraft={setDraft as (next: ActivityStep | ((prev: ActivityStep) => ActivityStep)) => void}
              patchIntervalAt={patchIntervalAt}
              wizard={wizard}
              tripStartIso={tripStartIso}
              tripCurrency={tripCurrency}
              trip={overlayTrip()}
              onAppendDestinations={appendDestinations}
            />
          ) : null}

          {wizard.top?.id === STEP_WIZARD_IDS.flatEdit ? (
            <>
              {showPopHint ? (
                <button
                  type="button"
                  onClick={() => wizard.pop()}
                  className="text-xs font-medium text-violet-600 dark:text-violet-400"
                >
                  ← Back ({wizard.stack[wizard.stack.length - 2]?.id ?? "…"})
                </button>
              ) : null}
              {renderFlatEditor()}
            </>
          ) : null}

          {showSaveRow ? (
            <div className="sticky bottom-0 -mx-6 mt-2 flex flex-wrap items-center justify-end gap-3 border-t border-zinc-100 bg-white/90 px-6 py-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
              <button
                type="button"
                onClick={onClose}
                className="rounded-2xl px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={commitSave}
                className="inline-flex items-center gap-1.5 rounded-2xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-zinc-900/10 transition hover:bg-zinc-800 hover:shadow-xl active:scale-[0.99] dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Save step
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
