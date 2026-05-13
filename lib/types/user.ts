import type { ISODateString, UserPreferences } from "@/lib/types/trip";

export type { UserPreferences };

/** Lowercase email string used as `from` on user-authored chat lines. */
export type Email = string;

/**
 * One line in the trip assistant transcript stored on `users/{email}.memory`.
 * Chronological array: user (`from` = email) and `agent` turns share one list.
 */
export interface TripChatMessage {
  tripId: string;
  from: "agent" | Email;
  content: string;
  /** ISO 8601 (Firestore-serializable). */
  timeStamp: string;
  /** Optional itinerary snapshot when the user sent the message (prompt continuity). */
  contextSummary?: string;
  /** True when this agent line is the output of Compress (#evolve); avoids double compression. */
  memoryCompressed?: boolean;
}

export type ImmutableMemoryEntryKind = "message" | "summary";

/**
 * One entry in the **shared per-trip assistant thread** (`trips/{tripId}/assistantThread/{id}`).
 * Visible to every member of the trip; immutable from the client (only compaction / owner-clear
 * server routes update `active`). `from` is the email of the speaker or `"agent"`.
 * When `active` is omitted in Firestore, clients treat the row as active.
 */
export interface SharedTripThreadEntry {
  tripId: string;
  role: "user" | "assistant";
  from: "agent" | Email;
  /** Optional display name of the human speaker, captured at write time for UI. */
  fromDisplayName?: string;
  content: string;
  kind: ImmutableMemoryEntryKind;
  active: boolean;
  createdAtMs: number;
  /** Trip context snapshot at the time of the turn (same shape as user-scope entries). */
  tripContext?: string;
  /** Assistant self-classification of the most recent user message in this turn. */
  requestKind?: "general" | "specific" | "suggestions";
  /**
   * When the assistant returned structured trip suggestions, JSON snapshot of that array
   * (same shape as API `suggestions`) so the transcript stays aligned with trip recommendations.
   */
  recommendationsJson?: string;
  memoryCompressed?: boolean;
  /** For `kind === "summary"`: how many compaction passes produced this entry. */
  evolveCount?: number;
  /**
   * When set, only the listed email addresses may see this entry.
   * Used for `@private` turns — both the user message and the agent reply carry this field.
   */
  visibleTo?: Email[];
  /**
   * Raw mention string recorded for UI display, e.g. `"@john"`.
   * The entry is still visible to all trip members; this is a display-only tag.
   */
  directedTo?: string;
}

/** One immutable entry in the centralized per-user history queue. */
export interface ImmutableMemoryQueueEntry {
  seq: number;
  tripId: string;
  role: "user" | "assistant";
  from: "agent" | Email;
  content: string;
  kind: ImmutableMemoryEntryKind;
  active: boolean;
  memoryCompressed?: boolean;
  /** For `kind === "summary"`: how many compaction passes produced this entry. */
  evolveCount?: number;
  /**
   * Source trip id for entries stored under a virtual `tripId` (e.g. `__global__`).
   * Equal to `tripId` for real trip entries; useful for filtering global rows by origin.
   */
  originTripId?: string;
  /** One-line trip context snapshot at the time the turn happened (assistant scope). */
  tripContext?: string;
  /** Assistant self-classification of this turn ("general" → personal/cross-trip; "specific" → trip detail; "suggestions" → user asked for proposals). */
  requestKind?: "general" | "specific" | "suggestions";
  createdAtMs: number;
}

/** Where on the trip the user was when a chat turn happened (legacy rows + parsing). */
export interface ChatMemoryTripWhere {
  tripId: string;
  tripTitle: string;
  tripPhase: "before_start" | "during" | "after_end";
  stepFocus: "active" | "upcoming" | "none";
  stepId?: string;
  stepTitle?: string;
  stepType?: "stay" | "transit" | "activity";
  intervalFlavor?: string;
  placeTitle?: string;
  summary: string;
}

/** Firestore `users/{emailLower}` document (doc id = lowercase email). */
export interface AppUser {
  uid: string;
  email: string;
  emailLower: string;
  displayName: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  preferences: UserPreferences;
  /** Trip assistant messages (all trips); trim on append. */
  memory?: TripChatMessage[];
}
