"use client";

import { useEffect, useState } from "react";
import { CheckCircleIcon, HashIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { notifyTasksChanged, onTasksChanged } from "@/lib/events";
import { categoryHue, formatDate } from "@/lib/format";
import type { Task, WeekSummary } from "@/lib/types";
import { CARD } from "@/lib/ui";
import { EmptyState, ErrorState, PageHeader, TaskList, TaskListSkeleton } from "@/components/PageParts";

function Stat({ value, label, tone }: { value: number; label: string; tone?: "danger" }) {
  return (
    <div className="px-5 py-4">
      <div
        className={`font-mono text-3xl font-medium tabular-nums tracking-tight ${
          tone === "danger" && value > 0 ? "text-danger" : "text-fg"
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-[13px] text-fg-muted">{label}</div>
    </div>
  );
}

export default function CompletedPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [summary, setSummary] = useState<WeekSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function load() {
      Promise.all([
        api.listTasks({ status: "completed" }).then((r) => r.tasks),
        api.getWeekSummary(),
      ])
        .then(([t, s]) => {
          setTasks([...t].sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "")));
          setSummary(s);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load completed tasks"))
        .finally(() => setLoading(false));
    }
    load();
    return onTasksChanged(load);
  }, []);

  function onUpdated(updated: Task) {
    if (updated.status !== "completed") {
      setTasks((prev) => prev.filter((t) => t.id !== updated.id));
    } else {
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    }
  }
  function onDeleted(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  const byCategory = summary
    ? Object.entries(summary.completed_by_category).sort((a, b) => b[1] - a[1])
    : [];
  const maxCat = byCategory.reduce((m, [, n]) => Math.max(m, n), 0);

  return (
    <div>
      <PageHeader
        title="Completed"
        subtitle={
          summary
            ? `This week, ${formatDate(summary.start_date)} to ${formatDate(summary.end_date)}`
            : undefined
        }
      />

      {error && <ErrorState message={error} onRetry={notifyTasksChanged} />}

      {summary && (
        <div className={`anim-fade-up mb-10 overflow-hidden ${CARD}`}>
          <div className="grid grid-cols-3 divide-x divide-line">
            <Stat value={summary.completed_count} label="Completed" />
            <Stat value={summary.created_count} label="Created" />
            <Stat value={summary.overdue_count} label="Still overdue" tone="danger" />
          </div>
          {byCategory.length > 0 && (
            <div className="space-y-2.5 border-t border-line px-5 py-4">
              {byCategory.map(([cat, count]) => (
                <div key={cat} className="flex items-center gap-3 text-[13px]">
                  <span className="inline-flex w-28 shrink-0 items-center gap-1 truncate text-fg-muted">
                    <HashIcon weight="bold" className={`h-3.5 w-3.5 shrink-0 ${categoryHue(cat)}`} aria-hidden />
                    {cat}
                  </span>
                  <span className="h-1.5 flex-1">
                    <span
                      className="block h-full rounded-full bg-accent/70"
                      style={{ width: `${Math.max(4, (count / maxCat) * 100)}%` }}
                    />
                  </span>
                  <span className="w-6 text-right font-mono tabular-nums text-fg">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <TaskListSkeleton />
      ) : tasks.length === 0 ? (
        !error && (
          <EmptyState icon={CheckCircleIcon} title="Nothing completed yet">
            Finished tasks collect here, newest first.
          </EmptyState>
        )
      ) : (
        <section>
          <h2 className="px-1 pb-2 text-[13px] font-medium text-fg-muted">History</h2>
          <TaskList tasks={tasks} onUpdated={onUpdated} onDeleted={onDeleted} />
        </section>
      )}
    </div>
  );
}
