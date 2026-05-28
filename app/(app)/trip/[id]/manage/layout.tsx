import { ManageShell } from "@/components/screens/manage/ManageShell";

export default async function ManageLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // children are the individual page.tsx files — they render nothing.
  // ManageShell owns the full section render and reads section from pathname.
  void children;
  return <ManageShell tripId={id} />;
}
