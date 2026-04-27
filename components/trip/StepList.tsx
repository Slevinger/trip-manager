"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Trip, TripStep } from "@/lib/types/trip";
import {
  computeNightsForStep,
  effectiveStepEndParts,
  effectiveStepStartParts,
} from "@/lib/timeline/hotelsAndDates";
import { useI18n } from "@/components/providers/I18nProvider";
import { formatTripDateTimeForLocale } from "@/lib/i18n/format";

export function StepList({
  trip,
  onEdit,
  onDelete,
  onSetActive,
  onReorder,
  onInsertAfter,
}: {
  trip: Trip;
  onEdit: (step: TripStep) => void;
  onDelete: (stepId: string) => void;
  onSetActive: (stepId: string) => void;
  onReorder: (orderedStepIds: string[]) => void;
  /** Insert a new step after this step’s card and open the editor (Manage tab). */
  onInsertAfter?: (afterStepId: string) => void;
}) {
  const { t, locale } = useI18n();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragSnapshot = useRef<TripStep[]>([]);
  const steps = useMemo(
    () => [...trip.steps].sort((a, b) => a.order - b.order),
    [trip.steps]
  );
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
    setDragPos(null);
    dragSnapshot.current = [];
  }

  function calcDropIndex(pointerY: number, currentDraggingId: string): number {
    const ordered = steps.filter((s) => s.id !== currentDraggingId);
    for (let i = 0; i < ordered.length; i++) {
      const el = cardRefs.current.get(ordered[i].id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      if (pointerY < centerY) return i;
    }
    return ordered.length;
  }

  function startPointerDrag(
    e: React.PointerEvent<HTMLButtonElement>,
    stepId: string
  ) {
    if (e.button !== 0) return;
    e.preventDefault();
    dragSnapshot.current = steps;
    setDraggingId(stepId);
    setDragPos({ x: e.clientX, y: e.clientY });
    setDropIndex(calcDropIndex(e.clientY, stepId));
  }

  useEffect(() => {
    if (!draggingId) return;
    const onMove = (e: PointerEvent) => {
      setDragPos({ x: e.clientX, y: e.clientY });
      setDropIndex(calcDropIndex(e.clientY, draggingId));
    };
    const onUp = () => {
      if (dropIndex !== null) commitReorderAt(dropIndex);
      clearDragState();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [draggingId, dropIndex, steps]);

  function renderInsertedDraggingCard() {
    if (!draggingStep) return null;
    const start = effectiveStepStartParts(draggingStep);
    const end = effectiveStepEndParts(draggingStep);
    const nights = computeNightsForStep(draggingStep);
    const nightsSuffix =
      draggingStep.type === "transit"
        ? ""
        : ` · ${t("step.nights")}: ${nights}`;
    return (
      <div className="rounded-2xl border border-blue-300 bg-blue-50/80 p-4 shadow-sm transition-all duration-200 ease-out dark:border-blue-700 dark:bg-blue-900/20">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {draggingStep.title.trim() || t("step.title")}
            </div>
            <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
              {start.date
                ? formatTripDateTimeForLocale(locale, start.date, start.time)
                : "—"}{" "}
              →{" "}
              {end.date ? formatTripDateTimeForLocale(locale, end.date, end.time) : "—"}
              {nightsSuffix}
            </div>
            {draggingStep.location.trim() ? (
              <div className="mt-1 text-xs text-zinc-500">{draggingStep.location}</div>
            ) : null}
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              draggingStep.status === "active"
                ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
                : draggingStep.status === "done"
                  ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                  : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
            }`}
          >
            {t(`status.${draggingStep.status}`)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {isDragging && draggingStep && dragPos ? (
        <div
          className="pointer-events-none fixed z-[70] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-blue-300 bg-white/95 p-4 shadow-2xl backdrop-blur dark:border-blue-700 dark:bg-zinc-950/95"
          style={{ left: dragPos.x, top: dragPos.y }}
        >
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {draggingStep.title.trim() || t("step.title")}
          </div>
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
            {draggingStep.location.trim() || "—"}
          </div>
        </div>
      ) : null}
      {visibleSteps.map((s, idx) => {
        const start = effectiveStepStartParts(s);
        const end = effectiveStepEndParts(s);
        const nights = computeNightsForStep(s);
        const nightsSuffix =
          s.type === "transit" ? "" : ` · ${t("step.nights")}: ${nights}`;
        return (
          <div key={s.id}>
            <div
              className={`overflow-hidden transition-all duration-200 ease-out ${
                isDragging && dropIndex === idx ? "h-4 opacity-100" : "h-0 opacity-0"
              }`}
            >
              <div className="h-4" />
            </div>
            {isDragging && dropIndex === idx ? (
              <div className="mb-3">{renderInsertedDraggingCard()}</div>
            ) : null}
            <div
              ref={(el) => {
                if (el) cardRefs.current.set(s.id, el);
                else cardRefs.current.delete(s.id);
              }}
              className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-all duration-200 ease-out dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    <button
                      type="button"
                      className="mr-2 cursor-grab touch-none text-zinc-400 active:cursor-grabbing"
                      title="Drag to reorder"
                      onPointerDown={(e) => startPointerDrag(e, s.id)}
                      aria-label="Drag step"
                    >
                      ⋮⋮
                    </button>
                    {idx + 1}. {s.title.trim() || t("step.title")}
                  </div>
                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                    {start.date
                      ? formatTripDateTimeForLocale(locale, start.date, start.time)
                      : "—"}{" "}
                    →{" "}
                    {end.date
                      ? formatTripDateTimeForLocale(locale, end.date, end.time)
                      : "—"}
                    {nightsSuffix}
                  </div>
                  {s.location.trim() ? (
                    <div className="mt-1 text-xs text-zinc-500">{s.location}</div>
                  ) : null}
                  {s.type === "stay" && s.hotels.length > 0 ? (
                    <div className="mt-1">
                      <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-900 dark:bg-sky-900/40 dark:text-sky-100">
                        🏨 {s.hotels.length}
                      </span>
                    </div>
                  ) : null}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    s.status === "active"
                      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
                      : s.status === "done"
                        ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                        : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                  }`}
                >
                  {t(`status.${s.status}`)}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium dark:border-zinc-800 dark:bg-zinc-900"
                  onClick={() => onSetActive(s.id)}
                >
                  {t("step.setActive")}
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium dark:border-zinc-800 dark:bg-zinc-900"
                  onClick={() => onEdit(s)}
                >
                  {t("common.edit")}
                </button>
                {onInsertAfter ? (
                  <button
                    type="button"
                    className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100"
                    onClick={() => onInsertAfter(s.id)}
                  >
                    {t("manage.addStepAfter")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
                  onClick={() => onDelete(s.id)}
                >
                  {t("common.delete")}
                </button>
              </div>
            </div>
          </div>
        );
      })}
      <div
        className={`overflow-hidden transition-all duration-200 ease-out ${
          isDragging && dropIndex === visibleSteps.length ? "h-4 opacity-100" : "h-0 opacity-0"
        }`}
      >
        <div className="h-4" />
      </div>
      {isDragging && dropIndex === visibleSteps.length ? (
        <div>{renderInsertedDraggingCard()}</div>
      ) : null}
      {!steps.length ? (
        <p className="text-sm text-zinc-500">{t("view.none")}</p>
      ) : null}
    </div>
  );
}
