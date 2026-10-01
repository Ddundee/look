"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarBlankIcon, CaretLeftIcon, CaretRightIcon, CheckIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { onTasksChanged } from "@/lib/events";
import { categoryHue, formatDateLong, todayIso } from "@/lib/format";
import { isTaskDone, type Task } from "@/lib/types";
import { BUTTON_SECONDARY, CARD, ICON_BUTTON } from "@/lib/ui";
import { PageHeader, TaskList } from "@/components/PageParts";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() }; // month is 0-indexed
  });
  const [selected, setSelected] = useState<string>(() => todayIso());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const rangeStart = `${cursor.year}-${pad(cursor.month + 1)}-01`;
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const rangeEnd = `${cursor.year}-${pad(cursor.month + 1)}-${pad(daysInMonth)}`;

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .listTasks({ due_after: rangeStart, due_before: rangeEnd })
        .then((r) => {
          if (!cancelled) setTasks(r.tasks);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    load();
    const unsubscribe = onTasksChanged(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [rangeStart, rangeEnd]);

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.due_date) continue;
      if (!map.has(t.due_date)) map.set(t.due_date, []);
      map.get(t.due_date)!.push(t);
    }
    return map;
  }, [tasks]);

  const firstWeekday = new Date(cursor.year, cursor.month, 1).getDay(); // 0=Sun
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const today = todayIso();
  const viewingCurrentMonth = today.startsWith(`${cursor.year}-${pad(cursor.month + 1)}`);

  function goTo(year: number, month: number) {
    const d = new Date(year, month, 1);
    const next = { year: d.getFullYear(), month: d.getMonth() };
    setCursor(next);
    const prefix = `${next.year}-${pad(next.month + 1)}`;
    setSelected(today.startsWith(prefix) ? today : `${prefix}-01`);
  }

  const selectedTasks = byDay.get(selected) ?? [];

  function onUpdated(updated: Task) {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }
  function onDeleted(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div>
      <PageHeader
        title={monthLabel}
        actions={
          <>
            {!viewingCurrentMonth && (
              <button
                onClick={() => {
                  const now = new Date();
                  goTo(now.getFullYear(), now.getMonth());
                }}
                className={`h-8 py-0 text-[13px] ${BUTTON_SECONDARY}`}
              >
                Today
              </button>
            )}
            <div className="flex items-center rounded-lg border border-line">
              <button
                onClick={() => goTo(cursor.year, cursor.month - 1)}
                aria-label="Previous month"
                className={ICON_BUTTON}
              >
                <CaretLeftIcon className="h-4 w-4" aria-hidden />
              </button>
              <button
                onClick={() => goTo(cursor.year, cursor.month + 1)}
                aria-label="Next month"
                className={ICON_BUTTON}
              >
                <CaretRightIcon className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </>
        }
      />

      <div className={`overflow-hidden ${CARD} ${loading ? "opacity-60" : ""} transition-opacity`}>
        <div className="grid grid-cols-7 border-b border-line">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2 text-center text-xs font-medium text-fg-faint">
              <span className="sm:hidden">{d[0]}</span>
              <span className="hidden sm:inline">{d}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 [&>*:nth-child(7n)]:border-r-0">
          {cells.map((day, idx) => {
            const iso = day ? `${cursor.year}-${pad(cursor.month + 1)}-${pad(day)}` : null;
            const dayTasks = iso ? (byDay.get(iso) ?? []) : [];
            const isToday = iso === today;
            const isSelected = iso === selected;
            const openCount = dayTasks.filter((t) => !isTaskDone(t)).length;
            const lastRow = idx >= cells.length - 7;

            if (!day || !iso) {
              return (
                <div
                  key={idx}
                  className={`min-h-16 border-r border-line bg-surface-2/40 sm:min-h-24 ${lastRow ? "" : "border-b"}`}
                />
              );
            }

            return (
              <button
                key={idx}
                onClick={() => setSelected(iso)}
                aria-pressed={isSelected}
                aria-label={`${formatDateLong(iso)}, ${dayTasks.length} task${dayTasks.length === 1 ? "" : "s"}`}
                className={`group relative flex min-h-16 flex-col items-stretch gap-1 border-r border-line p-1.5 text-left transition-colors duration-150 sm:min-h-24 ${
                  lastRow ? "" : "border-b"
                } ${isSelected ? "bg-accent-soft" : "hover:bg-surface-2/70"}`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center self-start rounded-full font-mono text-xs tabular-nums ${
                    isToday
                      ? "bg-accent font-semibold text-accent-fg"
                      : isSelected
                        ? "font-semibold text-accent-text"
                        : "text-fg-muted"
                  }`}
                >
                  {day}
                </span>

                {/* Small screens: one marker per day with a count. */}
                {dayTasks.length > 0 && (
                  <span className="mx-auto font-mono text-[11px] tabular-nums text-fg-muted sm:hidden">
                    {openCount > 0 ? openCount : <CheckIcon weight="bold" className="mx-auto h-3 w-3 text-accent" aria-hidden />}
                  </span>
                )}

                {/* Larger screens: titles. */}
                <span className="hidden space-y-0.5 sm:block">
                  {dayTasks.slice(0, 3).map((t) => (
                    <span
                      key={t.id}
                      className={`flex items-center gap-1 truncate rounded px-1 py-px text-[11px] leading-4 ${
                        isTaskDone(t) ? "text-fg-faint line-through" : "bg-surface-2 text-fg"
                      }`}
                    >
                      <span className={`shrink-0 font-semibold ${categoryHue(t.category)}`} aria-hidden>
                        #
                      </span>
                      <span className="truncate">{t.title}</span>
                    </span>
                  ))}
                  {dayTasks.length > 3 && (
                    <span className="block px-1 text-[11px] text-fg-faint">+{dayTasks.length - 3} more</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section className="mt-8" aria-live="polite">
        <h2 className="flex items-center gap-2 px-1 pb-2 text-[13px] font-medium text-fg-muted">
          <CalendarBlankIcon weight="bold" className="h-4 w-4 text-fg-faint" aria-hidden />
          {formatDateLong(selected)}
        </h2>
        {selectedTasks.length > 0 ? (
          <TaskList key={selected} tasks={selectedTasks} onUpdated={onUpdated} onDeleted={onDeleted} />
        ) : (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-fg-faint">
            Nothing due this day.
          </p>
        )}
      </section>
    </div>
  );
}
