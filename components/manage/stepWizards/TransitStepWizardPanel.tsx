"use client";

import dynamic from "next/dynamic";
import { useId, useMemo, useState } from "react";

import { useI18n } from "@/lib/i18n/context";
import type { TripGroupedPlacePicks } from "@/lib/tripLocationCatalog";
import type { CurrencyCode, Destination, TransitStep, TransitStepInterval } from "@/lib/types/trip";
import { STEP_WIZARD_IDS } from "@/lib/wizardStack/types";
import type { WizardStackControls } from "@/lib/wizardStack/useWizardStack";

import {
  appendGeoPickComment,
  notesToText,
  textToNotes,
  useWizardDirection,
  WIZARD_INPUT_CLASS_LARGE,
  WIZARD_SELECT_CLASS,
  WIZARD_TEXTAREA_CLASS,
  WizardField,
  WizardNavRow,
  WizardPage,
  WizardPageHeading,
} from "./wizardShared";

const CreateDestinationDialog = dynamic(
  () =>
    import("@/components/manage/CreateDestinationDialog").then((m) => ({
      default: m.CreateDestinationDialog,
    })),
  { ssr: false }
);

const TRANSIT_STEP_WIZARD_PAGE_COUNT = 2;
const STEP_PRICE_CURRENCIES: CurrencyCode[] = ["THB", "USD", "EUR", "ILS", "GBP"];

