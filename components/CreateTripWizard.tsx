"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useI18n } from "@/lib/i18n/context";
import { intlLocaleForApp, type MessageKey } from "@/lib/i18n/messages";
import { createNewTrip } from "@/lib/tripLocalStore";
import type { CurrencyCode, Trip } from "@/lib/types/trip";
import {
  DateRangeCalendar,
  addDaysIsoDate,
  dateIsoToInstant,
  formatPrettyDate,
  nightsBetween,
  todayIsoDate,
} from "@/components/dateRange/DateRangeCalendar";

const WIZARD_STEPS = ["basics", "dates", "currency", "review"] as const;
type WizardStepId = (typeof WIZARD_STEPS)[number];

type PopularCurrency = {
  code: CurrencyCode;
  labelKey: MessageKey | null;
  fallbackLabel: string;
  symbol: string;
  flag: string;
};

const POPULAR_CURRENCIES: PopularCurrency[] = [
  { code: "USD", labelKey: null, fallbackLabel: "US Dollar", symbol: "$", flag: "🇺🇸" },
  { code: "EUR", labelKey: null, fallbackLabel: "Euro", symbol: "€", flag: "🇪🇺" },
  { code: "GBP", labelKey: null, fallbackLabel: "British Pound", symbol: "£", flag: "🇬🇧" },
  { code: "ILS", labelKey: null, fallbackLabel: "Israeli Shekel", symbol: "₪", flag: "🇮🇱" },
  { code: "THB", labelKey: null, fallbackLabel: "Thai Baht", symbol: "฿", flag: "🇹🇭" },
  { code: "JPY", labelKey: null, fallbackLabel: "Japanese Yen", symbol: "¥", flag: "🇯🇵" },
];

type CreateTripWizardProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (trip: Trip) => void | Promise<void>;
};

