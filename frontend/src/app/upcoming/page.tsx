"use client";

import { useEffect, useState } from "react";
import { SunHorizonIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { notifyTasksChanged, onTasksChanged } from "@/lib/events";
import { relativeDueLabel, todayIso, addDaysIso } from "@/lib/format";
import type { Task } from "@/lib/types";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  TaskList,
  TaskListSkeleton,
  TaskSection,
} from "@/components/PageParts";

function DayLabel({ iso }: { iso: string }) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const rel = relativeDueLabel(iso);
  const isNamed = rel === "Today" || rel === "Tomorrow";
  return (
    <div className="flex items-baseline gap-2 sm:w-24 sm:shrink-0 sm:flex-col sm:items-start sm:gap-0 sm:pt-2.5">
      <span className="font-mono text-2xl font-medium leading-none tabular-nums text-fg">{d}</span>
      <span className="text-[13px] text-fg-muted">
        {isNamed ? rel : date.toLocaleDateString(undefined, { weekday: "long" })}
      </span>
      <span className="text-xs text-fg-faint sm:mt-0.5">
        {date.toLocaleDateString(undefined, { month: "short" })}
      </span>
    </div>
  );
}

export default function UpcomingPage() {
  const [overdue, setOverdue] = useState<Task[]>([]);
  const [upcoming, setUpcoming] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function load() {
      Promise.all([api.getOverdue(), api.getUpcoming(14)])
        .then(([o, u]) => {
          setOverdue(o.tasks);
          setUpcoming(u.tasks);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load upcoming tasks"))
        .finally(() => setLoading(false));
    }
    load();
    return onTasksChanged(load);
  }, []);

  const groups = new Map<string, Task[]>();
  for (const t of upcoming) {
    const key = t.due_date ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const sortedKeys = Array.from(groups.keys()).sort();

  function patchIn(setter: typeof setOverdue) {
    return {
      onUpdated: (updated: Task) =>
        setter((prev) => prev.map((t) => (t.id === updated.id ? updated : t))),
      onDeleted: (id: string) => setter((prev) => prev.filter((t) => t.id !== id)),
    };
  }
  const overdueHandlers = patchIn(setOverdue);
  const upcomingHandlers = patchIn(setUpcoming);

  const today = todayIso();

  return (
    <div>
      <PageHeader
        title="Upcoming"
        subtitle={`Next two weeks, through ${relativeDueLabel(addDaysIso(today, 14))}`}
      />

      {error && <ErrorState message={error} onRetry={notifyTasksChanged} />}

      {loading ? (
        <TaskListSkeleton rows={5} />
      ) : overdue.length === 0 && upcoming.length === 0 ? (
        !error && (
          <EmptyState icon={SunHorizonIcon} title="Nothing on the horizon">
            No tasks are due in the next 14 days.
          </EmptyState>
        )
      ) : (
        <div className="space-y-8">
          <TaskSection
            title="Overdue"
            icon={WarningCircleIcon}
            iconClassName="text-danger"
            tone="danger"
            tasks={overdue}
            {...overdueHandlers}
          />

          {sortedKeys.length > 0 && (
            <ol className="space-y-6">
              {sortedKeys.map((key) => (
                <li
                  key={key}
                  className="anim-fade-up flex flex-col gap-2 sm:flex-row sm:gap-4"
                  aria-label={relativeDueLabel(key)}
                >
                  <DayLabel iso={key} />
                  <div className="min-w-0 flex-1">
                    <TaskList tasks={groups.get(key)!} {...upcomingHandlers} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
