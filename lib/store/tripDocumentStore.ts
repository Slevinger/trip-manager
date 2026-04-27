import { configureStore } from "@reduxjs/toolkit";
import {
  useDispatch,
  useSelector,
  useStore,
  type TypedUseSelectorHook,
} from "react-redux";
import tripDocumentReducer from "@/lib/store/tripDocumentSlice";

export function makeTripDocumentStore() {
  return configureStore({
    reducer: {
      tripDocument: tripDocumentReducer,
    },
  });
}

export type TripDocumentStore = ReturnType<typeof makeTripDocumentStore>;
export type TripDocumentRootState = ReturnType<TripDocumentStore["getState"]>;
export type TripDocumentDispatch = TripDocumentStore["dispatch"];

export const useTripDocumentDispatch = () => useDispatch<TripDocumentDispatch>();
export const useTripDocumentSelector: TypedUseSelectorHook<TripDocumentRootState> =
  useSelector;
/** `useStore`’s generic does not infer RTK `getState()` shape here; cast for typed `getState()`. */
export function useTripDocumentStore(): TripDocumentStore {
  return useStore() as TripDocumentStore;
}
