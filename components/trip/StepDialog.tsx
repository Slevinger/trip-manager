"use client";

import { useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { ArrivalOption, TripStep } from "@/lib/types/trip";
import { HotelsEditor } from "@/components/trip/HotelsEditor";
import { AttachmentManager } from "@/components/trip/AttachmentManager";
import { useI18n } from "@/components/providers/I18nProvider";
import {
  applyOpenEndDateFromHotels,
  computeNightsForStep,
  syncStepWithHotels,
} from "@/lib/timeline/hotelsAndDates";

export function StepDialog({
  tripId,
  initial,
  onClose,
  onSave,
}: {
  tripId: string;
  initial: TripStep;
  onClose: () => void;
  onSave: (step: TripStep) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<TripStep>(() => ({ ...initial }));

  const previewNights = useMemo(() => computeNightsForStep(draft), [draft]);

  function setHotels(hotels: TripStep["hotels"]) {
    setDraft((d) => {
      let next: TripStep = { ...d, hotels };
      next = applyOpenEndDateFromHotels(next);
      next = { ...next, nights: computeNightsForStep(next) };
      return next;
    });
  }

  function addArrival() {
    setDraft((d) => {
      if (!d) return d;
      const nextOpt: ArrivalOption = {
        id: uuidv4(),
        title: "",
        details: "",
        duration: "",
        cost: "",
      };
      return { ...d, arrivalOptions: [...d.arrivalOptions, nextOpt] };
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white shadow-xl dark:bg-zinc-950 sm:max-h-[85vh] sm:rounded-3xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {t("common.edit")}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {t("common.close")}
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <label className="block text-xs text-zinc-600 dark:text-zinc-300">
            <span>{t("step.title")}</span>
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="block text-xs text-zinc-600 dark:text-zinc-300">
            <span>{t("step.location")}</span>
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              value={draft.location}
              onChange={(e) => setDraft({ ...draft, location: e.target.value })}
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs text-zinc-600 dark:text-zinc-300">
              <span>{t("step.startDate")}</span>
              <input
                type="date"
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                value={draft.startDate}
                onChange={(e) =>
                  setDraft({ ...draft, startDate: e.target.value })
                }
              />
            </label>
            <label className="block text-xs text-zinc-600 dark:text-zinc-300">
              <span>{t("step.endDate")}</span>
              <input
                type="date"
                disabled={draft.endDateOpen}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900"
                value={draft.endDate}
                onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-200">
            <input
              type="checkbox"
              checked={draft.endDateOpen}
              onChange={(e) => {
                const endDateOpen = e.target.checked;
                let next = { ...draft, endDateOpen };
                next = applyOpenEndDateFromHotels(next);
                next = { ...next, nights: computeNightsForStep(next) };
                setDraft(next);
              }}
            />
            <span>{t("manage.endDateOpen")}</span>
          </label>

          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200">
            {t("step.nights")}: {previewNights}
          </div>

          <label className="block text-xs text-zinc-600 dark:text-zinc-300">
            <span>{t("step.duration")}</span>
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              value={draft.duration}
              onChange={(e) => setDraft({ ...draft, duration: e.target.value })}
            />
          </label>
          <label className="block text-xs text-zinc-600 dark:text-zinc-300">
            <span>{t("step.transport")}</span>
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              value={draft.transport}
              onChange={(e) => setDraft({ ...draft, transport: e.target.value })}
            />
          </label>
          <label className="block text-xs text-zinc-600 dark:text-zinc-300">
            <span>{t("step.arrivalSummary")}</span>
            <textarea
              className="mt-1 min-h-[72px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              value={draft.arrivalSummary}
              onChange={(e) =>
                setDraft({ ...draft, arrivalSummary: e.target.value })
              }
            />
          </label>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                {t("step.arrivalOptions")}
              </div>
              <button
                type="button"
                onClick={addArrival}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium dark:border-zinc-800 dark:bg-zinc-900"
              >
                {t("step.addArrival")}
              </button>
            </div>
            {draft.arrivalOptions.map((opt, idx) => (
              <div
                key={opt.id}
                className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    className="rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    value={opt.title}
                    placeholder={t("step.title")}
                    onChange={(e) => {
                      const arrivalOptions = draft.arrivalOptions.map((o, i) =>
                        i === idx ? { ...o, title: e.target.value } : o
                      );
                      setDraft({ ...draft, arrivalOptions });
                    }}
                  />
                  <input
                    className="rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    value={opt.duration}
                    placeholder={t("step.duration")}
                    onChange={(e) => {
                      const arrivalOptions = draft.arrivalOptions.map((o, i) =>
                        i === idx ? { ...o, duration: e.target.value } : o
                      );
                      setDraft({ ...draft, arrivalOptions });
                    }}
                  />
                  <textarea
                    className="sm:col-span-2 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    value={opt.details}
                    placeholder={t("step.notes")}
                    onChange={(e) => {
                      const arrivalOptions = draft.arrivalOptions.map((o, i) =>
                        i === idx ? { ...o, details: e.target.value } : o
                      );
                      setDraft({ ...draft, arrivalOptions });
                    }}
                  />
                  <input
                    className="sm:col-span-2 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    value={opt.cost}
                    placeholder={t("hotels.cost")}
                    onChange={(e) => {
                      const arrivalOptions = draft.arrivalOptions.map((o, i) =>
                        i === idx ? { ...o, cost: e.target.value } : o
                      );
                      setDraft({ ...draft, arrivalOptions });
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <HotelsEditor hotels={draft.hotels} onChange={setHotels} />
          <AttachmentManager
            title="Step files (tickets, reservations, receipts, passports)"
            attachments={draft.attachments}
            uploadPathPrefix={`trips/${tripId}/steps/${draft.id}/attachments`}
            onChange={(attachments) => setDraft({ ...draft, attachments })}
          />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["transportCost", draft.transportCost],
                ["foodCost", draft.foodCost],
                ["activitiesCost", draft.activitiesCost],
                ["otherCost", draft.otherCost],
              ] as const
            ).map(([field, val]) => (
              <label key={field} className="block text-xs text-zinc-600 dark:text-zinc-300">
                <span>{t(`step.${field}`)}</span>
                <input
                  type="number"
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-2 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                  value={val}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [field]: Number(e.target.value || 0),
                    })
                  }
                />
              </label>
            ))}
          </div>

          <label className="block text-xs text-zinc-600 dark:text-zinc-300">
            <span>{t("step.notes")}</span>
            <textarea
              className="mt-1 min-h-[88px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </label>
        </div>

        <div className="sticky bottom-0 flex gap-2 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-zinc-200 py-2 text-sm font-medium dark:border-zinc-800"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(syncStepWithHotels(draft));
              onClose();
            }}
            className="flex-1 rounded-xl bg-zinc-900 py-2 text-sm font-semibold text-white dark:bg-white dark:text-zinc-900"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
