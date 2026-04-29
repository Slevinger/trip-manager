"use client";

import { useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { TransitStep, TransportOption, TripStep } from "@/lib/types/trip";
import { useI18n } from "@/components/providers/I18nProvider";
import { TripDateTimeInput } from "@/components/trip/TripDateTimeInput";
import { PlaceSearchInput } from "@/components/trip/PlaceSearchInput";
import { TransitStaySelects } from "@/components/trip/TransitStaySelects";
import { stayStepOptionLabel, stayStepsSorted } from "@/lib/tripStayEndpoints";
import { isValidDdMmYyyy } from "@/lib/timeline/dates";
import {
  applyTransitEndFromArrivals,
  transitStepDurationFromArrivals,
} from "@/lib/timeline/hotelsAndDates";
import { WizardPrimaryButton, WizardSecondaryButton, WizardShell } from "./WizardShell";

const TOTAL = 5;

function emptyTransport(): TransportOption {
  return {
    id: uuidv4(),
    title: "",
    from: "",
    to: "",
    details: "",
    duration: "",
    cost: "",
  };
}

export function TransitStepWizard({
  tripSteps,
  initial,
  onBackToTypePick,
  onComplete,
}: {
  tripSteps: TripStep[];
  initial: TransitStep;
  onBackToTypePick: () => void;
  onComplete: (s: TransitStep) => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [transportIndex, setTransportIndex] = useState(0);
  const [data, setData] = useState<TransitStep>(() =>
    applyTransitEndFromArrivals({ ...initial, endDateOpen: false })
  );

  const stays = useMemo(() => stayStepsSorted(tripSteps), [tripSteps]);

  const durationPreview = useMemo(() => transitStepDurationFromArrivals(data), [data]);

  const currentTransport = data.transports[transportIndex];

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
    isValidDdMmYyyy(data.startDate) && isValidDdMmYyyy(data.endDate);

  const canAdvanceTransport =
    currentTransport &&
    (currentTransport.title.trim().length > 0 ||
      (currentTransport.from.trim().length > 0 &&
        currentTransport.to.trim().length > 0));

  const titles = [
    t("stepWizard.transitBasicsTitle"),
    t("stepWizard.transitWhenTitle"),
    t("stepWizard.transitTransportTitle"),
    t("stepWizard.afterListItemTitle"),
    t("stepWizard.reviewTitle"),
  ];
  const descs = [
    t("stepWizard.transitBasicsHint"),
    t("stepWizard.transitWhenHint"),
    t("stepWizard.transitTransportHint"),
    t("stepWizard.transitAfterTransportBody"),
    t("stepWizard.reviewHintTransit"),
  ];

  function patch(p: Partial<TransitStep>) {
    setData((d) => applyTransitEndFromArrivals({ ...d, ...p, endDateOpen: false }));
  }

  function patchTransportAt(index: number, patchT: Partial<TransportOption>) {
    setData((d) => {
      const transports = d.transports.map((tr, i) =>
        i === index ? { ...tr, ...patchT } : tr
      );
      return applyTransitEndFromArrivals({ ...d, transports, endDateOpen: false });
    });
  }

  function ensureTransportSlotForStep2() {
    setData((d) => {
      if (d.transports.length > 0) return d;
      return applyTransitEndFromArrivals({
        ...d,
        transports: [emptyTransport()],
        endDateOpen: false,
      });
    });
    setTransportIndex(0);
  }

  function goToTransportFromDates() {
    ensureTransportSlotForStep2();
    setStep(2);
  }

  function finish() {
    onComplete(applyTransitEndFromArrivals({ ...data, endDateOpen: false }));
  }

  return (
    <WizardShell
      title={titles[step] ?? titles[0]}
      description={descs[step]}
      currentStepIndex={step}
      totalSteps={TOTAL}
      announce={`${step + 1} / ${TOTAL}`}
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
            <WizardPrimaryButton disabled={!datesOk} onClick={goToTransportFromDates}>
              {t("common.continue")}
            </WizardPrimaryButton>
          ) : null}
          {step === 2 && currentTransport ? (
            <>
              <WizardPrimaryButton
                disabled={!canAdvanceTransport}
                onClick={() => setStep(3)}
              >
                {t("common.continue")}
              </WizardPrimaryButton>
              <WizardSecondaryButton
                onClick={() => {
                  patch({ transports: [] });
                  setStep(4);
                }}
              >
                {t("stepWizard.skipTransportsForNow")}
              </WizardSecondaryButton>
            </>
          ) : null}
          {step === 3 ? (
            <>
              <WizardPrimaryButton
                onClick={() => {
                  setData((d) =>
                    applyTransitEndFromArrivals({
                      ...d,
                      transports: [...d.transports, emptyTransport()],
                      endDateOpen: false,
                    })
                  );
                  setTransportIndex((i) => i + 1);
                  setStep(2);
                }}
              >
                {t("stepWizard.addAnotherTransport")}
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
              else if (step === 4) setStep(data.transports.length > 0 ? 3 : 1);
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
              onDateChange={(startDate) =>
                patch({ startDate, transitEndManual: data.transitEndManual })
              }
              onTimeChange={(startTime) => patch({ startTime })}
            />
          </label>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {t("step.endDate")}
            <TripDateTimeInput
              className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
              date={data.endDate}
              time={data.endTime}
              onDateChange={(endDate) => patch({ endDate, transitEndManual: true })}
              onTimeChange={(endTime) => patch({ endTime, transitEndManual: true })}
            />
          </label>
          {!datesOk ? (
            <p className="text-xs text-amber-700 dark:text-amber-400/90">
              {t("step.transitDatesRequired")}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 2 && currentTransport ? (
        <div className="space-y-4">
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {t("stepWizard.transportFormLabel")} {transportIndex + 1}
          </p>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {t("stepWizard.transportSegmentTitle")}
            <input
              className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
              value={currentTransport.title}
              placeholder={t("stepWizard.placeholderTransportSegment")}
              onChange={(e) =>
                patchTransportAt(transportIndex, { title: e.target.value })
              }
              autoFocus
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t("step.transportFrom")}
              <input
                className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
                value={currentTransport.from}
                onChange={(e) =>
                  patchTransportAt(transportIndex, { from: e.target.value })
                }
              />
            </label>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t("step.transportTo")}
              <input
                className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
                value={currentTransport.to}
                onChange={(e) =>
                  patchTransportAt(transportIndex, { to: e.target.value })
                }
              />
            </label>
          </div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {t("step.durationTransit")}
            <input
              className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
              value={currentTransport.duration}
              onChange={(e) =>
                patchTransportAt(transportIndex, { duration: e.target.value })
              }
            />
          </label>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {t("stepWizard.transportCostLabel")}
            <input
              className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
              value={currentTransport.cost}
              onChange={(e) =>
                patchTransportAt(transportIndex, { cost: e.target.value })
              }
            />
          </label>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {t("step.notes")}
            <textarea
              className="mt-2 min-h-[72px] w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
              value={currentTransport.details}
              onChange={(e) =>
                patchTransportAt(transportIndex, { details: e.target.value })
              }
            />
          </label>
          {!canAdvanceTransport ? (
            <p className="text-xs text-amber-700 dark:text-amber-400/90">
              {t("stepWizard.transportNeedTitleOrEndpoints")}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50/80 p-5 text-center dark:border-sky-900/40 dark:bg-sky-950/30">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {t("stepWizard.transitAfterTransportHeadline")}
          </p>
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
            {t("stepWizard.transitAfterTransportBody")}
          </p>
        </div>
      ) : null}

      {step === 4 ? (
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
                  {t("step.durationTransit")}
                </dt>
                <dd className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-50">
                  {durationPreview || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  {t("stepWizard.transportsListHeading")}
                </dt>
                <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">
                  {data.transports.length === 0 ? (
                    <span className="text-zinc-500">—</span>
                  ) : (
                    <ul className="mt-1 list-inside list-disc space-y-1">
                      {data.transports.map((tr) => (
                        <li key={tr.id}>
                          {tr.title.trim() ||
                            `${tr.from.trim() || "—"} → ${tr.to.trim() || "—"}`}
                        </li>
                      ))}
                    </ul>
                  )}
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
