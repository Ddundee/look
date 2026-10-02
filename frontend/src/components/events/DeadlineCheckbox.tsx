"use client";

import { useState } from "react";
import { CheckIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { notifyEventsChanged } from "@/lib/events";
import { toastError } from "@/lib/toast";

/** Check off a deadline (an imported assignment). Looks like a task's
 * checkbox; only completion changes, the event stays feed-managed. */
export default function DeadlineCheckbox({
  eventId,
  title,
  completed,
}: {
  eventId: string;
  title: string;
  completed: boolean;
}) {
  // Optimistic, and it keeps the value it set while `completed` is the
  // value it was set over: some callers (the details dialog) hold a
  // snapshot that never refreshes. Fresh data with a new value wins.
  const [local, setLocal] = useState<{ base: boolean; value: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const done = local && local.base === completed ? local.value : completed;

  async function toggle() {
    const next = !done;
    setLocal({ base: completed, value: next });
    setBusy(true);
    try {
      await (next ? api.completeEvent(eventId) : api.uncompleteEvent(eventId));
      notifyEventsChanged();
    } catch (err) {
      setLocal(null);
      toastError(err, "Couldn't update it");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-label={done ? `Mark "${title}" as not done` : `Mark "${title}" as done`}
      aria-pressed={done}
      className={`relative mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors duration-150 before:absolute before:-inset-2.5 before:content-[''] ${
        done ? "border-accent bg-accent text-accent-fg" : "border-line-strong hover:border-accent"
      }`}
    >
      {done && <CheckIcon weight="bold" className="anim-check h-2.5 w-2.5" aria-hidden />}
    </button>
  );
}
