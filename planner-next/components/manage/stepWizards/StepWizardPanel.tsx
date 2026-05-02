"use client";

import { STEP_WIZARD_IDS } from "@/lib/wizardStack/types";
import type { WizardStackControls } from "@/lib/wizardStack/useWizardStack";
export function StepWizardPanel({
  typeWizardFirst,
  wizard,
  onClose,
  onStartStay,
  onStartTransit,
  onStartStayFlatFull,
}: {
  typeWizardFirst: boolean;
  wizard: WizardStackControls;
  onClose: () => void;
  onStartStay: () => void;
  onStartTransit: () => void;
  onStartStayFlatFull: () => void;
}) {
  const step = Math.min(Math.max(0, wizard.top?.step ?? 0), typeWizardFirst ? 0 : 1);

  if (typeWizardFirst) {
    return (
      <div className="flex flex-col">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          What kind of step?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Choose stay or transit. Activities are added inside a stay after you create it.
        </p>
        <div className="mt-6 grid gap-4">
          <button
            type="button"
            onClick={() => {
              onStartStay();
              wizard.push({ id: STEP_WIZARD_IDS.stayStepWizard, step: 0 });
            }}
            className="group flex w-full flex-col items-start gap-2 rounded-2xl border-2 border-zinc-200 bg-white p-5 text-start shadow-sm transition hover:border-violet-400 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-violet-500"
          >
            <span className="text-3xl" aria-hidden>
              🏨
            </span>
            <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Stay</span>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              Hotel, resort, villa — where you sleep
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              onStartTransit();
              wizard.push({ id: STEP_WIZARD_IDS.transitStepWizard, step: 0 });
            }}
            className="group flex w-full flex-col items-start gap-2 rounded-2xl border-2 border-zinc-200 bg-white p-5 text-start shadow-sm transition hover:border-sky-400 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-sky-500"
          >
            <span className="text-3xl" aria-hidden>
              ✈️
            </span>
            <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Transit</span>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              Flights, ferries, trains, transfers between places
            </span>
          </button>
        </div>
        <button
          type="button"
          onClick={() => (wizard.canPop ? wizard.pop() : onClose())}
          className="mt-8 w-full rounded-2xl border border-zinc-200 py-3 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
        >
          {wizard.canPop ? "Back" : "Cancel"}
        </button>
      </div>
    );
  }

  if (step === 0) {
    return (
      <div className="space-y-5 pb-2">
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Choose how you want to set up this step.
        </p>
        <button
          type="button"
          onClick={() => wizard.setTopStep(1)}
          className="group flex w-full flex-col items-start gap-2 rounded-2xl border-2 border-zinc-200 bg-white p-5 text-start shadow-sm transition hover:border-violet-400 hover:shadow-md active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-violet-500"
        >
          <span className="text-2xl" aria-hidden>
            ✨
          </span>
          <span className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Guided setup</span>
          <span className="text-sm leading-snug text-zinc-600 dark:text-zinc-400">
            Type picker next, then stay or transit wizards.
          </span>
          <span className="mt-1 text-xs font-medium text-violet-600 group-hover:underline dark:text-violet-400">
            Continue
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            onStartStayFlatFull();
          }}
          className="group flex w-full flex-col items-start gap-2 rounded-2xl border-2 border-zinc-200 bg-zinc-50/80 p-5 text-start shadow-sm transition hover:border-zinc-400 hover:bg-white hover:shadow-md active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/60 dark:hover:border-zinc-500 dark:hover:bg-zinc-950"
        >
          <span className="text-2xl" aria-hidden>
            ⚙️
          </span>
          <span className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Start in the full editor
          </span>
          <span className="text-sm leading-snug text-zinc-600 dark:text-zinc-400">
            Single screen — default stay template; change type in the editor if needed.
          </span>
          <span className="mt-1 text-xs font-medium text-zinc-600 group-hover:underline dark:text-zinc-400">
            Open editor
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => wizard.setTopStep(0)}
        className="mb-4 self-start text-xs font-medium text-violet-600 dark:text-violet-400"
      >
        ← Back to setup choice
      </button>
      <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        What kind of step?
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Guided setup — pick the step type to open the right wizard.
      </p>
      <div className="mt-6 grid gap-4">
        <button
          type="button"
          onClick={() => {
            onStartStay();
            wizard.push({ id: STEP_WIZARD_IDS.stayStepWizard, step: 0 });
          }}
          className="group flex w-full flex-col items-start gap-2 rounded-2xl border-2 border-zinc-200 bg-white p-5 text-start shadow-sm transition hover:border-violet-400 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-violet-500"
        >
          <span className="text-3xl" aria-hidden>
            🏨
          </span>
          <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Stay</span>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            Hotel, resort, villa — where you sleep
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            onStartTransit();
            wizard.push({ id: STEP_WIZARD_IDS.transitStepWizard, step: 0 });
          }}
          className="group flex w-full flex-col items-start gap-2 rounded-2xl border-2 border-zinc-200 bg-white p-5 text-start shadow-sm transition hover:border-sky-400 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-sky-500"
        >
          <span className="text-3xl" aria-hidden>
            ✈️
          </span>
          <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Transit</span>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            Flights, ferries, trains, transfers between places
          </span>
        </button>
      </div>
      <button
        type="button"
        onClick={() => (wizard.canPop ? wizard.pop() : onClose())}
        className="mt-8 w-full rounded-2xl border border-zinc-200 py-3 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
      >
        {wizard.canPop ? "Back" : "Cancel"}
      </button>
    </div>
  );
}
