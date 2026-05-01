import { createSlice, current, type PayloadAction } from "@reduxjs/toolkit";
import { v4 as uuidv4 } from "uuid";
import type { Trip } from "@/lib/types/trip";
import {
  summarizeTripChange,
  tripContentEquals,
  tripDataEquals,
  type TripChangeLogEntry,
  type TripChangeSource,
  type TripLedgerDraft,
} from "@/lib/store/tripChangeLog";
import { buildLedgerDrafts } from "@/lib/store/tripLedgerDiff";
import { expandUndoSnapshotsPushOrder } from "@/lib/store/tripUndoOps";

/** Max ledger lines and undo snapshot levels (oldest dropped when exceeded). */
const MAX_TRIP_CHANGES = 10;

function cloneTrip(t: Trip): Trip {
  return JSON.parse(JSON.stringify(t)) as Trip;
}

export type TripDocumentState = {
  trip: Trip | null;
  changeLog: TripChangeLogEntry[];
  /** Trip states along the undo chain (one level per inverse op where possible). */
  userUndoStack: Trip[];
  /** True when local Redux differs from last explicit Firestore write (Save). */
  hasUnsavedChanges: boolean;
  /**
   * Last known Firestore document shape (normalized). Null until first remote load
   * or when only a draft exists locally.
   */
  firestoreBaseline: Trip | null;
};

const initialState: TripDocumentState = {
  trip: null,
  changeLog: [],
  userUndoStack: [],
  hasUnsavedChanges: false,
  firestoreBaseline: null,
};

function trimChangeLog(state: TripDocumentState): void {
  while (state.changeLog.length > MAX_TRIP_CHANGES) {
    state.changeLog.shift();
  }
}

function trimUndoStack(state: TripDocumentState): void {
  while (state.userUndoStack.length > MAX_TRIP_CHANGES) {
    state.userUndoStack.shift();
  }
}

function pushLedger(
  state: TripDocumentState,
  source: TripChangeSource,
  drafts: TripLedgerDraft[]
) {
  const at = new Date().toISOString();
  for (const d of drafts) {
    const row: TripChangeLogEntry = {
      id: uuidv4(),
      at,
      source,
      ...d,
    };
    state.changeLog.push(row);
    console.log("[trip-change]", at, source, d.kind, d.entity, d.summary);
  }
  trimChangeLog(state);
}

function appendFallbackLedger(
  state: TripDocumentState,
  source: TripChangeSource,
  prev: Trip | null,
  next: Trip
) {
  pushLedger(state, source, [
    {
      kind: "updated",
      entity: "trip",
      summary: summarizeTripChange(prev, next),
    },
  ]);
}

const tripDocumentSlice = createSlice({
  name: "tripDocument",
  initialState,
  reducers: {
    resetTripDocument: () => initialState,

    setFirestoreBaseline: (state, action: PayloadAction<Trip | null>) => {
      const p = action.payload;
      state.firestoreBaseline = p ? cloneTrip(p) : null;
    },

    remoteSnapshotApplied: (state, action: PayloadAction<Trip>) => {
      const next = action.payload;
      if (tripDataEquals(state.trip, next)) return;
      if (tripContentEquals(state.trip, next)) {
        state.trip = next;
        state.hasUnsavedChanges = false;
        return;
      }
      const prev = state.trip;
      const drafts = buildLedgerDrafts(prev, next);
      if (drafts.length > 0) pushLedger(state, "remote", drafts);
      else appendFallbackLedger(state, "remote", prev, next);
      state.userUndoStack = [];
      state.trip = next;
      state.hasUnsavedChanges = false;
    },

    userPersisted: (state, action: PayloadAction<Trip>) => {
      const next = action.payload;
      if (tripDataEquals(state.trip, next)) return;
      const prevTrip = state.trip ? cloneTrip(current(state.trip)) : null;
      if (prevTrip) {
        for (const snap of expandUndoSnapshotsPushOrder(prevTrip, next)) {
          state.userUndoStack.push(snap);
          trimUndoStack(state);
        }
      }
      const drafts = buildLedgerDrafts(prevTrip, next);
      if (drafts.length > 0) pushLedger(state, "user", drafts);
      else appendFallbackLedger(state, "user", prevTrip, next);
      state.trip = next;
      state.hasUnsavedChanges = true;
    },

    undoLastUserChange: (state) => {
      if (state.userUndoStack.length === 0) return;
      const restored = state.userUndoStack.pop()!;
      pushLedger(state, "undo", [
        {
          kind: "updated",
          entity: "trip",
          summary: "Undo one edit",
        },
      ]);
      state.trip = restored;
      state.hasUnsavedChanges = true;
    },

    autoStatusApplied: (state, action: PayloadAction<Trip>) => {
      const next = action.payload;
      if (tripDataEquals(state.trip, next)) return;
      const prev = state.trip;
      const drafts = buildLedgerDrafts(prev, next);
      if (drafts.length > 0) pushLedger(state, "auto_status", drafts);
      else appendFallbackLedger(state, "auto_status", prev, next);
      state.trip = next;
      state.hasUnsavedChanges = true;
    },

    markTripSynced: (state) => {
      state.hasUnsavedChanges = false;
    },
  },
});

export const {
  resetTripDocument,
  setFirestoreBaseline,
  remoteSnapshotApplied,
  userPersisted,
  autoStatusApplied,
  undoLastUserChange,
  markTripSynced,
} = tripDocumentSlice.actions;

export default tripDocumentSlice.reducer;
