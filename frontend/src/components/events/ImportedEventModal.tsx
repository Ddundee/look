"use client";

import Link from "next/link";
import { ArrowSquareOutIcon, CalendarDotsIcon, MapPinIcon } from "@phosphor-icons/react";
import { isInstant, timeLabel } from "@/lib/calendarEvents";
import { addDaysIso, formatDateLong } from "@/lib/format";
import type { Occurrence } from "@/lib/types";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, MUTED } from "@/lib/ui";
import Dialog from "../Dialog";

/** Details of an event that comes from a calendar subscription. The feed
 * owns it, so it can't be edited here: changes are made at the source and
 * arrive with the next sync. */
export default function ImportedEventModal({ occ, onClose }: { occ: Occurrence; onClose: () => void }) {
  const source = occ.subscription_name ?? "a subscribed calendar";
  const day = occ.start_at.slice(0, 10);
  const lastDay = occ.all_day ? addDaysIso(occ.end_at.slice(0, 10), -1) : occ.end_at.slice(0, 10);

  let when = formatDateLong(day);
  if (occ.all_day) {
    if (lastDay > day) when += ` to ${formatDateLong(lastDay)}`;
  } else if (isInstant(occ)) {
    when += `, ${timeLabel(occ.start_at)}`;
  } else {
    when += `, ${timeLabel(occ.start_at)} to ${timeLabel(occ.end_at)}`;
    if (lastDay > day) when += ` (${formatDateLong(lastDay)})`;
  }

  return (
    <Dialog
      title={occ.title}
      size="sm"
      hint={false}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        onClose();
      }}
      footer={
        <>
          <Link href="/settings#calendars" onClick={onClose} className={BUTTON_SECONDARY}>
            Manage calendars
          </Link>
          {occ.external_url ? (
            <a href={occ.external_url} target="_blank" rel="noopener noreferrer" className={BUTTON_PRIMARY}>
              Open source
              <ArrowSquareOutIcon className="h-4 w-4" aria-hidden />
            </a>
          ) : (
            <button type="submit" className={BUTTON_PRIMARY}>
              Done
            </button>
          )}
        </>
      }
    >
      {occ.external_status === "removed" ? (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-muted">
          No longer in {source}. It was removed or unpublished there, so it&apos;s hidden from your calendar.
        </p>
      ) : occ.external_status === "cancelled" ? (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Cancelled in {source}.</p>
      ) : null}

      <p className="text-sm text-fg">{when}</p>
      {occ.location && (
        <p className={`flex items-center gap-1.5 text-sm ${MUTED}`}>
          <MapPinIcon className="h-4 w-4 shrink-0" aria-hidden />
          {occ.location}
        </p>
      )}
      {occ.notes && (
        <p className={`max-h-48 overflow-y-auto whitespace-pre-line text-sm leading-relaxed [overflow-wrap:anywhere] ${MUTED}`}>
          {occ.notes}
        </p>
      )}

      <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs leading-relaxed text-fg-muted">
        <CalendarDotsIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        <span>
          From <span className="font-medium text-fg">{source}</span>. It&apos;s read-only in Look: change it in the
          source calendar and it updates here on the next sync.
        </span>
      </p>
    </Dialog>
  );
}
