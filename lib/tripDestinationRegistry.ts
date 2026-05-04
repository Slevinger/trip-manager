import { newId } from "@/lib/canonicalIds";
import type {
  ActivityStep,
  ActivityStepInterval,
  Destination,
  StayStep,
  StayStepInterval,
  TransitStep,
  TransitStepInterval,
  Trip,
  TripStep,
} from "@/lib/types/trip";

export function destinationFromList(
  list: Destination[],
  id: string | undefined | null
): Destination | undefined {
  if (!id) return undefined;
  return list.find((d) => d.id === id);
}

export function destinationById(trip: Trip, id: string | undefined | null): Destination | undefined {
  return destinationFromList(trip.destinations, id);
}

export function mergeDestinationLists(base: Destination[], upsert: Destination[]): Destination[] {
  const m = new Map(base.map((d) => [d.id, d] as const));
  for (const d of upsert) m.set(d.id, d);
  return Array.from(m.values());
}

/** Replace or append a single registry row by id (normalized strings). */
export function upsertDestinationRow(rows: Destination[], row: Destination): Destination[] {
  const norm = normD(row);
  const idx = rows.findIndex((r) => r.id === norm.id);
  if (idx < 0) return [...rows, norm];
  const next = [...rows];
  next[idx] = norm;
  return next;
}

function normD(d: Destination): Destination {
  return {
    ...d,
    title: d.title ?? "",
    location: d.location ?? "",
    description: d.description ?? "",
  };
}

function ingest(destinations: Destination[], d: Destination | undefined | null): string | undefined {
  if (!d || typeof d !== "object" || !d.id) return undefined;
  const row = normD(d);
  const idx = destinations.findIndex((x) => x.id === row.id);
  if (idx >= 0) destinations[idx] = row;
  else destinations.push(row);
  return row.id;
}

function isLegacyDestinationRef(v: unknown): v is Destination {
  return (
    typeof v === "object" &&
    v !== null &&
    "id" in v &&
    typeof (v as { id: unknown }).id === "string" &&
    "location" in v
  );
}

function stepNeedsLegacyMigration(s: unknown): boolean {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  if (o.stepType === "stay" && isLegacyDestinationRef(o.targetDestination)) return true;
  if (o.stepType === "transit") {
    if (isLegacyDestinationRef(o.fromStay) || isLegacyDestinationRef(o.toStay)) return true;
    if (isLegacyDestinationRef(o.targetDestination)) return true;
  }
  if (o.stepType === "activity") {
    if (isLegacyDestinationRef(o.destination) || isLegacyDestinationRef(o.targetDestination)) return true;
  }
  const intervals = o.stepIntervals;
  if (!Array.isArray(intervals)) return false;
  for (const int of intervals) {
    if (!int || typeof int !== "object") continue;
    const i = int as Record<string, unknown>;
    if (i.intervalType === "transit") {
      if (isLegacyDestinationRef(i.sourceDestination) || isLegacyDestinationRef(i.targetDestination))
        return true;
    }
    if (i.intervalType === "activity" && isLegacyDestinationRef(i.destination)) return true;
  }
  return false;
}

function migrateStayInterval(
  int: StayStepInterval,
  destinations: Destination[]
): StayStepInterval {
  if (int.intervalType !== "stay") return int;
  if (int.destinationId) return int;
  const loc = (int.location ?? "").trim();
  const c = int.coordinates;
  if (!loc && !c) return int;
  const id = newId();
  destinations.push(
    normD({
      id,
      title: (int.title ?? "").trim() || loc || "Stay",
      location: loc || (int.title ?? "").trim() || "—",
      description: loc || (int.title ?? "").trim() || "",
      ...(c && Number.isFinite(c.lat) && Number.isFinite(c.lon)
        ? { coordinates: { lat: c.lat, lon: c.lon } }
        : {}),
    })
  );
  return { ...int, destinationId: id };
}

/**
 * Converts Firestore / local JSON that still embeds {@link Destination} objects on steps
 * into `trip.destinations` + id references. No-op if already migrated.
 */
