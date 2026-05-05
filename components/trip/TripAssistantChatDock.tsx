"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TripAssistantMessageBody } from "@/components/trip/TripAssistantMessageBody";
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
import {
  appendImmutableMemoryQueueTurn,
} from "@/lib/usersFirestore";
import { appendSharedTripThreadTurn } from "@/lib/sharedTripThread";
import type { Trip, UserPreferences } from "@/lib/types/trip";
import type { TripChatMessage } from "@/lib/types/user";

type Role = "user" | "assistant";

interface Line {
  role: Role;
  content: string;
}

/**
 * Compressed/summary rows are kept on the trip thread for the assistant's memory but
 * are NOT rendered as regular chat bubbles — they confuse the user and (worse) the
 * agent tends to imitate the LEGEND/CHAT_ONLY_MEMORY format if it sees it as a turn.
 */
function isMemoryNoteRow(m: TripChatMessage): boolean {
  return m.memoryCompressed === true && m.from === "agent";
}

function tripMessagesToLines(msgs: TripChatMessage[]): Line[] {
  return msgs
    .filter((m) => !isMemoryNoteRow(m))
    .map((m) => ({
      role: m.from === "agent" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    }));
}

function memoryNoteAssistantTurn(scope: "trip" | "global", combinedNote: string): Line {
  const header =
    scope === "global"
      ? "[GLOBAL_MEMORY_NOTE — your durable cross-trip memory about this user. Treat as factual context only. DO NOT imitate this LEGEND/CHAT_ONLY_MEMORY/OPEN_LOOSE_ENDS format in your reply — answer conversationally as a travel agent.]"
      : "[TRIP_MEMORY_NOTE — compressed prior chat history for this trip. Treat as factual context only. DO NOT imitate this LEGEND/FROM_WEB_OR_VERIFIED/CHAT_ONLY_MEMORY/OPEN_LOOSE_ENDS format in your reply — answer conversationally as a travel agent.]";
  return { role: "assistant", content: `${header}\n\n${combinedNote}` };
}

