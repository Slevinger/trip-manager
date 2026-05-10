import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/ui/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide transition-colors",
  {
    variants: {
      tone: {
        neutral:
          "bg-[var(--color-surface-muted)] text-[var(--color-muted-foreground)] border-[var(--color-border)]",
        brand:
          "bg-[var(--color-brand-soft)] text-[var(--color-brand)] border-transparent",
        coral: "bg-[color-mix(in_oklab,var(--color-accent-coral)_20%,transparent)] text-[var(--color-accent-coral)] border-transparent",
        amber: "bg-[color-mix(in_oklab,var(--color-accent-amber)_22%,transparent)] text-[color-mix(in_oklab,var(--color-accent-amber)_70%,black)] border-transparent",
        mint: "bg-[color-mix(in_oklab,var(--color-accent-mint)_22%,transparent)] text-[color-mix(in_oklab,var(--color-accent-mint)_60%,black)] border-transparent",
        sky: "bg-[color-mix(in_oklab,var(--color-accent-sky)_20%,transparent)] text-[color-mix(in_oklab,var(--color-accent-sky)_60%,black)] border-transparent",
        rose: "bg-[color-mix(in_oklab,var(--color-accent-rose)_22%,transparent)] text-[var(--color-accent-rose)] border-transparent",
        success: "bg-[color-mix(in_oklab,var(--color-success)_20%,transparent)] text-[color-mix(in_oklab,var(--color-success)_55%,black)] border-transparent",
        warning: "bg-[color-mix(in_oklab,var(--color-warning)_22%,transparent)] text-[color-mix(in_oklab,var(--color-warning)_55%,black)] border-transparent",
        danger: "bg-[color-mix(in_oklab,var(--color-danger)_15%,transparent)] text-[var(--color-danger)] border-transparent",
        outline: "bg-transparent text-[var(--color-foreground)] border-[var(--color-border-strong)]",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { badgeVariants };
