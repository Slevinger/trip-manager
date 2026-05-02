import { TripDetail } from "./trip-detail";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TripDetail tripId={id} />;
}
