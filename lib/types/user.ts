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
