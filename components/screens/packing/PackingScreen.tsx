"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Briefcase,
  Heart,
  ListChecks,
  Plus,
  Plug,
  Shirt,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useTripData } from "@/lib/trip/useTripData";
import { TripLoadStateScreen } from "@/components/screens/_shared/TripLoadStateScreen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, avatarInitials } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty";
import { applyTemplate, newPackingItemId, PACKING_TEMPLATES, templateById } from "@/lib/packing/templates";
import type { PackingCategory, PackingItem, PackingList, Trip } from "@/lib/types/trip";
import type { MessageKey } from "@/lib/i18n/messages";

const CATEGORY_ORDER: PackingCategory[] = [
  "documents",
  "clothes",
  "toiletries",
  "tech",
  "health",
  "gear",
  "misc",
];

const CATEGORY_LABELS: Record<PackingCategory, MessageKey> = {
  documents: "packing.cat.documents",
  clothes: "packing.cat.clothes",
  toiletries: "packing.cat.toiletries",
  tech: "packing.cat.tech",
  health: "packing.cat.health",
  gear: "packing.cat.gear",
  misc: "packing.cat.misc",
};

const CATEGORY_ICON: Record<PackingCategory, typeof Briefcase> = {
  documents: Briefcase,
  clothes: Shirt,
  toiletries: Sparkles,
  tech: Plug,
  health: Heart,
  gear: ListChecks,
  misc: Wand2,
};

export function PackingScreen({ tripId }: { tripId: string }) {
  const { trip, loadState } = useTripData(tripId);
  if (loadState !== "ok" || !trip) return <TripLoadStateScreen state={loadState} />;
  return <PackingContent trip={trip} />;
}

