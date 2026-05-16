"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ExternalLink,
  Lock,
  Loader2,
  Send,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { logCaughtException } from "@/lib/logCaughtException";
import { OgImage } from "@/components/ui/og-image";
import { useAppSelector } from "@/lib/store/hooks";
import { useI18n } from "@/lib/i18n/context";
import { useTripData } from "@/lib/trip/useTripData";
import { useTripAssistantData } from "@/lib/agent/useTripAssistantData";
import { useTripAssistant } from "@/lib/agent/useTripAssistant";
import { useTripAgentViewerPingRefOptional } from "@/lib/agent/tripAgentViewerPingContext";
import { actionsForScreen } from "@/lib/agent/quickActions";
import {
  addTripRecommendation,
  approveTripRecommendationOptionDetailed,
  getWizardMissingFields,
  patchTripRecommendationOptionImage,
  removeTripRecommendation,
  skipTripRecommendation,
  unseenTripRecommendationCount,
} from "@/lib/tripRecommendations";
import type { WizardMissingField } from "@/lib/tripRecommendations";
import { applySchedulePatches } from "@/lib/tripScheduleCheck";
import { activeTripScreen } from "@/components/shell/navItems";
import { TripAssistantMessageBody } from "@/components/trip/TripAssistantMessageBody";
import { MentionInput } from "@/components/agent/MentionInput";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/ui/cn";
import { subscribeSharedTripThreadShared } from "@/lib/sharedTripThread";
import type { Trip, TripRecommendation, TripRecommendationOption } from "@/lib/types/trip";
import { fetchTripHeroCoverFromApi } from "@/lib/trip/heroCoverClient";

interface SmartDockProps {
  tripId: string | null;
}

/**
 * Combined "Travel Agent" floating action panel. Replaces the legacy
 * `TripAssistantChatDock` + `TripRecommendationsDock` with a single tabbed UI:
 *  - Chat:        full conversational thread + screen-aware quick actions
 *  - Suggestions: pending recommendations queue (approve / skip / delete)
 *  - Actions:     curated quick actions for the active screen
 */
export function SmartDock({ tripId }: SmartDockProps) {
  if (!tripId) return null;
  return <SmartDockInner tripId={tripId} />;
}

function SmartDockInner({ tripId }: { tripId: string }) {
  const { t } = useI18n();
  const pathname = usePathname() ?? "/";
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"chat" | "suggestions" | "actions">("chat");

  const trip = useAppSelector((s) => s.trip.trip);
  const screen = activeTripScreen(pathname, tripId);

  useEffect(() => {
    if (!trip || trip.id !== tripId.trim()) return;
    return subscribeSharedTripThreadShared(tripId, () => {}, undefined);
  }, [trip, tripId]);

  if (!trip || trip.id !== tripId) {
    return (
      <FloatingTrigger open={open} onOpenChange={setOpen} disabled badgeCount={0}>
        <PlaceholderCard onClose={() => setOpen(false)} />
      </FloatingTrigger>
    );
  }

  const unseen = unseenTripRecommendationCount(trip);

  return (
    <FloatingTrigger
      open={open}
      onOpenChange={setOpen}
      badgeCount={unseen}
      reducedMotion={Boolean(reduce)}
    >
      <DockPanel
        trip={trip}
        tripId={tripId}
        tab={tab}
        onTabChange={setTab}
        onClose={() => setOpen(false)}
        screen={screen}
      />
    </FloatingTrigger>
  );
}

