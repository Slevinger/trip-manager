import type { StayStep, TripStep } from "@/lib/types/trip";

export function stayStepsSorted(steps: TripStep[]): StayStep[] {
  return [...steps]
    .filter((s): s is StayStep => s.type === "stay")
    .sort((a, b) => a.order - b.order);
}

export function stayStepOptionLabel(step: StayStep): string {
  const title = step.title.trim();
  const loc = step.location.trim();
  if (title && loc) return `${title} — ${loc}`;
  return title || loc || "…";
}

export function stayById(steps: TripStep[], id: string): StayStep | undefined {
  const s = steps.find((x) => x.id === id);
  return s?.type === "stay" ? s : undefined;
}
