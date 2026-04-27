import type { Trip } from "@/lib/types/trip";

export type TripChangeSource = "remote" | "user" | "auto_status" | "undo";

export type TripChangeKind = "created" | "updated" | "deleted" | "added";

export type TripLedgerEntity =
  | "trip"
  | "step"
  | "hotel"
  | "transport"
  | "arrivalOption"
  | "tripAttachment";

export type TripChangeLogEntry = {
  id: string;
  at: string;
  source: TripChangeSource;
  kind: TripChangeKind;
  entity: TripLedgerEntity;
  /** Step id for step-level rows; parent for nested rows. */
  stepId?: string;
  /** Nested row id (hotel, transport, arrival) or attachment id where relevant. */
  entityId?: string;
  summary: string;
};

/** Builder output before id / at / source are attached. */
export type TripLedgerDraft = Omit<TripChangeLogEntry, "id" | "at" | "source">;

export function tripDataEquals(a: Trip | null, b: Trip | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Same trip for planning purposes (ignores server sync timestamps on the document). */
export function tripContentEquals(a: Trip | null, b: Trip | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const { createdAt: _ca, updatedAt: _ua, ...aRest } = a;
  const { createdAt: _cb, updatedAt: _ub, ...bRest } = b;
  return JSON.stringify(aRest) === JSON.stringify(bRest);
}

export function jsonEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Short human-readable diff for audit log / console (fallback). */
export function summarizeTripChange(prev: Trip | null, next: Trip): string {
  if (!prev) return "Trip loaded";
  const bits: string[] = [];
  if (prev.title !== next.title) bits.push("title");
  if (prev.budget !== next.budget) bits.push("budget");
  if (prev.managePassword !== next.managePassword) bits.push("manage password");
  if (prev.tripStartDate !== next.tripStartDate || prev.tripStartTime !== next.tripStartTime) {
    bits.push("trip start");
  }
  if (prev.smartTimeline !== next.smartTimeline) bits.push("smart timeline");
  if (prev.autoCurrentByDate !== next.autoCurrentByDate) bits.push("auto current by date");
  if (prev.steps.length !== next.steps.length) {
    bits.push(`steps (${prev.steps.length}→${next.steps.length})`);
  }
  let stepEdits = 0;
  const byId = new Map(prev.steps.map((s) => [s.id, s]));
  for (const s of next.steps) {
    const p = byId.get(s.id);
    if (!p || JSON.stringify(p) !== JSON.stringify(s)) stepEdits += 1;
  }
  if (stepEdits) bits.push(`${stepEdits} step edit(s)`);
  if (JSON.stringify(prev.tripAttachments) !== JSON.stringify(next.tripAttachments)) {
    bits.push("trip attachments");
  }
  return bits.length > 0 ? bits.join(", ") : "trip updated";
}
