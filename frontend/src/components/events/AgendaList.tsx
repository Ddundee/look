"use client";

import { ArrowsClockwiseIcon, CalendarDotsIcon, MapPinIcon } from "@phosphor-icons/react";
import { eventHue, isInstant, timeLabel } from "@/lib/calendarEvents";
import type { Occurrence } from "@/lib/types";
import { CARD_LIST } from "@/lib/ui";
import DeadlineCheckbox from "./DeadlineCheckbox";

/** Time-ordered events for a day. Each row opens the event. */
export default function AgendaList({
  occurrences,
  onOpen,
  bare = false,
}: {
  occurrences: Occurrence[];
  onOpen: (occ: Occurrence) => void;
  /** Inside a Panel, which already provides the card. */
  bare?: boolean;
}) {
  return (
    <ul className={`anim-stagger ${bare ? "" : CARD_LIST}`}>
      {occurrences.map((o, i) => (
        <li
          key={`${o.event_id}-${o.occurrence_date}`}
          style={{ "--i": i } as React.CSSProperties}
          className="flex items-start rounded-lg transition-colors duration-150 hover:bg-surface-2/70 focus-within:bg-surface-2/70"
        >
          {/* Deadlines (imported assignments) can be checked off like tasks;
              a cancelled one can't, completion isn't cancellation. */}
          {o.deadline && !o.cancelled && (
            <span className="pl-3 pt-[11px]">
              <DeadlineCheckbox eventId={o.event_id} title={o.title} completed={o.completed} />
            </span>
          )}
          <button
            type="button"
            onClick={() => onOpen(o)}
            className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left"
          >
            <span className="w-[4.5rem] shrink-0 font-mono text-xs leading-5 tabular-nums text-fg-muted">
              {o.all_day ? (
                "All day"
              ) : (
                <>
                  {timeLabel(o.start_at)}
                  {!isInstant(o) && <span className="block text-fg-faint">{timeLabel(o.end_at)}</span>}
                </>
              )}
            </span>
            <span className={`mt-0.5 w-0.5 shrink-0 self-stretch rounded-full bg-current ${eventHue(o.category)}`} aria-hidden />
            <span className="min-w-0 flex-1">
              <span
                className={`block text-sm leading-5 [overflow-wrap:anywhere] ${
                  o.cancelled
                    ? "text-fg-faint line-through"
                    : o.completed
                      ? "text-fg-faint line-through decoration-fg-faint/60"
                      : "text-fg"
                }`}
              >
                {o.title}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-muted">
                {o.subscription_name ? (
                  <span className="inline-flex items-center gap-1" title={`From ${o.subscription_name} (read-only)`}>
                    <CalendarDotsIcon className="h-3.5 w-3.5" aria-hidden />
                    {o.subscription_name}
                  </span>
                ) : (
                  <span className="capitalize">{o.category}</span>
                )}
                {o.location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPinIcon className="h-3.5 w-3.5" aria-hidden />
                    {o.location}
                  </span>
                )}
                {o.recurring && (
                  <span className="inline-flex items-center" title="Repeats">
                    <ArrowsClockwiseIcon className="h-3.5 w-3.5" aria-hidden />
                    <span className="sr-only">Repeats</span>
                  </span>
                )}
                {o.external_status === "removed" ? (
                  <span className="text-fg-faint">Removed from feed</span>
                ) : o.cancelled ? (
                  <span className="font-medium text-danger">Cancelled</span>
                ) : o.completed ? (
                  <span className="text-fg-faint">
                    Done{o.completion_source === "external" && o.subscription_name ? ` in ${o.subscription_name}` : ""}
                  </span>
                ) : o.overridden ? (
                  <span className="text-fg-faint">Changed for this date</span>
                ) : null}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
