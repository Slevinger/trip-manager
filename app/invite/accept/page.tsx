import { InviteAcceptForm } from "./InviteAcceptForm";

export default async function InviteAcceptPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const token = typeof t === "string" ? t.trim() : "";
  if (!token) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-zinc-600">
        Missing invitation token. Open the link from your email.
      </div>
    );
  }

  return <InviteAcceptForm token={token} />;
}