export function migrateTripToDestinationRegistry(data: unknown): Trip {
  const raw = data as Record<string, unknown>;
  const stepsIn = Array.isArray(raw.steps) ? raw.steps : [];
  if (!stepsIn.some((s) => stepNeedsLegacyMigration(s))) {
    const t = data as Trip;
    return {
      ...t,
      destinations: Array.isArray(t.destinations) ? t.destinations.map(normD) : [],
    };
  }

  const destinations: Destination[] = Array.isArray(raw.destinations)
    ? (raw.destinations as Destination[]).map(normD)
    : [];

  const steps: TripStep[] = stepsIn.map((s): TripStep => {
    if (!s || typeof s !== "object") throw new Error("Invalid step");
    const o = s as Record<string, unknown>;
    const base = {
      id: String(o.id ?? newId()),
      order: Number(o.order) || 0,
      title: String(o.title ?? ""),
      startTime: String(o.startTime ?? ""),
      endTime: o.endTime != null ? String(o.endTime) : undefined,
      notes: Array.isArray(o.notes) ? (o.notes as string[]) : undefined,
      warnings: Array.isArray(o.warnings) ? (o.warnings as Trip["warnings"]) : undefined,
    };

    if (o.stepType === "stay") {
      const td = o.targetDestination as Destination | undefined;
      const targetDestinationId = ingest(destinations, td) ?? newId();
      if (!destinations.some((d) => d.id === targetDestinationId)) {
        destinations.push(normD(emptyDestinationWithId(targetDestinationId)));
      }
      const intervals = (Array.isArray(o.stepIntervals) ? o.stepIntervals : []) as StayStepInterval[];
      const nextIntervals = intervals.map((int) =>
        int.intervalType === "stay" ? migrateStayInterval(int, destinations) : int
      );
      return {
        ...base,
        stepType: "stay",
        targetDestinationId,
        stepIntervals: nextIntervals,
        manualEndStayTime:
          o.manualEndStayTime != null ? String(o.manualEndStayTime) : undefined,
        ...(typeof o.areaCenterDestinationId === "string" && o.areaCenterDestinationId.trim()
          ? { areaCenterDestinationId: o.areaCenterDestinationId.trim() }
          : {}),
      } as StayStep;
    }

    if (o.stepType === "transit") {
      const fromId = ingest(destinations, o.fromStay as Destination) ?? newId();
      const toId = ingest(destinations, o.toStay as Destination) ?? newId();
      const legId = ingest(destinations, o.targetDestination as Destination) ?? newId();
      for (const id of [fromId, toId, legId]) {
        if (!destinations.some((d) => d.id === id)) {
          destinations.push(normD(emptyDestinationWithId(id)));
        }
      }
      const intervals = (Array.isArray(o.stepIntervals) ? o.stepIntervals : []) as TransitStepInterval[];
      const nextIntervals = intervals.map((int) => {
        if (int.intervalType !== "transit") return int;
        const raw = int as unknown as Record<string, unknown>;
        const src = ingest(destinations, raw.sourceDestination as Destination | undefined);
        const tgt = ingest(destinations, raw.targetDestination as Destination | undefined);
        const ti = int as TransitStepInterval;
        const { sourceDestination: _s, targetDestination: _t, ...rest } = raw as Record<string, unknown> & {
          sourceDestination?: unknown;
          targetDestination?: unknown;
        };
        return {
          ...(rest as Omit<TransitStepInterval, "fromDestinationId" | "toDestinationId">),
          fromDestinationId: src ?? ti.fromDestinationId,
          toDestinationId: tgt ?? ti.toDestinationId,
        } as TransitStepInterval;
      });
      return {
        ...base,
        stepType: "transit",
        fromStayId: fromId,
        toStayId: toId,
        targetDestinationId: legId,
        stepIntervals: nextIntervals,
        totalManualPrice: o.totalManualPrice as TransitStep["totalManualPrice"],
      } as TransitStep;
    }

    if (o.stepType === "activity") {
      const dest = o.destination as Destination | undefined;
      const tgt = o.targetDestination as Destination | undefined;
      const destId = ingest(destinations, dest) ?? newId();
      const tgtId = ingest(destinations, tgt) ?? destId;
      for (const id of [destId, tgtId]) {
        if (!destinations.some((d) => d.id === id)) {
          destinations.push(normD(emptyDestinationWithId(id)));
        }
      }
      const intervals = (Array.isArray(o.stepIntervals) ? o.stepIntervals : []) as ActivityStepInterval[];
      const nextIntervals = intervals.map((int) => {
        if (int.intervalType !== "activity") return int;
        const raw = int as unknown as Record<string, unknown>;
        const slotId = ingest(destinations, raw.destination as Destination | undefined);
        const { destination: _d, ...rest } = raw as Record<string, unknown> & { destination?: unknown };
        return {
          ...(rest as Omit<ActivityStepInterval, "destinationId">),
          ...(slotId ? { destinationId: slotId } : {}),
        } as ActivityStepInterval;
      });
      return {
        ...base,
        stepType: "activity",
        destinationId: destId,
        targetDestinationId: tgtId,
        stepIntervals: nextIntervals,
      } as ActivityStep;
    }

    throw new Error(`Unknown stepType: ${String(o.stepType)}`);
  });

  return {
    ...(data as Trip),
    destinations,
    steps,
  };
}

