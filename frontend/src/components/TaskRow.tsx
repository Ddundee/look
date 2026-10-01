"use client";

import { useEffect, useState } from "react";
import {
  ArrowsClockwiseIcon,
  CalendarBlankIcon,
  CheckIcon,
  ClockIcon,
  PencilSimpleIcon,
  SunIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { notifyTasksChanged } from "@/lib/events";
import { PRIORITY_RING, relativeDueLabel } from "@/lib/format";
import { toast, toastError } from "@/lib/toast";
import { isTaskDone, type Task } from "@/lib/types";
import { ICON_BUTTON } from "@/lib/ui";
import { CategoryTag, PriorityFlag, StatusBadge } from "./Badges";
import TaskEditModal from "./TaskEditModal";

interface Props {
  task: Task;
  onUpdated: (task: Task) => void;
  onDeleted: (id: string) => void;
  /** Position in its list; drives the entrance stagger delay. */
  index?: number;
}

export default function TaskRow({ task, onUpdated, onDeleted, index = 0 }: Props) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isDone = isTaskDone(task);

  // The delete button asks for a second click instead of a blocking
  // confirm() dialog; the armed state quietly expires.
  useEffect(() => {
    if (!confirmingDelete) return;
    const id = setTimeout(() => setConfirmingDelete(false), 3000);
    return () => clearTimeout(id);
  }, [confirmingDelete]);

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      toastError(err, failure);
    } finally {
      setBusy(false);
    }
  }

  function toggleComplete() {
    return run(async () => {
      const updated = isDone
        ? await api.updateTask(task.id, { status: "todo" })
        : await api.completeTask(task.id);
      onUpdated(updated);
      notifyTasksChanged();
    }, "Couldn't update the task");
  }

  function togglePlanToday() {
    return run(async () => {
      const updated = task.planned_for_date
        ? await api.unplanFromToday(task.id)
        : await api.planForToday(task.id);
      onUpdated(updated);
      notifyTasksChanged();
      toast(updated.planned_for_date ? "Planned for today" : "Removed from today", "info");
    }, "Couldn't change today's plan");
  }

  function remove() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    return run(async () => {
      await api.deleteTask(task.id);
      onDeleted(task.id);
      notifyTasksChanged();
      toast(`Deleted "${task.title}"`, "info");
    }, "Couldn't delete the task");
  }

  const showStatus = task.status !== "todo" && task.status !== "completed";
  const hasMeta =
    !!task.due_date ||
    !!task.estimated_duration ||
    task.priority !== "medium" ||
    !!task.recurrence_rule_id ||
    showStatus ||
    !!task.category;

  return (
    <li
      style={{ "--i": index } as React.CSSProperties}
      className="group relative flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-surface-2/70 focus-within:bg-surface-2/70">
      <button
        onClick={toggleComplete}
        disabled={busy}
        aria-label={isDone ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        aria-pressed={isDone}
        className={`relative mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors duration-150 before:absolute before:-inset-2.5 before:content-[''] ${
          isDone ? "border-sea bg-sea text-surface" : PRIORITY_RING[task.priority]
        }`}
      >
        {isDone && <CheckIcon weight="bold" className="anim-check h-2.5 w-2.5" aria-hidden />}
      </button>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`block max-w-full text-left text-sm leading-5 [overflow-wrap:anywhere] transition-colors duration-200 hover:underline hover:decoration-line-strong hover:underline-offset-4 ${
            isDone ? "text-fg-faint line-through decoration-fg-faint/60" : "text-fg"
          }`}
        >
          {task.title}
        </button>

        {hasMeta && (
          <div
            className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${
              isDone ? "text-fg-faint" : "text-fg-muted"
            }`}
          >
            {task.due_date && (
              <span
                className={`inline-flex items-center gap-1 ${
                  task.is_overdue && !isDone ? "font-medium text-danger" : ""
                }`}
              >
                {task.is_overdue && !isDone ? (
                  <WarningCircleIcon weight="fill" className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <CalendarBlankIcon className="h-3.5 w-3.5" aria-hidden />
                )}
                {task.is_overdue && !isDone && <span className="sr-only">Overdue:</span>}
                {relativeDueLabel(task.due_date)}
                {task.due_time && <span className="font-mono tabular-nums">{task.due_time.slice(0, 5)}</span>}
              </span>
            )}
            {task.estimated_duration ? (
              <span className="inline-flex items-center gap-1">
                <ClockIcon className="h-3.5 w-3.5" aria-hidden />
                <span className="font-mono tabular-nums">{task.estimated_duration}m</span>
              </span>
            ) : null}
            {task.priority !== "medium" && !isDone && <PriorityFlag priority={task.priority} />}
            {task.category && <CategoryTag category={task.category} />}
            {task.recurrence_rule_id && (
              <span className="inline-flex items-center gap-1" title="Recurring task">
                <ArrowsClockwiseIcon className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">Recurring</span>
              </span>
            )}
            {showStatus && <StatusBadge status={task.status} />}
          </div>
        )}
      </div>

      <div className="-my-1 flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
        {!isDone && (
          <button
            onClick={togglePlanToday}
            disabled={busy}
            aria-label={task.planned_for_date ? "Remove from today" : "Plan for today"}
            title={task.planned_for_date ? "Remove from today" : "Plan for today"}
            className={`${ICON_BUTTON} ${task.planned_for_date ? "text-warn hover:text-warn" : ""}`}
          >
            <SunIcon weight={task.planned_for_date ? "fill" : "regular"} className="h-4 w-4" aria-hidden />
          </button>
        )}
        <button
          onClick={() => setEditing(true)}
          aria-label="Edit task"
          title="Edit"
          className={ICON_BUTTON}
        >
          <PencilSimpleIcon className="h-4 w-4" aria-hidden />
        </button>
        <button
          onClick={remove}
          disabled={busy}
          aria-label={confirmingDelete ? `Confirm delete "${task.title}"` : "Delete task"}
          title={confirmingDelete ? "Click again to delete" : "Delete"}
          className={
            confirmingDelete
              ? "inline-flex h-8 items-center gap-1 rounded-lg bg-danger px-2 text-xs font-medium text-surface transition-colors"
              : `${ICON_BUTTON} hover:bg-danger-soft hover:text-danger`
          }
        >
          <TrashIcon className="h-4 w-4" aria-hidden />
          {confirmingDelete && "Delete?"}
        </button>
      </div>

      {editing && (
        <TaskEditModal
          task={task}
          onClose={() => setEditing(false)}
          onSaved={(saved) => onUpdated(saved)}
        />
      )}
    </li>
  );
}