export function CreateTripWizard({ open, onClose, onCreate }: CreateTripWizardProps) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const intlLocale = intlLocaleForApp(locale);

  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");

  const [tripTitle, setTripTitle] = useState("");
  const [tripDescription, setTripDescription] = useState("");
  const [startDate, setStartDate] = useState(todayIsoDate());
  const [endDate, setEndDate] = useState(addDaysIsoDate(todayIsoDate(), 7));
  const [currencyCode, setCurrencyCode] = useState<string>("USD");
  const [customCurrencyMode, setCustomCurrencyMode] = useState(false);
  const [customCurrency, setCustomCurrency] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);

  const currentStepId = WIZARD_STEPS[stepIndex] ?? "basics";

  const resolvedCurrency: CurrencyCode = useMemo(() => {
    if (customCurrencyMode) {
      const trimmed = customCurrency.trim().toUpperCase();
      return trimmed.length > 0 ? trimmed : "USD";
    }
    return currencyCode || "USD";
  }, [currencyCode, customCurrency, customCurrencyMode]);

  const trimmedTitle = tripTitle.trim();
  const trimmedDescription = tripDescription.trim();
  const nights = nightsBetween(startDate, endDate);
  const datesValid = Boolean(startDate && endDate) && nights >= 0;

  const canContinue = useMemo(() => {
    if (currentStepId === "basics") return trimmedTitle.length > 0;
    if (currentStepId === "dates") return datesValid;
    if (currentStepId === "currency") {
      if (customCurrencyMode) return customCurrency.trim().length > 0;
      return Boolean(currencyCode);
    }
    return true;
  }, [currentStepId, trimmedTitle, datesValid, customCurrencyMode, customCurrency, currencyCode]);

  const resetState = useCallback(() => {
    setStepIndex(0);
    setDirection("forward");
    setTripTitle("");
    setTripDescription("");
    const today = todayIsoDate();
    setStartDate(today);
    setEndDate(addDaysIsoDate(today, 7));
    setCurrencyCode("USD");
    setCustomCurrencyMode(false);
    setCustomCurrency("");
    setSubmitting(false);
    setSubmitError(null);
  }, []);

  useEffect(() => {
    if (open) {
      resetState();
    }
  }, [open, resetState]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      if (currentStepId === "basics") titleInputRef.current?.focus();
    }, 80);
    return () => window.clearTimeout(id);
  }, [currentStepId, open]);

  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  const stepIndexRef = useRef(stepIndex);
  stepIndexRef.current = stepIndex;

  const goNext = useCallback(() => {
    if (!canContinue) return;
    setDirection("forward");
    setStepIndex((i) => Math.min(i + 1, WIZARD_STEPS.length - 1));
  }, [canContinue]);

  const goBack = useCallback(() => {
    setDirection("back");
    setStepIndex((i) => Math.max(i - 1, 0));
  }, []);

  const goToStep = useCallback((target: WizardStepId) => {
    const idx = WIZARD_STEPS.indexOf(target);
    if (idx < 0) return;
    setDirection(idx > stepIndexRef.current ? "forward" : "back");
    setStepIndex(idx);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const base = createNewTrip();
      const trip: Trip = {
        ...base,
        title: trimmedTitle || base.title,
        description: trimmedDescription,
        currency: resolvedCurrency,
        startDate: dateIsoToInstant(startDate, false),
        endDate: dateIsoToInstant(endDate, true),
      };
      await onCreate(trip);
    } catch (e) {
      setSubmitting(false);
      setSubmitError(e instanceof Error ? e.message : String(e));
    }
  }, [
    submitting,
    trimmedTitle,
    trimmedDescription,
    resolvedCurrency,
    startDate,
    endDate,
    onCreate,
  ]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!open) return null;

  const totalSteps = WIZARD_STEPS.length;
  const stepNumber = stepIndex + 1;
  const animationClass =
    direction === "forward" ? "wizard-slide-in-forward" : "wizard-slide-in-back";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[80] flex items-stretch justify-center overflow-y-auto bg-zinc-900/70 backdrop-blur-sm wizard-overlay-in sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex min-h-full w-full max-w-2xl flex-col bg-white shadow-2xl ring-1 ring-zinc-200/60 wizard-pop-in dark:bg-zinc-950 dark:ring-zinc-800/60 sm:my-auto sm:min-h-0 sm:rounded-3xl">
        <header className="sticky top-0 z-10 flex shrink-0 flex-col gap-3 border-b border-zinc-100 bg-white/85 px-6 pb-4 pt-5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                {t("newTrip.stepOf", { current: stepNumber, total: totalSteps })}
              </p>
              <h2
                id={titleId}
                className="mt-0.5 truncate text-base font-semibold text-zinc-900 dark:text-zinc-50"
              >
                {t("newTrip.title")}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
              aria-label={t("common.close")}
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
                <path d="M6 6 18 18" />
                <path d="M18 6 6 18" />
              </svg>
            </button>
          </div>

          <ProgressDots current={stepIndex} total={totalSteps} />
        </header>

        <div className="flex-1 overflow-visible px-6 pb-6 pt-6 sm:pt-8">
          <div key={currentStepId} className={animationClass}>
            {currentStepId === "basics" ? (
              <BasicsStep
                title={tripTitle}
                onTitleChange={setTripTitle}
                description={tripDescription}
                onDescriptionChange={setTripDescription}
                titleInputRef={titleInputRef}
                onSubmitShortcut={() => {
                  if (canContinue) goNext();
                }}
              />
            ) : null}

            {currentStepId === "dates" ? (
              <DatesStep
                startDate={startDate}
                endDate={endDate}
                onRangeChange={(s, e) => {
                  setStartDate(s);
                  setEndDate(e);
                }}
                onApplyPresetDays={(days) => {
                  const today = todayIsoDate();
                  setStartDate(today);
                  setEndDate(addDaysIsoDate(today, days));
                }}
                intlLocale={intlLocale}
              />
            ) : null}

            {currentStepId === "currency" ? (
              <CurrencyStep
                currencyCode={currencyCode}
                onPickCurrency={(code) => {
                  setCurrencyCode(code);
                  setCustomCurrencyMode(false);
                }}
                customCurrencyMode={customCurrencyMode}
                onActivateCustom={() => setCustomCurrencyMode(true)}
                customCurrency={customCurrency}
                onCustomCurrencyChange={setCustomCurrency}
              />
            ) : null}

            {currentStepId === "review" ? (
              <ReviewStep
                title={trimmedTitle}
                description={trimmedDescription}
                startDate={startDate}
                endDate={endDate}
                currency={resolvedCurrency}
                intlLocale={intlLocale}
                onEditStep={goToStep}
              />
            ) : null}
          </div>

          {submitError ? (
            <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              {submitError}
            </p>
          ) : null}
        </div>

        <footer className="sticky bottom-0 z-10 flex shrink-0 items-center justify-between gap-3 border-t border-zinc-100 bg-white/90 px-6 py-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
          <button
            type="button"
            onClick={stepIndex === 0 ? onClose : goBack}
            className="rounded-2xl px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {stepIndex === 0 ? t("newTrip.cancel") : t("newTrip.back")}
          </button>
          {currentStepId === "review" ? (
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting}
              className="group inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/20 transition hover:bg-violet-700 hover:shadow-xl hover:shadow-violet-600/30 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
            >
              {submitting ? t("newTrip.creating") : t("newTrip.create")}
              {!submitting ? (
                <svg
                  className="h-4 w-4 transition group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M5 12h14" />
                  <path d="m13 5 7 7-7 7" />
                </svg>
              ) : null}
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              disabled={!canContinue}
              className="group inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-zinc-900/10 transition hover:bg-zinc-800 hover:shadow-xl active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
            >
              {t("newTrip.continue")}
              <svg
                className="h-4 w-4 transition group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M5 12h14" />
                <path d="m13 5 7 7-7 7" />
              </svg>
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      {Array.from({ length: total }, (_, i) => {
        const state = i < current ? "done" : i === current ? "active" : "todo";
        return (
          <span
            key={i}
            className={
              "h-1.5 flex-1 rounded-full transition-all duration-500 " +
              (state === "done"
                ? "bg-violet-500"
                : state === "active"
                  ? "bg-violet-500 wizard-progress-pulse"
                  : "bg-zinc-200 dark:bg-zinc-800")
            }
          />
        );
      })}
    </div>
  );
}

