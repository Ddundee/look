"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarBlankIcon,
  CalendarCheckIcon,
  CalendarDotsIcon,
  CaretRightIcon,
  CodeIcon,
  FireIcon,
  ListChecksIcon,
  SunIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { notifyTasksChanged, onEventsChanged, onTasksChanged } from "@/lib/events";
import { formatDateLong, todayIso } from "@/lib/format";
import { isTaskDone, type LeetCodeStats, type Occurrence, type Task, type TodayView } from "@/lib/types";
import { EmptyState, ErrorState, Page, PageHeader, Panel, TaskListSkeleton, TaskSection } from "@/components/PageParts";
import AgendaList from "@/components/events/AgendaList";
import EventEditor, { type EditorTarget } from "@/components/events/EventEditor";

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
  const [schedule, setSchedule] = useState<Occurrence[]>([]);
  const [editor, setEditor] = useState<EditorTarget | null>(null);

  // LeetCode at a glance; shown only once something has been logged.
  const [leetcode, setLeetcode] = useState<LeetCodeStats | null>(null);
  useEffect(() => {
    api
      .getLeetCodeStats()
      .then(setLeetcode)
      .catch(() => {});
  }, []);

  useEffect(() => {
    function loadSchedule() {
      const day = todayIso();
      api
        .getSchedule(day, day)
        .then((s) => setSchedule(s.occurrences))
        .catch(() => {});
    }
    loadSchedule();
    return onEventsChanged(loadSchedule);
  }, []);

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
      <Page>
        <PageHeader title="Today" subtitle={<span className="shimmer inline-block h-4 w-44 rounded" />} />
        <TaskListSkeleton />
      </Page>
    );
  }
  if (!view) {
    return (
      <Page>
        <PageHeader title="Today" />
        <ErrorState message={error ?? "Couldn't load today."} onRetry={notifyTasksChanged} />
      </Page>
    );
  }

  const dueToday = view.due_today.filter((t) => !view.scheduled.some((s) => s.id === t.id));
  // Imported deadlines (Canvas assignments) due today are things to do, so
  // they sit with the tasks (checkable) rather than in the schedule. They
  // stay events; nothing is copied into tasks.
  const deadlines = schedule.filter((o) => o.deadline && !o.cancelled);
  const events = schedule.filter((o) => !(o.deadline && !o.cancelled));
  const taskCount =
    view.overdue.length + view.scheduled.length + dueToday.length + view.suggested_high_priority.length + deadlines.length;

  const committed = [...view.scheduled, ...dueToday];
  const doneCount = committed.filter(isTaskDone).length;
  const pct = committed.length ? Math.round((doneCount / committed.length) * 100) : 0;

  return (
    <Page>
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

      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Tasks" icon={ListChecksIcon} count={taskCount}>
          {taskCount === 0 ? (
            <EmptyState variant="panel" icon={CalendarCheckIcon} title="Nothing planned or due">
              Plan a task for today from All Tasks with the sun button, or add one from the Dashboard.
            </EmptyState>
          ) : (
            <>
              <TaskSection
                bare
                title="Overdue"
                icon={WarningCircleIcon}
                iconClassName="text-danger"
                tone="danger"
                tasks={view.overdue}
                onUpdated={onUpdatedIn("overdue")}
                onDeleted={onDeletedIn("overdue")}
              />
              <TaskSection
                bare
                title="Planned for today"
                icon={SunIcon}
                iconClassName="text-warn"
                tasks={view.scheduled}
                onUpdated={onUpdatedIn("scheduled")}
                onDeleted={onDeletedIn("scheduled")}
              />
              <TaskSection
                bare
                title="Due today"
                icon={CalendarCheckIcon}
                iconClassName="text-accent"
                tasks={dueToday}
                onUpdated={onUpdatedIn("due_today")}
                onDeleted={onDeletedIn("due_today")}
              />
              {deadlines.length > 0 && (
                <section className="anim-fade-up">
                  <h3 className="flex items-center gap-2 px-3 pb-1 pt-2.5 text-xs font-medium text-fg-muted">
                    <CalendarDotsIcon weight="bold" className="h-3.5 w-3.5 text-accent" aria-hidden />
                    Assignments due today
                    <span className="font-mono font-normal tabular-nums text-fg-faint">
                      {deadlines.filter((o) => o.completed).length}/{deadlines.length}
                    </span>
                  </h3>
                  <AgendaList occurrences={deadlines} onOpen={(occ) => setEditor({ kind: "occurrence", occ })} bare />
                </section>
              )}
              <TaskSection
                bare
                title="High priority, unscheduled"
                icon={FireIcon}
                iconClassName="text-fg-faint"
                tasks={view.suggested_high_priority}
                onUpdated={onUpdatedIn("suggested_high_priority")}
                onDeleted={onDeletedIn("suggested_high_priority")}
              />
            </>
          )}
        </Panel>

        <div className="flex flex-col gap-4 lg:min-h-0">
          <Panel
            title="Schedule"
            icon={CalendarBlankIcon}
            count={events.length}
            className="lg:flex-1"
            actions={
              <Link href="/calendar" className="text-xs font-medium text-accent-text underline-offset-4 hover:underline">
                Calendar
              </Link>
            }
          >
            {events.length === 0 ? (
              <EmptyState variant="panel" icon={CalendarBlankIcon} title="Nothing scheduled today" />
            ) : (
              <AgendaList occurrences={events} onOpen={(occ) => setEditor({ kind: "occurrence", occ })} bare />
            )}
          </Panel>

          {leetcode && leetcode.total_attempts > 0 && (
            <Link
              href="/leetcode"
              className="anim-fade-up group flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-surface px-4 py-3 text-sm text-fg elev-1 transition-colors hover:bg-surface-2/70"
            >
              <CodeIcon weight="bold" className="h-4 w-4 shrink-0 text-accent" aria-hidden />
              <span className="font-medium">LeetCode</span>
              <span className="font-mono tabular-nums text-fg-muted">
                {leetcode.solved_today}/{leetcode.goals.daily_target} today
              </span>
              <span className="font-mono tabular-nums text-fg-muted">
                {leetcode.solved_this_week}/{leetcode.goals.weekly_target} this week
              </span>
              {leetcode.current_streak > 0 && (
                <span className="inline-flex items-center gap-1 text-fg-muted">
                  <FireIcon weight="fill" className="h-3.5 w-3.5 text-warn" aria-hidden />
                  <span>
                    <span className="font-mono tabular-nums">{leetcode.current_streak}</span>-day streak
                  </span>
                </span>
              )}
              <CaretRightIcon className="ml-auto h-4 w-4 text-fg-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          )}
        </div>
      </div>
      {editor && <EventEditor target={editor} onClose={() => setEditor(null)} />}
    </Page>
  );
}
