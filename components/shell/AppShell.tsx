"use client";

import { type ReactNode, useMemo } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname() ?? "/";
  const routeTripId = useMemo(() => {
    const m = pathname.match(/^\/trip\/([^/]+)/);
    return m?.[1] ?? null;
  }, [pathname]);
  const trip = useAppSelector((s) => s.trip.trip);
  const tripTitle = trip?.id === routeTripId ? trip?.title : null;
  const telemetryTrip = trip && routeTripId && trip.id === routeTripId ? trip : null;

  return (
    <TripAgentViewerPingProvider>
      <div className="flex min-h-screen w-full bg-[var(--color-background)]">
        <Sidebar tripId={routeTripId} tripTitle={tripTitle} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar tripId={routeTripId} tripTitle={tripTitle} user={user} />
          <main className="min-h-0 min-w-0 flex-1 pb-24 lg:pb-8">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
        <BottomTabs tripId={routeTripId} />
        <TripLiveLocationTelemetry tripId={routeTripId} trip={telemetryTrip} />
        <SmartDock tripId={routeTripId} />
      </div>
    </TripAgentViewerPingProvider>
  );
}
