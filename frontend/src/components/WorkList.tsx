"use client";

import Link from "next/link";
import { CalendarCheckIcon, CalendarDotsIcon, TrayIcon, WarningCircleIcon, type Icon } from "@phosphor-icons/react";
import { timeLabel } from "@/lib/calendarEvents";
import { formatDate } from "@/lib/format";
import { titleWithoutCourse } from "@/lib/palette";
import type { Occurrence, Task, WorkItem, WorkPlan } from "@/lib/types";
import DeadlineCheckbox from "./events/DeadlineCheckbox";
import { CourseBadge, ItemEdge, useLook } from "./look/Look";
import TaskRow from "./TaskRow";

/** One row of work: a Task (the usual task row) or an imported assignment
 * (checkbox, course, due time). Completion goes to whichever owns it. */
function WorkRow({
  item,
  index,
  onChanged,
  onOpenAssignment,
  overdue,
}: {
  item: WorkItem;
  index: number;
  onChanged: () => void;
  onOpenAssignment: (occ: Occurrence) => void;
  overdue?: boolean;
}) {
  if (item.kind === "task" && item.task) {
    return <TaskRow task={item.task as Task} index={index} onUpdated={onChanged} onDeleted={onChanged} />;
  }
  if (!item.occurrence) return null;
  return <AssignmentRow item={item} occ={item.occurrence} index={index} onOpen={onOpenAssignment} overdue={overdue} />;
}

function AssignmentRow({
  item,
  occ,
  index,
  onOpen,
  overdue,
}: {
  item: WorkItem;
  occ: Occurrence;
  index: number;
  onOpen: (occ: Occurrence) => void;
  overdue?: boolean;
}) {
  const look = useLook(occ);
  const due = item.due_at ? timeLabel(item.due_at) : null;
  return (
    <li
      style={{ "--i": index } as React.CSSProperties}
      className="group relative flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-surface-2/70 focus-within:bg-surface-2/70"
    >
      <DeadlineCheckbox eventId={item.id} title={item.title} completed={item.done} />
      <ItemEdge look={look} className="-ml-1" />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpen(occ)}
          className={`block max-w-full text-left text-sm leading-5 [overflow-wrap:anywhere] hover:underline hover:decoration-line-strong hover:underline-offset-4 ${
            item.done ? "text-fg-faint line-through decoration-fg-faint/60" : "text-fg"
          }`}
        >
          {titleWithoutCourse(item.title, item.course)}
        </button>
        <div className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${item.done ? "text-fg-faint" : "text-fg-muted"}`}>
          {item.course ? (
            <CourseBadge course={item.course} />
          ) : occ.subscription_name ? (
            <span className="inline-flex items-center gap-1">
              <CalendarDotsIcon className="h-3.5 w-3.5" aria-hidden />
              {occ.subscription_name}
            </span>
          ) : (
            <span>{look.label}</span>
          )}
          {due && (
            <span className={`font-mono tabular-nums ${overdue && !item.done ? "text-danger" : ""}`}>
              {overdue && item.due_date ? `${formatDate(item.due_date)}, ` : "Due "}
              {due}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function Section({
  title,
  icon: SectionIcon,
  tone = "default",
  count,
  children,
}: {
  title: string;
  icon: Icon;
  tone?: "default" | "danger";
  count: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="anim-fade-up">
      <h3
        className={`flex items-center gap-2 px-3 pb-1 pt-2.5 text-xs font-medium ${tone === "danger" ? "text-danger" : "text-fg-muted"}`}
      >
        <SectionIcon weight="bold" className={`h-3.5 w-3.5 ${tone === "danger" ? "" : "text-accent"}`} aria-hidden />
        {title}
        <span className="font-mono font-normal tabular-nums text-fg-faint">{count}</span>
      </h3>
      {children}
    </section>
  );
}

/** Tasks and imported assignments as one list: Overdue, Due today, and
 * open tasks with no due date (which are never called overdue). `limit`
 * caps each section, for the Dashboard tile. */
export default function WorkList({
  plan,
  onChanged,
  onOpenAssignment,
  limit,
  undatedHref = "/tasks?undated=1",
}: {
  plan: WorkPlan;
  onChanged: () => void;
  onOpenAssignment: (occ: Occurrence) => void;
  limit?: number;
  undatedHref?: string;
}) {
  const cap = <T,>(items: T[]) => (limit ? items.slice(0, limit) : items);
  const todayDone = plan.today.filter((i) => i.done).length;
  const undatedMore = plan.undated_total - cap(plan.undated).length;
  let n = 0;
  return (
    <>
      {plan.overdue.length > 0 && (
        <Section title="Overdue" icon={WarningCircleIcon} tone="danger" count={plan.overdue.length}>
          <ul>
            {cap(plan.overdue).map((item) => (
              <WorkRow key={`${item.kind}-${item.id}`} item={item} index={n++} onChanged={onChanged} onOpenAssignment={onOpenAssignment} overdue />
            ))}
          </ul>
        </Section>
      )}
      {plan.today.length > 0 && (
        <Section title="Due today" icon={CalendarCheckIcon} count={`${todayDone}/${plan.today.length}`}>
          <ul>
            {cap(plan.today).map((item) => (
              <WorkRow key={`${item.kind}-${item.id}`} item={item} index={n++} onChanged={onChanged} onOpenAssignment={onOpenAssignment} />
            ))}
          </ul>
        </Section>
      )}
      {plan.undated.length > 0 && (
        <Section title="No due date" icon={TrayIcon} count={plan.undated_total}>
          <ul>
            {cap(plan.undated).map((item) => (
              <WorkRow key={`${item.kind}-${item.id}`} item={item} index={n++} onChanged={onChanged} onOpenAssignment={onOpenAssignment} />
            ))}
          </ul>
          {undatedMore > 0 && (
            <Link href={undatedHref} className="mt-0.5 block px-3 pb-1 text-xs font-medium text-accent-text underline-offset-4 hover:underline">
              {undatedMore} more without a due date
            </Link>
          )}
        </Section>
      )}
    </>
  );
}
