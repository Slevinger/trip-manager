"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import {
  Bed,
  Bus,
  Compass,
  GripVertical,
  type LucideIcon,
  MapPin,
  Plane,
  Sparkles,
  Train,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/ui/cn";
import { tripInstantMs } from "@/lib/tripViewPhase";
import type { ActivityStep, TransitStep, Trip, TripStep } from "@/lib/types/trip";
import {
  activityStepTotalCost,
  formatMoneyDisplay,
  stayLinkedActivitiesCost,
  stayStepLodgingCost,
  stepDisplayTotalCost,
} from "@/lib/trip/stepCosts";

interface DayColumnProps {
  dayKey: string;
  index: number;
  trip: Trip;
  items: TripStep[];
  draggable: boolean;
  weatherChip?: React.ReactNode;
}

export function DayColumn({ dayKey, index, trip, items, draggable, weatherChip }: DayColumnProps) {
  const { t } = useI18n();
  const dayDate = parseDay(dayKey);
  const dateLabel = dayDate
    ? new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(dayDate)
    : dayKey;

  const { setNodeRef, isOver } = useDroppable({ id: `day:${dayKey}` });
  const sortableItemIds = items.map((s) => `step:${s.id}`);

  return (
    <section ref={setNodeRef} className={cn("space-y-3", isOver ? "rounded-3xl ring-2 ring-[var(--color-brand)]/40 ring-offset-2 ring-offset-[var(--color-background)]" : "")}>
      <header className="flex items-baseline gap-3">
        <span className="rounded-full bg-[var(--color-brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--color-brand)]">
          {t("itinerary.dayLabel", { index })}
        </span>
        <h2 className="text-lg font-semibold tracking-tight text-[var(--color-foreground)]">{dateLabel}</h2>
        {items.length > 0 ? (
          <span className="text-xs text-[var(--color-muted-foreground)]">
            {t("dashboard.stepsLabel", { count: items.length })}
          </span>
        ) : null}
        {weatherChip ? <span className="ms-auto">{weatherChip}</span> : null}
      </header>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-muted)]/40 px-4 py-6 text-center text-xs text-[var(--color-muted-foreground)]">
          {t("itinerary.allDay")}
        </div>
      ) : (
        <SortableContext items={sortableItemIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-2.5">
            {items.map((step) => (
              <StepCard
                key={step.id}
                step={step}
                trip={trip}
                draggable={draggable}
              />
            ))}
          </div>
        </SortableContext>
      )}
    </section>
  );
}

function parseDay(key: string): Date | null {
  const [yy, mm, dd] = key.split("-").map((n) => Number.parseInt(n, 10));
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  return new Date(yy, mm - 1, dd);
}

const STEP_ICON: Record<string, LucideIcon> = {
  stay: Bed,
  transit: Bus,
  activity: Sparkles,
};

const STEP_BADGE: Record<string, BadgeProps["tone"]> = {
  stay: "brand",
  transit: "sky",
  activity: "mint",
};

const TRANSIT_ICON: Record<string, LucideIcon> = {
  flight: Plane,
  train: Train,
};

