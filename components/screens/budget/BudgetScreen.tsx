"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowDownRight,
  ArrowUpRight,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useTripData } from "@/lib/trip/useTripData";
import { TripLoadStateScreen } from "@/components/screens/_shared/TripLoadStateScreen";
import { TripBackToTripLink } from "@/components/screens/_shared/TripSubpageBackLink";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, avatarInitials } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty";
import {
  computeBalances,
  cumulativeSpend,
  nextExpenseId,
  settleBalances,
  spendByCategory,
  spendByDay,
  totalSpent,
} from "@/lib/expenses/settlement";
import type { ExpenseCategory, ExpenseEntry, Trip } from "@/lib/types/trip";
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

  const total = useMemo(() => totalSpent(trip), [trip]);
  const byCat = useMemo(() => spendByCategory(trip), [trip]);
  const byDay = useMemo(() => spendByDay(trip), [trip]);
  const cumulative = useMemo(() => cumulativeSpend(trip), [trip]);
  const settlements = useMemo(() => settleBalances(trip), [trip]);
  const balances = useMemo(() => computeBalances(trip), [trip]);

  const totalBudget = trip.budget?.totalBudget?.amount ?? null;
  const remaining = totalBudget != null ? totalBudget - total : null;
  const pct = totalBudget && totalBudget > 0 ? Math.min(100, (total / totalBudget) * 100) : 0;

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
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          label={t("budget.spent")}
          amount={`${formatMoney(total, trip.currency)}`}
          tone="brand"
        />
        <SummaryCard
          label={t("budget.totalBudget")}
          amount={totalBudget != null ? formatMoney(totalBudget, trip.currency) : t("budget.noBudget")}
          tone="sky"
        />
        <SummaryCard
          label={t("budget.remaining")}
          amount={remaining != null ? formatMoney(remaining, trip.currency) : "—"}
          tone={remaining != null && remaining < 0 ? "rose" : "mint"}
          progressValue={totalBudget ? pct : undefined}
        />
      </div>

      {(trip.expenses ?? []).length === 0 ? (
        <EmptyState
          icon={<Wallet className="h-7 w-7" />}
          title={t("budget.noExpenses")}
          description={t("budget.subheading")}
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
          </CardHeader>
          <CardContent>
            <ExpenseList trip={trip} onRemove={removeExpense} />
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

function ExpenseList({
  trip,
  onRemove,
}: {
  trip: Trip;
  onRemove: (id: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const expenses = (trip.expenses ?? []).slice().sort((a, b) => b.date.localeCompare(a.date));
  if (expenses.length === 0) {
    return <p className="text-sm text-[var(--color-muted-foreground)]">{t("budget.noExpenses")}</p>;
  }
  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {expenses.map((e) => {
        const paidBy = trip.travelers.find((t) => t.id === e.paidByTravelerId);
        return (
          <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--color-foreground)]">{e.title}</p>
              <p className="text-[11px] text-[var(--color-muted-foreground)]">
                {paidBy?.name ?? "—"} ·{" "}
                {new Date(e.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
                {e.category ? t(CATEGORY_KEYS[e.category]) : t("budget.cat.other")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tabular-nums">
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
          </li>
        );
      })}
    </ul>
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
