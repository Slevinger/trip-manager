import { TodoScreen } from "@/components/screens/todos/TodoScreen";

export default async function TodosPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TodoScreen tripId={id} />;
}
