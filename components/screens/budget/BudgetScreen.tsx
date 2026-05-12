"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useTripData } from "@/lib/trip/useTripData";
import { TripLoadStateScreen } from "@/components/screens/_shared/TripLoadStateScreen";
import { TripBackToTripLink } from "@/components/screens/_shared/TripSubpageBackLink";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, avatarInitials } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty";
import {
  cumulativeItinerarySpend,
  spendByCategoryFromItinerary,
  spendByDayFromItinerary,
  tripItineraryTotalAmount,
} from "@/lib/expenses/itinerarySpend";
import { collectItineraryPriceLines } from "@/lib/expenses/itineraryPriceLines";
import { computeBalances, nextExpenseId, settleBalances } from "@/lib/expenses/settlement";
import { collectTripMoneyCurrenciesExceptTarget } from "@/lib/fx/collectTripMoneyCurrencies";
import { moneyAmountInTargetCurrency, type FxMultipliersToTarget } from "@/lib/fx/moneyInTargetCurrency";
import { useTripFxMultipliers } from "@/lib/fx/useTripFxMultipliers";
import type { ExpenseCategory, ExpenseEntry, Money, Trip, TripStep } from "@/lib/types/trip";
import type { MessageKey } from "@/lib/i18n/messages";

const Charts = dynamic(() => import("./BudgetCharts").then((m) => ({ default: m.BudgetCharts })), {
  ssr: false,
  loading: () => <Skeleton className="h-72 w-full" />,
});

const CATEGORY_KEYS: Record<ExpenseCategory, MessageKey> = {
  hotels: "budget.cat.hotels",
  transport: "budget.cat.transport",
  food: "budget.cat.food",
  activities: "budget.cat.activities",
  shopping: "budget.cat.shopping",
  insurance: "budget.cat.insurance",
  other: "budget.cat.other",
};

export function BudgetScreen({ tripId }: { tripId: string }) {
  const { trip, loadState, persistTrip } = useTripData(tripId);
  if (loadState !== "ok" || !trip) return <TripLoadStateScreen state={loadState} />;
  return <BudgetContent trip={trip} persistTrip={persistTrip} />;
}

