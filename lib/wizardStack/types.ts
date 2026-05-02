/**
 * One frame on the wizard stack: a named flow + current step index inside that flow.
 * **Push** to nest a sub-wizard (child completes → **pop** returns to the parent).
 * **Replace top** to swap the active flow without changing depth.
 */
export type WizardFrame = {
  id: string;
  step: number;
  /** Optional opaque data for the frame (e.g. `intervalIndex` for interval wizards). */
  payload?: Record<string, unknown>;
};

/**
 * Canonical manage-step flows (planner-next).
 * 1. {@link STEP_WIZARD_IDS.stepWizard} — root type / setup
 * 2. {@link STEP_WIZARD_IDS.stayStepWizard} — stay step–level fields
 * 3. {@link STEP_WIZARD_IDS.stayStepIntervalWizard} — one stay interval
 * 4. {@link STEP_WIZARD_IDS.transitStepWizard} — transit step–level fields
 * 5. {@link STEP_WIZARD_IDS.transitStepIntervalWizard} — one transit interval
 * 6. {@link STEP_WIZARD_IDS.activityStepIntervalWizard} — one activity interval
 */
export const STEP_WIZARD_IDS = {
  /** 1. Root: pick step type; or setup (guided vs full) then pick type. */
  stepWizard: "stepWizard",
  /** 2. Stay step (title, target place, step notes). */
  stayStepWizard: "stayStepWizard",
  /** 3. Stay interval; use `payload.intervalIndex` (default `0`). */
  stayStepIntervalWizard: "stayStepIntervalWizard",
  /** 4. Transit step (title, from/to route). */
  transitStepWizard: "transitStepWizard",
  /** 5. Transit interval; use `payload.intervalIndex` (default `0`). */
  transitStepIntervalWizard: "transitStepIntervalWizard",
  /** 6. Activity interval / slot; use `payload.intervalIndex` (default `0`). */
  activityStepIntervalWizard: "activityStepIntervalWizard",
  /** Single-screen editor (edit existing or “full editor” new stay). */
  flatEdit: "flatEdit",
} as const;

export type StepWizardId = (typeof STEP_WIZARD_IDS)[keyof typeof STEP_WIZARD_IDS];

export function intervalIndexFromFrame(frame: WizardFrame | undefined): number {
  const raw = frame?.payload?.intervalIndex;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw);
  }
  return 0;
}