function emptyDestinationWithId(id: string): Destination {
  return { id, title: "", location: "", description: "" };
}

/** One place a {@link Trip#destinations} id appears on a step (for roster / debugging). */
export type DestinationIdReference = {
  stepId: string;
  stepTitle: string;
  stepType: TripStep["stepType"];
  /** What on that step points at this destination id. */
  label: string;
};

function briefIntervalRange(startIso: string, endIso: string): string {
  try {
    const a = new Date(startIso);
    const b = new Date(endIso);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "";
    const opt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${a.toLocaleDateString(undefined, opt)}–${b.toLocaleDateString(undefined, opt)}`;
  } catch {
    return "";
  }
}

/**
 * Every step/interval field on `steps` that references `destinationId` (sorted in the order steps are passed).
 */
export function collectReferencesToDestinationId(
  destinationId: string,
  steps: TripStep[]
): DestinationIdReference[] {
  const out: DestinationIdReference[] = [];
  for (const step of steps) {
    const stepTitle = (step.title || "Untitled step").trim() || "Untitled step";
    if (step.stepType === "stay") {
      const s = step as StayStep;
      if (s.targetDestinationId === destinationId) {
        out.push({
          stepId: s.id,
          stepTitle,
          stepType: "stay",
          label: "Stay — default place (targetDestinationId)",
        });
      }
      if (s.areaCenterDestinationId === destinationId) {
        out.push({
          stepId: s.id,
          stepTitle,
          stepType: "stay",
          label: "Stay — area center (areaCenterDestinationId)",
        });
      }
      for (const int of s.stepIntervals) {
        if (int.intervalType !== "stay") continue;
        const si = int as StayStepInterval;
        if (si.destinationId === destinationId) {
          const range = briefIntervalRange(si.startTime, si.endTime);
          const slot = (si.title || "Stay period").trim() || "Stay period";
          out.push({
            stepId: s.id,
            stepTitle,
            stepType: "stay",
            label: `Stay — ${slot}${range ? ` (${range})` : ""} · interval destinationId`,
          });
        }
      }
    } else if (step.stepType === "transit") {
      const t = step as TransitStep;
      if (t.fromStayId === destinationId) {
        out.push({
          stepId: t.id,
          stepTitle,
          stepType: "transit",
          label: "Transit — start hub (fromStayId)",
        });
      }
      if (t.toStayId === destinationId) {
        out.push({
          stepId: t.id,
          stepTitle,
          stepType: "transit",
          label: "Transit — end hub (toStayId)",
        });
      }
      if (t.targetDestinationId === destinationId) {
        out.push({
          stepId: t.id,
          stepTitle,
          stepType: "transit",
          label: "Transit — step-level place (targetDestinationId)",
        });
      }
      for (const int of t.stepIntervals) {
        if (int.intervalType !== "transit") continue;
        const ti = int as TransitStepInterval;
        const range = briefIntervalRange(ti.startTime, ti.endTime);
        const leg = (ti.title || "Leg").trim() || "Leg";
        if (ti.fromDestinationId === destinationId) {
          out.push({
            stepId: t.id,
            stepTitle,
            stepType: "transit",
            label: `Transit — ${leg}${range ? ` (${range})` : ""} · from (fromDestinationId)`,
          });
        }
        if (ti.toDestinationId === destinationId) {
          out.push({
            stepId: t.id,
            stepTitle,
            stepType: "transit",
            label: `Transit — ${leg}${range ? ` (${range})` : ""} · to (toDestinationId)`,
          });
        }
      }
    } else {
      const a = step as ActivityStep;
      if (a.destinationId === destinationId) {
        out.push({
          stepId: a.id,
          stepTitle,
          stepType: "activity",
          label: "Activity — place (destinationId)",
        });
      }
      if (a.targetDestinationId === destinationId) {
        out.push({
          stepId: a.id,
          stepTitle,
          stepType: "activity",
          label: "Activity — target (targetDestinationId)",
        });
      }
      for (const int of a.stepIntervals) {
        if (int.intervalType !== "activity") continue;
        const ai = int as ActivityStepInterval;
        if (ai.destinationId === destinationId) {
          const range = briefIntervalRange(ai.startTime, ai.endTime);
          const slot = (ai.title || "Slot").trim() || "Slot";
          out.push({
            stepId: a.id,
            stepTitle,
            stepType: "activity",
            label: `Activity — ${slot}${range ? ` (${range})` : ""} · interval destinationId`,
          });
        }
      }
    }
  }
  return out;
}

/** Destination ids referenced by a single step (including interval refs). */
export function collectReferencedDestinationIdsFromStep(step: TripStep): Set<string> {
  const ids = new Set<string>();
  if (step.stepType === "stay") {
    ids.add(step.targetDestinationId);
    if (step.areaCenterDestinationId) ids.add(step.areaCenterDestinationId);
    for (const int of step.stepIntervals) {
      if (int.intervalType === "stay" && int.destinationId) ids.add(int.destinationId);
    }
  } else if (step.stepType === "transit") {
    ids.add(step.fromStayId);
    ids.add(step.toStayId);
    ids.add(step.targetDestinationId);
    for (const int of step.stepIntervals) {
      if (int.intervalType === "transit") {
        const ti = int as TransitStepInterval;
        if (ti.fromDestinationId) ids.add(ti.fromDestinationId);
        if (ti.toDestinationId) ids.add(ti.toDestinationId);
      }
    }
  } else {
    const a = step as ActivityStep;
    ids.add(a.destinationId);
    ids.add(a.targetDestinationId);
    for (const int of a.stepIntervals) {
      if (int.intervalType === "activity" && int.destinationId) ids.add(int.destinationId);
    }
  }
  return ids;
}

/** All destination ids referenced by the given steps (including interval refs). */
export function collectReferencedDestinationIdsFromSteps(steps: TripStep[]): Set<string> {
  const ids = new Set<string>();
  for (const s of steps) {
    for (const id of collectReferencedDestinationIdsFromStep(s)) ids.add(id);
  }
  return ids;
}

/** All destination ids referenced by steps (including interval refs). */
export function collectReferencedDestinationIds(trip: Trip): Set<string> {
  return collectReferencedDestinationIdsFromSteps(trip.steps);
}

/** Drops registry rows not referenced by any step (safe after edits). */
export function pruneUnreferencedDestinations(trip: Trip): Trip {
  const keep = collectReferencedDestinationIds(trip);
  return {
    ...trip,
    destinations: trip.destinations.filter((d) => keep.has(d.id)),
  };
}

export function normalizeTripDestinationRows(trip: Trip): Trip {
  return {
    ...trip,
    destinations: trip.destinations.map(normD),
  };
}