function BudgetContent({
  trip,
  persistTrip,
}: {
  trip: Trip;
  persistTrip: (next: Trip) => Promise<void>;
}) {
  const { t } = useI18n();

  const targetCur = useMemo(() => (trip.currency ?? "").trim().toUpperCase() || "USD", [trip.currency]);
  const fxSources = useMemo(() => collectTripMoneyCurrenciesExceptTarget(trip, targetCur), [trip, targetCur]);
  const needsFx = fxSources.length > 0;
  const { multipliers, loading: fxLoading, error: fxError, rateDate } = useTripFxMultipliers(
    targetCur,
    fxSources,
    needsFx
  );

  const fxReady = !needsFx || multipliers != null;
  const fxArg = !needsFx ? undefined : multipliers ?? undefined;

  const total = useMemo(() => {
    if (!fxReady) return null;
    return tripItineraryTotalAmount(trip, fxArg);
  }, [trip, fxReady, fxArg]);

  const byCat = useMemo(() => {
    if (!fxReady) return {};
    return spendByCategoryFromItinerary(trip, fxArg);
  }, [trip, fxReady, fxArg]);

  const byDay = useMemo(() => {
    if (!fxReady) return [];
    return spendByDayFromItinerary(trip, fxArg);
  }, [trip, fxReady, fxArg]);

  const cumulative = useMemo(() => {
    if (!fxReady) return [];
    return cumulativeItinerarySpend(trip, fxArg);
  }, [trip, fxReady, fxArg]);

  const hasItinerarySpend = total != null && total > 0;

  const balances = useMemo(() => {
    if (!fxReady && needsFx) {
      return Object.fromEntries((trip.travelers ?? []).map((tr) => [tr.id, 0]));
    }
    return computeBalances(trip, fxArg);
  }, [trip, fxReady, needsFx, fxArg]);

  const settlements = useMemo(() => {
    if (!fxReady && needsFx) return [];
    return settleBalances(trip, fxArg);
  }, [trip, fxReady, needsFx, fxArg]);

  const totalBudget = useMemo(() => {
    const raw = trip.budget?.totalBudget;
    if (raw == null || !Number.isFinite(raw.amount)) return null;
    if (!fxReady) return null;
    return moneyAmountInTargetCurrency(raw, targetCur, fxArg);
  }, [trip, targetCur, fxReady, fxArg]);

  const remaining = totalBudget != null && total != null ? totalBudget - total : null;
  const pct =
    totalBudget != null && totalBudget > 0 && total != null ? Math.min(100, (total / totalBudget) * 100) : 0;

  async function addExpense(input: Omit<ExpenseEntry, "id">) {
    const id = nextExpenseId(trip.expenses ?? []);
    const next: Trip = {
      ...trip,
      expenses: [...(trip.expenses ?? []), { ...input, id }],
      updatedAt: new Date().toISOString(),
    };
    await persistTrip(next);
  }

  async function removeExpense(id: string) {
    const next: Trip = {
      ...trip,
      expenses: (trip.expenses ?? []).filter((e) => e.id !== id),
      updatedAt: new Date().toISOString(),
    };
    await persistTrip(next);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 lg:px-8">
      <TripBackToTripLink tripId={trip.id} />
      <header>
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-brand)]">
          <Wallet className="h-3.5 w-3.5" /> {trip.title}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--color-foreground)]">
          {t("budget.heading")}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t("budget.subheading")}</p>
        {rateDate && needsFx && fxReady && !fxError ? (
          <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">{t("budget.fxRatesNote", { date: rateDate })}</p>
        ) : null}
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          label={t("budget.spent")}
          amount={
            fxError && needsFx
              ? t("budget.fxError")
              : total == null && needsFx
                ? t("budget.fxLoading")
                : formatMoney(total ?? 0, trip.currency)
          }
          tone="brand"
        />
        <SummaryCard
          label={t("budget.totalBudget")}
          amount={
            totalBudget == null && trip.budget?.totalBudget != null && needsFx && !fxReady
              ? t("budget.fxLoading")
              : totalBudget != null
                ? formatMoney(totalBudget, trip.currency)
                : t("budget.noBudget")
          }
          tone="sky"
        />
        <SummaryCard
          label={t("budget.remaining")}
          amount={remaining != null ? formatMoney(remaining, trip.currency) : "—"}
          tone={remaining != null && remaining < 0 ? "rose" : "mint"}
          progressValue={totalBudget != null && total != null && totalBudget > 0 ? pct : undefined}
        />
      </div>

      {fxError && needsFx ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100">
          {fxError}
        </p>
      ) : !fxReady && needsFx ? (
        <Skeleton className="h-72 w-full rounded-3xl" />
      ) : !hasItinerarySpend ? (
        <EmptyState
          icon={<Wallet className="h-7 w-7" />}
          title={t("budget.noItinerarySpend")}
          description={t("budget.itinerarySpendHint")}
        />
      ) : (
        <Charts
          byCategory={byCat}
          byDay={byDay}
          cumulative={cumulative}
          currency={trip.currency}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t("budget.expenses")}</CardTitle>
            <CardDescription>{t("budget.expensesCardDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <CostsAndExpensesList
              trip={trip}
              onRemove={removeExpense}
              fxMultipliers={fxArg}
              fxReady={fxReady}
              needsFx={needsFx}
              fxError={fxError}
            />
            <NewExpenseForm trip={trip} onAdd={addExpense} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("budget.settlement")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <SettlementSummary trip={trip} settlements={settlements} balances={balances} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  amount,
  tone,
  progressValue,
}: {
  label: string;
  amount: string;
  tone: "brand" | "sky" | "mint" | "rose";
  progressValue?: number;
}) {
  const gradient =
    tone === "brand"
      ? "bg-gradient-brand"
      : tone === "sky"
        ? "bg-gradient-aurora"
        : tone === "mint"
          ? "bg-gradient-meadow"
          : "bg-gradient-sunset";
  return (
    <Card className="overflow-hidden">
      <div className={`px-5 py-4 text-white ${gradient}`}>
        <p className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{label}</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{amount}</p>
      </div>
      {progressValue != null ? (
        <div className="px-5 py-3">
          <Progress value={progressValue} />
        </div>
      ) : null}
    </Card>
  );
}

function stepKindMessageKey(stepType: TripStep["stepType"]): MessageKey {
  if (stepType === "stay") return "view.kindStay";
  if (stepType === "transit") return "view.kindTransit";
  return "view.kindActivity";
}