function FloatingTrigger({
  open,
  onOpenChange,
  children,
  badgeCount,
  reducedMotion,
  disabled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children: React.ReactNode;
  badgeCount: number;
  reducedMotion?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <>
      <motion.button
        type="button"
        onClick={() => !disabled && onOpenChange(!open)}
        whileHover={reducedMotion ? undefined : { scale: 1.04 }}
        whileTap={reducedMotion ? undefined : { scale: 0.96 }}
        aria-label={open ? t("agent.closeLabel") : t("agent.openLabel")}
        className={cn(
          "fixed bottom-20 end-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-brand text-white shadow-[var(--shadow-float)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-brand)]/40 lg:bottom-6 lg:end-6",
          disabled ? "opacity-50" : ""
        )}
      >
        <Sparkles className="h-6 w-6" />
        {badgeCount > 0 ? (
          <span className="absolute -end-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-accent-coral)] px-1 text-[10px] font-bold text-white shadow-[var(--shadow-soft)]">
            {badgeCount}
          </span>
        ) : null}
      </motion.button>

      <AnimatePresence>
        {open ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] lg:hidden"
              onClick={() => onOpenChange(false)}
              onWheel={(e) => e.stopPropagation()}
            />
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.97 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              role="dialog"
              aria-modal="true"
              aria-label={t("agent.title")}
              className="fixed bottom-24 left-3 right-3 z-50 mx-auto flex max-h-[78dvh] min-h-0 w-auto max-w-md flex-col overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-float)] lg:start-auto lg:end-6 lg:mx-0 lg:w-[28rem] lg:max-w-none"
            >
              {children}
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function PlaceholderCard({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{t("agent.title")}</p>
        <IconButton label={t("common.close")} variant="ghost" onClick={onClose} size="sm">
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <p className="text-sm text-[var(--color-muted-foreground)]">{t("trip.loading")}</p>
    </div>
  );
}

function DockPanel({
  trip,
  tripId,
  tab,
  onTabChange,
  onClose,
  screen,
}: {
  trip: Trip;
  tripId: string;
  tab: "chat" | "suggestions" | "actions";
  onTabChange: (v: "chat" | "suggestions" | "actions") => void;
  onClose: () => void;
  screen: ReturnType<typeof activeTripScreen>;
}) {
  const { t } = useI18n();
  const { persistTrip, isOwner, canManage } = useTripData(tripId);
  const data = useTripAssistantData(trip);

  // Always reflects the most-recently-persisted trip, updated synchronously before
  // any async persist so image patches never land on a stale (pre-recommendation) snapshot.
  const latestTripRef = useRef(trip);
  latestTripRef.current = trip;

  const onAddRecommendations = useCallback(
    async (baseTrip: Trip, recs: TripRecommendation[]) => {
      if (!canManage) return;
      let next = baseTrip;
      for (const rec of recs) {
        next = addTripRecommendation(next, rec);
      }
      latestTripRef.current = next; // update before await so image patches see the new recs
      await persistTrip(next);
    },
    [canManage, persistTrip]
  );

  const onUpdateOptionImage = useCallback(
    (recId: string, optionId: string, imageUrl: string, priceNote?: string) => {
      if (!canManage) return;
      const patched = patchTripRecommendationOptionImage(latestTripRef.current, recId, optionId, imageUrl, priceNote);
      latestTripRef.current = patched;
      void persistTrip(patched);
    },
    [canManage, persistTrip]
  );

  const onScheduleFix = useCallback(
    async (baseTripForFix: Trip, patches: import("@/lib/tripScheduleCheck").SchedulePatch[]) => {
      if (!canManage) return;
      const patched = applySchedulePatches(latestTripRef.current ?? baseTripForFix, patches);
      latestTripRef.current = patched;
      await persistTrip(patched);
    },
    [canManage, persistTrip]
  );

  const viewerPingRef = useTripAgentViewerPingRefOptional();

  const assistant = useTripAssistant({
    trip,
    profilePreferences: data.profilePreferences,
    tripChatMessages: data.tripChatMessages,
    globalChatMessages: data.globalChatMessages,
    userEmail: data.userEmailLower,
    userDisplayName: data.user?.displayName?.trim() ?? null,
    isTripOwner: isOwner,
    canPersistMemory: data.canPersistMemory,
    onAddRecommendations,
    onUpdateOptionImage,
    onScheduleFix,
    ...(viewerPingRef ? { viewerPingRef } : {}),
  });

  const userEmailLower = data.userEmailLower ?? null;
  const recommendations = trip.recommendations ?? [];
  const visibleRecommendations = recommendations.filter(
    (r) => !r.visibleTo || !userEmailLower || r.visibleTo.includes(userEmailLower)
  );
  const recommendationCount = visibleRecommendations.length;

  return (
    <>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-gradient-aurora p-4 text-white">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-80">
            {t("agent.title")}
          </p>
          <p className="text-sm font-semibold">{t("agent.subtitle")}</p>
          {assistant.activeModel ? (
            <p className="mt-0.5 text-[10px] opacity-75" title={assistant.activeModel}>
              {assistant.llmBackend === "anthropic"
                ? t("assistant.poweredClaude")
                : assistant.llmBackend === "openai"
                  ? t("assistant.poweredOpenAI")
                  : t("assistant.poweredGeneric")}
            </p>
          ) : null}
        </div>
        <IconButton
          label={t("agent.closeLabel")}
          variant="ghost"
          onClick={onClose}
          className="text-white hover:bg-white/15"
        >
          <X className="h-4 w-4" />
        </IconButton>
      </header>

      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(v as typeof tab)}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="shrink-0 px-4 pt-3">
          <TabsList className="w-full">
            <TabsTrigger value="chat" className="flex-1">
              {t("agent.tabChat")}
            </TabsTrigger>
            <TabsTrigger value="suggestions" className="flex-1">
              {t("agent.tabSuggestions")}
              {recommendationCount > 0 ? (
                <Badge tone="brand" className="ml-1 px-1.5">
                  {recommendationCount}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="actions" className="flex-1">
              {t("agent.tabActions")}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="chat" className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden">
          <ChatTab
            assistant={assistant}
            screen={screen}
            isOwner={isOwner}
            tripId={tripId}
            onViewSuggestions={() => onTabChange("suggestions")}
          />
        </TabsContent>

        <TabsContent
          value="suggestions"
          className="m-0 flex max-h-[55dvh] min-h-0 flex-col overflow-y-auto px-4 pb-4 data-[state=inactive]:hidden"
        >
          <SuggestionsTab
            trip={trip}
            persistTrip={persistTrip}
            canManage={canManage}
            userEmail={userEmailLower}
            pendingImageOptIds={assistant.pendingImageOptIds}
            assistantLoading={assistant.loading}
            onWizardStep={(message) => {
              void assistant.send(message, { forceKind: "suggestions" });
            }}
            onTighten={(rec, option) => {
              const label = option.label?.trim() || option.interval.title.trim();
              const prefix = rec.visibleTo && rec.visibleTo.length > 0 ? "@private " : "";
              assistant.prepare(
                `${prefix}Dig deeper on "${label}" (${rec.kind}${rec.title ? ` — "${rec.title}"` : ""}). ` +
                  `Search Tripadvisor first and suggest 3 specific alternatives for this exact slot. For each option: ` +
                  `(1) \`url\` = Tripadvisor search URL: tripadvisor.com/Search?q={Name+City} (for reviews); ` +
                  `(2) \`bookingUrl\` = Booking.com search URL with trip dates: booking.com/searchresults.html?ss={Name+City}&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&group_adults=N&no_rooms=1 (for availability); ` +
                  `(3) \`imageUrl\` = direct CDN image URL from the Tripadvisor listing's og:image meta tag (e.g. https://media-cdn.tripadvisor.com/media/photo-s/.../.jpg) — NOT a homepage; ` +
                  `(4) specific price in local currency for \`priceNote\`, Tripadvisor rating, what's included, and why it fits this trip.`
              );
              onTabChange("chat");
            }}
          />
        </TabsContent>

        <TabsContent
          value="actions"
          className="m-0 flex max-h-[55dvh] min-h-0 flex-col overflow-y-auto px-4 pb-4 data-[state=inactive]:hidden"
        >
          <ActionsTab
            screen={screen}
            trip={trip}
            canManage={canManage}
            persistTrip={persistTrip}
            onPickPrompt={(prompt) => {
              assistant.prepare(prompt);
              onTabChange("chat");
            }}
            onScheduleCheck={() => {
              void assistant.send("check my schedule", { forceKind: "specific" });
              onTabChange("chat");
            }}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

function ChatTab({
  assistant,
  screen,
  isOwner,
  tripId,
  onViewSuggestions,
}: {
  assistant: ReturnType<typeof useTripAssistant>;
  screen: ReturnType<typeof activeTripScreen>;
  isOwner: boolean;
  tripId: string;
  onViewSuggestions: () => void;
}) {
  const { t } = useI18n();
  const draftKey = `chat-draft:${tripId}`;
  const [input, setInput] = useState(() => {
    try { return localStorage.getItem(draftKey) ?? ""; } catch (e) { logCaughtException(e, "SmartDock/ChatTab/loadDraft"); return ""; }
  });
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (assistant.pendingDraft != null) {
      const draft = assistant.pendingDraft;
      setInput(draft);
      try { draft ? localStorage.setItem(draftKey, draft) : localStorage.removeItem(draftKey); } catch (e) { logCaughtException(e, "SmartDock/ChatTab/persistDraft"); }
      assistant.consumeDraft();
    }
  }, [assistant.pendingDraft, assistant]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [assistant.lines, assistant.loading]);

  const actions = actionsForScreen(screen);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;

    // Expand [action-tag] prefix to the full action prompt + any user context.
    let sendText = text;
    let sendOpts: Parameters<typeof assistant.send>[1];
    const tagMatch = text.match(/^\[([\w-]+)\]\s*([\s\S]*)/);
    if (tagMatch) {
      const action = actions.find((a) => a.id === tagMatch[1]);
      if (action) {
        const userContext = tagMatch[2].trim();
        sendText = userContext ? `${action.prompt}\n\n${userContext}` : action.prompt;
        // Mirror the same forceKind the Actions tab uses so the route handles
        // effects (e.g. schedule-fix patches) the same way.
        if (action.effect === "schedule-check") {
          sendOpts = { forceKind: "specific" };
        }
      }
    }

    setInput("");
    try { localStorage.removeItem(draftKey); } catch (e) { logCaughtException(e, "SmartDock/ChatTab/clearDraft"); }
    await assistant.send(sendText, sendOpts);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {isOwner && assistant.lines.length > 0 ? (
        <div className="flex shrink-0 justify-end border-b border-[var(--color-border)] px-3 py-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={assistant.forgetting || assistant.loading}
            aria-label={t("agent.clearChat")}
            title={t("agent.clearChat")}
            className="h-7 gap-1 px-2 text-[11px] text-[var(--color-muted-foreground)] hover:text-[var(--color-danger)]"
            onClick={() => void assistant.forget()}
          >
            {assistant.forgetting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            {t("agent.clearChat")}
          </Button>
        </div>
      ) : null}
      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-y-contain px-4 py-3 [-webkit-overflow-scrolling:touch]"
      >
        {assistant.lines.length === 0 && !assistant.loading ? (
          <p className="rounded-2xl bg-[var(--color-surface-muted)] px-3 py-3 text-sm text-[var(--color-muted-foreground)]">
            {t("agent.empty")}
          </p>
        ) : null}
        {assistant.lines.map((line, i) => {
          const isUser = line.role === "user";
          const isPrivate = isUser && /@private\b/i.test(line.content);
          const mentionMatch = isUser ? line.content.match(/@([A-Za-z0-9_.-]+)/g)?.find(
            (m) => !/@private\b/i.test(m) && !/@all\b/i.test(m)
          ) : undefined;
          // Strip @private and @all from the displayed text.
          const displayContent = isUser
            ? line.content.replace(/@private\b\s*/gi, "").replace(/@all\b\s*/gi, "").trim()
            : line.content;
          return (
            <div key={i} className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
              {isUser && (isPrivate || mentionMatch) ? (
                <div className="mb-0.5 flex gap-1 px-1">
                  {isPrivate ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-muted-foreground)]">
                      <Lock className="h-2.5 w-2.5" />
                      {t("agent.audiencePrivate")}
                    </span>
                  ) : null}
                  {mentionMatch ? (
                    <span className="rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-muted-foreground)]">
                      {t("agent.audienceTo")} {mentionMatch}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div
                className={cn(
                  "max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                  isUser
                    ? "bg-gradient-brand text-white"
                    : "bg-[var(--color-surface-muted)] text-[var(--color-foreground)]"
                )}
              >
                <TripAssistantMessageBody content={displayContent} variant={line.role} />
              </div>
            </div>
          );
        })}
        {!assistant.loading && assistant.latestSuggestionBatch ? (
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={() => {
                assistant.dismissSuggestionBatch();
                onViewSuggestions();
              }}
              className="flex items-center gap-2 rounded-2xl border border-[var(--color-brand)]/30 bg-[var(--color-brand-soft)] px-3 py-2 text-left text-xs text-[var(--color-brand)] shadow-[var(--shadow-soft)] hover:bg-[var(--color-brand)]/15 transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span className="font-medium">
                {assistant.latestSuggestionBatch.count === 1
                  ? t("recs.suggestionBridgeSingle")
                  : t("recs.suggestionBridgeMany", { count: assistant.latestSuggestionBatch.count })}
              </span>
              <span className="opacity-60">→</span>
            </button>
          </div>
        ) : null}
        {assistant.loading ? (
          <div className="inline-flex items-center gap-2 rounded-2xl bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("agent.thinking")}
          </div>
        ) : null}
        {assistant.error ? (
          <p className="rounded-2xl border border-[var(--color-danger)]/40 bg-[color-mix(in_oklab,var(--color-danger)_12%,transparent)] px-3 py-2 text-xs text-[var(--color-danger)]">
            {assistant.error}
          </p>
        ) : null}
        {assistant.pendingScheduleFix ? (
          <div className="sticky bottom-0 rounded-2xl border border-[var(--color-brand)]/30 bg-[var(--color-surface)] p-3 shadow-[var(--shadow-soft)]">
            <p className="mb-2 text-xs font-semibold text-[var(--color-foreground)]">
              {t("agent.scheduleFixReady")}
            </p>
            {assistant.pendingScheduleFix.summary ? (
              <p className="mb-2.5 text-xs text-[var(--color-muted-foreground)]">
                {assistant.pendingScheduleFix.summary}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={() => void assistant.applyScheduleFix()}
              >
                {t("agent.scheduleFixSave")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="flex-1"
                onClick={assistant.discardScheduleFix}
              >
                {t("agent.scheduleFixDiscard")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {actions.length > 0 ? (
        <div className="shrink-0 border-t border-[var(--color-border)] px-4 py-2">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            {t("agent.actionsForScreen", { screen: screen ?? "trip" })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {actions.slice(0, 3).map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.id}
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
                  onClick={() => {
                    // Preserve any user text after an existing tag, then swap in the new tag.
                    const userText = input.replace(/^\[[\w-]+\]\s*/, "").trim();
                    setInput(userText ? `[${a.id}] ${userText}` : `[${a.id}] `);
                  }}
                >
                  <Icon className="h-3 w-3" /> {t(a.labelKey)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="flex shrink-0 items-end gap-2 border-t border-[var(--color-border)] p-3"
      >
        <MentionInput
          value={input}
          onChange={(v) => {
            setInput(v);
            try { v ? localStorage.setItem(draftKey, v) : localStorage.removeItem(draftKey); } catch (e) { logCaughtException(e, "SmartDock/ChatTab/persistInputDraft"); }
            if (assistant.error) assistant.clearError();
          }}
          onSubmit={() => void onSubmit({ preventDefault: () => {} } as React.FormEvent)}
          placeholder={t("agent.placeholder")}
          disabled={assistant.loading || assistant.evolving || assistant.forgetting}
        />
        {assistant.loading ? (
          <Button
            type="button"
            size="icon"
            variant="primary"
            aria-label={t("agent.stop")}
            title={t("agent.stop")}
            onClick={() => assistant.stop()}
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            variant="primary"
            disabled={assistant.evolving || assistant.sendLocked || !input.trim()}
            aria-label={t("agent.send")}
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </form>
    </div>
  );
}

function buildWizardMessage(
  option: TripRecommendationOption,
  rec: TripRecommendation,
  missing: WizardMissingField[]
): string {
  const label =
    option.label?.trim() ||
    (option.interval as { title?: string }).title?.trim() ||
    rec.title?.trim() ||
    rec.kind;
  const parts: string[] = [`I just approved "${label}" (${rec.kind}).`];
  if (missing.includes("time") && missing.includes("price")) {
    parts.push(
      "It's missing both a time slot and a price estimate. Please suggest 3 concrete options each with a specific date/time range and an estimated cost."
    );
  } else if (missing.includes("time")) {
    parts.push(
      "It's missing a specific time slot. Please suggest 3 concrete time options (e.g. morning / afternoon / evening) with exact start and end times."
    );
  } else if (missing.includes("price")) {
    parts.push(
      "It's missing a price estimate. Please suggest 3 pricing options (budget / mid-range / premium) with specific estimated costs."
    );
  }
  if (missing.includes("note")) {
    parts.push(
      "Also include a short recommendation or warning for each option."
    );
  }
  return parts.join(" ");
}

function SuggestionsTab({
  trip,
  persistTrip,
  canManage,
  userEmail,
  pendingImageOptIds,
  assistantLoading,
  onTighten,
  onWizardStep,
}: {
  trip: Trip;
  persistTrip: (next: Trip) => Promise<void>;
  canManage: boolean;
  userEmail: string | null;
  pendingImageOptIds: Set<string>;
  assistantLoading: boolean;
  onTighten: (rec: TripRecommendation, option: TripRecommendationOption) => void;
  onWizardStep: (message: string) => void;
}) {
  const { t } = useI18n();
  const [wizardLabel, setWizardLabel] = useState<string | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<Trip | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleUndoDismiss = useCallback(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoSnapshot(null), 12_000);
  }, []);

  useEffect(() => () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); }, []);

  // Clear the wizard loading banner once the assistant finishes.
  useEffect(() => {
    if (!assistantLoading) setWizardLabel(null);
  }, [assistantLoading]);

  const recs = (trip.recommendations ?? []).filter(
    (r) => !r.visibleTo || !userEmail || r.visibleTo.includes(userEmail)
  );

  const isEmpty = recs.length === 0 && !wizardLabel && !undoSnapshot;
  if (isEmpty) {
    return (
      <p className="rounded-2xl bg-[var(--color-surface-muted)] px-3 py-3 text-sm text-[var(--color-muted-foreground)]">
        {t("agent.suggestionsEmpty")}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {undoSnapshot ? (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-[var(--color-brand)]/30 bg-[var(--color-surface)] px-3 py-2 shadow-[var(--shadow-soft)]">
          <p className="text-xs text-[var(--color-muted-foreground)]">{t("recs.applied")}</p>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={async () => {
              await persistTrip(undoSnapshot);
              setUndoSnapshot(null);
            }}
          >
            {t("recs.undo")}
          </Button>
        </div>
      ) : null}
      {wizardLabel ? (
        <div className="flex items-center gap-3 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--color-muted-foreground)]" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[var(--color-muted-foreground)]">
              {t("recs.wizardRefining")}
            </p>
            <p className="truncate text-xs text-[var(--color-muted-foreground)] opacity-70">
              {wizardLabel}
            </p>
          </div>
        </div>
      ) : null}
      {recs.map((rec) => (
        <RecommendationCard
          key={rec.id}
          trip={trip}
          rec={rec}
          canManage={canManage}
          pendingImageOptIds={pendingImageOptIds}
          onApprove={async (optionId) => {
            const option = (rec.options as TripRecommendationOption[]).find((o) => o.id === optionId);
            const snapshot = trip;
            const next = approveTripRecommendationOptionDetailed(trip, rec.id, optionId).trip;
            await persistTrip(next);
            setUndoSnapshot(snapshot);
            scheduleUndoDismiss();
            if (option) {
              const missing = getWizardMissingFields(option, rec);
              if (missing.length > 0) {
                const label = option.label?.trim() || (option.interval as { title?: string }).title?.trim() || rec.title || rec.kind;
                setWizardLabel(label);
                onWizardStep(buildWizardMessage(option, rec, missing));
              }
            }
          }}
          onSkip={async () => {
            await persistTrip(skipTripRecommendation(trip, rec.id));
          }}
          onDelete={async () => {
            await persistTrip(removeTripRecommendation(trip, rec.id));
          }}
          onTighten={(optionId) => {
            const option = (rec.options as TripRecommendationOption[]).find((o) => o.id === optionId);
            if (option) onTighten(rec, option);
          }}
        />
      ))}
    </div>
  );
}

function RecommendationCard({
  trip,
  rec,
  canManage,
  pendingImageOptIds,
  onApprove,
  onSkip,
  onDelete,
  onTighten,
}: {
  trip: Trip;
  rec: TripRecommendation;
  canManage: boolean;
  pendingImageOptIds: Set<string>;
  onApprove: (optionId: string) => Promise<void>;
  onSkip: () => Promise<void>;
  onDelete: () => Promise<void>;
  onTighten: (optionId: string) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<"approve" | "skip" | "delete" | null>(null);
  const tone =
    rec.kind === "stay" ? "brand" : rec.kind === "transit" ? "sky" : "mint";
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Badge tone={tone}>{rec.kind}</Badge>
          {rec.visibleTo && rec.visibleTo.length > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-muted-foreground)]">
              <Lock className="h-2.5 w-2.5" />
              {t("agent.audiencePrivate")}
            </span>
          ) : null}
        </div>
        {rec.seen ? null : <Badge tone="coral">{t("recs.newPill")}</Badge>}
      </div>
      {rec.title ? (
        <p className="mt-2 text-sm font-semibold text-[var(--color-foreground)]">{rec.title}</p>
      ) : null}
      {rec.note ? (
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{rec.note}</p>
      ) : null}

      <ul className="mt-3 space-y-2">
        {rec.options.map((opt: TripRecommendationOption) => {
          const label = opt.label?.trim() || opt.interval.title.trim() || t("recs.optionFallback", { index: 1 });
          return (
            <li
              key={opt.id}
              className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)]"
            >
              {opt.imageUrl ? (
                <OgImage
                  src={opt.imageUrl}
                  alt={label}
                  className="h-28 w-full object-cover"
                />
              ) : pendingImageOptIds.has(opt.id) ? (
                <div className="h-28 w-full animate-pulse bg-[var(--color-surface-raised)]" />
              ) : null}

              <div className="flex items-start justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--color-foreground)]">{label}</p>
                  {opt.priceNote ? (
                    <p className="mt-0.5 text-[11px] font-semibold text-[var(--color-brand)]">
                      {opt.priceNote}
                    </p>
                  ) : null}
                  {opt.note ? (
                    <p className="mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">
                      {opt.note}
                    </p>
                  ) : null}
                  {opt.targetStepId ? (
                    <p className="mt-0.5 text-[10px] text-[var(--color-muted-foreground)]">
                      {t("recs.addsToStep", {
                        stepTitle:
                          trip.steps.find((s) => s.id === opt.targetStepId)?.title?.trim() ||
                          opt.targetStepId,
                      })}
                    </p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {opt.url ? (() => {
                      let hostname = opt.url;
                      try { hostname = new URL(opt.url).hostname.replace(/^www\./, ""); } catch {}
                      return (
                        <a
                          href={opt.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-[var(--color-brand)] underline-offset-2 hover:underline"
                        >
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                          {hostname.includes("tripadvisor") ? "View on Tripadvisor" : "Reviews"} · <span className="opacity-70">{hostname}</span>
                        </a>
                      );
                    })() : null}
                    {opt.bookingUrl ? (() => {
                      let hostname = opt.bookingUrl;
                      try { hostname = new URL(opt.bookingUrl).hostname.replace(/^www\./, ""); } catch {}
                      return (
                        <a
                          href={opt.bookingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-[var(--color-brand)] underline-offset-2 hover:underline"
                        >
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                          Check availability · <span className="opacity-70">{hostname}</span>
                        </a>
                      );
                    })() : null}
                  </div>
                </div>
                {canManage ? (
                <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy != null}
                  title={t("recs.tighten")}
                  aria-label={t("recs.tighten")}
                  onClick={() => onTighten(opt.id)}
                >
                  <Wand2 className="h-3 w-3" />
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy != null}
                  onClick={async () => {
                    setBusy("approve");
                    try {
                      await onApprove(opt.id);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === "approve" ? <Loader2 className="h-3 w-3 animate-spin" /> : t("recs.approve")}
                </Button>
                </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {canManage ? <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy != null}
          onClick={async () => {
            setBusy("skip");
            try {
              await onSkip();
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "skip" ? <Loader2 className="h-3 w-3 animate-spin" /> : t("recs.skip")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-[var(--color-danger)]"
          disabled={busy != null}
          onClick={async () => {
            setBusy("delete");
            try {
              await onDelete();
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "delete" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
        </Button>
      </div> : null}
    </div>
  );
}

function ActionsTab({
  screen,
  trip,
  canManage,
  persistTrip,
  onPickPrompt,
  onScheduleCheck,
}: {
  screen: ReturnType<typeof activeTripScreen>;
  trip: Trip;
  canManage: boolean;
  persistTrip: (next: Trip) => Promise<void>;
  onPickPrompt: (prompt: string) => void;
  onScheduleCheck: () => void;
}) {
  const { t } = useI18n();
  const actions = actionsForScreen(screen);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [heroCoverActionError, setHeroCoverActionError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {heroCoverActionError ? (
        <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-danger)]">
          {heroCoverActionError}
        </p>
      ) : null}
      <p className="text-xs text-[var(--color-muted-foreground)]">
        {t("agent.actionsForScreen", { screen: screen ?? "trip" })}
      </p>
      {actions.map((a) => {
        const Icon = a.icon;
        const heroEffect = a.effect === "hero-cover";
        const scheduleCheckEffect = a.effect === "schedule-check";
        const disabled = heroEffect && (!canManage || trip.destinations.length === 0);
        return (
          <button
            key={a.id}
            type="button"
            disabled={Boolean(busyId) || disabled}
            onClick={() => {
              if (scheduleCheckEffect) {
                onScheduleCheck();
                return;
              }
              if (heroEffect) {
                if (!canManage || trip.destinations.length === 0) return;
                setBusyId(a.id);
                setHeroCoverActionError(null);
                void (async () => {
                  try {
                    const partial = await fetchTripHeroCoverFromApi(trip);
                    const now = new Date().toISOString();
                    await persistTrip({
                      ...trip,
                      heroCover: { ...partial, updatedAt: now },
                      updatedAt: now,
                    });
                    setHeroCoverActionError(null);
                  } catch (e) {
                    const msg =
                      e instanceof Error && e.message.trim()
                        ? e.message.trim()
                        : t("tripHero.heroCoverFailed");
                    setHeroCoverActionError(msg.length > 280 ? `${msg.slice(0, 280)}…` : msg);
                  } finally {
                    setBusyId(null);
                  }
                })();
                return;
              }
              onPickPrompt(a.prompt);
            }}
            className="flex w-full items-start gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
              {busyId === a.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Icon className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--color-foreground)]">{t(a.labelKey)}</p>
              <p className="truncate text-[11px] text-[var(--color-muted-foreground)]">
                {a.prompt}
              </p>
            </div>
            <Wand2 className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
          </button>
        );
      })}
    </div>
  );
}
