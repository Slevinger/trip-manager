"use client";

import { useId, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { ArrivalOption, StayStep, TransportOption, TripStep } from "@/lib/types/trip";
import { stayStepsSorted } from "@/lib/tripStayEndpoints";
import { TransitStaySelects } from "@/components/trip/TransitStaySelects";
import { GroupedNumberInput } from "@/components/trip/GroupedNumberInput";
import { HotelsEditor } from "@/components/trip/HotelsEditor";
import { AttachmentManager } from "@/components/trip/AttachmentManager";
import { useI18n } from "@/components/providers/I18nProvider";
import { TripDateTimeInput } from "@/components/trip/TripDateTimeInput";
import { formatSpanBetweenStoredParts, isValidDdMmYyyy } from "@/lib/timeline/dates";
import {
  applyOpenEndDateFromHotels,
  applyTransitEndFromArrivals,
  computeNightsForStep,
  syncStepWithHotels,
  transitStepDurationFromArrivals,
} from "@/lib/timeline/hotelsAndDates";
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
  onSave: (step: TripStep) => void;
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

  const previewNights = useMemo(() => computeNightsForStep(draft), [draft]);

  const stayOptions = useMemo(() => stayStepsSorted(tripSteps), [tripSteps]);

  const transitDurationPreview = useMemo(() => {
    if (draft.type !== "transit") return "";
    return transitStepDurationFromArrivals(draft);
  }, [draft]);

  const transitEndFollowsLastArrival = useMemo(() => {
    if (draft.type !== "transit" || draft.transitEndManual) return false;
    if (!draft.arrivalOptions.length) return false;
    const last = draft.arrivalOptions[draft.arrivalOptions.length - 1];
    return isValidDdMmYyyy(last.endDate);
  }, [draft]);

  function setHotels(hotels: StayStep["hotels"]) {
    setDraft((d) => {
      if (d.type !== "stay") return d;
      let next: TripStep = { ...d, hotels };
      next = applyOpenEndDateFromHotels(next);
      next = { ...next, nights: computeNightsForStep(next) };
      return next;
    });
  }

  function setTransports(transports: TransportOption[]) {
    setDraft((d) => {
      if (d.type !== "transit") return d;
      return { ...d, transports };
    });
  }

  function addArrival() {
    setDraft((d) => {
      if (d.type !== "transit") return d;
      const nextOpt: ArrivalOption = {
        id: uuidv4(),
        title: "",
        details: "",
        duration: "",
        cost: "",
        startDate: "",
        startTime: "",
        endDate: "",
        endTime: "",
      };
      const withOpts = { ...d, arrivalOptions: [...d.arrivalOptions, nextOpt] };
      return applyTransitEndFromArrivals(withOpts);
    });
  }

  function updateArrivalOption(idx: number, patch: Partial<ArrivalOption>) {
    setDraft((d) => {
      if (d.type !== "transit") return d;
      const arrivalOptions = d.arrivalOptions.map((o, i) => {
        if (i !== idx) return o;
        const next = { ...o, ...patch };
        return {
          ...next,
          duration: formatSpanBetweenStoredParts(
            next.startDate,
            next.startTime,
            next.endDate,
            next.endTime
          ),
        };
      });
      return applyTransitEndFromArrivals({ ...d, arrivalOptions });
    });
  }

  function switchType(type: "stay" | "transit") {
    setDraft((d) => {
      if (d.type === type) return d;
      if (type === "stay") {
        if (d.type !== "transit") return d;
        const { transports: _tr, transitEndManual: _tm, ...base } = d;
        return { ...base, type: "stay", hotels: [] };
      }
      return {
        ...d,
        type,
        transports: [],
        endDateOpen: false,
        transitEndManual: false,
        fromStayStepId: d.type === "transit" ? d.fromStayStepId : undefined,
        toStayStepId: d.type === "transit" ? d.toStayStepId : undefined,
      };
    });
  }

  function addTransport() {
    setSaveError(null);
    setWizardMode("transit_item");
    setSurface("wizard");
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
                onClick={() => {
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
                  { type: "stay" as const, label: t("step.typeStay") },
                  { type: "transit" as const, label: t("step.typeTransit") },
                ] as const
              ).map(({ type, label }) => {
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
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs text-zinc-600 dark:text-zinc-300">
              <span>{t("step.startDate")}</span>
              <TripDateTimeInput
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                date={draft.startDate}
                time={draft.startTime}
                onDateChange={(startDate) => {
                  setSaveError(null);
                  setDraft({ ...draft, startDate });
                }}
                onTimeChange={(startTime) => {
                  setSaveError(null);
                  setDraft({ ...draft, startTime });
                }}
              />
            </label>
            <label className="block text-xs text-zinc-600 dark:text-zinc-300">
              <span>{t("step.endDate")}</span>
              <TripDateTimeInput
                disabled={
                  (draft.type === "stay" && draft.endDateOpen) ||
                  transitEndFollowsLastArrival
                }
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900"
                date={draft.endDate}
                time={draft.endTime}
                onDateChange={(endDate) => {
                  setSaveError(null);
                  setDraft((d) => {
                    if (d.type !== "transit") return { ...d, endDate };
                    const bothEmpty = endDate.trim() === "" && d.endTime.trim() === "";
                    if (bothEmpty) {
                      return applyTransitEndFromArrivals({
                        ...d,
                        endDate: "",
                        endTime: "",
                        transitEndManual: false,
                      });
                    }
                    return { ...d, endDate, transitEndManual: true };
                  });
                }}
                onTimeChange={(endTime) => {
                  setSaveError(null);
                  setDraft((d) => {
                    if (d.type !== "transit") return { ...d, endTime };
                    const bothEmpty = d.endDate.trim() === "" && endTime.trim() === "";
                    if (bothEmpty) {
                      return applyTransitEndFromArrivals({
                        ...d,
                        endDate: "",
                        endTime: "",
                        transitEndManual: false,
                      });
                    }
                    return { ...d, endTime, transitEndManual: true };
                  });
                }}
              />
              {transitEndFollowsLastArrival ? (
                <div className="mt-2 space-y-2">
                  <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                    {t("step.transitEndFromArrivalsHint")}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) =>
                        d.type === "transit" ? { ...d, transitEndManual: true } : d
                      )
                    }
                    className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  >
                    {t("step.transitEndEditManual")}
                  </button>
                </div>
              ) : null}
              {draft.type === "transit" &&
              draft.transitEndManual &&
              draft.arrivalOptions.length > 0 &&
              isValidDdMmYyyy(
                draft.arrivalOptions[draft.arrivalOptions.length - 1].endDate
              ) ? (
                <button
                  type="button"
                  onClick={() =>
                    setDraft((d) =>
                      d.type !== "transit"
                        ? d
                        : applyTransitEndFromArrivals({
                            ...d,
                            transitEndManual: false,
                          })
                    )
                  }
                  className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  {t("step.transitEndMatchLastArrival")}
                </button>
              ) : null}
            </label>
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
              {t("step.transitDatesRequired")}
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
          {draft.type === "transit" ? (
            <>
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
                        className="rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950 sm:col-span-2"
                        value={opt.title}
                        placeholder={t("step.title")}
                        onChange={(e) => {
                          const arrivalOptions = draft.arrivalOptions.map((o, i) =>
                            i === idx ? { ...o, title: e.target.value } : o
                          );
                          setDraft({ ...draft, arrivalOptions });
                        }}
                      />
                      <label className="block text-xs text-zinc-600 dark:text-zinc-300 sm:col-span-2">
                        <span>{t("step.arrivalOptionStart")}</span>
                        <TripDateTimeInput
                          className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          date={opt.startDate}
                          time={opt.startTime}
                          onDateChange={(startDate) => updateArrivalOption(idx, { startDate })}
                          onTimeChange={(startTime) => updateArrivalOption(idx, { startTime })}
                        />
                      </label>
                      <label className="block text-xs text-zinc-600 dark:text-zinc-300 sm:col-span-2">
                        <span>{t("step.arrivalOptionEnd")}</span>
                        <TripDateTimeInput
                          className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          date={opt.endDate}
                          time={opt.endTime}
                          onDateChange={(endDate) => updateArrivalOption(idx, { endDate })}
                          onTimeChange={(endTime) => updateArrivalOption(idx, { endTime })}
                        />
                      </label>
                      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200 sm:col-span-2">
                        <div className="font-normal">{t("step.arrivalOptionDuration")}</div>
                        <div className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">
                          {formatSpanBetweenStoredParts(
                            opt.startDate,
                            opt.startTime,
                            opt.endDate,
                            opt.endTime
                          ) || "—"}
                        </div>
                        <p className="mt-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                          {t("step.arrivalOptionDurationHint")}
                        </p>
                      </div>
                      <textarea
                        className="min-h-[56px] rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950 sm:col-span-2"
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
                        className="rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950 sm:col-span-2"
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
            </>
          ) : null}

          {draft.type === "stay" ? (
            <HotelsEditor
              hotels={draft.hotels}
              onChange={setHotels}
              onAddRequested={() => {
                setSaveError(null);
                setWizardMode("stay_item");
                setSurface("wizard");
              }}
            />
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                  {t("step.transport")}
                </div>
                <button
                  type="button"
                  onClick={addTransport}
                  className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium dark:border-zinc-800 dark:bg-zinc-900"
                >
                  + {t("step.transport")}
                </button>
              </div>
              {draft.transports.map((opt, idx) => (
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
                        const transports = draft.transports.map((o, i) =>
                          i === idx ? { ...o, title: e.target.value } : o
                        );
                        setTransports(transports);
                      }}
                    />
                    <input
                      className="rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      value={opt.duration}
                      placeholder={t("step.durationFreeformPh")}
                      onChange={(e) => {
                        const transports = draft.transports.map((o, i) =>
                          i === idx ? { ...o, duration: e.target.value } : o
                        );
                        setTransports(transports);
                      }}
                    />
                    <input
                      className="rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      value={opt.from}
                      placeholder={t("step.transportFrom")}
                      onChange={(e) => {
                        const transports = draft.transports.map((o, i) =>
                          i === idx ? { ...o, from: e.target.value } : o
                        );
                        setTransports(transports);
                      }}
                    />
                    <input
                      className="rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      value={opt.to}
                      placeholder={t("step.transportTo")}
                      onChange={(e) => {
                        const transports = draft.transports.map((o, i) =>
                          i === idx ? { ...o, to: e.target.value } : o
                        );
                        setTransports(transports);
                      }}
                    />
                    <textarea
                      className="sm:col-span-2 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      value={opt.details}
                      placeholder={t("step.notes")}
                      onChange={(e) => {
                        const transports = draft.transports.map((o, i) =>
                          i === idx ? { ...o, details: e.target.value } : o
                        );
                        setTransports(transports);
                      }}
                    />
                    <input
                      className="sm:col-span-2 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      value={opt.cost}
                      placeholder={t("hotels.cost")}
                      onChange={(e) => {
                        const transports = draft.transports.map((o, i) =>
                          i === idx ? { ...o, cost: e.target.value } : o
                        );
                        setTransports(transports);
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
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
              onClick={() => {
                setSaveError(null);
                onClose();
              }}
              className="flex-1 rounded-xl border border-zinc-200 py-2 text-sm font-medium dark:border-zinc-800"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
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
                  if (
                    !isValidDdMmYyyy(draft.startDate) ||
                    !isValidDdMmYyyy(draft.endDate)
                  ) {
                    setSaveError(t("step.transitDatesRequired"));
                    return;
                  }
                }
                setSaveError(null);
                const toSave =
                  draft.type === "stay"
                    ? { ...draft, arrivalSummary: "", arrivalOptions: [] }
                    : {
                        ...draft,
                        endDateOpen: false,
                        arrivalOptions: draft.arrivalOptions.map((o) => ({
                          ...o,
                          duration: formatSpanBetweenStoredParts(
                            o.startDate,
                            o.startTime,
                            o.endDate,
                            o.endTime
                          ),
                        })),
                      };
                onSave(syncStepWithHotels(toSave));
                onClose();
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
