import { Skeleton } from "@/components/ui/skeleton";

export default function ManagePageLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8 lg:px-8">
      <Skeleton className="h-32 w-full" />
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  );
}
