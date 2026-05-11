import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Trip } from "@/lib/types/trip";
import type { JsonChangeAction } from "./types";
import { applyDiff } from "@/lib/stateDiff";

export type FirestoreTripAccess = {
  canManageFirestore: boolean;
  isOwner: boolean;
};

export type TripState = {
  trip: Trip | null;
  /** Latest Firestore ACL hints from `subscribeCanonicalTrip` (shared listener). */
  firestoreTripAccess: FirestoreTripAccess | null;
  draft: Trip | null;
  past: JsonChangeAction[];
  future: JsonChangeAction[];
  activeTripId: string | null;
};

const initialState: TripState = {
  trip: null,
  firestoreTripAccess: null,
  draft: null,
  past: [],
  future: [],
  activeTripId: null,
};

const tripSlice = createSlice({
  name: "trip",
  initialState,
  reducers: {
    setActiveTripId(state, action: PayloadAction<string | null>) {
      state.activeTripId = action.payload;
    },
    hydrateHistory(
      state,
      action: PayloadAction<{ past: JsonChangeAction[]; future: JsonChangeAction[] }>,
    ) {
      state.past = action.payload.past;
      state.future = action.payload.future;
    },
    setTrip(state, action: PayloadAction<Trip | null>) {
      state.trip = action.payload;
      if (!action.payload) state.firestoreTripAccess = null;
    },
    setFirestoreTripAccess(state, action: PayloadAction<FirestoreTripAccess | null>) {
      state.firestoreTripAccess = action.payload;
    },
    setManageDraft(state, action: PayloadAction<Trip | null>) {
      state.draft = action.payload;
    },
    patchDraft(state, action: PayloadAction<Partial<Trip>>) {
      if (!state.draft) return;
      state.draft = { ...state.draft, ...action.payload };
    },
    pushHistory(state, action: PayloadAction<JsonChangeAction>) {
      state.past.push(action.payload);
      state.future = [];
    },
    undo(state) {
      const last = state.past.pop();
      if (!last) return;

      if (last.scope === "trip") {
        if (state.trip) state.trip = applyDiff(state.trip as any, last.reverse) as any;
      } else {
        if (state.draft) state.draft = applyDiff(state.draft as any, last.reverse) as any;
      }
      state.future.unshift(last);
    },
    redo(state) {
      const next = state.future.shift();
      if (!next) return;

      if (next.scope === "trip") {
        if (state.trip) state.trip = applyDiff(state.trip as any, next.forward) as any;
      } else {
        if (state.draft) state.draft = applyDiff(state.draft as any, next.forward) as any;
      }
      state.past.push(next);
    },
  },
});

export const {
  setActiveTripId,
  hydrateHistory,
  setTrip,
  setFirestoreTripAccess,
  setManageDraft,
  patchDraft,
  pushHistory,
  undo,
  redo,
} = tripSlice.actions;

export const tripReducer = tripSlice.reducer;

