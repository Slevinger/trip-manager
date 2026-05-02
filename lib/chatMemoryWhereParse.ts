import type { ChatMemoryTripWhere } from "@/lib/types/user";

/** Parse `where` on a stored chat memory row (Firestore / API body). */
export function parseChatMemoryWhere(raw: unknown): ChatMemoryTripWhere | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const tripId = typeof o.tripId === "string" ? o.tripId : "";
  const tripTitle = typeof o.tripTitle === "string" ? o.tripTitle : "";
  const tripPhase =
    o.tripPhase === "before_start" || o.tripPhase === "during" || o.tripPhase === "after_end"
      ? o.tripPhase
      : undefined;
  const stepFocus =
    o.stepFocus === "active" || o.stepFocus === "upcoming" || o.stepFocus === "none"
      ? o.stepFocus
      : undefined;
  const summary = typeof o.summary === "string" ? o.summary : "";
  if (!tripId || !tripPhase || !stepFocus || !summary.trim()) return undefined;
  const stepType =
    o.stepType === "stay" || o.stepType === "transit" || o.stepType === "activity" ? o.stepType : undefined;
  return {
    tripId,
    tripTitle: tripTitle || "Trip",
    tripPhase,
    stepFocus,
    stepId: typeof o.stepId === "string" ? o.stepId : undefined,
    stepTitle: typeof o.stepTitle === "string" ? o.stepTitle : undefined,
    stepType,
    intervalFlavor: typeof o.intervalFlavor === "string" ? o.intervalFlavor : undefined,
    placeTitle: typeof o.placeTitle === "string" ? o.placeTitle : undefined,
    summary: summary.slice(0, 500),
  };
}
