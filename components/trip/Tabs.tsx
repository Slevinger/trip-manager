"use client";

type TabId = "view" | "manage";

export function Tabs({
  active,
  onChange,
  labels,
}: {
  active: TabId;
  onChange: (t: TabId) => void;
  labels: { view: string; manage: string };
}) {
  const btn = (id: TabId, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => onChange(id)}
      className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${
        active === id
          ? "bg-zinc-900 text-white shadow-sm dark:bg-white dark:text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex gap-1 rounded-2xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-900/60">
      {btn("view", labels.view)}
      {btn("manage", labels.manage)}
    </div>
  );
}
