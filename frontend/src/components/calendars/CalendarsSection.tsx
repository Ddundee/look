"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowsClockwiseIcon,
  CalendarDotsIcon,
  CircleNotchIcon,
  FileArrowUpIcon,
  PencilSimpleIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { notifyEventsChanged } from "@/lib/events";
import { toast, toastError } from "@/lib/toast";
import type { CalendarSubscription, CalendarSyncResult } from "@/lib/types";
import { BUTTON_GHOST_SM, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, FAINT, FIELD, LABEL, MUTED, SECTION_HEADING } from "@/lib/ui";

const INTERVALS: { minutes: number; label: string }[] = [
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 30, label: "Every 30 minutes" },
  { minutes: 60, label: "Every hour" },
  { minutes: 180, label: "Every 3 hours" },
  { minutes: 360, label: "Every 6 hours" },
  { minutes: 720, label: "Every 12 hours" },
  { minutes: 1440, label: "Once a day" },
];

function intervalLabel(minutes: number): string {
  return INTERVALS.find((i) => i.minutes === minutes)?.label ?? `Every ${minutes} minutes`;
}

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function relative(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return seconds <= 0 ? "just now" : "in a moment";
  if (abs < 3600) return RTF.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return RTF.format(Math.round(seconds / 3600), "hour");
  return RTF.format(Math.round(seconds / 86400), "day");
}

