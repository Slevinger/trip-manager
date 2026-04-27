import type {
  ArrivalOption,
  Hotel,
  TransportOption,
  Trip,
  TripStep,
} from "@/lib/types/trip";
import {
  jsonEq,
  summarizeTripChange,
  tripContentEquals,
  type TripLedgerDraft,
} from "@/lib/store/tripChangeLog";

function diffHotels(stepId: string, prev: Hotel[], next: Hotel[], out: TripLedgerDraft[]) {
  const pId = new Map(prev.map((h) => [h.id, h]));
  const nId = new Map(next.map((h) => [h.id, h]));
  for (const h of prev) {
    if (!nId.has(h.id)) {
      out.push({
        kind: "deleted",
        entity: "hotel",
        stepId,
        entityId: h.id,
        summary: `Hotel removed: ${h.name || h.id}`,
      });
    }
  }
  for (const h of next) {
    if (!pId.has(h.id)) {
      out.push({
        kind: "added",
        entity: "hotel",
        stepId,
        entityId: h.id,
        summary: `Hotel added: ${h.name || h.id}`,
      });
    }
  }
  for (const h of next) {
    const p = pId.get(h.id);
    if (p && !jsonEq(p, h)) {
      out.push({
        kind: "updated",
        entity: "hotel",
        stepId,
        entityId: h.id,
        summary: `Hotel updated: ${h.name || h.id}`,
      });
    }
  }
}

function diffTransports(
  stepId: string,
  prev: TransportOption[],
  next: TransportOption[],
  out: TripLedgerDraft[]
) {
  const pId = new Map(prev.map((t) => [t.id, t]));
  const nId = new Map(next.map((t) => [t.id, t]));
  for (const t of prev) {
    if (!nId.has(t.id)) {
      out.push({
        kind: "deleted",
        entity: "transport",
        stepId,
        entityId: t.id,
        summary: `Transport removed: ${t.title || t.id}`,
      });
    }
  }
  for (const t of next) {
    if (!pId.has(t.id)) {
      out.push({
        kind: "added",
        entity: "transport",
        stepId,
        entityId: t.id,
        summary: `Transport added: ${t.title || t.id}`,
      });
    }
  }
  for (const t of next) {
    const p = pId.get(t.id);
    if (p && !jsonEq(p, t)) {
      out.push({
        kind: "updated",
        entity: "transport",
        stepId,
        entityId: t.id,
        summary: `Transport updated: ${t.title || t.id}`,
      });
    }
  }
}

function diffArrivals(
  stepId: string,
  prev: ArrivalOption[],
  next: ArrivalOption[],
  out: TripLedgerDraft[]
) {
  const pId = new Map(prev.map((a) => [a.id, a]));
  const nId = new Map(next.map((a) => [a.id, a]));
  for (const a of prev) {
    if (!nId.has(a.id)) {
      out.push({
        kind: "deleted",
        entity: "arrivalOption",
        stepId,
        entityId: a.id,
        summary: `Arrival option removed: ${a.title || a.id}`,
      });
    }
  }
  for (const a of next) {
    if (!pId.has(a.id)) {
      out.push({
        kind: "added",
        entity: "arrivalOption",
        stepId,
        entityId: a.id,
        summary: `Arrival option added: ${a.title || a.id}`,
      });
    }
  }
  for (const a of next) {
    const p = pId.get(a.id);
    if (p && !jsonEq(p, a)) {
      out.push({
        kind: "updated",
        entity: "arrivalOption",
        stepId,
        entityId: a.id,
        summary: `Arrival option updated: ${a.title || a.id}`,
      });
    }
  }
}

function diffNestedStep(prev: TripStep, next: TripStep, out: TripLedgerDraft[]) {
  const id = next.id;
  diffArrivals(id, prev.arrivalOptions, next.arrivalOptions, out);
  if (prev.type === "stay" && next.type === "stay") {
    diffHotels(id, prev.hotels, next.hotels, out);
  }
  if (prev.type === "transit" && next.type === "transit") {
    diffTransports(id, prev.transports, next.transports, out);
  }
}

/** Structured change rows for the trip ledger (created / updated / deleted / added). */
export function buildLedgerDrafts(prev: Trip | null, next: Trip): TripLedgerDraft[] {
  const out: TripLedgerDraft[] = [];
  if (!prev) {
    out.push({
      kind: "updated",
      entity: "trip",
      summary: "Trip loaded",
    });
    return out;
  }

  if (prev.title !== next.title) {
    out.push({ kind: "updated", entity: "trip", summary: "Title" });
  }
  if (prev.budget !== next.budget) {
    out.push({ kind: "updated", entity: "trip", summary: "Budget" });
  }
  if (prev.managePassword !== next.managePassword) {
    out.push({ kind: "updated", entity: "trip", summary: "Manage password" });
  }
  if (prev.tripStartDate !== next.tripStartDate || prev.tripStartTime !== next.tripStartTime) {
    out.push({ kind: "updated", entity: "trip", summary: "Trip start" });
  }
  if (prev.smartTimeline !== next.smartTimeline) {
    out.push({ kind: "updated", entity: "trip", summary: "Smart timeline" });
  }
  if (prev.autoCurrentByDate !== next.autoCurrentByDate) {
    out.push({ kind: "updated", entity: "trip", summary: "Auto current step by date" });
  }
  if (!jsonEq(prev.tripAttachments, next.tripAttachments)) {
    out.push({ kind: "updated", entity: "tripAttachment", summary: "Trip attachments" });
  }

  const prevById = new Map(prev.steps.map((s) => [s.id, s] as const));
  const nextById = new Map(next.steps.map((s) => [s.id, s] as const));

  for (const [id, s] of prevById) {
    if (!nextById.has(id)) {
      out.push({
        kind: "deleted",
        entity: "step",
        entityId: id,
        summary: `Step deleted: ${s.title || id}`,
      });
    }
  }
  for (const [id, s] of nextById) {
    if (!prevById.has(id)) {
      out.push({
        kind: "created",
        entity: "step",
        entityId: id,
        summary: `Step created: ${s.title || id}`,
      });
    }
  }
  for (const [id, n] of nextById) {
    const p = prevById.get(id);
    if (!p) continue;
    if (!jsonEq(p, n)) {
      out.push({
        kind: "updated",
        entity: "step",
        entityId: id,
        summary: `Step updated: ${n.title || id}`,
      });
      if (p.type === n.type) diffNestedStep(p, n, out);
    }
  }

  if (out.length === 0 && !tripContentEquals(prev, next)) {
    out.push({
      kind: "updated",
      entity: "trip",
      summary: summarizeTripChange(prev, next),
    });
  }

  return out;
}
