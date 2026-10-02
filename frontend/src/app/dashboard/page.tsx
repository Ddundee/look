"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRightIcon,
  CalendarBlankIcon,
  CalendarDotsIcon,
  ChartBarIcon,
  ForkKnifeIcon,
  ListChecksIcon,
  MapPinIcon,
  type Icon,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { compactTime, eventHue, timeLabel } from "@/lib/calendarEvents";
import { notifyTasksChanged, onEventsChanged, onTasksChanged } from "@/lib/events";
import { addDaysIso, formatDateLong, todayIso } from "@/lib/format";
import { fmtGrams, fmtKcal, MACRO_LABEL, MACROS } from "@/lib/nutrition";
import { isTaskDone, type DaySummary, type MacroKey, type Occurrence, type Task } from "@/lib/types";
import QuickAddBar from "@/components/QuickAddBar";
import TaskRow from "@/components/TaskRow";
import EventEditor, { type EditorTarget } from "@/components/events/EventEditor";
import TargetsModal from "@/components/nutrition/TargetsModal";
import WeekChart from "@/components/nutrition/WeekChart";

const MAX_EVENTS = 5;
const MAX_DUE = 5;
const MAX_DAY_EVENTS = 3;

/** Loads one tile's data independently, so a failing endpoint only
 * affects its own tile. Keeps the previous data while reloading. */
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

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** A bento tile: header row plus a body that never grows the page. */
function Tile({
  title,
  icon: TileIcon,
  href,
  link,
  className = "",
  children,
}: {
  title: string;
  icon: Icon;
  href?: string;
  link?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl bg-surface p-4 elev-1 ${className}`}
    >
      <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[13px] font-medium text-fg-muted">
          <TileIcon weight="bold" className="h-4 w-4 text-accent" aria-hidden />
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
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function TileError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex h-full flex-col items-start justify-center gap-2 text-sm text-danger">
      <span>{message}</span>
      <button type="button" onClick={onRetry} className="font-medium underline underline-offset-4">
        Retry
      </button>
    </div>
  );
}

function TileSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="shimmer block h-9 rounded-lg" style={{ width: `${92 - i * 12}%` }} />
      ))}
    </div>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="flex h-full items-center justify-center text-center text-sm text-fg-faint">{children}</p>;
}

function More({ count, href, label }: { count: number; href: string; label: string }) {
  if (count <= 0) return null;
  return (
    <Link href={href} className="mt-1 block px-1 text-xs font-medium text-accent-text underline-offset-4 hover:underline">
      +{count} more {label}
    </Link>
  );
}

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

/** Compact calories + macros for a narrow tile. */
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
            <span className="font-mono tabular-nums">{fmtKcal(Math.abs(remaining.calories))}</span>{" "}
            {isOver("calories") ? "over" : "left"} of {fmtKcal(targets.calories)}
          </p>
          <div className="mt-3">
            <Bar value={totals.calories} goal={targets.calories} over={isOver("calories")} thick />
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={onSetTargets}
          className="mt-1 self-start text-xs font-medium text-accent-text underline underline-offset-4"
        >
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

function ScheduleRow({ occ, onOpen }: { occ: Occurrence; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-surface-2/70"
      >
        <span className="w-16 shrink-0 font-mono text-xs leading-5 tabular-nums text-fg-muted">
          {occ.all_day ? "All day" : timeLabel(occ.start_at)}
        </span>
        <span className={`mt-0.5 w-0.5 shrink-0 self-stretch rounded-full bg-current ${eventHue(occ.category)}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm leading-5 ${occ.completed ? "text-fg-faint line-through" : "text-fg"}`}>
            {occ.title}
          </span>
          {occ.location && (
            <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-fg-muted">
              <MapPinIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {occ.location}
            </span>
          )}
        </span>
      </button>
    </li>
  );
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
  const weekEnd = addDaysIso(today, 6);
  const todayView = useCard(() => api.getToday(), version);
  const upcoming = useCard(() => api.getSchedule(today, weekEnd).then((s) => s.occurrences), version);
  const dueSoon = useCard(
    () => api.listTasks({ due_after: today, due_before: weekEnd, include_completed: false }).then((r) => r.tasks),
    version
  );
  const nutrition = useCard(() => api.getNutritionDay(today), version);
  const history = useCard(() => api.getNutritionHistory(addDaysIso(today, -6), today), version);
  const week = useCard(() => api.getWeekSummary(), version);

  const refresh = () => setVersion((v) => v + 1);

  const todayEvents = (upcoming.data ?? []).filter((o) => o.start_at.slice(0, 10) <= today && o.end_at.slice(0, 10) >= today);
  const eventsNextWeek = upcoming.data?.length ?? null;

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

  const summary: string[] = [];
  if (upcoming.data) summary.push(plural(todayEvents.length, "event"));
  if (todayView.data) summary.push(`${due.length} due`);
  if (nutrition.data?.remaining) {
    const left = nutrition.data.remaining.calories;
    summary.push(left >= 0 ? `${fmtKcal(left)} kcal left` : `${fmtKcal(-left)} kcal over`);
  }
  // The greeting uses the client clock, so it renders only once data has
  // arrived on the client; server and client markup stay identical.
  const headerDate = todayView.data?.date ?? null;

  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(today, i));

  return (
    <div className="grid gap-4 md:h-full md:min-h-[600px] md:grid-cols-12 md:grid-rows-6">
      {/* Header + quick add */}
      <section
        aria-label="Overview"
        className="flex min-w-0 flex-col justify-between gap-4 rounded-2xl bg-surface p-5 elev-1 md:col-span-6 md:row-span-2"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">{headerDate ? greeting() : "Dashboard"}</h1>
            <p className="mt-1 text-sm text-fg-muted">{summary.length ? summary.join(", ") : "\u00a0"}</p>
          </div>
          {headerDate && <p className="text-sm text-fg-muted">{formatDateLong(headerDate)}</p>}
        </div>
        <QuickAddBar onCreated={() => notifyTasksChanged()} />
      </section>

      {/* Calories */}
      <Tile title="Calories today" icon={ForkKnifeIcon} href="/nutrition" link="Food log" className="order-3 md:order-none md:col-span-3 md:row-span-3">
        {nutrition.error && !nutrition.data ? (
          <TileError message={nutrition.error} onRetry={nutrition.retry} />
        ) : !nutrition.data ? (
          <TileSkeleton />
        ) : (
          <CaloriesBody summary={nutrition.data} onSetTargets={() => setEditingTargets(true)} />
        )}
      </Tile>

      {/* This week */}
      <Tile title="This week" icon={ChartBarIcon} href="/completed" link="Completed" className="order-4 md:order-none md:col-span-3 md:row-span-3">
        <div className="flex h-full flex-col">
          <dl className="grid grid-cols-3 gap-2 md:grid-cols-1 md:gap-1.5 lg:grid-cols-3 lg:gap-2">
            {[
              { label: "Tasks done", value: week.data?.completed_count },
              { label: "Events ahead", value: eventsNextWeek ?? undefined },
              {
                label: "Avg kcal",
                value: history.data?.averages ? fmtKcal(history.data.averages.calories) : history.data ? "-" : undefined,
              },
            ].map((s) => (
              <div key={s.label} className="flex items-baseline justify-between gap-2 lg:block">
                <dt className="order-2 text-xs text-fg-muted lg:mt-0.5">{s.label}</dt>
                <dd className="order-1 font-mono text-xl font-medium tabular-nums tracking-tight text-fg">
                  {s.value ?? <span className="shimmer inline-block h-5 w-8 rounded" />}
                </dd>
              </div>
            ))}
          </dl>
          {history.data && (
            <div className="mt-auto hidden pt-6 sm:block">
              <WeekChart
                days={history.data.days}
                selected={today}
                onSelect={(iso) => router.push(iso === today ? "/nutrition" : `/nutrition?date=${iso}`)}
              />
            </div>
          )}
          {(week.error || history.error) && (
            <p className="mt-2 text-xs text-danger">
              Some numbers couldn&apos;t load.{" "}
              <button
                type="button"
                onClick={() => {
                  week.retry();
                  history.retry();
                }}
                className="font-medium underline underline-offset-4"
              >
                Retry
              </button>
            </p>
          )}
        </div>
      </Tile>

      {/* Schedule today */}
      <Tile title="Schedule today" icon={CalendarBlankIcon} href="/calendar" link="Calendar" className="order-1 md:order-none md:col-span-3 md:row-span-4">
        {upcoming.error && !upcoming.data ? (
          <TileError message={upcoming.error} onRetry={upcoming.retry} />
        ) : !upcoming.data ? (
          <TileSkeleton />
        ) : todayEvents.length === 0 ? (
          <Quiet>Nothing scheduled today.</Quiet>
        ) : (
          <>
            <ul className="-mx-2 space-y-0.5">
              {todayEvents.slice(0, MAX_EVENTS).map((o) => (
                <ScheduleRow
                  key={`${o.event_id}-${o.occurrence_date}`}
                  occ={o}
                  onOpen={() => setEditor({ kind: "occurrence", occ: o })}
                />
              ))}
            </ul>
            <More count={todayEvents.length - MAX_EVENTS} href="/calendar" label="on the calendar" />
          </>
        )}
      </Tile>

      {/* Due and overdue */}
      <Tile title="Due and overdue" icon={ListChecksIcon} href="/today" link="Today" className="order-2 md:order-none md:col-span-3 md:row-span-4">
        {todayView.error && !todayView.data ? (
          <TileError message={todayView.error} onRetry={todayView.retry} />
        ) : !todayView.data ? (
          <TileSkeleton />
        ) : due.length === 0 ? (
          <Quiet>Nothing due. Nice.</Quiet>
        ) : (
          <>
            <ul className="-mx-3">
              {due.slice(0, MAX_DUE).map((t, i) => (
                <TaskRow key={t.id} task={t} index={i} onUpdated={refresh} onDeleted={refresh} />
              ))}
            </ul>
            <More count={due.length - MAX_DUE} href="/today" label="on Today" />
          </>
        )}
      </Tile>

      {/* Next 7 days */}
      <Tile title="Next 7 days" icon={CalendarDotsIcon} href="/calendar" link="Calendar" className="order-5 md:order-none md:col-span-6 md:row-span-3">
        {(upcoming.error && !upcoming.data) || (dueSoon.error && !dueSoon.data) ? (
          <TileError
            message={upcoming.error ?? dueSoon.error ?? "Couldn't load"}
            onRetry={() => {
              upcoming.retry();
              dueSoon.retry();
            }}
          />
        ) : !upcoming.data || !dueSoon.data ? (
          <TileSkeleton rows={2} />
        ) : (
          <ol className="grid h-full grid-cols-7 gap-1.5">
            {days.map((d) => {
              const [y, m, dd] = d.split("-").map(Number);
              const date = new Date(y, m - 1, dd);
              const dayEvents = upcoming.data!.filter(
                (o) => o.start_at.slice(0, 10) <= d && o.end_at.slice(0, 10) >= d
              );
              const dayTasks = dueSoon.data!.filter((t) => t.due_date === d);
              const isToday = d === today;
              return (
                <li key={d} className="min-w-0">
                  <Link
                    href="/calendar"
                    aria-label={`${formatDateLong(d)}: ${plural(dayEvents.length, "event")}, ${plural(dayTasks.length, "task")} due`}
                    className={`flex h-full min-h-0 flex-col gap-1 overflow-hidden rounded-xl p-2 transition-colors duration-150 ${
                      isToday ? "bg-accent-soft" : "bg-surface-2/60 hover:bg-surface-2"
                    }`}
                  >
                    <span className={`text-[11px] font-medium ${isToday ? "text-accent-text" : "text-fg-muted"}`}>
                      {date.toLocaleDateString(undefined, { weekday: "short" })}{" "}
                      <span className="font-mono tabular-nums">{dd}</span>
                    </span>
                    {dayEvents.slice(0, MAX_DAY_EVENTS).map((o) => (
                      <span
                        key={`${o.event_id}-${o.occurrence_date}`}
                        className="flex gap-1.5 rounded-md bg-surface/70 px-1.5 py-1 text-[11px] leading-4"
                      >
                        <span className={`w-0.5 shrink-0 rounded-full bg-current ${eventHue(o.category)}`} aria-hidden />
                        <span className="min-w-0">
                          <span className="block font-mono text-fg-muted">{o.all_day ? "All day" : compactTime(o.start_at)}</span>
                          <span className="line-clamp-2 text-fg [overflow-wrap:anywhere]">{o.title}</span>
                        </span>
                      </span>
                    ))}
                    {dayEvents.length > MAX_DAY_EVENTS && (
                      <span className="text-[11px] text-fg-faint">+{dayEvents.length - MAX_DAY_EVENTS} more</span>
                    )}
                    {dayTasks.length > 0 && (
                      <span className="mt-auto text-[11px] font-medium text-fg-muted">
                        {plural(dayTasks.length, "task")} due
                      </span>
                    )}
                    {dayEvents.length === 0 && dayTasks.length === 0 && (
                      <span className="mt-auto text-[11px] text-fg-faint">Free</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </Tile>

      {editor && <EventEditor target={editor} onClose={() => setEditor(null)} />}
      {editingTargets && (
        <TargetsModal current={nutrition.data?.targets ?? null} onClose={() => setEditingTargets(false)} onSaved={refresh} />
      )}
    </div>
  );
}