function StepCard({
  step,
  trip,
  draggable,
}: {
  step: TripStep;
  trip: Trip;
  draggable: boolean;
}) {
  const { t } = useI18n();
  const sortable = useSortable({ id: `step:${step.id}` });
  const style = draggable
    ? {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.7 : 1,
      }
    : undefined;
  const Icon = STEP_ICON[step.stepType] ?? Compass;
  const tone = STEP_BADGE[step.stepType] ?? "neutral";
  const fmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
  const startMs = tripInstantMs(step.startTime);
  const endMs = step.endTime ? tripInstantMs(step.endTime) : null;
  const allDay = startMs == null;
  const timeRange = allDay
    ? t("itinerary.allDay")
    : endMs && endMs - (startMs ?? 0) > 0
      ? `${fmt.format(new Date(startMs!))} – ${fmt.format(new Date(endMs))}`
      : fmt.format(new Date(startMs!));

  const destination =
    trip.destinations.find((d) => d.id === step.targetDestinationId) ??
    trip.destinations.find(
      (d) =>
        ("destinationId" in step && d.id === (step as { destinationId?: string }).destinationId)
    );

  const firstInterval = step.stepIntervals?.[0];
  const isTransit = step.stepType === "transit" && firstInterval && "transitType" in firstInterval;
  const stepCost = useMemo(() => stepDisplayTotalCost(step, trip.steps), [step, trip.steps]);
  const TransitIcon =
    isTransit && firstInterval && "transitType" in firstInterval
      ? TRANSIT_ICON[(firstInterval as { transitType?: string }).transitType ?? ""]
      : null;

  return (
    <motion.div
      ref={sortable.setNodeRef}
      style={style}
      layout
      whileHover={{ y: -1 }}
      transition={{ type: "spring", stiffness: 250, damping: 22 }}
      className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)]"
    >
      <Accordion type="single" collapsible>
        <AccordionItem value={step.id} className="border-0">
          <div className="flex items-start gap-2 px-3 pt-3">
            {draggable ? (
              <button
                type="button"
                aria-label="Reorder"
                className="mt-1 cursor-grab rounded-lg p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-surface-muted)] active:cursor-grabbing"
                {...sortable.attributes}
                {...sortable.listeners}
              >
                <GripVertical className="h-4 w-4" />
              </button>
            ) : null}
            <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={tone}>{t(stepTypeLabelKey(step.stepType))}</Badge>
                {TransitIcon ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-muted-foreground)]">
                    <TransitIcon className="h-3 w-3" />
                  </span>
                ) : null}
                <span className="text-[11px] font-medium text-[var(--color-muted-foreground)]">{timeRange}</span>
                {stepCost ? (
                  <span className="text-[11px] font-semibold tabular-nums text-[var(--color-foreground)]">
                    {formatMoneyDisplay(stepCost)}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 line-clamp-2 text-sm font-semibold text-[var(--color-foreground)]">
                {step.title || t("itinerary.activity")}
              </p>
              {destination ? (
                <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-[var(--color-muted-foreground)]">
                  <MapPin className="h-3 w-3" /> {destination.title}
                  {destination.location ? ` · ${destination.location}` : ""}
                </p>
              ) : null}
            </div>
          </div>
          <AccordionTrigger className="px-3 pb-2 pt-0 text-[11px] font-medium text-[var(--color-muted-foreground)] hover:bg-transparent">
            {t("itinerary.editStep")}
          </AccordionTrigger>
          <AccordionContent>
            <StepDetails step={step} trip={trip} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </motion.div>
  );
}

function stepTypeLabelKey(stepType: TripStep["stepType"]) {
  if (stepType === "stay") return "itinerary.stay" as const;
  if (stepType === "transit") return "itinerary.transit" as const;
  return "itinerary.activity" as const;
}

