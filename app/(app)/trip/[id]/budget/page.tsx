import { BudgetScreen } from "@/components/screens/budget/BudgetScreen";

export default async function BudgetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BudgetScreen tripId={id} />;
}
