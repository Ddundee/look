"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarBlankIcon, CircleNotchIcon, FlagIcon, HashIcon, PlusIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { categoryHue, PRIORITY_LABEL, PRIORITY_TEXT, relativeDueLabel } from "@/lib/format";
import { parseQuickAdd } from "@/lib/quickAdd";
import { toast, toastError } from "@/lib/toast";
import type { Task } from "@/lib/types";
import { KBD } from "@/lib/ui";

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

const CHIP = "inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-fg-muted";

export default function QuickAddBar({ onCreated }: { onCreated?: (task: Task) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // "n" or "/" anywhere outside a text field jumps to quick add.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "n" && e.key !== "/") return;
      if (isEditable(document.activeElement)) return;
      if (document.querySelector("[aria-modal='true']")) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Live preview of what the local parser will pull out of the text, so
  // there are no surprises about the date or priority after pressing Enter.
  const parsed = useMemo(() => (value.trim() ? parseQuickAdd(value).payload : null), [value]);
  const hasStructure = !!parsed && !!(parsed.due_date || parsed.priority || parsed.category);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = value.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const { payload } = parseQuickAdd(text);
      const task = await api.createTask(payload);
      setValue("");
      toast(
        payload.due_date
          ? `Added "${task.title}" for ${relativeDueLabel(payload.due_date)}`
          : `Added "${task.title}"`
      );
      onCreated?.(task);
    } catch (err) {
      toastError(err, "Couldn't add the task");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full">
      <div
        className={`flex items-center gap-2 rounded-xl border bg-surface pl-3 pr-1.5 transition-[border-color,box-shadow] duration-150 ${
          focused ? "border-accent ring-3 ring-accent-soft" : "border-line hover:border-line-strong"
        }`}
      >
        <PlusIcon weight="bold" className={`h-4 w-4 shrink-0 ${focused ? "text-accent" : "text-fg-faint"}`} aria-hidden />
        <label htmlFor="quick-add" className="sr-only">
          Quick add a task
        </label>
        <input
          id="quick-add"
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") inputRef.current?.blur();
          }}
          autoComplete="off"
          placeholder='Add a task, e.g. "Problem set 3 due Fri high priority"'
          className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-fg placeholder:text-fg-faint focus:outline-none sm:text-sm"
        />
        {value.trim() ? (
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-fg transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.97] disabled:opacity-60"
          >
            {busy && <CircleNotchIcon className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Add
          </button>
        ) : (
          <span className="hidden items-center gap-1 pr-1.5 sm:inline-flex" aria-hidden>
            <kbd className={KBD}>N</kbd>
          </span>
        )}
      </div>

      {parsed && (
        <div className="anim-fade-up mt-2 flex flex-wrap items-center gap-1.5 px-1" aria-live="polite">
          {hasStructure ? (
            <>
              {parsed.due_date && (
                <span className={CHIP}>
                  <CalendarBlankIcon className="h-3.5 w-3.5 text-accent" aria-hidden />
                  {relativeDueLabel(parsed.due_date)}
                </span>
              )}
              {parsed.priority && (
                <span className={CHIP}>
                  <FlagIcon weight="fill" className={`h-3.5 w-3.5 ${PRIORITY_TEXT[parsed.priority]}`} aria-hidden />
                  {PRIORITY_LABEL[parsed.priority]}
                </span>
              )}
              {parsed.category && (
                <span className={CHIP}>
                  <HashIcon weight="bold" className={`h-3.5 w-3.5 ${categoryHue(parsed.category)}`} aria-hidden />
                  {parsed.category}
                </span>
              )}
              <span className="text-xs text-fg-faint">as &ldquo;{parsed.title}&rdquo;</span>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-fg-faint">
              <CalendarBlankIcon className="h-3.5 w-3.5" aria-hidden />
              No date yet. Add one like &ldquo;tmrw&rdquo; or &ldquo;Sept 18&rdquo; to schedule it.
            </span>
          )}
        </div>
      )}
    </form>
  );
}
