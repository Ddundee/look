"use client";

import { useEffect, useState } from "react";
import { CalendarCheckIcon, FireIcon, SunIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { notifyTasksChanged, onTasksChanged } from "@/lib/events";
import { formatDateLong } from "@/lib/format";
import { isTaskDone, type Task, type TodayView } from "@/lib/types";
import { EmptyState, ErrorState, PageHeader, TaskListSkeleton, TaskSection } from "@/components/PageParts";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function TodayPage() {
  const [view, setView] = useState<TodayView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function load() {
      api
        .getToday()
        .then((v) => {
          setView(v);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load today"))
        .finally(() => setLoading(false));
    }
    load();
    return onTasksChanged(load);
  }, []);

  function patch(section: keyof TodayView, updater: (tasks: Task[]) => Task[]) {
    setView((prev) => (prev ? { ...prev, [section]: updater(prev[section] as Task[]) } : prev));
  }

  function onUpdatedIn(section: keyof TodayView) {
    return (updated: Task) => patch(section, (tasks) => tasks.map((t) => (t.id === updated.id ? updated : t)));
  }
  function onDeletedIn(section: keyof TodayView) {
    return (id: string) => patch(section, (tasks) => tasks.filter((t) => t.id !== id));
  }

  if (loading && !view) {
    return (
      <div>
        <PageHeader title="Today" subtitle={<span className="shimmer inline-block h-4 w-44 rounded" />} />
        <TaskListSkeleton />
      </div>
    );
  }
  if (!view) {
    return (
      <div>
        <PageHeader title="Today" />
        <ErrorState message={error ?? "Couldn't load today."} onRetry={notifyTasksChanged} />
      </div>
    );
  }

  const dueToday = view.due_today.filter((t) => !view.scheduled.some((s) => s.id === t.id));
  const nothingToShow =
    view.scheduled.length === 0 &&
    dueToday.length === 0 &&
    view.overdue.length === 0 &&
    view.suggested_high_priority.length === 0;

  const committed = [...view.scheduled, ...dueToday];
  const doneCount = committed.filter(isTaskDone).length;
  const pct = committed.length ? Math.round((doneCount / committed.length) * 100) : 0;

  return (
    <div>
      <PageHeader
        title={greeting()}
        subtitle={formatDateLong(view.date)}
        actions={
          committed.length > 0 ? (
            <div className="flex items-center gap-3" aria-label={`${doneCount} of ${committed.length} done today`}>
              <span className="font-mono text-xs tabular-nums text-fg-muted">
                {doneCount}/{committed.length}
              </span>
              <span className="relative h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-500 ease-out"
                  style={{ width: `${pct}%` }}
                />
              </span>
            </div>
          ) : undefined
        }
      />

      {nothingToShow ? (
        <EmptyState icon={CalendarCheckIcon} title="A clear day">
          Nothing planned or due. Add something above, or plan a task from Inbox or All Tasks with the sun button.
        </EmptyState>
      ) : (
        <div className="space-y-8">
          <TaskSection
            title="Overdue"
            icon={WarningCircleIcon}
            iconClassName="text-danger"
            tone="danger"
            tasks={view.overdue}
            onUpdated={onUpdatedIn("overdue")}
            onDeleted={onDeletedIn("overdue")}
          />
          <TaskSection
            title="Planned for today"
            icon={SunIcon}
            iconClassName="text-warn"
            tasks={view.scheduled}
            onUpdated={onUpdatedIn("scheduled")}
            onDeleted={onDeletedIn("scheduled")}
          />
          <TaskSection
            title="Due today"
            icon={CalendarCheckIcon}
            iconClassName="text-accent"
            tasks={dueToday}
            onUpdated={onUpdatedIn("due_today")}
            onDeleted={onDeletedIn("due_today")}
          />
          <TaskSection
            title="High priority, unscheduled"
            icon={FireIcon}
            iconClassName="text-fg-faint"
            tasks={view.suggested_high_priority}
            onUpdated={onUpdatedIn("suggested_high_priority")}
            onDeleted={onDeletedIn("suggested_high_priority")}
          />
        </div>
      )}
    </div>
  );
}
