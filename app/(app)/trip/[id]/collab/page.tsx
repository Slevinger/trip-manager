import { CollabScreen } from "@/components/screens/collab/CollabScreen";

export default async function CollabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CollabScreen tripId={id} />;
}