function StepHeading({ heading, sub }: { heading: string; sub: string }) {
  return (
    <div>
      <h3 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
        {heading}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400 sm:text-base">
        {sub}
      </p>
    </div>
  );
}

function BasicsStep({
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  titleInputRef,
  onSubmitShortcut,
}: {
  title: string;
  onTitleChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
  onSubmitShortcut: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-7">
      <StepHeading
        heading={t("newTrip.basics.heading")}
        sub={t("newTrip.basics.subheading")}
      />

      <div className="space-y-2">
        <label
          htmlFor="newtrip-title"
          className="block text-sm font-semibold text-zinc-800 dark:text-zinc-100"
        >
          {t("newTrip.basics.titleLabel")}
        </label>
        <input
          id="newtrip-title"
          ref={titleInputRef}
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmitShortcut();
            }
          }}
          placeholder={t("newTrip.basics.titlePlaceholder")}
          autoComplete="off"
          maxLength={120}
          className="w-full rounded-2xl border-2 border-zinc-200 bg-white px-5 py-4 text-lg font-medium text-zinc-900 placeholder:text-zinc-400 transition focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-500/15 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500"
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t("newTrip.basics.titleHelp")}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <label
            htmlFor="newtrip-description"
            className="block text-sm font-semibold text-zinc-800 dark:text-zinc-100"
          >
            {t("newTrip.basics.descriptionLabel")}
          </label>
          <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            {t("newTrip.basics.descriptionOptional")}
          </span>
        </div>
        <textarea
          id="newtrip-description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder={t("newTrip.basics.descriptionPlaceholder")}
          rows={3}
          maxLength={500}
          className="w-full resize-y rounded-2xl border-2 border-zinc-200 bg-white px-5 py-4 text-base text-zinc-900 placeholder:text-zinc-400 transition focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-500/15 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500"
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t("newTrip.basics.descriptionHelp")}
        </p>
      </div>
    </div>
  );
}

