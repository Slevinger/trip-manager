import { TripPageGate } from "@/components/trip/TripPageGate";

export default async function TripRoutePage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return <TripPageGate tripId={tripId} />;
}
