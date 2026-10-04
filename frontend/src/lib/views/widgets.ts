// Widget metadata, mirroring the backend registry (app.services.views.WIDGETS;
// a test there checks the keys match). Plain data so it can be tested; the
// React components live in components/views/registry.tsx.

export type WidgetType =
  | "quick_add"
  | "things_to_do"
  | "schedule"
  | "upcoming_assignments"
  | "week_preview"
  | "nutrition_summary"
  | "week_stats"
  | "leetcode_summary";

export const SIZES = ["quarter", "third", "half", "two_thirds", "full"] as const;
export type WidgetSize = (typeof SIZES)[number];
export const HEIGHTS = ["short", "medium", "tall", "full"] as const;
export type WidgetHeight = (typeof HEIGHTS)[number];

export const SIZE_LABEL: Record<WidgetSize, string> = {
  quarter: "¼ width",
  third: "⅓ width",
  half: "½ width",
  two_thirds: "⅔ width",
  full: "Full width",
};
export const HEIGHT_LABEL: Record<WidgetHeight, string> = {
  short: "Short",
  medium: "Medium",
  tall: "Tall",
  full: "Full height",
};

/** A config field: a yes/no switch or a choice among fixed values. */
export type ConfigField =
  | { key: string; label: string; kind: "bool"; default: boolean }
  | { key: string; label: string; kind: "choice"; options: { value: number; label: string }[]; default: number };

export interface WidgetDef {
  type: WidgetType;
  title: string;
  description: string;
  sizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
  heights: readonly WidgetHeight[];
  defaultHeight: WidgetHeight;
  multiple: boolean;
  config: ConfigField[];
}

const all = { sizes: SIZES, heights: HEIGHTS, multiple: false, config: [] as ConfigField[] };

export const WIDGET_DEFS: Record<WidgetType, WidgetDef> = {
  quick_add: { ...all, type: "quick_add", title: "Quick add", description: "Add a task in plain words.",
    sizes: ["half", "two_thirds", "full"], defaultSize: "half", heights: ["short", "medium"], defaultHeight: "short" },
  things_to_do: { ...all, type: "things_to_do", title: "Things to do",
    description: "Overdue, due today and undated tasks, with imported assignments.", defaultSize: "half", defaultHeight: "tall",
    config: [
      { key: "show_done", label: "Show items checked off today", kind: "bool", default: true },
      { key: "undated_limit", label: "Tasks with no due date", kind: "choice", default: 6,
        options: [{ value: 0, label: "None" }, { value: 3, label: "Top 3" }, { value: 6, label: "Top 6" }] },
    ] },
  schedule: { ...all, type: "schedule", title: "Schedule", description: "Today's events, with a line at the current time.",
    defaultSize: "third", defaultHeight: "tall",
    config: [{ key: "include_assignments", label: "Include assignments", kind: "bool", default: false }] },
  upcoming_assignments: { ...all, type: "upcoming_assignments", title: "Upcoming assignments",
    description: "Assignments due soon that aren't done yet.", defaultSize: "third", defaultHeight: "medium",
    config: [{ key: "days", label: "Look ahead", kind: "choice", default: 7,
      options: [{ value: 3, label: "3 days" }, { value: 7, label: "7 days" }, { value: 14, label: "14 days" }] }] },
  week_preview: { ...all, type: "week_preview", title: "Next 7 days", description: "Events and tasks for each of the next seven days.",
    sizes: ["half", "two_thirds", "full"], defaultSize: "half", defaultHeight: "medium" },
  nutrition_summary: { ...all, type: "nutrition_summary", title: "Calories today", description: "Calories and macros against your targets.",
    sizes: ["quarter", "third", "half"], defaultSize: "quarter", defaultHeight: "medium" },
  week_stats: { ...all, type: "week_stats", title: "This week", description: "Tasks done, events ahead and average calories.",
    sizes: ["quarter", "third", "half"], defaultSize: "quarter", defaultHeight: "medium" },
  leetcode_summary: { ...all, type: "leetcode_summary", title: "LeetCode", description: "Solved today and this week, and your streak.",
    sizes: ["quarter", "third", "half", "full"], defaultSize: "third", heights: ["short", "medium"], defaultHeight: "short" },
};

export const WIDGET_TYPES = Object.keys(WIDGET_DEFS) as WidgetType[];

export function isWidgetType(value: string): value is WidgetType {
  return (WIDGET_TYPES as string[]).includes(value);
}
