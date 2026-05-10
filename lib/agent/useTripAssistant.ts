"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { agentEvolve } from "@/lib/agentEvolve";
import { buildChatMemoryTripWhere } from "@/lib/chatMemoryTripContext";
import { getClientAuth } from "@/lib/firebase";
import { useI18n } from "@/lib/i18n/context";
import { refuseRedundantTripMemoryEvolve } from "@/lib/tripChatEvolveGate";
import { messagesForTrip } from "@/lib/tripChatMessages";
import {
  parseTripAssistantRequestKind,
  tripAssistantNeedsGlobalContext,
} from "@/lib/tripAssistantRequestKind";
import { appendImmutableMemoryQueueTurn } from "@/lib/usersFirestore";
import { appendSharedTripThreadTurn } from "@/lib/sharedTripThread";
import { appendTripChatLocal } from "@/lib/tripChatLocalStore";
import type { Trip, TripRecommendation, UserPreferences } from "@/lib/types/trip";
import type { Email, TripChatMessage } from "@/lib/types/user";

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
    .map((m) => ({
      role: m.from === "agent" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    }));
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
      content: m.content,
    });
  }
  return { notes: notes.join("\n\n---\n\n"), lines };
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
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("assistant.genericError");
      setError(msg === "EVOLVE_REDUNDANT" ? t("assistant.evolveRedundant") : msg);
    } finally {
      setEvolving(false);
    }
  }, [
    opts.canPersistMemory,
    opts.trip.id,
    opts.tripChatMessages,
    opts.userEmail,
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
      const userLine: ChatLine = { role: "user", content: text };
      const nextLines: ChatLine[] = [...lines, userLine];
      setLines(nextLines);
      setLoading(true);
      const contextAtMs = Date.now();
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const lastAssistantReply =
          [...lines].reverse().find((l) => l.role === "assistant")?.content ?? null;
        let attachGlobal: boolean;
        try {
          const classifyRes = await fetch("/api/chat/trip-assistant-classify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              latestUserText: text,
              tripTitle: opts.trip.title ?? "",
              recentTurns: nextLines.slice(-6).map((l) => ({ role: l.role, content: l.content })),
            }),
          });
          if (classifyRes.ok) {
            const j = (await classifyRes.json().catch(() => ({}))) as {
              kind?: "general" | "specific";
            };
            attachGlobal = j.kind === "general";
          } else {
            attachGlobal = tripAssistantNeedsGlobalContext(text, lastAssistantReply);
          }
        } catch {
          attachGlobal = tripAssistantNeedsGlobalContext(text, lastAssistantReply);
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

        const apiMessages = [...globalAsLines, ...tripMemoryLine, ...nextLines].map((l) => ({
          role: l.role as "user" | "assistant",
          content: l.content,
        }));

        const res = await fetch("/api/chat/trip-assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            trip: opts.trip,
            preferences: opts.profilePreferences ?? undefined,
            contextAtMs,
            messages: apiMessages,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          reply?: string;
          error?: string;
          detail?: string;
          provider?: "openai" | "anthropic";
          model?: string;
          suggestions?: TripRecommendation[];
        };
        if (!res.ok) {
          const head = data.error?.trim() || `Request failed (${res.status})`;
          const tail = data.detail?.trim();
          throw new Error(tail ? `${head}\n${tail.slice(0, 400)}` : head);
        }
        const reply = (data.reply ?? "").trim() || "(No reply)";
        if (data.provider === "openai" || data.provider === "anthropic") {
          setLlmBackend(data.provider);
        }
        if (typeof data.model === "string" && data.model.trim()) {
          setActiveModel(data.model.trim());
        }
        setLines((prev) => [...prev, { role: "assistant", content: reply }]);

        const localFromEmail = (opts.userEmail?.trim().toLowerCase() || "you") as Email;
        const userTimeStampIso = new Date(contextAtMs).toISOString();
        const agentTimeStampIso = new Date(contextAtMs + 1).toISOString();
        appendTripChatLocal(opts.trip.id, [
          {
            tripId: opts.trip.id,
            from: localFromEmail,
            content: text,
            timeStamp: userTimeStampIso,
          },
          {
            tripId: opts.trip.id,
            from: "agent",
            content: reply,
            timeStamp: agentTimeStampIso,
          },
        ]);

        if (Array.isArray(data.suggestions) && data.suggestions.length > 0 && opts.onAddRecommendations) {
          try {
            await opts.onAddRecommendations(opts.trip, data.suggestions);
          } catch (err) {
            const msg = err instanceof Error ? err.message : t("recs.errorGeneric");
            setError(`${t("assistant.suggestionsFailed")} ${msg}`);
          }
        }

        if (opts.canPersistMemory && opts.userEmail?.trim()) {
          const where = buildChatMemoryTripWhere(opts.trip, contextAtMs);
          const requestKind = parseTripAssistantRequestKind(reply) ?? undefined;
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
              }),
              appendImmutableMemoryQueueTurn(fromEmailLower, {
                tripId: "__global__",
                userFromEmail: opts.userEmail.trim(),
                userContent: text,
                agentContent: reply,
                sentAtMs: contextAtMs + 2,
                tripContextNote: where.summary,
                originTripId: opts.trip.id,
                ...(requestKind ? { requestKind } : {}),
              }),
            ]);
          } catch (e) {
            console.warn("[chat-persist] append failed", e);
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
                fetch("/api/chat/immutable-memory-compact", {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}` },
                }).catch(() => {}),
              ]);
            } catch {
              /* ignore */
            }
          })();
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : t("assistant.genericError");
        setError(msg);
        setLines((prev) => prev.slice(0, -1));
      } finally {
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
      persistedTripMessageCount,
      t,
    ]
  );

  const prepare = useCallback((text: string) => setPendingDraft(text), []);
  const consumeDraft = useCallback(() => setPendingDraft(null), []);

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
    evolve,
    forget,
    prepare,
    pendingDraft,
    consumeDraft,
  };
}
