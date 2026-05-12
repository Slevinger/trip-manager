"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { useFirebaseUser } from "@/lib/auth/useFirebaseUser";
import { useAppSelector } from "@/lib/store/hooks";
import { Sidebar } from "./Sidebar";
import { BottomTabs } from "./BottomTabs";
import { TopBar } from "./TopBar";
import { PageTransition } from "./PageTransition";
import { TripAgentViewerPingProvider } from "@/lib/agent/tripAgentViewerPingContext";
import { TripLiveLocationTelemetry } from "@/components/trip/TripLiveLocationTelemetry";

const SmartDock = dynamic(
  () => import("@/components/agent/SmartDock").then((m) => ({ default: m.SmartDock })),
  { ssr: false }
);

export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useFirebaseUser();
  const activeTripId = useAppSelector((s) => s.trip.activeTripId);
  const trip = useAppSelector((s) => s.trip.trip);
  const tripId = activeTripId ?? trip?.id ?? null;
  const tripTitle = trip?.id === tripId ? trip?.title : null;
  const telemetryTrip = trip && tripId && trip.id === tripId ? trip : null;

  return (
    <TripAgentViewerPingProvider>
      <div className="flex min-h-screen w-full bg-[var(--color-background)]">
        <Sidebar tripId={tripId} tripTitle={tripTitle} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar tripId={tripId} tripTitle={tripTitle} user={user} />
          <main className="min-h-0 min-w-0 flex-1 pb-24 lg:pb-8">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
        <BottomTabs tripId={tripId} />
        <TripLiveLocationTelemetry tripId={tripId} trip={telemetryTrip} />
        <SmartDock tripId={tripId} />
      </div>
    </TripAgentViewerPingProvider>
  );
}
