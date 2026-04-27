"use client";

import { useMemo, useState } from "react";
import type { StayStep } from "@/lib/types/trip";
import { useI18n } from "@/components/providers/I18nProvider";
import { TripDateTimeInput } from "@/components/trip/TripDateTimeInput";
import { PlaceSearchInput } from "@/components/trip/PlaceSearchInput";
import { applyOpenEndDateFromHotels, computeNightsForStep } from "@/lib/timeline/hotelsAndDates";
import { WizardPrimaryButton, WizardSecondaryButton, WizardShell } from "./WizardShell";

const TOTAL = 3;

export function StayStepWizard({
  initial,
  onBackToTypePick,
  onComplete,
}: {
  initial: StayStep;
  onBackToTypePick: () => void;
  onComplete: (s: StayStep) => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<StayStep>(initial);

  const previewNights = useMemo(() => computeNightsForStep(data), [data]);

  const canAdvanceBasics =
    data.title.trim().length > 0 || data.location.trim().length > 0;

  const titles = [
    t("stepWizard.stayBasicsTitle"),
    t("stepWizard.stayWhenTitle"),
    t("stepWizard.reviewTitle"),
  ];
  const descs = [
    t("stepWizard.stayBasicsHint"),
    t("stepWizard.stayWhenHint"),
    t("stepWizard.reviewHintStay"),
  ];

  function patch(p: Partial<StayStep>) {
    setData((d) => {
      const next = { ...d, ...p };
      if (next.type !== "stay") return d;
      let s: StayStep = next;
      s = applyOpenEndDateFromHotels(s);
      return { ...s, nights: computeNightsForStep(s) };
    });
  }

  function finish() {
    let s = applyOpenEndDateFromHotels(data);
    if (s.type !== "stay") return;
    onComplete({ ...s, nights: computeNightsForStep(s) });
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
          {step < TOTAL - 1 ? (
            <WizardPrimaryButton
              disabled={step === 0 && !canAdvanceBasics}
              onClick={() => setStep((s) => Math.min(TOTAL - 1, s + 1))}
            >
              {t("common.continue")}
            </WizardPrimaryButton>
          ) : (
            <WizardPrimaryButton onClick={finish}>
              {t("stepWizard.openFullEditor")}
            </WizardPrimaryButton>
          )}
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

      {step === 2 ? (
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
          </dl>
          <p className="border-t border-zinc-200/80 pt-3 text-xs leading-relaxed text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
            {t("stepWizard.afterStayEditor")}
          </p>
        </div>
      ) : null}
    </WizardShell>
  );
}
