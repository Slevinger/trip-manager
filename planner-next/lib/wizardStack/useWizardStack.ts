import { useCallback, useMemo, useState } from "react";
import type { WizardFrame } from "@/lib/wizardStack/types";

export type WizardStackControls = {
  stack: WizardFrame[];
  /** Top frame (active wizard + step). */
  top: WizardFrame | undefined;
  /** More than one frame → {@link pop} returns to parent wizard. */
  canPop: boolean;
  /** Append a frame (nest a sub-wizard). */
  push: (frame: WizardFrame) => void;
  /** Remove top frame. No-op if only one frame. */
  pop: () => void;
  /** Replace the entire stack (dialog reset / hard navigation). */
  reset: (frames: WizardFrame[]) => void;
  /** Swap the top frame’s id/step/payload (same depth). */
  replaceTop: (frame: WizardFrame) => void;
  /** Set `step` on the top frame only. */
  setTopStep: (step: number) => void;
};

export function useWizardStack(initial: WizardFrame[]): WizardStackControls {
  const [stack, setStack] = useState<WizardFrame[]>(initial);

  const push = useCallback((frame: WizardFrame) => {
    setStack((s) => [...s, frame]);
  }, []);

  const pop = useCallback(() => {
    setStack((s) => (s.length <= 1 ? s : s.slice(0, -1)));
  }, []);

  const reset = useCallback((frames: WizardFrame[]) => {
    setStack(frames.length ? frames : []);
  }, []);

  const replaceTop = useCallback((frame: WizardFrame) => {
    setStack((s) => (s.length ? [...s.slice(0, -1), frame] : [frame]));
  }, []);

  const setTopStep = useCallback((step: number) => {
    setStack((s) => {
      if (!s.length) return s;
      const t = s[s.length - 1];
      return [...s.slice(0, -1), { ...t, step }];
    });
  }, []);

  return useMemo(() => {
    const top = stack[stack.length - 1];
    const canPop = stack.length > 1;
    return {
      stack,
      top,
      canPop,
      push,
      pop,
      reset,
      replaceTop,
      setTopStep,
    };
  }, [stack, push, pop, reset, replaceTop, setTopStep]);
}
