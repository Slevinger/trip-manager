import { Suspense } from "react";
import { TripTopNavWrapper } from "@/components/screens/_shared/TripTopNav";
import TripPageLoading from "./loading";

export default async function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <TripTopNavWrapper tripId={id} />
      <Suspense fallback={<TripPageLoading />}>
        {children}
      </Suspense>
    </>
  );
}