function DatesStep({
  startDate,
  endDate,
  onRangeChange,
  onApplyPresetDays,
  intlLocale,
}: {
  startDate: string;
  endDate: string;
  onRangeChange: (start: string, end: string) => void;
  onApplyPresetDays: (days: number) => void;
  intlLocale: string;
}) {
  const { t } = useI18n();
  const nights = nightsBetween(startDate, endDate);
  const invalid = Boolean(startDate && endDate && endDate < startDate);

  const startLabel = useMemo(() => formatPrettyDate(startDate, intlLocale), [startDate, intlLocale]);
  const endLabel = useMemo(() => formatPrettyDate(endDate, intlLocale), [endDate, intlLocale]);

  const selectingNext: "start" | "end" = !startDate || (startDate && endDate) ? "start" : "end";

  return (
    <div className="space-y-6">
      <StepHeading
        heading={t("newTrip.dates.heading")}
        sub={t("newTrip.dates.subheading")}
      />

      <div className="grid grid-cols-2 gap-3">
        <RangeSummaryCard
          active={selectingNext === "start"}
          label={t("newTrip.dates.startLabel")}
          value={startLabel}
          placeholder={t("newTrip.review.empty")}
        />
        <RangeSummaryCard
          active={selectingNext === "end"}
          label={t("newTrip.dates.endLabel")}
          value={endLabel}
          placeholder={t("newTrip.review.empty")}
        />
      </div>

      <DateRangeCalendar
        startDate={startDate}
        endDate={endDate}
        onChange={(s, e) => onRangeChange(s, e)}
        intlLocale={intlLocale}
      />

      <div className="flex flex-wrap items-center gap-3">
        {invalid ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            <span aria-hidden>!</span>
            {t("newTrip.dates.invalid")}
          </span>
        ) : startDate && endDate ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 dark:border-violet-900/40 dark:bg-violet-950/40 dark:text-violet-200">
            <span aria-hidden>🗓️</span>
            {nights === 0
              ? t("newTrip.dates.sameDay")
              : nights === 1
                ? t("newTrip.dates.nightsOne")
                : t("newTrip.dates.nightsMany", { count: nights })}
          </span>
        ) : null}
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {t("newTrip.dates.presetHeading")}
        </p>
        <div className="flex flex-wrap gap-2">
          <PresetButton onClick={() => onApplyPresetDays(2)}>
            {t("newTrip.dates.presetWeekend")}
          </PresetButton>
          <PresetButton onClick={() => onApplyPresetDays(7)}>
            {t("newTrip.dates.presetWeek")}
          </PresetButton>
          <PresetButton onClick={() => onApplyPresetDays(14)}>
            {t("newTrip.dates.presetTwoWeeks")}
          </PresetButton>
          <PresetButton onClick={() => onApplyPresetDays(30)}>
            {t("newTrip.dates.presetMonth")}
          </PresetButton>
        </div>
      </div>
    </div>
  );
}

function PresetButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:border-violet-400 hover:bg-violet-50 hover:text-violet-700 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-violet-500 dark:hover:bg-violet-950/40 dark:hover:text-violet-200"
    >
      {children}
    </button>
  );
}

