"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRightIcon,
  CalendarBlankIcon,
  ChartBarIcon,
  ForkKnifeIcon,
  ListChecksIcon,
  type Icon,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { onEventsChanged, onTasksChanged } from "@/lib/events";
import { addDaysIso, todayIso } from "@/lib/format";
import { fmtKcal } from "@/lib/nutrition";
import { isTaskDone, type Task } from "@/lib/types";
import { CARD } from "@/lib/ui";
import { ErrorState, TaskList, TaskListSkeleton } from "@/components/PageParts";
import CoverBand from "@/components/dashboard/CoverBand";
import AgendaList from "@/components/events/AgendaList";
import EventEditor, { type EditorTarget } from "@/components/events/EventEditor";
import MacroSummary from "@/components/nutrition/MacroSummary";
import TargetsModal from "@/components/nutrition/TargetsModal";
import WeekChart from "@/components/nutrition/WeekChart";

const MAX_DUE = 6;

/** Loads one card's data independently, so a failing endpoint only
 * affects its own card. Keeps the previous data while reloading. */
function useCard<T>(load: () => Promise<T>, version: number) {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) setState({ data, error: null });
      })
      .catch((e) => {
        if (!cancelled) setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : "Couldn't load" }));
      });
    return () => {
      cancelled = true;
    };
    // `load` is a new closure every render; version and attempt drive reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, attempt]);
  return { ...state, retry: () => setAttempt((a) => a + 1) };
}

