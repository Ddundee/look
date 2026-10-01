"use client";

import { useEffect, useState } from "react";
import { CalendarBlankIcon, StackIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { notifyEventsChanged } from "@/lib/events";
import { formatDateLong } from "@/lib/format";
import { toastError } from "@/lib/toast";
import type { CalendarEvent, Occurrence } from "@/lib/types";
import { BUTTON_SECONDARY } from "@/lib/ui";
import Dialog from "../Dialog";
import EventModal from "./EventModal";
import OccurrenceModal from "./OccurrenceModal";

export type EditorTarget = { kind: "new"; date: string } | { kind: "occurrence"; occ: Occurrence };

const CHOICE =
  "flex w-full items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left transition-colors duration-150 hover:border-line-strong hover:bg-surface-2";

/** Opens the right form for a target: new event, one date of a series
 * (after asking "just this date or all dates"), or a whole event. */
export default function EventEditor({ target, onClose }: { target: EditorTarget; onClose: () => void }) {
  const [step, setStep] = useState<"scope" | "this" | "load" | "series">(
    target.kind === "new" ? "series" : target.occ.recurring ? "scope" : "load"
  );
  const [event, setEvent] = useState<CalendarEvent | null>(null);

  useEffect(() => {
    if (step !== "load" || target.kind !== "occurrence") return;
    let cancelled = false;
    api
      .getEvent(target.occ.event_id)
      .then((e) => {
        if (cancelled) return;
        setEvent(e);
        setStep("series");
      })
      .catch((err) => {
        if (cancelled) return;
        toastError(err, "Couldn't load the event");
        onClose();
      });
    return () => {
      cancelled = true;
    };
  }, [step, target, onClose]);

  function done() {
    notifyEventsChanged();
    onClose();
  }

  if (step === "scope" && target.kind === "occurrence") {
    return (
      <Dialog
        title="Edit recurring event"
        size="sm"
        hint={false}
        onClose={onClose}
        onSubmit={(e) => e.preventDefault()}
        footer={
          <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
            Cancel
          </button>
        }
      >
        <p className="text-sm text-fg-muted">&ldquo;{target.occ.title}&rdquo; repeats. What should change?</p>
        <div className="space-y-2">
          <button type="button" autoFocus onClick={() => setStep("this")} className={CHOICE}>
            <CalendarBlankIcon className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
            <span>
              <span className="block text-sm font-medium text-fg">Just this date</span>
              <span className="block text-xs text-fg-muted">{formatDateLong(target.occ.occurrence_date)}</span>
            </span>
          </button>
          <button type="button" onClick={() => setStep("load")} className={CHOICE}>
            <StackIcon className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
            <span>
              <span className="block text-sm font-medium text-fg">All dates in the series</span>
              <span className="block text-xs text-fg-muted">Time, repeat pattern, title, location</span>
            </span>
          </button>
        </div>
      </Dialog>
    );
  }

  if (step === "this" && target.kind === "occurrence") {
    return <OccurrenceModal occ={target.occ} onClose={onClose} onDone={done} />;
  }

  if (step === "series") {
    return (
      <EventModal
        event={event}
        defaultDate={target.kind === "new" ? target.date : target.occ.occurrence_date}
        onClose={onClose}
        onDone={done}
      />
    );
  }

  return null;
}
