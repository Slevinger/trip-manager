"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { intlLocaleForApp } from "@/lib/i18n/messages";
import { newId } from "@/lib/canonicalIds";
import type { CurrencyCode, TaskStatus, Trip, TripTask, UserPreferences } from "@/lib/types/trip";
import { MultiSelectDialog } from "@/components/manage/MultiSelectDialog";
import { DateTimeRangeCalendar } from "@/components/dateRange/DateRangeCalendar";
import {
  ACTIVITY_TYPES,
  HOBBY_OPTIONS,
  LIFESTYLE_OPTIONS,
} from "@/components/manage/stepEditorConstants";

const CURRENCIES: CurrencyCode[] = ["ILS", "USD", "EUR", "THB"];
const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "done", "cancelled"];

type PrefsKey = keyof UserPreferences;

/**
 * Slice of the management form to render. Omit (or pass `undefined`) to render
 * the whole form (legacy single-page layout). Used by ManageTripWorkspace to
 * partition the form across tabs without breaking the editor's state shape.
 */
export type ManageFormSection = "overview" | "people" | "tasks";

function prefsOptions(key: PrefsKey): readonly string[] {
  switch (key) {
    case "hobbies":
      return HOBBY_OPTIONS;
    case "activities":
      return ACTIVITY_TYPES;
    case "lifestyle":
      return LIFESTYLE_OPTIONS;
    default: {
      const _x: never = key;
      return _x;
    }
  }
}

