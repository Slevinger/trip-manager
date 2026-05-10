"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n/context";
import type { Trip, TripRecommendation } from "@/lib/types/trip";
import { Badge } from "@/components/ui/badge";

interface Props {
  trip: Trip;
  /** Filter to a particular kind for screen-specific surfaces. */
  kind?: TripRecommendation["kind"];
  /** Hand-off to open the SmartDock; if omitted just renders cards as static. */
  onOpenAgent?: () => void;
  className?: string;
}

export function InlineAgentSuggestions({ trip, kind, onOpenAgent, className }: Props) {
  const { t } = useI18n();
  const recs = (trip.recommendations ?? []).filter((r) => (kind ? r.kind === kind : true));
  if (recs.length === 0) return null;
  const top = recs.slice(0, 3);
  return (
    <section
      className={
        "rounded-3xl border border-[var(--color-border)] bg-mesh-soft px-4 py-3 " +
        (className ?? "")
      }
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          <Sparkles className="h-3.5 w-3.5 text-[var(--color-brand)]" />
          {t("agent.inlineHeading")}
        </p>
        {onOpenAgent ? (
          <button
            type="button"
            onClick={onOpenAgent}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--color-brand)] hover:underline"
          >
            {t("agent.inlineCta")} <ArrowRight className="h-3 w-3" />
          </button>
        ) : (
          <Link
            href={`/trip/${trip.id}`}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--color-brand)] hover:underline"
          >
            {t("agent.inlineCta")} <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {top.map((rec) => {
          const tone =
            rec.kind === "stay" ? "brand" : rec.kind === "transit" ? "sky" : "mint";
          const optionTitle =
            rec.options[0]?.label?.trim() ||
            rec.options[0]?.interval.title.trim() ||
            t("recs.optionFallback", { index: 1 });
          return (
            <motion.div
              key={rec.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm shadow-[var(--shadow-soft)]"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <Badge tone={tone}>{rec.kind}</Badge>
                {rec.seen ? null : <Badge tone="coral">{t("recs.newPill")}</Badge>}
              </div>
              <p className="font-semibold text-[var(--color-foreground)]">{rec.title?.trim() || optionTitle}</p>
              {rec.note ? (
                <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-muted-foreground)]">
                  {rec.note}
                </p>
              ) : null}
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
