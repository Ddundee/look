// "Now" for daily timelines, in the app's timezone (APP_TIMEZONE), not the
// browser's: event times are wall-clock times there.

/** The current local time in `timeZone` as "YYYY-MM-DDTHH:MM", directly
 * comparable with event start_at/end_at strings. */
export function zonedNow(timeZone: string | null | undefined, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export interface TimedItem {
  start_at: string;
  end_at: string;
  all_day: boolean;
}

/** Where now falls in a day's chronological list: `before` is the index the
 * marker goes before (items.length = after everything), `active` the
 * indexes of timed items happening right now. All-day items are neither. */
export function nowPlacement(items: TimedItem[], now: string): { before: number; active: Set<number> } {
  const active = new Set<number>();
  let before = items.length;
  items.forEach((item, i) => {
    if (item.all_day) return;
    const start = item.start_at.slice(0, 16);
    const end = item.end_at.slice(0, 16);
    if (start <= now && now < end) active.add(i);
    if (before === items.length && start > now) before = i;
  });
  return { before, active };
}

/** Milliseconds until the next minute starts, to tick on the minute. */
export function msToNextMinute(at: Date = new Date()): number {
  return 60_000 - (at.getSeconds() * 1000 + at.getMilliseconds());
}
