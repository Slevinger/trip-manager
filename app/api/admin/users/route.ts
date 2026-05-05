import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { requireAdmin } from "@/lib/adminAuth";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Admin Firestore not configured" }, { status: 503 });

  const snap = await db.collection("users").orderBy("emailLower", "asc").limit(200).get();
  const users = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const emailLower = typeof data.emailLower === "string" ? data.emailLower : d.id;
    const email = typeof data.email === "string" ? data.email : emailLower;
    return { id: d.id, emailLower, email };
  });
  return NextResponse.json({ users });
}

