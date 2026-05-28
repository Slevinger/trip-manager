"use client";

import { logCaughtException } from "@/lib/logCaughtException";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/* ------------------------------------------------------------------------- */
/* Pure helpers (ISO date strings + ISO instants)                            */
/* ------------------------------------------------------------------------- */

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function todayIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function addDaysIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map((s) => Number(s));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return isoDate;
  const next = new Date(y!, (m ?? 1) - 1, (d ?? 1) + days);
  return `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-${pad2(next.getDate())}`;
}

export function nightsBetween(startIso: string, endIso: string): number {
  if (!startIso || !endIso) return 0;
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

/** Build an ISO instant anchored to local time. Start = 00:00 local; end = 23:59 local. */
export function dateIsoToInstant(isoDate: string, dayEnd: boolean): string {
  if (!isoDate) return new Date().toISOString();
  const [y, m, d] = isoDate.split("-").map((s) => Number(s));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return new Date().toISOString();
  }
  const local = dayEnd
    ? new Date(y!, (m ?? 1) - 1, d ?? 1, 23, 59, 0, 0)
    : new Date(y!, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
  return local.toISOString();
}

/** Pull `{ date: 'YYYY-MM-DD', time: 'HH:mm' }` (local) out of an ISO instant. */
export function splitInstantLocal(iso: string): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  };
}

/** Compose an ISO instant from `'YYYY-MM-DD'` + `'HH:mm'` interpreted as local time. */
export function joinDateTimeLocal(date: string, time: string): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map((s) => Number(s));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return "";
  const [h, mi] = (time || "00:00").split(":").map((s) => Number(s));
  const hh = Number.isFinite(h) ? h! : 0;
  const mm = Number.isFinite(mi) ? mi! : 0;
  return new Date(y!, (m ?? 1) - 1, d ?? 1, hh, mm, 0, 0).toISOString();
}

/**
 * Merge calendar output into persisted ISO fields. Empty string means **cleared** by the
 * picker (e.g. starting a new range clears the end first). Using `nextEnd || prevEnd`
 * incorrectly keeps the old checkout, so both dates stay set and the next day-click looks
 * like “only one date works”.
 */
export function mergeCalendarIsoPair(
  prevStart: string,
  prevEnd: string,
  nextStart: string,
  nextEnd: string
): { startIso: string; endIso: string } {
  return {
    startIso: nextStart === "" ? "" : nextStart || prevStart,
    endIso: nextEnd === "" ? "" : nextEnd || prevEnd,
  };
}

export function formatPrettyDate(isoDate: string, intlLocale: string): string {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-").map((s) => Number(s));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return "";
  const date = new Date(y!, (m ?? 1) - 1, d ?? 1);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(intlLocale, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  } catch (e) {
    logCaughtException(e, "DateRangeCalendar/formatPrettyDate/intlFallback", { intlLocale });
    return date.toDateString();
  }
}

