"use client";

import { useMemo } from "react";
import { collectReferencesToDestinationId } from "@/lib/tripDestinationRegistry";
import { destinationHasMapCoordinates } from "@/lib/tripDestinationGeo";
import type { Destination, TripStep } from "@/lib/types/trip";

/**
 * Registry overview: every {@link Trip#destinations} row, where its id appears on steps, and map-pin status.
 * Editing stays on each step’s <strong>Edit</strong> in Manage (same fields as today).
 */
export function TripDestinationsRoster({
  destinations,
  steps,
  manageHint = true,
}: {
  destinations: Destination[];
  /** When set (usually chronological steps), each row lists which step fields reference that destination id. */
  steps?: TripStep[];
  manageHint?: boolean;
}) {
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

  if (rows.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/80 px-4 py-6 text-center dark:border-zinc-600 dark:bg-zinc-900/40">
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Places on this trip</h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          No destinations yet. Add a step in Manage to create places.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Places on this trip
      </h3>
      <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        {rows.length} destination{rows.length === 1 ? "" : "s"}
        {steps?.length
          ? " — each id lists where it is referenced on your itinerary (field names in parentheses)."
          : " — step references load with your itinerary."}
        {manageHint ? (
          <>
            {" "}
            To edit a place, open <strong className="text-zinc-600 dark:text-zinc-300">Manage</strong> →{" "}
            <strong className="text-zinc-600 dark:text-zinc-300">Edit</strong> on the step listed below.
          </>
        ) : null}
      </p>
      <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
        {rows.map((d) => {
          const refs = refsById.get(d.id) ?? [];
          return (
            <li key={d.id} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {(d.title || "Untitled").trim() || "Untitled"}
                </span>
                <span
                  className={
                    destinationHasMapCoordinates(d)
                      ? "shrink-0 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200"
                      : "shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-950 dark:bg-amber-950/50 dark:text-amber-100"
                  }
                >
                  {destinationHasMapCoordinates(d) ? "On map" : "No pin"}
                </span>
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
                      Referenced in
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
                  <p className="text-[11px] text-amber-800 dark:text-amber-200/90">
                    Not referenced by any current step (orphan). It will be removed on save if still unused, or
                    attach it via <strong>Edit</strong> on a step.
                  </p>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
      {manageHint ? (
        <p className="mt-3 border-t border-zinc-100 pt-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Missing coordinates? Use <strong>View</strong> alerts or <strong>Manage</strong> → <strong>Edit</strong>{" "}
          → address search / destination dialog.
        </p>
      ) : (
        <p className="mt-3 border-t border-zinc-100 pt-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Open <strong>Edit</strong> on the step named above to change which id is used or to edit the place fields.
        </p>
      )}
    </section>
  );
}
