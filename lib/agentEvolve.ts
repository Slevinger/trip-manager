import { refuseRedundantTripMemoryEvolve, type TripMemoryEvolveTurn } from "@/lib/tripChatEvolveGate";
import { messagesForTrip } from "@/lib/tripChatMessages";
import type { Trip } from "@/lib/types/trip";
import type { TripChatMessage } from "@/lib/types/user";
import {
  buildTravelerLocationContextAppendix,
  type ViewerDevicePing,
} from "@/lib/tripTravelerLocationContext";
import { replaceTripChatMemoryForTrip } from "@/lib/usersFirestore";

function tripMessagesToApiTurns(messages: TripChatMessage[]): TripMemoryEvolveTurn[] {
  return messages.map((m) => ({
    role: m.from === "agent" ? ("assistant" as const) : ("user" as const),
    content: m.content,
    ...(m.memoryCompressed === true ? { memoryCompressed: true as const } : {}),
  }));
}

/**
 * Sends this trip’s full chat transcript to the LLM for a dense summary, then replaces
 * all stored lines for that trip with one new assistant message (other trips’ memory is unchanged).
 */
export async function agentEvolve(opts: {
  tripId: string;
  userEmailLower: string;
  tripChatMessages: TripChatMessage[];
  /** Canonical trip (for traveler GPS appendix on the evolve request). */
  trip: Trip;
  /** Optional fresh device ping for the user running evolve. */
  viewerDevicePing?: ViewerDevicePing | null;
}): Promise<void> {
  const tid = opts.tripId.trim();
  const email = opts.userEmailLower.trim().toLowerCase();
  if (!tid || !email) throw new Error("agentEvolve: tripId and userEmailLower are required");
  if (!opts.trip?.id?.trim()) throw new Error("agentEvolve: trip is required");

  const forTrip = messagesForTrip(opts.tripChatMessages, tid);
  if (forTrip.length === 0) return;

  if (refuseRedundantTripMemoryEvolve(opts.tripChatMessages, tid)) {
    throw new Error("EVOLVE_REDUNDANT");
  }

  const apiMessages = tripMessagesToApiTurns(forTrip);
  const nowMs = Date.now();
  const appendix = buildTravelerLocationContextAppendix(opts.trip, {
    nowMs,
    viewerDevicePing: opts.viewerDevicePing ?? null,
    viewerEmailLower: email,
    includeSyncedLiveLocations: true,
  }).trim();
  const res = await fetch("/api/chat/trip-memory-evolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: apiMessages,
      ...(appendix ? { travelerLocationContextAppendix: appendix } : {}),
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    summary?: string;
    error?: string;
    detail?: string;
    code?: string;
  };
  if (!res.ok) {
    if (res.status === 409 && data.code === "evolve_redundant") {
      throw new Error("EVOLVE_REDUNDANT");
    }
    const head = data.error?.trim() || `Request failed (${res.status})`;
    const tail = data.detail?.trim();
    throw new Error(tail ? `${head}\n${tail.slice(0, 400)}` : head);
  }

  const summary = (data.summary ?? "").trim();
  if (!summary) throw new Error("Empty summary from evolve");

  await replaceTripChatMemoryForTrip(email, tid, summary, Date.now());
}
