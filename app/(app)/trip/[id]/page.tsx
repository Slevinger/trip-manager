import { TripOverviewScreen } from "@/components/screens/dashboard/TripOverviewScreen";

export default async function TripOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TripOverviewScreen tripId={id} />;
}
