// Pure helpers for the daily widgets (Daily Floor, Today's 3, While AI
// runs). Kept out of components so they can be tested.

/** A trailing duration typed into a quick add, e.g. "Read one article 15m",
 * "Pushups 5 min", "Notes (1h)", "Apply 1h30m". */
export function parseQuickDuration(text: string): { title: string; minutes: number | null } {
  const trimmed = text.trim();
  const m = trimmed.match(/^(.*?)[\s,]*\(?\s*(?:(\d{1,2})\s*h(?:ours?|rs?)?)?\s*(?:(\d{1,3})\s*m(?:in(?:ute)?s?)?)?\s*\)?$/i);
  if (m && (m[2] || m[3]) && m[1].trim()) {
    const minutes = Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
    if (minutes > 0 && minutes <= 24 * 60) return { title: m[1].trim(), minutes };
  }
  return { title: trimmed, minutes: null };
}

/** "15m", "1h", "1h 30m". */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

/** Width of a progress bar, 0-100. */
export function progressPercent(done: number, total: number): number {
  return total > 0 ? Math.round((Math.min(done, total) / total) * 100) : 0;
}

/** Same matching as the backend (app.services.tasks.has_tag): case and a
 * leading '#' don't matter. */
export function hasTag(task: { tags: string[] }, tag: string): boolean {
  return task.tags.some((t) => t.trim().replace(/^#/, "").toLowerCase() === tag);
}

/** Tasks that could become one of today's 3: open, not already planned for
 * today, not a Daily Floor item, matching the filter text. Keeps the
 * given (ranked) order. */
export function todaysThreeCandidates<T extends { id: string; title: string; tags: string[]; planned_for_date: string | null }>(
  ranked: T[],
  today: string,
  filter = "",
): T[] {
  const q = filter.trim().toLowerCase();
  return ranked.filter(
    (t) => t.planned_for_date !== today && !hasTag(t, "daily-floor") && (!q || t.title.toLowerCase().includes(q)),
  );
}

/** Would checking this task off finish the Daily Floor? (for the one-time
 * "day won" animation, decided at click time rather than on render) */
export function completesFloor(items: { id: string; done: boolean }[], toggledId: string): boolean {
  return items.length > 0 && items.every((i) => i.done || i.id === toggledId) && items.some((i) => i.id === toggledId && !i.done);
}