export function TransitStepWizardPanel({
  draft,
  setDraft,
  wizard,
  tripPlaceGrouped,
  fromPlace,
  toPlace,
  setFromPlace,
  setToPlace,
  onRegisterNewDestination,
  tripCurrency,
}: {
  draft: TransitStep;
  setDraft: (next: TransitStep | ((prev: TransitStep) => TransitStep)) => void;
  wizard: WizardStackControls;
  tripPlaceGrouped: TripGroupedPlacePicks;
  tripCurrency: CurrencyCode;
  fromPlace: Destination;
  toPlace: Destination;
  setFromPlace: (d: Destination) => void;
  setToPlace: (d: Destination) => void;
  onRegisterNewDestination: (d: Destination) => void;
}) {
  const { t } = useI18n();
  const page = Math.min(
    Math.max(0, wizard.top?.step ?? 0),
    TRANSIT_STEP_WIZARD_PAGE_COUNT - 1
  );
  const direction = useWizardDirection(page);

  function appendCommentToFirstInterval(line: string) {
    setDraft((prev) => ({
      ...prev,
      stepIntervals: prev.stepIntervals.map((int, i) =>
        i === 0 && int.intervalType === "transit"
          ? ({ ...int, comment: appendGeoPickComment(int.comment, line) } as TransitStepInterval)
          : int
      ),
    }));
  }

  function goIntervalWizard() {
    wizard.push({
      id: STEP_WIZARD_IDS.transitStepIntervalWizard,
      step: 0,
      payload: { intervalIndex: 0 },
    });
  }

  return (
    <div className="space-y-6">
      <WizardPage pageKey={page} direction={direction}>
        {page === 0 ? (
          <div className="space-y-5">
            <WizardPageHeading
              eyebrow="Transit step"
              title="How are you getting there?"
              subtitle="Pick the stays this leg connects — flights, ferries, transfers, road trips."
              accent="sky"
            />

            <WizardField
              htmlFor="transit-step-title"
              label="Step title"
              hint="A short label for the trip plan. We'll generate one if you leave it blank."
            >
              <input
                id="transit-step-title"
                className={WIZARD_INPUT_CLASS_LARGE}
                placeholder="e.g., BKK → HKT flight"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </WizardField>

            <div className="grid gap-4 sm:grid-cols-2">
              <WizardField
                label="From"
                hint="Pick an existing destination or add a new one on the map."
              >
                <DestinationPicker
                  current={fromPlace}
                  excludeDestinationId={toPlace.id}
                  tripPlaceGrouped={tripPlaceGrouped}
                  placeholder="Pick a destination…"
                  onPickDestination={(dest) => {
                    setFromPlace(dest);
                    if (dest.id !== draft.fromStayId) {
                      setDraft((prev) => ({ ...prev, fromStayId: dest.id }));
                    }
                    if (dest.location) {
                      appendCommentToFirstInterval(`From: ${dest.location}`);
                    }
                  }}
                  onRegisterNewDestination={onRegisterNewDestination}
                />
              </WizardField>
              <WizardField
                label="To"
                hint="Pick an existing destination or add a new one on the map."
              >
                <DestinationPicker
                  current={toPlace}
                  excludeDestinationId={fromPlace.id}
                  tripPlaceGrouped={tripPlaceGrouped}
                  placeholder="Pick a destination…"
                  onPickDestination={(dest) => {
                    setToPlace(dest);
                    if (dest.id !== draft.toStayId) {
                      setDraft((prev) => ({ ...prev, toStayId: dest.id }));
                    }
                    if (dest.location) {
                      appendCommentToFirstInterval(`To: ${dest.location}`);
                    }
                  }}
                  onRegisterNewDestination={onRegisterNewDestination}
                />
              </WizardField>
            </div>

            {/*
              Transit step's own registry pin (`targetDestinationId`) is auto-resolved by
              `compactBareTransitTargets` to point at the to-stay (or last leg's arrival),
              so no manual "leg place" UI is needed in the typical flow. See lib/i18n
              key `manage.transitStepPlaceHint` for the legacy explanation.
            */}
            <p className="sr-only">{t("manage.transitStepPlaceHint")}</p>
          </div>
        ) : (
          <div className="space-y-5">
            <WizardPageHeading
              eyebrow="Transit step"
              title="Anything to flag for this leg?"
              subtitle="Bag rules, gate quirks, transfer notes — stay-with-the-step reminders."
              accent="sky"
            />
            <WizardField
              htmlFor="transit-step-notes"
              label="Step notes"
              optional
              hint="One thought per line."
            >
              <textarea
                id="transit-step-notes"
                rows={5}
                className={WIZARD_TEXTAREA_CLASS}
                placeholder={"e.g.,\n2 checked bags\nGate B12\nMeet driver at exit"}
                value={notesToText(draft.notes)}
                onChange={(e) => setDraft({ ...draft, notes: textToNotes(e.target.value) })}
              />
            </WizardField>

            <div className="grid gap-4 sm:grid-cols-2 rounded-2xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
              <WizardField
                htmlFor="transit-step-extra-fees"
                label={t("manage.transitStepExtraFees")}
                optional
                hint={t("manage.transitStepExtraFeesWizardHint")}
              >
                <input
                  id="transit-step-extra-fees"
                  type="number"
                  min={0}
                  step="any"
                  className={WIZARD_INPUT_CLASS_LARGE}
                  value={draft.totalManualPrice != null ? String(draft.totalManualPrice.amount) : ""}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    if (raw === "") {
                      setDraft({ ...draft, totalManualPrice: undefined });
                      return;
                    }
                    const n = Number(raw);
                    if (!Number.isFinite(n)) return;
                    setDraft({
                      ...draft,
                      totalManualPrice: {
                        amount: n,
                        currency: draft.totalManualPrice?.currency ?? tripCurrency,
                      },
                    });
                  }}
                />
              </WizardField>
              <WizardField htmlFor="transit-step-extra-fees-currency" label={t("manage.priceCurrency")}>
                <select
                  id="transit-step-extra-fees-currency"
                  className={WIZARD_SELECT_CLASS}
                  value={draft.totalManualPrice?.currency ?? tripCurrency}
                  onChange={(e) => {
                    const cur = e.target.value as CurrencyCode;
                    if (!draft.totalManualPrice) {
                      setDraft({ ...draft, totalManualPrice: { amount: 0, currency: cur } });
                      return;
                    }
                    setDraft({
                      ...draft,
                      totalManualPrice: { ...draft.totalManualPrice, currency: cur },
                    });
                  }}
                  disabled={!draft.totalManualPrice}
                >
                  {[...new Set([tripCurrency, ...STEP_PRICE_CURRENCIES])].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </WizardField>
            </div>
          </div>
        )}
      </WizardPage>

      <WizardNavRow
        page={page}
        totalPages={TRANSIT_STEP_WIZARD_PAGE_COUNT}
        prevLabel={page <= 0 && wizard.canPop ? "Step type" : "Previous"}
        nextLabel="Next"
        accent="sky"
        prevDisabled={page <= 0 && !wizard.canPop}
        onPrev={() =>
          page <= 0 && wizard.canPop ? wizard.pop() : wizard.setTopStep(page - 1)
        }
        onNext={() => wizard.setTopStep(page + 1)}
        finalAction={{ label: "Transit interval", onClick: goIntervalWizard }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Destination picker — all trip destinations grouped by type + add new.     */
/* ------------------------------------------------------------------------- */

const ADD_NEW_VALUE = "__add_new__";

function DestinationPicker({
  current,
  excludeDestinationId,
  tripPlaceGrouped,
  placeholder,
  onPickDestination,
  onRegisterNewDestination,
}: {
  current: Destination;
  excludeDestinationId?: string;
  tripPlaceGrouped: TripGroupedPlacePicks;
  placeholder: string;
  onPickDestination: (destination: Destination) => void;
  onRegisterNewDestination: (d: Destination) => void;
}) {
  const selectId = useId();
  const [createOpen, setCreateOpen] = useState(false);
  const [isChanging, setIsChanging] = useState(false);

  // Destinations grouped by city/step center, excluding opposite endpoint and self.
  const isExcluded = (destinationId: string | undefined) =>
    !destinationId || destinationId === excludeDestinationId || destinationId === current.id;

  const cityGroups = useMemo(() => {
    return tripPlaceGrouped.stayGroups
      .map((g) => ({
        label: g.stayLabel,
        picks: [g.centerPick, ...g.memberPicks].filter((p) => !isExcluded(p.destinationId)),
      }))
      .filter((g) => g.picks.length > 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripPlaceGrouped.stayGroups, excludeDestinationId, current.id]);

  const standaloneOptions = useMemo(() => {
    return tripPlaceGrouped.otherPicks.filter((p) => !isExcluded(p.destinationId));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripPlaceGrouped.otherPicks, excludeDestinationId, current.id]);

  // Flat lookup: destinationId → TripPlacePick (for resolving pick details on select).
  const pickMap = useMemo(() => {
    const map = new Map<string, typeof tripPlaceGrouped.otherPicks[number]>();
    for (const g of tripPlaceGrouped.stayGroups) {
      for (const p of [g.centerPick, ...g.memberPicks]) {
        if (p.destinationId) map.set(p.destinationId, p);
      }
    }
    for (const p of tripPlaceGrouped.otherPicks) {
      if (p.destinationId) map.set(p.destinationId, p);
    }
    return map;
  }, [tripPlaceGrouped]);

  const currentPick = pickMap.get(current.id);
  const hasSelection = Boolean(current.id && (current.title || current.location));
  const displayLabel = (currentPick?.headline ?? current.title) || current.location || "";
  const displaySub =
    currentPick?.headline ? currentPick.label
    : current.title && current.location && current.title !== current.location
      ? current.location
      : undefined;

  function handleSelect(value: string) {
    if (value === ADD_NEW_VALUE) {
      setCreateOpen(true);
      return;
    }
    if (!value) return;
    const pick = pickMap.get(value);
    if (!pick?.destinationId) return;
    onPickDestination({
      id: pick.destinationId,
      title: pick.headline ?? pick.label.split(",")[0] ?? pick.label,
      location: pick.label,
      description: pick.subtitle ?? pick.label,
    });
    setIsChanging(false);
  }

  // Chip view — shown when a destination is selected and not actively changing.
  if (hasSelection && !isChanging) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50/60 px-3 py-2.5 dark:border-sky-800 dark:bg-sky-950/30">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {displayLabel}
          </p>
          {displaySub ? (
            <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
              {displaySub}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setIsChanging(true)}
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-900/40"
        >
          Change
        </button>
        <CreateDestinationDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSave={(d) => {
            onRegisterNewDestination(d);
            onPickDestination(d);
            setCreateOpen(false);
          }}
        />
      </div>
    );
  }

  // Picker view — shown when nothing is selected, or the user clicked "Change".
  return (
    <div className="space-y-1.5">
      <select
        id={selectId}
        className={WIZARD_SELECT_CLASS}
        value=""
        onChange={(e) => handleSelect(e.target.value)}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {cityGroups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.picks.map((p) => (
              <option key={p.destinationId} value={p.destinationId}>
                {p.headline ? `${p.headline} · ${p.label}` : p.label}
              </option>
            ))}
          </optgroup>
        ))}
        {standaloneOptions.length > 0 ? (
          <optgroup label="Other">
            {standaloneOptions.map((p) => (
              <option key={p.destinationId} value={p.destinationId}>
                {p.headline ? `${p.headline} · ${p.label}` : p.label}
              </option>
            ))}
          </optgroup>
        ) : null}
        <option value={ADD_NEW_VALUE}>＋ Add new on map…</option>
      </select>

      {isChanging ? (
        <button
          type="button"
          onClick={() => setIsChanging(false)}
          className="px-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          ← Keep current
        </button>
      ) : null}

      <CreateDestinationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSave={(d) => {
          onRegisterNewDestination(d);
          onPickDestination(d);
          setCreateOpen(false);
        }}
      />
    </div>
  );
}
