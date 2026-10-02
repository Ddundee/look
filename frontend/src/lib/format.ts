import type { TaskPriority, TaskStatus } from "./types";

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate()
  ).padStart(2, "0")}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function weekdayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long" });
}

export function relativeDueLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const today = todayIso();
  if (iso === today) return "Today";
  if (iso === addDaysIso(today, 1)) return "Tomorrow";
  if (iso === addDaysIso(today, -1)) return "Yesterday";
  return formatDate(iso);
}

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

// Text color for the priority flag shown next to a task.
// Classes are spelled out in full (not built from a `${color}` template)
// because Tailwind statically scans source text for complete utility
// names — an interpolated class name never matches anything and silently
// produces no CSS.
export const PRIORITY_TEXT: Record<TaskPriority, string> = {
  critical: "text-danger",
  high: "text-warn",
  medium: "text-accent-text",
  low: "text-fg-faint",
};

// Ring color of the completion checkbox, so priority reads at a glance
// even before the flag label.
export const PRIORITY_RING: Record<TaskPriority, string> = {
  critical: "border-danger hover:bg-danger-soft",
  high: "border-warn hover:bg-warn-soft",
  medium: "border-line-strong hover:border-accent hover:bg-accent-soft",
  low: "border-line-strong hover:border-accent hover:bg-accent-soft",
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  inbox: "Inbox",
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const STATUS_STYLES: Record<TaskStatus, string> = {
  inbox: "bg-surface-2 text-fg-muted",
  todo: "bg-surface-2 text-fg-muted",
  in_progress: "bg-accent-soft text-accent-text",
  blocked: "bg-warn-soft text-warn",
  completed: "bg-accent-soft text-accent-text",
  cancelled: "bg-surface-2 text-fg-faint line-through",
};

