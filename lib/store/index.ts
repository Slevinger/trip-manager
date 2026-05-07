import { configureStore } from "@reduxjs/toolkit";
import { tripReducer, type TripState } from "./tripSlice";
import { historyMiddleware } from "./historyMiddleware";

export const store = configureStore({
  reducer: {
    trip: tripReducer,
  },
  middleware: (getDefault) => getDefault().concat(historyMiddleware),
});

export type RootState = { trip: TripState };
export type AppDispatch = typeof store.dispatch;

