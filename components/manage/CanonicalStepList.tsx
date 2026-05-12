"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import type { MessageKey } from "@/lib/i18n/messages";
import { isoToDatetimeLocalValue } from "@/lib/isoDatetimeLocal";
import { stepIntervalEmoji } from "@/lib/stepIntervalUi";
import { destinationFromList } from "@/lib/tripDestinationRegistry";
import { sortTripStepsByStartTime } from "@/lib/tripStepSort";
import { formatMoneyDisplay, stepDisplayTotalCost } from "@/lib/trip/stepCosts";
import type { Destination, Trip, TripStep } from "@/lib/types/trip";

const REORDER_LONG_PRESS_MS = 450;
const REORDER_CANCEL_MOVE_PX = 12;

function stepEmoji(step: TripStep): string {
  if (step.stepType === "stay") return "🏨";
  if (step.stepType === "activity") return "📍";
  return "✈️";
}

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

function stepKindLabel(step: TripStep, t: TFn): string {
  switch (step.stepType) {
    case "stay":
      return t("view.kindStay");
    case "transit":
      return t("view.kindTransit");
    case "activity":
      return t("view.kindActivity");
  }
}

function formatIntervalCompact(startIso: string, endIso: string): string {
  const a = new Date(startIso);
  const b = new Date(endIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "—";
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  return `${a.toLocaleString(undefined, opts)} → ${b.toLocaleString(undefined, opts)}`;
}

function intervalTitle(int: TripStep["stepIntervals"][number], t: TFn): string {
  return int.title.trim() || t("common.untitled");
}

function stepPlaceSummary(s: TripStep, destinations: Destination[]): string {
  if (s.stepType === "stay") {
    const d = destinationFromList(destinations, s.targetDestinationId);
    return d?.title || d?.location || "—";
  }
  if (s.stepType === "transit") {
    const a = destinationFromList(destinations, s.fromStayId);
    const b = destinationFromList(destinations, s.toStayId);
    return `${a?.title || a?.location || "?"} → ${b?.title || b?.location || "?"}`;
  }
  const d = destinationFromList(destinations, s.destinationId);
  return d?.title || d?.location || "—";
}

/** Short hint after the time range (stay location, activity place, transit mode). */
function intervalExtraHint(
  step: TripStep,
  int: TripStep["stepIntervals"][number],
  destinations: Destination[]
): string | null {
  if (step.stepType === "stay" && int.intervalType === "stay") {
    const loc = (int.location ?? "").trim();
    if (loc) return loc;
    if ("destinationId" in int && int.destinationId) {
      const d = destinationFromList(destinations, int.destinationId);
      const fromReg = (d?.location ?? d?.title ?? "").trim();
      return fromReg || null;
    }
    return null;
  }
  if (step.stepType === "activity" && int.intervalType === "activity") {
    const d = destinationFromList(destinations, int.destinationId);
    if (!d) return null;
    const t = (d.title || d.location || "").trim();
    return t || null;
  }
  if (step.stepType === "transit" && int.intervalType === "transit") {
    return int.transitType.replace(/_/g, " ");
  }
  return null;
}

export function CanonicalStepList({
  trip,
  onEdit,
  onDelete,
  onReorder,
  onInsertAfter,
}: {
  trip: Trip;
  onEdit: (step: TripStep) => void;
  onDelete: (stepId: string) => void;
  onReorder: (orderedStepIds: string[]) => void;
  onInsertAfter: (afterStepId: string) => void;
}) {
  const { t } = useI18n();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [deleteConfirmStepId, setDeleteConfirmStepId] = useState<string | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragSnapshot = useRef<TripStep[]>([]);
  const stepsRef = useRef<TripStep[]>([]);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDragRef = useRef<{
    stepId: string;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    pointerId: number;
  } | null>(null);
  const dropIndexRef = useRef<number | null>(null);

  const steps = useMemo(() => sortTripStepsByStartTime(trip.steps), [trip.steps]);
  stepsRef.current = steps;
  const isDragging = draggingId !== null;
  const draggingStep = draggingId ? steps.find((s) => s.id === draggingId) ?? null : null;
  const visibleSteps = isDragging ? steps.filter((s) => s.id !== draggingId) : steps;

  function commitReorderAt(index: number) {
    if (!draggingId) return;
    const source = dragSnapshot.current.length ? dragSnapshot.current : steps;
    const from = source.findIndex((s) => s.id === draggingId);
    if (from < 0) return;
    const moved = source[from];
    const without = source.filter((s) => s.id !== draggingId);
    const bounded = Math.max(0, Math.min(index, without.length));
    const next = [...without];
    next.splice(bounded, 0, moved);
    onReorder(next.map((s) => s.id));
  }

  function clearDragState() {
    setDraggingId(null);
    setDropIndex(null);
    dropIndexRef.current = null;
    setDragPos(null);
    dragSnapshot.current = [];
  }

  function cancelPendingLongPress() {
    if (longPressTimerRef.current != null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pendingDragRef.current = null;
  }

  useEffect(() => () => cancelPendingLongPress(), []);

  function beginReorderDrag(stepId: string, clientX: number, clientY: number) {
    dragSnapshot.current = stepsRef.current;
    setDraggingId(stepId);
    setDragPos({ x: clientX, y: clientY });
    const idx = calcDropIndex(clientY, stepId);
    dropIndexRef.current = idx;
    setDropIndex(idx);
  }

  function scheduleLongPressReorder(e: React.PointerEvent<HTMLButtonElement>, stepId: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    cancelPendingLongPress();

    const pointerId = e.pointerId;
    pendingDragRef.current = {
      stepId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      pointerId,
    };

    let cleaned = false;
    const cleanupWaitListeners = () => {
      if (cleaned) return;
      cleaned = true;
      window.removeEventListener("pointermove", onMoveWhileWaiting);
      window.removeEventListener("pointerup", onUpWhileWaiting);
      window.removeEventListener("pointercancel", onUpWhileWaiting);
    };

    const onMoveWhileWaiting = (ev: PointerEvent) => {
      if (pendingDragRef.current?.pointerId !== ev.pointerId) return;
      pendingDragRef.current.lastX = ev.clientX;
      pendingDragRef.current.lastY = ev.clientY;
      const dx = ev.clientX - pendingDragRef.current.startX;
      const dy = ev.clientY - pendingDragRef.current.startY;
      if (dx * dx + dy * dy > REORDER_CANCEL_MOVE_PX * REORDER_CANCEL_MOVE_PX) {
        cleanupWaitListeners();
        cancelPendingLongPress();
      }
    };

    const onUpWhileWaiting = (ev: PointerEvent) => {
      if (pendingDragRef.current?.pointerId !== ev.pointerId) return;
      cleanupWaitListeners();
      cancelPendingLongPress();
    };

    window.addEventListener("pointermove", onMoveWhileWaiting);
    window.addEventListener("pointerup", onUpWhileWaiting);
    window.addEventListener("pointercancel", onUpWhileWaiting);

    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      cleanupWaitListeners();
      const p = pendingDragRef.current;
      pendingDragRef.current = null;
      if (!p || p.pointerId !== pointerId) return;
      beginReorderDrag(p.stepId, p.lastX, p.lastY);
    }, REORDER_LONG_PRESS_MS);
  }

  function calcDropIndex(pointerY: number, currentDraggingId: string): number {
    const ordered = stepsRef.current.filter((s) => s.id !== currentDraggingId);
    for (let i = 0; i < ordered.length; i++) {
      const el = cardRefs.current.get(ordered[i].id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      if (pointerY < centerY) return i;
    }
    return ordered.length;
  }

  useEffect(() => {
    if (!draggingId) return;
    const id = draggingId;
    const onMove = (e: PointerEvent) => {
      setDragPos({ x: e.clientX, y: e.clientY });
      const idx = calcDropIndex(e.clientY, id);
      dropIndexRef.current = idx;
      setDropIndex(idx);
    };
    const onUp = () => {
      const idx = dropIndexRef.current;
      if (idx !== null) commitReorderAt(idx);
      clearDragState();
    };
    const onCancel = () => {
      clearDragState();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onCancel, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [draggingId]);

  function formatRange(step: TripStep): string {
    const a = isoToDatetimeLocalValue(step.startTime).replace("T", " ");
    const b = step.endTime ? isoToDatetimeLocalValue(step.endTime).replace("T", " ") : "—";
    return `${a} → ${b}`;
  }

  function stepDisplayTitle(step: TripStep): string {
    return step.title.trim() || t("view.untitledStep");
  }

  return (
    <div className="space-y-3">
      {isDragging && draggingStep && dragPos ? (
        <div
          className="pointer-events-none fixed z-[70] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-blue-300 bg-white/95 p-4 shadow-2xl backdrop-blur dark:border-blue-700 dark:bg-zinc-950/95"
          style={{ left: dragPos.x, top: dragPos.y }}
        >
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {stepEmoji(draggingStep)} {stepDisplayTitle(draggingStep)}
          </div>
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{stepKindLabel(draggingStep, t)}</div>
        </div>
      ) : null}

      {visibleSteps.map((s, idx) => (
        <div key={s.id}>
          <div
            className={`overflow-hidden transition-all duration-200 ease-out ${
              isDragging && dropIndex === idx ? "h-4 opacity-100" : "h-0 opacity-0"
            }`}
          >
            <div className="h-4" />
          </div>
          <div
            ref={(el) => {
              if (el) cardRefs.current.set(s.id, el);
              else cardRefs.current.delete(s.id);
            }}
            className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  <button
                    type="button"
                    className="mr-2 cursor-grab touch-none text-zinc-400 active:cursor-grabbing"
                    title={t("manage.listDragReorderTitle")}
                    onPointerDown={(e) => scheduleLongPressReorder(e, s.id)}
                    aria-label={t("manage.listDragStepAria")}
                  >
                    ⋮⋮
                  </button>
                  {idx + 1}. {stepEmoji(s)} {stepDisplayTitle(s)}
                </div>
                {s.stepIntervals.length > 1 ? (
                  <div className="mt-1.5">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      {s.stepType === "stay"
                        ? t("manage.intervalCountStays", { count: s.stepIntervals.length })
                        : s.stepType === "transit"
                          ? t("manage.intervalCountLegs", { count: s.stepIntervals.length })
                          : t("manage.intervalCountSlots", { count: s.stepIntervals.length })}
                    </p>
                    <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto border-l-2 border-violet-300 pl-2 dark:border-violet-700">
                      {s.stepIntervals.map((int, i) => {
                        const hint = intervalExtraHint(s, int, trip.destinations);
                        return (
                          <li
                            key={int.id}
                            className="text-[11px] leading-snug text-zinc-600 dark:text-zinc-300"
                          >
                            <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                              <span
                                className="mr-0.5"
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
                              {i + 1}.
                            </span>{" "}
                            <span className="text-zinc-800 dark:text-zinc-100">
                              {intervalTitle(int, t)}
                            </span>{" "}
                            <span className="text-zinc-500 dark:text-zinc-400">
                              {formatIntervalCompact(int.startTime, int.endTime)}
                            </span>
                            {hint ? (
                              <span className="block truncate text-zinc-500 dark:text-zinc-500">
                                {hint}
                              </span>
                            ) : null}
                            {"price" in int && int.price ? (
                              <span className="mt-0.5 block text-[10px] font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
                                {formatMoneyDisplay(int.price)}
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                    <div className="mt-1.5 border-t border-zinc-100 pt-1.5 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                      {stepPlaceSummary(s, trip.destinations)}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                      {s.stepIntervals[0] ? (
                        <>
                          <span
                            className="mr-1"
                            aria-hidden
                            title={
                              s.stepIntervals[0].intervalType === "transit"
                                ? s.stepIntervals[0].transitType.replace(/_/g, " ")
                                : s.stepIntervals[0].intervalType === "activity"
                                  ? s.stepIntervals[0].activityType.replace(/_/g, " ")
                                  : s.stepIntervals[0].intervalType
                            }
                          >
                            {stepIntervalEmoji(s.stepIntervals[0])}
                          </span>
                          {formatIntervalCompact(
                            s.stepIntervals[0].startTime,
                            s.stepIntervals[0].endTime
                          )}
                        </>
                      ) : (
                        formatRange(s)
                      )}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {stepPlaceSummary(s, trip.destinations)}
                    </div>
                  </>
                )}
                {(() => {
                  const cost = stepDisplayTotalCost(s, trip.steps);
                  if (!cost) return null;
                  return (
                    <p className="mt-1.5 text-xs font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                      {t("itinerary.stepCostTotal")}: {formatMoneyDisplay(cost)}
                    </p>
                  );
                })()}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
                    {stepKindLabel(s, t)}
                  </span>
                  {deleteConfirmStepId !== s.id ? (
                    <button
                      type="button"
                      className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
                      onClick={() => setDeleteConfirmStepId(s.id)}
                      aria-label={t("manage.deleteStepAria", { title: stepDisplayTitle(s) })}
                    >
                      {t("manage.deleteStep")}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            {deleteConfirmStepId === s.id ? (
              <div
                className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900/40 dark:bg-amber-950/30"
                role="alert"
              >
                <p className="text-xs leading-snug text-amber-950 dark:text-amber-100">
                  {t("manage.deleteStepConfirm", { title: stepDisplayTitle(s) })}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                    onClick={() => setDeleteConfirmStepId(null)}
                  >
                    {t("manage.keepStep")}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-red-300 bg-red-600 px-3 py-1.5 text-xs font-semibold text-white dark:border-red-800 dark:bg-red-700"
                    onClick={() => {
                      onDelete(s.id);
                      setDeleteConfirmStepId(null);
                    }}
                  >
                    {t("manage.deleteStepYes")}
                  </button>
                </div>
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium dark:border-zinc-800 dark:bg-zinc-900"
                onClick={() => {
                  setDeleteConfirmStepId(null);
                  onEdit(s);
                }}
              >
                {t("common.edit")}
              </button>
              <button
                type="button"
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100"
                onClick={() => onInsertAfter(s.id)}
              >
                {t("manage.addStepAfter")}
              </button>
            </div>
          </div>
        </div>
      ))}

      <div
        className={`overflow-hidden transition-all duration-200 ease-out ${
          isDragging && dropIndex === visibleSteps.length ? "h-4 opacity-100" : "h-0 opacity-0"
        }`}
      >
        <div className="h-4" />
      </div>

      {!steps.length ? <p className="text-sm text-zinc-500">{t("manage.noStepsAddBelow")}</p> : null}
    </div>
  );
}
