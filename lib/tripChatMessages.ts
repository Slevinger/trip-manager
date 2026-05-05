import { parseChatMemoryWhere } from "@/lib/chatMemoryWhereParse";
import type { Email, TripChatMessage } from "@/lib/types/user";

function isoNow(): string {
  return new Date().toISOString();
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

/** Normalize Firestore Timestamp-like or ISO string to ISO string. */
export function parseMessageTimeStamp(raw: unknown): string {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (isRecord(raw) && typeof raw.seconds === "number") {
    const ns = typeof raw.nanoseconds === "number" ? raw.nanoseconds : 0;
    return new Date(raw.seconds * 1000 + ns / 1e6).toISOString();
  }
  return isoNow();
}

function isAgentFrom(from: string): boolean {
  return from.toLowerCase() === "agent";
}

/**
 * Parse one stored row: new `TripChatMessage` or legacy paired turn → one or two messages.
 */
export function parseStoredMemoryRow(
  raw: unknown,
  opts: { userEmailLower: string; userEmailDisplay: string }
): TripChatMessage[] {
  if (!isRecord(raw)) return [];

  const from = typeof raw.from === "string" ? raw.from.trim() : "";
  const content = typeof raw.content === "string" ? raw.content : "";
  const tripId = typeof raw.tripId === "string" ? raw.tripId.trim() : "";
  if (from && (isAgentFrom(from) || from.includes("@")) && content.trim() && tripId) {
    const msg: TripChatMessage = {
      tripId,
      from: isAgentFrom(from) ? "agent" : (from.trim().toLowerCase() as Email),
      content: content.slice(0, 8000),
      timeStamp: parseMessageTimeStamp(raw.timeStamp),
    };
    if (raw.memoryCompressed === true && msg.from === "agent") {
      msg.memoryCompressed = true;
    }
    const cs = typeof raw.contextSummary === "string" ? raw.contextSummary.trim() : "";
    if (cs && msg.from !== "agent") msg.contextSummary = cs.slice(0, 500);
    return [msg];
  }

  const userPrompt = typeof raw.userPrompt === "string" ? raw.userPrompt : "";
  const answered = typeof raw.answered === "string" ? raw.answered : "";
  if (!userPrompt.trim() && !answered.trim()) return [];

  const where = parseChatMemoryWhere(raw.where);
  const legacyTripId = where?.tripId ?? "";
  const at = typeof raw.at === "string" && raw.at.trim() ? raw.at.trim() : isoNow();
  const summary = where?.summary?.trim();
  const userFrom = (opts.userEmailDisplay.trim().toLowerCase() || opts.userEmailLower) as Email;

  const out: TripChatMessage[] = [];
  if (userPrompt.trim()) {
    out.push({
      tripId: legacyTripId,
      from: userFrom,
      content: userPrompt.slice(0, 8000),
      timeStamp: at,
      ...(summary ? { contextSummary: summary.slice(0, 500) } : {}),
    });
  }
  if (answered.trim()) {
    out.push({
      tripId: legacyTripId,
      from: "agent",
      content: answered.slice(0, 8000),
      timeStamp: at,
    });
  }
  return out;
}

export function parseMemoryArrayFromUserDoc(
  raw: unknown,
  opts: { userEmailLower: string; userEmailDisplay: string }
): TripChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const flat: TripChatMessage[] = [];
  for (const item of raw) {
    flat.push(...parseStoredMemoryRow(item, opts));
  }
  return flat.filter((m) => m.content.trim());
}

export function messagesForTrip(messages: TripChatMessage[], tripId: string): TripChatMessage[] {
  const id = tripId.trim();
  if (!id) return [];
  return messages
    .filter((m) => m.tripId === id)
    .sort((a, b) => a.timeStamp.localeCompare(b.timeStamp) || (a.from === "agent" ? 1 : 0) - (b.from === "agent" ? 1 : 0));
}