function formatShortMd(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function MoneyFxDetailPanel({
  money,
  budgetCur,
  fxMultipliers,
  fxReady,
  needsFx,
  fxError,
  notes,
}: {
  money: Money;
  budgetCur: string;
  fxMultipliers?: FxMultipliersToTarget | null;
  fxReady: boolean;
  needsFx: boolean;
  fxError: string | null;
  notes?: string | null;
}) {
  const { t } = useI18n();
  const origCur = (money.currency ?? "").trim().toUpperCase() || budgetCur;
  const sameCurrency = origCur === budgetCur;
  const inBudget = moneyAmountInTargetCurrency(money, budgetCur, fxMultipliers);
  const showZeroConverted =
    !sameCurrency &&
    fxReady &&
    needsFx &&
    (fxMultipliers?.[origCur] == null || !Number.isFinite(fxMultipliers[origCur]) || !Number.isFinite(inBudget));

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2.5 text-xs text-[var(--color-foreground)]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[var(--color-muted-foreground)]">{t("budget.expenseDetailOriginal")}</span>
        <span className="font-semibold tabular-nums">
          {formatMoney(money.amount, money.currency)}
        </span>
      </div>
      {sameCurrency ? (
        <p className="text-[var(--color-muted-foreground)]">
          {t("budget.expenseDetailSameCurrency", { currency: budgetCur })}
        </p>
      ) : fxError && needsFx ? (
        <p className="text-rose-700 dark:text-rose-300">{t("budget.expenseDetailFxError")}</p>
      ) : needsFx && !fxReady ? (
        <p className="text-[var(--color-muted-foreground)]">{t("budget.expenseDetailFxLoading")}</p>
      ) : showZeroConverted ? (
        <p className="text-[var(--color-muted-foreground)]">{t("budget.expenseDetailFxUnavailable")}</p>
      ) : (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-[var(--color-border)] pt-2">
          <span className="text-[var(--color-muted-foreground)]">
            {t("budget.expenseDetailInBudgetCurrency", { currency: budgetCur })}
          </span>
          <span className="font-semibold tabular-nums">
            {formatMoney(Math.round(inBudget * 100) / 100, budgetCur)}
          </span>
        </div>
      )}
      {(notes ?? "").trim() ? (
        <p className="border-t border-[var(--color-border)] pt-2 text-[11px] leading-snug text-[var(--color-muted-foreground)]">
          {(notes ?? "").trim()}
        </p>
      ) : null}
    </div>
  );
}

