"use client";

import { type ReactNode, Component, useMemo } from "react";
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

class SmartDockBoundary extends Component<
  { children: ReactNode },
  { crashed: boolean; error: string | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { crashed: false, error: null };
  }
  static getDerivedStateFromError(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[SmartDock] render error — copy this to the developer:", msg);
    return { crashed: true, error: msg };
  }
  render() {
    if (this.state.crashed) {
      return (
        <button
          style={{
            position: "fixed", bottom: 80, right: 16, zIndex: 40,
            background: "red", color: "white", borderRadius: "50%",
            width: 56, height: 56, fontSize: 20, border: "none", cursor: "pointer",
          }}
          title={`SmartDock error: ${this.state.error ?? "unknown"}`}
          onClick={() => this.setState({ crashed: false, error: null })}
        >
          ⚠
        </button>
      );
    }
    return this.props.children;
  }
}

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
        <SmartDockBoundary>
          <SmartDock tripId={routeTripId} />
        </SmartDockBoundary>
      </div>
    </TripAgentViewerPingProvider>
  );
}
