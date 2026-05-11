import type { ActivityStep, Money, StayStep, TransitStep, TripStep } from "@/lib/types/trip";

export function formatMoneyDisplay(m: Money): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: m.currency,
      maximumFractionDigits: 2,
    }).format(m.amount);
  } catch {
    return `${m.amount} ${m.currency}`;
  }
}

function sumMoney(parts: readonly Money[]): Money | null {
  if (parts.length === 0) return null;
  const c0 = parts[0]!.currency;
  if (!parts.every((p) => p.currency === c0)) return null;
  return {
    currency: c0,
    amount: parts.reduce((acc, p) => acc + p.amount, 0),
  };
}

/** Sum `price` on each interval; ignores undefined prices. */
export function sumIntervalPrices(intervals: readonly { price?: Money }[]): Money | null {
  const parts = intervals
    .map((i) => i.price)
    .filter((p): p is Money => p != null && Number.isFinite(p.amount));
  return sumMoney(parts);
}

export function activityStepTotalCost(step: ActivityStep): Money | null {
  return sumIntervalPrices(step.stepIntervals);
}

/** Sum of all transit interval prices, plus {@link TransitStep#totalManualPrice} when currencies match the interval sum (or when only manual is set). */
export function transitStepTotalCost(step: TransitStep): Money | null {
  const intervalSum = sumIntervalPrices(step.stepIntervals);
  const manual = step.totalManualPrice;
  if (intervalSum && manual) {
    if (intervalSum.currency !== manual.currency) return intervalSum;
    return { currency: intervalSum.currency, amount: intervalSum.amount + manual.amount };
  }
  if (intervalSum) return intervalSum;
  return manual ?? null;
}

export function stayStepLodgingCost(step: StayStep): Money | null {
  return sumIntervalPrices(step.stepIntervals);
}

export function stayLinkedActivitiesCost(stayId: string, allSteps: readonly TripStep[]): Money | null {
  const activities = allSteps.filter(
    (s): s is ActivityStep => s.stepType === "activity" && s.hostStayStepId === stayId
  );
  const parts: Money[] = [];
  for (const a of activities) {
    const m = activityStepTotalCost(a);
    if (m) parts.push(m);
  }
  return sumMoney(parts);
}

/** Lodging intervals + activities that declare this stay as {@link ActivityStep#hostStayStepId}. */
export function stayStepTotalCost(step: StayStep, allSteps: readonly TripStep[]): Money | null {
  const lodging = stayStepLodgingCost(step);
  const linked = stayLinkedActivitiesCost(step.id, allSteps);
  if (lodging && linked) {
    if (lodging.currency !== linked.currency) return null;
    return { currency: lodging.currency, amount: lodging.amount + linked.amount };
  }
  return lodging ?? linked ?? null;
}

export function stepDisplayTotalCost(step: TripStep, allSteps: readonly TripStep[]): Money | null {
  if (step.stepType === "stay") return stayStepTotalCost(step, allSteps);
  if (step.stepType === "transit") return transitStepTotalCost(step);
  return activityStepTotalCost(step);
}
