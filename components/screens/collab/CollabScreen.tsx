"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  CornerDownRight,
  Heart,
  MessagesSquare,
  Send,
  ThumbsUp,
  Trash2,
  Users,
  Vote,
} from "lucide-react";
import { useFirebaseUser } from "@/lib/auth/useFirebaseUser";
import { useI18n } from "@/lib/i18n/context";
import { useTripData } from "@/lib/trip/useTripData";
import { TripLoadStateScreen } from "@/components/screens/_shared/TripLoadStateScreen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage, avatarInitials } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty";
import {
  addComment,
  deleteComment,
  setCommentResolved,
  toggleCommentReaction,
} from "@/lib/comments/tripComments";
import { toggleRecommendationVote, votesForOption } from "@/lib/tripRecommendations";
import type {
  Trip,
  TripComment,
  TripLiveLocation,
  TripRecommendation,
} from "@/lib/types/trip";

export function CollabScreen({ tripId }: { tripId: string }) {
  const { trip, loadState } = useTripData(tripId);
  if (loadState !== "ok" || !trip) return <TripLoadStateScreen state={loadState} />;
  return <CollabContent trip={trip} />;
}

function CollabContent({ trip }: { trip: Trip }) {
  const { t } = useI18n();
  const { user } = useFirebaseUser();
  const { persistTrip } = useTripData(trip.id);
  const userEmail = user?.email?.trim().toLowerCase() ?? "";
  const myDisplayName = user?.displayName?.trim() ?? userEmail.split("@")[0] ?? "You";

  const [composer, setComposer] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const comments = trip.comments ?? [];
  const topLevel = useMemo(() => comments.filter((c) => !c.parentId), [comments]);
  const repliesByParent = useMemo(() => {
    const map = new Map<string, TripComment[]>();
    for (const c of comments) {
      if (!c.parentId) continue;
      const list = map.get(c.parentId) ?? [];
      list.push(c);
      map.set(c.parentId, list);
    }
    return map;
  }, [comments]);

  async function postComment(parentId?: string) {
    const text = composer.trim();
    if (!text || !userEmail) return;
    const next = addComment(trip, {
      authorId: userEmail,
      authorName: myDisplayName,
      body: text,
      targetType: "trip",
      targetId: trip.id,
      ...(parentId ? { parentId } : {}),
    });
    await persistTrip(next);
    setComposer("");
    setReplyTo(null);
  }

  async function onToggleResolve(comment: TripComment) {
    await persistTrip(setCommentResolved(trip, comment.id, !comment.resolved));
  }

  async function onLike(comment: TripComment) {
    if (!userEmail) return;
    await persistTrip(toggleCommentReaction(trip, comment.id, userEmail));
  }

  async function onDelete(comment: TripComment) {
    await persistTrip(deleteComment(trip, comment.id));
  }

  async function onVote(rec: TripRecommendation, optionId: string) {
    if (!userEmail) return;
    await persistTrip(toggleRecommendationVote(trip, rec.id, optionId, userEmail));
  }

  const liveEntries = Object.entries(trip.liveLocations ?? {});

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 lg:px-8">
      <header>
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-brand)]">
          <MessagesSquare className="h-3.5 w-3.5" /> {trip.title}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--color-foreground)]">
          {t("collab.heading")}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t("collab.subheading")}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessagesSquare className="h-4 w-4 text-[var(--color-brand)]" /> {t("collab.comments")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Composer
              value={composer}
              onChange={setComposer}
              onSubmit={() => void postComment()}
              placeholder={t("collab.commentPlaceholder")}
              cta={t("collab.postComment")}
              disabled={!userEmail}
            />

            {topLevel.length === 0 ? (
              <p className="rounded-2xl bg-[var(--color-surface-muted)] px-3 py-3 text-sm text-[var(--color-muted-foreground)]">
                {t("collab.noComments")}
              </p>
            ) : (
              <ul className="space-y-3">
                {topLevel.map((c) => {
                  const replies = repliesByParent.get(c.id) ?? [];
                  return (
                    <li key={c.id}>
                      <CommentBubble
                        comment={c}
                        myEmail={userEmail}
                        onLike={() => void onLike(c)}
                        onResolve={() => void onToggleResolve(c)}
                        onDelete={() => void onDelete(c)}
                        onReply={() => setReplyTo(c.id === replyTo ? null : c.id)}
                      />
                      {replies.length > 0 ? (
                        <ul className="ml-9 mt-2 space-y-2">
                          {replies.map((r) => (
                            <li key={r.id}>
                              <CommentBubble
                                comment={r}
                                myEmail={userEmail}
                                onLike={() => void onLike(r)}
                                onResolve={() => void onToggleResolve(r)}
                                onDelete={() => void onDelete(r)}
                                isReply
                              />
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {replyTo === c.id ? (
                        <div className="ml-9 mt-2">
                          <Composer
                            value={composer}
                            onChange={setComposer}
                            onSubmit={() => void postComment(c.id)}
                            placeholder={t("collab.replyPlaceholder")}
                            cta={t("collab.reply")}
                            disabled={!userEmail}
                            small
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Vote className="h-4 w-4 text-[var(--color-accent-coral)]" /> {t("collab.voting")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <VotingPanel
                trip={trip}
                myEmail={userEmail}
                onVote={(rec, optionId) => void onVote(rec, optionId)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-4 w-4 text-[var(--color-accent-mint)]" /> {t("collab.presence")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PresencePanel trip={trip} entries={liveEntries} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  cta,
  disabled,
  small,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  cta: string;
  disabled?: boolean;
  small?: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex items-end gap-2"
    >
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={small ? 1 : 2}
        disabled={disabled}
        className="flex-1 resize-none rounded-2xl"
      />
      <Button type="submit" size={small ? "sm" : "md"} disabled={disabled || !value.trim()}>
        <Send className="h-4 w-4" />
        <span className={small ? "sr-only" : ""}>{cta}</span>
      </Button>
    </form>
  );
}

function CommentBubble({
  comment,
  myEmail,
  onLike,
  onResolve,
  onDelete,
  onReply,
  isReply,
}: {
  comment: TripComment;
  myEmail: string;
  onLike: () => void;
  onResolve: () => void;
  onDelete: () => void;
  onReply?: () => void;
  isReply?: boolean;
}) {
  const { t } = useI18n();
  const ago = formatAgo(comment.createdAt);
  const liked = (comment.reactions ?? []).includes(myEmail);
  return (
    <div
      className={
        "flex gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-soft)] " +
        (comment.resolved ? "opacity-60" : "")
      }
    >
      <Avatar className="h-8 w-8">
        <AvatarFallback>{avatarInitials(comment.authorName ?? comment.authorId)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-[var(--color-foreground)]">
            {comment.authorName ?? comment.authorId}
          </p>
          <span className="text-[10px] text-[var(--color-muted-foreground)]">{ago}</span>
          {comment.resolved ? <Badge tone="success">{t("collab.resolved")}</Badge> : null}
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-foreground)]">{comment.body}</p>
        <div className="mt-2 flex items-center gap-1 text-xs text-[var(--color-muted-foreground)]">
          <Button size="sm" variant="ghost" onClick={onLike} className={liked ? "text-[var(--color-accent-coral)]" : ""}>
            <Heart className="h-3.5 w-3.5" />
            {(comment.reactions ?? []).length || ""}
          </Button>
          {!isReply && onReply ? (
            <Button size="sm" variant="ghost" onClick={onReply}>
              <CornerDownRight className="h-3.5 w-3.5" /> {t("collab.reply")}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onResolve}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            {comment.resolved ? t("collab.unresolve") : t("collab.resolve")}
          </Button>
          {comment.authorId === myEmail ? (
            <Button size="sm" variant="ghost" onClick={onDelete} className="text-[var(--color-danger)]">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function VotingPanel({
  trip,
  myEmail,
  onVote,
}: {
  trip: Trip;
  myEmail: string;
  onVote: (rec: TripRecommendation, optionId: string) => void;
}) {
  const { t } = useI18n();
  const recs = trip.recommendations ?? [];
  if (recs.length === 0) {
    return (
      <p className="rounded-2xl bg-[var(--color-surface-muted)] px-3 py-3 text-sm text-[var(--color-muted-foreground)]">
        {t("collab.votingEmpty")}
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {recs.map((rec) => (
        <li key={rec.id} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="flex items-center gap-2">
            <Badge tone={rec.kind === "stay" ? "brand" : rec.kind === "transit" ? "sky" : "mint"}>
              {rec.kind}
            </Badge>
            <p className="truncate text-sm font-semibold text-[var(--color-foreground)]">{rec.title || ""}</p>
          </div>
          <ul className="mt-2 space-y-1.5">
            {rec.options.map((opt) => {
              const voters = votesForOption(trip, rec.id, opt.id);
              const myVote = voters.includes(myEmail);
              return (
                <li
                  key={opt.id}
                  className="flex items-center justify-between gap-2 rounded-xl bg-[var(--color-surface-muted)] px-2.5 py-1.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {opt.label || opt.interval.title || t("recs.optionFallback", { index: 1 })}
                    </span>
                    <span className="block text-[10px] text-[var(--color-muted-foreground)]">
                      {t("collab.votedLabel", { count: voters.length })}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant={myVote ? "soft" : "outline"}
                    onClick={() => onVote(rec, opt.id)}
                    aria-label={myVote ? t("collab.removeVote") : t("collab.castVote")}
                  >
                    <ThumbsUp className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function PresencePanel({
  trip,
  entries,
}: {
  trip: Trip;
  entries: [string, TripLiveLocation][];
}) {
  const { t } = useI18n();
  if (entries.length === 0) {
    return (
      <p className="rounded-2xl bg-[var(--color-surface-muted)] px-3 py-3 text-sm text-[var(--color-muted-foreground)]">
        {t("collab.presenceEmpty")}
      </p>
    );
  }
  const nowMs = Date.now();
  return (
    <ul className="space-y-2">
      {entries.map(([key, loc]) => {
        const traveler =
          trip.travelers.find((tr) => tr.email?.toLowerCase() === key.toLowerCase()) ??
          trip.viewers?.find((v) => v.email?.toLowerCase() === key.toLowerCase());
        const name = traveler?.name ?? key.split("@")[0];
        const updatedMs = loc.updatedAt ? Date.parse(loc.updatedAt) : nowMs;
        const minutes = Math.max(0, Math.round((nowMs - updatedMs) / 60000));
        return (
          <li
            key={key}
            className="flex items-center justify-between rounded-2xl bg-[var(--color-surface-muted)] px-2.5 py-2"
          >
            <span className="flex items-center gap-2 text-sm">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-[10px]">{avatarInitials(name)}</AvatarFallback>
              </Avatar>
              {name}
            </span>
            <Badge tone={minutes < 5 ? "success" : "neutral"}>
              {minutes === 0 ? t("collab.justNow") : t("collab.minutesAgo", { minutes })}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

function formatAgo(iso: string): string {
  const now = Date.now();
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
