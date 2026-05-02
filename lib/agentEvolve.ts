import { messagesForTrip } from "@/lib/tripChatMessages";
import type { TripChatMessage } from "@/lib/types/user";
import { replaceTripChatMemoryForTrip } from "@/lib/usersFirestore";

function tripMessagesToApiTurns(messages: TripChatMessage[]): { role: "user" | "assistant"; content: string }[] {
  return messages.map((m) => ({
    role: m.from === "agent" ? ("assistant" as const) : ("user" as const),
    content: m.content,
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
}): Promise<void> {
  const tid = opts.tripId.trim();
  const email = opts.userEmailLower.trim().toLowerCase();
  if (!tid || !email) throw new Error("agentEvolve: tripId and userEmailLower are required");

  const forTrip = messagesForTrip(opts.tripChatMessages, tid);
  if (forTrip.length === 0) return;

  const apiMessages = tripMessagesToApiTurns(forTrip);
  const res = await fetch("/api/chat/trip-memory-evolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: apiMessages }),
  });

  const data = (await res.json().catch(() => ({}))) as { summary?: string; error?: string; detail?: string };
  if (!res.ok) {
    const head = data.error?.trim() || `Request failed (${res.status})`;
    const tail = data.detail?.trim();
    throw new Error(tail ? `${head}\n${tail.slice(0, 400)}` : head);
  }

  const summary = (data.summary ?? "").trim();
  if (!summary) throw new Error("Empty summary from evolve");

  await replaceTripChatMemoryForTrip(email, tid, summary, Date.now());
}
