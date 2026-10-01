"use client";

import { useEffect, useState } from "react";
import { CircleNotchIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { splitLocal } from "@/lib/calendarEvents";
import { addDaysIso, formatDateLong } from "@/lib/format";
import { toast } from "@/lib/toast";
import type { Occurrence, OccurrenceEditPayload } from "@/lib/types";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD as FIELD_BASE, LABEL } from "@/lib/ui";
import Dialog from "../Dialog";

const FIELD = `mt-1.5 h-10 w-full ${FIELD_BASE}`;

/** Edit, move, cancel or restore one date of a recurring series. */
export default function OccurrenceModal({
  occ,
  onClose,
  onDone,
}: {
  occ: Occurrence;
  onClose: () => void;
  onDone: () => void;
}) {
  const s = splitLocal(occ.start_at);
  const e = splitLocal(occ.end_at);
  const [date, setDate] = useState(s.date);
  const [startTime, setStartTime] = useState(s.time);
  const [endTime, setEndTime] = useState(e.time);
  const [title, setTitle] = useState(occ.title);
  const [location, setLocation] = useState(occ.location ?? "");
  const [notes, setNotes] = useState(occ.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    if (!confirmCancel) return;
    const id = setTimeout(() => setConfirmCancel(false), 3000);
    return () => clearTimeout(id);
  }, [confirmCancel]);

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      toast(message);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change this date");
      setBusy(false);
    }
  }

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!title.trim()) return setError("Give it a title.");
    const payload: OccurrenceEditPayload = {};
    if (!occ.all_day) {
      const startAt = `${date}T${startTime}`;
      const endAt = `${endTime <= startTime ? addDaysIso(date, 1) : date}T${endTime}`;
      if (startAt !== occ.start_at.slice(0, 16) || endAt !== occ.end_at.slice(0, 16)) {
        payload.start_at = startAt;
        payload.end_at = endAt;
      }
    }
    if (title.trim() !== occ.title) payload.title = title.trim();
    if ((location.trim() || null) !== occ.location) payload.location = location.trim() || null;
    if ((notes.trim() || null) !== occ.notes) payload.notes = notes.trim() || null;
    if (Object.keys(payload).length === 0 && !occ.cancelled) return onClose();
    run(() => api.editOccurrence(occ.event_id, occ.occurrence_date, payload), "Changed for this date");
  }

  function cancelDate() {
    if (!confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    run(() => api.editOccurrence(occ.event_id, occ.occurrence_date, { cancel: true }), "Cancelled for this date");
  }

  return (
    <Dialog
      title={`Just ${formatDateLong(occ.occurrence_date)}`}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <>
          {occ.overridden && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => api.restoreOccurrence(occ.event_id, occ.occurrence_date), "Restored to the series")}
              className={BUTTON_SECONDARY}
            >
              Restore to series
            </button>
          )}
          {!occ.cancelled && (
            <button
              type="button"
              disabled={busy}
              onClick={cancelDate}
              className={
                confirmCancel
                  ? "inline-flex h-9 items-center rounded-lg bg-danger px-3 text-sm font-medium text-surface"
                  : `${BUTTON_SECONDARY} text-danger hover:bg-danger-soft`
              }
            >
              {confirmCancel ? "Cancel this date?" : "Cancel this date"}
            </button>
          )}
          <button type="submit" disabled={busy} className={BUTTON_PRIMARY}>
            {busy && <CircleNotchIcon className="h-4 w-4 animate-spin" aria-hidden />}
            {occ.cancelled ? "Un-cancel and save" : "Save"}
          </button>
        </>
      }
    >
      {occ.cancelled && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">This date is cancelled.</p>
      )}
      <label className={`block ${LABEL}`}>
        Title
        <input autoFocus value={title} onChange={(ev) => setTitle(ev.target.value)} className={FIELD} />
      </label>
      {!occ.all_day && (
        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
          <label className={`block ${LABEL}`}>
            Date
            <input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} className={FIELD} />
          </label>
          <label className={`block ${LABEL}`}>
            Starts
            <input type="time" value={startTime} onChange={(ev) => setStartTime(ev.target.value)} className={FIELD} />
          </label>
          <label className={`block ${LABEL}`}>
            Ends
            <input type="time" value={endTime} onChange={(ev) => setEndTime(ev.target.value)} className={FIELD} />
          </label>
        </div>
      )}
      <label className={`block ${LABEL}`}>
        Location
        <input value={location} onChange={(ev) => setLocation(ev.target.value)} className={FIELD} />
      </label>
      <label className={`block ${LABEL}`}>
        Notes
        <textarea value={notes} onChange={(ev) => setNotes(ev.target.value)} rows={2} className={`mt-1.5 w-full py-2 leading-relaxed ${FIELD_BASE}`} />
      </label>
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <WarningCircleIcon weight="fill" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </Dialog>
  );
}
