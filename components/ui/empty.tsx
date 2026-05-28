import * as React from "react";
import { cn } from "@/lib/ui/cn";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-3xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-muted)]/40 px-6 py-12 text-center",
        className
      )}
    >
      {icon ? (
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-aurora text-white shadow-[var(--shadow-soft)]">
          {icon}
        </div>
      ) : null}
      <p className="text-base font-semibold text-[var(--color-foreground)]">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-[var(--color-muted-foreground)]">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
