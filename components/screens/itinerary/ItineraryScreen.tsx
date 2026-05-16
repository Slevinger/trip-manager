"use client";

import { useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { motion } from "framer-motion";
import { CalendarRange, GripVertical, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useTripData } from "@/lib/trip/useTripData";
import { TripLoadStateScreen } from "@/components/screens/_shared/TripLoadStateScreen";
import { TripBackToTripLink } from "@/components/screens/_shared/TripSubpageBackLink";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { InlineAgentSuggestions } from "@/components/agent/InlineAgentSuggestions";
import { CanonicalStepEditorDialog } from "@/components/manage/CanonicalStepEditorDialog";
import { createStayStep, normalizeStepOrders } from "@/lib/canonicalStepBuilders";
import { mergeDestinationLists } from "@/lib/tripDestinationRegistry";
import { sortTripStepsByStartTime } from "@/lib/tripStepSort";
import { groupStepsByDay, moveStepToDay } from "@/lib/tripStepReorder";
import type { Destination, Trip, TripStep } from "@/lib/types/trip";
import { DayColumn } from "./DayColumn";
import { useTripWeather, weatherCodeIcon } from "@/lib/weather/useTripWeather";

export function ItineraryScreen({ tripId }: { tripId: string }) {
  const { trip, loadState, persistTrip, canManage } = useTripData(tripId);
  if (loadState !== "ok" || !trip) return <TripLoadStateScreen state={loadState} />;
  return <ItineraryContent trip={trip} persistTrip={persistTrip} canManage={canManage} />;
}

export function ItineraryContent({
  trip,
  persistTrip,
  canManage,
  standalone = true,
}: {
  trip: Trip;
  persistTrip: (next: Trip) => Promise<void>;
  canManage: boolean;
  standalone?: boolean;
}) {
  const { t } = useI18n();
  const [overlayId, setOverlayId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{
    step: TripStep;
    isNew: boolean;
    destinationSeeds?: Destination[];
  } | null>(null);
  const pendingInsertAfterId = useRef<string | null>(null);
  const weather = useTripWeather(trip);

  const sortedSteps = useMemo(() => sortTripStepsByStartTime(trip.steps), [trip.steps]);

  function addStep() {
    pendingInsertAfterId.current = null;
    const { step, newDestinations } = createStayStep(sortedSteps.length, trip.startDate);
    setEditor({ step, isNew: true, destinationSeeds: newDestinations });
  }

  function editStep(s: TripStep) {
    setEditor({ step: s, isNew: false });
  }

  async function handleSave({ step: saved, destinationUpserts }: { step: TripStep; destinationUpserts: Destination[] }) {
    const mergedDest = mergeDestinationLists(trip.destinations, destinationUpserts);
    const insertAfter = pendingInsertAfterId.current;
    pendingInsertAfterId.current = null;
    const idx = trip.steps.findIndex((s) => s.id === saved.id);
    let nextSteps: TripStep[];
    if (idx === -1) {
      if (insertAfter) {
        const sorted = sortTripStepsByStartTime(trip.steps);
        const j = sorted.findIndex((s) => s.id === insertAfter);
        nextSteps = j >= 0
          ? [...sorted.slice(0, j + 1), saved, ...sorted.slice(j + 1)]
          : [...trip.steps, saved];
      } else {
        nextSteps = [...trip.steps, saved];
      }
    } else {
      nextSteps = trip.steps.map((s) => (s.id === saved.id ? saved : s));
    }
    await persistTrip({
      ...trip,
      destinations: mergedDest,
      steps: normalizeStepOrders(nextSteps),
      updatedAt: new Date().toISOString(),
    });
    setEditor(null);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const grouped = useMemo(() => groupStepsByDay(trip), [trip]);
  const dayKeys = useMemo(() => Array.from(grouped.keys()), [grouped]);

  async function onDragEnd(event: DragEndEvent) {
    setOverlayId(null);
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) return;
    const stepId = activeId.replace(/^step:/, "");
    if (overId.startsWith("day:")) {
      const targetDay = overId.replace(/^day:/, "");
      const next = moveStepToDay({ trip, stepId, targetDay, targetIndex: -1 });
      if (next !== trip) await persistTrip(next);
      return;
    }
    if (overId.startsWith("step:")) {
      const overStepId = overId.replace(/^step:/, "");
      const targetEntry = Array.from(grouped.entries()).find(([, list]) =>
        list.some((s: TripStep) => s.id === overStepId)
      );
      if (!targetEntry) return;
      const [targetDay, list] = targetEntry;
      const targetIndex = list.findIndex((s) => s.id === overStepId);
      const next = moveStepToDay({ trip, stepId, targetDay, targetIndex });
      if (next !== trip) await persistTrip(next);
    }
  }

  const totalSteps = trip.steps.length;

  const inner = (
    <>
      <header>
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-brand)]">
          <CalendarRange className="h-3.5 w-3.5" /> {trip.title}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--color-foreground)]">
          {t("itinerary.heading")}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t("itinerary.subheading")}</p>
        {canManage ? (
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--color-muted-foreground)]">
            <GripVertical className="h-3 w-3" /> {t("itinerary.dragHint")}
          </p>
        ) : null}
      </header>

      <InlineAgentSuggestions trip={trip} kind="activity" />

      {weather.weatherRange?.mode === "nearby_preview" && weather.daily && weather.daily.length > 0 ? (
        <p className="text-[11px] leading-snug text-[var(--color-muted-foreground)]">{t("dashboard.weatherNearbyPreview")}</p>
      ) : null}

      {totalSteps === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={<CalendarRange className="h-7 w-7" />}
              title={t("itinerary.empty")}
              description={t("itinerary.subheading")}
            />
          </CardContent>
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => setOverlayId(String(e.active.id))}
          onDragCancel={() => setOverlayId(null)}
          onDragEnd={(e) => void onDragEnd(e)}
        >
          <motion.div layout className="space-y-6">
            {dayKeys.map((day, idx) => {
              const items = grouped.get(day) ?? [];
              const dayIso = day.slice(0, 10);
              const w =
                (weather.tripHistorical?.daily ?? []).find((d) => d.dateIso.slice(0, 10) === dayIso) ??
                weather.daily?.find((d) => d.dateIso.slice(0, 10) === dayIso);
              const chip = w ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-muted-foreground)]">
                  <span aria-hidden>{weatherCodeIcon(w.weatherCode)}</span>
                  {Math.round(w.tempMaxC)}° / {Math.round(w.tempMinC)}°
                </span>
              ) : undefined;
              return (
                <DayColumn
                  key={day}
                  dayKey={day}
                  index={idx + 1}
                  trip={trip}
                  items={items}
                  draggable={canManage}
                  weatherChip={chip}
                />
              );
            })}
          </motion.div>
          <DraggingOverlay
            stepId={overlayId ? overlayId.replace(/^step:/, "") : null}
            steps={trip.steps}
          />
        </DndContext>
      )}

      {canManage ? (
        <motion.button
          type="button"
          onClick={addStep}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          aria-label={t("manage.addStep")}
          title={t("manage.addStep")}
          className="fixed bottom-20 start-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-brand)] text-white shadow-[var(--shadow-float)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-brand)]/40 lg:bottom-6 lg:start-6"
        >
          <Plus className="h-6 w-6" />
        </motion.button>
      ) : null}

      {editor ? (
        <CanonicalStepEditorDialog
          key={editor.step.id}
          open
          trip={trip}
          tripStartIso={trip.startDate}
          tripCurrency={trip.currency}
          tripSteps={sortedSteps}
          stepOrder={editor.step.order}
          initial={editor.step}
          isNew={editor.isNew}
          initialDestinationSeeds={editor.destinationSeeds}
          startInWizard={editor.isNew}
          onClose={() => setEditor(null)}
          onSave={(payload) => void handleSave(payload)}
        />
      ) : null}
    </>
  );
  if (!standalone) return inner;
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 lg:px-8">
      {inner}
    </div>
  );
}

function DraggingOverlay({ stepId, steps }: { stepId: string | null; steps: TripStep[] }) {
  if (!stepId) return null;
  const step = steps.find((s) => s.id === stepId);
  if (!step) return null;
  return null;
}

export { DayColumn };

export function _SortableContextWrap({ items, children }: { items: string[]; children: React.ReactNode }) {
  return (
    <SortableContext items={items} strategy={verticalListSortingStrategy}>
      {children}
    </SortableContext>
  );
}
