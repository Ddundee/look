"use client";

// The widget bodies. Each loads its own data (so one failing endpoint only
// affects its own widget) and refreshes when tasks or events change. The
// frame around them (title, edit controls) is WidgetShell.
import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FireIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { compactTime } from "@/lib/calendarEvents";
import { notifyTasksChanged, onEventsChanged, onTasksChanged } from "@/lib/events";
import { addDaysIso, formatDateLong, todayIso } from "@/lib/format";
import { fmtGrams, fmtKcal, MACRO_LABEL, MACROS } from "@/lib/nutrition";
import type { DaySummary, MacroKey, Occurrence } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { weekRangeIso } from "@/lib/week";
import QuickAddBar from "@/components/QuickAddBar";
import WorkList from "@/components/WorkList";
import AgendaList from "@/components/events/AgendaList";
import { ItemEdge, useLook } from "@/components/look/Look";
import TargetsModal from "@/components/nutrition/TargetsModal";
import WeekChart from "@/components/nutrition/WeekChart";
import { useWidgetCount, WidgetEmpty, WidgetError, WidgetLoading } from "./WidgetShell";

/** What widgets need from the page they're on. */
export const ViewContext = createContext<{ openEvent: (occ: Occurrence) => void }>({ openEvent: () => {} });

export interface WidgetProps {
  config: Record<string, unknown>;
}

/** Bumps whenever tasks or events change anywhere in the app. */
function useDataVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const offTasks = onTasksChanged(bump);
    const offEvents = onEventsChanged(bump);
    return () => {
      offTasks();
      offEvents();
    };
  }, []);
  return version;
}

/** Loads data for a widget, keeping the last good data while reloading. */
function useLive<T>(load: () => Promise<T>, deps: unknown[]) {
  const version = useDataVersion();
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
    // `load` is a new closure every render; the deps listed drive reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, attempt, ...deps]);
  return { ...state, retry: () => setAttempt((a) => a + 1) };
}

