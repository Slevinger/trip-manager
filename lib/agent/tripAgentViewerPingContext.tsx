"use client";

import { createContext, useContext, useRef, type MutableRefObject, type ReactNode } from "react";
import type { ViewerDevicePing } from "@/lib/tripTravelerLocationContext";

const TripAgentViewerPingContext = createContext<MutableRefObject<ViewerDevicePing | null> | null>(null);

export function TripAgentViewerPingProvider({ children }: { children: ReactNode }) {
  const ref = useRef<ViewerDevicePing | null>(null);
  return <TripAgentViewerPingContext.Provider value={ref}>{children}</TripAgentViewerPingContext.Provider>;
}

export function useTripAgentViewerPingRefOptional(): MutableRefObject<ViewerDevicePing | null> | null {
  return useContext(TripAgentViewerPingContext);
}

/** @throws if used outside {@link TripAgentViewerPingProvider} */
export function useTripAgentViewerPingRef(): MutableRefObject<ViewerDevicePing | null> {
  const r = useContext(TripAgentViewerPingContext);
  if (!r) throw new Error("TripAgentViewerPingProvider is required");
  return r;
}
