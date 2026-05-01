"use client";

import { useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { Hotel, StayStep, TransitStep, TripStep } from "@/lib/types/trip";
import { useI18n } from "@/components/providers/I18nProvider";
import { TripDateTimeInput } from "@/components/trip/TripDateTimeInput";
import { PlaceSearchInput } from "@/components/trip/PlaceSearchInput";
import { GroupedNumberInput } from "@/components/trip/GroupedNumberInput";
import { TransitStaySelects } from "@/components/trip/TransitStaySelects";
import { stayStepOptionLabel, stayStepsSorted } from "@/lib/tripStayEndpoints";
import { isValidDdMmYyyy } from "@/lib/timeline/dates";
import {
  applyOpenEndDateFromHotels,
  applyTransitEndFromArrivals,
  computeNightsForStep,
  transitStepDurationFromArrivals,
} from "@/lib/timeline/hotelsAndDates";
import {
  applyTransitDurationToEnd,
  clampTransitDurationParts,
  totalMinutesFromTransitDuration,
} from "@/lib/timeline/transitDuration";
import {
  STAY_WIZARD_SHELL,
  STAY_WIZARD_TOTAL_STEPS,
  TRANSIT_WIZARD_SHELL,
  TRANSIT_WIZARD_TOTAL_STEPS,
  type StepWizardEntry,
} from "@/lib/wizard/stepWizardConfig";
import { WizardPrimaryButton, WizardSecondaryButton, WizardShell } from "./WizardShell";

function emptyHotel(): Hotel {
  return {
    id: uuidv4(),
    name: "",
    checkinDate: "",
    checkinTime: "",
    checkoutDate: "",
    checkoutTime: "",
    bookingUrl: "",
    cost: 0,
    notes: "",
  };
}

type StepFlowKind = "stay" | "transit";

function transitTypeEmoji(transitType?: TransitStep["transitType"]): string {
  if (transitType === "minivan") return "🚐";
  if (transitType === "taxi") return "🚕";
  if (transitType === "ferry") return "⛴️";
  if (transitType === "speedboat") return "🚤";
  return "✈️";
}

export function StepFlowWizard({
  kind,
  tripSteps,
  initial,
  entry = "full",
  onBackToTypePick,
  onComplete,
}: {
  kind: StepFlowKind;
  tripSteps: TripStep[];
  initial: StayStep | TransitStep;
  entry?: StepWizardEntry;
  onBackToTypePick: () => void;
  onComplete: (s: StayStep | TransitStep) => void;
}) {
  const { t } = useI18n();
  if (kind === "stay") {
    return (
      <StayFlowInner
        initial={initial as StayStep}
        entry={entry}
        onBackToTypePick={onBackToTypePick}
        onComplete={onComplete as (s: StayStep) => void}
        t={t}
      />
    );
  }

  return (
    <TransitFlowInner
      tripSteps={tripSteps}
      initial={initial as TransitStep}
      entry={entry}
      onBackToTypePick={onBackToTypePick}
      onComplete={onComplete as (s: TransitStep) => void}
      t={t}
    />
  );
}

type TFn = (key: string) => string;

function StayFlowInner({
  initial,
  entry,
  onBackToTypePick,
  onComplete,
  t,
}: {
  initial: StayStep;
  entry: StepWizardEntry;
  onBackToTypePick: () => void;
  onComplete: (s: StayStep) => void;
  t: TFn;
}) {
  const startAtHotelEntry = entry === "hotels_only";
  const [step, setStep] = useState(startAtHotelEntry ? 2 : 0);
  const [hotelIndex, setHotelIndex] = useState(
    startAtHotelEntry ? initial.hotels.length : 0
  );
  const [data, setData] = useState<StayStep>(() => {
    if (!startAtHotelEntry) return initial;
    const hotels = [...initial.hotels, emptyHotel()];
    const withHotel: StayStep = { ...initial, hotels };
    const aligned = applyOpenEndDateFromHotels(withHotel);
    return { ...aligned, nights: computeNightsForStep(aligned) };
  });

  const previewNights = useMemo(() => computeNightsForStep(data), [data]);
  const currentHotel = data.hotels[hotelIndex];

  const canAdvanceBasics =
    data.title.trim().length > 0 || data.location.trim().length > 0;
  const canAdvanceHotel =
    currentHotel &&
    (currentHotel.name.trim().length > 0 ||
      (currentHotel.checkinDate.trim().length > 0 &&
        currentHotel.checkoutDate.trim().length > 0));

  const shell = STAY_WIZARD_SHELL[step] ?? STAY_WIZARD_SHELL[0];

  function patch(p: Partial<StayStep>) {
    setData((d) => {
      const next = { ...d, ...p };
      if (next.type !== "stay") return d;
      let s: StayStep = next;
      s = applyOpenEndDateFromHotels(s);
      return { ...s, nights: computeNightsForStep(s) };
    });
  }

  function patchHotelAt(index: number, patchHotel: Partial<Hotel>) {
    setData((d) => {
      if (d.type !== "stay") return d;
      const hotels = d.hotels.map((h, i) =>
        i === index ? { ...h, ...patchHotel } : h
      );
      let s: StayStep = { ...d, hotels };
      s = applyOpenEndDateFromHotels(s);
      return { ...s, nights: computeNightsForStep(s) };
    });
  }

  function ensureHotelSlotForStep2() {
    setData((d) => {
      if (d.type !== "stay") return d;
      if (d.hotels.length > 0) return d;
      const startDate = d.startDate.trim();
      const startTime = d.startTime.trim();
      const hotels = [emptyHotel()];
      hotels[0] = {
        ...hotels[0],
        checkinDate: startDate,
        checkinTime: startTime,
        checkoutDate: startDate,
        checkoutTime: startTime,
      };
      let s: StayStep = { ...d, hotels };
      s = applyOpenEndDateFromHotels(s);
      return { ...s, nights: computeNightsForStep(s) };
    });
    setHotelIndex(0);
  }

  function goToHotelFromDates() {
    ensureHotelSlotForStep2();
    setStep(2);
  }

  function finish() {
    let s = applyOpenEndDateFromHotels(data);
    if (s.type !== "stay") return;
    onComplete({ ...s, nights: computeNightsForStep(s) });
  }

  return (
    <WizardShell
      title={t(shell.titleKey)}
      description={t(shell.descKey)}
      currentStepIndex={step}
      totalSteps={STAY_WIZARD_TOTAL_STEPS}
      announce={`${step + 1} / ${STAY_WIZARD_TOTAL_STEPS}`}
      footer={
        <div className="flex flex-col gap-2">
          {step === 0 ? (
            <WizardPrimaryButton
              disabled={!canAdvanceBasics}
              onClick={() => setStep(1)}
            >
              {t("common.continue")}
            </WizardPrimaryButton>
          ) : null}
          {step === 1 ? (
            <WizardPrimaryButton onClick={goToHotelFromDates}>
              {t("common.continue")}
            </WizardPrimaryButton>
          ) : null}
          {step === 2 && currentHotel ? (
            <>
              <WizardPrimaryButton
                disabled={!canAdvanceHotel}
                onClick={() => setStep(3)}
              >
                {t("common.continue")}
              </WizardPrimaryButton>
              <WizardSecondaryButton
                onClick={() => {
                  if (hotelIndex === 0) {
                    patch({ hotels: [] });
                    setStep(4);
                    return;
                  }
                  finish();
                }}
              >
                {hotelIndex === 0
                  ? t("stepWizard.skipHotelsForNow")
                  : t("common.finish")}
              </WizardSecondaryButton>
            </>
          ) : null}
          {step === 3 ? (
            <>
              <WizardPrimaryButton
                onClick={() => {
                  setData((d) => {
                    if (d.type !== "stay") return d;
                    const hotels = [...d.hotels, emptyHotel()];
                    let s: StayStep = { ...d, hotels };
                    s = applyOpenEndDateFromHotels(s);
                    return { ...s, nights: computeNightsForStep(s) };
                  });
                  setHotelIndex((i) => i + 1);
                  setStep(2);
                }}
              >
                {t("stepWizard.addAnotherHotel")}
              </WizardPrimaryButton>
              <WizardSecondaryButton onClick={() => setStep(4)}>
                {t("stepWizard.continueToReview")}
              </WizardSecondaryButton>
            </>
          ) : null}
          {step === 4 ? (
            <WizardPrimaryButton onClick={finish}>
              {t("stepWizard.openFullEditor")}
            </WizardPrimaryButton>
          ) : null}
          <WizardSecondaryButton
            onClick={() => {
              if (step === 0) onBackToTypePick();
              else if (step === 2) setStep(1);
              else if (step === 3) setStep(2);
              else if (step === 4) setStep(data.hotels.length > 0 ? 3 : 1);
              else setStep((s) => Math.max(0, s - 1));
            }}
          >
            {step === 0
              ? t("stepWizard.changeStepType")
              : t("common.back")}
          </WizardSecondaryButton>
        </div>
      }
    >
      {step === 0 ? (
        <div className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t("step.title")}
            </span>
            <input
              className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3.5 text-base outline-none ring-zinc-900/10 transition placeholder:text-zinc-400 focus:border-violet-400 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-violet-500 dark:focus:ring-violet-950/40"
              value={data.title}
              placeholder={t("stepWizard.placeholderStayTitle")}
              onChange={(e) => patch({ title: e.target.value })}
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t("step.location")}
            </span>
            <PlaceSearchInput
              className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3.5 text-base outline-none ring-zinc-900/10 transition placeholder:text-zinc-400 focus:border-violet-400 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-violet-500 dark:focus:ring-violet-950/40"
              value={data.location}
              placeholder={t("stepWizard.placeholderStayLocation")}
              onChange={(location) =>
                patch({ location, coordinates: undefined })
              }
              onPick={(p) =>
                patch({
                  location: p.label,
                  coordinates: { lat: p.lat, lng: p.lng },
                })
              }
            />
          </label>
          {!canAdvanceBasics ? (
            <p className="text-xs text-amber-700 dark:text-amber-400/90">
              {t("stepWizard.stayBasicsNeedOne")}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-4">
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {t("step.startDate")}
            <TripDateTimeInput
              className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
              date={data.startDate}
              time={data.startTime}
              onDateChange={(startDate) => patch({ startDate })}
              onTimeChange={(startTime) => patch({ startTime })}
            />
          </label>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {t("step.endDate")}
            <TripDateTimeInput
              disabled={data.endDateOpen}
              className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
              date={data.endDate}
              time={data.endTime}
              minDate={data.startDate.trim() || undefined}
              onDateChange={(endDate) => patch({ endDate })}
              onTimeChange={(endTime) => patch({ endTime })}
            />
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-700 dark:bg-zinc-900/50">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0 rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
              checked={data.endDateOpen}
              onChange={(e) => patch({ endDateOpen: e.target.checked })}
            />
            <span className="text-sm leading-snug text-zinc-700 dark:text-zinc-200">
              {t("stepWizard.stayOpenEndExplain")}
            </span>
          </label>
        </div>
      ) : null}

      {step === 2 && currentHotel ? (
        <div className="space-y-4">
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {t("stepWizard.hotelFormLabel")} {hotelIndex + 1}
          </p>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {t("hotels.name")}
            <input
              className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
              value={currentHotel.name}
              onChange={(e) =>
                patchHotelAt(hotelIndex, { name: e.target.value })
              }
              autoFocus
            />
          </label>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {t("hotels.checkin")}
            <TripDateTimeInput
              className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
              date={currentHotel.checkinDate}
              time={currentHotel.checkinTime}
              minDate={data.startDate.trim() || undefined}
              onDateChange={(checkinDate) =>
                patchHotelAt(hotelIndex, { checkinDate })
              }
              onTimeChange={(checkinTime) =>
                patchHotelAt(hotelIndex, { checkinTime })
              }
            />
          </label>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {t("hotels.checkout")}
            <TripDateTimeInput
              className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
              date={currentHotel.checkoutDate}
              time={currentHotel.checkoutTime}
              minDate={currentHotel.checkinDate.trim() || data.startDate.trim() || undefined}
              onDateChange={(checkoutDate) =>
                patchHotelAt(hotelIndex, { checkoutDate })
              }
              onTimeChange={(checkoutTime) =>
                patchHotelAt(hotelIndex, { checkoutTime })
              }
            />
          </label>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {t("hotels.cost")}
            <GroupedNumberInput
              min={0}
              className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
              value={Number.isFinite(currentHotel.cost) ? currentHotel.cost : 0}
              onChange={(cost) => patchHotelAt(hotelIndex, { cost })}
            />
          </label>
          {!canAdvanceHotel ? (
            <p className="text-xs text-amber-700 dark:text-amber-400/90">
              {t("stepWizard.hotelNeedNameOrDates")}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/80 p-5 text-center dark:border-violet-900/40 dark:bg-violet-950/30">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {t("stepWizard.stayAfterHotelHeadline")}
          </p>
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
            {t("stepWizard.stayAfterHotelBody")}
          </p>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="space-y-3 rounded-2xl border border-zinc-200 bg-gradient-to-b from-zinc-50 to-white p-5 dark:border-zinc-700 dark:from-zinc-900/80 dark:to-zinc-950">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                {t("step.title")}
              </dt>
              <dd className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-50">
                {data.title.trim() || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                {t("step.location")}
              </dt>
              <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">
                {data.location.trim() || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                {t("step.type")}
              </dt>
              <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">{t("step.typeStay")}</dd>
            </div>
            <div className="flex flex-wrap gap-4">
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  {t("step.nights")}
                </dt>
                <dd className="mt-0.5 font-semibold text-zinc-900 dark:text-zinc-50">
                  {previewNights}
                </dd>
              </div>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                {t("hotels.title")}
              </dt>
              <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">
                {data.hotels.length === 0 ? (
                  <span className="text-zinc-500">—</span>
                ) : (
                  <ul className="mt-1 list-inside list-disc space-y-1">
                    {data.hotels.map((h) => (
                      <li key={h.id}>{h.name.trim() || t("stepWizard.unnamedHotel")}</li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          </dl>
          <p className="border-t border-zinc-200/80 pt-3 text-xs leading-relaxed text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
            {t("stepWizard.afterStayEditor")}
          </p>
        </div>
      ) : null}
    </WizardShell>
  );
}

function TransitFlowInner({
  tripSteps,
  initial,
  entry: _entry,
  onBackToTypePick,
  onComplete,
  t,
}: {
  tripSteps: TripStep[];
  initial: TransitStep;
  entry: StepWizardEntry;
  onBackToTypePick: () => void;
  onComplete: (s: TransitStep) => void;
  t: TFn;
}) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<TransitStep>(() =>
    applyTransitEndFromArrivals({
      ...initial,
      transitType: initial.transitType ?? "airplane",
      endDateOpen: false,
      transports: [],
    })
  );

  const stays = useMemo(() => stayStepsSorted(tripSteps), [tripSteps]);
  const durationPreview = useMemo(() => transitStepDurationFromArrivals(data), [data]);
  const hasStayEndpoints =
    stays.length >= 2 &&
    Boolean(data.fromStayStepId?.trim()) &&
    Boolean(data.toStayStepId?.trim()) &&
    data.fromStayStepId !== data.toStayStepId &&
    stays.some((s) => s.id === data.fromStayStepId) &&
    stays.some((s) => s.id === data.toStayStepId);
  const canAdvanceBasics =
    hasStayEndpoints &&
    (data.title.trim().length > 0 || data.location.trim().length > 0);
  const datesOk =
    isValidDdMmYyyy(data.startDate) && totalMinutesFromTransitDuration(data) > 0;
  const shell = TRANSIT_WIZARD_SHELL[step] ?? TRANSIT_WIZARD_SHELL[0];

  function patch(p: Partial<TransitStep>) {
    setData((d) => {
      const merged = { ...d, ...p, endDateOpen: false, transports: [] };
      const c = clampTransitDurationParts(
        merged.transitDurationDays ?? 0,
        merged.transitDurationHours ?? 0,
        merged.transitDurationMinutes ?? 0
      );
      return applyTransitDurationToEnd({ ...merged, ...c });
    });
  }

  function finish() {
    onComplete(applyTransitEndFromArrivals({ ...data, endDateOpen: false, transports: [] }));
  }

  return (
    <WizardShell
      title={t(shell.titleKey)}
      description={t(shell.descKey)}
      currentStepIndex={step}
      totalSteps={TRANSIT_WIZARD_TOTAL_STEPS}
      announce={`${step + 1} / ${TRANSIT_WIZARD_TOTAL_STEPS}`}
      footer={
        <div className="flex flex-col gap-2">
          {step === 0 ? (
            <WizardPrimaryButton disabled={!canAdvanceBasics} onClick={() => setStep(1)}>
              {t("common.continue")}
            </WizardPrimaryButton>
          ) : null}
          {step === 1 ? (
            <WizardPrimaryButton disabled={!datesOk} onClick={() => setStep(2)}>
              {t("common.continue")}
            </WizardPrimaryButton>
          ) : null}
          {step === 2 ? (
            <WizardPrimaryButton onClick={finish}>
              {t("stepWizard.openFullEditor")}
            </WizardPrimaryButton>
          ) : null}
          <WizardSecondaryButton
            onClick={() => {
              if (step === 0) onBackToTypePick();
              else setStep((s) => Math.max(0, s - 1));
            }}
          >
            {step === 0 ? t("stepWizard.changeStepType") : t("common.back")}
          </WizardSecondaryButton>
        </div>
      }
    >
      {step === 0 ? (
        <div className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t("step.title")}
            </span>
            <input
              className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3.5 text-base outline-none transition placeholder:text-zinc-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-500/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-sky-500"
              value={data.title}
              placeholder={t("stepWizard.placeholderTransitTitle")}
              onChange={(e) => patch({ title: e.target.value })}
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t("step.location")}
            </span>
            <PlaceSearchInput
              className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3.5 text-base outline-none transition placeholder:text-zinc-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-500/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-sky-500"
              value={data.location}
              placeholder={t("stepWizard.placeholderTransitLocation")}
              onChange={(location) =>
                patch({ location, coordinates: undefined })
              }
              onPick={(p) =>
                patch({
                  location: p.label,
                  coordinates: { lat: p.lat, lng: p.lng },
                })
              }
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t("step.transitType")}
            </span>
            <select
              className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              value={data.transitType ?? "airplane"}
              onChange={(e) =>
                patch({
                  transitType: e.target.value as NonNullable<TransitStep["transitType"]>,
                })
              }
            >
              <option value="airplane">
                {transitTypeEmoji("airplane")} {t("step.transitTypeAirplane")}
              </option>
              <option value="minivan">
                {transitTypeEmoji("minivan")} {t("step.transitTypeMinivan")}
              </option>
              <option value="taxi">
                {transitTypeEmoji("taxi")} {t("step.transitTypeTaxi")}
              </option>
              <option value="ferry">
                {transitTypeEmoji("ferry")} {t("step.transitTypeFerry")}
              </option>
              <option value="speedboat">
                {transitTypeEmoji("speedboat")} {t("step.transitTypeSpeedboat")}
              </option>
            </select>
          </label>
          {stays.length < 2 ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
              {t("step.noStaysForTransit")}
            </p>
          ) : (
            <TransitStaySelects
              stays={stays}
              fromStayStepId={data.fromStayStepId}
              toStayStepId={data.toStayStepId}
              onChange={(p) => patch(p)}
            />
          )}
          {!hasStayEndpoints && stays.length >= 2 ? (
            <p className="text-xs text-amber-700 dark:text-amber-400/90">
              {t("step.transitEndpointsRequired")}
            </p>
          ) : null}
          {hasStayEndpoints &&
          !(data.title.trim() || data.location.trim()) ? (
            <p className="text-xs text-amber-700 dark:text-amber-400/90">
              {t("stepWizard.transitBasicsNeedOne")}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-4">
          <p className="rounded-2xl border border-sky-200/80 bg-sky-50/90 px-4 py-3 text-xs leading-relaxed text-sky-950 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100">
            {t("stepWizard.transitDateReminder")}
          </p>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {t("step.startDate")}
            <TripDateTimeInput
              className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
              date={data.startDate}
              time={data.startTime}
              onDateChange={(startDate) => patch({ startDate })}
              onTimeChange={(startTime) => patch({ startTime })}
            />
          </label>
          <div className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {t("step.transitDurationInputs")}
            <div className="mt-2 grid grid-cols-3 gap-2">
              <label className="block min-w-0">
                <span className="text-[10px] font-normal text-zinc-500">{t("step.transitDurationDays")}</span>
                <GroupedNumberInput
                  min={0}
                  className="mt-0.5 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-base dark:border-zinc-700 dark:bg-zinc-900"
                  value={data.transitDurationDays ?? 0}
                  onChange={(n) => patch({ transitDurationDays: n })}
                />
              </label>
              <label className="block min-w-0">
                <span className="text-[10px] font-normal text-zinc-500">{t("step.transitDurationHours")}</span>
                <GroupedNumberInput
                  min={0}
                  className="mt-0.5 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-base dark:border-zinc-700 dark:bg-zinc-900"
                  value={data.transitDurationHours ?? 0}
                  onChange={(n) => patch({ transitDurationHours: n })}
                />
              </label>
              <label className="block min-w-0">
                <span className="text-[10px] font-normal text-zinc-500">{t("step.transitDurationMinutes")}</span>
                <GroupedNumberInput
                  min={0}
                  className="mt-0.5 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-base dark:border-zinc-700 dark:bg-zinc-900"
                  value={data.transitDurationMinutes ?? 0}
                  onChange={(n) => patch({ transitDurationMinutes: n })}
                />
              </label>
            </div>
            <p className="mt-2 text-[11px] font-normal leading-snug text-zinc-500 dark:text-zinc-400">
              {t("step.transitDurationHint")}
            </p>
          </div>
          {!datesOk ? (
            <p className="text-xs text-amber-700 dark:text-amber-400/90">
              {!isValidDdMmYyyy(data.startDate)
                ? t("step.transitDatesRequired")
                : t("step.transitDurationRequired")}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-zinc-200 bg-gradient-to-b from-zinc-50 to-white p-5 dark:border-zinc-700 dark:from-zinc-900/80 dark:to-zinc-950">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  {t("step.transitFromStay")}
                </dt>
                <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">
                  {(() => {
                    const s = data.fromStayStepId
                      ? stays.find((x) => x.id === data.fromStayStepId)
                      : undefined;
                    return s ? stayStepOptionLabel(s) : "—";
                  })()}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  {t("step.transitToStay")}
                </dt>
                <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">
                  {(() => {
                    const s = data.toStayStepId
                      ? stays.find((x) => x.id === data.toStayStepId)
                      : undefined;
                    return s ? stayStepOptionLabel(s) : "—";
                  })()}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  {t("step.title")}
                </dt>
                <dd className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-50">
                  {data.title.trim() || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  {t("step.location")}
                </dt>
                <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">
                  {data.location.trim() || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  {t("step.type")}
                </dt>
                <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">
                  {t("step.typeTransit")}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  {t("step.transitType")}
                </dt>
                <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">
                  {transitTypeEmoji(data.transitType)}{" "}
                  {data.transitType === "minivan"
                    ? t("step.transitTypeMinivan")
                    : data.transitType === "taxi"
                      ? t("step.transitTypeTaxi")
                      : data.transitType === "ferry"
                        ? t("step.transitTypeFerry")
                        : data.transitType === "speedboat"
                          ? t("step.transitTypeSpeedboat")
                      : t("step.transitTypeAirplane")}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  {t("step.durationTransit")}
                </dt>
                <dd className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-50">
                  {durationPreview || "—"}
                </dd>
              </div>
            </dl>
          </div>
          <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            {t("stepWizard.afterTransitEditor")}
          </p>
        </div>
      ) : null}
    </WizardShell>
  );
}