function RangeSummaryCard({
  active,
  label,
  value,
  placeholder,
}: {
  active: boolean;
  label: string;
  value: string;
  placeholder: string;
}) {
  return (
    <div
      className={
        "rounded-2xl border-2 px-4 py-3 transition " +
        (active
          ? "border-violet-500 bg-violet-50/70 shadow-md shadow-violet-500/10 dark:border-violet-400 dark:bg-violet-950/40"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900")
      }
    >
      <p
        className={
          "text-[11px] font-semibold uppercase tracking-wider " +
          (active
            ? "text-violet-700 dark:text-violet-300"
            : "text-zinc-500 dark:text-zinc-400")
        }
      >
        {label}
      </p>
      <p
        className={
          "mt-1 truncate text-base font-semibold " +
          (value
            ? "text-zinc-900 dark:text-zinc-50"
            : "text-zinc-400 dark:text-zinc-500")
        }
      >
        {value || placeholder}
      </p>
    </div>
  );
}


function CurrencyStep({
  currencyCode,
  onPickCurrency,
  customCurrencyMode,
  onActivateCustom,
  customCurrency,
  onCustomCurrencyChange,
}: {
  currencyCode: string;
  onPickCurrency: (code: string) => void;
  customCurrencyMode: boolean;
  onActivateCustom: () => void;
  customCurrency: string;
  onCustomCurrencyChange: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-7">
      <StepHeading
        heading={t("newTrip.currency.heading")}
        sub={t("newTrip.currency.subheading")}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {POPULAR_CURRENCIES.map((c) => {
          const selected = !customCurrencyMode && currencyCode === c.code;
          return (
            <button
              key={c.code}
              type="button"
              onClick={() => onPickCurrency(c.code)}
              aria-pressed={selected}
              className={
                "group flex flex-col items-start gap-1.5 rounded-2xl border-2 px-4 py-4 text-start transition active:scale-[0.98] " +
                (selected
                  ? "border-violet-500 bg-violet-50 shadow-md shadow-violet-500/10 dark:border-violet-400 dark:bg-violet-950/40"
                  : "border-zinc-200 bg-white hover:border-violet-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-violet-500/60")
              }
            >
              <span className="flex items-center gap-2">
                <span className="text-xl" aria-hidden>
                  {c.flag}
                </span>
                <span className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  {c.code}
                </span>
              </span>
              <span className="flex items-baseline gap-2">
                <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                  {c.symbol}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {c.fallbackLabel}
                </span>
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onActivateCustom}
          aria-pressed={customCurrencyMode}
          className={
            "group flex flex-col items-start gap-1.5 rounded-2xl border-2 px-4 py-4 text-start transition active:scale-[0.98] " +
            (customCurrencyMode
              ? "border-violet-500 bg-violet-50 shadow-md shadow-violet-500/10 dark:border-violet-400 dark:bg-violet-950/40"
              : "border-dashed border-zinc-300 bg-zinc-50/40 hover:border-violet-300 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/60 dark:hover:border-violet-500/60")
          }
        >
          <span className="flex items-center gap-2 text-xl" aria-hidden>
            ✨
          </span>
          <span className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {t("newTrip.currency.other")}
          </span>
        </button>
      </div>

      {customCurrencyMode ? (
        <div className="space-y-2">
          <label
            htmlFor="newtrip-currency-other"
            className="block text-sm font-semibold text-zinc-800 dark:text-zinc-100"
          >
            {t("newTrip.currency.otherLabel")}
          </label>
          <input
            id="newtrip-currency-other"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            spellCheck={false}
            value={customCurrency}
            onChange={(e) =>
              onCustomCurrencyChange(e.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 4))
            }
            placeholder={t("newTrip.currency.otherPlaceholder")}
            className="w-full rounded-2xl border-2 border-zinc-200 bg-white px-5 py-4 text-lg font-semibold uppercase tracking-widest text-zinc-900 placeholder:text-zinc-400 placeholder:font-medium placeholder:tracking-normal transition focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-500/15 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500"
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("newTrip.currency.otherHelp")}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ReviewStep({
  title,
  description,
  startDate,
  endDate,
  currency,
  intlLocale,
  onEditStep,
}: {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  currency: string;
  intlLocale: string;
  onEditStep: (target: WizardStepId) => void;
}) {
  const { t } = useI18n();
  const nights = nightsBetween(startDate, endDate);
  const dateRange = useMemo(() => {
    const s = formatPrettyDate(startDate, intlLocale);
    const e = formatPrettyDate(endDate, intlLocale);
    if (!s) return e;
    if (!e) return s;
    return `${s} → ${e}`;
  }, [startDate, endDate, intlLocale]);
  const durationLabel =
    nights === 0
      ? t("newTrip.dates.sameDay")
      : nights === 1
        ? t("newTrip.dates.nightsOne")
        : t("newTrip.dates.nightsMany", { count: nights });

  return (
    <div className="space-y-7">
      <StepHeading
        heading={t("newTrip.review.heading")}
        sub={t("newTrip.review.subheading")}
      />

      <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        <ReviewRow
          label={t("newTrip.review.name")}
          value={title || t("newTrip.review.empty")}
          onEdit={() => onEditStep("basics")}
          editLabel={t("newTrip.review.editStep")}
          emphasized
        />
        {description ? (
          <ReviewRow
            label={t("newTrip.review.description")}
            value={description}
            onEdit={() => onEditStep("basics")}
            editLabel={t("newTrip.review.editStep")}
          />
        ) : null}
        <ReviewRow
          label={t("newTrip.review.dates")}
          value={dateRange || t("newTrip.review.empty")}
          onEdit={() => onEditStep("dates")}
          editLabel={t("newTrip.review.editStep")}
        />
        <ReviewRow
          label={t("newTrip.review.duration")}
          value={durationLabel}
          onEdit={() => onEditStep("dates")}
          editLabel={t("newTrip.review.editStep")}
        />
        <ReviewRow
          label={t("newTrip.review.currency")}
          value={currency}
          onEdit={() => onEditStep("currency")}
          editLabel={t("newTrip.review.editStep")}
        />
      </ul>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  onEdit,
  editLabel,
  emphasized,
}: {
  label: string;
  value: string;
  onEdit: () => void;
  editLabel: string;
  emphasized?: boolean;
}) {
  return (
    <li className="flex items-start justify-between gap-3 px-5 py-4">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {label}
        </p>
        <p
          className={
            "mt-1 break-words " +
            (emphasized
              ? "text-lg font-semibold text-zinc-900 dark:text-zinc-50"
              : "text-sm text-zinc-800 dark:text-zinc-100")
          }
        >
          {value}
        </p>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold text-violet-600 transition hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/40"
      >
        {editLabel}
      </button>
    </li>
  );
}

