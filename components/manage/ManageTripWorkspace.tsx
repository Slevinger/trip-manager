"use client";

import type { User } from "firebase/auth";
import { useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { TripDocumentUploads } from "@/components/TripDocumentUploads";
import { TripDestinationsRoster } from "@/components/trip/TripDestinationsRoster";
import { createStayStep, normalizeStepOrders } from "@/lib/canonicalStepBuilders";
import {
  mergeDestinationLists,
  pruneUnreferencedDestinations,
} from "@/lib/tripDestinationRegistry";
import { sortTripStepsByStartTime } from "@/lib/tripStepSort";
import type { Destination, Trip, TripStep, UserPreferences } from "@/lib/types/trip";
import { CanonicalStepEditorDialog } from "./CanonicalStepEditorDialog";
import { CanonicalStepList } from "./CanonicalStepList";
import { ManageTripForm } from "./ManageTripForm";

export function ManageTripWorkspace({
  trip,
  onTripChange,
  persistTrip,
  canUploadTripFiles,
  uploadDisabledHint,
  saveTarget,
  saveDisabled,
  saveError,
  user,
  profilePreferences,
}: {
  trip: Trip;
  onTripChange: (next: Trip) => void;
  persistTrip: (next: Trip) => Promise<void>;
  canUploadTripFiles: boolean;
  uploadDisabledHint?: string;
  saveTarget: string;
  saveDisabled: boolean;
  saveError: string | null;
  user: User | null;
  profilePreferences?: UserPreferences | null;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const pendingInsertAfterId = useRef<string | null>(null);
  const [editor, setEditor] = useState<{
    step: TripStep;
    isNew: boolean;
    destinationSeeds?: Destination[];
  } | null>(null);

  const sortedSteps = useMemo(() => sortTripStepsByStartTime(trip.steps), [trip.steps]);

  function mergeSavedStep(saved: TripStep, destinationUpserts: Destination[]) {
    const mergedDest = mergeDestinationLists(trip.destinations, destinationUpserts);
    const insertAfter = pendingInsertAfterId.current;
    pendingInsertAfterId.current = null;
    const idx = trip.steps.findIndex((s) => s.id === saved.id);
    if (idx === -1) {
      const sorted = sortTripStepsByStartTime(trip.steps);
      if (insertAfter) {
        const j = sorted.findIndex((s) => s.id === insertAfter);
        if (j >= 0) {
          const withNew = [...sorted.slice(0, j + 1), saved, ...sorted.slice(j + 1)];
          onTripChange({
            ...trip,
            destinations: mergedDest,
            steps: normalizeStepOrders(withNew),
          });
          return;
        }
      }
      onTripChange({
        ...trip,
        destinations: mergedDest,
        steps: normalizeStepOrders([...trip.steps, saved]),
      });
      return;
    }
    onTripChange({
      ...trip,
      destinations: mergedDest,
      steps: normalizeStepOrders(trip.steps.map((s) => (s.id === saved.id ? saved : s))),
    });
  }

  function addStep() {
    pendingInsertAfterId.current = null;
    const order = sortedSteps.length;
    const { step, newDestinations } = createStayStep(order, trip.startDate);
    setEditor({ step, isNew: true, destinationSeeds: newDestinations });
  }

  function insertStepAfter(afterId: string) {
    const sorted = sortTripStepsByStartTime(trip.steps);
    const idx = sorted.findIndex((s) => s.id === afterId);
    if (idx < 0) return;
    pendingInsertAfterId.current = afterId;
    const { step, newDestinations } = createStayStep(sorted.length, trip.startDate);
    setEditor({ step, isNew: true, destinationSeeds: newDestinations });
  }

  function closeEditor() {
    pendingInsertAfterId.current = null;
    setEditor(null);
  }

  function deleteStep(stepId: string) {
    const filtered = trip.steps.filter((s) => s.id !== stepId);
    onTripChange(
      pruneUnreferencedDestinations({
        ...trip,
        steps: normalizeStepOrders(filtered),
      })
    );
  }

  function reorderSteps(orderedStepIds: string[]) {
    const byId = new Map(trip.steps.map((s) => [s.id, s] as const));
    const next = orderedStepIds
      .map((id) => byId.get(id))
      .filter((s): s is TripStep => Boolean(s));
    if (next.length !== trip.steps.length) return;
    onTripChange({ ...trip, steps: normalizeStepOrders(next) });
  }

  async function handleSaveTrip() {
    setSaving(true);
    try {
      const next = { ...trip, updatedAt: new Date().toISOString() };
      await persistTrip(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      <div className="space-y-6 pb-28">
        <ManageTripForm trip={trip} onChange={onTripChange} profilePreferences={profilePreferences} />

        <div className="mt-6">
          <TripDestinationsRoster
            destinations={trip.destinations}
            steps={sortedSteps}
            manageHint={false}
          />
        </div>

        <section className="space-y-3">
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{t("manage.workspaceDestHelp")}</p>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{t("manage.steps")}</h2>
            <button
              type="button"
              onClick={addStep}
              className="rounded-xl bg-zinc-900 px-3 py-2 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900"
            >
              {t("manage.addStep")}
            </button>
          </div>
          <CanonicalStepList
            trip={trip}
            onEdit={(s) => setEditor({ step: s, isNew: false })}
            onDelete={deleteStep}
            onReorder={reorderSteps}
            onInsertAfter={insertStepAfter}
          />
        </section>

        <TripDocumentUploads
          trip={trip}
          canUpload={canUploadTripFiles}
          disabledHint={uploadDisabledHint}
          onPersist={persistTrip}
        />
      </div>

      <div
        className="sticky bottom-0 z-30 -mx-4 mt-2 flex flex-col gap-2 border-t border-zinc-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-8px_rgba(0,0,0,0.08)] backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/95 dark:shadow-[0_-8px_24px_-8px_rgba(0,0,0,0.35)]"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {saveError ? (
          <p className="text-xs font-medium text-red-600 dark:text-red-400">{saveError}</p>
        ) : null}
        <p className="text-xs text-zinc-500">
          {t("manage.saveWritesTo", { target: saveTarget })}
          {!user ? ` ${t("manage.saveSignInCloud")}` : null}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={saveDisabled || saving}
            onClick={() => void handleSaveTrip()}
            className="rounded-xl bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-900"
          >
            {saving ? t("manage.saveSaving") : t("manage.saveTrip")}
          </button>
        </div>
      </div>

      {editor ? (
        <CanonicalStepEditorDialog
          key={editor.step.id}
          open
          trip={trip}
          tripStartIso={trip.startDate}
          tripCurrency={trip.currency}
          tripSteps={sortedSteps}
          stepOrder={editor.step.order}
          initial={editor.step}
          isNew={editor.isNew}
          initialDestinationSeeds={editor.destinationSeeds}
          startInWizard
          onClose={closeEditor}
          onSave={({ step: saved, destinationUpserts }) => {
            mergeSavedStep(saved, destinationUpserts);
            setEditor(null);
          }}
        />
      ) : null}
    </div>
  );
}
