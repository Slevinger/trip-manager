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
  upsertDestinationRow,
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
  dirty,
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
  /** True when the draft diverges from the persisted trip; gates the Save button. */
  dirty: boolean;
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
  const [manageTab, setManageTab] = useState<
    "overview" | "itinerary" | "people" | "logistics"
  >("overview");

  const stepCount = trip.steps.length;
  const placeCount = trip.destinations.length;
  const peopleCount = trip.travelers.length + (trip.viewers?.length ?? 0);
  const taskCount = trip.tasks?.length ?? 0;
  const docCount = trip.documents?.length ?? 0;
  const logisticsCount = taskCount + docCount;

  const tabs = [
    {
      id: "overview" as const,
      label: t("manage.tabOverview"),
      count: undefined as number | undefined,
    },
    {
      id: "itinerary" as const,
      label: t("manage.tabItinerary"),
      count: stepCount + placeCount,
    },
    {
      id: "people" as const,
      label: t("manage.tabPeople"),
      count: peopleCount,
    },
    {
      id: "logistics" as const,
      label: t("manage.tabLogistics"),
      count: logisticsCount,
    },
  ];

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
        <div className="sticky top-0 z-10 -mx-4 flex justify-center border-b border-zinc-200/70 bg-white/85 px-4 py-2 backdrop-blur-md dark:border-zinc-800/70 dark:bg-zinc-950/85">
          <div
            role="tablist"
            aria-label={t("manage.tabsLabel")}
            className="inline-flex max-w-full overflow-x-auto rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700"
          >
            {tabs.map((tab) => {
              const active = manageTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setManageTab(tab.id)}
                  className={
                    active
                      ? "flex shrink-0 items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 shadow dark:bg-zinc-800 dark:text-zinc-50"
                      : "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  }
                >
                  <span>{tab.label}</span>
                  {typeof tab.count === "number" && tab.count > 0 ? (
                    <span
                      className={
                        active
                          ? "rounded-full bg-zinc-900/10 px-1.5 py-px text-[10px] font-semibold text-zinc-900 dark:bg-white/15 dark:text-zinc-50"
                          : "rounded-full bg-zinc-200/70 px-1.5 py-px text-[10px] font-semibold text-zinc-600 dark:bg-zinc-700/60 dark:text-zinc-300"
                      }
                    >
                      {tab.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {manageTab === "overview" ? (
          <ManageTripForm
            trip={trip}
            onChange={onTripChange}
            profilePreferences={profilePreferences}
            section="overview"
          />
        ) : null}

        {manageTab === "itinerary" ? (
          <div className="space-y-6">
            <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                    {t("manage.steps")}
                    {stepCount > 0 ? (
                      <span className="ml-2 align-middle text-xs font-normal text-zinc-500">
                        ({stepCount})
                      </span>
                    ) : null}
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {t("manage.workspaceDestHelp")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addStep}
                  className="shrink-0 rounded-xl bg-zinc-900 px-3 py-2 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900"
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

            {!saveDisabled ? (
              <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {t("manage.placesHeading")}
                  {placeCount > 0 ? (
                    <span className="ml-2 align-middle text-xs font-normal text-zinc-500">
                      ({placeCount})
                    </span>
                  ) : null}
                </h3>
                <TripDestinationsRoster
                  destinations={trip.destinations}
                  steps={sortedSteps}
                  editable
                  manageHint={false}
                  onSaveDestination={(d) =>
                    onTripChange({
                      ...trip,
                      destinations: upsertDestinationRow(trip.destinations, d),
                      updatedAt: new Date().toISOString(),
                    })
                  }
                  onDeleteDestination={(id) =>
                    onTripChange({
                      ...trip,
                      destinations: trip.destinations.filter((row) => row.id !== id),
                      updatedAt: new Date().toISOString(),
                    })
                  }
                />
              </section>
            ) : null}
          </div>
        ) : null}

        {manageTab === "people" ? (
          <ManageTripForm
            trip={trip}
            onChange={onTripChange}
            profilePreferences={profilePreferences}
            section="people"
          />
        ) : null}

        {manageTab === "logistics" ? (
          <div className="space-y-6">
            <ManageTripForm
              trip={trip}
              onChange={onTripChange}
              profilePreferences={profilePreferences}
              section="tasks"
            />
            <TripDocumentUploads
              trip={trip}
              canUpload={canUploadTripFiles}
              disabledHint={uploadDisabledHint}
              onPersist={persistTrip}
            />
          </div>
        ) : null}
      </div>

      <div
        className={
          (dirty && !saveDisabled
            ? "border-amber-300/70 bg-amber-50/95 dark:border-amber-500/30 dark:bg-amber-500/10 "
            : "border-zinc-200 bg-white/95 dark:border-zinc-800 dark:bg-zinc-950/95 ") +
          "sticky bottom-0 z-30 -mx-4 mt-2 flex flex-col gap-2 border-t px-4 py-3 shadow-[0_-8px_24px_-8px_rgba(0,0,0,0.08)] backdrop-blur-md dark:shadow-[0_-8px_24px_-8px_rgba(0,0,0,0.35)]"
        }
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {saveError ? (
          <p className="text-xs font-medium text-red-600 dark:text-red-400">{saveError}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            {!saveDisabled ? (
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                {dirty ? (
                  <>
                    <span
                      className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500"
                      aria-hidden
                    />
                    <span className="text-amber-700 dark:text-amber-300">
                      {t("manage.statusUnsaved")}
                    </span>
                  </>
                ) : (
                  <>
                    <span
                      className="inline-block h-2 w-2 rounded-full bg-emerald-500"
                      aria-hidden
                    />
                    <span className="text-emerald-700 dark:text-emerald-300">
                      {t("manage.statusSaved")}
                    </span>
                  </>
                )}
              </p>
            ) : null}
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
              {t("manage.saveWritesTo", { target: saveTarget })}
              {!user ? ` ${t("manage.saveSignInCloud")}` : null}
            </p>
          </div>
          <button
            type="button"
            disabled={saveDisabled || saving || !dirty}
            onClick={() => void handleSaveTrip()}
            className={
              dirty && !saveDisabled
                ? "inline-flex shrink-0 items-center gap-2 rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white shadow-md ring-2 ring-zinc-900/15 transition hover:bg-zinc-800 active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 dark:bg-white dark:text-zinc-900 dark:ring-white/20 dark:hover:bg-zinc-100"
                : "inline-flex shrink-0 cursor-not-allowed items-center gap-2 rounded-xl bg-zinc-200 px-5 py-2.5 text-sm font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
            }
            aria-label={t("manage.saveTrip")}
          >
            {saving ? (
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeOpacity="0.25"
                  strokeWidth="3"
                />
                <path
                  d="M22 12a10 10 0 0 1-10 10"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            <span>{saving ? t("manage.saveSaving") : t("manage.saveTrip")}</span>
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
