"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DestinationPlaceSearchInput } from "@/components/manage/DestinationPlaceSearchInput";
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
import { datetimeLocalValueToIso, isoToDatetimeLocalValue } from "@/lib/isoDatetimeLocal";
import { stepIntervalEmoji } from "@/lib/stepIntervalUi";
import { collectTripPlacePicks } from "@/lib/tripLocationCatalog";
import {
  collectReferencedDestinationIdsFromStep,
  mergeDestinationLists,
} from "@/lib/tripDestinationRegistry";
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
  const tripPlacePicks = useMemo(
    () => collectTripPlacePicks(stepsForPicks, mergedDestinations),
    [stepsForPicks, mergedDestinations]
  );

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

  function commitSave() {
    const synced = syncStepTimesFromIntervals(draft);
    const ids = Array.from(collectReferencedDestinationIdsFromStep(synced));
    const upserts = ids
      .map((id) => destEdits[id])
      .filter((d): d is Destination => Boolean(d && d.id));
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
            const fromInt = (st.location ?? "").trim();
            if (fromInt) return fromInt;
            if (st.destinationId) return (rowFor(st.destinationId).location ?? "").trim();
            return "";
          })()
        : "";

    function patchActiveInterval(patch: Record<string, unknown>): void {
      patchIntervalAt(intervalIdx, patch);
    }

    const intervalStart = isoToDatetimeLocalValue(active.startTime);
    const intervalEnd = isoToDatetimeLocalValue(active.endTime);
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
              <DestinationPlaceSearchInput
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                placeholder="Type at least 2 characters…"
                localPicks={tripPlacePicks}
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
                <DestinationPlaceSearchInput
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                  placeholder="From…"
                  localPicks={tripPlacePicks}
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
                <DestinationPlaceSearchInput
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                  placeholder="To…"
                  localPicks={tripPlacePicks}
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
          </>
        ) : null}

        {draft.stepType === "activity" ? (
          <>
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
              <DestinationPlaceSearchInput
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                placeholder="Where is this activity?"
                localPicks={tripPlacePicks}
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

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {startLabel}
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              value={intervalStart}
              onChange={(e) =>
                patchActiveInterval({ startTime: datetimeLocalValueToIso(e.target.value) })
              }
            />
          </label>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {endLabel}
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              value={intervalEnd}
              onChange={(e) =>
                patchActiveInterval({ endTime: datetimeLocalValueToIso(e.target.value) })
              }
            />
          </label>
        </div>

        {draft.stepType === "stay" && active.intervalType === "stay" ? (
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Location (this interval)
            <DestinationPlaceSearchInput
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              placeholder="Type at least 2 characters…"
              localPicks={tripPlacePicks}
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
                    <DestinationPlaceSearchInput
                      className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                      placeholder="Pick trip place or search…"
                      localPicks={tripPlacePicks}
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
                    <DestinationPlaceSearchInput
                      className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                      placeholder="Pick trip place or search…"
                      localPicks={tripPlacePicks}
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

        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {commentLabel}
          <textarea
            rows={2}
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            placeholder="Picked places are appended here automatically."
            value={active.comment ?? ""}
            onChange={(e) =>
              patchActiveInterval({
                comment: e.target.value.trim() ? e.target.value : undefined,
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white shadow-xl dark:bg-zinc-950 sm:max-h-[85vh] sm:rounded-3xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {headerLabel(wizard.top?.id, isNew)}
            </div>
            {wizard.stack.length > 1 ? (
              <p
                className="mt-0.5 truncate font-mono text-[10px] leading-tight text-zinc-500"
                title="Nested wizards: outer → inner. Pop with Back to return."
              >
                {wizard.stack.map((f) => f.id).join(" → ")}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
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
              tripPlacePicks={tripPlacePicks}
              mainPlace={rowFor((draft as StayStep).targetDestinationId)}
              setMainPlace={(d) => {
                setRow(d.id, d);
                const s = draft as StayStep;
                if (d.id !== s.targetDestinationId) {
                  setDraft({ ...s, targetDestinationId: d.id });
                }
              }}
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
              tripPlacePicks={tripPlacePicks}
              trip={overlayTrip()}
              onAppendDestinations={appendDestinations}
            />
          ) : null}

          {wizard.top?.id === STEP_WIZARD_IDS.transitStepWizard && draft.stepType === "transit" ? (
            <TransitStepWizardPanel
              draft={draft as TransitStep}
              setDraft={setDraft as (next: TransitStep | ((prev: TransitStep) => TransitStep)) => void}
              wizard={wizard}
              tripPlacePicks={tripPlacePicks}
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
              trip={overlayTrip()}
              tripPlacePicks={tripPlacePicks}
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
            <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium dark:border-zinc-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={commitSave}
                className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-zinc-900"
              >
                Save step
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
