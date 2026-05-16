/**
 * Pure function that applies a sequence of {@link TripAction}s to a Trip,
 * producing a new Trip object.  Never mutates the input.
 *
 * Uses the same helpers as the manage workspace so the result is always
 * in a canonical, persist-ready state.
 */

import { newId } from "@/lib/canonicalIds";
import {
  mergeDestinationLists,
  pruneUnreferencedDestinations,
  upsertDestinationRow,
} from "@/lib/tripDestinationRegistry";
import {
  normalizeStepOrders,
  normalizeTripForPersist,
  syncStepTimesFromIntervals,
} from "@/lib/canonicalStepBuilders";
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
import type { TripAction } from "@/lib/tripAssistantActionSchema";

type AnyInterval = StayStepInterval | TransitStepInterval | ActivityStepInterval;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapStep(steps: TripStep[], stepId: string, fn: (s: TripStep) => TripStep): TripStep[] {
  return steps.map((s) => (s.id === stepId ? fn(s) : s));
}

function syncStep(step: TripStep): TripStep {
  return syncStepTimesFromIntervals(step);
}

function getIntervals(step: TripStep): AnyInterval[] {
  return step.stepIntervals as AnyInterval[];
}

function withIntervals(step: TripStep, intervals: AnyInterval[]): TripStep {
  if (step.stepType === "stay") {
    return { ...step, stepIntervals: intervals as StayStepInterval[] } as StayStep;
  }
  if (step.stepType === "transit") {
    return { ...step, stepIntervals: intervals as TransitStepInterval[] } as TransitStep;
  }
  return { ...step, stepIntervals: intervals as ActivityStepInterval[] } as ActivityStep;
}

// ---------------------------------------------------------------------------
// Individual action handlers
// ---------------------------------------------------------------------------

function applyAction(trip: Trip, action: TripAction): Trip {
  switch (action.type) {
    // ── Steps ──────────────────────────────────────────────────────────────
    case "update_step": {
      const steps = mapStep(trip.steps, action.stepId, (s) => {
        const patched = { ...s, ...action.patch, id: s.id, stepType: s.stepType } as TripStep;
        return syncStep(patched);
      });
      return { ...trip, steps: normalizeStepOrders(steps) };
    }

    case "remove_step": {
      const steps = trip.steps.filter((s) => s.id !== action.stepId);
      return pruneUnreferencedDestinations({
        ...trip,
        steps: normalizeStepOrders(steps),
      });
    }

    // ── Intervals ──────────────────────────────────────────────────────────
    case "update_interval": {
      const steps = mapStep(trip.steps, action.stepId, (s) => {
        const intervals = getIntervals(s).map((iv) =>
          iv.id === action.intervalId ? ({ ...iv, ...action.patch, id: iv.id } as AnyInterval) : iv
        );
        return syncStep(withIntervals(s, intervals));
      });
      return { ...trip, steps };
    }

    case "add_interval": {
      const interval: AnyInterval = {
        ...action.interval,
        id: action.interval.id || newId(),
      } as AnyInterval;
      const steps = mapStep(trip.steps, action.stepId, (s) => {
        const intervals = [...getIntervals(s), interval];
        return syncStep(withIntervals(s, intervals));
      });
      return { ...trip, steps };
    }

    case "remove_interval": {
      const steps = mapStep(trip.steps, action.stepId, (s) => {
        const intervals = getIntervals(s).filter((iv) => iv.id !== action.intervalId);
        return syncStep(withIntervals(s, intervals));
      });
      return { ...trip, steps };
    }

    // ── Destinations ──────────────────────────────────────────────────────
    case "add_destination": {
      const destination: Destination = {
        ...action.destination,
        id: action.destination.id || newId(),
      };
      return { ...trip, destinations: upsertDestinationRow(trip.destinations, destination) };
    }

    case "set_destination": {
      const destinations = trip.destinations.map((d) =>
        d.id === action.destinationId ? { ...d, ...action.patch, id: d.id } : d
      );
      return { ...trip, destinations };
    }

    case "remove_destination": {
      // Only remove when no step references this destination.
      const referencedSteps = trip.steps.some((s) => {
        if (s.stepType === "stay" && s.targetDestinationId === action.destinationId) return true;
        if (s.stepType === "transit" && (s.fromStayId === action.destinationId || s.toStayId === action.destinationId)) return true;
        if (s.stepType === "activity" && s.targetDestinationId === action.destinationId) return true;
        return getIntervals(s).some((iv) => {
          if ("destinationId" in iv && iv.destinationId === action.destinationId) return true;
          if ("fromDestinationId" in iv && iv.fromDestinationId === action.destinationId) return true;
          if ("toDestinationId" in iv && iv.toDestinationId === action.destinationId) return true;
          return false;
        });
      });
      if (referencedSteps) return trip; // silently skip
      return { ...trip, destinations: trip.destinations.filter((d) => d.id !== action.destinationId) };
    }

    // ── Add step (+ inline destinations) ───────────────────────────────────
    case "add_step": {
      const raw = action.step;
      const step = {
        ...raw,
        id: (typeof raw.id === "string" && raw.id) ? raw.id : newId(),
        stepIntervals: Array.isArray(raw.stepIntervals) ? raw.stepIntervals : [],
      } as unknown as TripStep;

      const newDestinations = action.destinations ?? [];
      const destinations = newDestinations.length > 0
        ? mergeDestinationLists(trip.destinations, newDestinations)
        : trip.destinations;

      const steps = normalizeStepOrders([...trip.steps, step]);
      return { ...trip, steps, destinations };
    }

    // ── Trip-level fields ─────────────────────────────────────────────────
    case "update_trip": {
      const patched: Trip = { ...trip, ...action.patch };
      return normalizeTripForPersist(patched);
    }

    // ── Tasks ─────────────────────────────────────────────────────────────
    case "add_task": {
      const task = { ...action.task, id: newId() };
      return { ...trip, tasks: [...(trip.tasks ?? []), task] };
    }

    case "update_task": {
      const tasks = (trip.tasks ?? []).map((t) =>
        t.id === action.taskId ? { ...t, ...action.patch, id: t.id } : t
      );
      return { ...trip, tasks };
    }

    case "remove_task": {
      return { ...trip, tasks: (trip.tasks ?? []).filter((t) => t.id !== action.taskId) };
    }

    default:
      return trip;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Applies an ordered list of {@link TripAction}s to `trip`, returning the
 * resulting trip.  Actions that reference unknown IDs are skipped silently so
 * a single bad action cannot abort the whole batch.
 */
export function applyTripActions(trip: Trip, actions: TripAction[]): Trip {
  let current = trip;
  for (const action of actions) {
    try {
      current = applyAction(current, action);
    } catch {
      console.warn("[tripActionExecutor] failed to apply action:", action);
    }
  }
  return current;
}
