"use client";

import { useEffect, useState } from "react";
import { CircleNotchIcon, TrashIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import {
  buildRrule,
  EVENT_CATEGORIES,
  parseRrule,
  splitLocal,
  WEEKDAYS,
  type EndKind,
  type Repeat,
  type RepeatKind,
  type Weekday,
} from "@/lib/calendarEvents";
import { addDaysIso, formatDate } from "@/lib/format";
import { toast, toastError } from "@/lib/toast";
import type { CalendarEvent, EventPayload, Occurrence } from "@/lib/types";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD as FIELD_BASE, LABEL } from "@/lib/ui";
import Dialog from "../Dialog";

const FIELD = `mt-1.5 h-10 w-full ${FIELD_BASE}`;

const REPEAT_LABEL: Record<RepeatKind, string> = {
  none: "Does not repeat",
  daily: "Every day",
  weekdays: "Every weekday (Mon to Fri)",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly, same date",
  custom: "Custom rule",
};

/** Create or edit a one-off event or a whole series. */
export default function EventModal({
  event,
  defaultDate,
  onClose,
  onDone,
}: {
  event: CalendarEvent | null;
  defaultDate: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const start = event ? splitLocal(event.start_at) : { date: defaultDate, time: "09:00" };
  const end = event ? splitLocal(event.end_at) : { date: defaultDate, time: "10:00" };

  const [title, setTitle] = useState(event?.title ?? "");
  const [category, setCategory] = useState(event?.category ?? "other");
  const [location, setLocation] = useState(event?.location ?? "");
  const [notes, setNotes] = useState(event?.notes ?? "");
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [date, setDate] = useState(start.date);
  const [startTime, setStartTime] = useState(event && !event.all_day ? start.time : "09:00");
  const [endTime, setEndTime] = useState(event && !event.all_day ? end.time : "10:00");
  const [lastDay, setLastDay] = useState(event?.all_day ? addDaysIso(end.date, -1) : start.date);
  const [repeat, setRepeat] = useState<Repeat>(() => parseRrule(event?.rrule ?? null, start.date));
  const [showRule, setShowRule] = useState(() => parseRrule(event?.rrule ?? null, start.date).kind === "custom");
  const [preview, setPreview] = useState<Occurrence[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const crossesMidnight = !allDay && endTime <= startTime;
  const startAt = allDay ? date : `${date}T${startTime}`;
  const endAt = allDay
    ? addDaysIso(lastDay < date ? date : lastDay, 1)
    : `${crossesMidnight ? addDaysIso(date, 1) : date}T${endTime}`;
  const rrule = buildRrule(repeat, date);

  // Live preview of the next dates whenever the rule or times change.
  useEffect(() => {
    if (!rrule) return;
    const id = setTimeout(() => {
      api
        .previewEvent({ start_at: startAt, end_at: endAt, all_day: allDay, rrule })
        .then((occ) => {
          setPreview(occ);
          setPreviewError(null);
        })
        .catch((e) => {
          setPreview(null);
          setPreviewError(e instanceof Error ? e.message : "That repeat rule isn't valid");
        });
    }, 300);
    return () => clearTimeout(id);
  }, [rrule, startAt, endAt, allDay]);

  useEffect(() => {
    if (!confirmDelete) return;
    const id = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(id);
  }, [confirmDelete]);

  function patchRepeat(p: Partial<Repeat>) {
    setRepeat((r) => ({ ...r, ...p }));
  }

  function toggleDay(d: Weekday) {
    setRepeat((r) => {
      const days = r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d];
      return { ...r, days: days.length ? days : r.days };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Give the event a title.");
    if (rrule && previewError) return setError(previewError);
    setSaving(true);
    setError(null);
    const payload: EventPayload = {
      title: title.trim(),
      category: category.trim() || "other",
      all_day: allDay,
      start_at: startAt,
      end_at: endAt,
      location: location.trim() || null,
      notes: notes.trim() || null,
      rrule,
    };
    try {
      const ctx = event ? await api.updateEvent(event.id, payload) : await api.createEvent(payload);
      const n = ctx.conflicts.length;
      if (n) {
        toast(`Saved. Overlaps ${ctx.conflicts[0].title}${n > 1 ? ` and ${n - 1} more` : ""}`, "info");
      } else {
        toast(event ? "Event updated" : `Added "${ctx.event.title}"`);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the event");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!event) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    try {
      await api.deleteEvent(event.id);
      toast(`Deleted "${event.title}"`, "info");
      onDone();
    } catch (err) {
      toastError(err, "Couldn't delete the event");
      setSaving(false);
    }
  }

  const weekly = repeat.kind === "weekly" || repeat.kind === "biweekly";

  return (
    <Dialog
      title={event ? (event.rrule ? "Edit all dates in series" : "Edit event") : "New event"}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <>
          {event && (
            <button
              type="button"
              onClick={remove}
              disabled={saving}
              className={
                confirmDelete
                  ? "inline-flex h-9 items-center gap-1.5 rounded-lg bg-danger px-3 text-sm font-medium text-surface"
                  : `${BUTTON_SECONDARY} text-danger hover:bg-danger-soft`
              }
            >
              <TrashIcon className="h-4 w-4" aria-hidden />
              {confirmDelete ? (event.rrule ? "Delete all dates?" : "Delete?") : "Delete"}
            </button>
          )}
          <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BUTTON_PRIMARY}>
            {saving && <CircleNotchIcon className="h-4 w-4 animate-spin" aria-hidden />}
            {saving ? "Saving" : event ? "Save" : "Add event"}
          </button>
        </>
      }
    >
      <label className={`block ${LABEL}`}>
        Title
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="CS 101 lecture" className={FIELD} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className={`block ${LABEL}`}>
          Category
          <input list="event-categories" value={category} onChange={(e) => setCategory(e.target.value)} className={FIELD} />
          <datalist id="event-categories">
            {EVENT_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className={`block ${LABEL}`}>
          Location
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" className={FIELD} />
        </label>
      </div>

      <div className="flex items-center justify-between">
        <span className={LABEL} id="all-day-label">
          All day
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={allDay}
          aria-labelledby="all-day-label"
          onClick={() => setAllDay((v) => !v)}
          className={`relative h-6 w-10 shrink-0 rounded-full transition-colors duration-150 ${allDay ? "bg-accent" : "bg-line-strong"}`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-surface shadow-sm transition-transform duration-150 ${
              allDay ? "translate-x-4" : ""
            }`}
          />
        </button>
      </div>

      {allDay ? (
        <div className="grid grid-cols-2 gap-3">
          <label className={`block ${LABEL}`}>
            Starts
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} />
          </label>
          <label className={`block ${LABEL}`}>
            Last day
            <input type="date" value={lastDay} min={date} onChange={(e) => setLastDay(e.target.value)} className={FIELD} />
          </label>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
            <label className={`block ${LABEL}`}>
              Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} />
            </label>
            <label className={`block ${LABEL}`}>
              Starts
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={FIELD} />
            </label>
            <label className={`block ${LABEL}`}>
              Ends
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={FIELD} />
            </label>
          </div>
          {crossesMidnight && <p className="mt-1.5 text-xs text-fg-muted">Ends the next day.</p>}
        </div>
      )}

      <fieldset className="space-y-3">
        <legend className={LABEL}>Repeat</legend>
        <select
          aria-label="Repeat"
          value={repeat.kind}
          onChange={(e) => {
            const kind = e.target.value as RepeatKind;
            patchRepeat({ kind, custom: kind === "custom" ? repeat.custom || rrule || "FREQ=WEEKLY" : repeat.custom });
            if (kind === "custom") setShowRule(true);
          }}
          className={FIELD}
        >
          {(Object.keys(REPEAT_LABEL) as RepeatKind[]).map((k) => (
            <option key={k} value={k}>
              {REPEAT_LABEL[k]}
            </option>
          ))}
        </select>

        {weekly && (
          <div className="flex gap-1" role="group" aria-label="Days of the week">
            {WEEKDAYS.map((d) => {
              const on = repeat.days.includes(d.code);
              return (
                <button
                  key={d.code}
                  type="button"
                  aria-pressed={on}
                  aria-label={d.name}
                  onClick={() => toggleDay(d.code)}
                  className={`h-9 flex-1 rounded-lg text-xs font-medium transition-colors duration-150 ${
                    on ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-muted hover:text-fg"
                  }`}
                >
                  {d.short}
                </button>
              );
            })}
          </div>
        )}

        {repeat.kind !== "none" && repeat.kind !== "custom" && (
          <div className="grid grid-cols-2 gap-3">
            <label className={`block ${LABEL}`}>
              Ends
              <select value={repeat.end} onChange={(e) => patchRepeat({ end: e.target.value as EndKind })} className={FIELD}>
                <option value="never">Never</option>
                <option value="until">On a date</option>
                <option value="count">After a number of times</option>
              </select>
            </label>
            {repeat.end === "until" && (
              <label className={`block ${LABEL}`}>
                Last date
                <input type="date" value={repeat.until} min={date} onChange={(e) => patchRepeat({ until: e.target.value })} className={FIELD} />
              </label>
            )}
            {repeat.end === "count" && (
              <label className={`block ${LABEL}`}>
                Times
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={repeat.count}
                  onChange={(e) => patchRepeat({ count: Math.max(1, parseInt(e.target.value || "1", 10)) })}
                  className={FIELD}
                />
              </label>
            )}
          </div>
        )}

        {repeat.kind !== "none" && (
          <div>
            <button
              type="button"
              onClick={() => setShowRule((v) => !v)}
              aria-expanded={showRule}
              className="text-xs font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
            >
              {showRule ? "Hide rule" : "Show rule"}
            </button>
            {showRule && (
              <input
                aria-label="Repeat rule (RRULE)"
                value={rrule ?? ""}
                onChange={(e) => patchRepeat({ kind: "custom", custom: e.target.value })}
                spellCheck={false}
                className={`mt-1.5 h-10 w-full font-mono text-xs ${FIELD_BASE}`}
              />
            )}
          </div>
        )}

        {rrule &&
          (previewError ? (
            <p className="text-xs text-danger">{previewError}</p>
          ) : (
            preview && (
              <p className="text-xs leading-relaxed text-fg-muted">
                Next:{" "}
                {preview.length ? preview.map((o) => formatDate(o.occurrence_date)).join(", ") : "no upcoming dates"}
              </p>
            )
          ))}
      </fieldset>

      <label className={`block ${LABEL}`}>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`mt-1.5 w-full py-2 leading-relaxed ${FIELD_BASE}`} />
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
