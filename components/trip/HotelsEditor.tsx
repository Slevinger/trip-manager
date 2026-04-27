"use client";

import { v4 as uuidv4 } from "uuid";
import type { Hotel } from "@/lib/types/trip";
import { GroupedNumberInput } from "@/components/trip/GroupedNumberInput";
import { TripDateTimeInput } from "@/components/trip/TripDateTimeInput";
import { useI18n } from "@/components/providers/I18nProvider";

export function HotelsEditor({
  hotels,
  onChange,
}: {
  hotels: Hotel[];
  onChange: (next: Hotel[]) => void;
}) {
  const { t } = useI18n();

  function updateAt(index: number, patch: Partial<Hotel>) {
    const next = hotels.map((h, i) => (i === index ? { ...h, ...patch } : h));
    onChange(next);
  }

  function removeAt(index: number) {
    onChange(hotels.filter((_, i) => i !== index));
  }

  function addHotel() {
    onChange([
      ...hotels,
      {
        id: uuidv4(),
        name: "",
        checkinDate: "",
        checkinTime: "",
        checkoutDate: "",
        checkoutTime: "",
        bookingUrl: "",
        cost: 0,
        notes: "",
      },
    ]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {t("hotels.title")}
        </div>
        <button
          type="button"
          onClick={addHotel}
          className="rounded-lg bg-zinc-900 px-2 py-1 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900"
        >
          {t("hotels.add")}
        </button>
      </div>
      <div className="space-y-3">
        {hotels.map((h, idx) => (
          <div
            key={h.id}
            className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block text-xs text-zinc-600 dark:text-zinc-300">
                  <span>{t("hotels.name")}</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    value={h.name}
                    onChange={(e) => updateAt(idx, { name: e.target.value })}
                  />
                </label>
                <label className="block text-xs text-zinc-600 dark:text-zinc-300">
                  <span>{t("hotels.cost")}</span>
                  <GroupedNumberInput
                    min={0}
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    value={Number.isFinite(h.cost) ? h.cost : 0}
                    onChange={(n) => updateAt(idx, { cost: n })}
                  />
                </label>
                <label className="block text-xs text-zinc-600 dark:text-zinc-300">
                  <span>{t("hotels.checkin")}</span>
                  <TripDateTimeInput
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    date={h.checkinDate}
                    time={h.checkinTime}
                    onDateChange={(checkinDate) => updateAt(idx, { checkinDate })}
                    onTimeChange={(checkinTime) => updateAt(idx, { checkinTime })}
                  />
                </label>
                <label className="block text-xs text-zinc-600 dark:text-zinc-300">
                  <span>{t("hotels.checkout")}</span>
                  <TripDateTimeInput
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    date={h.checkoutDate}
                    time={h.checkoutTime}
                    onDateChange={(checkoutDate) => updateAt(idx, { checkoutDate })}
                    onTimeChange={(checkoutTime) => updateAt(idx, { checkoutTime })}
                  />
                </label>
                <label className="col-span-1 block text-xs text-zinc-600 dark:text-zinc-300 sm:col-span-2">
                  <span>{t("hotels.bookingUrl")}</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    value={h.bookingUrl}
                    onChange={(e) =>
                      updateAt(idx, { bookingUrl: e.target.value })
                    }
                  />
                </label>
                <label className="col-span-1 block text-xs text-zinc-600 dark:text-zinc-300 sm:col-span-2">
                  <span>{t("hotels.notes")}</span>
                  <textarea
                    className="mt-1 min-h-[64px] w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    value={h.notes}
                    onChange={(e) => updateAt(idx, { notes: e.target.value })}
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => removeAt(idx)}
                className="rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-700 dark:border-red-900/60 dark:text-red-300"
              >
                {t("common.delete")}
              </button>
            </div>
          </div>
        ))}
        {!hotels.length ? (
          <p className="text-xs text-zinc-500">{t("hotels.add")}</p>
        ) : null}
      </div>
    </div>
  );
}
