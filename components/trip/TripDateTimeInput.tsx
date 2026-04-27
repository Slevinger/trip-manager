"use client";

import { normalizeHhMm, normalizeTripDateInput } from "@/lib/timeline/dates";
import { useI18n } from "@/components/providers/I18nProvider";

const inputCls =
  "min-h-9 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500";

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

  return (
    <div className={`flex w-full min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap ${className ?? ""}`}>
      <input
        type="text"
        disabled={disabled}
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        className={`${inputCls} min-w-[10.5rem]`}
        aria-label={t("common.date")}
        placeholder="dd-mm-yyyy"
        value={date}
        onChange={(e) => onDateChange(e.target.value)}
        onBlur={(e) => {
          const n = normalizeTripDateInput(e.target.value);
          if (n !== e.target.value) onDateChange(n);
        }}
      />
      <input
        type="text"
        disabled={disabled}
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        className={`${inputCls} w-[6.5rem] shrink-0 sm:w-[7rem]`}
        aria-label={t("common.time")}
        placeholder="HH:mm"
        value={time}
        onChange={(e) => onTimeChange(e.target.value)}
        onBlur={(e) => {
          const n = normalizeHhMm(e.target.value);
          if (n !== e.target.value) onTimeChange(n);
        }}
      />
    </div>
  );
}
