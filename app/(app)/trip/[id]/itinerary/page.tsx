import { ItineraryScreen } from "@/components/screens/itinerary/ItineraryScreen";

export default async function ItineraryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ItineraryScreen tripId={id} />;
}
