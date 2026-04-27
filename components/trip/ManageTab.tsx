"use client";

import { useEffect, useRef, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import type { Trip, TripStep } from "@/lib/types/trip";
import { StepList } from "@/components/trip/StepList";
import { StepDialog } from "@/components/trip/StepDialog";
import { AttachmentManager } from "@/components/trip/AttachmentManager";
import { useTripDocument } from "@/components/providers/TripDocumentProvider";
import { useI18n } from "@/components/providers/I18nProvider";
import {
  createTripInvite,
  getTripInvitesCollectionRef,
  getTripMembersCollectionRef,
  normalizeEmail,
  type TripInvite,
  type TripMember,
} from "@/lib/tripAccess";
import { createEmptyStep } from "@/lib/tripDefaults";
import { GroupedNumberInput } from "@/components/trip/GroupedNumberInput";
import { TripDateTimeInput } from "@/components/trip/TripDateTimeInput";

export function ManageTab() {
  const { trip, persist, user } = useTripDocument();
  const { t } = useI18n();
  const [editing, setEditing] = useState<TripStep | null>(null);
  const [members, setMembers] = useState<TripMember[]>([]);
  const [invites, setInvites] = useState<TripInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);
  const latestTrip = useRef<Trip | null>(null);

  useEffect(() => {
    latestTrip.current = trip;
  }, [trip]);

  useEffect(() => {
    if (!trip) return;
    const unsubMembers = onSnapshot(getTripMembersCollectionRef(trip.id), (snap) => {
      setMembers(
        snap.docs.map((d) => {
          const raw = d.data() as Record<string, unknown>;
          return {
            uid: d.id,
            email: String(raw.email ?? ""),
            emailLower: String(raw.emailLower ?? ""),
            role: "member",
            joinedAt: String(raw.joinedAt ?? ""),
          };
        })
      );
    });
    const unsubInvites = onSnapshot(getTripInvitesCollectionRef(trip.id), (snap) => {
      setInvites(
        snap.docs.map((d) => {
          const raw = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            invitedEmail: String(raw.invitedEmail ?? ""),
            invitedEmailLower: String(raw.invitedEmailLower ?? d.id),
            invitedByUid: String(raw.invitedByUid ?? ""),
            invitedByEmail: String(raw.invitedByEmail ?? ""),
            invitedByEmailLower: String(raw.invitedByEmailLower ?? ""),
            createdAt: String(raw.createdAt ?? ""),
            acceptedAt:
              typeof raw.acceptedAt === "string" && raw.acceptedAt.trim()
                ? raw.acceptedAt
                : undefined,
          };
        })
      );
    });
    return () => {
      unsubMembers();
      unsubInvites();
    };
  }, [trip]);

  if (!trip) return null;

  const doc = trip;

  function addStep() {
    const order = doc.steps.length
      ? Math.max(...doc.steps.map((s) => s.order)) + 1
      : 0;
    const step = { ...createEmptyStep(order), id: uuidv4() };
    persist({ ...doc, steps: [...doc.steps, step] });
    setEditing(step);
  }

  function deleteStep(stepId: string) {
    const steps = doc.steps
      .filter((s) => s.id !== stepId)
      .map((s, idx) => ({ ...s, order: idx }));
    persist({ ...doc, steps });
  }

  function setActive(stepId: string) {
    const steps = doc.steps.map((s) => {
      if (s.id === stepId) return { ...s, status: "active" as const };
      if (s.status === "active") return { ...s, status: "todo" as const };
      return s;
    });
    persist({ ...doc, autoCurrentByDate: false, steps });
  }

  async function inviteMember() {
    if (!user?.email) {
      setInviteFeedback(t("auth.emailRequired"));
      return;
    }
    const normalized = normalizeEmail(inviteEmail);
    if (!normalized || !normalized.includes("@")) {
      setInviteFeedback(t("invite.invalidEmail"));
      return;
    }
    const alreadyMember = members.some((m) => m.emailLower === normalized);
    if (alreadyMember) {
      setInviteFeedback(t("invite.alreadyMember"));
      return;
    }
    try {
      await createTripInvite(doc.id, inviteEmail, {
        uid: user.uid,
        email: user.email,
      });
      setInviteEmail("");
      setInviteFeedback(t("invite.sent"));
    } catch {
      setInviteFeedback(t("invite.failed"));
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
          {t("manage.tripTitle")}
          <input
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            value={doc.title}
            onChange={(e) => persist({ ...doc, title: e.target.value })}
          />
        </label>
        <label className="mt-4 block text-xs font-medium text-zinc-700 dark:text-zinc-200">
          {t("manage.tripStart")}
          <TripDateTimeInput
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            date={doc.tripStartDate}
            time={doc.tripStartTime}
            onDateChange={(tripStartDate) => persist({ ...doc, tripStartDate })}
            onTimeChange={(tripStartTime) => persist({ ...doc, tripStartTime })}
          />
        </label>
        <label className="mt-4 block text-xs font-medium text-zinc-700 dark:text-zinc-200">
          {t("manage.tripBudget")}
          <GroupedNumberInput
            allowEmptyZero
            min={0}
            placeholder={t("common.optional")}
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            value={doc.budget}
            onChange={(n) => persist({ ...doc, budget: n })}
          />
        </label>
        <p className="mt-1 text-xs text-zinc-500">{t("manage.tripBudgetHint")}</p>
        <label className="mt-4 block text-xs font-medium text-zinc-700 dark:text-zinc-200">
          Manage tab password
          <input
            type="password"
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            value={doc.managePassword}
            onChange={(e) => persist({ ...doc, managePassword: e.target.value })}
            placeholder="Leave empty to keep Manage open"
          />
        </label>
        <p className="mt-1 text-xs text-zinc-500">
          If set, users must enter this password before opening Manage.
        </p>
        <label className="mt-4 flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-100">
          <input
            type="checkbox"
            checked={doc.smartTimeline}
            onChange={(e) =>
              persist({ ...doc, smartTimeline: e.target.checked })
            }
          />
          <span>{t("manage.smartTimeline")}</span>
        </label>
        <p className="mt-1 text-xs text-zinc-500">{t("manage.smartTimelineHelp")}</p>
        <label className="mt-4 flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-100">
          <input
            type="checkbox"
            checked={doc.autoCurrentByDate}
            onChange={(e) =>
              persist({ ...doc, autoCurrentByDate: e.target.checked })
            }
          />
          <span>{t("manage.autoCurrent")}</span>
        </label>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {t("invite.title")}
        </h3>
        <p className="mt-1 text-xs text-zinc-500">{t("invite.hint")}</p>
        <div className="mt-3 flex gap-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => {
              setInviteEmail(e.target.value);
              if (inviteFeedback) setInviteFeedback(null);
            }}
            placeholder={t("invite.emailPlaceholder")}
            className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          />
          <button
            type="button"
            onClick={() => void inviteMember()}
            className="rounded-xl bg-zinc-900 px-3 py-2 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900"
          >
            {t("invite.send")}
          </button>
        </div>
        {inviteFeedback ? (
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">{inviteFeedback}</p>
        ) : null}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {t("invite.members")}
            </h4>
            <ul className="mt-2 space-y-1 text-sm text-zinc-700 dark:text-zinc-200">
              {members.map((m) => (
                <li key={m.uid}>{m.email}</li>
              ))}
              {members.length === 0 ? <li>{t("invite.noneMembers")}</li> : null}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {t("invite.pending")}
            </h4>
            <ul className="mt-2 space-y-1 text-sm text-zinc-700 dark:text-zinc-200">
              {invites
                .filter((inv) => !inv.acceptedAt)
                .map((inv) => (
                  <li key={inv.id}>{inv.invitedEmail}</li>
                ))}
              {invites.filter((inv) => !inv.acceptedAt).length === 0 ? (
                <li>{t("invite.nonePending")}</li>
              ) : null}
            </ul>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {t("manage.stepsTitle")}
          </h2>
          <button
            type="button"
            onClick={addStep}
            className="rounded-xl bg-zinc-900 px-3 py-2 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900"
          >
            {t("manage.addStep")}
          </button>
        </div>
        <StepList
          trip={doc}
          onEdit={(s) => setEditing(s)}
          onDelete={deleteStep}
          onSetActive={setActive}
        />
      </section>

      <AttachmentManager
        title="Trip files (passports, plane tickets, reservations, receipts)"
        attachments={doc.tripAttachments}
        uploadPathPrefix={`trips/${doc.id}/trip-attachments`}
        onChange={(tripAttachments) => persist({ ...doc, tripAttachments })}
      />

      {editing ? (
        <StepDialog
          tripId={doc.id}
          key={editing.id}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={(saved) => {
            const base = latestTrip.current;
            if (!base) return;
            const steps = base.steps.map((s) =>
              s.id === saved.id ? saved : s
            );
            persist({ ...base, steps });
          }}
        />
      ) : null}
    </div>
  );
}
