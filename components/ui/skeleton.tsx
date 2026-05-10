import * as React from "react";
import { cn } from "@/lib/ui/cn";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-2xl bg-[color-mix(in_oklab,var(--color-muted)_70%,transparent)]",
        className
      )}
      {...props}
    />
  );
}
