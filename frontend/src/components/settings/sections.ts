// Settings sections: one URL each (/settings/<slug>), grouped for the
// settings sidebar and the overview.
import {
  CalendarDotsIcon,
  GraduationCapIcon,
  PackageIcon,
  PaintBrushIcon,
  PlugsConnectedIcon,
  SquaresFourIcon,
  TagIcon,
  type Icon,
} from "@phosphor-icons/react";

export interface SettingsSection {
  slug: string;
  title: string;
  icon: Icon;
  blurb: string;
}

export const SETTINGS_GROUPS: { label: string; sections: SettingsSection[] }[] = [
  {
    label: "Personalization",
    sections: [
      { slug: "appearance", title: "Appearance", icon: PaintBrushIcon, blurb: "Theme and sidebar" },
      { slug: "views", title: "Views & dashboards", icon: SquaresFourIcon, blurb: "Dashboard, Today and your own views" },
      { slug: "courses", title: "Courses", icon: GraduationCapIcon, blurb: "Your classes and their colors" },
      { slug: "categories", title: "Categories", icon: TagIcon, blurb: "Life areas for tasks and events" },
    ],
  },
  {
    label: "Planning & data",
    sections: [{ slug: "calendars", title: "Calendars", icon: CalendarDotsIcon, blurb: "Canvas and other ICS feeds" }],
  },
  {
    label: "Connections",
    sections: [{ slug: "integrations", title: "ChatGPT & MCP", icon: PlugsConnectedIcon, blurb: "AI assistants and the secure tunnel" }],
  },
  {
    label: "System",
    sections: [{ slug: "system", title: "Updates & version", icon: PackageIcon, blurb: "Version, updates and advanced" }],
  },
];

export const SETTINGS_SECTIONS = SETTINGS_GROUPS.flatMap((g) => g.sections);

/** Old in-page anchors (#calendars, #openai-tunnel…) -> section slugs. */
export const LEGACY_HASHES: Record<string, string> = {
  calendars: "calendars",
  courses: "courses",
  categories: "categories",
  planning: "courses",
  "openai-tunnel": "integrations",
};
