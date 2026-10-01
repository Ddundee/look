// Helpers for calendar events: category markers, time labels, and the
// repeat presets shown in the event form, which map to and from RRULEs.

export const EVENT_CATEGORIES = ["class", "social", "sports", "work", "appointment", "other"] as const;

// A colored marker beside the category name (never color alone). Classes
// are spelled out in full for Tailwind's static scanner.
const HUES: Record<string, string> = {
  class: "text-amber-500",
  social: "text-pink-500",
  sports: "text-emerald-500",
  work: "text-violet-500",
  appointment: "text-orange-600 dark:text-orange-400",
  other: "text-fg-faint",
};

export function eventHue(category: string): string {
  return HUES[category] ?? "text-fg-faint";
}

/** "10:00 AM" from a local ISO datetime (no timezone suffix = local). */
export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "10a", "2:30p": for tight month-grid cells. */
export function compactTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h < 12 ? "a" : "p";
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
}

/** Split "2026-08-24T10:00:00" into the values date/time inputs use. */
export function splitLocal(iso: string): { date: string; time: string } {
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) || "00:00" };
}

export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export const WEEKDAYS: { code: Weekday; short: string; name: string }[] = [
  { code: "MO", short: "Mo", name: "Monday" },
  { code: "TU", short: "Tu", name: "Tuesday" },
  { code: "WE", short: "We", name: "Wednesday" },
  { code: "TH", short: "Th", name: "Thursday" },
  { code: "FR", short: "Fr", name: "Friday" },
  { code: "SA", short: "Sa", name: "Saturday" },
  { code: "SU", short: "Su", name: "Sunday" },
];

const ORDER = WEEKDAYS.map((w) => w.code);
const WEEKDAY_SET = "MO,TU,WE,TH,FR";

export type RepeatKind = "none" | "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "custom";
export type EndKind = "never" | "until" | "count";

export interface Repeat {
  kind: RepeatKind;
  days: Weekday[];
  end: EndKind;
  until: string; // YYYY-MM-DD
  count: number;
  custom: string; // raw RRULE when kind === "custom"
}

export function weekdayOf(dateIso: string): Weekday {
  const [y, m, d] = dateIso.split("-").map(Number);
  return (["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as Weekday[])[new Date(y, m - 1, d).getDay()];
}

export function defaultRepeat(dateIso: string): Repeat {
  return { kind: "none", days: [weekdayOf(dateIso)], end: "never", until: "", count: 10, custom: "" };
}

function sortDays(days: Weekday[]): Weekday[] {
  return [...new Set(days)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
}

export function buildRrule(r: Repeat, dateIso: string): string | null {
  if (r.kind === "none") return null;
  if (r.kind === "custom") return r.custom.trim() || null;
  const days = sortDays(r.days.length ? r.days : [weekdayOf(dateIso)]).join(",");
  const base = {
    daily: "FREQ=DAILY",
    weekdays: `FREQ=WEEKLY;BYDAY=${WEEKDAY_SET}`,
    weekly: `FREQ=WEEKLY;BYDAY=${days}`,
    biweekly: `FREQ=WEEKLY;INTERVAL=2;BYDAY=${days}`,
    monthly: "FREQ=MONTHLY",
  }[r.kind];
  if (r.end === "until" && r.until) return `${base};UNTIL=${r.until.replaceAll("-", "")}`;
  if (r.end === "count" && r.count > 0) return `${base};COUNT=${r.count}`;
  return base;
}

/** Map a stored RRULE back onto a preset; anything else is "custom". */
export function parseRrule(rule: string | null, dateIso: string): Repeat {
  const r = defaultRepeat(dateIso);
  if (!rule) return r;
  const parts: Record<string, string> = {};
  for (const piece of rule.split(";")) {
    const [k, v] = piece.split("=");
    if (k && v !== undefined) parts[k.toUpperCase()] = v.toUpperCase();
  }
  const { UNTIL, COUNT, ...rest } = parts;
  const days = (rest.BYDAY ?? "").split(",").filter(Boolean);
  const plain = days.every((d) => (ORDER as string[]).includes(d));
  const keys = Object.keys(rest).sort().join(",");

  let kind: RepeatKind | null = null;
  if (keys === "FREQ" && rest.FREQ === "DAILY") kind = "daily";
  else if (keys === "FREQ" && rest.FREQ === "MONTHLY") kind = "monthly";
  else if (keys === "FREQ" && rest.FREQ === "WEEKLY") kind = "weekly";
  else if (keys === "BYDAY,FREQ" && rest.FREQ === "WEEKLY" && plain)
    kind = sortDays(days as Weekday[]).join(",") === WEEKDAY_SET ? "weekdays" : "weekly";
  else if (keys === "BYDAY,FREQ,INTERVAL" && rest.FREQ === "WEEKLY" && rest.INTERVAL === "2" && plain)
    kind = "biweekly";

  if (!kind) return { ...r, kind: "custom", custom: rule };
  return {
    ...r,
    kind,
    days: days.length && plain ? sortDays(days as Weekday[]) : r.days,
    end: UNTIL ? "until" : COUNT ? "count" : "never",
    until: UNTIL ? `${UNTIL.slice(0, 4)}-${UNTIL.slice(4, 6)}-${UNTIL.slice(6, 8)}` : "",
    count: COUNT ? Number(COUNT) : r.count,
  };
}
