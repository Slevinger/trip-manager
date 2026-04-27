"use client";

import type { StayStep } from "@/lib/types/trip";
import { StayStepComboBox } from "@/components/trip/StayStepComboBox";
import { useI18n } from "@/components/providers/I18nProvider";

const inputClass =
  "w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900";

export function TransitStaySelects({
  stays,
  fromStayStepId,
  toStayStepId,
  onChange,
}: {
  stays: StayStep[];
  fromStayStepId?: string;
  toStayStepId?: string;
  onChange: (patch: { fromStayStepId?: string; toStayStepId?: string }) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <StayStepComboBox
        label={t("step.transitFromStay")}
        stays={stays}
        selectedId={fromStayStepId}
        excludeIds={toStayStepId ? [toStayStepId] : undefined}
        placeholder={t("step.transitPickStay")}
        className={inputClass}
        onSelect={(id) => onChange({ fromStayStepId: id })}
      />
      <StayStepComboBox
        label={t("step.transitToStay")}
        stays={stays}
        selectedId={toStayStepId}
        excludeIds={fromStayStepId ? [fromStayStepId] : undefined}
        placeholder={t("step.transitPickStay")}
        className={inputClass}
        onSelect={(id) => onChange({ toStayStepId: id })}
      />
    </div>
  );
}