export function formatPrettyDateTime(iso: string, intlLocale: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(intlLocale, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch (e) {
    logCaughtException(e, "DateRangeCalendar/formatPrettyDateTime/intlFallback", { intlLocale });
    return date.toLocaleString();
  }
}

/* ------------------------------------------------------------------------- */
/* Date-only range picker (drives a YYYY-MM-DD start/end pair).              */
/* ------------------------------------------------------------------------- */

type CalendarDay = {
  iso: string;
  year: number;
  month: number;
  day: number;
  inCurrentMonth: boolean;
  isToday: boolean;
};

export type DateRangeCalendarProps = {
  startDate: string;
  endDate: string;
  onChange: (start: string, end: string) => void;
  intlLocale: string;
  /** 2 = side-by-side months on desktop (default), 1 = single month always. */
  monthsToShow?: 1 | 2;
  /** Render as a folded summary that expands on click; auto-folds once a range is picked. */
  collapsible?: boolean;
  /** Shown in the folded summary when no dates are set. */
  emptyLabel?: string;
};

export function DateRangeCalendar({
  startDate,
  endDate,
  onChange,
  intlLocale,
  monthsToShow = 2,
  collapsible = false,
  emptyLabel = "Pick dates",
}: DateRangeCalendarProps) {
  const today = useMemo(() => todayIsoDate(), []);
  const initialAnchor = useMemo(() => {
    const seedIso = startDate || today;
    const parsed = parseIsoDate(seedIso);
    return parsed ?? parseIsoDate(today)!;
  }, [startDate, today]);

  const [anchor, setAnchor] = useState<{ year: number; month: number }>({
    year: initialAnchor.year,
    month: initialAnchor.month,
  });
  const [hoverIso, setHoverIso] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<boolean>(!collapsible);

  const goPrev = useCallback(
    () => setAnchor((a) => addMonths(a.year, a.month, -1)),
    []
  );
  const goNext = useCallback(
    () => setAnchor((a) => addMonths(a.year, a.month, 1)),
    []
  );

  const weekdayLabels = useMemo(() => buildWeekdayLabels(intlLocale), [intlLocale]);

  const previewEnd = useMemo(() => {
    if (!startDate || endDate) return null;
    if (!hoverIso || hoverIso < startDate) return null;
    return hoverIso;
  }, [startDate, endDate, hoverIso]);

  const effectiveStart = startDate || null;
  const effectiveEnd = endDate || previewEnd;

  function isInRange(iso: string): boolean {
    if (!effectiveStart || !effectiveEnd) return false;
    return iso >= effectiveStart && iso <= effectiveEnd;
  }

  function handleDayPick(iso: string) {
    if (!startDate || (startDate && endDate)) {
      onChange(iso, "");
      return;
    }
    if (iso < startDate) {
      onChange(iso, "");
      return;
    }
    onChange(startDate, iso);
    /** Range completed — collapse back to summary so the picker stays out of the way. */
    if (collapsible) setExpanded(false);
  }

  const calendar = (
    <div
      dir="ltr"
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <CalendarNavButton onClick={goPrev} dir="prev" />
        <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {formatMonthHeader(anchor.year, anchor.month, intlLocale)}
        </p>
        <CalendarNavButton onClick={goNext} dir="next" />
      </div>

      <div
        className={
          monthsToShow === 2
            ? "grid grid-cols-1 gap-px bg-zinc-100 dark:bg-zinc-800 md:grid-cols-2"
            : "grid grid-cols-1 gap-px bg-zinc-100 dark:bg-zinc-800"
        }
      >
        <MonthGrid
          year={anchor.year}
          month={anchor.month}
          weekdayLabels={weekdayLabels}
          today={today}
          startDate={effectiveStart}
          endDate={endDate || null}
          previewEnd={previewEnd}
          onDayPick={handleDayPick}
          onDayHover={setHoverIso}
          isInRange={isInRange}
        />
        {monthsToShow === 2 ? (
          <MonthGrid
            year={addMonths(anchor.year, anchor.month, 1).year}
            month={addMonths(anchor.year, anchor.month, 1).month}
            weekdayLabels={weekdayLabels}
            today={today}
            startDate={effectiveStart}
            endDate={endDate || null}
            previewEnd={previewEnd}
            onDayPick={handleDayPick}
            onDayHover={setHoverIso}
            isInRange={isInRange}
            hideOnMobile
          />
        ) : null}
      </div>
    </div>
  );

  if (!collapsible) return calendar;

  return (
    <CollapsibleRangeShell
      expanded={expanded}
      onToggle={() => setExpanded((p) => !p)}
      summary={
        <DateRangeSummary
          startDate={startDate}
          endDate={endDate}
          intlLocale={intlLocale}
          emptyLabel={emptyLabel}
        />
      }
    >
      {calendar}
    </CollapsibleRangeShell>
  );
}

function CalendarNavButton({
  onClick,
  dir,
}: {
  onClick: () => void;
  dir: "prev" | "next";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full p-2 text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 active:scale-95 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      aria-label={dir === "prev" ? "Previous month" : "Next month"}
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
        {dir === "prev" ? <path d="m15 18-6-6 6-6" /> : <path d="m9 6 6 6-6 6" />}
      </svg>
    </button>
  );
}

function MonthGrid({
  year,
  month,
  weekdayLabels,
  today,
  startDate,
  endDate,
  previewEnd,
  onDayPick,
  onDayHover,
  isInRange,
  hideOnMobile,
}: {
  year: number;
  month: number;
  weekdayLabels: string[];
  today: string;
  startDate: string | null;
  endDate: string | null;
  previewEnd: string | null;
  onDayPick: (iso: string) => void;
  onDayHover: (iso: string | null) => void;
  isInRange: (iso: string) => boolean;
  hideOnMobile?: boolean;
}) {
  const days = useMemo(() => buildMonthGridDays(year, month, today), [year, month, today]);

  return (
    <div
      className={
        "bg-white px-3 pb-4 pt-1 dark:bg-zinc-900 " +
        (hideOnMobile ? "hidden md:block" : "")
      }
    >
      <div className="grid grid-cols-7 gap-1 pb-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {weekdayLabels.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1" onMouseLeave={() => onDayHover(null)}>
        {days.map((d) => (
          <CalendarDayCell
            key={d.iso}
            day={d}
            startDate={startDate}
            endDate={endDate}
            previewEnd={previewEnd}
            inRange={isInRange(d.iso)}
            onPick={onDayPick}
            onHover={onDayHover}
          />
        ))}
      </div>
    </div>
  );
}

function CalendarDayCell({
  day,
  startDate,
  endDate,
  previewEnd,
  inRange,
  onPick,
  onHover,
}: {
  day: CalendarDay;
  startDate: string | null;
  endDate: string | null;
  previewEnd: string | null;
  inRange: boolean;
  onPick: (iso: string) => void;
  onHover: (iso: string | null) => void;
}) {
  const isStart = startDate === day.iso;
  const effectiveEnd = endDate ?? previewEnd;
  const isEnd = effectiveEnd === day.iso && effectiveEnd !== startDate;
  const isEdge = isStart || isEnd;
  const isPreviewEnd = !endDate && previewEnd === day.iso && previewEnd !== startDate;

  let rangeClass = "";
  if (inRange && !isEdge) {
    rangeClass = previewEnd && !endDate
      ? "bg-violet-100/70 text-violet-800 dark:bg-violet-900/30 dark:text-violet-200"
      : "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200";
  }

  const baseClass =
    "relative flex h-11 items-center justify-center rounded-xl text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900";

  let stateClass: string;
  if (isEdge) {
    stateClass =
      "bg-violet-600 text-white shadow-md shadow-violet-600/30 hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400";
  } else if (rangeClass) {
    stateClass = rangeClass + " hover:bg-violet-200/70 dark:hover:bg-violet-900/60";
  } else if (!day.inCurrentMonth) {
    stateClass =
      "text-zinc-300 hover:bg-zinc-50 dark:text-zinc-600 dark:hover:bg-zinc-800";
  } else {
    stateClass =
      "text-zinc-700 hover:bg-violet-50 hover:text-violet-700 dark:text-zinc-200 dark:hover:bg-violet-950/40 dark:hover:text-violet-200";
  }

  const previewDashClass = isPreviewEnd
    ? "ring-2 ring-violet-500 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900"
    : "";

  const todayMarkerClass =
    day.isToday && !isEdge
      ? "after:absolute after:bottom-1 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-violet-500"
      : "";

  return (
    <button
      type="button"
      onClick={() => onPick(day.iso)}
      onMouseEnter={() => onHover(day.iso)}
      onFocus={() => onHover(day.iso)}
      aria-pressed={isEdge}
      className={`${baseClass} ${stateClass} ${previewDashClass} ${todayMarkerClass}`}
    >
      {day.day}
    </button>
  );
}

function parseIsoDate(iso: string): { year: number; month: number; day: number } | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map((s) => Number(s));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return { year: y!, month: (m ?? 1) - 1, day: d ?? 1 };
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

function buildMonthGridDays(year: number, month: number, today: string): CalendarDay[] {
  const firstOfMonth = new Date(year, month, 1);
  const totalDays = new Date(year, month + 1, 0).getDate();
  const dow = firstOfMonth.getDay();
  const leadingBlanks = (dow + 6) % 7;

  const prev = addMonths(year, month, -1);
  const prevDays = new Date(prev.year, prev.month + 1, 0).getDate();

  const days: CalendarDay[] = [];

  for (let i = leadingBlanks - 1; i >= 0; i--) {
    const dayNum = prevDays - i;
    const iso = formatIsoDate(prev.year, prev.month, dayNum);
    days.push({
      iso,
      year: prev.year,
      month: prev.month,
      day: dayNum,
      inCurrentMonth: false,
      isToday: iso === today,
    });
  }

  for (let d = 1; d <= totalDays; d++) {
    const iso = formatIsoDate(year, month, d);
    days.push({
      iso,
      year,
      month,
      day: d,
      inCurrentMonth: true,
      isToday: iso === today,
    });
  }

  const next = addMonths(year, month, 1);
  let trailing = 1;
  while (days.length < 42) {
    const iso = formatIsoDate(next.year, next.month, trailing);
    days.push({
      iso,
      year: next.year,
      month: next.month,
      day: trailing,
      inCurrentMonth: false,
      isToday: iso === today,
    });
    trailing++;
  }

  return days;
}

function formatMonthHeader(year: number, month: number, intlLocale: string): string {
  try {
    return new Intl.DateTimeFormat(intlLocale, {
      month: "long",
      year: "numeric",
    }).format(new Date(year, month, 1));
  } catch (e) {
    logCaughtException(e, "DateRangeCalendar/formatMonthHeader/intlFallback", { intlLocale });
    return `${year}-${pad2(month + 1)}`;
  }
}

function buildWeekdayLabels(intlLocale: string): string[] {
  const labels: string[] = [];
  try {
    const fmt = new Intl.DateTimeFormat(intlLocale, { weekday: "short" });
    for (let i = 0; i < 7; i++) {
      labels.push(fmt.format(new Date(2024, 0, 1 + i)));
    }
  } catch (e) {
    logCaughtException(e, "DateRangeCalendar/buildWeekdayLabels/intlFallback", { intlLocale });
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  }
  return labels;
}

/* ------------------------------------------------------------------------- */
/* Datetime range picker — calendar + paired time inputs (start, end).       */
/* ------------------------------------------------------------------------- */

export type DateTimeRangeCalendarProps = {
  /** ISO instants. Empty string allowed and treated as "not set". */
  startIso: string;
  endIso: string;
  onChange: (startIso: string, endIso: string) => void;
  intlLocale: string;
  monthsToShow?: 1 | 2;
  startLabel?: string;
  endLabel?: string;
  /** Default times applied when first picking a date if none set yet. */
  defaultStartTime?: string;
  defaultEndTime?: string;
  /** Render as a folded summary that expands on click; auto-folds once a range is picked. */
  collapsible?: boolean;
  /** Shown in the folded summary when no dates are set. */
  emptyLabel?: string;
};

/**
 * Clear, high-contrast styling for the time inputs. Important: in dark mode we
 * intentionally use `zinc-700` borders + `zinc-800` background so the inputs
 * don't blend into the surrounding page (which is often near-black). Without
 * this they were rendering invisibly on dark themes.
 */
const TIME_INPUT_CLASS =
  "w-full rounded-xl border-2 border-zinc-300 bg-white px-3 py-2.5 text-base font-semibold tabular-nums text-zinc-900 shadow-sm transition focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50";

export function DateTimeRangeCalendar({
  startIso,
  endIso,
  onChange,
  intlLocale,
  monthsToShow = 2,
  startLabel = "Start time",
  endLabel = "End time",
  /** Sensible "all-day" defaults when the caller hasn't picked a time yet: morning to evening. */
  defaultStartTime = "08:00",
  defaultEndTime = "20:00",
  collapsible = false,
  emptyLabel = "Pick dates",
}: DateTimeRangeCalendarProps) {
  const startReactId = useId();
  const endReactId = useId();

  const start = splitInstantLocal(startIso);
  const end = splitInstantLocal(endIso);

  const [expanded, setExpanded] = useState<boolean>(!collapsible);

  /**
   * Apply a date pick: cycle through (start) → (end) → (restart) like the date-only picker.
   *
   * Time-of-day handling: preserve whatever the user already had in the time
   * inputs, falling back to {@link defaultStartTime} / {@link defaultEndTime}
   * only when the slot is empty. Since the time picker is visible right next
   * to the calendar, users adjust hours there explicitly — date clicks should
   * never silently overwrite their typed times.
   */
  function handleDayPick(date: string) {
    const startDate = start.date;
    const endDate = end.date;

    if (!startDate || (startDate && endDate)) {
      const t = start.time || defaultStartTime;
      onChange(joinDateTimeLocal(date, t), "");
      return;
    }
    if (date < startDate) {
      const t = start.time || defaultStartTime;
      onChange(joinDateTimeLocal(date, t), "");
      return;
    }
    const sIso = startIso || joinDateTimeLocal(startDate, start.time || defaultStartTime);
    const eIso = joinDateTimeLocal(date, end.time || defaultEndTime);
    onChange(sIso, eIso);
    /** Range completed — collapse back to summary (time inputs will hide too). */
    if (collapsible) setExpanded(false);
  }

  function handleStartTimeChange(time: string) {
    if (!start.date) return;
    onChange(joinDateTimeLocal(start.date, time), endIso);
  }

  function handleEndTimeChange(time: string) {
    if (!end.date) return;
    onChange(startIso, joinDateTimeLocal(end.date, time));
  }

  const startDateText = start.date
    ? formatPrettyDate(start.date, intlLocale)
    : emptyLabel;
  const endDateText = end.date
    ? formatPrettyDate(end.date, intlLocale)
    : emptyLabel;

  const body = (
    <div className="space-y-3">
      <DateRangeCalendarForDateTime
        startDate={start.date}
        endDate={end.date}
        onDayPick={handleDayPick}
        intlLocale={intlLocale}
        monthsToShow={monthsToShow}
      />

      <div className="rounded-2xl border-2 border-violet-300/60 bg-violet-50/60 p-3 dark:border-violet-500/40 dark:bg-violet-950/30">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
          <ClockIcon />
          <span>{startLabel} / {endLabel}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-200">
              {startLabel}
              <span className="block pt-0.5 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                {startDateText}
              </span>
            </span>
            <input
              id={startReactId}
              type="time"
              className={TIME_INPUT_CLASS}
              value={start.time}
              disabled={!start.date}
              onChange={(e) => handleStartTimeChange(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-200">
              {endLabel}
              <span className="block pt-0.5 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                {endDateText}
              </span>
            </span>
            <input
              id={endReactId}
              type="time"
              className={TIME_INPUT_CLASS}
              value={end.time}
              disabled={!end.date}
              onChange={(e) => handleEndTimeChange(e.target.value)}
            />
          </label>
        </div>
      </div>
    </div>
  );

  if (!collapsible) return body;

  return (
    <CollapsibleRangeShell
      expanded={expanded}
      onToggle={() => setExpanded((p) => !p)}
      summary={
        <DateTimeRangeSummary
          startIso={startIso}
          endIso={endIso}
          intlLocale={intlLocale}
          emptyLabel={emptyLabel}
        />
      }
    >
      {body}
    </CollapsibleRangeShell>
  );
}

/**
 * Internal: re-implements DateRangeCalendar but exposes raw `onDayPick(iso)` so
 * `DateTimeRangeCalendar` can merge day picks with the existing time-of-day to
 * produce ISO instants (rather than re-deriving instants from the YYYY-MM-DD
 * pair we hand to DateRangeCalendar).
 */
function DateRangeCalendarForDateTime({
  startDate,
  endDate,
  onDayPick,
  intlLocale,
  monthsToShow,
}: {
  startDate: string;
  endDate: string;
  onDayPick: (iso: string) => void;
  intlLocale: string;
  monthsToShow: 1 | 2;
}) {
  const today = useMemo(() => todayIsoDate(), []);
  const initialAnchor = useMemo(() => {
    const seedIso = startDate || today;
    const parsed = parseIsoDate(seedIso);
    return parsed ?? parseIsoDate(today)!;
  }, [startDate, today]);

  const [anchor, setAnchor] = useState<{ year: number; month: number }>({
    year: initialAnchor.year,
    month: initialAnchor.month,
  });
  const [hoverIso, setHoverIso] = useState<string | null>(null);

  const goPrev = useCallback(
    () => setAnchor((a) => addMonths(a.year, a.month, -1)),
    []
  );
  const goNext = useCallback(
    () => setAnchor((a) => addMonths(a.year, a.month, 1)),
    []
  );

  const weekdayLabels = useMemo(() => buildWeekdayLabels(intlLocale), [intlLocale]);

  const previewEnd = useMemo(() => {
    if (!startDate || endDate) return null;
    if (!hoverIso || hoverIso < startDate) return null;
    return hoverIso;
  }, [startDate, endDate, hoverIso]);

  const effectiveStart = startDate || null;
  const effectiveEnd = endDate || previewEnd;

  function isInRange(iso: string): boolean {
    if (!effectiveStart || !effectiveEnd) return false;
    return iso >= effectiveStart && iso <= effectiveEnd;
  }

  return (
    <div
      dir="ltr"
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <CalendarNavButton onClick={goPrev} dir="prev" />
        <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {formatMonthHeader(anchor.year, anchor.month, intlLocale)}
        </p>
        <CalendarNavButton onClick={goNext} dir="next" />
      </div>

      <div
        className={
          monthsToShow === 2
            ? "grid grid-cols-1 gap-px bg-zinc-100 dark:bg-zinc-800 md:grid-cols-2"
            : "grid grid-cols-1 gap-px bg-zinc-100 dark:bg-zinc-800"
        }
      >
        <MonthGrid
          year={anchor.year}
          month={anchor.month}
          weekdayLabels={weekdayLabels}
          today={today}
          startDate={effectiveStart}
          endDate={endDate || null}
          previewEnd={previewEnd}
          onDayPick={onDayPick}
          onDayHover={setHoverIso}
          isInRange={isInRange}
        />
        {monthsToShow === 2 ? (
          <MonthGrid
            year={addMonths(anchor.year, anchor.month, 1).year}
            month={addMonths(anchor.year, anchor.month, 1).month}
            weekdayLabels={weekdayLabels}
            today={today}
            startDate={effectiveStart}
            endDate={endDate || null}
            previewEnd={previewEnd}
            onDayPick={onDayPick}
            onDayHover={setHoverIso}
            isInRange={isInRange}
            hideOnMobile
          />
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Start time + duration picker — for transit legs.                          */
/* ------------------------------------------------------------------------- */

export type StartTimeAndDurationProps = {
  startIso: string;
  endIso: string;
  onChange: (startIso: string, endIso: string) => void;
  intlLocale: string;
  startLabel?: string;
  durationLabel?: string;
};

export function StartTimeAndDuration({
  startIso,
  endIso,
  onChange,
  intlLocale,
  startLabel = "Departs",
  durationLabel = "Duration",
}: StartTimeAndDurationProps) {
  const startReactId = useId();
  const start = splitInstantLocal(startIso);

  /** Duration in whole minutes, derived from start/end. Defaults to 60min when missing. */
  const totalMinutes = useMemo(() => {
    if (!startIso || !endIso) return 60;
    const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
    if (!Number.isFinite(ms) || ms <= 0) return 60;
    return Math.max(0, Math.round(ms / 60000));
  }, [startIso, endIso]);

  const [hours, setHours] = useState<number>(Math.floor(totalMinutes / 60));
  const [minutes, setMinutes] = useState<number>(totalMinutes % 60);

  /** Resync local duration controls when external ISO pair changes (e.g. AI assistant edits). */
  useEffect(() => {
    setHours(Math.floor(totalMinutes / 60));
    setMinutes(totalMinutes % 60);
  }, [totalMinutes]);

  function emit(nextStartIso: string, nextHours: number, nextMinutes: number) {
    if (!nextStartIso) {
      onChange("", "");
      return;
    }
    const totalMin = Math.max(0, nextHours * 60 + nextMinutes);
    const endMs = new Date(nextStartIso).getTime() + totalMin * 60_000;
    onChange(nextStartIso, new Date(endMs).toISOString());
  }

  function handleStartChange(localValue: string) {
    if (!localValue) {
      onChange("", "");
      return;
    }
    const nextStart = new Date(localValue).toISOString();
    emit(nextStart, hours, minutes);
  }

  function handleHoursChange(v: number) {
    const safe = Math.max(0, Math.min(99, Number.isFinite(v) ? v : 0));
    setHours(safe);
    emit(startIso, safe, minutes);
  }

  function handleMinutesChange(v: number) {
    const safe = Math.max(0, Math.min(59, Number.isFinite(v) ? v : 0));
    setMinutes(safe);
    emit(startIso, hours, safe);
  }

  const startLocalValue = start.date && start.time ? `${start.date}T${start.time}` : "";
  const arrivalLabel = useMemo(() => {
    if (!startIso) return "";
    const totalMin = hours * 60 + minutes;
    const endMs = new Date(startIso).getTime() + totalMin * 60_000;
    return formatPrettyDateTime(new Date(endMs).toISOString(), intlLocale);
  }, [startIso, hours, minutes, intlLocale]);

  return (
    <div className="space-y-3">
      <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300">
        <span className="block pb-1">{startLabel}</span>
        <input
          id={startReactId}
          type="datetime-local"
          className={TIME_INPUT_CLASS}
          value={startLocalValue}
          onChange={(e) => handleStartChange(e.target.value)}
        />
      </label>

      <div>
        <p className="pb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
          {durationLabel}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={99}
              value={hours}
              onChange={(e) => handleHoursChange(Number(e.target.value))}
              className={TIME_INPUT_CLASS + " text-center"}
              aria-label="Hours"
            />
            <span className="mt-1 block text-center text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              hours
            </span>
          </label>
          <label className="block">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={59}
              value={minutes}
              onChange={(e) => handleMinutesChange(Number(e.target.value))}
              className={TIME_INPUT_CLASS + " text-center"}
              aria-label="Minutes"
            />
            <span className="mt-1 block text-center text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              minutes
            </span>
          </label>
        </div>
      </div>

      {arrivalLabel ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Arrives <span className="font-semibold text-zinc-700 dark:text-zinc-200">{arrivalLabel}</span>
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Collapsible shell — renders the picker as an expandable summary chip.     */
/* ------------------------------------------------------------------------- */

function CollapsibleRangeShell({
  expanded,
  onToggle,
  summary,
  children,
}: {
  expanded: boolean;
  onToggle: () => void;
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="group flex w-full items-center justify-between gap-3 rounded-2xl border-2 border-zinc-200 bg-white px-4 py-3 text-start text-sm font-medium text-zinc-900 transition hover:border-violet-400 hover:bg-violet-50/40 focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-500/15 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:border-violet-400/60 dark:hover:bg-violet-950/30"
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <CalendarIcon />
          <span className="min-w-0 flex-1 truncate">{summary}</span>
        </span>
        <ChevronToggleIcon expanded={expanded} />
      </button>

      {expanded ? (
        <div className="wizard-slide-in-forward">{children}</div>
      ) : null}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg
      className="h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function ChevronToggleIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={
        "h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-200 group-hover:text-zinc-900 dark:text-zinc-400 dark:group-hover:text-zinc-100 " +
        (expanded ? "rotate-180" : "")
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function DateRangeSummary({
  startDate,
  endDate,
  intlLocale,
  emptyLabel,
}: {
  startDate: string;
  endDate: string;
  intlLocale: string;
  emptyLabel: string;
}) {
  if (!startDate && !endDate) {
    return <span className="text-zinc-500 dark:text-zinc-400">{emptyLabel}</span>;
  }
  const s = formatPrettyDate(startDate, intlLocale) || "—";
  const e = formatPrettyDate(endDate, intlLocale) || "—";
  return (
    <span className="block truncate">
      <span className="text-zinc-900 dark:text-zinc-50">{s}</span>
      <span className="px-2 text-zinc-400 dark:text-zinc-500">→</span>
      <span className="text-zinc-900 dark:text-zinc-50">{e}</span>
    </span>
  );
}

function DateTimeRangeSummary({
  startIso,
  endIso,
  intlLocale,
  emptyLabel,
}: {
  startIso: string;
  endIso: string;
  intlLocale: string;
  emptyLabel: string;
}) {
  if (!startIso && !endIso) {
    return <span className="text-zinc-500 dark:text-zinc-400">{emptyLabel}</span>;
  }
  const s = startIso ? formatPrettyDateTime(startIso, intlLocale) : "—";
  const e = endIso ? formatPrettyDateTime(endIso, intlLocale) : "—";
  return (
    <span className="block truncate">
      <span className="text-zinc-900 dark:text-zinc-50">{s}</span>
      <span className="px-2 text-zinc-400 dark:text-zinc-500">→</span>
      <span className="text-zinc-900 dark:text-zinc-50">{e}</span>
    </span>
  );
}
