"use client";

import { useId, useMemo, useState } from "react";
import type { StayStep, TransitStep, TripStep } from "@/lib/types/trip";
import { stayStepsSorted } from "@/lib/tripStayEndpoints";
import { TransitStaySelects } from "@/components/trip/TransitStaySelects";
import { GroupedNumberInput } from "@/components/trip/GroupedNumberInput";
import { HotelsEditor } from "@/components/trip/HotelsEditor";
import { AttachmentManager } from "@/components/trip/AttachmentManager";
import { useI18n } from "@/components/providers/I18nProvider";
import { TripDateTimeInput } from "@/components/trip/TripDateTimeInput";
import {
  formatSpanBetweenStoredParts,
  isValidDdMmYyyy,
  parseDdMmYyyyCalendarDate,
} from "@/lib/timeline/dates";
import {
  applyOpenEndDateFromHotels,
  applyTransitEndFromArrivals,
  computeNightsForStep,
  syncStepWithHotels,
  transitStepDurationFromArrivals,
} from "@/lib/timeline/hotelsAndDates";
import {
  applyTransitDurationToEnd,
  clampTransitDurationParts,
  totalMinutesFromTransitDuration,
} from "@/lib/timeline/transitDuration";
import { MainStepWizard } from "@/components/trip/wizard/MainStepWizard";
import { PlaceSearchInput } from "@/components/trip/PlaceSearchInput";