function CostsAndExpensesList({
  trip,
  onRemove,
  fxMultipliers,
  fxReady,
  needsFx,
  fxError,
}: {
  trip: Trip;
  onRemove: (id: string) => Promise<void>;
  fxMultipliers?: FxMultipliersToTarget | null;
  fxReady: boolean;
  needsFx: boolean;
  fxError: string | null;
}) {
  const { t } = useI18n();
  const itineraryLines = useMemo(() => collectItineraryPriceLines(trip), [trip]);
  const expenses = (trip.expenses ?? []).slice().sort((a, b) => b.date.localeCompare(a.date));
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const budgetCur = (trip.currency ?? "").trim().toUpperCase() || "USD";

  if (itineraryLines.length === 0 && expenses.length === 0) {
    return <p className="text-sm text-[var(--color-muted-foreground)]">{t("budget.allCostsEmpty")}</p>;
  }

  return (
    <div className="space-y-6">
      {itineraryLines.length > 0 ? (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            {t("budget.fromItinerary")}
          </p>
          <ul className="divide-y divide-[var(--color-border)]">
            {itineraryLines.map((line) => {
              const key = `itn:${line.id}`;
              const primary =
                line.source === "transit_manual"
                  ? t("budget.transitManualPriceLabel")
                  : line.intervalTitle.trim() || t("common.untitled");
              const secondary = `${t("budget.intervalPriceBadge")} · ${t(stepKindMessageKey(line.stepType))} · ${line.stepTitle} · ${formatShortMd(line.dateKey)}`;
              const ariaLabel = `${primary} — ${line.stepTitle}`;

              return (
                <li key={line.id} className="py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                      onClick={() => setExpandedKey((prev) => (prev === key ? null : key))}
                      aria-expanded={expandedKey === key}
                      aria-label={t("budget.itineraryPriceDetailsAria", { label: ariaLabel })}
                    >
                      {expandedKey === key ? (
                        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden />
                      ) : (
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--color-foreground)]">{primary}</p>
                        <p className="text-[11px] text-[var(--color-muted-foreground)]">{secondary}</p>
                      </div>
                    </button>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--color-foreground)]">
                      {formatMoney(line.money.amount, line.money.currency)}
                    </span>
                  </div>
                  {expandedKey === key ? (
                    <MoneyFxDetailPanel
                      money={line.money}
                      budgetCur={budgetCur}
                      fxMultipliers={fxMultipliers}
                      fxReady={fxReady}
                      needsFx={needsFx}
                      fxError={fxError}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          {t("budget.loggedExpenses")}
        </p>
        {expenses.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("budget.noLoggedExpensesYet")}</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {expenses.map((e) => {
              const expKey = `exp:${e.id}`;
              const paidBy = trip.travelers.find((tr) => tr.id === e.paidByTravelerId);
              return (
                <li key={e.id} className="py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                      onClick={() => setExpandedKey((prev) => (prev === expKey ? null : expKey))}
                      aria-expanded={expandedKey === expKey}
                      aria-label={t("budget.expenseAmountDetailsAria", { title: e.title })}
                    >
                      {expandedKey === expKey ? (
                        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden />
                      ) : (
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--color-foreground)]">{e.title}</p>
                        <p className="text-[11px] text-[var(--color-muted-foreground)]">
                          {paidBy?.name ?? "—"} ·{" "}
                          {new Date(e.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
                          {e.category ? t(CATEGORY_KEYS[e.category]) : t("budget.cat.other")}
                        </p>
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums text-[var(--color-foreground)]">
                        {formatMoney(e.amount.amount, e.amount.currency)}
                      </span>
                      <Button
                        size="iconSm"
                        variant="ghost"
                        onClick={() => void onRemove(e.id)}
                        aria-label={t("budget.deleteExpense")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {expandedKey === expKey ? (
                    <MoneyFxDetailPanel
                      money={e.amount}
                      budgetCur={budgetCur}
                      fxMultipliers={fxMultipliers}
                      fxReady={fxReady}
                      needsFx={needsFx}
                      fxError={fxError}
                      notes={e.notes}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function NewExpenseForm({
  trip,
  onAdd,
}: {
  trip: Trip;
  onAdd: (input: Omit<ExpenseEntry, "id">) => Promise<void>;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [paidById, setPaidById] = useState(trip.travelers[0]?.id ?? "");
  const [category, setCategory] = useState<ExpenseCategory>("food");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [splitIds, setSplitIds] = useState<string[]>(trip.travelers.map((t) => t.id));
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const numeric = Number.parseFloat(amount);
    if (!title.trim() || !Number.isFinite(numeric) || numeric <= 0 || !paidById) return;
    setBusy(true);
    try {
      await onAdd({
        title: title.trim(),
        amount: { amount: numeric, currency: trip.currency },
        paidByTravelerId: paidById,
        splitBetween: splitIds.length > 0 ? splitIds : [paidById],
        category,
        date: new Date(date).toISOString(),
      });
      setTitle("");
      setAmount("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 border-t border-[var(--color-border)] pt-4">
      <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("budget.expenseTitle")}
          required
        />
        <Input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={t("budget.amount")}
          inputMode="decimal"
          required
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <select
          className="h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
          value={paidById}
          onChange={(e) => setPaidById(e.target.value)}
        >
          {trip.travelers.map((tr) => (
            <option key={tr.id} value={tr.id}>
              {tr.name}
            </option>
          ))}
        </select>
        <select
          className="h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
          value={category}
          onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
        >
          {(Object.keys(CATEGORY_KEYS) as ExpenseCategory[]).map((k) => (
            <option key={k} value={k}>
              {t(CATEGORY_KEYS[k])}
            </option>
          ))}
        </select>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          {t("budget.splitBetween")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {trip.travelers.map((tr) => {
            const on = splitIds.includes(tr.id);
            return (
              <button
                key={tr.id}
                type="button"
                onClick={() =>
                  setSplitIds((prev) =>
                    on ? prev.filter((id) => id !== tr.id) : [...prev, tr.id]
                  )
                }
                className={
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors " +
                  (on
                    ? "border-transparent bg-[var(--color-brand-soft)] text-[var(--color-brand)]"
                    : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-surface-muted)]")
                }
              >
                <Avatar className="h-4 w-4">
                  <AvatarFallback className="text-[8px]">{avatarInitials(tr.name)}</AvatarFallback>
                </Avatar>
                {tr.name}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={busy} className="gap-1.5">
          <Plus className="h-4 w-4" /> {t("budget.addExpense")}
        </Button>
      </div>
    </form>
  );
}

function SettlementSummary({
  trip,
  settlements,
  balances,
}: {
  trip: Trip;
  settlements: ReturnType<typeof settleBalances>;
  balances: Record<string, number>;
}) {
  const { t } = useI18n();
  const nameOf = (id: string) => trip.travelers.find((tr) => tr.id === id)?.name ?? id;
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {Object.entries(balances).map(([id, b]) => (
          <li
            key={id}
            className="flex items-center justify-between rounded-xl bg-[var(--color-surface-muted)] px-2.5 py-1.5"
          >
            <span className="flex items-center gap-2 text-sm">
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-[9px]">{avatarInitials(nameOf(id))}</AvatarFallback>
              </Avatar>
              {nameOf(id)}
            </span>
            <span
              className={
                "inline-flex items-center gap-1 text-sm font-semibold tabular-nums " +
                (b >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]")
              }
            >
              {b >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              {formatMoney(Math.abs(b), trip.currency)}
            </span>
          </li>
        ))}
      </ul>
      {settlements.length === 0 ? (
        <p className="text-xs text-[var(--color-muted-foreground)]">{t("budget.allSettled")}</p>
      ) : (
        <ul className="space-y-1.5">
          {settlements.map((s, i) => (
            <li
              key={i}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            >
              {t("budget.owesAmount", {
                from: nameOf(s.fromId),
                to: nameOf(s.toId),
                amount: formatMoney(s.amount, s.currency),
              })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toLocaleString()} ${currency}`;
  }
}
