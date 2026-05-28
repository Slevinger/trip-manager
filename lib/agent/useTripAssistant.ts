"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { agentEvolve } from "@/lib/agentEvolve";
import { logCaughtException } from "@/lib/logCaughtException";
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
  tripAssistantUserWantsActions,
} from "@/lib/tripAssistantRequestKind";
import type { TripAction } from "@/lib/tripAssistantActionSchema";
import { appendSharedTripThreadTurn, truncateSharedTripThreadAfterMs } from "@/lib/sharedTripThread";
import type { Trip, TripRecommendation, UserPreferences } from "@/lib/types/trip";
import { isScheduleCheckCommand } from "@/lib/tripScheduleCheck";
import type { SchedulePatch } from "@/lib/tripScheduleCheck";
import type { ViewerDevicePing } from "@/lib/tripTravelerLocationContext";
import type { TripChatMessage } from "@/lib/types/user";

export type ChatRole = "user" | "assistant";

export interface ChatLine {
  role: ChatRole;
  content: string;
  /** Display name of the human speaker (absent for assistant lines). */
  fromDisplayName?: string;
  /** Timestamp (ms) matching the Firestore `createdAtMs` field — used for thread truncation when editing. */
  sentAtMs?: number;
  /** True only for messages sent or received during the current browser session (not loaded from history). */
  fromCurrentSession?: boolean;
}

export const EVOLVE_COMMAND = "#evolve";

function isMemoryNoteRow(m: TripChatMessage): boolean {
  return m.memoryCompressed === true && m.from === "agent";
}

/** Strip Anthropic web-search artifacts from stored/streamed assistant content. */
function sanitizeAgentContent(raw: string): string {
  return raw
    .replace(/<cite[^>]*>([\s\S]*?)<\/cite>/gi, "$1")
    .replace(/<\/?cite[^>]*>/gi, "")
    .replace(/^View on .+ ·\s*$/gim, "")
    .trim();
}