/** Today's date in the app timezone once known, else the browser's. */
function useToday(): string {
  const now = useNow();
  return now ? now.slice(0, 10) : todayIso();
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// ---- Quick add ------------------------------------------------------------------

export function QuickAddWidget() {
  return (
    <div className="flex h-full flex-col justify-center">
      <QuickAddBar onCreated={() => notifyTasksChanged()} />
    </div>
  );
}

// ---- Things to do ---------------------------------------------------------------

export function ThingsToDoWidget({ config }: WidgetProps) {
  const { openEvent } = useContext(ViewContext);
  const work = useLive(() => api.getWorkPlan(), []);
  useWidgetCount(work.data?.remaining);
  if (work.error && !work.data) return <WidgetError message={work.error} onRetry={work.retry} />;
  if (!work.data) return <WidgetLoading />;
  const showDone = config.show_done !== false;
  const undatedLimit = typeof config.undated_limit === "number" ? config.undated_limit : 6;
  const plan = {
    ...work.data,
    today: showDone ? work.data.today : work.data.today.filter((i) => !i.done),
    undated: work.data.undated.slice(0, undatedLimit),
    undated_total: undatedLimit === 0 ? 0 : work.data.undated_total,
  };
  if (plan.overdue.length + plan.today.length + plan.undated.length === 0) return <WidgetEmpty>Nothing to do. Nice.</WidgetEmpty>;
  return (
    <div className="-mx-3">
      <WorkList plan={plan} onChanged={work.retry} onOpenAssignment={openEvent} />
    </div>
  );
}

// ---- Schedule -------------------------------------------------------------------

export function ScheduleWidget({ config }: WidgetProps) {
  const { openEvent } = useContext(ViewContext);
  const day = useToday();
  const now = useNow();
  const schedule = useLive(() => api.getSchedule(day, day).then((s) => s.occurrences), [day]);
  const includeAssignments = config.include_assignments === true;
  const events = (schedule.data ?? []).filter((o) => includeAssignments || !(o.deadline && !o.cancelled));
  useWidgetCount(schedule.data ? events.length : null);
  if (schedule.error && !schedule.data) return <WidgetError message={schedule.error} onRetry={schedule.retry} />;
  if (!schedule.data) return <WidgetLoading />;
  if (events.length === 0) return <WidgetEmpty>Nothing scheduled today.</WidgetEmpty>;
  return (
    <div className="-mx-2">
      <AgendaList occurrences={events} onOpen={openEvent} bare now={now && now.slice(0, 10) === day ? now : undefined} scrollToNow />
    </div>
  );
}

// ---- Upcoming assignments ---------------------------------------------------------

export function UpcomingAssignmentsWidget({ config }: WidgetProps) {
  const { openEvent } = useContext(ViewContext);
  const days = typeof config.days === "number" ? config.days : 7;
  const today = useToday();
  const start = addDaysIso(today, 1);
  const end = addDaysIso(today, days);
  const data = useLive(() => api.getSchedule(start, end).then((s) => s.occurrences), [start, end]);
  const due = (data.data ?? []).filter((o) => o.deadline && !o.completed && !o.cancelled);
  useWidgetCount(data.data ? due.length : null);
  if (data.error && !data.data) return <WidgetError message={data.error} onRetry={data.retry} />;
  if (!data.data) return <WidgetLoading />;
  if (due.length === 0) return <WidgetEmpty>Nothing due in the next {plural(days, "day")}.</WidgetEmpty>;
  const byDay = new Map<string, Occurrence[]>();
  for (const o of due) byDay.set(o.start_at.slice(0, 10), [...(byDay.get(o.start_at.slice(0, 10)) ?? []), o]);
  return (
    <div className="-mx-2 space-y-2">
      {[...byDay.entries()].map(([d, items]) => (
        <section key={d}>
          <h3 className="px-3 pb-0.5 text-xs font-medium text-fg-muted">{formatDateLong(d)}</h3>
          <AgendaList occurrences={items} onOpen={openEvent} bare />
        </section>
      ))}
    </div>
  );
}

// ---- Next 7 days ------------------------------------------------------------------

const MAX_DAY_EVENTS = 3;

function DayChipEdge({ occ }: { occ: Occurrence }) {
  return <ItemEdge look={useLook(occ)} />;
}

export function WeekPreviewWidget() {
  const today = useToday();
  const weekEnd = addDaysIso(today, 6);
  const events = useLive(() => api.getSchedule(today, weekEnd).then((s) => s.occurrences), [today]);
  const tasks = useLive(
    () => api.listTasks({ due_after: today, due_before: weekEnd, include_completed: false }).then((r) => r.tasks),
    [today]
  );
  if ((events.error && !events.data) || (tasks.error && !tasks.data)) {
    return (
      <WidgetError
        message={events.error ?? tasks.error ?? "Couldn't load"}
        onRetry={() => {
          events.retry();
          tasks.retry();
        }}
      />
    );
  }
  if (!events.data || !tasks.data) return <WidgetLoading rows={2} />;
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(today, i));
  return (
    <ol className="grid h-full grid-cols-7 gap-1.5">
      {days.map((d) => {
        const [y, m, dd] = d.split("-").map(Number);
        const date = new Date(y, m - 1, dd);
        const dayEvents = events.data!.filter((o) => o.start_at.slice(0, 10) <= d && o.end_at.slice(0, 10) >= d);
        const dayTasks = tasks.data!.filter((t) => t.due_date === d);
        const isToday = d === today;
        return (
          <li key={d} className="min-w-0">
            <Link
              href="/calendar"
              aria-label={`${formatDateLong(d)}: ${plural(dayEvents.length, "event")}, ${plural(dayTasks.length, "task")} due`}
              className={`flex h-full min-h-24 flex-col gap-1 overflow-hidden rounded-xl p-2 transition-colors duration-150 ${
                isToday ? "bg-accent-soft" : "bg-surface-2/60 hover:bg-surface-2"
              }`}
            >
              <span className={`text-[11px] font-medium ${isToday ? "text-accent-text" : "text-fg-muted"}`}>
                {date.toLocaleDateString(undefined, { weekday: "short" })} <span className="font-mono tabular-nums">{dd}</span>
              </span>
              {dayEvents.slice(0, MAX_DAY_EVENTS).map((o) => (
                <span key={`${o.event_id}-${o.occurrence_date}`} className="flex gap-1.5 rounded-md bg-surface/70 px-1.5 py-1 text-[11px] leading-4">
                  <DayChipEdge occ={o} />
                  <span className="min-w-0">
                    <span className="block font-mono text-fg-muted">{o.all_day ? "All day" : compactTime(o.start_at)}</span>
                    <span className="line-clamp-2 text-fg [overflow-wrap:anywhere]">{o.title}</span>
                  </span>
                </span>
              ))}
              {dayEvents.length > MAX_DAY_EVENTS && <span className="text-[11px] text-fg-faint">+{dayEvents.length - MAX_DAY_EVENTS} more</span>}
              {dayTasks.length > 0 && <span className="mt-auto text-[11px] font-medium text-fg-muted">{plural(dayTasks.length, "task")} due</span>}
              {dayEvents.length === 0 && dayTasks.length === 0 && <span className="mt-auto text-[11px] text-fg-faint">Free</span>}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

// ---- Calories today -----------------------------------------------------------------

function Bar({ value, goal, over, thick }: { value: number; goal: number; over: boolean; thick?: boolean }) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
  return (
    <span className={`relative block overflow-hidden rounded-full bg-surface-2 ${thick ? "h-2.5" : "h-1.5"}`}>
      <span
        className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out ${over ? "bg-warn" : "bg-accent"}`}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

function CaloriesBody({ summary, onSetTargets }: { summary: DaySummary; onSetTargets: () => void }) {
  const { totals, targets, remaining, over } = summary;
  const isOver = (k: MacroKey) => over.includes(k);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-3xl font-medium tabular-nums tracking-tight text-fg">{fmtKcal(totals.calories)}</span>
        <span className="text-sm text-fg-muted">kcal</span>
      </div>
      {targets && remaining ? (
        <>
          <p className={`mt-0.5 text-xs ${isOver("calories") ? "font-medium text-warn" : "text-fg-muted"}`}>
            <span className="font-mono tabular-nums">{fmtKcal(Math.abs(remaining.calories))}</span> {isOver("calories") ? "over" : "left"} of{" "}
            {fmtKcal(targets.calories)}
          </p>
          <div className="mt-3">
            <Bar value={totals.calories} goal={targets.calories} over={isOver("calories")} thick />
          </div>
        </>
      ) : (
        <button type="button" onClick={onSetTargets} className="mt-1 self-start text-xs font-medium text-accent-text underline underline-offset-4">
          Set daily targets
        </button>
      )}
      <dl className="mt-auto space-y-2.5 pt-4">
        {MACROS.map((m) => {
          const goal = targets?.[m] ?? null;
          return (
            <div key={m}>
              <div className="flex items-baseline justify-between text-xs">
                <dt className="text-fg-muted">{MACRO_LABEL[m]}</dt>
                <dd className={`font-mono tabular-nums ${isOver(m) ? "text-warn" : "text-fg"}`}>
                  {fmtGrams(totals[m])}
                  {goal !== null && <span className="text-fg-faint"> / {fmtGrams(goal)}</span>}
                  {isOver(m) && <span className="ml-1 font-sans font-medium">over</span>}
                </dd>
              </div>
              {goal !== null && (
                <div className="mt-1">
                  <Bar value={totals[m]} goal={goal} over={isOver(m)} />
                </div>
              )}
            </div>
          );
        })}
      </dl>
    </div>
  );
}

export function NutritionSummaryWidget() {
  const today = useToday();
  const nutrition = useLive(() => api.getNutritionDay(today), [today]);
  const [editingTargets, setEditingTargets] = useState(false);
  if (nutrition.error && !nutrition.data) return <WidgetError message={nutrition.error} onRetry={nutrition.retry} />;
  if (!nutrition.data) return <WidgetLoading />;
  return (
    <>
      <CaloriesBody summary={nutrition.data} onSetTargets={() => setEditingTargets(true)} />
      {editingTargets && (
        <TargetsModal current={nutrition.data.targets ?? null} onClose={() => setEditingTargets(false)} onSaved={nutrition.retry} />
      )}
    </>
  );
}

// ---- This week ----------------------------------------------------------------------

export function WeekStatsWidget() {
  const router = useRouter();
  const today = useToday();
  const thisWeek = weekRangeIso(today);
  const week = useLive(() => api.getWeekSummary(), []);
  const events = useLive(() => api.getSchedule(today, addDaysIso(today, 6)).then((s) => s.occurrences.length), [today]);
  const history = useLive(() => api.getNutritionHistory(thisWeek.start, thisWeek.end), [thisWeek.start]);
  return (
    <div className="flex h-full flex-col">
      <dl className="grid grid-cols-3 gap-2">
        {[
          { label: "Tasks done", value: week.data?.completed_count },
          { label: "Events ahead", value: events.data ?? undefined },
          { label: "Avg kcal", value: history.data?.averages ? fmtKcal(history.data.averages.calories) : history.data ? "-" : undefined },
        ].map((s) => (
          <div key={s.label}>
            <dd className="font-mono text-xl font-medium tabular-nums tracking-tight text-fg">
              {s.value ?? <span className="shimmer inline-block h-5 w-8 rounded" />}
            </dd>
            <dt className="mt-0.5 text-xs text-fg-muted">{s.label}</dt>
          </div>
        ))}
      </dl>
      {history.data && (
        <div className="mt-auto hidden pt-6 sm:block">
          <WeekChart
            days={history.data.days}
            selected={today}
            lastSelectable={today}
            onSelect={(iso) => router.push(iso === today ? "/nutrition" : `/nutrition?date=${iso}`)}
          />
        </div>
      )}
      {(week.error || history.error || events.error) && (
        <p className="mt-2 text-xs text-danger">
          Some numbers couldn&apos;t load.{" "}
          <button
            type="button"
            onClick={() => {
              week.retry();
              history.retry();
              events.retry();
            }}
            className="font-medium underline underline-offset-4"
          >
            Retry
          </button>
        </p>
      )}
    </div>
  );
}

// ---- LeetCode -------------------------------------------------------------------------

export function LeetCodeSummaryWidget() {
  const stats = useLive(() => api.getLeetCodeStats(), []);
  if (stats.error && !stats.data) return <WidgetError message={stats.error} onRetry={stats.retry} />;
  if (!stats.data) return <WidgetLoading rows={1} />;
  const s = stats.data;
  if (s.total_attempts === 0) return <WidgetEmpty>Nothing logged yet.</WidgetEmpty>;
  return (
    <dl className="grid h-full grid-cols-3 items-center gap-2">
      <div>
        <dd className="font-mono text-xl font-medium tabular-nums text-fg">
          {s.solved_today}/{s.goals.daily_target}
        </dd>
        <dt className="text-xs text-fg-muted">Today</dt>
      </div>
      <div>
        <dd className="font-mono text-xl font-medium tabular-nums text-fg">
          {s.solved_this_week}/{s.goals.weekly_target}
        </dd>
        <dt className="text-xs text-fg-muted">This week</dt>
      </div>
      <div>
        <dd className="inline-flex items-center gap-1 font-mono text-xl font-medium tabular-nums text-fg">
          {s.current_streak}
          {s.current_streak > 0 && <FireIcon weight="fill" className="h-4 w-4 text-warn" aria-hidden />}
        </dd>
        <dt className="text-xs text-fg-muted">Day streak</dt>
      </div>
    </dl>
  );
}
