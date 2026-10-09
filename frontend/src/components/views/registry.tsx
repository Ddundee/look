"use client";

// Widget key -> component, icon and "see all" link. Keys and metadata come
// from lib/views/widgets.ts (mirrors the backend registry); only keys are
// ever stored, never component names.
import {
  CalendarBlankIcon,
  CalendarCheckIcon,
  CalendarDotsIcon,
  ChartBarIcon,
  CodeIcon,
  ForkKnifeIcon,
  ListChecksIcon,
  PlusCircleIcon,
  SquaresFourIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { WidgetType } from "@/lib/views/widgets";
import {
  LeetCodeSummaryWidget,
  NutritionSummaryWidget,
  QuickAddWidget,
  ScheduleWidget,
  ThingsToDoWidget,
  UpcomingAssignmentsWidget,
  WeekPreviewWidget,
  WeekStatsWidget,
  type WidgetProps,
} from "./widgets";
import BlockBody from "../blocks/BlockBody";

export interface WidgetView {
  component: React.ComponentType<WidgetProps>;
  icon: Icon;
  link?: { href: string; label: string };
}

export const WIDGET_VIEWS: Record<WidgetType, WidgetView> = {
  quick_add: { component: QuickAddWidget, icon: PlusCircleIcon },
  things_to_do: { component: ThingsToDoWidget, icon: ListChecksIcon, link: { href: "/tasks", label: "All tasks" } },
  schedule: { component: ScheduleWidget, icon: CalendarBlankIcon, link: { href: "/calendar", label: "Calendar" } },
  upcoming_assignments: { component: UpcomingAssignmentsWidget, icon: CalendarCheckIcon, link: { href: "/calendar", label: "Calendar" } },
  week_preview: { component: WeekPreviewWidget, icon: CalendarDotsIcon, link: { href: "/calendar", label: "Calendar" } },
  nutrition_summary: { component: NutritionSummaryWidget, icon: ForkKnifeIcon, link: { href: "/nutrition", label: "Food log" } },
  week_stats: { component: WeekStatsWidget, icon: ChartBarIcon, link: { href: "/completed", label: "Completed" } },
  leetcode_summary: { component: LeetCodeSummaryWidget, icon: CodeIcon, link: { href: "/leetcode", label: "LeetCode" } },
  // Title, icon and color come from the block itself (see ViewPage).
  block: { component: BlockBody, icon: SquaresFourIcon },
};
