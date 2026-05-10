"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "@/lib/i18n/context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ExpenseCategory } from "@/lib/types/trip";
import type { MessageKey } from "@/lib/i18n/messages";

const CATEGORY_LABELS: Record<ExpenseCategory, MessageKey> = {
  hotels: "budget.cat.hotels",
  transport: "budget.cat.transport",
  food: "budget.cat.food",
  activities: "budget.cat.activities",
  shopping: "budget.cat.shopping",
  insurance: "budget.cat.insurance",
  other: "budget.cat.other",
};

const PALETTE = [
  "var(--color-brand)",
  "var(--color-accent-coral)",
  "var(--color-accent-mint)",
  "var(--color-accent-amber)",
  "var(--color-accent-sky)",
  "var(--color-accent-rose)",
  "#94a3b8",
];

export function BudgetCharts({
  byCategory,
  byDay,
  cumulative,
  currency,
}: {
  byCategory: Record<string, number>;
  byDay: { dateIso: string; amount: number }[];
  cumulative: { dateIso: string; amount: number }[];
  currency: string;
}) {
  const { t } = useI18n();
  const catData = Object.entries(byCategory).map(([k, v]) => ({
    key: k,
    name: t(CATEGORY_LABELS[k as ExpenseCategory] ?? "budget.cat.other"),
    value: Math.round(v * 100) / 100,
  }));
  const dayLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const dayData = byDay.map((d) => ({ name: dayLabel(d.dateIso), value: d.amount }));
  const cumData = cumulative.map((d) => ({ name: dayLabel(d.dateIso), value: d.amount }));

  const fmt = (n: unknown): string => `${Math.round(Number(n) || 0)} ${currency}`;

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("budget.byCategory")}</CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip
                formatter={fmt as never}
                contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
              />
              <Pie
                data={catData}
                dataKey="value"
                nameKey="name"
                innerRadius={36}
                outerRadius={64}
                paddingAngle={3}
                stroke="var(--color-surface)"
              >
                {catData.map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
              <Legend
                iconType="circle"
                wrapperStyle={{ fontSize: 11 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("budget.byDay")}</CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dayData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
              <XAxis dataKey="name" stroke="var(--color-muted-foreground)" fontSize={10} />
              <YAxis stroke="var(--color-muted-foreground)" fontSize={10} />
              <Tooltip
                formatter={fmt as never}
                contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
              />
              <Bar dataKey="value" fill="var(--color-brand)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("budget.cumulative")}</CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={cumData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-accent-coral)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--color-accent-coral)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
              <XAxis dataKey="name" stroke="var(--color-muted-foreground)" fontSize={10} />
              <YAxis stroke="var(--color-muted-foreground)" fontSize={10} />
              <Tooltip
                formatter={fmt as never}
                contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
              />
              <Area type="monotone" dataKey="value" stroke="var(--color-accent-coral)" fill="url(#cumFill)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