function StepDetails({ step, trip }: { step: TripStep; trip: Trip }) {
  const { t } = useI18n();
  const intervals = step.stepIntervals ?? [];
  const firstInterval = intervals[0];
  const fmt = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const fromDest =
    "fromStayId" in step ? trip.destinations.find((d) => d.id === step.fromStayId) : null;
  const toDest =
    "toStayId" in step ? trip.destinations.find((d) => d.id === step.toStayId) : null;

  const intervalPriceRows = intervals
    .map((int, i) => {
      const p = "price" in int ? int.price : undefined;
      if (!p) return null;
      const title = (int.title ?? "").trim() || t("itinerary.intervalCostShort", { index: i + 1 });
      return (
        <DetailItem key={int.id} label={t("itinerary.intervalCostShort", { index: i + 1 })}>
          <span className="text-[var(--color-muted-foreground)]">{title}</span>
          <span className="mt-0.5 block tabular-nums text-[var(--color-foreground)]">{formatMoneyDisplay(p)}</span>
        </DetailItem>
      );
    })
    .filter(Boolean);

  const pricedIntervalCount = intervals.filter((i) => "price" in i && i.price).length;
  const lodgingSubtotal =
    step.stepType === "stay" && pricedIntervalCount > 1 ? stayStepLodgingCost(step) : null;

  const linkedActs =
    step.stepType === "stay"
      ? trip.steps.filter(
          (s): s is ActivityStep => s.stepType === "activity" && s.hostStayStepId === step.id
        )
      : [];

  const linkedSubtotal =
    linkedActs.length > 0 ? stayLinkedActivitiesCost(step.id, trip.steps) : null;

  const stayMixedLodgingLinked =
    step.stepType === "stay"
      ? (() => {
          const l = stayStepLodgingCost(step);
          const a = stayLinkedActivitiesCost(step.id, trip.steps);
          return Boolean(l && a && l.currency !== a.currency);
        })()
      : false;

  const linkedActivitiesCurrencyClash =
    linkedActs.length > 1 &&
    !linkedSubtotal &&
    linkedActs.filter((a) => activityStepTotalCost(a)).length > 1;

  const transitManual =
    step.stepType === "transit" ? (step as TransitStep).totalManualPrice : undefined;

  const stepTotal = stepDisplayTotalCost(step, trip.steps);

  return (
    <div className="space-y-3 text-xs text-[var(--color-foreground)]">
      <div className="flex flex-wrap gap-3">
        <DetailItem label={t("itinerary.duration")}>
          {step.startTime ? fmt.format(new Date(step.startTime)) : "—"}
          {step.endTime ? ` → ${fmt.format(new Date(step.endTime))}` : ""}
        </DetailItem>
        {fromDest && toDest ? (
          <DetailItem label={t("itinerary.fromTo", { from: fromDest.title, to: toDest.title })}>
            {fromDest.title} → {toDest.title}
          </DetailItem>
        ) : null}
        {firstInterval && "booking" in firstInterval && firstInterval.booking?.bookingUrl ? (
          <DetailItem label={t("itinerary.bookingLabel")}>
            <a
              href={firstInterval.booking.bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-brand)] underline"
            >
              {firstInterval.booking.bookingUrl.replace(/^https?:\/\//, "").slice(0, 40)}
            </a>
          </DetailItem>
        ) : null}
      </div>

      {intervalPriceRows.length > 0 ? (
        <div className="flex flex-wrap gap-3 border-t border-[var(--color-border)] pt-3">{intervalPriceRows}</div>
      ) : null}

      {transitManual ? (
        <div className="border-t border-[var(--color-border)] pt-3">
          <DetailItem label={t("itinerary.transitExtraFees")}>{formatMoneyDisplay(transitManual)}</DetailItem>
        </div>
      ) : null}

      {step.stepType === "stay" && linkedActs.length > 0 ? (
        <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            {t("itinerary.stayLinkedActivitiesHeading")}
          </p>
          <div className="flex flex-wrap gap-3">
            {linkedActs.map((act) => {
              const m = activityStepTotalCost(act);
              return (
                <DetailItem key={act.id} label={(act.title ?? "").trim() || t("itinerary.activity")}>
                  {m ? formatMoneyDisplay(m) : "—"}
                </DetailItem>
              );
            })}
          </div>
          {linkedSubtotal ? (
            <DetailItem label={t("itinerary.stayLinkedActivitiesSubtotal")}>
              {formatMoneyDisplay(linkedSubtotal)}
            </DetailItem>
          ) : null}
        </div>
      ) : null}

      {lodgingSubtotal ? (
        <div className="border-t border-[var(--color-border)] pt-3">
          <DetailItem label={t("itinerary.stayLodgingSubtotal")}>{formatMoneyDisplay(lodgingSubtotal)}</DetailItem>
        </div>
      ) : null}

      {stayMixedLodgingLinked || linkedActivitiesCurrencyClash ? (
        <p className="text-[11px] leading-snug text-[var(--color-muted-foreground)]">
          {t("itinerary.mixedCurrencyTotals")}
        </p>
      ) : null}

      {stepTotal ? (
        <div className="border-t border-[var(--color-border)] pt-3">
          <DetailItem label={t("itinerary.stepCostTotal")}>
            <span className="text-sm font-semibold tabular-nums text-[var(--color-foreground)]">
              {formatMoneyDisplay(stepTotal)}
            </span>
          </DetailItem>
        </div>
      ) : null}

      {(() => {
        const notes = (firstInterval as { notes?: string } | undefined)?.notes;
        if (!notes) return null;
        return (
          <DetailItem label={t("itinerary.notes")}>
            <p className="whitespace-pre-wrap text-[var(--color-muted-foreground)]">{notes}</p>
          </DetailItem>
        );
      })()}
    </div>
  );
}

function DetailItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-32">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
        {label}
      </p>
      <div className="mt-0.5 text-[12px] font-medium text-[var(--color-foreground)]">{children}</div>
    </div>
  );
}
