import type { TripChatMessage } from "@/lib/types/user";
import { messagesForTrip } from "@/lib/tripChatMessages";

/** Must match OpenAI branch history window in `app/api/chat/trip-assistant/route.ts`. */
export const TRIP_ASSISTANT_OPENAI_MESSAGE_HISTORY_CAP = 40;

/** Request turn for evolve API (optional client-only metadata). */
export type TripMemoryEvolveTurn = {
  role: "user" | "assistant";
  content: string;
  memoryCompressed?: boolean;
};

/** Heuristic for rows saved before `memoryCompressed` existed. */
export function looksLikeStructuredTripMemoryNote(content: string): boolean {
  const t = content.trim();
  if (t.length < 80) return false;
  return (
    t.includes("LEGEND:") &&
    t.includes("FROM_WEB_OR_VERIFIED:") &&
    t.includes("CHAT_ONLY_MEMORY:")
  );
}

/**
 * Refuse compress when the saved thread is already a lone evolved note and we are under the
 * model history cap (re-compressing would double-shrink without new dialogue).
 */
export function refuseRedundantTripMemoryEvolveFromTurns(turns: TripMemoryEvolveTurn[]): boolean {
  const n = turns.length;
  if (n >= TRIP_ASSISTANT_OPENAI_MESSAGE_HISTORY_CAP) return false;
  if (n !== 1) return false;
  const m = turns[0];
  if (m.role !== "assistant") return false;
  return m.memoryCompressed === true || looksLikeStructuredTripMemoryNote(m.content);
}

export function refuseRedundantTripMemoryEvolve(
  messages: TripChatMessage[],
  tripId: string
): boolean {
  const forTrip = messagesForTrip(messages, tripId);
  const turns: TripMemoryEvolveTurn[] = forTrip.map((m) => ({
    role: m.from === "agent" ? ("assistant" as const) : ("user" as const),
    content: m.content,
    ...(m.memoryCompressed === true ? { memoryCompressed: true as const } : {}),
  }));
  return refuseRedundantTripMemoryEvolveFromTurns(turns);
}
