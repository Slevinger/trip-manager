"use client";

import {
  htmlDateToTripDdMmYyyy,
  normalizeHhMm,
  tripDdMmYyyyToHtmlDate,
} from "@/lib/timeline/dates";
import { useI18n } from "@/components/providers/I18nProvider";
import { useEffect, useRef } from "react";

const inputCls =
  "min-h-9 min-w-0 rounded-xl border border-zinc-200 bg-white px-2 py-2 text-sm text-zinc-900 outline-none disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70 dark:[&::-webkit-calendar-picker-indicator]:invert";

export function TripDateTimeInput({
  date,
  time,
  onDateChange,
  onTimeChange,
  minDate,
  disabled,
  className,
}: {
  date: string;
  time: string;
  onDateChange: (next: string) => void;
  onTimeChange: (next: string) => void;
  minDate?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const timeInputRef = useRef<HTMLInputElement | null>(null);
  const shouldFocusTimeRef = useRef(false);
  const htmlDate = tripDdMmYyyyToHtmlDate(date);
  const htmlMinDate = tripDdMmYyyyToHtmlDate(minDate ?? "");
  const timeValue = normalizeHhMm(time);

  useEffect(() => {
    if (!shouldFocusTimeRef.current) return;
    if (!date || disabled || timeValue) {
      shouldFocusTimeRef.current = false;
      return;
    }
    shouldFocusTimeRef.current = false;
    requestAnimationFrame(() => {
      const input = timeInputRef.current;
      if (!input) return;
      input.focus();
      // Open native picker when supported (Safari/Chrome may restrict this).
      const maybeShowPicker = input as HTMLInputElement & {
        showPicker?: () => void;
      };
      try {
        maybeShowPicker.showPicker?.();
      } catch {
        /* ignore browsers that disallow programmatic picker open */
      }
    });
  }, [date, disabled, timeValue]);

  return (
    <div className={`flex w-full min-w-0 flex-wrap items-center gap-2 ${className ?? ""}`}>
      <input
        type="date"
        disabled={disabled}
        className={`${inputCls} min-w-[11rem] flex-1`}
        aria-label={t("common.date")}
        value={htmlDate}
        min={htmlMinDate || undefined}
        onChange={(e) => {
          const nextDate = htmlDateToTripDdMmYyyy(e.target.value);
          onDateChange(nextDate);
          // After choosing date, move to time only if it's still empty.
          shouldFocusTimeRef.current = Boolean(nextDate) && !disabled && !timeValue;
        }}
      />
      <input
        type="time"
        ref={timeInputRef}
        disabled={disabled}
        className={`${inputCls} w-full min-w-[7rem]`}
        aria-label={t("common.time")}
        value={timeValue}
        onChange={(e) => onTimeChange(normalizeHhMm(e.target.value))}
      />
    </div>
  );
}