function PackingContent({ trip }: { trip: Trip }) {
  const { t } = useI18n();
  const { persistTrip } = useTripData(trip.id);
  const [travelerFilter, setTravelerFilter] = useState<string | "all" | "shared">("all");

  const list = trip.packingLists?.[0] ?? null;
  const items = list?.items ?? [];

  const filteredItems = useMemo(() => {
    if (travelerFilter === "all") return items;
    if (travelerFilter === "shared") return items.filter((i) => !i.travelerId);
    return items.filter((i) => i.travelerId === travelerFilter);
  }, [items, travelerFilter]);

  const totalCount = filteredItems.length;
  const packedCount = filteredItems.filter((i) => i.packed).length;
  const overallPct = totalCount === 0 ? 0 : Math.round((packedCount / totalCount) * 100);

  const grouped = useMemo(() => {
    const map = new Map<PackingCategory, PackingItem[]>();
    for (const k of CATEGORY_ORDER) map.set(k, []);
    for (const it of filteredItems) {
      const cat = (it.category ?? "misc") as PackingCategory;
      map.get(cat)!.push(it);
    }
    return map;
  }, [filteredItems]);

  async function updateList(updater: (current: PackingList) => PackingList) {
    const current: PackingList = list ?? {
      id: "pack-1",
      title: trip.title,
      items: [],
    };
    const next = updater(current);
    const lists = trip.packingLists ? trip.packingLists.slice() : [];
    if (lists.length === 0) lists.push(next);
    else lists[0] = next;
    await persistTrip({ ...trip, packingLists: lists, updatedAt: new Date().toISOString() });
  }

  async function toggleItem(item: PackingItem) {
    await updateList((l) => ({
      ...l,
      items: l.items.map((i) => (i.id === item.id ? { ...i, packed: !i.packed } : i)),
    }));
  }

  async function addItem(name: string, category: PackingCategory, travelerId?: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    await updateList((l) => ({
      ...l,
      items: [
        ...l.items,
        { id: newPackingItemId(l.items), name: trimmed, category, packed: false, travelerId },
      ],
    }));
  }

  async function removeItem(id: string) {
    await updateList((l) => ({ ...l, items: l.items.filter((i) => i.id !== id) }));
  }

  async function applyTpl(templateId: string) {
    const tpl = templateById(templateId);
    if (!tpl) return;
    await updateList((l) => ({ ...l, items: applyTemplate(l.items, tpl), templateId: tpl.id }));
  }

  const travelers = trip.travelers;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 lg:px-8">
      <Link
        href={`/trip/${trip.id}`}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs font-medium text-[var(--color-muted-foreground)] shadow-sm transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-foreground)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        <span>{t("shell.backToTrip")}</span>
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-brand)]">
            <ListChecks className="h-3.5 w-3.5" /> {trip.title}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--color-foreground)]">
            {t("packing.heading")}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t("packing.subheading")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {PACKING_TEMPLATES.map((tpl) => (
            <Button key={tpl.id} variant="secondary" size="sm" onClick={() => void applyTpl(tpl.id)}>
              <span aria-hidden className="mr-1">
                {tpl.emoji}
              </span>
              {t(tpl.labelKey)}
            </Button>
          ))}
        </div>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div className="min-w-44 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              {t("packing.progress", { packed: packedCount, total: totalCount })}
            </p>
            <Progress value={overallPct} className="mt-2" tone="mint" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip
              label={t("packing.allTravelers")}
              active={travelerFilter === "all"}
              onClick={() => setTravelerFilter("all")}
            />
            <FilterChip
              label={t("packing.shared")}
              active={travelerFilter === "shared"}
              onClick={() => setTravelerFilter("shared")}
            />
            {travelers.map((tr) => (
              <FilterChip
                key={tr.id}
                label={tr.name}
                active={travelerFilter === tr.id}
                avatar={tr.name}
                onClick={() => setTravelerFilter(tr.id)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {filteredItems.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="h-7 w-7" />}
          title={t("packing.empty")}
          description={t("packing.subheading")}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {CATEGORY_ORDER.map((cat) => {
            const list = grouped.get(cat) ?? [];
            const Icon = CATEGORY_ICON[cat];
            const packed = list.filter((i) => i.packed).length;
            const pct = list.length === 0 ? 0 : Math.round((packed / list.length) * 100);
            return (
              <Card key={cat}>
                <CardHeader className="flex-row items-center gap-2 pb-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
                    <Icon className="h-4 w-4" />
                  </span>
                  <CardTitle className="flex-1 text-sm">{t(CATEGORY_LABELS[cat])}</CardTitle>
                  <Badge tone="neutral">{`${packed}/${list.length}`}</Badge>
                </CardHeader>
                <CardContent>
                  <Progress value={pct} className="mb-3" tone="brand" />
                  {list.length === 0 ? (
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      {t("packing.empty")}
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {list.map((item) => (
                        <li
                          key={item.id}
                          className="flex items-center gap-2 rounded-xl px-1 py-1 hover:bg-[var(--color-surface-muted)]"
                        >
                          <Checkbox
                            checked={item.packed}
                            onCheckedChange={() => void toggleItem(item)}
                            aria-label={item.packed ? t("packing.unmarkPacked") : t("packing.markPacked")}
                          />
                          <span
                            className={
                              "flex-1 text-sm " +
                              (item.packed
                                ? "text-[var(--color-muted-foreground)] line-through"
                                : "text-[var(--color-foreground)]")
                            }
                          >
                            {item.name}
                            {item.quantity && item.quantity > 1 ? ` × ${item.quantity}` : ""}
                          </span>
                          {item.travelerId ? (
                            <Avatar className="h-5 w-5">
                              <AvatarFallback className="text-[8px]">
                                {avatarInitials(travelers.find((t) => t.id === item.travelerId)?.name)}
                              </AvatarFallback>
                            </Avatar>
                          ) : null}
                          <Button
                            size="iconSm"
                            variant="ghost"
                            onClick={() => void removeItem(item.id)}
                            aria-label={t("packing.deleteItem")}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <AddItemRow
                    onAdd={(name) =>
                      void addItem(name, cat, travelerFilter !== "all" && travelerFilter !== "shared" ? travelerFilter : undefined)
                    }
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  avatar,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  avatar?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors " +
        (active
          ? "border-transparent bg-[var(--color-brand-soft)] text-[var(--color-brand)]"
          : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-surface-muted)]")
      }
    >
      {avatar ? (
        <Avatar className="h-4 w-4">
          <AvatarFallback className="text-[8px]">{avatarInitials(avatar)}</AvatarFallback>
        </Avatar>
      ) : null}
      {label}
    </button>
  );
}

function AddItemRow({ onAdd }: { onAdd: (name: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        onAdd(value);
        setValue("");
      }}
      className="mt-3 flex items-center gap-2"
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("packing.itemPlaceholder")}
        className="h-9 text-xs"
      />
      <Button type="submit" size="iconSm" variant="primary" aria-label={t("packing.addItem")}>
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </form>
  );
}
