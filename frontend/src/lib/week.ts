// Calendar weeks run Monday to Sunday everywhere in Look (the backend's
// app.utils.week_start agrees). Plain date strings ("YYYY-MM-DD"), local
// time, no timezone math.
import { addDaysIso } from "./format.ts";

/** The Monday of the week containing `iso`. */
export function weekStartIso(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).getDay(); // 0 = Sunday
  return addDaysIso(iso, -((weekday + 6) % 7));
}

/** Monday..Sunday of the week containing `iso`. */
export function weekRangeIso(iso: string): { start: string; end: string } {
  const start = weekStartIso(iso);
  return { start, end: addDaysIso(start, 6) };
}
