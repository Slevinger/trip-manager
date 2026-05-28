import { MapScreen } from "@/components/screens/map/MapScreen";

export default async function MapPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MapScreen tripId={id} />;
}
