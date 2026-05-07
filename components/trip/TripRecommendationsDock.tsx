"use client";

import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/lib/i18n/context";
import {
  approveTripRecommendationOption,
  markTripRecommendationSeen,
  removeTripRecommendation,
  skipTripRecommendation,
  unseenTripRecommendationCount,
} from "@/lib/tripRecommendations";
import type {
  ActivityRecommendationOption,
  ActivityStepInterval,
  Destination,
  StayStepInterval,
  TransitStepInterval,
  Trip,
  TripRecommendation,
  TripRecommendationOption,
} from "@/lib/types/trip";

const FAB_SIZE = 64;
const PANEL_W = 360;
const PANEL_MAX_H = 560;
const EDGE = 12;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

type RecDragSession =
  | {
      kind: "header";
      startX: number;
      startY: number;
      startLeft: number;
      startTop: number;
    }
  | {
      kind: "fab";
      startX: number;
      startY: number;
      startLeft: number;
      startTop: number;
      /** True after pointer moved past threshold — then we drag instead of toggling open. */
      dragging: boolean;
      wasClosed: boolean;
    };

function formatRange(startIso: string, endIso: string): string | null {
  const a = new Date(startIso);
  const b = new Date(endIso);
  const aOk = !Number.isNaN(a.getTime());
  const bOk = !Number.isNaN(b.getTime());
  if (!aOk && !bOk) return null;
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  if (aOk && !bOk) return a.toLocaleString(undefined, opts);
  if (!aOk && bOk) return b.toLocaleString(undefined, opts);
  return `${a.toLocaleString(undefined, opts)} → ${b.toLocaleString(undefined, opts)}`;
}

function destinationLabel(
  destinations: Destination[] | undefined,
  id: string | undefined
): string | null {
  const idTrim = id?.trim();
  if (!idTrim) return null;
  const d = (destinations ?? []).find((row) => row.id === idTrim);
  if (!d) return null;
  const label = (d.title || d.location || "").trim();
  return label || null;
}

