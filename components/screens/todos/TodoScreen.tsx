"use client";

import { useMemo, useState } from "react";
import {
  CheckSquare,
  ChevronDown,
  Circle,
  Clock,
  Lock,
  Plus,
  Trash2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useTripData } from "@/lib/trip/useTripData";
import { usePrivateTripTasks } from "@/lib/trip/usePrivateTripTasks";
import { TripLoadStateScreen } from "@/components/screens/_shared/TripLoadStateScreen";
import { TripBackToTripLink } from "@/components/screens/_shared/TripSubpageBackLink";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { newId } from "@/lib/canonicalIds";
import type { TaskStatus, Trip, TripTask } from "@/lib/types/trip";

type StatusFilter = "all" | TaskStatus;

const STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "done", "cancelled"];

const STATUS_ICON: Record<TaskStatus, LucideIcon> = {
  todo: Circle,
  in_progress: Clock,
  done: CheckSquare,
  cancelled: XCircle,
};

const STATUS_COLOR: Record<TaskStatus, string> = {
  todo: "text-[var(--color-muted-foreground)]",
  in_progress: "text-[var(--color-brand)]",
  done: "text-emerald-500",
  cancelled: "text-red-400",
};


export function TodoScreen({ tripId }: { tripId: string }) {
  const { trip, loadState, persistTrip } = useTripData(tripId);
  if (loadState !== "ok" || !trip) return <TripLoadStateScreen state={loadState} />;
  return <TodoContent trip={trip} persistTrip={persistTrip} />;
}