function partitionMemoryNotes(msgs: TripChatMessage[]): { notes: string; lines: Line[] } {
  const notes: string[] = [];
  const lines: Line[] = [];
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

const FAB_SIZE = 52;
const PANEL_W = 360;
const PANEL_MAX_H = 480;
const EDGE = 12;
/** Magic send — runs memory compression instead of calling the trip assistant. */
const EVOLVE_COMMAND = "#evolve";

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

type DragSession =
  | {
      kind: "header";
      startX: number;
      startY: number;
      startRight: number;
      startBottom: number;
    }
  | {
      kind: "fab";
      startX: number;
      startY: number;
      startRight: number;
      startBottom: number;
      /** True after pointer moved past threshold — then we drag instead of toggling open. */
      dragging: boolean;
      wasClosed: boolean;
    };

export function TripAssistantChatDock(props: {
  trip: Trip;
  profilePreferences: UserPreferences | null;
  /** Trip-shared transcript (`trips/{id}/assistantThread`) — visible to all members. */
  tripChatMessages: TripChatMessage[];
  /** Cross-trip `__global__` slice for the speaker; only attached when the request is general. */
  globalChatMessages?: TripChatMessage[];
  userEmail: string | null;
  userDisplayName?: string | null;
  /** Owner-only controls (Forget, Compress) only render when true. */
  isTripOwner?: boolean;
  /** When true, append each exchange to Firestore after a successful reply. */
  canPersistMemory: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [rightPx, setRightPx] = useState(24);
  const [bottomPx, setBottomPx] = useState(24);
  const dragSessionRef = useRef<DragSession | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [evolving, setEvolving] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set from first successful `/api/chat/trip-assistant` response. */
  const [llmBackend, setLlmBackend] = useState<"openai" | "anthropic" | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Suppress the synthetic `click` after pointer-based open / drag so the panel does not flash closed. */
  const swallowFabClickRef = useRef(false);
  const posRef = useRef({ right: 24, bottom: 24 });

  useEffect(() => {
    posRef.current = { right: rightPx, bottom: bottomPx };
  }, [rightPx, bottomPx]);

  const memorySyncKey = useMemo(
    () =>
      `${props.trip.id}:${(props.tripChatMessages ?? [])
        .map((m) => `${m.timeStamp}\t${m.from}\t${m.content.length}`)
        .join("\n")}`,
    [props.trip.id, props.tripChatMessages]
  );

  useEffect(() => {
    setLines(tripMessagesToLines(props.tripChatMessages ?? []));
  }, [memorySyncKey, props.tripChatMessages]);

  const persistedTripMessageCount = useMemo(
    () => messagesForTrip(props.tripChatMessages ?? [], props.trip.id).length,
    [props.trip.id, props.tripChatMessages]
  );

  const evolveRedundantBlocked = useMemo(
    () => refuseRedundantTripMemoryEvolve(props.tripChatMessages ?? [], props.trip.id),
    [props.trip.id, props.tripChatMessages]
  );

  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, open, loading, evolving, forgetting]);

  const onPointerDownHeader = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Clicks on header controls (e.g. Close) must not capture the pointer — capture breaks their click.
    if ((e.target as HTMLElement).closest("button, a, [role='button']")) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = posRef.current;
    dragSessionRef.current = {
      kind: "header",
      startX: e.clientX,
      startY: e.clientY,
      startRight: p.right,
      startBottom: p.bottom,
    };
  }, []);

  const onPointerDownFab = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if (open) return;
      const p = posRef.current;
      dragSessionRef.current = {
        kind: "fab",
        startX: e.clientX,
        startY: e.clientY,
        startRight: p.right,
        startBottom: p.bottom,
        dragging: false,
        wasClosed: true,
      };
    },
    [open]
  );

  useEffect(() => {
    const applyDrag = (startRight: number, startBottom: number, dx: number, dy: number) => {
      const maxR = typeof window !== "undefined" ? window.innerWidth - EDGE - FAB_SIZE : 400;
      const maxB = typeof window !== "undefined" ? window.innerHeight - EDGE - FAB_SIZE : 400;
      setRightPx(clamp(startRight - dx, EDGE, maxR));
      setBottomPx(clamp(startBottom - dy, EDGE, maxB));
    };

    const onMove = (e: PointerEvent) => {
      const s = dragSessionRef.current;
      if (!s) return;
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      if (s.kind === "header") {
        applyDrag(s.startRight, s.startBottom, dx, dy);
        return;
      }
      const dist = Math.hypot(dx, dy);
      if (!s.dragging) {
        if (dist < 8) return;
        const p = posRef.current;
        dragSessionRef.current = {
          ...s,
          dragging: true,
          startX: e.clientX,
          startY: e.clientY,
          startRight: p.right,
          startBottom: p.bottom,
        };
        return;
      }
      applyDrag(s.startRight, s.startBottom, dx, dy);
    };

    const onUp = () => {
      const s = dragSessionRef.current;
      dragSessionRef.current = null;
      if (s?.kind === "fab") {
        if (s.dragging) {
          swallowFabClickRef.current = true;
        } else if (s.wasClosed) {
          setOpen(true);
          swallowFabClickRef.current = true;
        }
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const handleEvolve = useCallback(async () => {
    const em = props.userEmail?.trim();
    if (!props.canPersistMemory || !em || persistedTripMessageCount < 2) return;
    setEvolving(true);
    setError(null);
    try {
      await agentEvolve({
        tripId: props.trip.id,
        userEmailLower: em.toLowerCase(),
        tripChatMessages: props.tripChatMessages ?? [],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("assistant.genericError");
      setError(msg === "EVOLVE_REDUNDANT" ? t("assistant.evolveRedundant") : msg);
    } finally {
      setEvolving(false);
    }
  }, [
    persistedTripMessageCount,
    props.canPersistMemory,
    props.trip.id,
    props.tripChatMessages,
    props.userEmail,
    t,
  ]);

  const handleForgetChat = useCallback(async () => {
    const em = props.userEmail?.trim();
    if (!props.canPersistMemory || !em || persistedTripMessageCount < 1) return;
    if (!props.isTripOwner) {
      setError(t("assistant.forgetOwnerOnly"));
      return;
    }
    if (!window.confirm(t("assistant.forgetConfirm"))) return;
    setForgetting(true);
    setError(null);
    try {
      const auth = getClientAuth();
      const token = await auth?.currentUser?.getIdToken();
      if (!token) throw new Error(t("assistant.genericError"));
      const res = await fetch("/api/chat/shared-trip-thread-clear", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tripId: props.trip.id }),
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
  }, [
    persistedTripMessageCount,
    props.canPersistMemory,
    props.isTripOwner,
    props.trip.id,
    props.userEmail,
    t,
  ]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || evolving || forgetting) return;

    if (text.toLowerCase() === EVOLVE_COMMAND) {
      setInput("");
      setError(null);
      if (!props.canPersistMemory || !props.userEmail?.trim()) {
        setError(t("assistant.evolveNeedsMemory"));
        return;
      }
      if (persistedTripMessageCount < 2) {
        setError(t("assistant.evolveNeedsHistory"));
        return;
      }
      if (refuseRedundantTripMemoryEvolve(props.tripChatMessages ?? [], props.trip.id)) {
        setError(t("assistant.evolveRedundant"));
        return;
      }
      await handleEvolve();
      return;
    }

    setInput("");
    setError(null);
    const nextLines: Line[] = [...lines, { role: "user", content: text }];
    setLines(nextLines);
    setLoading(true);
    const contextAtMs = Date.now();
    try {
      // Decide whether to attach `__global__` cross-trip memory to this LLM call.
      // First-class signal: tiny LLM router. Falls back to the regex heuristic on failure.
      const lastAssistantReply = [...lines].reverse().find((l) => l.role === "assistant")?.content ?? null;
      let attachGlobal: boolean;
      try {
        const classifyRes = await fetch("/api/chat/trip-assistant-classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latestUserText: text,
            tripTitle: props.trip.title ?? "",
            recentTurns: nextLines.slice(-6).map((l) => ({ role: l.role, content: l.content })),
          }),
        });
        if (classifyRes.ok) {
          const j = (await classifyRes.json().catch(() => ({}))) as { kind?: "general" | "specific" };
          attachGlobal = j.kind === "general";
        } else {
          attachGlobal = tripAssistantNeedsGlobalContext(text, lastAssistantReply);
        }
      } catch {
        attachGlobal = tripAssistantNeedsGlobalContext(text, lastAssistantReply);
      }
      const globalParts = attachGlobal
        ? partitionMemoryNotes(props.globalChatMessages ?? [])
        : { notes: "", lines: [] as Line[] };
      const globalAsLines: Line[] = attachGlobal
        ? [
            ...(globalParts.notes ? [memoryNoteAssistantTurn("global", globalParts.notes)] : []),
            ...globalParts.lines,
          ]
        : [];

      const tripParts = partitionMemoryNotes(props.tripChatMessages ?? []);
      const tripMemoryLine: Line[] = tripParts.notes
        ? [memoryNoteAssistantTurn("trip", tripParts.notes)]
        : [];

      const apiMessages = [...globalAsLines, ...tripMemoryLine, ...nextLines].map((l) => ({
        role: l.role as "user" | "assistant",
        content: l.content,
      }));
      const res = await fetch("/api/chat/trip-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trip: props.trip,
          preferences: props.profilePreferences ?? undefined,
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
      };
      if (!res.ok) {
        const head = data.error?.trim() || `Request failed (${res.status})`;
        const tail = data.detail?.trim();
        const hint =
          res.status === 401
            ? " Set a valid `sk-…` key in `.env.local` as OPENAI_API_KEY or OPENAI_SA_KEY (not a Firebase JSON path)."
            : "";
        const sameAsHead =
          tail && head.length > 20 && (tail.includes(head.slice(0, 60)) || head.includes(tail.slice(0, 60)));
        const showTail = Boolean(tail && !sameAsHead);
        const extra = tail ? `\n${tail.slice(0, 400)}` : "";
        throw new Error(showTail ? `${head}${hint ? ` ${hint}` : ""}${extra}` : `${head}${hint}`);
      }
      const reply = (data.reply ?? "").trim() || "(No reply)";
      if (data.provider === "openai" || data.provider === "anthropic") {
        setLlmBackend(data.provider);
      }
      if (typeof data.model === "string" && data.model.trim()) {
        setActiveModel(data.model.trim());
      }
      setLines((prev) => [...prev, { role: "assistant", content: reply }]);

      if (props.canPersistMemory && props.userEmail?.trim()) {
        const where = buildChatMemoryTripWhere(props.trip, contextAtMs);
        // Assistant self-classification (`##general##` / `##specific##`) trailing the reply.
        const requestKind = parseTripAssistantRequestKind(reply) ?? undefined;

        // 1) Trip-shared thread: visible to ALL members of the trip. Errors here matter
        //    (without it the dock falls back to legacy summaries), so surface them.
        appendSharedTripThreadTurn({
          tripId: props.trip.id,
          fromEmailLower: props.userEmail.trim().toLowerCase(),
          fromDisplayName: props.userDisplayName?.trim() || undefined,
          userContent: text,
          agentContent: reply,
          sentAtMs: contextAtMs,
          tripContextNote: where.summary,
          ...(requestKind ? { requestKind } : {}),
        }).catch((e) => {
          console.warn("[sharedTripThread] append failed", e);
          setError(
            e instanceof Error
              ? `Could not save to shared thread: ${e.message}`
              : "Could not save to shared thread"
          );
        });

        // 2) The speaker's PERSONAL `__global__` memory (cross-trip, never deleted).
        void appendImmutableMemoryQueueTurn(props.userEmail.trim().toLowerCase(), {
          tripId: "__global__",
          userFromEmail: props.userEmail.trim(),
          userContent: text,
          agentContent: reply,
          sentAtMs: contextAtMs + 2,
          tripContextNote: where.summary,
          originTripId: props.trip.id,
          ...(requestKind ? { requestKind } : {}),
        }).catch(() => {});

        // Best-effort compaction:
        //  - shared trip thread (any member can trigger; server verifies membership).
        //  - the speaker's per-user immutable queue (still hosts `__global__`).
        void (async () => {
          try {
            const auth = getClientAuth();
            const token = await auth?.currentUser?.getIdToken();
            if (!token) return;
            await Promise.all([
              fetch("/api/chat/shared-trip-thread-compact", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ tripId: props.trip.id }),
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
      const msg = err instanceof Error ? err.message : t("assistant.genericError");
      setError(msg);
      setLines((prev) => prev.slice(0, -1));
      setInput(text);
    } finally {
      setLoading(false);
    }
  }, [
    input,
    loading,
    evolving,
    forgetting,
    handleEvolve,
    lines,
    persistedTripMessageCount,
    props.canPersistMemory,
    props.profilePreferences,
    props.trip,
    props.tripChatMessages,
    props.userEmail,
    t,
  ]);

  const styleDock: CSSProperties = {
    position: "fixed",
    right: rightPx,
    bottom: bottomPx,
    zIndex: 50,
    width: open ? PANEL_W : FAB_SIZE,
    maxWidth: `min(${PANEL_W}px, calc(100vw - ${EDGE * 2}px))`,
  };

  return (
    <div className="pointer-events-none font-sans" style={styleDock}>
      <div className="pointer-events-auto flex flex-col items-end gap-2">
        {open ? (
          <section
            className="flex max-h-[min(70vh,520px)] w-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
            style={{ maxHeight: PANEL_MAX_H }}
          >
            <header
              className="flex cursor-grab touch-none items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2 active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-800/80"
              onPointerDown={onPointerDownHeader}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {t("assistant.title")}
                </p>
                <p className="truncate text-[11px] text-zinc-500">
                  {t("assistant.dragHint")}{" "}
                  {llmBackend === "anthropic"
                    ? t("assistant.poweredClaude")
                    : llmBackend === "openai"
                      ? t("assistant.poweredOpenAI")
                      : t("assistant.poweredGeneric")}
                </p>
                {activeModel ? (
                  <p className="truncate font-mono text-[10px] text-zinc-500 dark:text-zinc-400" title="LLM model id">
                    {activeModel}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setOpen(false)}
                className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                {t("common.close")}
              </button>
            </header>
            <div
              ref={listRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm leading-relaxed"
            >
              {lines.length === 0 ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("assistant.intro")}</p>
              ) : null}
              {lines.map((l, i) => (
                <div
                  key={`${i}-${l.role}`}
                  className={
                    l.role === "user"
                      ? "ml-6 rounded-xl bg-violet-600/10 px-3 py-2 text-zinc-900 dark:text-zinc-100"
                      : "mr-4 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-100"
                  }
                >
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {l.role === "user" ? t("assistant.you") : t("assistant.assistant")}
                  </p>
                  <TripAssistantMessageBody content={l.content} variant={l.role === "user" ? "user" : "assistant"} />
                </div>
              ))}
              {loading || evolving || forgetting ? (
                <p className="text-xs italic text-zinc-500 dark:text-zinc-400">
                  {forgetting
                    ? t("assistant.forgetting")
                    : evolving
                      ? t("assistant.evolving")
                      : t("assistant.thinking")}
                </p>
              ) : null}
              {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
            </div>
            <div className="border-t border-zinc-200 p-2 dark:border-zinc-700">
              <div className="flex gap-2">
                <textarea
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder={t("assistant.placeholder")}
                  className="min-h-[44px] flex-1 resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                  disabled={loading || evolving || forgetting}
                />
                <button
                  type="button"
                  disabled={loading || evolving || forgetting || !input.trim()}
                  onClick={() => void send()}
                  className="shrink-0 self-end rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
                >
                  {t("assistant.send")}
                </button>
              </div>
              {props.canPersistMemory && props.userEmail?.trim() && persistedTripMessageCount >= 1 && props.isTripOwner ? (
                <div className="mb-1 flex gap-2">
                  <button
                    type="button"
                    title={t("assistant.evolveTitle")}
                    disabled={
                      loading ||
                      evolving ||
                      forgetting ||
                      persistedTripMessageCount < 2 ||
                      evolveRedundantBlocked
                    }
                    onClick={() => void handleEvolve()}
                    className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800/80 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    {evolving ? t("assistant.evolving") : t("assistant.evolve")}
                  </button>
                  <button
                    type="button"
                    title={t("assistant.forgetTitle")}
                    disabled={loading || evolving || forgetting}
                    onClick={() => void handleForgetChat()}
                    className="min-w-0 flex-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] font-medium text-red-800 hover:bg-red-100 disabled:opacity-40 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/70"
                  >
                    {forgetting ? t("assistant.forgetting") : t("assistant.forget")}
                  </button>
                </div>
              ) : null}
              {!props.canPersistMemory ? (
                <p className="mt-1 px-1 text-[10px] text-zinc-400 dark:text-zinc-500">{t("assistant.memoryHint")}</p>
              ) : null}
            </div>
          </section>
        ) : null}
        <button
          type="button"
          aria-label={open ? t("assistant.closeChat") : t("assistant.openChat")}
          onPointerDown={onPointerDownFab}
          onClick={() => {
            if (swallowFabClickRef.current) {
              swallowFabClickRef.current = false;
              return;
            }
            if (open) setOpen(false);
          }}
          className="flex h-[52px] w-[52px] shrink-0 cursor-grab items-center justify-center rounded-full border border-violet-300 bg-gradient-to-br from-violet-500 to-violet-700 text-xl text-white shadow-lg ring-2 ring-white/30 active:cursor-grabbing dark:border-violet-400 dark:ring-zinc-900/40"
        >
          💬
        </button>
      </div>
    </div>
  );
}
