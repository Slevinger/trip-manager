"use client";

import * as React from "react";
import { cn } from "@/lib/ui/cn";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "sm" | "md";
  variant?: "ghost" | "soft" | "outline";
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, label, size = "md", variant = "ghost", ...props }, ref) => {
    const sizeCls = size === "sm" ? "h-8 w-8" : "h-9 w-9";
    const variantCls =
      variant === "soft"
        ? "bg-[var(--color-surface-muted)] hover:bg-[var(--color-muted)]"
        : variant === "outline"
          ? "border border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
          : "hover:bg-[var(--color-surface-muted)]";
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={cn(
          "inline-flex items-center justify-center rounded-xl text-[var(--color-foreground)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-50",
          sizeCls,
          variantCls,
          className
        )}
        {...props}
      />
    );
  }
);
IconButton.displayName = "IconButton";