function absolute(iso: string | null): string | undefined {
  return iso ? new Date(iso).toLocaleString() : undefined;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "3 new, 1 updated" for a toast; "no changes" when nothing moved. */
function summarize(r: { created: number; updated: number; removed: number }): string {
  const parts = [];
  if (r.created) parts.push(`${r.created} new`);
  if (r.updated) parts.push(`${r.updated} updated`);
  if (r.removed) parts.push(`${r.removed} removed`);
  return parts.length ? parts.join(", ") : "no changes";
}

function reportSync(name: string, r: CalendarSyncResult) {
  if (r.status === "error") toast(`${name}: ${r.error ?? "sync failed"}`, "error");
  else if (r.status === "skipped") toast(`${name}: ${r.error ?? "skipped"}`, "info");
  else if (r.status === "not_modified") toast(`${name} is up to date`);
  else toast(`${name} synced: ${summarize(r)}`);
  for (const w of r.warnings.slice(0, 2)) toast(w, "info");
}

/** Settings → Calendars: ICS URL subscriptions (kept in sync) and
 * one-time .ics file imports. Imported events show up in the calendar
 * alongside your own, read-only. */
export default function CalendarsSection() {
  const [subs, setSubs] = useState<CalendarSubscription[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api
      .listCalendarSubscriptions()
      .then((r) => {
        setSubs(r.subscriptions);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Couldn't load calendars"));
  }, []);

  // Background syncs happen on the server; refresh the status now and then.
  useEffect(() => {
    reload();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 60_000);
    return () => clearInterval(id);
  }, [reload]);

  const changed = useCallback(() => {
    reload();
    notifyEventsChanged();
  }, [reload]);

  const urls = subs?.filter((s) => s.source_type === "url") ?? [];
  const files = subs?.filter((s) => s.source_type === "file") ?? [];

  return (
    <section id="calendars" className="scroll-mt-6 space-y-3">
      <h2 className={SECTION_HEADING}>
        <CalendarDotsIcon weight="bold" className="h-4 w-4 text-accent" aria-hidden />
        Calendars
      </h2>
      <div className={`divide-y divide-line ${CARD}`}>
        <div className="space-y-1 p-5">
          <p className={`text-sm ${MUTED}`}>
            Subscribe to any calendar that gives you an ICS link (Canvas, school or team calendars, Google
            Calendar&apos;s secret iCal address). Look re-checks the link on its schedule, so new assignments, moved
            deadlines and cancellations show up on their own. Its events appear in your calendar, read-only.
          </p>
        </div>

        {loadError && (
          <p role="alert" className="flex items-center gap-2 px-5 py-3 text-sm text-danger">
            <WarningCircleIcon weight="fill" className="h-4 w-4 shrink-0" aria-hidden />
            {loadError}
          </p>
        )}

        {subs === null && !loadError ? (
          <div className="flex items-center gap-2 px-5 py-4 text-sm text-fg-muted">
            <CircleNotchIcon className="h-4 w-4 animate-spin" aria-hidden />
            Loading calendars
          </div>
        ) : (
          <>
            {urls.map((s) => (
              <SubscriptionRow key={s.id} sub={s} onChanged={changed} />
            ))}
            {files.map((s) => (
              <SubscriptionRow key={s.id} sub={s} onChanged={changed} />
            ))}
            {subs && subs.length === 0 && (
              <p className={`px-5 py-4 text-sm ${FAINT}`}>No calendars yet. Add a link or drop an .ics file below.</p>
            )}
          </>
        )}

        <AddCalendarForm onAdded={changed} />
        <ImportDropzone onImported={changed} />
      </div>
    </section>
  );
}

function SubscriptionRow({ sub, onChanged }: { sub: CalendarSubscription; onChanged: () => void }) {
  const isUrl = sub.source_type === "url";
  const [busy, setBusy] = useState<null | "sync" | "toggle" | "save" | "remove">(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sub.name);
  const [interval, setInterval_] = useState(sub.sync_interval_minutes);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function act(kind: NonNullable<typeof busy>, action: () => Promise<void>) {
    setBusy(kind);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  }

  const syncNow = () =>
    act("sync", async () => {
      try {
        reportSync(sub.name, await api.syncCalendarSubscription(sub.id));
      } catch (e) {
        toastError(e, "Couldn't sync");
      }
      onChanged();
    });

  const toggle = () =>
    act("toggle", async () => {
      try {
        await api.updateCalendarSubscription(sub.id, { enabled: !sub.enabled });
        toast(sub.enabled ? `Paused ${sub.name}; its events stay` : `Resumed ${sub.name}`, "info");
        onChanged();
      } catch (e) {
        toastError(e, "Couldn't change it");
      }
    });

  const save = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!name.trim()) return;
    act("save", async () => {
      try {
        await api.updateCalendarSubscription(sub.id, {
          name: name.trim(),
          ...(isUrl ? { sync_interval_minutes: interval } : {}),
        });
        setEditing(false);
        onChanged();
      } catch (e) {
        toastError(e, "Couldn't save");
      }
    });
  };

  const remove = (keepEvents: boolean) =>
    act("remove", async () => {
      try {
        const r = await api.deleteCalendarSubscription(sub.id, keepEvents);
        toast(
          keepEvents
            ? `Removed ${sub.name}; kept ${plural(r.events_kept, "event")} as your own`
            : `Removed ${sub.name} and ${plural(r.events_deleted, "event")}`,
          "info"
        );
        onChanged();
      } catch (e) {
        toastError(e, "Couldn't remove it");
        setConfirmRemove(false);
      }
    });

  const failing = Boolean(sub.last_error);

  return (
    <div className="space-y-2 px-5 py-4">
      {editing ? (
        <form onSubmit={save} className="flex flex-wrap items-end gap-2">
          <label className={`block min-w-48 flex-1 ${LABEL}`}>
            Name
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={`mt-1.5 h-9 w-full ${FIELD}`} />
          </label>
          {isUrl && (
            <label className={`block ${LABEL}`}>
              Sync
              <select value={interval} onChange={(e) => setInterval_(Number(e.target.value))} className={`mt-1.5 h-9 ${FIELD}`}>
                {INTERVALS.map((i) => (
                  <option key={i.minutes} value={i.minutes}>
                    {i.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" disabled={busy !== null || !name.trim()} className={`h-9 ${BUTTON_PRIMARY}`}>
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setName(sub.name);
              setInterval_(sub.sync_interval_minutes);
            }}
            className={`h-9 ${BUTTON_SECONDARY}`}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
              {sub.name}
              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
                {isUrl ? (sub.enabled ? intervalLabel(sub.sync_interval_minutes) : "Paused") : "Uploaded file"}
              </span>
            </p>
            {isUrl && sub.source_url && (
              <p className={`mt-0.5 truncate font-mono text-xs ${FAINT}`} title={sub.source_url}>
                {sub.source_url}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isUrl && (
              <>
                <button type="button" onClick={syncNow} disabled={busy !== null || !sub.enabled} className={BUTTON_GHOST_SM}>
                  <ArrowsClockwiseIcon className={`h-3.5 w-3.5 ${busy === "sync" ? "animate-spin" : ""}`} aria-hidden />
                  {busy === "sync" ? "Syncing" : "Sync now"}
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={sub.enabled}
                  aria-label={`Sync ${sub.name} automatically`}
                  title={sub.enabled ? "Pause syncing" : "Resume syncing"}
                  onClick={toggle}
                  disabled={busy !== null}
                  className={`relative mx-1 h-5 w-8 shrink-0 rounded-full transition-colors duration-150 disabled:opacity-45 ${
                    sub.enabled ? "bg-accent" : "bg-line-strong"
                  }`}
                >
                  <span
                    className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-surface shadow-sm transition-transform duration-150 ${
                      sub.enabled ? "translate-x-3" : ""
                    }`}
                  />
                </button>
              </>
            )}
            <button type="button" onClick={() => setEditing(true)} disabled={busy !== null} className={BUTTON_GHOST_SM} aria-label={`Edit ${sub.name}`}>
              <PencilSimpleIcon className="h-3.5 w-3.5" aria-hidden />
              Edit
            </button>
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              disabled={busy !== null}
              className={`${BUTTON_GHOST_SM} hover:text-danger`}
              aria-label={`Remove ${sub.name}`}
            >
              <TrashIcon className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}

      <p className={`flex flex-wrap gap-x-3 gap-y-0.5 text-xs ${MUTED}`}>
        <span>{plural(sub.event_count, "event")}</span>
        {isUrl ? (
          <>
            <span title={absolute(sub.last_success_at)}>Last successful sync {relative(sub.last_success_at)}</span>
            {failing && sub.last_sync_at !== sub.last_success_at && (
              <span title={absolute(sub.last_sync_at)}>Last attempt {relative(sub.last_sync_at)}</span>
            )}
            {sub.enabled && sub.next_sync_at && <span title={absolute(sub.next_sync_at)}>Next check {relative(sub.next_sync_at)}</span>}
            {sub.last_result && !failing && <span className={FAINT}>Last change: {summarize(sub.last_result)}</span>}
          </>
        ) : (
          <span title={absolute(sub.last_success_at)}>Imported {relative(sub.last_success_at)}. Doesn&apos;t update; upload it again to refresh.</span>
        )}
      </p>

      {failing && (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          <WarningCircleIcon weight="fill" className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {sub.last_error} Existing events were left as they were; Look will try again
            {sub.enabled ? ` ${relative(sub.next_sync_at)}` : " when you resume syncing"}.
          </span>
        </p>
      )}

      {confirmRemove && (
        <div className="space-y-3 rounded-lg border border-line bg-surface-2/60 p-3">
          <p className="text-sm text-fg">
            Remove <span className="font-medium">{sub.name}</span>? What should happen to its{" "}
            {plural(sub.event_count, "event")}?
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => remove(false)}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-3 py-2 text-sm font-medium text-surface disabled:opacity-45"
            >
              {busy === "remove" && <CircleNotchIcon className="h-4 w-4 animate-spin" aria-hidden />}
              Delete its events
            </button>
            <button type="button" onClick={() => remove(true)} disabled={busy !== null} className={BUTTON_SECONDARY}>
              Keep them as my events
            </button>
            <button type="button" onClick={() => setConfirmRemove(false)} disabled={busy !== null} className={BUTTON_SECONDARY}>
              Cancel
            </button>
          </div>
          <p className={`text-xs ${FAINT}`}>Kept events become normal Look events you can edit; they stop syncing.</p>
        </div>
      )}
    </div>
  );
}

function AddCalendarForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [interval, setInterval_] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!name.trim() || !url.trim()) return setError("Give the calendar a name and its ICS link.");
    setBusy(true);
    setError(null);
    try {
      const r = await api.addCalendarSubscription({ name: name.trim(), url: url.trim(), sync_interval_minutes: interval });
      if (r.status === "error") {
        toast(`Added ${name.trim()}, but the first sync failed: ${r.error}`, "error");
      } else {
        toast(`Added ${name.trim()}: ${plural(r.created, "event")}`);
      }
      setName("");
      setUrl("");
      setInterval_(30);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the calendar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 p-5">
      <p className="text-sm font-medium text-fg">Add calendar</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <label className={`block ${LABEL}`}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Canvas" maxLength={100} className={`mt-1.5 h-10 w-full ${FIELD}`} />
        </label>
        <label className={`block ${LABEL}`}>
          ICS URL
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://canvas.example.edu/feeds/calendars/user_….ics"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className={`mt-1.5 h-10 w-full font-mono text-xs ${FIELD}`}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className={`block ${LABEL}`}>
          Sync
          <select value={interval} onChange={(e) => setInterval_(Number(e.target.value))} className={`mt-1.5 h-10 ${FIELD}`}>
            {INTERVALS.map((i) => (
              <option key={i.minutes} value={i.minutes}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy} className={`h-10 ${BUTTON_PRIMARY}`}>
          {busy && <CircleNotchIcon className="h-4 w-4 animate-spin" aria-hidden />}
          {busy ? "Adding" : "Add calendar"}
        </button>
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <WarningCircleIcon weight="fill" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </form>
  );
}

function ImportDropzone({ onImported }: { onImported: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".ics") && file.type !== "text/calendar") {
      setError(`${file.name} isn't an .ics calendar file.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.importIcsFile(file);
      toast(`Imported ${r.subscription?.name ?? file.name}: ${r.created} added, ${r.updated} updated`);
      for (const w of r.warnings.slice(0, 2)) toast(w, "info");
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't import the file");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-3 p-5">
      <p className="text-sm font-medium text-fg">Import an .ics file</p>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(e.dataTransfer.files[0]);
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition-colors duration-150 ${
          dragging ? "border-accent bg-accent-soft" : "border-line-strong"
        }`}
      >
        {busy ? (
          <CircleNotchIcon className="h-6 w-6 animate-spin text-accent" aria-hidden />
        ) : (
          <FileArrowUpIcon className="h-6 w-6 text-fg-faint" aria-hidden />
        )}
        <p className="text-sm text-fg-muted">
          {busy ? "Importing" : "Drop an .ics file here, or"}{" "}
          {!busy && (
            <button type="button" onClick={() => input.current?.click()} className="font-medium text-accent-text underline-offset-4 hover:underline">
              choose one
            </button>
          )}
        </p>
        <input
          ref={input}
          type="file"
          accept=".ics,text/calendar"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose an .ics file"
          onChange={(e) => upload(e.target.files?.[0])}
        />
      </div>
      <p className={`text-xs ${FAINT}`}>
        Uploaded files are snapshots and don&apos;t update automatically. Subscribe with a URL for continuous
        syncing. Uploading a file with the same name again updates that import instead of duplicating it.
      </p>
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <WarningCircleIcon weight="fill" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
