import type { Trip, TripStep } from "@/lib/types/trip";
import { tripContentEquals } from "@/lib/store/tripChangeLog";

export type UndoOp =
  | { type: "patch_trip"; patch: Partial<Trip> }
  | { type: "set_steps"; steps: TripStep[] };

function cloneTrip(t: Trip): Trip {
  return JSON.parse(JSON.stringify(t)) as Trip;
}

function cloneSteps(steps: TripStep[]): TripStep[] {
  return JSON.parse(JSON.stringify(steps)) as TripStep[];
}

function renumberOrders(steps: TripStep[]): TripStep[] {
  return steps.map((s, idx) => ({ ...s, order: idx }));
}

function tripFieldPatch(prev: Trip, next: Trip): Partial<Trip> {
  const patch: Partial<Trip> = {};
  const keys: (keyof Trip)[] = [
    "title",
    "budget",
    "managePassword",
    "tripStartDate",
    "tripStartTime",
    "smartTimeline",
    "autoCurrentByDate",
    "tripAttachments",
    "ownerUid",
    "ownerEmail",
    "ownerEmailLower",
    "accessMode",
  ];
  for (const k of keys) {
    if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) {
      (patch as Record<string, unknown>)[k as string] = prev[k];
    }
  }
  return patch;
}

function buildInverseOps(prev: Trip, next: Trip): UndoOp[] {
  const ops: UndoOp[] = [];
  const patch = tripFieldPatch(prev, next);
  for (const k of Object.keys(patch)) {
    ops.push({ type: "patch_trip", patch: { [k]: (patch as Record<string, unknown>)[k] } });
  }
  if (JSON.stringify(prev.steps) !== JSON.stringify(next.steps)) {
    ops.push({ type: "set_steps", steps: cloneSteps(prev.steps) });
  }
  return ops;
}

export function applyUndoOp(trip: Trip, op: UndoOp): Trip {
  switch (op.type) {
    case "patch_trip": {
      const { steps: _s, ...rest } = op.patch;
      const merged = { ...trip, ...rest };
      if (op.patch.steps !== undefined) {
        merged.steps = renumberOrders(cloneSteps(op.patch.steps as TripStep[]));
      }
      return merged;
    }
    case "set_steps":
      return { ...trip, steps: renumberOrders(cloneSteps(op.steps)) };
    default:
      return trip;
  }
}

/**
 * Trip snapshots in **push order** for `userUndoStack` (bottom → top).
 * Each pop undoes one inverse op. Last pushed = first undo from `next`.
 */
export function expandUndoSnapshotsPushOrder(prev: Trip, next: Trip): Trip[] {
  if (tripContentEquals(prev, next)) return [];
  const ops = buildInverseOps(prev, next);
  if (ops.length === 0) return [cloneTrip(prev)];

  const levels: Trip[] = [];
  let cur = cloneTrip(next);
  for (const op of ops) {
    cur = applyUndoOp(cur, op);
    levels.push(cloneTrip(cur));
  }
  if (!tripContentEquals(cur, prev)) {
    return [cloneTrip(prev)];
  }

  return levels.slice().reverse();
}
