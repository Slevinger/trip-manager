"use client";

import dynamic from "next/dynamic";

const TripPageClient = dynamic(
  () =>
    import("@/components/trip/TripPage").then((m) => ({ default: m.TripPage })),
  {
    ssr: false,
    loading: () => (
      <main
        className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-zinc-500"
        aria-busy="true"
      >
        …
      </main>
    ),
  }
);

export function TripPageGate({ tripId }: { tripId: string }) {
  return <TripPageClient tripId={tripId} />;
}
