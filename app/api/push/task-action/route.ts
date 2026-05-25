import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

const TRIPS_COLLECTION = "canonicalTrips";
const ACTION_SECRET = process.env.TASK_ACTION_SECRET ?? "";

function verifyToken(action: string, taskId: string, tripId: string, token: string): boolean {
  if (!ACTION_SECRET) return false;
  const expected = createHmac("sha256", ACTION_SECRET)
    .update(`${action}:${taskId}:${tripId}`)
    .digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    taskId?: string;
    tripId?: string;
    action?: string;
    token?: string;
  };

  const { taskId, tripId, action, token } = body;

  if (!taskId || !tripId || !action || !token) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  if (!verifyToken(action, taskId, tripId, token)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 403 });
  }

  if (action !== "done") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firestore unavailable" }, { status: 503 });
  }

  const tripRef = db.collection(TRIPS_COLLECTION).doc(tripId);
  const tripDoc = await tripRef.get();
  if (!tripDoc.exists) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const trip = tripDoc.data() as { tasks?: Array<{ id: string; status: string }> };
  const tasks = trip.tasks ?? [];
  if (!tasks.some((t) => t.id === taskId)) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const updatedTasks = tasks.map((t) =>
    t.id === taskId ? { ...t, status: "done" } : t
  );
  await tripRef.update({ tasks: updatedTasks, updatedAt: new Date().toISOString() });

  return NextResponse.json({ ok: true });
}