function TodoContent({
  trip,
  persistTrip,
}: {
  trip: Trip;
  persistTrip: (next: Trip) => Promise<void>;
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const privateTasks = usePrivateTripTasks(trip.id);

  const sharedTasks = trip.tasks ?? [];
  const doneCount =
    sharedTasks.filter((t) => t.status === "done").length +
    privateTasks.tasks.filter((t) => t.status === "done").length;
  const activeCount =
    sharedTasks.filter((t) => t.status !== "cancelled").length +
    privateTasks.tasks.filter((t) => t.status !== "cancelled").length;
  const pct = activeCount === 0 ? 0 : Math.round((doneCount / activeCount) * 100);

  const filteredShared = useMemo(() => {
    const sorted = [...sharedTasks].sort(
      (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
    );
    return filter === "all" ? sorted : sorted.filter((t) => t.status === filter);
  }, [sharedTasks, filter]);

  const filteredPrivate = useMemo(() => {
    const sorted = [...privateTasks.tasks].sort(
      (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
    );
    return filter === "all" ? sorted : sorted.filter((t) => t.status === filter);
  }, [privateTasks.tasks, filter]);

  async function updateShared(next: TripTask[]) {
    await persistTrip({ ...trip, tasks: next, updatedAt: new Date().toISOString() });
  }

  async function addSharedTask(title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    await updateShared([...sharedTasks, { id: newId(), title: trimmed, status: "todo" }]);
  }

  async function toggleSharedDone(task: TripTask) {
    await updateShared(
      sharedTasks.map((t) =>
        t.id === task.id ? { ...t, status: (t.status === "done" ? "todo" : "done") as TaskStatus } : t
      )
    );
  }

  async function changeSharedStatus(id: string, status: TaskStatus) {
    await updateShared(sharedTasks.map((t) => (t.id === id ? { ...t, status } : t)));
  }

  async function removeSharedTask(id: string) {
    await updateShared(sharedTasks.filter((t) => t.id !== id));
  }

  async function updateSharedTitle(id: string, title: string) {
    await updateShared(sharedTasks.map((t) => (t.id === id ? { ...t, title } : t)));
  }

  const FILTER_ITEMS: { key: StatusFilter; label: string }[] = [
    { key: "all", label: t("todos.filterAll") },
    { key: "todo", label: t("todos.filterTodo") },
    { key: "in_progress", label: t("todos.filterInProgress") },
    { key: "done", label: t("todos.filterDone") },
  ];

  const STATUS_LABELS: Record<TaskStatus, string> = {
    todo: t("todos.statusTodo"),
    in_progress: t("todos.statusInProgress"),
    done: t("todos.statusDone"),
    cancelled: t("todos.statusCancelled"),
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 lg:px-8">
      <TripBackToTripLink tripId={trip.id} />

      <header>
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-brand)]">
          <CheckSquare className="h-3.5 w-3.5" /> {trip.title}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--color-foreground)]">
          {t("todos.heading")}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t("todos.subheading")}</p>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div className="min-w-44 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              {t("todos.progress", { done: String(doneCount), total: String(activeCount) })}
            </p>
            <Progress value={pct} className="mt-2" tone="mint" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTER_ITEMS.map(({ key, label }) => (
              <FilterChip
                key={key}
                label={label}
                active={filter === key}
                onClick={() => setFilter(key)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Shared tasks section */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          {t("todos.sharedSection")}
        </h2>

        {filteredShared.length === 0 ? (
          <EmptyState
            icon={<CheckSquare className="h-7 w-7" />}
            title={t("todos.empty")}
            description={t("todos.subheading")}
          />
        ) : (
          <Card>
            <CardContent className="pt-4">
              <TaskList
                tasks={filteredShared}
                statusLabels={STATUS_LABELS}
                onToggle={(task) => void toggleSharedDone(task)}
                onChangeStatus={(id, s) => void changeSharedStatus(id, s)}
                onUpdateTitle={(id, v) => void updateSharedTitle(id, v)}
                onRemove={(id) => void removeSharedTask(id)}
                deleteAriaLabel={t("todos.deleteTask")}
              />
            </CardContent>
          </Card>
        )}

        <AddTaskRow placeholder={t("todos.taskPlaceholder")} onAdd={addSharedTask} />
      </section>

      {/* Private tasks section */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Lock className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            {t("todos.privateSection")}
          </h2>
        </div>
        <p className="text-xs text-[var(--color-muted-foreground)]">{t("todos.privateHint")}</p>

        {filteredPrivate.length > 0 && (
          <Card className="border-dashed">
            <CardHeader className="pb-0 pt-3">
              <CardTitle className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
                <Lock className="h-3 w-3" /> {t("todos.privateSection")}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              <TaskList
                tasks={filteredPrivate}
                statusLabels={STATUS_LABELS}
                onToggle={(task) => void privateTasks.toggleDone(task.id)}
                onChangeStatus={(id, s) => void privateTasks.changeStatus(id, s)}
                onUpdateTitle={(id, v) => void privateTasks.updateTitle(id, v)}
                onRemove={(id) => void privateTasks.removeTask(id)}
                deleteAriaLabel={t("todos.deleteTask")}
              />
            </CardContent>
          </Card>
        )}

        {filteredPrivate.length === 0 && (
          <p className="text-xs text-[var(--color-muted-foreground)]">{t("todos.empty")}</p>
        )}

        <AddTaskRow
          placeholder={t("todos.privateTaskPlaceholder")}
          onAdd={(title) => privateTasks.addTask(title)}
        />
      </section>
    </div>
  );
}

function TaskList({
  tasks,
  statusLabels,
  onToggle,
  onChangeStatus,
  onUpdateTitle,
  onRemove,
  deleteAriaLabel,
}: {
  tasks: TripTask[];
  statusLabels: Record<TaskStatus, string>;
  onToggle: (task: TripTask) => void;
  onChangeStatus: (id: string, status: TaskStatus) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onRemove: (id: string) => void;
  deleteAriaLabel: string;
}) {
  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <Checkbox
              checked={task.status === "done"}
              onCheckedChange={() => onToggle(task)}
            />
            <input
              className={
                "min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-muted-foreground)] " +
                (task.status === "done"
                  ? "text-[var(--color-muted-foreground)] line-through"
                  : "text-[var(--color-foreground)]")
              }
              value={task.title}
              onChange={(e) => onUpdateTitle(task.id, e.target.value)}
            />
            <StatusPicker
              value={task.status}
              statusLabels={statusLabels}
              onChange={(s) => onChangeStatus(task.id, s)}
            />
            <Button
              size="iconSm"
              variant="ghost"
              onClick={() => onRemove(task.id)}
              aria-label={deleteAriaLabel}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
      ))}
    </ul>
  );
}

function StatusPicker({
  value,
  statusLabels,
  onChange,
}: {
  value: TaskStatus;
  statusLabels: Record<TaskStatus, string>;
  onChange: (s: TaskStatus) => void;
}) {
  const Icon = STATUS_ICON[value];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={
            "flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 transition-colors hover:bg-[var(--color-surface-muted)] " +
            STATUS_COLOR[value]
          }
        >
          <Icon className="h-4 w-4" />
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {STATUS_ORDER.map((s) => {
          const SIcon = STATUS_ICON[s];
          return (
            <DropdownMenuItem
              key={s}
              onClick={() => onChange(s)}
              className={s === value ? "bg-[var(--color-surface-muted)]" : ""}
            >
              <SIcon className={`h-4 w-4 ${STATUS_COLOR[s]}`} />
              <span className="text-sm">{statusLabels[s]}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
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
      {label}
    </button>
  );
}

function AddTaskRow({
  onAdd,
  placeholder,
}: {
  onAdd: (title: string) => Promise<void> | void;
  placeholder: string;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        void onAdd(value);
        setValue("");
      }}
      className="flex items-center gap-2"
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="h-9 text-sm"
      />
      <Button type="submit" size="iconSm" variant="primary" aria-label={t("todos.addTask")}>
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </form>
  );
}