export function tripMessagesToLines(msgs: TripChatMessage[]): ChatLine[] {
  return msgs
    .filter((m) => !isMemoryNoteRow(m))
    .map((m) => {
      const isAgent = m.from === "agent";
      const content = isAgent
        ? sanitizeAgentContent(stripTripAssistantRequestKindMarker(m.content)) || m.content
        : m.content;
      return {
        role: isAgent ? ("assistant" as const) : ("user" as const),
        content,
        ...(m.timeStamp ? { sentAtMs: new Date(m.timeStamp).getTime() } : {}),
        ...(!isAgent && m.fromDisplayName ? { fromDisplayName: m.fromDisplayName } : {}),
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
          ? sanitizeAgentContent(stripTripAssistantRequestKindMarker(m.content)) || m.content
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
  /** Called when the assistant returns ##actions## with a trip-actions JSON block. */
  onApplyActions?: (trip: Trip, actions: TripAction[]) => Promise<void>;
  /** Called for each patch streamed after the initial suggestion response. */
  onUpdateOptionImage?: (recId: string, optionId: string, imageUrl: string, priceNote?: string) => void;
  /** Called when a schedule-check response includes step-time patches to apply. */
  onScheduleFix?: (trip: Trip, patches: SchedulePatch[]) => Promise<void>;
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
  send: (text: string, opts?: { forceKind?: "general" | "specific" | "suggestions" | "actions" }) => Promise<void>;
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
  /** Dismiss the current error (e.g. when the user edits the input to retry). */
  clearError: () => void;
  /** True while a rate-limit cooldown is active — sending will fail, so the UI should block it. */
  sendLocked: boolean;
  /** Option IDs whose images are currently being resolved via the streaming enrichment. */
  pendingImageOptIds: Set<string>;
  /** Schedule-fix patches waiting for user confirmation (null = none pending). */
  pendingScheduleFix: { patches: SchedulePatch[]; summary: string } | null;
  /** Apply and clear the pending schedule fix. */
  applyScheduleFix: () => Promise<void>;
  /** Discard the pending schedule fix without applying. */
  discardScheduleFix: () => void;
  /** Pending trip mutations from the LLM, waiting for user confirmation. */
  pendingActionsBatch: { actions: TripAction[]; count: number } | null;
  /** Apply and clear the pending actions batch. */
  applyPendingActions: () => Promise<void>;
  /** Discard the pending actions batch without applying. */
  discardPendingActions: () => void;
  /** Non-null right after suggestions arrive — cleared when the user sends their next message. */
  latestSuggestionBatch: { count: number } | null;
  /** Dismiss the suggestion bridge notification manually. */
  dismissSuggestionBatch: () => void;
  /** Start editing a previous user message: pre-fills input and marks an edit point so the
   *  next `send` truncates history from that line onward before resending. */
  startEdit: (lineIdx: number) => void;
  /** Line index currently being edited, or null if no edit is pending. */
  editingLineIdx: number | null;
  /** Cancel a pending edit without resending. */
  cancelEdit: () => void;
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
  const [pendingScheduleFix, setPendingScheduleFix] = useState<{ patches: SchedulePatch[]; summary: string } | null>(null);
  const [pendingActionsBatch, setPendingActionsBatch] = useState<{ actions: TripAction[]; count: number } | null>(null);
  const [sendLocked, setSendLocked] = useState(false);
  const [latestSuggestionBatch, setLatestSuggestionBatch] = useState<{ count: number } | null>(null);
  const sendLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingImageOptIds, setPendingImageOptIds] = useState<Set<string>>(new Set());

  const abortRef = useRef<AbortController | null>(null);
  /** When non-null, the next `send` truncates lines/thread from this index onward. */
  const pendingEditIdxRef = useRef<number | null>(null);
  const [editingLineIdx, setEditingLineIdx] = useState<number | null>(null);
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
    return () => {
      if (sendLockTimerRef.current) clearTimeout(sendLockTimerRef.current);
    };
  }, []);

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
    async (raw: string, sendOpts?: { forceKind?: "general" | "specific" | "suggestions" | "actions" }) => {
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
      setLatestSuggestionBatch(null);
      setPendingActionsBatch(null);

      // Resolve and clear any pending edit — truncate history from that point.
      const editIdx = pendingEditIdxRef.current;
      pendingEditIdxRef.current = null;
      setEditingLineIdx(null);
      const baseLines = editIdx !== null ? lines.slice(0, editIdx) : lines;

      // Parse @private / @all / @mention tags before touching any state.
      const fromEmailLowerForAudience = opts.userEmail?.trim().toLowerCase() ?? "";
      const { cleanText, visibleTo: turnVisibleTo, directedTo: turnDirectedTo } = parseAudienceTags(
        text,
        fromEmailLowerForAudience
      );

      const contextAtMs = Date.now();
      const userDisplayName = opts.userDisplayName?.trim() || undefined;
      const userLine: ChatLine = {
        role: "user",
        content: text,
        sentAtMs: contextAtMs,
        fromCurrentSession: true,
        ...(userDisplayName ? { fromDisplayName: userDisplayName } : {}),
      };
      const nextLines: ChatLine[] = [...baseLines, userLine];
      const willPersist = Boolean(opts.canPersistMemory && opts.userEmail?.trim());
      if (willPersist) pendingPersistRef.current += 1;
      setLines(nextLines);
      setLoading(true);

      // Truncate remote thread when editing (fire-and-forget).
      if (editIdx !== null && willPersist && opts.trip.id) {
        const editedLine = lines[editIdx];
        if (editedLine?.sentAtMs) {
          void truncateSharedTripThreadAfterMs(opts.trip.id, editedLine.sentAtMs);
        }
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const lastAssistantReply =
          [...baseLines].reverse().find((l) => l.role === "assistant")?.content ?? null;
        let classifiedMessageKind: "general" | "specific" | "suggestions" | "actions" | undefined;
        let attachGlobal: boolean;

        if (sendOpts?.forceKind) {
          // Wizard path — skip classify round-trip and use the provided kind directly.
          classifiedMessageKind = sendOpts.forceKind;
          attachGlobal = sendOpts.forceKind === "general";
        } else {
          // Check for direct action intent before hitting the classify API.
          if (tripAssistantUserWantsActions(cleanText)) {
            classifiedMessageKind = "actions";
            attachGlobal = false;
          } else {
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
            } catch (e) {
              logCaughtException(e, "useTripAssistant/classifyMessageKind");
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
        const scheduleCheck = isScheduleCheckCommand(cleanText);
        const res = await fetch("/api/chat/trip-assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            trip: opts.trip,
            preferences: opts.profilePreferences ?? undefined,
            contextAtMs,
            messages: apiMessages,
            ...(classifiedMessageKind === "suggestions" || classifiedMessageKind === "actions"
              ? { classifiedMessageKind }
              : {}),
            ...(scheduleCheck ? { scheduleCheck: true } : {}),
            ...(ping
              ? {
                  viewerDevicePing: ping,
                  viewerEmailLower: opts.userEmail?.trim().toLowerCase() ?? undefined,
                }
              : {}),
          }),
        });
        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
          if (res.status === 429 || res.status === 529) {
            setSendLocked(true);
            if (sendLockTimerRef.current) clearTimeout(sendLockTimerRef.current);
            sendLockTimerRef.current = setTimeout(() => setSendLocked(false), 30_000);
          }
          const head = errData.error?.trim() || `Request failed (${res.status})`;
          const tail = errData.detail?.trim();
          throw new Error(tail ? `${head}\n${tail.slice(0, 400)}` : head);
        }

        type ResultChunk = {
          type: "result";
          reply?: string;
          provider?: "openai" | "anthropic";
          model?: string;
          suggestions?: TripRecommendation[];
          requestKind?: "general" | "specific" | "suggestions" | "actions";
          actions?: TripAction[];
        };
        type ImageChunk = { type: "image"; recId: string; optionId: string; imageUrl: string; priceNote?: string };

        const processResult = async (data: ResultChunk) => {
          const reply = (data.reply ?? "").trim() || "(No reply)";
          const requestKind =
            data.requestKind === "general" ||
            data.requestKind === "specific" ||
            data.requestKind === "suggestions" ||
            data.requestKind === "actions"
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
              return { reply, requestKind, suggestions, aborted: true as const };
            }
          }

          // Queue pending actions for user confirmation (do NOT apply immediately).
          const actions = Array.isArray(data.actions) && data.actions.length > 0
            ? data.actions as TripAction[]
            : [];
          if (actions.length > 0) {
            setPendingActionsBatch({ actions, count: actions.length });
          }

          setLines((prev) => [...prev, { role: "assistant", content: reply, sentAtMs: contextAtMs + 1, fromCurrentSession: true }]);
          if (suggestions.length > 0) {
            setPendingImageOptIds(new Set(suggestions.flatMap((s) => s.options.map((o) => o.id))));
            setLatestSuggestionBatch({ count: suggestions.length });
          }
          return { reply, requestKind, suggestions, aborted: false as const };
        };

        // NDJSON stream: first line is the result, subsequent lines are image patches.
        const isNdjson = (res.headers.get("content-type") ?? "").includes("ndjson");
        let reply: string;
        let requestKind: "general" | "specific" | "suggestions" | "actions" | undefined;
        let persistedSuggestions: TripRecommendation[] = [];

        if (isNdjson && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let resultHandled = false;
          let earlyReturn = false;
          let ogQueue: { recId: string; optionId: string; label: string }[] = [];
          let ogDates: { checkin: string; checkout: string; adults: number } | null = null;

          outer: while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              let chunk: { type?: string } & Record<string, unknown>;
              try { chunk = JSON.parse(line) as typeof chunk; } catch { continue; }

              if (chunk.type === "result" && !resultHandled) {
                resultHandled = true;
                const outcome = await processResult(chunk as unknown as ResultChunk);
                reply = outcome.reply;
                requestKind = outcome.requestKind;
                persistedSuggestions = outcome.suggestions;
                if (outcome.aborted) { earlyReturn = true; break outer; }
              } else if (chunk.type === "image") {
                const c = chunk as unknown as ImageChunk;
                if (c.recId && c.optionId && c.imageUrl) {
                  opts.onUpdateOptionImage?.(c.recId, c.optionId, c.imageUrl, c.priceNote);
                  setPendingImageOptIds((prev) => {
                    const next = new Set(prev);
                    next.delete(c.optionId);
                    return next;
                  });
                }
              } else if (chunk.type === "og-queue") {
                const items = Array.isArray(chunk.items) ? chunk.items as { recId: string; optionId: string; label: string }[] : [];
                ogQueue = items;
                ogDates = chunk.dates as typeof ogDates ?? null;
              }
            }
          }

          // Clear pending IDs except for og-queue items (they'll be cleared when background fetch completes).
          const ogPendingIds = new Set(ogQueue.map((i) => i.optionId));
          setPendingImageOptIds(ogPendingIds);

          if (earlyReturn) return;

          // Fire og-fetcher background requests for hotel options.
          if (ogQueue.length > 0) {
            void Promise.allSettled(
              ogQueue.map(async ({ recId, optionId, label }) => {
                try {
                  const res = await fetch("/api/chat/og-image", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ label, recId, optionId, dates: ogDates }),
                  });
                  if (!res.ok) return;
                  const data = (await res.json().catch(() => ({}))) as { imageUrl?: string; priceNote?: string };
                  if (data.imageUrl) {
                    opts.onUpdateOptionImage?.(recId, optionId, data.imageUrl, data.priceNote);
                  }
                } catch { /* non-fatal */ } finally {
                  setPendingImageOptIds((prev) => {
                    const next = new Set(prev);
                    next.delete(optionId);
                    return next;
                  });
                }
              })
            );
          }
          reply ??= "(No reply)";
          requestKind ??= undefined;
        } else {
          const data = (await res.json().catch(() => ({}))) as ResultChunk & {
            scheduleFix?: { patches: SchedulePatch[]; summary: string };
          };
          const outcome = await processResult(data);
          if (outcome.aborted) return;
          reply = outcome.reply;
          requestKind = outcome.requestKind;
          persistedSuggestions = outcome.suggestions;
          if (data.scheduleFix?.patches?.length) {
            setPendingScheduleFix({
              patches: data.scheduleFix.patches,
              summary: data.scheduleFix.summary ?? "",
            });
          }
        }

        const recommendationsJson =
          persistedSuggestions.length > 0 ? JSON.stringify(persistedSuggestions).slice(0, 25000) : undefined;

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
                ...(requestKind && requestKind !== "actions" ? { requestKind } : {}),
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
                }).catch((e) => logCaughtException(e, "useTripAssistant/triggerSharedTripThreadCompaction/fetch")),
              ]);
            } catch (e) {
              logCaughtException(e, "useTripAssistant/triggerSharedTripThreadCompaction");
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
        setPendingDraft(text);
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
      opts.onUpdateOptionImage,
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
  const clearError = useCallback(() => setError(null), []);
  const dismissSuggestionBatch = useCallback(() => setLatestSuggestionBatch(null), []);
  const discardScheduleFix = useCallback(() => setPendingScheduleFix(null), []);
  const applyScheduleFix = useCallback(async () => {
    if (!pendingScheduleFix || !opts.onScheduleFix) return;
    try {
      await opts.onScheduleFix(opts.trip, pendingScheduleFix.patches);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("assistant.genericError");
      setError(msg);
    }
    setPendingScheduleFix(null);
  }, [opts, pendingScheduleFix, t]);

  const discardPendingActions = useCallback(() => setPendingActionsBatch(null), []);
  const applyPendingActions = useCallback(async () => {
    if (!pendingActionsBatch || !opts.onApplyActions) return;
    try {
      await opts.onApplyActions(opts.trip, pendingActionsBatch.actions);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("assistant.genericError");
      setError(msg);
    }
    setPendingActionsBatch(null);
  }, [opts, pendingActionsBatch, t]);

  const startEdit = useCallback((lineIdx: number) => {
    const line = lines[lineIdx];
    if (!line || line.role !== "user") return;
    pendingEditIdxRef.current = lineIdx;
    setEditingLineIdx(lineIdx);
    setPendingDraft(line.content);
  }, [lines]);

  const cancelEdit = useCallback(() => {
    pendingEditIdxRef.current = null;
    setEditingLineIdx(null);
  }, []);

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
    clearError,
    sendLocked,
    pendingImageOptIds,
    pendingScheduleFix,
    applyScheduleFix,
    discardScheduleFix,
    pendingActionsBatch,
    applyPendingActions,
    discardPendingActions,
    latestSuggestionBatch,
    dismissSuggestionBatch,
    startEdit,
    editingLineIdx,
    cancelEdit,
  };
}
