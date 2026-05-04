"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { collectReferencesToDestinationId } from "@/lib/tripDestinationRegistry";
import { destinationHasMapCoordinates } from "@/lib/tripDestinationGeo";
import type { Destination, TripStep } from "@/lib/types/trip";

const CreateDestinationDialog = dynamic(
  () =>
    import("@/components/manage/CreateDestinationDialog").then((m) => ({
      default: m.CreateDestinationDialog,
    })),
  { ssr: false }
);

/**
 * Registry overview: every {@link Trip#destinations} row, where its id appears on steps, and map-pin status.
 * With `editable` + callbacks, rows can be edited (map dialog) or deleted when unused.
 */
export function TripDestinationsRoster({
  destinations,
  steps,
  manageHint = true,
  editable = false,
  onSaveDestination,
  onDeleteDestination,
}: {
  destinations: Destination[];
  /** When set (usually chronological steps), each row lists which step fields reference that destination id. */
  steps?: TripStep[];
  manageHint?: boolean;
  editable?: boolean;
  onSaveDestination?: (destination: Destination) => void | Promise<void>;
  onDeleteDestination?: (destinationId: string) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Destination | null>(null);

  const refsById = useMemo(() => {
    const m = new Map<string, ReturnType<typeof collectReferencesToDestinationId>>();
    if (!steps?.length) return m;
    for (const d of destinations) {
      m.set(d.id, collectReferencesToDestinationId(d.id, steps));
    }
    return m;
  }, [destinations, steps]);

  const rows = useMemo(
    () =>
      [...destinations].sort((a, b) =>
        (a.title || a.location || "").localeCompare(b.title || b.location || "", undefined, {
          sensitivity: "base",
        })
      ),
    [destinations]
  );

  function openEdit(d: Destination) {
    setEditing({ ...d });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditing(null);
  }

  if (rows.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/80 px-4 py-6 text-center dark:border-zinc-600 dark:bg-zinc-900/40">
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{t("view.placesTitle")}</h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("view.placesEmpty")}</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {t("view.placesTitle")}
      </h3>
      <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        {t("view.destinationsCount", { count: rows.length })}
        {steps?.length ? t("view.destinationsWithSteps") : t("view.destinationsNoSteps")}
        {manageHint && !editable ? t("view.editPlaceHint") : null}
      </p>
      <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
        {rows.map((d) => {
          const refs = refsById.get(d.id) ?? [];
          const canDelete = refs.length === 0;
          return (
            <li key={d.id} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {(d.title || t("common.untitled")).trim() || t("common.untitled")}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {editable && onSaveDestination ? (
                    <button
                      type="button"
                      onClick={() => openEdit(d)}
                      className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                    >
                      {t("manage.editDestination")}
                    </button>
                  ) : null}
                  {editable && onDeleteDestination ? (
                    <button
                      type="button"
                      disabled={!canDelete}
                      title={
                        canDelete ? undefined : t("manage.deleteDestinationDisabledHint")
                      }
                      onClick={() => {
                        if (!canDelete) return;
                        if (!window.confirm(t("manage.deleteDestinationConfirm"))) return;
                        void Promise.resolve(onDeleteDestination(d.id));
                      }}
                      className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-950 dark:text-red-400 dark:hover:bg-red-950/40"
                    >
                      {t("manage.deleteDestination")}
                    </button>
                  ) : null}
                  <span
                    className={
                      destinationHasMapCoordinates(d)
                        ? "shrink-0 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200"
                        : "shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-950 dark:bg-amber-950/50 dark:text-amber-100"
                    }
                  >
                    {destinationHasMapCoordinates(d) ? t("view.onMap") : t("view.noPin")}
                  </span>
                </div>
              </div>
              {(d.location || "").trim() ? (
                <p className="text-xs text-zinc-600 dark:text-zinc-300">{(d.location || "").trim()}</p>
              ) : null}
              {(d.description || "").trim() &&
              (d.description || "").trim() !== (d.location || "").trim() ? (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{(d.description || "").trim()}</p>
              ) : null}
              <p className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">{d.id}</p>
              {steps?.length ? (
                refs.length > 0 ? (
                  <div className="mt-1 rounded-lg bg-zinc-50 px-2 py-1.5 dark:bg-zinc-900/80">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      {t("view.referencedIn")}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {refs.map((r, i) => (
                        <li key={`${r.stepId}-${i}`} className="text-[11px] leading-snug text-zinc-700 dark:text-zinc-200">
                          <span className="rounded bg-violet-100 px-1 py-0.5 font-medium text-violet-900 dark:bg-violet-950/70 dark:text-violet-100">
                            {r.stepType}
                          </span>{" "}
                          <span className="font-medium">{r.stepTitle}</span>
                          <span className="text-zinc-600 dark:text-zinc-300"> — {r.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-[11px] text-amber-800 dark:text-amber-200/90">{t("view.orphanDestination")}</p>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
      {editable ? (
        <p className="mt-3 border-t border-zinc-100 pt-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          {t("view.destinationsEditableHint")}
        </p>
      ) : manageHint ? (
        <p className="mt-3 border-t border-zinc-100 pt-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          {t("view.missingCoordsHint")}
        </p>
      ) : (
        <p className="mt-3 border-t border-zinc-100 pt-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          {t("view.editStepHintReadonly")}
        </p>
      )}

      {editable && onSaveDestination ? (
        <CreateDestinationDialog
          open={dialogOpen}
          onOpenChange={(open) => {
            if (!open) closeDialog();
            else setDialogOpen(true);
          }}
          existingDestination={editing}
          onSave={(dest) => Promise.resolve(onSaveDestination(dest))}
        />
      ) : null}
    </section>
  );
}
