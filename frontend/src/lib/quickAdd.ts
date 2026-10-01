import type { TaskCreatePayload } from "./types";
import { addDaysIso, todayIso } from "./format";

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};

const CATEGORY_KEYWORDS: Record<string, string> = {
  leetcode: "LeetCode",
  dsa: "LeetCode",
  school: "school",
  homework: "school",
  assignment: "school",
  assignments: "school",
  project: "project",
  projects: "project",
  errand: "errands",
  errands: "errands",
};

function nextWeekday(target: number): string {
  const today = new Date();
  const todayIdx = today.getDay();
  let delta = (target - todayIdx + 7) % 7;
  if (delta === 0) delta = 7; // "monday" means the upcoming one, not today
  return addDaysIso(todayIso(), delta);
}

/** Parse "Sept 18", "September 18th", "9/18", "9/18/2026" -> ISO date, or null. */
function parseExplicitDate(text: string): { iso: string; matched: string } | null {
  const monthDay = text.match(
    /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?\s+(\d{1,2})(st|nd|rd|th)?\b(?:,?\s*(\d{4}))?/i
  );
  if (monthDay) {
    const month = MONTHS[monthDay[1].toLowerCase()];
    const day = parseInt(monthDay[2], 10);
    const now = new Date();
    let year = monthDay[4] ? parseInt(monthDay[4], 10) : now.getFullYear();
    let candidate = new Date(year, month, day);
    if (!monthDay[4] && candidate.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
      year += 1;
      candidate = new Date(year, month, day);
    }
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return { iso, matched: monthDay[0] };
  }

  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    const month = parseInt(slash[1], 10) - 1;
    const day = parseInt(slash[2], 10);
    const now = new Date();
    let year = slash[3] ? parseInt(slash[3].length === 2 ? "20" + slash[3] : slash[3], 10) : now.getFullYear();
    const candidate = new Date(year, month, day);
    if (!slash[3] && candidate.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
      year += 1;
    }
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return { iso, matched: slash[0] };
  }

  return null;
}

export interface ParsedQuickAdd {
  payload: TaskCreatePayload;
  matchedFragments: string[];
}

/**
 * Best-effort local parser for quick task entry, e.g.
 * "Finish problem set 3 due Sept 18 high priority". No AI/LLM involved — if
 * nothing structured is recognized the whole string just becomes the
 * title of a new inbox task, which is always a safe fallback.
 */
export function parseQuickAdd(raw: string): ParsedQuickAdd {
  let remaining = raw.trim();
  const matched: string[] = [];
  const payload: TaskCreatePayload = { title: raw.trim(), status: "inbox" };

  // Priority
  const priorityMatch = remaining.match(/\b(critical|high|medium|low)(?:\s+priority)?\b/i);
  if (priorityMatch) {
    payload.priority = priorityMatch[1].toLowerCase() as TaskCreatePayload["priority"];
    matched.push(priorityMatch[0]);
    remaining = remaining.replace(priorityMatch[0], " ");
  }

  // Due date: "due <...>", "by <...>", bare weekday/today/tomorrow (or "tmrw"), or explicit date
  const dueClause = remaining.match(/\b(?:due|by)\s+([a-z0-9,./\s]+?)(?=$|,|\bhigh\b|\bmedium\b|\blow\b|\bcritical\b)/i);
  const dateSource = dueClause ? dueClause[1] : remaining;

  let isoDate: string | null = null;
  let dateFragmentToStrip: string | null = dueClause ? dueClause[0] : null;

  if (/\btoday\b/i.test(dateSource)) {
    isoDate = todayIso();
    dateFragmentToStrip = dueClause ? dueClause[0] : (dateSource.match(/\btoday\b/i)?.[0] ?? null);
  } else if (/\b(?:tomorrow|tmrw)\b/i.test(dateSource)) {
    isoDate = addDaysIso(todayIso(), 1);
    dateFragmentToStrip = dueClause ? dueClause[0] : (dateSource.match(/\b(?:tomorrow|tmrw)\b/i)?.[0] ?? null);
  } else {
    const weekdayMatch = dateSource.match(
      /\b(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat)\b/i
    );
    const explicit = parseExplicitDate(dateSource);
    if (explicit) {
      isoDate = explicit.iso;
      dateFragmentToStrip = dueClause ? dueClause[0] : explicit.matched;
    } else if (weekdayMatch) {
      isoDate = nextWeekday(WEEKDAYS[weekdayMatch[1].toLowerCase()]);
      dateFragmentToStrip = dueClause ? dueClause[0] : weekdayMatch[0];
    }
  }

  if (isoDate) {
    payload.due_date = isoDate;
    payload.status = "todo"; // we have enough info to schedule it, no need for inbox triage
    if (dateFragmentToStrip) {
      matched.push(dateFragmentToStrip.trim());
      remaining = remaining.replace(dateFragmentToStrip, " ");
    }
  }

  // Category
  const lowerRemaining = remaining.toLowerCase();
  for (const [keyword, category] of Object.entries(CATEGORY_KEYWORDS)) {
    const re = new RegExp(`\\b${keyword}\\b`, "i");
    if (re.test(lowerRemaining)) {
      payload.category = category;
      break;
    }
  }

  const cleanedTitle = remaining.replace(/\s{2,}/g, " ").trim().replace(/,$/, "").trim();
  if (cleanedTitle.length > 0) {
    payload.title = cleanedTitle;
  }

  return { payload, matchedFragments: matched };
}
