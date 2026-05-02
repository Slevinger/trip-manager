"use client";

import { newId } from "@/lib/canonicalIds";
import { datetimeLocalValueToIso, isoToDatetimeLocalValue } from "@/lib/isoDatetimeLocal";
import type { CurrencyCode, TaskStatus, Trip, TripTask } from "@/lib/types/trip";

const CURRENCIES: CurrencyCode[] = ["ILS", "USD", "EUR", "THB"];
const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "done", "cancelled"];

export function ManageTripForm({
  trip,
  onChange,
}: {
  trip: Trip;
  onChange: (next: Trip) => void;
}) {
  const budgetAmount = trip.budget?.totalBudget?.amount ?? "";
  const tasks = trip.tasks ?? [];

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
        Trip title
        <input
          className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          value={trip.title}
          onChange={(e) => onChange({ ...trip, title: e.target.value })}
        />
      </label>

      <label className="mt-4 block text-xs font-medium text-zinc-700 dark:text-zinc-200">
        Description
        <textarea
          rows={3}
          className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          value={trip.description ?? ""}
          onChange={(e) => onChange({ ...trip, description: e.target.value || undefined })}
        />
      </label>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
          Trip start
          <input
            type="datetime-local"
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            value={isoToDatetimeLocalValue(trip.startDate)}
            onChange={(e) => onChange({ ...trip, startDate: datetimeLocalValueToIso(e.target.value) })}
          />
        </label>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
          Trip end
          <input
            type="datetime-local"
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            value={isoToDatetimeLocalValue(trip.endDate)}
            onChange={(e) => onChange({ ...trip, endDate: datetimeLocalValueToIso(e.target.value) })}
          />
        </label>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
          Currency
          <select
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            value={trip.currency}
            onChange={(e) => onChange({ ...trip, currency: e.target.value as CurrencyCode })}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {!CURRENCIES.includes(trip.currency as CurrencyCode) ? (
              <option value={trip.currency}>{trip.currency}</option>
            ) : null}
          </select>
        </label>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
          Total budget (optional)
          <input
            type="number"
            min={0}
            step="1"
            placeholder="Optional"
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            value={budgetAmount === "" ? "" : budgetAmount}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                onChange({ ...trip, budget: undefined });
                return;
              }
              const n = Number(raw);
              if (Number.isNaN(n)) return;
              onChange({
                ...trip,
                budget: {
                  ...trip.budget,
                  totalBudget: { amount: n, currency: trip.currency },
                },
              });
            }}
          />
        </label>
      </div>
      <p className="mt-1 text-xs text-zinc-500">Budget uses the trip currency above.</p>

      <p className="mt-4 rounded-lg border border-zinc-100 bg-zinc-50/80 px-2 py-1.5 text-[10px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
        <strong className="font-medium text-zinc-700 dark:text-zinc-300">Cloud access:</strong> add each
        person&apos;s <span className="whitespace-nowrap">Google account email</span> on travelers or viewers so
        they can open this trip after signing in with Google (viewers stay read-only).
      </p>

      <div className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">Travelers</h3>
            <p className="text-[10px] text-zinc-500">
              Party on the trip; optional Google email matches cloud access (View). Only the Firestore owner can use
              Manage.
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium dark:border-zinc-700 dark:bg-zinc-900"
            onClick={() =>
              onChange({
                ...trip,
                travelers: [...trip.travelers, { id: newId(), name: "" }],
              })
            }
          >
            Add traveler
          </button>
        </div>
        <ul className="mt-2 space-y-2">
          {trip.travelers.map((tr) => (
            <li key={tr.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                placeholder="Name"
                value={tr.name}
                onChange={(e) => {
                  const next = trip.travelers.map((x) =>
                    x.id === tr.id ? { ...x, name: e.target.value } : x
                  );
                  onChange({ ...trip, travelers: next });
                }}
              />
              <input
                className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                placeholder="Google email (optional, for cloud access)"
                value={tr.email ?? ""}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  const next = trip.travelers.map((x) => {
                    if (x.id !== tr.id) return x;
                    if (!v) {
                      const { email: _omit, ...rest } = x;
                      return rest;
                    }
                    return { ...x, email: v };
                  });
                  onChange({ ...trip, travelers: next });
                }}
              />
              <button
                type="button"
                className="shrink-0 self-start rounded-xl border border-red-200 px-2 py-1 text-xs text-red-800 disabled:opacity-40 dark:border-red-900/50 dark:text-red-200 sm:self-center"
                disabled={trip.travelers.length <= 1}
                onClick={() =>
                  onChange({
                    ...trip,
                    travelers: trip.travelers.filter((x) => x.id !== tr.id),
                  })
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">Viewers</h3>
            <p className="text-[10px] text-zinc-500">View-only (itinerary & summary); not travelers</p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium dark:border-zinc-700 dark:bg-zinc-900"
            onClick={() => {
              const list = trip.viewers ?? [];
              onChange({
                ...trip,
                viewers: [...list, { id: newId(), name: "" }],
              });
            }}
          >
            Add viewer
          </button>
        </div>
        <ul className="mt-2 space-y-2">
          {(trip.viewers ?? []).map((vw) => (
            <li key={vw.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                placeholder="Name"
                value={vw.name}
                onChange={(e) => {
                  const list = trip.viewers ?? [];
                  onChange({
                    ...trip,
                    viewers: list.map((x) =>
                      x.id === vw.id ? { ...x, name: e.target.value } : x
                    ),
                  });
                }}
              />
              <input
                className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                placeholder="Email (optional)"
                value={vw.email ?? ""}
                onChange={(e) => {
                  const list = trip.viewers ?? [];
                  const v = e.target.value.trim();
                  onChange({
                    ...trip,
                    viewers: list.map((x) => {
                      if (x.id !== vw.id) return x;
                      if (!v) {
                        const { email: _omit, ...rest } = x;
                        return rest;
                      }
                      return { ...x, email: v };
                    }),
                  });
                }}
              />
              <button
                type="button"
                className="shrink-0 self-start rounded-xl border border-red-200 px-2 py-1 text-xs text-red-800 dark:border-red-900/50 dark:text-red-200 sm:self-center"
                onClick={() => {
                  const list = trip.viewers ?? [];
                  const next = list.filter((x) => x.id !== vw.id);
                  onChange({
                    ...trip,
                    viewers: next.length ? next : [],
                  });
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        {(trip.viewers ?? []).length === 0 ? (
          <p className="mt-1 text-xs text-zinc-500">No viewers — add people who should follow the trip read-only.</p>
        ) : null}
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">Tasks</h3>
          <button
            type="button"
            className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium dark:border-zinc-700 dark:bg-zinc-900"
            onClick={() => {
              const task: TripTask = {
                id: newId(),
                title: "",
                status: "todo",
              };
              onChange({ ...trip, tasks: [...tasks, task] });
            }}
          >
            Add task
          </button>
        </div>
        <ul className="mt-2 space-y-2">
          {tasks.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center gap-2">
              <input
                className="min-w-[8rem] flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                placeholder="Task title"
                value={task.title}
                onChange={(e) => {
                  const next = tasks.map((x) =>
                    x.id === task.id ? { ...x, title: e.target.value } : x
                  );
                  onChange({ ...trip, tasks: next });
                }}
              />
              <select
                className="rounded-xl border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900"
                value={task.status}
                onChange={(e) => {
                  const next = tasks.map((x) =>
                    x.id === task.id ? { ...x, status: e.target.value as TaskStatus } : x
                  );
                  onChange({ ...trip, tasks: next });
                }}
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rounded-xl border border-red-200 px-2 py-1 text-xs text-red-800 dark:border-red-900/50 dark:text-red-200"
                onClick={() => onChange({ ...trip, tasks: tasks.filter((x) => x.id !== task.id) })}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        {tasks.length === 0 ? <p className="mt-1 text-xs text-zinc-500">No tasks yet.</p> : null}
      </div>
    </section>
  );
}
