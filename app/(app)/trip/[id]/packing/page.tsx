import { PackingScreen } from "@/components/screens/packing/PackingScreen";

export default async function PackingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PackingScreen tripId={id} />;
}