export function ManageTripForm({
  trip,
  onChange,
  profilePreferences,
  section,
}: {
  trip: Trip;
  onChange: (next: Trip) => void;
  /** Signed-in user defaults from `users/{emailLower}`; optional when offline / unsigned. */
  profilePreferences?: UserPreferences | null;
  /** When set, render only the matching slice; omit to render the full form. */
  section?: ManageFormSection;
}) {
  const { t, locale } = useI18n();
  const intlLocale = intlLocaleForApp(locale);
  const budgetAmount = trip.budget?.totalBudget?.amount ?? "";
  const tasks = trip.tasks ?? [];
  const [prefsDlg, setPrefsDlg] = useState<{ travelerId: string; key: PrefsKey } | null>(null);

  const showOverview = !section || section === "overview";
  const showPeople = !section || section === "people";
  const showTasks = !section || section === "tasks";

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {showOverview ? (
      <>
      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
        {t("manage.tripTitle")}
        <input
          className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          value={trip.title}
          onChange={(e) => onChange({ ...trip, title: e.target.value })}
        />
      </label>

      <label className="mt-4 block text-xs font-medium text-zinc-700 dark:text-zinc-200">
        {t("manage.description")}
        <textarea
          rows={3}
          className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          value={trip.description ?? ""}
          onChange={(e) => onChange({ ...trip, description: e.target.value || undefined })}
        />
      </label>

      <div className="mt-4">
        <p className="mb-2 block text-xs font-medium text-zinc-700 dark:text-zinc-200">
          {t("manage.tripStart")} → {t("manage.tripEnd")}
        </p>
        <DateTimeRangeCalendar
          startIso={trip.startDate}
          endIso={trip.endDate}
          onChange={(startIso, endIso) =>
            onChange({ ...trip, startDate: startIso, endDate: endIso })
          }
          intlLocale={intlLocale}
          startLabel={t("manage.tripStart")}
          endLabel={t("manage.tripEnd")}
          collapsible
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
          {t("manage.currency")}
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
          {t("manage.totalBudgetOptional")}
          <input
            type="number"
            min={0}
            step="1"
            placeholder={t("manage.optional")}
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
      <p className="mt-1 text-xs text-zinc-500">{t("manage.budgetCurrencyHint")}</p>

      <p className="mt-4 rounded-lg border border-zinc-100 bg-zinc-50/80 px-2 py-1.5 text-[10px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
        {t("manage.cloudAccessBody")}
      </p>
      </>
      ) : null}

      {showPeople ? (
      <>
      <div className="mt-6 first:mt-0">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{t("manage.travelers")}</h3>
            <p className="text-[10px] text-zinc-500">{t("manage.travelersHint")}</p>
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
            {t("manage.addTraveler")}
          </button>
        </div>
        <ul className="mt-2 space-y-3">
          {trip.travelers.map((tr) => (
            <li key={tr.id} className="rounded-xl border border-zinc-100 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                  placeholder={t("manage.namePlaceholder")}
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
                  placeholder={t("manage.googleEmailPlaceholder")}
                  value={tr.email ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    const next = trip.travelers.map((x) => {
                      if (x.id !== tr.id) return x;
                      if (!v) {
                        const rest = { ...x };
                        delete rest.email;
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
                  {t("common.remove")}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["hobbies", "activities", "lifestyle"] as const).map((key) => {
                  const cat =
                    key === "hobbies"
                      ? t("profile.hobbies")
                      : key === "activities"
                        ? t("profile.activities")
                        : t("profile.lifestyle");
                  const hasOverride = Boolean(tr.preferences && key in tr.preferences);
                  const overrideLen = hasOverride ? (tr.preferences?.[key]?.length ?? 0) : 0;
                  const profileLen = profilePreferences?.[key]?.length ?? 0;
                  const label = hasOverride
                    ? `${cat} (${overrideLen})`
                    : `${cat} · ${t("manage.profileWord")} (${profileLen})`;
                  return (
                    <button
                      key={key}
                      type="button"
                      className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200"
                      onClick={() => setPrefsDlg({ travelerId: tr.id, key })}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{t("manage.viewers")}</h3>
            <p className="text-[10px] text-zinc-500">{t("manage.viewersHint")}</p>
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
            {t("manage.addViewer")}
          </button>
        </div>
        <ul className="mt-2 space-y-2">
          {(trip.viewers ?? []).map((vw) => (
            <li key={vw.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                placeholder={t("manage.namePlaceholder")}
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
                placeholder={t("manage.emailOptionalShort")}
                value={vw.email ?? ""}
                onChange={(e) => {
                  const list = trip.viewers ?? [];
                  const v = e.target.value.trim();
                  onChange({
                    ...trip,
                    viewers: list.map((x) => {
                      if (x.id !== vw.id) return x;
                      if (!v) {
                        const rest = { ...x };
                        delete rest.email;
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
                {t("common.remove")}
              </button>
            </li>
          ))}
        </ul>
        {(trip.viewers ?? []).length === 0 ? (
          <p className="mt-1 text-xs text-zinc-500">{t("manage.noViewers")}</p>
        ) : null}
      </div>
      </>
      ) : null}

      {showTasks ? (
      <div className="mt-6 first:mt-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{t("manage.tasks")}</h3>
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
            {t("manage.addTask")}
          </button>
        </div>
        <ul className="mt-2 space-y-2">
          {tasks.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center gap-2">
              <input
                className="min-w-[8rem] flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                placeholder={t("manage.taskTitlePlaceholder")}
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
                    {s === "todo"
                      ? t("manage.taskStatusTodo")
                      : s === "in_progress"
                        ? t("manage.taskStatusInProgress")
                        : s === "done"
                          ? t("manage.taskStatusDone")
                          : t("manage.taskStatusCancelled")}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rounded-xl border border-red-200 px-2 py-1 text-xs text-red-800 dark:border-red-900/50 dark:text-red-200"
                onClick={() => onChange({ ...trip, tasks: tasks.filter((x) => x.id !== task.id) })}
              >
                {t("common.remove")}
              </button>
            </li>
          ))}
        </ul>
        {tasks.length === 0 ? <p className="mt-1 text-xs text-zinc-500">{t("manage.noTasksYet")}</p> : null}
      </div>
      ) : null}

      {prefsDlg ? (
        (() => {
          const tr = trip.travelers.find((t) => t.id === prefsDlg.travelerId);
          if (!tr) return null;
          const key = prefsDlg.key;
          const cat =
            key === "hobbies"
              ? t("profile.hobbies")
              : key === "activities"
                ? t("profile.activities")
                : t("profile.lifestyle");
          const hasOverride = Boolean(tr.preferences && key in tr.preferences);
          const selected = hasOverride ? [...(tr.preferences?.[key] ?? [])] : [];
          const profileN = profilePreferences?.[key]?.length ?? 0;
          return (
            <MultiSelectDialog
              open
              title={t("manage.prefsDialogTitle", {
                category: cat,
                name: tr.name.trim() || t("manage.travelerDefaultName"),
              })}
              options={prefsOptions(key)}
              selected={selected}
              hint={hasOverride ? undefined : t("manage.prefsHintNoOverride", { count: profileN })}
              onOpenChange={(open) => {
                if (!open) setPrefsDlg(null);
              }}
              onSave={(next) => {
                const nextTravelers = trip.travelers.map((x) => {
                  if (x.id !== tr.id) return x;
                  return { ...x, preferences: { ...(x.preferences ?? {}), [key]: next } };
                });
                onChange({ ...trip, travelers: nextTravelers });
              }}
              onClearOverride={
                hasOverride
                  ? () => {
                      const nextTravelers = trip.travelers.map((x) => {
                        if (x.id !== tr.id) return x;
                        const p = x.preferences;
                        if (!p || !(key in p)) return x;
                        const { [key]: _removed, ...rest } = p;
                        return {
                          ...x,
                          preferences: Object.keys(rest).length ? rest : undefined,
                        };
                      });
                      onChange({ ...trip, travelers: nextTravelers });
                    }
                  : undefined
              }
            />
          );
        })()
      ) : null}
    </section>
  );
}
