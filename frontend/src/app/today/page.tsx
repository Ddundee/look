"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarBlankIcon, CalendarCheckIcon, CaretRightIcon, CodeIcon, FireIcon, ListChecksIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { notifyTasksChanged, onEventsChanged, onTasksChanged } from "@/lib/events";
import { formatDateLong } from "@/lib/format";
import type { LeetCodeStats, Occurrence, WorkPlan } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { EmptyState, ErrorState, Page, PageHeader, Panel, TaskListSkeleton } from "@/components/PageParts";
import WorkList from "@/components/WorkList";
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
  const [plan, setPlan] = useState<WorkPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<Occurrence[] | null>(null);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const now = useNow();

  // LeetCode at a glance; shown only once something has been logged.
  const [leetcode, setLeetcode] = useState<LeetCodeStats | null>(null);
  useEffect(() => {
    api
      .getLeetCodeStats()
      .then(setLeetcode)
      .catch(() => {});
  }, []);

  // Tasks and imported assignments, as one list. "Today" is the server's
  // (APP_TIMEZONE), so the schedule below uses the plan's date.
  const loadPlan = useCallback(() => {
    api
      .getWorkPlan()
      .then((p) => {
        setPlan(p);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load today"));
  }, []);
  useEffect(() => {
    loadPlan();
    const offTasks = onTasksChanged(loadPlan);
    const offEvents = onEventsChanged(loadPlan);
    return () => {
      offTasks();
      offEvents();
    };
  }, [loadPlan]);

  const day = plan?.date;
  useEffect(() => {
    if (!day) return;
    const load = () =>
      api
        .getSchedule(day, day)
        .then((s) => setSchedule(s.occurrences))
        .catch(() => {});
    load();
    return onEventsChanged(load);
  }, [day]);

  if (!plan) {
    return (
      <Page>
        <PageHeader title="Today" subtitle={error ? undefined : <span className="shimmer inline-block h-4 w-44 rounded" />} />
        {error ? <ErrorState message={error} onRetry={notifyTasksChanged} /> : <TaskListSkeleton />}
      </Page>
    );
  }

  // Assignments are listed with the work; the schedule is everything else.
  const events = (schedule ?? []).filter((o) => !(o.deadline && !o.cancelled));
  const todayDone = plan.today.filter((i) => i.done).length;
  const pct = plan.today.length ? Math.round((todayDone / plan.today.length) * 100) : 0;
  const nothing = plan.overdue.length + plan.today.length + plan.undated.length === 0;
  const isToday = now.slice(0, 10) === plan.date;

  return (
    <Page>
      <PageHeader
        title={greeting()}
        subtitle={formatDateLong(plan.date)}
        actions={
          plan.today.length > 0 ? (
            <div className="flex items-center gap-3" aria-label={`${todayDone} of ${plan.today.length} due today done`}>
              <span className="font-mono text-xs tabular-nums text-fg-muted">
                {todayDone}/{plan.today.length}
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
        {/* Counts tasks and assignments, so it isn't called "tasks". */}
        <Panel title="Things to do" icon={ListChecksIcon} count={plan.remaining}>
          {nothing ? (
            <EmptyState variant="panel" icon={CalendarCheckIcon} title="Nothing to do">
              Nothing overdue, due today or waiting without a date. Add a task from the Dashboard.
            </EmptyState>
          ) : (
            <WorkList plan={plan} onChanged={loadPlan} onOpenAssignment={(occ) => setEditor({ kind: "occurrence", occ })} />
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
            {schedule === null ? (
              <TaskListSkeleton rows={2} className="" />
            ) : events.length === 0 ? (
              <EmptyState variant="panel" icon={CalendarBlankIcon} title="Nothing scheduled today" />
            ) : (
              <AgendaList
                occurrences={events}
                onOpen={(occ) => setEditor({ kind: "occurrence", occ })}
                bare
                now={isToday ? now : undefined}
                scrollToNow
              />
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