export function StepDialog({
  tripId,
  tripSteps,
  initial,
  isNewStep = false,
  onClose,
  onSave,
}: {
  tripId: string;
  /** All trip steps (used to pick transit from/to stays). */
  tripSteps: TripStep[];
  initial: TripStep;
  /** When true, offer guided setup before the full step editor. */
  isNewStep?: boolean;
  onClose: () => void;
  onSave: (step: TripStep) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const stepTypeLegendId = useId();
  const [draft, setDraft] = useState<TripStep>(() => {
    let s = { ...initial };
    if (s.type === "transit") {
      s.endDateOpen = false;
      s = applyTransitEndFromArrivals(s);
    }
    return s;
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [surface, setSurface] = useState<"choose" | "wizard" | "edit">(() =>
    isNewStep ? "choose" : "edit"
  );
  const [wizardMode, setWizardMode] = useState<"pick" | "stay_item" | "transit_item">(
    "pick"
  );
  const startDateFloor = useMemo(
    () => (isNewStep ? initial.startDate.trim() : ""),
    [initial.startDate, isNewStep]
  );

  const previewNights = useMemo(() => computeNightsForStep(draft), [draft]);

  const stayOptions = useMemo(() => stayStepsSorted(tripSteps), [tripSteps]);

  const transitDurationPreview = useMemo(() => {
    if (draft.type !== "transit") return "";
    return transitStepDurationFromArrivals(draft);
  }, [draft]);

  const endDateMin = useMemo(() => {
    const start = (draft.startDate || startDateFloor).trim();
    const parsed = parseDdMmYyyyCalendarDate(start);
    if (!parsed) return start || undefined;
    const next = new Date(parsed);
    next.setDate(next.getDate() + 1);
    const dd = String(next.getDate()).padStart(2, "0");
    const mm = String(next.getMonth() + 1).padStart(2, "0");
    const yyyy = String(next.getFullYear());
    return `${dd}-${mm}-${yyyy}`;
  }, [draft.startDate, startDateFloor]);

  function setHotels(hotels: StayStep["hotels"]) {
    setDraft((d) => {
      if (d.type !== "stay") return d;
      let next: TripStep = { ...d, hotels };
      next = applyOpenEndDateFromHotels(next);
      next = { ...next, nights: computeNightsForStep(next) };
      return next;
    });
  }

  function switchType(type: "stay" | "transit") {
    setDraft((d) => {
      if (d.type === type) return d;
      if (type === "stay") {
        if (d.type !== "transit") return d;
        const {
          transitEndManual: _tm,
          transitDurationDays: _tdd,
          transitDurationHours: _tdh,
          transitDurationMinutes: _tdm,
          transports: _tr,
          transitType: _tt,
          fromStayStepId: _fs,
          toStayStepId: _ts,
          ...base
        } = d;
        return { ...base, type: "stay", hotels: [] };
      }
      const next: TransitStep = {
        ...d,
        type,
        transitType: "airplane",
        transports: [],
        endDateOpen: false,
        transitDurationDays: 0,
        transitDurationHours: 1,
        transitDurationMinutes: 0,
        fromStayStepId: d.type === "transit" ? d.fromStayStepId : undefined,
        toStayStepId: d.type === "transit" ? d.toStayStepId : undefined,
      };
      return applyTransitDurationToEnd(next);
    });
  }

  function isInvalidRange(
    startDate: string,
    startTime: string,
    endDate: string,
    endTime: string
  ): boolean {
    const sd = startDate.trim();
    const ed = endDate.trim();
    const st = startTime.trim();
    const et = endTime.trim();
    if (!sd || !ed || !st || !et) return false;
    if (sd !== ed) return false;
    return et <= st;
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
            {surface === "edit" && !isNewStep
              ? t("common.edit")
              : t("stepWizard.dialogHeaderNew")}
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
          {surface === "choose" ? (
            <div className="space-y-5 pb-2">
              <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {t("stepWizard.pathSubtitle")}
              </p>
            <button
              type="button"
              onClick={async () => {
                  setWizardMode("pick");
                  setSurface("wizard");
                }}
                className="group flex w-full flex-col items-start gap-2 rounded-2xl border-2 border-zinc-200 bg-white p-5 text-start shadow-sm transition hover:border-violet-400 hover:shadow-md active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-violet-500"
              >
                <span className="text-2xl" aria-hidden>
                  ✨
                </span>
                <span className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  {t("stepWizard.pathGuidedTitle")}
                </span>
                <span className="text-sm leading-snug text-zinc-600 dark:text-zinc-400">
                  {t("stepWizard.pathGuidedBody")}
                </span>
                <span className="mt-1 text-xs font-medium text-violet-600 group-hover:underline dark:text-violet-400">
                  {t("common.continue")}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSurface("edit")}
                className="group flex w-full flex-col items-start gap-2 rounded-2xl border-2 border-zinc-200 bg-zinc-50/80 p-5 text-start shadow-sm transition hover:border-zinc-400 hover:bg-white hover:shadow-md active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/60 dark:hover:border-zinc-500 dark:hover:bg-zinc-950"
              >
                <span className="text-2xl" aria-hidden>
                  ⚙️
                </span>
                <span className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  {t("stepWizard.pathFullTitle")}
                </span>
                <span className="text-sm leading-snug text-zinc-600 dark:text-zinc-400">
                  {t("stepWizard.pathFullBody")}
                </span>
                <span className="mt-1 text-xs font-medium text-zinc-600 group-hover:underline dark:text-zinc-400">
                  {t("stepWizard.pathFullCta")}
                </span>
              </button>
            </div>
          ) : null}
          {surface === "wizard" ? (
            <MainStepWizard
              tripSteps={tripSteps}
              initial={draft}
              startMode={wizardMode}
              onBackToPathChoice={() => {
                if (wizardMode === "pick") {
                  setSurface("choose");
                  return;
                }
                setWizardMode("pick");
                setSurface("edit");
              }}
              onComplete={(step) => {
                let s: TripStep = { ...step };
                if (s.type === "transit") {
                  s = applyTransitEndFromArrivals({
                    ...s,
                    endDateOpen: false,
                  });
                }
                setDraft(s);
                setSaveError(null);
                setWizardMode("pick");
                setSurface("edit");
              }}
            />
          ) : null}
          {surface === "edit" ? (
            <>
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
            <PlaceSearchInput
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              value={draft.location}
              placeholder={t("placeSearch.placeholder")}
              onChange={(location) =>
                setDraft({ ...draft, location, coordinates: undefined })
              }
              onPick={(p) =>
                setDraft({
                  ...draft,
                  location: p.label,
                  coordinates: { lat: p.lat, lng: p.lng },
                })
              }
            />
          </label>
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend id={stepTypeLegendId} className="text-xs text-zinc-600 dark:text-zinc-300">
              {t("step.type")}
            </legend>
            <div
              role="radiogroup"
              aria-labelledby={stepTypeLegendId}
              className="mt-1 grid grid-cols-2 gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900/80"
            >
              {(
                [
                  { type: "stay" as const, label: t("step.typeStay"), icon: "🏨" },
                  { type: "transit" as const, label: t("step.typeTransit"), icon: "✈️" },
                ] as const
              ).map(({ type, label, icon }) => {
                const selected = draft.type === type;
                return (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setSaveError(null);
                      switchType(type);
                    }}
                    className={
                      selected
                        ? "rounded-lg bg-white px-3 py-2 text-sm font-medium text-zinc-900 shadow-sm ring-1 ring-zinc-200/80 dark:bg-zinc-800 dark:text-zinc-50 dark:ring-zinc-700/80"
                        : "rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                    }
                  >
                    <span className="mr-1">{icon}</span>
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          {draft.type === "transit" ? (
            <label className="block text-xs text-zinc-600 dark:text-zinc-300">
              <span>{t("step.transitType")}</span>
              <select
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                value={draft.transitType ?? "airplane"}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    transitType: e.target.value as
                      | "airplane"
                      | "minivan"
                      | "taxi"
                      | "ferry"
                      | "speedboat",
                  })
                }
              >
                <option value="airplane">✈️ {t("step.transitTypeAirplane")}</option>
                <option value="minivan">🚐 {t("step.transitTypeMinivan")}</option>
                <option value="taxi">🚕 {t("step.transitTypeTaxi")}</option>
                <option value="ferry">⛴️ {t("step.transitTypeFerry")}</option>
                <option value="speedboat">🚤 {t("step.transitTypeSpeedboat")}</option>
              </select>
            </label>
          ) : null}
          {draft.type === "transit" ? (
            stayOptions.length === 0 ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                {t("step.noStaysForTransit")}
              </p>
            ) : (
              <TransitStaySelects
                stays={stayOptions}
                fromStayStepId={
                  draft.type === "transit" ? draft.fromStayStepId : undefined
                }
                toStayStepId={draft.type === "transit" ? draft.toStayStepId : undefined}
                onChange={(patch) => {
                  setSaveError(null);
                  setDraft((d) =>
                    d.type === "transit"
                      ? { ...d, ...patch }
                      : d
                  );
                }}
              />
            )
          ) : null}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <label className="block text-xs text-zinc-600 dark:text-zinc-300">
              <span>{t("step.startDate")}</span>
              <TripDateTimeInput
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                date={draft.startDate}
                time={draft.startTime}
                minDate={startDateFloor || undefined}
                onDateChange={(startDate) => {
                  setSaveError(null);
                  setDraft((d) =>
                    d.type === "transit"
                      ? applyTransitDurationToEnd({ ...d, startDate })
                      : { ...d, startDate }
                  );
                }}
                onTimeChange={(startTime) => {
                  setSaveError(null);
                  setDraft((d) =>
                    d.type === "transit"
                      ? applyTransitDurationToEnd({ ...d, startTime })
                      : { ...d, startTime }
                  );
                }}
              />
            </label>
            {draft.type === "stay" ? (
              <label className="block text-xs text-zinc-600 dark:text-zinc-300">
                <span>{t("step.endDate")}</span>
                <TripDateTimeInput
                  disabled={draft.endDateOpen}
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900"
                  date={draft.endDate}
                  time={draft.endTime}
                  minDate={endDateMin}
                  onDateChange={(endDate) => {
                    setSaveError(null);
                    setDraft({ ...draft, endDate });
                  }}
                  onTimeChange={(endTime) => {
                    setSaveError(null);
                    setDraft({ ...draft, endTime });
                  }}
                />
              </label>
            ) : (
              <div className="block text-xs text-zinc-600 dark:text-zinc-300">
                <span>{t("step.transitDurationInputs")}</span>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  <label className="block min-w-0">
                    <span className="text-[10px] text-zinc-500">{t("step.transitDurationDays")}</span>
                    <GroupedNumberInput
                      min={0}
                      className="mt-0.5 w-full rounded-xl border border-zinc-200 bg-white px-2 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                      value={draft.transitDurationDays ?? 0}
                      onChange={(n) => {
                        setSaveError(null);
                        setDraft((d) => {
                          if (d.type !== "transit") return d;
                          const c = clampTransitDurationParts(
                            n,
                            d.transitDurationHours ?? 0,
                            d.transitDurationMinutes ?? 0
                          );
                          return applyTransitDurationToEnd({ ...d, ...c });
                        });
                      }}
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className="text-[10px] text-zinc-500">{t("step.transitDurationHours")}</span>
                    <GroupedNumberInput
                      min={0}
                      className="mt-0.5 w-full rounded-xl border border-zinc-200 bg-white px-2 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                      value={draft.transitDurationHours ?? 0}
                      onChange={(n) => {
                        setSaveError(null);
                        setDraft((d) => {
                          if (d.type !== "transit") return d;
                          const c = clampTransitDurationParts(
                            d.transitDurationDays ?? 0,
                            n,
                            d.transitDurationMinutes ?? 0
                          );
                          return applyTransitDurationToEnd({ ...d, ...c });
                        });
                      }}
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className="text-[10px] text-zinc-500">{t("step.transitDurationMinutes")}</span>
                    <GroupedNumberInput
                      min={0}
                      className="mt-0.5 w-full rounded-xl border border-zinc-200 bg-white px-2 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                      value={draft.transitDurationMinutes ?? 0}
                      onChange={(n) => {
                        setSaveError(null);
                        setDraft((d) => {
                          if (d.type !== "transit") return d;
                          const c = clampTransitDurationParts(
                            d.transitDurationDays ?? 0,
                            d.transitDurationHours ?? 0,
                            n
                          );
                          return applyTransitDurationToEnd({ ...d, ...c });
                        });
                      }}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
          {draft.type === "stay" ? (
            <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-200">
              <input
                type="checkbox"
                checked={draft.endDateOpen}
                onChange={(e) => {
                  const endDateOpen = e.target.checked;
                  setSaveError(null);
                  setDraft((d) => {
                    if (d.type !== "stay") return d;
                    const patched = { ...d, endDateOpen };
                    const afterHotels = applyOpenEndDateFromHotels(patched);
                    if (afterHotels.type !== "stay") return d;
                    return {
                      ...afterHotels,
                      nights: computeNightsForStep(afterHotels),
                    };
                  });
                }}
              />
              <span>{t("manage.endDateOpen")}</span>
            </label>
          ) : (
            <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
              {t("step.transitDurationHint")}
            </p>
          )}

          {draft.type !== "transit" ? (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200">
              {t("step.nights")}: {previewNights}
            </div>
          ) : null}

          {draft.type === "transit" ? (
            <div className="text-xs text-zinc-600 dark:text-zinc-300">
              <div className="font-normal">{t("step.durationTransit")}</div>
              <div className="mt-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-100">
                {transitDurationPreview || "—"}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                {t("step.durationTransitHint")}
              </p>
            </div>
          ) : (
            <label className="block text-xs text-zinc-600 dark:text-zinc-300">
              <span>{t("step.duration")}</span>
              <input
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                value={draft.duration}
                onChange={(e) => setDraft({ ...draft, duration: e.target.value })}
              />
            </label>
          )}
          {draft.type === "stay" ? (
            <HotelsEditor
              hotels={draft.hotels}
              onChange={setHotels}
              minDate={draft.startDate.trim() || startDateFloor || undefined}
              onAddRequested={() => {
                setSaveError(null);
                setWizardMode("stay_item");
                setSurface("wizard");
              }}
            />
          ) : null}
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
                <GroupedNumberInput
                  min={0}
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-2 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                  value={val}
                  onChange={(n) =>
                    setDraft({
                      ...draft,
                      [field]: n,
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
            </>
          ) : null}
        </div>

        {surface === "edit" ? (
        <div className="sticky bottom-0 space-y-2 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
          {saveError ? (
            <p className="text-center text-xs font-medium text-red-600 dark:text-red-400">
              {saveError}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => {
                setSaveError(null);
                onClose();
              }}
              className="flex-1 rounded-xl border border-zinc-200 py-2 text-sm font-medium dark:border-zinc-800"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={async () => {
                if (draft.type === "stay") {
                  if (
                    isInvalidRange(
                      draft.startDate,
                      draft.startTime,
                      draft.endDate,
                      draft.endTime
                    )
                  ) {
                    setSaveError("End time must be later than start time on the same day.");
                    return;
                  }
                }

                if (draft.type === "stay") {
                  const badHotel = draft.hotels.find((h) =>
                    isInvalidRange(
                      h.checkinDate,
                      h.checkinTime,
                      h.checkoutDate,
                      h.checkoutTime
                    )
                  );
                  if (badHotel) {
                    setSaveError(
                      `Hotel "${badHotel.name.trim() || "unnamed"}": checkout time must be later than check-in time on the same day.`
                    );
                    return;
                  }
                }

                if (draft.type === "transit") {
                  const stays = stayStepsSorted(tripSteps);
                  if (stays.length < 2) {
                    setSaveError(t("step.noStaysForTransit"));
                    return;
                  }
                  if (
                    !draft.fromStayStepId?.trim() ||
                    !draft.toStayStepId?.trim()
                  ) {
                    setSaveError(t("step.transitEndpointsRequired"));
                    return;
                  }
                  if (draft.fromStayStepId === draft.toStayStepId) {
                    setSaveError(t("step.transitSameStayError"));
                    return;
                  }
                  const okFrom = stays.some((s) => s.id === draft.fromStayStepId);
                  const okTo = stays.some((s) => s.id === draft.toStayStepId);
                  if (!okFrom || !okTo) {
                    setSaveError(t("step.transitEndpointsRequired"));
                    return;
                  }
                  if (!isValidDdMmYyyy(draft.startDate)) {
                    setSaveError(t("step.transitDatesRequired"));
                    return;
                  }
                  if (totalMinutesFromTransitDuration(draft) <= 0) {
                    setSaveError(t("step.transitDurationRequired"));
                    return;
                  }
                }
                setSaveError(null);
                const toSave =
                  draft.type === "stay"
                    ? { ...draft, arrivalSummary: "", arrivalOptions: [] }
                    : {
                        ...draft,
                        arrivalSummary: "",
                        arrivalOptions: [],
                        endDateOpen: false,
                      };
                try {
                  await onSave(syncStepWithHotels(toSave));
                  onClose();
                } catch (error) {
                  setSaveError(error instanceof Error ? error.message : String(error));
                }
              }}
              className="flex-1 rounded-xl bg-zinc-900 py-2 text-sm font-semibold text-white dark:bg-white dark:text-zinc-900"
            >
              {t("common.save")}
            </button>
          </div>
        </div>
        ) : surface === "choose" ? (
        <div className="sticky bottom-0 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
          <button
            type="button"
            onClick={() => {
              setSaveError(null);
              onClose();
            }}
            className="w-full rounded-xl border border-zinc-200 py-3 text-sm font-medium dark:border-zinc-800"
          >
            {t("common.cancel")}
          </button>
        </div>
        ) : null}
      </div>
    </div>
  );
}
