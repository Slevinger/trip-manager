"use client";

import {
  htmlDateToTripDdMmYyyy,
  normalizeHhMm,
  tripDdMmYyyyToHtmlDate,
} from "@/lib/timeline/dates";
import { useI18n } from "@/components/providers/I18nProvider";

const inputCls =
  "min-h-9 min-w-0 rounded-xl border border-zinc-200 bg-white px-2 py-2 text-sm text-zinc-900 outline-none disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70 dark:[&::-webkit-calendar-picker-indicator]:invert";

export function TripDateTimeInput({
  date,
  time,
  onDateChange,
  onTimeChange,
  disabled,
  className,
}: {
  date: string;
  time: string;
  onDateChange: (next: string) => void;
  onTimeChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const htmlDate = tripDdMmYyyyToHtmlDate(date);
  const timeValue = normalizeHhMm(time);

  return (
    <div
      className={`flex w-full min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap ${className ?? ""}`}
    >
      <input
        type="date"
        disabled={disabled}
        className={`${inputCls} min-w-0 flex-1 sm:min-w-[10.5rem]`}
        aria-label={t("common.date")}
        value={htmlDate}
        onChange={(e) => onDateChange(htmlDateToTripDdMmYyyy(e.target.value))}
      />
      <input
        type="time"
        disabled={disabled}
        className={`${inputCls} w-full shrink-0 sm:w-[7.5rem]`}
        aria-label={t("common.time")}
        value={timeValue}
        onChange={(e) => onTimeChange(normalizeHhMm(e.target.value))}
      />
    </div>
  );
}
