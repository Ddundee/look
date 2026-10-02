"use client";

import { useEffect, useRef } from "react";
import { ArrowsClockwiseIcon, CalendarDotsIcon, MapPinIcon } from "@phosphor-icons/react";
import { isInstant, timeLabel } from "@/lib/calendarEvents";
import { nowPlacement } from "@/lib/now";
import { titleWithoutCourse } from "@/lib/palette";
import type { Occurrence } from "@/lib/types";
import { CARD_LIST } from "@/lib/ui";
import { CategoryTag, CourseBadge, ItemEdge, useLook } from "../look/Look";
import DeadlineCheckbox from "./DeadlineCheckbox";

/** "Now · 12:47 PM": where the current time falls in today's list. */
export function NowLine({ now }: { now: string }) {
  const label = timeLabel(`${now}:00`);
  return (
    <li role="separator" aria-label={`Now, ${label}`} data-now-line className="flex items-center gap-2 px-3 py-1">
      <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
      <span className="shrink-0 font-mono text-[11px] font-medium tabular-nums text-accent-text">Now · {label}</span>
      <span className="h-px flex-1 bg-accent/50" aria-hidden />
    </li>
  );
}

/** Scroll the nearest scrolling ancestor so `target` sits about a third of
 * the way down. Never touches the page itself. */
function scrollIntoPanel(target: HTMLElement) {
  let el = target.parentElement;
  while (el && el !== document.body) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1) {
      const offset = target.getBoundingClientRect().top - el.getBoundingClientRect().top;
      el.scrollTop += offset - el.clientHeight / 3;
      return;
    }
    el = el.parentElement;
  }
}

/** Once a timeline has items, scroll its panel to what's happening now
 * (or the Now line). Only once per mount, so it never fights the user;
 * `enabled` is false for any day other than today. */
export function useScrollToNow(listRef: React.RefObject<HTMLElement | null>, enabled: boolean, itemCount: number) {
  const scrolled = useRef(false);
  useEffect(() => {
    if (!enabled || scrolled.current || itemCount === 0 || !listRef.current) return;
    scrolled.current = true;
    const target =
      listRef.current.querySelector<HTMLElement>("[data-active-now]") ??
      listRef.current.querySelector<HTMLElement>("[data-now-line]");
    if (target) scrollIntoPanel(target);
  }, [enabled, itemCount, listRef]);
}

/** Time-ordered events for a day. Each row opens the event.
 *
 * Pass `now` ("YYYY-MM-DDTHH:MM", useNow()) only when the list is today's:
 * it adds the Now line and marks what's happening right now. With
 * `scrollToNow`, a list inside a scrolling panel scrolls to the current
 * part of the day once, after it first renders with items, and never again
 * (so it doesn't fight the user). */
export default function AgendaList({
  occurrences,
  onOpen,
  bare = false,
  now,
  scrollToNow = false,
}: {
  occurrences: Occurrence[];
  onOpen: (occ: Occurrence) => void;
  /** Inside a Panel, which already provides the card. */
  bare?: boolean;
  now?: string;
  scrollToNow?: boolean;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const placement = now ? nowPlacement(occurrences, now) : null;
  useScrollToNow(listRef, scrollToNow && !!now, occurrences.length);

  return (
    <ul ref={listRef} className={`anim-stagger ${bare ? "" : CARD_LIST}`}>
      {occurrences.map((o, i) => (
        <AgendaRowGroup
          key={`${o.event_id}-${o.occurrence_date}`}
          occ={o}
          index={i}
          onOpen={onOpen}
          nowBefore={placement !== null && placement.before === i ? now : undefined}
          active={placement?.active.has(i) ?? false}
        />
      ))}
      {placement !== null && placement.before === occurrences.length && occurrences.length > 0 && now && <NowLine now={now} />}
    </ul>
  );
}

function AgendaRowGroup({
  occ,
  index,
  onOpen,
  nowBefore,
  active,
}: {
  occ: Occurrence;
  index: number;
  onOpen: (occ: Occurrence) => void;
  nowBefore?: string;
  active: boolean;
}) {
  return (
    <>
      {nowBefore && <NowLine now={nowBefore} />}
      <AgendaRow occ={occ} index={index} onOpen={onOpen} active={active} />
    </>
  );
}

function AgendaRow({ occ: o, index, onOpen, active }: { occ: Occurrence; index: number; onOpen: (occ: Occurrence) => void; active: boolean }) {
  const look = useLook(o);
  return (
    <li
      style={{ "--i": index } as React.CSSProperties}
      data-active-now={active || undefined}
      className={`flex items-start rounded-lg transition-colors duration-150 hover:bg-surface-2/70 focus-within:bg-surface-2/70 ${
        active ? "bg-accent-soft/60" : ""
      }`}
    >
      {/* Deadlines (imported assignments) can be checked off like tasks;
          a cancelled one can't, completion isn't cancellation. */}
      {o.deadline && !o.cancelled && (
        <span className="pl-3 pt-[11px]">
          <DeadlineCheckbox eventId={o.event_id} title={o.title} completed={o.completed} />
        </span>
      )}
      <button type="button" onClick={() => onOpen(o)} className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left">
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
        <ItemEdge look={look} className="mt-0.5" />
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
            {titleWithoutCourse(o.title, o.course)}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-muted">
            {active && <span className="rounded-md bg-accent px-1.5 py-px text-[11px] font-medium text-accent-fg">Now</span>}
            {/* One identity, not a stack of badges: the course if there is
                one (that already says school), else the category; the feed
                name only for imports without a course. */}
            {o.course ? <CourseBadge course={o.course} /> : !o.subscription_name && <CategoryTag category={o.category} />}
            {o.subscription_name && !o.course && (
              <span className="inline-flex items-center gap-1" title={`From ${o.subscription_name} (read-only)`}>
                <CalendarDotsIcon className="h-3.5 w-3.5" aria-hidden />
                {o.subscription_name}
              </span>
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
  );
}
