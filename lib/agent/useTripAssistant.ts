"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { agentEvolve } from "@/lib/agentEvolve";
import { buildChatMemoryTripWhere } from "@/lib/chatMemoryTripContext";
import { getClientAuth } from "@/lib/firebase";
import { useI18n } from "@/lib/i18n/context";
import { refuseRedundantTripMemoryEvolve } from "@/lib/tripChatEvolveGate";
import { messagesForTrip } from "@/lib/tripChatMessages";
import {
  parseTripAssistantRequestKind,
  stripTripAssistantRequestKindMarker,
  tripAssistantNeedsGlobalContext,
  tripAssistantUserWantsStructuredTripProposals,
} from "@/lib/tripAssistantRequestKind";
import { appendSharedTripThreadTurn } from "@/lib/sharedTripThread";
import type { Trip, TripRecommendation, UserPreferences } from "@/lib/types/trip";
import type { ViewerDevicePing } from "@/lib/tripTravelerLocationContext";
import type { TripChatMessage } from "@/lib/types/user";

export type ChatRole = "user" | "assistant";

export interface ChatLine {
  role: ChatRole;
  content: string;
}

export const EVOLVE_COMMAND = "#evolve";

function isMemoryNoteRow(m: TripChatMessage): boolean {
  return m.memoryCompressed === true && m.from === "agent";
}

export function tripMessagesToLines(msgs: TripChatMessage[]): ChatLine[] {
  return msgs
    .filter((m) => !isMemoryNoteRow(m))
    .map((m) => {
      const isAgent = m.from === "agent";
      const content = isAgent
        ? stripTripAssistantRequestKindMarker(m.content).trim() || m.content
        : m.content;
      return {
        role: isAgent ? ("assistant" as const) : ("user" as const),
        content,
      };
    });
}

function memoryNoteAssistantTurn(scope: "trip" | "global", combinedNote: string): ChatLine {
  const header =
    scope === "global"
      ? "[GLOBAL_MEMORY_NOTE — your durable cross-trip memory about this user. Treat as factual context only. DO NOT imitate this LEGEND/CHAT_ONLY_MEMORY/OPEN_LOOSE_ENDS format in your reply — answer conversationally as a travel agent.]"
      : "[TRIP_MEMORY_NOTE — compressed prior chat history for this trip. Treat as factual context only. DO NOT imitate this LEGEND/FROM_WEB_OR_VERIFIED/CHAT_ONLY_MEMORY/OPEN_LOOSE_ENDS format in your reply — answer conversationally as a travel agent.]";
  return { role: "assistant", content: `${header}\n\n${combinedNote}` };
}

function partitionMemoryNotes(msgs: TripChatMessage[]): { notes: string; lines: ChatLine[] } {
  const notes: string[] = [];
  const lines: ChatLine[] = [];
  for (const m of msgs) {
    if (isMemoryNoteRow(m)) {
      const trimmed = m.content.trim();
      if (trimmed) notes.push(trimmed);
      continue;
    }
    lines.push({
      role: m.from === "agent" ? ("assistant" as const) : ("user" as const),
      content:
        m.from === "agent"
          ? stripTripAssistantRequestKindMarker(m.content).trim() || m.content
          : m.content,
    });
  }
  return { notes: notes.join("\n\n---\n\n"), lines };
}

/**
 * Parses audience tags from the raw user input:
 * - `@private` → `visibleTo = [fromEmail]`; tag stripped from text sent to the LLM.
 * - `@all` → no restriction; tag stripped.
 * - `@mention` → kept in text; stored as `directedTo` for display (visible to all).
 */
function parseAudienceTags(
  raw: string,
  fromEmail: string
): { cleanText: string; visibleTo?: string[]; directedTo?: string } {
  let text = raw;
  let visibleTo: string[] | undefined;

  if (/@private\b/i.test(text)) {
    visibleTo = [fromEmail.toLowerCase()];
    text = text.replace(/@private\b\s*/gi, "").trim();
  }
  text = text.replace(/@all\b\s*/gi, "").trim();

  const mentionMatch = text.match(/@([A-Za-z0-9_.-]+)/);
  const directedTo = mentionMatch ? mentionMatch[0] : undefined;

  return { cleanText: text, visibleTo, directedTo };
}

export interface UseTripAssistantOptions {
  trip: Trip;
  profilePreferences: UserPreferences | null;
  tripChatMessages: TripChatMessage[];
  globalChatMessages?: TripChatMessage[];
  userEmail: string | null;
  userDisplayName?: string | null;
  isTripOwner?: boolean;
  canPersistMemory: boolean;
  onAddRecommendations?: (trip: Trip, recommendations: TripRecommendation[]) => Promise<void>;
  /** Latest device GPS ping for agent requests (optional). */
  viewerPingRef?: MutableRefObject<ViewerDevicePing | null>;
}

