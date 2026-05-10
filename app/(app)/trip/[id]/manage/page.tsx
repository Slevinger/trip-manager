import { ManageScreen } from "@/components/screens/manage/ManageScreen";

export default async function ManagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ManageScreen tripId={id} />;
}
