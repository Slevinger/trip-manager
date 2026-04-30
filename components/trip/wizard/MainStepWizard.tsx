"use client";

import { useState } from "react";
import type { StayStep, TransitStep, TripStep } from "@/lib/types/trip";
import { morphStepToStay, morphStepToTransit } from "@/lib/tripDefaults";
import { useI18n } from "@/components/providers/I18nProvider";
import { StepFlowWizard } from "./StepFlowWizard";

type Phase =
  | { kind: "pick" }
  | { kind: "stay"; step: StayStep }
  | { kind: "transit"; step: TransitStep };

export function MainStepWizard({
  tripSteps,
  initial,
  onBackToPathChoice,
  onComplete,
  startMode = "pick",
}: {
  tripSteps: TripStep[];
  initial: TripStep;
  onBackToPathChoice: () => void;
  onComplete: (step: TripStep) => void;
  startMode?: "pick" | "stay_item" | "transit_item";
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>(() => {
    if (startMode === "stay_item") {
      return { kind: "stay", step: morphStepToStay(initial) };
    }
    if (startMode === "transit_item") {
      return { kind: "transit", step: morphStepToTransit(initial) };
    }
    return { kind: "pick" };
  });

  if (phase.kind === "pick") {
    return (
      <div className="flex flex-col">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t("stepWizard.pickTitle")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {t("stepWizard.pickHint")}
        </p>
        <div className="mt-8 grid gap-4">
          <button
            type="button"
            onClick={() => setPhase({ kind: "stay", step: morphStepToStay(initial) })}
            className="group flex w-full flex-col items-start gap-2 rounded-2xl border-2 border-zinc-200 bg-white p-5 text-start shadow-sm transition hover:border-violet-400 hover:shadow-md active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-violet-500"
          >
            <span className="text-3xl" aria-hidden>
              🏨
            </span>
            <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {t("step.typeStay")}
            </span>
            <span className="text-sm leading-snug text-zinc-600 dark:text-zinc-400">
              {t("stepWizard.pickStayBlurb")}
            </span>
            <span className="mt-1 text-xs font-medium text-violet-600 group-hover:underline dark:text-violet-400">
              {t("stepWizard.pickCardCta")}
            </span>
          </button>
          <button
            type="button"
            onClick={() =>
              setPhase({ kind: "transit", step: morphStepToTransit(initial) })
            }
            className="group flex w-full flex-col items-start gap-2 rounded-2xl border-2 border-zinc-200 bg-white p-5 text-start shadow-sm transition hover:border-sky-400 hover:shadow-md active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-sky-500"
          >
            <span className="text-3xl" aria-hidden>
              ✈️
            </span>
            <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {t("step.typeTransit")}
            </span>
            <span className="text-sm leading-snug text-zinc-600 dark:text-zinc-400">
              {t("stepWizard.pickTransitBlurb")}
            </span>
            <span className="mt-1 text-xs font-medium text-sky-600 group-hover:underline dark:text-sky-400">
              {t("stepWizard.pickCardCta")}
            </span>
          </button>
        </div>
        <button
          type="button"
          onClick={onBackToPathChoice}
          className="mt-8 min-h-[48px] w-full rounded-2xl border border-zinc-200 bg-white py-3 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
        >
          {t("stepWizard.backToSetupChoice")}
        </button>
      </div>
    );
  }

  if (phase.kind === "stay") {
    return (
      <StepFlowWizard
        kind="stay"
        tripSteps={tripSteps}
        initial={phase.step}
        entry={startMode === "stay_item" ? "hotels_only" : "full"}
        onBackToTypePick={() => setPhase({ kind: "pick" })}
        onComplete={onComplete}
      />
    );
  }

  return (
    <StepFlowWizard
      kind="transit"
      tripSteps={tripSteps}
      initial={phase.step}
        entry="full"
      onBackToTypePick={() => setPhase({ kind: "pick" })}
      onComplete={onComplete}
    />
  );
}
