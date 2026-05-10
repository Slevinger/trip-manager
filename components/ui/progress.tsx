"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/ui/cn";

export const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & { tone?: "brand" | "mint" | "coral" | "sky" }
>(({ className, value, tone = "brand", ...props }, ref) => {
  const fill =
    tone === "mint"
      ? "bg-[var(--color-accent-mint)]"
      : tone === "coral"
        ? "bg-[var(--color-accent-coral)]"
        : tone === "sky"
          ? "bg-[var(--color-accent-sky)]"
          : "bg-gradient-brand";
  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-muted)]",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn("h-full w-full flex-1 transition-transform duration-500 ease-out", fill)}
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = ProgressPrimitive.Root.displayName;
