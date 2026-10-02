"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarBlankIcon, CaretLeftIcon, CaretRightIcon, CheckIcon, GraduationCapIcon, PlusIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { compactTime } from "@/lib/calendarEvents";
import { lookVars, titleWithoutCourse } from "@/lib/palette";
import { useNow } from "@/lib/useNow";
import { useLook } from "@/components/look/Look";
import { onEventsChanged, onTasksChanged } from "@/lib/events";
import { addDaysIso, formatDateLong, todayIso } from "@/lib/format";
import { isTaskDone, type Occurrence, type Task } from "@/lib/types";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, ICON_BUTTON } from "@/lib/ui";

// Month-cell geometry (px), used to fit as many items as a cell can show:
// padding + day number + gap, and one item row.
const CELL_CHROME = 40;
const CELL_ITEM = 20;
import { EmptyState, Page, PageHeader, Panel, TaskList } from "@/components/PageParts";
import AgendaList from "@/components/events/AgendaList";
import EventEditor, { type EditorTarget } from "@/components/events/EventEditor";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local dates an occurrence covers (exclusive end, so an all-day event
 * ending at midnight doesn't spill into the next day). */
function coveredDays(o: Occurrence): string[] {
  const first = o.start_at.slice(0, 10);
  const last = isoOf(new Date(new Date(o.end_at).getTime() - 60_000));
  const out: string[] = [];
  for (let d = first; d <= last && out.length < 62; d = addDaysIso(d, 1)) out.push(d);
  return out.length ? out : [first];
}

/** An event in a month cell: tinted in its course/category look; school
 * items also get a cap icon, so color is never the only signal. */
function MonthEventChip({ occ: o }: { occ: Occurrence }) {
  const look = useLook(o);
  return (
    <span
      className="look-fill flex items-center gap-1 truncate rounded px-1 py-px text-[11px] leading-4 text-fg"
      data-style={look.style}
      style={lookVars(look)}
    >
      {look.kind === "course" && <GraduationCapIcon weight="fill" className="look-ink h-3 w-3 shrink-0" aria-label={look.label} />}
      {!o.all_day && <span className="shrink-0 font-mono text-fg-muted">{compactTime(o.start_at)}</span>}
      <span className={`truncate ${o.completed ? "text-fg-faint line-through" : ""}`}>{titleWithoutCourse(o.title, o.course)}</span>
    </span>
  );
}

function MonthTaskChip({ task: t }: { task: Task }) {
  const look = useLook({ category: t.category });
  return (
    <span
      className={`flex items-center gap-1 truncate rounded px-1 py-px text-[11px] leading-4 ${
        isTaskDone(t) ? "text-fg-faint line-through" : "text-fg-muted"
      }`}
      style={lookVars(look)}
    >
      <span className="look-ink shrink-0 font-semibold" aria-hidden>
        #
      </span>
      <span className="truncate">{t.title}</span>
    </span>
  );
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() }; // month is 0-indexed
  });
  const [selected, setSelected] = useState<string>(() => todayIso());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [occs, setOccs] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<EditorTarget | null>(null);

  const rangeStart = `${cursor.year}-${pad(cursor.month + 1)}-01`;
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const rangeEnd = `${cursor.year}-${pad(cursor.month + 1)}-${pad(daysInMonth)}`;

  useEffect(() => {
    let cancelled = false;
    function load() {
      Promise.all([
        api.listTasks({ due_after: rangeStart, due_before: rangeEnd }),
        api.getSchedule(rangeStart, rangeEnd, true),
      ])
        .then(([t, s]) => {
          if (cancelled) return;
          setTasks(t.tasks);
          setOccs(s.occurrences);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    load();
    const offTasks = onTasksChanged(load);
    const offEvents = onEventsChanged(load);
    return () => {
      cancelled = true;
      offTasks();
      offEvents();
    };
  }, [rangeStart, rangeEnd]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.due_date) continue;
      if (!map.has(t.due_date)) map.set(t.due_date, []);
      map.get(t.due_date)!.push(t);
    }
    return map;
  }, [tasks]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const o of occs) {
      for (const d of coveredDays(o)) {
        if (!map.has(d)) map.set(d, []);
        map.get(d)!.push(o);
      }
    }
    return map;
  }, [occs]);

  const firstWeekday = new Date(cursor.year, cursor.month, 1).getDay(); // 0=Sun
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  // On desktop the grid fills the page, so cells are as tall as the window
  // allows: show as many items as fit (more on a big screen) instead of a
  // fixed three. Smaller screens keep three and let cells grow.
  const gridRef = useRef<HTMLDivElement>(null);
  const [cellCap, setCellCap] = useState(3);
  const rowCount = cells.length / 7;
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const update = () => {
      if (!desktop.matches) return setCellCap(3);
      const cellHeight = el.clientHeight / rowCount;
      setCellCap(Math.max(1, Math.floor((cellHeight - CELL_CHROME) / CELL_ITEM)));
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    desktop.addEventListener("change", update);
    update();
    return () => {
      ro.disconnect();
      desktop.removeEventListener("change", update);
    };
  }, [rowCount]);

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const today = todayIso();
  const now = useNow();
  const viewingCurrentMonth = today.startsWith(`${cursor.year}-${pad(cursor.month + 1)}`);

  function goTo(year: number, month: number) {
    const d = new Date(year, month, 1);
    const next = { year: d.getFullYear(), month: d.getMonth() };
    setCursor(next);
    const prefix = `${next.year}-${pad(next.month + 1)}`;
    setSelected(today.startsWith(prefix) ? today : `${prefix}-01`);
  }

  const dayEvents = eventsByDay.get(selected) ?? [];
  const dayTasks = tasksByDay.get(selected) ?? [];

  function onUpdated(updated: Task) {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }
  function onDeleted(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <Page>
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
              <button onClick={() => goTo(cursor.year, cursor.month - 1)} aria-label="Previous month" className={ICON_BUTTON}>
                <CaretLeftIcon className="h-4 w-4" aria-hidden />
              </button>
              <button onClick={() => goTo(cursor.year, cursor.month + 1)} aria-label="Next month" className={ICON_BUTTON}>
                <CaretRightIcon className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <button onClick={() => setEditor({ kind: "new", date: selected })} className={`h-8 py-0 text-[13px] ${BUTTON_PRIMARY}`}>
              <PlusIcon weight="bold" className="h-4 w-4" aria-hidden />
              Add event
            </button>
          </>
        }
      />

      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className={`flex flex-col overflow-hidden lg:min-h-0 ${CARD} ${loading ? "opacity-60" : ""} transition-opacity`}>
          <div className="grid shrink-0 grid-cols-7 border-b border-line">
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} className="py-2 text-center text-xs font-medium text-fg-faint">
                <span className="sm:hidden">{d[0]}</span>
                <span className="hidden sm:inline">{d}</span>
              </div>
            ))}
          </div>
          <div ref={gridRef} className="grid grid-cols-7 lg:min-h-0 lg:flex-1 lg:auto-rows-fr [&>*:nth-child(7n)]:border-r-0">
            {cells.map((day, idx) => {
              const iso = day ? `${cursor.year}-${pad(cursor.month + 1)}-${pad(day)}` : null;
              const lastRow = idx >= cells.length - 7;

              if (!day || !iso) {
                return (
                  <div key={idx} className={`min-h-16 border-r border-line bg-surface-2/40 sm:min-h-24 lg:min-h-0 ${lastRow ? "" : "border-b"}`} />
                );
              }

              const cellEvents = (eventsByDay.get(iso) ?? []).filter((o) => !o.cancelled);
              const cellTasks = tasksByDay.get(iso) ?? [];
              const isToday = iso === today;
              const isSelected = iso === selected;
              const total = cellEvents.length + cellTasks.length;
              const openTasks = cellTasks.filter((t) => !isTaskDone(t)).length;
              // Leave a row for "+N more" when everything doesn't fit.
              const slots = total > cellCap ? Math.max(1, cellCap - 1) : cellCap;
              const shownEvents = cellEvents.slice(0, slots);
              const shownTasks = cellTasks.slice(0, Math.max(0, slots - shownEvents.length));
              const hidden = total - shownEvents.length - shownTasks.length;

              return (
                <button
                  key={idx}
                  onClick={() => setSelected(iso)}
                  aria-pressed={isSelected}
                  aria-label={`${formatDateLong(iso)}, ${cellEvents.length} event${cellEvents.length === 1 ? "" : "s"}, ${cellTasks.length} task${cellTasks.length === 1 ? "" : "s"}`}
                  className={`group relative flex min-h-16 flex-col items-stretch gap-1 overflow-hidden border-r border-line p-1.5 text-left transition-colors duration-150 sm:min-h-24 lg:min-h-0 ${
                    lastRow ? "" : "border-b"
                  } ${isSelected ? "bg-accent-soft" : "hover:bg-surface-2/70"}`}
                >
                  <span
                    className={`flex h-6 w-6 items-center justify-center self-start rounded-full font-mono text-xs tabular-nums ${
                      isToday ? "bg-accent font-semibold text-accent-fg" : isSelected ? "font-semibold text-accent-text" : "text-fg-muted"
                    }`}
                  >
                    {day}
                  </span>

                  {/* Small screens: one count per day. */}
                  {total > 0 && (
                    <span className="mx-auto font-mono text-[11px] tabular-nums text-fg-muted sm:hidden">
                      {cellEvents.length + openTasks > 0 ? (
                        cellEvents.length + openTasks
                      ) : (
                        <CheckIcon weight="bold" className="mx-auto h-3 w-3 text-accent" aria-hidden />
                      )}
                    </span>
                  )}

                  {/* Larger screens: events (with times) then tasks. */}
                  <span className="hidden space-y-0.5 sm:block">
                    {shownEvents.map((o) => (
                      <MonthEventChip key={`${o.event_id}-${o.occurrence_date}`} occ={o} />
                    ))}
                    {shownTasks.map((t) => (
                      <MonthTaskChip key={t.id} task={t} />
                    ))}
                    {hidden > 0 && <span className="block px-1 text-[11px] text-fg-faint">+{hidden} more</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <Panel title={formatDateLong(selected)} icon={CalendarBlankIcon} iconClassName="text-fg-faint" bodyClassName="p-1" className="lg:min-h-0">
          <div aria-live="polite" className="lg:h-full">
            {dayEvents.length > 0 && (
              <AgendaList
                occurrences={dayEvents}
                onOpen={(occ) => setEditor({ kind: "occurrence", occ })}
                bare
                now={now && selected === now.slice(0, 10) ? now : undefined}
                scrollToNow
              />
            )}
            {dayTasks.length > 0 && (
              <div className={dayEvents.length > 0 ? "mt-1 border-t border-line pt-1" : ""}>
                <h3 className="px-3 pb-1 pt-2 text-xs font-medium text-fg-muted">Due this day</h3>
                <TaskList key={selected} tasks={dayTasks} onUpdated={onUpdated} onDeleted={onDeleted} className="" />
              </div>
            )}
            {dayEvents.length === 0 && dayTasks.length === 0 && (
              <EmptyState variant="panel" icon={CalendarBlankIcon} title="Nothing this day">
                Nothing scheduled or due.
              </EmptyState>
            )}
          </div>
        </Panel>
      </div>

      {editor && <EventEditor target={editor} onClose={() => setEditor(null)} />}
    </Page>
  );
}