function CardHeader({ title, icon: HeaderIcon, href, link }: { title: string; icon: Icon; href?: string; link?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1 pb-2">
      <h2 className="flex items-center gap-2 text-[13px] font-medium text-fg-muted">
        <HeaderIcon weight="bold" className="h-4 w-4 text-accent" aria-hidden />
        {title}
      </h2>
      {href && link && (
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-xs font-medium text-accent-text underline-offset-4 hover:underline"
        >
          {link}
          <ArrowRightIcon className="h-3 w-3" aria-hidden />
        </Link>
      )}
    </div>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className={`${CARD} px-4 py-6 text-center text-sm text-fg-faint`}>{children}</p>;
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div>
      <div className="font-mono text-2xl font-medium tabular-nums tracking-tight text-fg">{value}</div>
      <div className="mt-0.5 text-xs text-fg-muted">{label}</div>
    </div>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [version, setVersion] = useState(0);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [editingTargets, setEditingTargets] = useState(false);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const offTasks = onTasksChanged(bump);
    const offEvents = onEventsChanged(bump);
    return () => {
      offTasks();
      offEvents();
    };
  }, []);

  const today = todayIso();
  const todayView = useCard(() => api.getToday(), version);
  const schedule = useCard(() => api.getSchedule(today, today).then((s) => s.occurrences), version);
  const nextWeek = useCard(() => api.getSchedule(today, addDaysIso(today, 6)).then((s) => s.count), version);
  const nutrition = useCard(() => api.getNutritionDay(today), version);
  const history = useCard(() => api.getNutritionHistory(addDaysIso(today, -6), today), version);
  const week = useCard(() => api.getWeekSummary(), version);

  const due: Task[] = (() => {
    if (!todayView.data) return [];
    const seen = new Set<string>();
    const out: Task[] = [];
    for (const t of [...todayView.data.overdue, ...todayView.data.due_today]) {
      if (seen.has(t.id) || isTaskDone(t)) continue;
      seen.add(t.id);
      out.push(t);
    }
    return out;
  })();

  const summaryParts: string[] = [];
  if (schedule.data) summaryParts.push(plural(schedule.data.length, "event"));
  if (todayView.data) summaryParts.push(`${plural(due.length, "task")} due`);
  if (nutrition.data?.remaining) {
    const left = nutrition.data.remaining.calories;
    summaryParts.push(left >= 0 ? `${fmtKcal(left)} kcal left` : `${fmtKcal(-left)} kcal over`);
  }
  const bandDate = todayView.data?.date ?? nutrition.data?.day ?? null;

  const refresh = () => setVersion((v) => v + 1);

  return (
    <div className="space-y-8">
      <CoverBand date={bandDate} summary={summaryParts.length ? summaryParts.join(", ") : null} />

      <div className="grid gap-x-6 gap-y-8 md:grid-cols-2">
        <section aria-label="Schedule today" className="min-w-0">
          <CardHeader title="Schedule today" icon={CalendarBlankIcon} href="/calendar" link="Calendar" />
          {schedule.error && !schedule.data ? (
            <ErrorState message={schedule.error} onRetry={schedule.retry} />
          ) : !schedule.data ? (
            <TaskListSkeleton rows={2} />
          ) : schedule.data.length === 0 ? (
            <Quiet>Nothing scheduled today.</Quiet>
          ) : (
            <AgendaList occurrences={schedule.data} onOpen={(occ) => setEditor({ kind: "occurrence", occ })} />
          )}
        </section>

        <section aria-label="Due and overdue" className="min-w-0">
          <CardHeader title="Due and overdue" icon={ListChecksIcon} href="/today" link="Today" />
          {todayView.error && !todayView.data ? (
            <ErrorState message={todayView.error} onRetry={todayView.retry} />
          ) : !todayView.data ? (
            <TaskListSkeleton rows={3} />
          ) : due.length === 0 ? (
            <Quiet>Nothing due. Nice.</Quiet>
          ) : (
            <>
              <TaskList tasks={due.slice(0, MAX_DUE)} onUpdated={refresh} onDeleted={refresh} />
              {due.length > MAX_DUE && (
                <p className="px-1 pt-2 text-xs text-fg-muted">
                  {due.length - MAX_DUE} more on{" "}
                  <Link href="/today" className="font-medium text-accent-text underline-offset-4 hover:underline">
                    Today
                  </Link>
                </p>
              )}
            </>
          )}
        </section>

        <section aria-label="Nutrition today" className="min-w-0">
          <CardHeader title="Nutrition today" icon={ForkKnifeIcon} href="/nutrition" link="Food log" />
          {nutrition.error && !nutrition.data ? (
            <ErrorState message={nutrition.error} onRetry={nutrition.retry} />
          ) : !nutrition.data ? (
            <div className={`shimmer h-40 ${CARD}`} />
          ) : (
            <MacroSummary summary={nutrition.data} onSetTargets={() => setEditingTargets(true)} />
          )}
        </section>

        <section aria-label="This week" className="min-w-0">
          <CardHeader title="This week" icon={ChartBarIcon} href="/completed" link="Completed" />
          <div className={`${CARD} p-5`}>
            <dl className="grid grid-cols-3 gap-4">
              <Stat value={week.data ? week.data.completed_count : "-"} label="Tasks done" />
              <Stat value={nextWeek.data ?? "-"} label="Events, next 7 days" />
              <Stat
                value={history.data?.averages ? fmtKcal(history.data.averages.calories) : "-"}
                label="Avg kcal a day"
              />
            </dl>
            {history.data && (
              <div className="mt-6 pt-6">
                <WeekChart
                  days={history.data.days}
                  selected={today}
                  onSelect={(iso) => router.push(iso === today ? "/nutrition" : `/nutrition?date=${iso}`)}
                />
              </div>
            )}
            {(week.error || history.error || nextWeek.error) && (
              <p className="mt-4 text-xs text-danger">
                Some numbers couldn&apos;t load.{" "}
                <button
                  type="button"
                  onClick={() => {
                    week.retry();
                    history.retry();
                    nextWeek.retry();
                  }}
                  className="font-medium underline underline-offset-4"
                >
                  Retry
                </button>
              </p>
            )}
          </div>
        </section>
      </div>

      {editor && <EventEditor target={editor} onClose={() => setEditor(null)} />}
      {editingTargets && (
        <TargetsModal
          current={nutrition.data?.targets ?? null}
          onClose={() => setEditingTargets(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
