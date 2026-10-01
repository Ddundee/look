"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleNotchIcon, FlagIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { notifyTasksChanged } from "@/lib/events";
import { PRIORITY_LABEL, PRIORITY_TEXT, STATUS_LABEL } from "@/lib/format";
import { toast } from "@/lib/toast";
import { SEED_CATEGORIES, type Task, type TaskPriority, type TaskStatus } from "@/lib/types";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD as FIELD_BASE, ICON_BUTTON, KBD, LABEL } from "@/lib/ui";

interface Props {
  task: Task | null; // null = create mode
  onClose: () => void;
  onSaved: (task: Task) => void;
}

const STATUSES: TaskStatus[] = ["inbox", "todo", "in_progress", "blocked", "completed", "cancelled"];
const PRIORITIES: TaskPriority[] = ["critical", "high", "medium", "low"];

const FIELD = `mt-1.5 h-10 w-full ${FIELD_BASE}`;
const AREA = `mt-1.5 w-full py-2 leading-relaxed ${FIELD_BASE}`;

export default function TaskEditModal({ task, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "inbox");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "medium");
  const [category, setCategory] = useState(task?.category ?? "personal");
  const [tags, setTags] = useState(task?.tags?.join(", ") ?? "");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const [dueTime, setDueTime] = useState(task?.due_time?.slice(0, 5) ?? "");
  const [estimatedDuration, setEstimatedDuration] = useState(
    task?.estimated_duration?.toString() ?? ""
  );
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLFormElement>(null);
  // Callers pass an inline arrow, so read it through a ref; otherwise the
  // effect below would re-run (and bounce focus) on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const titleId = useId();
  const errorId = useId();

  // Escape closes, Tab stays inside the dialog, and focus goes back to
  // whatever opened it afterwards.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        "input, select, textarea, button:not(:disabled), [href]"
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Give the task a title.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      status,
      priority,
      category,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      due_date: dueDate || null,
      due_time: dueTime || null,
      estimated_duration: estimatedDuration ? parseInt(estimatedDuration, 10) : null,
      notes: notes.trim() || null,
    };
    try {
      const saved = task ? await api.updateTask(task.id, payload) : await api.createTask(payload);
      onSaved(saved);
      notifyTasksChanged();
      toast(task ? "Changes saved" : `Created "${saved.title}"`);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save task");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div className="anim-overlay absolute inset-0 bg-black/35 backdrop-blur-[2px] dark:bg-black/60" onClick={onClose} />
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={handleSubmit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) dialogRef.current?.requestSubmit();
        }}
        className="anim-pop relative flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-2xl bg-surface elev-3 sm:rounded-2xl"
      >
        <div className="flex items-center justify-between px-5 pb-1 pt-4">
          <h2 id={titleId} className="text-sm font-semibold text-fg">
            {task ? "Edit task" : "New task"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={ICON_BUTTON}>
            <XIcon className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="scroll-area space-y-4 overflow-y-auto px-5 pb-5 pt-2">
          <div>
            <label className="sr-only" htmlFor={`${titleId}-title`}>
              Title
            </label>
            <input
              id={`${titleId}-title`}
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              aria-invalid={!!error && !title.trim()}
              aria-describedby={error ? errorId : undefined}
              className="w-full bg-transparent text-lg font-medium tracking-tight text-fg placeholder:text-fg-faint focus:outline-none"
            />
            <label className="sr-only" htmlFor={`${titleId}-desc`}>
              Description
            </label>
            <textarea
              id={`${titleId}-desc`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description"
              rows={2}
              className="mt-1 w-full resize-none bg-transparent text-sm leading-relaxed text-fg-muted placeholder:text-fg-faint focus:outline-none"
            />
          </div>

          <fieldset>
            <legend className={LABEL}>Priority</legend>
            <div className="mt-1.5 grid grid-cols-4 gap-1 rounded-lg bg-surface-2 p-1">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  aria-pressed={priority === p}
                  className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 ${
                    priority === p ? "bg-surface text-fg elev-1" : "text-fg-muted hover:text-fg"
                  }`}
                >
                  <FlagIcon
                    weight={priority === p ? "fill" : "regular"}
                    className={`h-3.5 w-3.5 ${PRIORITY_TEXT[p]}`}
                    aria-hidden
                  />
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-2">
            <label className={`block ${LABEL}`}>
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className={FIELD}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className={`block ${LABEL}`}>
              Category
              <input
                list="categories"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={FIELD}
              />
              <datalist id="categories">
                {SEED_CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label className={`block ${LABEL}`}>
              Due date
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={FIELD} />
            </label>
            <label className={`block ${LABEL}`}>
              Due time
              <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className={FIELD} />
            </label>
            <label className={`block ${LABEL}`}>
              Estimate (minutes)
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={estimatedDuration}
                onChange={(e) => setEstimatedDuration(e.target.value)}
                className={FIELD}
              />
            </label>
            <label className={`block ${LABEL}`}>
              Tags
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Comma separated"
                className={FIELD}
              />
            </label>
          </div>

          <label className={`block ${LABEL}`}>
            Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={AREA} />
          </label>

          {error && (
            <p id={errorId} role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              <WarningCircleIcon weight="fill" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <span className="hidden items-center gap-1 text-xs text-fg-faint sm:inline-flex">
            <kbd className={KBD}>⌘</kbd>
            <kbd className={KBD}>↵</kbd>
            to save
          </span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className={BUTTON_PRIMARY}>
              {saving && <CircleNotchIcon className="h-4 w-4 animate-spin" aria-hidden />}
              {saving ? "Saving" : task ? "Save changes" : "Create task"}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body
  );
}
