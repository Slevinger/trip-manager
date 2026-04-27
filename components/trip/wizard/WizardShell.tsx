"use client";

import type { ReactNode } from "react";

type WizardShellProps = {
  title: string;
  description?: string;
  /** Zero-based index of the current step */
  currentStepIndex: number;
  totalSteps: number;
  /** Announced when step changes (accessibility) */
  announce?: string;
  children: ReactNode;
  footer: ReactNode;
};

export function WizardShell({
  title,
  description,
  currentStepIndex,
  totalSteps,
  announce,
  children,
  footer,
}: WizardShellProps) {
  const safeTotal = Math.max(1, totalSteps);
  const filled = Math.min(safeTotal, currentStepIndex + 1);

  return (
    <div className="flex min-h-0 flex-col">
      {announce ? (
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      ) : null}
      <div
        className="mb-4 flex gap-1"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={safeTotal}
        aria-valuenow={filled}
        aria-label={`${filled} / ${safeTotal}`}
      >
        {Array.from({ length: safeTotal }, (_, i) => (
          <div
            key={i}
            className={`h-1.5 min-w-0 flex-1 rounded-full transition-all duration-300 ease-out ${
              i <= currentStepIndex
                ? "bg-zinc-900 dark:bg-white"
                : "bg-zinc-200 dark:bg-zinc-800"
            }`}
          />
        ))}
      </div>
      <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {title}
      </h2>
      {description ? (
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {description}
        </p>
      ) : null}
      <div className="mt-6 min-h-[min(40vh,280px)] flex-1 space-y-4">{children}</div>
      <div className="mt-8 shrink-0 space-y-3 border-t border-zinc-100 pt-5 dark:border-zinc-800">
        {footer}
      </div>
    </div>
  );
}

export function WizardPrimaryButton({
  children,
  disabled,
  onClick,
  type = "button",
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-zinc-900 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 active:scale-[0.99] dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
    >
      {children}
    </button>
  );
}

export function WizardSecondaryButton({
  children,
  onClick,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className="flex min-h-[48px] w-full items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
    >
      {children}
    </button>
  );
}