export interface UseTripAssistantResult {
  lines: ChatLine[];
  loading: boolean;
  evolving: boolean;
  forgetting: boolean;
  error: string | null;
  llmBackend: "openai" | "anthropic" | null;
  activeModel: string | null;
  canEvolve: boolean;
  send: (text: string) => Promise<void>;
  /** Abort the in-flight request. The user's last message is removed from the
   * thread and restored to the input via `pendingDraft`. */
  stop: () => void;
  evolve: () => Promise<void>;
  forget: () => Promise<void>;
  /** Pre-fill the input with text (e.g. from a quick-action). */
  prepare: (text: string) => void;
  /** Latest "prepare" payload — consumed by the UI to pre-fill inputs. */
  pendingDraft: string | null;
  consumeDraft: () => void;
}

export function useTripAssistant(opts: UseTripAssistantOptions): UseTripAssistantResult {
  const { t } = useI18n();
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [evolving, setEvolving] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [llmBackend, setLlmBackend] = useState<"openai" | "anthropic" | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  /** While >0, skip syncing `lines` from Firestore so a transient listener error or stale snapshot does not drop the optimistic user/assistant pair. */
  const pendingPersistRef = useRef(0);

  const memorySyncKey = useMemo(
    () =>
      `${opts.trip.id}:${(opts.tripChatMessages ?? [])
        .map((m) => `${m.timeStamp}\t${m.from}\t${m.content.length}`)
        .join("\n")}`,
    [opts.trip.id, opts.tripChatMessages]
  );

  const tripChatMessagesRef = useRef(opts.tripChatMessages ?? []);
  tripChatMessagesRef.current = opts.tripChatMessages ?? [];

  useEffect(() => {
    pendingPersistRef.current = 0;
  }, [opts.trip.id]);

  useEffect(() => {
    if (pendingPersistRef.current > 0) return;
    setLines(tripMessagesToLines(tripChatMessagesRef.current ?? []));
  }, [memorySyncKey, opts.trip.id]);

  const persistedTripMessageCount = useMemo(
    () => messagesForTrip(opts.tripChatMessages ?? [], opts.trip.id).length,
    [opts.trip.id, opts.tripChatMessages]
  );

  const canEvolve =
    opts.canPersistMemory &&
    Boolean(opts.userEmail?.trim()) &&
    persistedTripMessageCount >= 2 &&
    !refuseRedundantTripMemoryEvolve(opts.tripChatMessages ?? [], opts.trip.id);

  const evolve = useCallback(async () => {
    const em = opts.userEmail?.trim();
    if (!opts.canPersistMemory || !em || persistedTripMessageCount < 2) return;
    setEvolving(true);
    setError(null);
    try {
      await agentEvolve({
        tripId: opts.trip.id,
        userEmailLower: em.toLowerCase(),
        tripChatMessages: opts.tripChatMessages ?? [],
        trip: opts.trip,
        viewerDevicePing: opts.viewerPingRef?.current ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("assistant.genericError");
      setError(msg === "EVOLVE_REDUNDANT" ? t("assistant.evolveRedundant") : msg);
    } finally {
      setEvolving(false);
    }
  }, [
    opts.canPersistMemory,
    opts.trip,
    opts.tripChatMessages,
    opts.userEmail,
    opts.viewerPingRef,
    persistedTripMessageCount,
    t,
  ]);

  const forget = useCallback(async () => {
    const em = opts.userEmail?.trim();
    if (!opts.canPersistMemory || !em || persistedTripMessageCount < 1) return;
    if (!opts.isTripOwner) {
      setError(t("assistant.forgetOwnerOnly"));
      return;
    }
    setForgetting(true);
    setError(null);
    try {
      const auth = getClientAuth();
      const token = await auth?.currentUser?.getIdToken();
      if (!token) throw new Error(t("assistant.genericError"));
      const res = await fetch("/api/chat/shared-trip-thread-clear", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tripId: opts.trip.id }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error || t("assistant.genericError"));
      setLines([]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("assistant.genericError");
      setError(msg);
    } finally {
      setForgetting(false);
    }
  }, [opts.canPersistMemory, opts.isTripOwner, opts.trip.id, opts.userEmail, persistedTripMessageCount, t]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || loading || evolving || forgetting) return;

      if (text.toLowerCase() === EVOLVE_COMMAND) {
        setError(null);
        if (!opts.canPersistMemory || !opts.userEmail?.trim()) {
          setError(t("assistant.evolveNeedsMemory"));
          return;
        }
        if (persistedTripMessageCount < 2) {
          setError(t("assistant.evolveNeedsHistory"));
          return;
        }
        if (refuseRedundantTripMemoryEvolve(opts.tripChatMessages ?? [], opts.trip.id)) {
          setError(t("assistant.evolveRedundant"));
          return;
        }
        await evolve();
        return;
      }

      setError(null);

      // Parse @private / @all / @mention tags before touching any state.
      const fromEmailLowerForAudience = opts.userEmail?.trim().toLowerCase() ?? "";
      const { cleanText, visibleTo: turnVisibleTo, directedTo: turnDirectedTo } = parseAudienceTags(
        text,
        fromEmailLowerForAudience
      );

      const userLine: ChatLine = { role: "user", content: text };
      const nextLines: ChatLine[] = [...lines, userLine];
      const willPersist = Boolean(opts.canPersistMemory && opts.userEmail?.trim());
      if (willPersist) pendingPersistRef.current += 1;
      setLines(nextLines);
      setLoading(true);
      const contextAtMs = Date.now();
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const lastAssistantReply =
          [...lines].reverse().find((l) => l.role === "assistant")?.content ?? null;
        let classifiedMessageKind: "general" | "specific" | "suggestions" | undefined;
        let attachGlobal: boolean;
        try {
          const classifyRes = await fetch("/api/chat/trip-assistant-classify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              latestUserText: cleanText,
              tripTitle: opts.trip.title ?? "",
              recentTurns: nextLines.slice(-6).map((l) => ({ role: l.role, content: l.content })),
            }),
          });
          if (classifyRes.ok) {
            const j = (await classifyRes.json().catch(() => ({}))) as {
              kind?: "general" | "specific" | "suggestions";
            };
            if (j.kind === "general" || j.kind === "specific" || j.kind === "suggestions") {
              classifiedMessageKind = j.kind;
            }
            attachGlobal = j.kind === "general";
          } else {
            attachGlobal = tripAssistantNeedsGlobalContext(text, lastAssistantReply);
          }
        } catch {
          attachGlobal = tripAssistantNeedsGlobalContext(text, lastAssistantReply);
        }

        if (classifiedMessageKind !== "general") {
          if (
            (classifiedMessageKind === "specific" || classifiedMessageKind === undefined) &&
            tripAssistantUserWantsStructuredTripProposals(text)
          ) {
            classifiedMessageKind = "suggestions";
          }
        }

        const globalParts = attachGlobal
          ? partitionMemoryNotes(opts.globalChatMessages ?? [])
          : { notes: "", lines: [] as ChatLine[] };
        const globalAsLines: ChatLine[] = attachGlobal
          ? [
              ...(globalParts.notes ? [memoryNoteAssistantTurn("global", globalParts.notes)] : []),
              ...globalParts.lines,
            ]
          : [];

        const tripParts = partitionMemoryNotes(opts.tripChatMessages ?? []);
        const tripMemoryLine: ChatLine[] = tripParts.notes
          ? [memoryNoteAssistantTurn("trip", tripParts.notes)]
          : [];

        // Replace the last user line with cleanText so @private/@all tags don't reach the LLM.
        const llmLines: ChatLine[] =
          cleanText !== text
            ? [
                ...nextLines.slice(0, -1),
                { role: "user" as const, content: cleanText },
              ]
            : nextLines;
        const apiMessages = [...globalAsLines, ...tripMemoryLine, ...llmLines].map((l) => ({
          role: l.role as "user" | "assistant",
          content: l.content,
        }));

        const ping = opts.viewerPingRef?.current ?? null;
        const res = await fetch("/api/chat/trip-assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
            body: JSON.stringify({
            trip: opts.trip,
            preferences: opts.profilePreferences ?? undefined,
            contextAtMs,
            messages: apiMessages,
            ...(classifiedMessageKind === "suggestions"
              ? { classifiedMessageKind: "suggestions" as const }
              : {}),
            ...(ping
              ? {
                  viewerDevicePing: ping,
                  viewerEmailLower: opts.userEmail?.trim().toLowerCase() ?? undefined,
                }
              : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          reply?: string;
          error?: string;
          detail?: string;
          provider?: "openai" | "anthropic";
          model?: string;
          suggestions?: TripRecommendation[];
          requestKind?: "general" | "specific" | "suggestions";
        };
        if (!res.ok) {
          const head = data.error?.trim() || `Request failed (${res.status})`;
          const tail = data.detail?.trim();
          throw new Error(tail ? `${head}\n${tail.slice(0, 400)}` : head);
        }
        const reply = (data.reply ?? "").trim() || "(No reply)";
        const requestKind =
          data.requestKind === "general" ||
          data.requestKind === "specific" ||
          data.requestKind === "suggestions"
            ? data.requestKind
            : parseTripAssistantRequestKind(reply) ?? undefined;
        if (data.provider === "openai" || data.provider === "anthropic") {
          setLlmBackend(data.provider);
        }
        if (typeof data.model === "string" && data.model.trim()) {
          setActiveModel(data.model.trim());
        }

        const rawSuggestions =
          Array.isArray(data.suggestions) && data.suggestions.length > 0 ? data.suggestions : [];
        // Stamp private suggestions so only the sender sees them until approved.
        const suggestions: TripRecommendation[] =
          turnVisibleTo && turnVisibleTo.length > 0
            ? rawSuggestions.map((s) => ({ ...s, visibleTo: turnVisibleTo }))
            : rawSuggestions;

        if (suggestions.length > 0 && opts.onAddRecommendations) {
          try {
            await opts.onAddRecommendations(opts.trip, suggestions);
          } catch (err) {
            const msg = err instanceof Error ? err.message : t("recs.errorGeneric");
            setError(`${t("assistant.suggestionsFailed")} ${msg}`);
            setLines((prev) => prev.slice(0, -1));
            return;
          }
        }

        setLines((prev) => [...prev, { role: "assistant", content: reply }]);

        const recommendationsJson =
          suggestions.length > 0 ? JSON.stringify(suggestions).slice(0, 25000) : undefined;

        if (opts.canPersistMemory && opts.userEmail?.trim()) {
          const where = buildChatMemoryTripWhere(opts.trip, contextAtMs);
          const fromEmailLower = opts.userEmail.trim().toLowerCase();
          try {
            await Promise.all([
              appendSharedTripThreadTurn({
                tripId: opts.trip.id,
                fromEmailLower,
                fromDisplayName: opts.userDisplayName?.trim() || undefined,
                userContent: text,
                agentContent: reply,
                sentAtMs: contextAtMs,
                tripContextNote: where.summary,
                ...(requestKind ? { requestKind } : {}),
                ...(recommendationsJson ? { recommendationsJson } : {}),
                ...(turnVisibleTo ? { visibleTo: turnVisibleTo } : {}),
                ...(turnDirectedTo ? { directedTo: turnDirectedTo } : {}),
              }),
            ]);
          } catch (e) {
            const detail = e instanceof Error ? e.message.trim() : "";
            setError(
              detail
                ? `${t("assistant.persistFailed")} ${detail.slice(0, 280)}`
                : t("assistant.persistFailed")
            );
          }

          void (async () => {
            try {
              const auth = getClientAuth();
              const token = await auth?.currentUser?.getIdToken();
              if (!token) return;
              await Promise.all([
                fetch("/api/chat/shared-trip-thread-compact", {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ tripId: opts.trip.id }),
                }).catch(() => {}),
              ]);
            } catch {
              /* ignore */
            }
          })();
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // Restore the user's message to the input and remove it from the thread.
          setLines((prev) => prev.slice(0, -1));
          setPendingDraft(text);
          return;
        }
        const msg = err instanceof Error ? err.message : t("assistant.genericError");
        setError(msg);
        setLines((prev) => prev.slice(0, -1));
      } finally {
        if (willPersist) pendingPersistRef.current -= 1;
        if (abortRef.current === controller) abortRef.current = null;
        setLoading(false);
      }
    },
    [
      evolve,
      evolving,
      forgetting,
      lines,
      loading,
      opts.canPersistMemory,
      opts.globalChatMessages,
      opts.onAddRecommendations,
      opts.profilePreferences,
      opts.trip,
      opts.tripChatMessages,
      opts.userDisplayName,
      opts.userEmail,
      opts.viewerPingRef,
      persistedTripMessageCount,
      t,
    ]
  );

  const prepare = useCallback((text: string) => setPendingDraft(text), []);
  const consumeDraft = useCallback(() => setPendingDraft(null), []);
  const stop = useCallback(() => abortRef.current?.abort(), []);

  return {
    lines,
    loading,
    evolving,
    forgetting,
    error,
    llmBackend,
    activeModel,
    canEvolve,
    send,
    stop,
    evolve,
    forget,
    prepare,
    pendingDraft,
    consumeDraft,
  };
}