function KindBadge({ kind }: { kind: TripRecommendation["kind"] }) {
  const styles: Record<TripRecommendation["kind"], string> = {
    stay: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200",
    transit: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200",
    activity:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
  };
  const label: Record<TripRecommendation["kind"], string> = {
    stay: "Stay",
    transit: "Transit",
    activity: "Activity",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles[kind]}`}
    >
      {label[kind]}
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 text-xs leading-snug">
      <span className="font-semibold text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="break-words text-zinc-800 dark:text-zinc-100">{value}</span>
    </div>
  );
}

function StayDetails({
  interval,
  destinations,
}: {
  interval: StayStepInterval;
  destinations: Destination[] | undefined;
}) {
  const range = formatRange(interval.startTime, interval.endTime);
  const place = destinationLabel(destinations, interval.destinationId);
  const checkIn = interval.checkInTime ? new Date(interval.checkInTime) : null;
  const checkOut = interval.checkOutTime ? new Date(interval.checkOutTime) : null;
  return (
    <div className="space-y-1.5">
      <DetailRow label="Type" value={interval.stayType} />
      {range ? <DetailRow label="When" value={range} /> : null}
      {(interval.location ?? "").trim() ? (
        <DetailRow label="Address" value={interval.location} />
      ) : null}
      {place ? <DetailRow label="Destination" value={place} /> : null}
      {checkIn && !Number.isNaN(checkIn.getTime()) ? (
        <DetailRow label="Check-in" value={checkIn.toLocaleString()} />
      ) : null}
      {checkOut && !Number.isNaN(checkOut.getTime()) ? (
        <DetailRow label="Check-out" value={checkOut.toLocaleString()} />
      ) : null}
      {typeof interval.nights === "number" ? (
        <DetailRow label="Nights" value={interval.nights} />
      ) : null}
      {interval.price ? (
        <DetailRow
          label="Price"
          value={`${interval.price.amount} ${interval.price.currency}`}
        />
      ) : null}
    </div>
  );
}

function TransitDetails({
  interval,
  destinations,
}: {
  interval: TransitStepInterval;
  destinations: Destination[] | undefined;
}) {
  const range = formatRange(interval.startTime, interval.endTime);
  const from = destinationLabel(destinations, interval.fromDestinationId);
  const to = destinationLabel(destinations, interval.toDestinationId);
  return (
    <div className="space-y-1.5">
      <DetailRow label="Type" value={interval.transitType} />
      {range ? <DetailRow label="When" value={range} /> : null}
      {from ? <DetailRow label="From" value={from} /> : null}
      {to ? <DetailRow label="To" value={to} /> : null}
      {interval.operatorName?.trim() ? (
        <DetailRow label="Operator" value={interval.operatorName} />
      ) : null}
      {interval.departureTerminal?.trim() ? (
        <DetailRow label="Departure" value={interval.departureTerminal} />
      ) : null}
      {interval.arrivalTerminal?.trim() ? (
        <DetailRow label="Arrival" value={interval.arrivalTerminal} />
      ) : null}
      {interval.price ? (
        <DetailRow
          label="Price"
          value={`${interval.price.amount} ${interval.price.currency}`}
        />
      ) : null}
    </div>
  );
}

function ActivityDetails({
  interval,
  destinations,
  linkedStayTitle,
}: {
  interval: ActivityStepInterval;
  destinations: Destination[] | undefined;
  linkedStayTitle?: string | null;
}) {
  const { t } = useI18n();
  const range = formatRange(interval.startTime, interval.endTime);
  const place = destinationLabel(destinations, interval.destinationId);
  return (
    <div className="space-y-1.5">
      {linkedStayTitle?.trim() ? (
        <DetailRow label={t("recs.linkedStay")} value={linkedStayTitle} />
      ) : null}
      <DetailRow label="Type" value={interval.activityType} />
      {range ? <DetailRow label="When" value={range} /> : null}
      {place ? <DetailRow label="Where" value={place} /> : null}
      {interval.price ? (
        <DetailRow
          label="Price"
          value={`${interval.price.amount} ${interval.price.currency}`}
        />
      ) : null}
    </div>
  );
}

function optionLabel(option: TripRecommendationOption, fallback: string): string {
  return (
    option.label?.trim() ||
    option.interval.title?.trim() ||
    fallback
  );
}

function RecommendationCard({
  recommendation,
  trip,
  selectedOptionId,
  onSelectOption,
}: {
  recommendation: TripRecommendation;
  trip: Trip;
  selectedOptionId: string | null;
  onSelectOption: (optionId: string) => void;
}) {
  const { t } = useI18n();
  const headline =
    recommendation.title?.trim() ||
    `${recommendation.kind[0].toUpperCase()}${recommendation.kind.slice(1)} suggestion`;

  const options = recommendation.options as TripRecommendationOption[];
  const selectedOption =
    options.find((o) => o.id === selectedOptionId) ?? options[0] ?? null;

  /** Merge selected option's destinations on top of the trip registry for label lookups. */
  const lookup = useMemo<Destination[]>(() => {
    const m = new Map<string, Destination>();
    for (const d of trip.destinations ?? []) m.set(d.id, d);
    for (const d of selectedOption?.destinations ?? []) m.set(d.id, d);
    return Array.from(m.values());
  }, [trip.destinations, selectedOption]);

  const activityLinkedStayTitle = useMemo(() => {
    if (recommendation.kind !== "activity" || !selectedOption) return null;
    const hid = (selectedOption as ActivityRecommendationOption).hostStayStepId?.trim();
    if (!hid) return null;
    const step = trip.steps.find((s) => s.id === hid && s.stepType === "stay");
    if (!step) return null;
    return step.title?.trim() || `Stay · ${step.order + 1}`;
  }, [recommendation.kind, selectedOption, trip.steps]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge kind={recommendation.kind} />
        {!recommendation.seen ? (
          <span className="inline-flex items-center rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow">
            {t("recs.newPill")}
          </span>
        ) : null}
        {recommendation.source?.trim() ? (
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            {recommendation.source}
          </span>
        ) : null}
      </div>
      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{headline}</h3>
      {recommendation.note?.trim() ? (
        <p className="whitespace-pre-wrap rounded-xl bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200">
          {recommendation.note}
        </p>
      ) : null}

      {options.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {t("recs.optionsLabel", { count: options.length })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {options.map((option, idx) => {
              const isSelected = selectedOption?.id === option.id;
              const label = optionLabel(option, t("recs.optionFallback", { index: idx + 1 }));
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onSelectOption(option.id)}
                  className={
                    "rounded-full border px-3 py-1 text-xs font-medium transition " +
                    (isSelected
                      ? "border-emerald-500 bg-emerald-500 text-white shadow"
                      : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800")
                  }
                  aria-pressed={isSelected}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {selectedOption?.note?.trim() ? (
        <p className="whitespace-pre-wrap rounded-xl bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100">
          {selectedOption.note}
        </p>
      ) : null}

      {selectedOption ? (
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
          {recommendation.kind === "stay" &&
          selectedOption.interval.intervalType === "stay" ? (
            <StayDetails interval={selectedOption.interval} destinations={lookup} />
          ) : recommendation.kind === "transit" &&
            selectedOption.interval.intervalType === "transit" ? (
            <TransitDetails interval={selectedOption.interval} destinations={lookup} />
          ) : recommendation.kind === "activity" &&
            selectedOption.interval.intervalType === "activity" ? (
            <ActivityDetails
              interval={selectedOption.interval}
              destinations={lookup}
              linkedStayTitle={activityLinkedStayTitle}
            />
          ) : null}
        </div>
      ) : null}

      {selectedOption?.interval.comment?.trim() ? (
        <p className="whitespace-pre-wrap rounded-xl bg-zinc-50 px-3 py-2 text-[11px] leading-relaxed text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
          {selectedOption.interval.comment}
        </p>
      ) : null}
    </div>
  );
}

function BellIcon({ unseen, total }: { unseen: number; total: number }) {
  /** Badge shows the unseen count (red, attention-grabbing) when there are new items;
   * falls back to a muted total badge when everything has been seen but the queue
   * still has skipped items waiting. Hidden entirely when the queue is empty. */
  const showRed = unseen > 0;
  const showMuted = unseen === 0 && total > 0;
  const badgeValue = showRed ? unseen : total;
  return (
    <span className="relative inline-flex">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-7 w-7"
        aria-hidden
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {showRed || showMuted ? (
        <span
          className={
            "absolute -right-1.5 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none ring-2 dark:ring-zinc-900 " +
            (showRed
              ? "bg-red-500 text-white shadow ring-white"
              : "bg-zinc-300 text-zinc-700 ring-white dark:bg-zinc-700 dark:text-zinc-200")
          }
        >
          {badgeValue > 99 ? "99+" : badgeValue}
        </span>
      ) : null}
    </span>
  );
}

export function TripRecommendationsDock({
  trip,
  canModify,
  onPersist,
  openRequest,
  onRequestHide,
}: {
  trip: Trip;
  /** False for read-only viewers (or when the persist callback isn't wired). */
  canModify: boolean;
  onPersist: (next: Trip) => Promise<void>;
  openRequest?: number;
  onRequestHide?: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [leftPx, setLeftPx] = useState(() => {
    if (typeof window === "undefined") return 24;
    return Math.max(EDGE, Math.round(window.innerWidth / 2 - FAB_SIZE / 2));
  });
  const [topPx, setTopPx] = useState(24);
  const dragSessionRef = useRef<RecDragSession | null>(null);
  /** Suppress the synthetic `click` after pointer-based open / drag so the panel does not flash closed. */
  const swallowFabClickRef = useRef(false);
  const prevOpenRequestRef = useRef<number | null>(null);
  const hideZoneRef = useRef<HTMLDivElement | null>(null);
  const dragPointerRef = useRef<{ x: number; y: number } | null>(null);
  const [showHideTarget, setShowHideTarget] = useState(false);
  const [hideTargetHot, setHideTargetHot] = useState(false);
  const hideTargetHotRef = useRef(false);
  const posRef = useRef({ left: 24, top: 24 });
  const [viewport, setViewport] = useState<{ w: number; h: number }>(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1024,
    h: typeof window !== "undefined" ? window.innerHeight : 768,
  }));

  useEffect(() => {
    const update = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (openRequest == null) return;
    if (prevOpenRequestRef.current === openRequest) return;
    prevOpenRequestRef.current = openRequest;
    setOpen(true);
  }, [openRequest]);
  const [activeIndex, setActiveIndex] = useState(0);
  /** Per-recommendation chosen option id; defaults to first option. */
  const [selectedOptionByRec, setSelectedOptionByRec] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"approve" | "delete" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    posRef.current = { left: leftPx, top: topPx };
  }, [leftPx, topPx]);

  const onPointerDownHeader = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, a, [role='button']")) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = posRef.current;
    dragSessionRef.current = {
      kind: "header",
      startX: e.clientX,
      startY: e.clientY,
      startLeft: p.left,
      startTop: p.top,
    };
  }, []);

  const onPointerDownFab = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if (open) return;
      const p = posRef.current;
      dragSessionRef.current = {
        kind: "fab",
        startX: e.clientX,
        startY: e.clientY,
        startLeft: p.left,
        startTop: p.top,
        dragging: false,
        wasClosed: true,
      };
    },
    [open]
  );

  useEffect(() => {
    const applyDrag = (startLeft: number, startTop: number, dx: number, dy: number) => {
      const maxL = typeof window !== "undefined" ? window.innerWidth - EDGE - FAB_SIZE : 400;
      const maxT = typeof window !== "undefined" ? window.innerHeight - EDGE - FAB_SIZE : 400;
      setLeftPx(clamp(startLeft + dx, EDGE, maxL));
      setTopPx(clamp(startTop + dy, EDGE, maxT));
    };

    const onMove = (e: PointerEvent) => {
      const s = dragSessionRef.current;
      if (!s) return;
      dragPointerRef.current = { x: e.clientX, y: e.clientY };
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      if (s.kind === "header") {
        applyDrag(s.startLeft, s.startTop, dx, dy);
        return;
      }
      const dist = Math.hypot(dx, dy);
      if (!s.dragging) {
        if (dist < 8) return;
        const p = posRef.current;
        dragSessionRef.current = {
          ...s,
          dragging: true,
          startX: e.clientX,
          startY: e.clientY,
          startLeft: p.left,
          startTop: p.top,
        };
        setShowHideTarget(true);
        return;
      }
      applyDrag(s.startLeft, s.startTop, dx, dy);
      const zone = hideZoneRef.current;
      const pt = dragPointerRef.current;
      if (zone && pt) {
        const r = zone.getBoundingClientRect();
        const hot = pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom;
        hideTargetHotRef.current = hot;
        setHideTargetHot(hot);
      }
    };

    const onUp = () => {
      const s = dragSessionRef.current;
      dragSessionRef.current = null;
      setShowHideTarget(false);
      const dropHot = hideTargetHotRef.current;
      hideTargetHotRef.current = false;
      setHideTargetHot(false);
      if (s?.kind === "fab") {
        if (s.dragging) {
          swallowFabClickRef.current = true;
          if (dropHot) onRequestHide?.();
        } else if (s.wasClosed) {
          /** Tap = open (only when there are recommendations to show). */
          swallowFabClickRef.current = true;
          setOpen(true);
        }
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  /** Latest trip from props — used after chained awaits so rapid arrow navigation doesn't lose earlier `seen` updates. */
  const tripRef = useRef(trip);
  tripRef.current = trip;
  /** Serialized persist queue for view→seen updates only. */
  const markSeenTailRef = useRef(Promise.resolve());

  const recommendations = trip.recommendations ?? [];
  const total = recommendations.length;
  const unseen = unseenTripRecommendationCount(trip);

  /** Keep `activeIndex` valid as the queue shrinks. */
  useEffect(() => {
    if (activeIndex >= total) {
      setActiveIndex(total > 0 ? total - 1 : 0);
    }
  }, [activeIndex, total]);

  /** Auto-close empty panel — but leave the bell visible (greyed) to broadcast no notifications. */
  useEffect(() => {
    if (total === 0 && open) setOpen(false);
  }, [open, total]);

  /** Opening the panel or moving with ←/→ counts as "viewing"; persist `seen` so the bell badge updates (no reorder — unlike Skip). */
  useEffect(() => {
    if (!open || !canModify || total === 0) return;
    const list = tripRef.current.recommendations ?? [];
    const currentRec = list[activeIndex];
    if (!currentRec || currentRec.seen) return;
    const rid = currentRec.id;

    markSeenTailRef.current = markSeenTailRef.current.then(async () => {
      const base = tripRef.current;
      const row = (base.recommendations ?? []).find((r) => r.id === rid);
      if (!row || row.seen) return;
      try {
        await onPersist(markTripRecommendationSeen(base, rid));
      } catch {
        /** Non-fatal: badge may stay "new" until a later sync; avoid spamming the dock error slot. */
      }
    });
  }, [open, activeIndex, canModify, total, onPersist]);

  const current = recommendations[activeIndex];
  const currentOptions = (current?.options ?? []) as TripRecommendationOption[];
  const selectedOptionId =
    (current && selectedOptionByRec[current.id]) ?? currentOptions[0]?.id ?? null;

  function handleSelectOption(optionId: string) {
    if (!current) return;
    setSelectedOptionByRec((prev) => ({ ...prev, [current.id]: optionId }));
  }

  async function handleApprove() {
    if (!current || !canModify || busy) return;
    const optionId = selectedOptionId ?? currentOptions[0]?.id;
    if (!optionId) {
      setError(t("recs.errorNoOption"));
      return;
    }
    setBusy("approve");
    setError(null);
    try {
      const next = approveTripRecommendationOption(trip, current.id, optionId);
      await onPersist(next);
      setSelectedOptionByRec((prev) => {
        const { [current.id]: _removed, ...rest } = prev;
        void _removed;
        return rest;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("recs.errorGeneric"));
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!current || !canModify || busy) return;
    setBusy("delete");
    setError(null);
    try {
      const next = removeTripRecommendation(trip, current.id);
      await onPersist(next);
      setSelectedOptionByRec((prev) => {
        const { [current.id]: _removed, ...rest } = prev;
        void _removed;
        return rest;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("recs.errorGeneric"));
    } finally {
      setBusy(null);
    }
  }

  async function handleSkip() {
    if (!current || !canModify || busy) return;
    setBusy("skip");
    setError(null);
    try {
      const next = skipTripRecommendation(trip, current.id);
      await onPersist(next);
      /** Keep the same `activeIndex`: skip moved this card to the end, so the
       * next unseen card slides into its slot. Clamp once the queue mutates. */
    } catch (e) {
      setError(e instanceof Error ? e.message : t("recs.errorGeneric"));
    } finally {
      setBusy(null);
    }
  }

  /** FAB stays anchored where the user dragged it. The panel is positioned
   * independently so it always fits in the viewport at full size:
   *   - prefer below+left-aligned with the FAB
   *   - flip above when there's no room below
   *   - flip horizontal alignment when right edge would overflow
   *   - finally clamp inside the viewport
   * Panel height shrinks only when the viewport itself is smaller than the
   * panel's intrinsic max-height (i.e. on tiny phones / split views). */
  const PANEL_GAP = 8;
  const intrinsicPanelH = PANEL_MAX_H;
  const panelW = Math.min(PANEL_W, Math.max(viewport.w - EDGE * 2, 200));
  const panelMaxH = Math.min(intrinsicPanelH, Math.max(viewport.h - EDGE * 2, 160));
  const placement = (() => {
    let panelTop = topPx + FAB_SIZE + PANEL_GAP;
    let panelLeft = leftPx;
    if (panelLeft + panelW > viewport.w - EDGE) {
      panelLeft = leftPx + FAB_SIZE - panelW;
    }
    panelLeft = clamp(panelLeft, EDGE, Math.max(viewport.w - panelW - EDGE, EDGE));
    if (panelTop + panelMaxH > viewport.h - EDGE) {
      const above = topPx - PANEL_GAP - panelMaxH;
      if (above >= EDGE) {
        panelTop = above;
      } else {
        panelTop = clamp(panelTop, EDGE, Math.max(viewport.h - panelMaxH - EDGE, EDGE));
      }
    }
    return { panelLeft, panelTop };
  })();

  const fabStyle: CSSProperties = {
    position: "fixed",
    left: leftPx,
    top: topPx,
    zIndex: 51,
    touchAction: "none",
    width: FAB_SIZE,
    height: FAB_SIZE,
  };
  const panelStyle: CSSProperties = {
    position: "fixed",
    left: placement.panelLeft,
    top: placement.panelTop,
    width: panelW,
    maxHeight: panelMaxH,
    zIndex: 50,
  };

  return (
    <>
      {showHideTarget ? (
        <div
          ref={hideZoneRef}
          className={
            "fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-full border px-5 py-3 text-sm font-semibold shadow-lg transition " +
            (hideTargetHot
              ? "border-red-300 bg-red-600 text-white dark:border-red-400"
              : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200")
          }
          style={{ touchAction: "none" }}
        >
          ✕ Hide
        </div>
      ) : null}
      <button
        type="button"
        aria-label={
          open
            ? t("recs.closePanel")
            : unseen > 0
              ? t("recs.openPanelWithUnseen", { unseen, total })
              : total > 0
                ? t("recs.openPanelWithCount", { count: total })
                : t("recs.openPanelEmpty")
        }
        aria-disabled={total === 0 && !open}
        onPointerDown={onPointerDownFab}
        onClick={() => {
          if (swallowFabClickRef.current) {
            swallowFabClickRef.current = false;
            return;
          }
          if (open) {
            setOpen(false);
            return;
          }
          if (total > 0) setOpen(true);
        }}
        style={fabStyle}
        className={
          "flex shrink-0 items-center justify-center rounded-full border shadow-lg ring-2 transition-all duration-300 ease-out focus-visible:opacity-100 active:opacity-100 cursor-grab active:cursor-grabbing " +
          (unseen > 0
            ? "opacity-100 border-amber-300 bg-gradient-to-br from-amber-400 to-amber-600 text-white ring-white/30 hover:from-amber-500 hover:to-amber-700 dark:border-amber-400 dark:ring-zinc-900/40"
            : "opacity-50 border-zinc-200 bg-white text-zinc-500 ring-transparent hover:opacity-100 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800")
        }
      >
        <BellIcon unseen={unseen} total={total} />
      </button>
      {open && current ? (
        <section
          className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
          style={panelStyle}
        >
            <header
              onPointerDown={onPointerDownHeader}
              className="flex cursor-grab items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2 active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-800/80"
            >
              <div className="min-w-0 select-none">
                <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {t("recs.title")}
                </p>
                <p className="truncate text-[11px] text-zinc-500">
                  {t("recs.counter", { current: activeIndex + 1, total })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                {t("common.close")}
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <RecommendationCard
                recommendation={current}
                trip={trip}
                selectedOptionId={selectedOptionId}
                onSelectOption={handleSelectOption}
              />
            </div>

            <div className="space-y-2 border-t border-zinc-200 px-3 py-2 dark:border-zinc-700">
              {error ? (
                <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>
              ) : null}
              {!canModify ? (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {t("recs.readOnlyHint")}
                </p>
              ) : null}
              {/** Isolate from page `dir` (Hebrew RTL mirrors flex — keeps [← prev][→ next] spatially correct). */}
              <div className="flex items-center gap-2" dir="ltr">
                <button
                  type="button"
                  disabled={total < 2}
                  onClick={() =>
                    setActiveIndex((i) => (i - 1 + total) % Math.max(total, 1))
                  }
                  className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  aria-label={t("recs.prev")}
                >
                  ←
                </button>
                <button
                  type="button"
                  disabled={total < 2}
                  onClick={() => setActiveIndex((i) => (i + 1) % Math.max(total, 1))}
                  className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  aria-label={t("recs.next")}
                >
                  →
                </button>
                <div className="ms-auto flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!canModify || !!busy || total < 2}
                    onClick={() => void handleSkip()}
                    title={t("recs.skipTitle")}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    {busy === "skip" ? t("recs.skipping") : t("recs.skip")}
                  </button>
                  <button
                    type="button"
                    disabled={!canModify || !!busy}
                    onClick={() => void handleDelete()}
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/70"
                  >
                    {busy === "delete" ? t("recs.deleting") : t("recs.delete")}
                  </button>
                  <button
                    type="button"
                    disabled={!canModify || !!busy || !selectedOptionId}
                    onClick={() => void handleApprove()}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                  >
                    {busy === "approve" ? t("recs.approving") : t("recs.approveSelected")}
                  </button>
                </div>
              </div>
            </div>
        </section>
      ) : open ? (
        <section
          className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
          style={panelStyle}
        >
          <header className="flex items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800/80">
            <div className="min-w-0 select-none">
              <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t("recs.title")}</p>
              <p className="truncate text-[11px] text-zinc-500">{t("recs.openPanelEmpty")}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              {t("common.close")}
            </button>
          </header>
          <div className="px-4 py-4 text-sm text-zinc-600 dark:text-zinc-300">{t("recs.openPanelEmpty")}</div>
        </section>
      ) : null}
    </>
  );
}
