// How an item looks: one color and one style from fixed sets (stored as
// keys on the server; never CSS). Courses win over categories, so a class's
// meetings and assignments share its look; everything else uses its
// category's. The CSS for each style lives in globals.css (.look-*).

export const COLORS = [
  "red", "orange", "amber", "yellow", "lime", "green", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "pink", "slate",
] as const;
export type ColorKey = (typeof COLORS)[number];

/** Shown first in pickers: well separated and readable in both themes.
 * The rest stay valid (existing choices keep working) behind "More". */
export const PRIMARY_COLORS: readonly ColorKey[] = ["red", "orange", "amber", "green", "teal", "blue", "indigo", "violet", "pink", "slate"];
export const SECONDARY_COLORS: readonly ColorKey[] = COLORS.filter((c) => !PRIMARY_COLORS.includes(c));

export const STYLES = ["soft", "solid", "outline", "striped", "glass"] as const;
export type StyleKey = (typeof STYLES)[number];

export const STYLE_LABEL: Record<StyleKey, string> = {
  soft: "Soft",
  solid: "Solid",
  outline: "Outline",
  striped: "Striped",
  glass: "Glass",
};

export interface CategoryLook {
  key: string;
  name: string;
  color: string;
  style: string;
}

export interface CourseLook {
  code: string;
  color: string;
  style: string;
}

export interface Look {
  color: ColorKey;
  style: StyleKey;
  /** course: school work tied to a class; category: everything else. */
  kind: "course" | "category";
  label: string;
}

export function toColor(value: string | null | undefined): ColorKey {
  return (COLORS as readonly string[]).includes(value ?? "") ? (value as ColorKey) : "slate";
}

export function toStyle(value: string | null | undefined): StyleKey {
  return (STYLES as readonly string[]).includes(value ?? "") ? (value as StyleKey) : "soft";
}

/** A stable color for a category no one has styled (same idea as the
 * server's default_color, not necessarily the same pick). */
export function fallbackColor(key: string): ColorKey {
  let h = 0;
  for (const ch of key.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function lookFor(item: { course?: CourseLook | null; category?: string | null }, categories: CategoryLook[]): Look {
  if (item.course) {
    return { color: toColor(item.course.color), style: toStyle(item.course.style), kind: "course", label: item.course.code };
  }
  const key = item.category ?? "other";
  const category = categories.find((c) => c.key === key);
  if (category) {
    return { color: toColor(category.color), style: toStyle(category.style), kind: "category", label: category.name };
  }
  return { color: fallbackColor(key), style: "soft", kind: "category", label: key };
}

/** The CSS custom property the .look-* classes read. Only palette keys
 * ever reach CSS. */
export function lookVars(look: { color: ColorKey }): Record<string, string> {
  return { "--look": `var(--c-${toColor(look.color)})` };
}

/** Canvas appends the course code to titles ("Project 2 [CS-3214]"); once
 * the course badge shows it, the suffix is noise. Only stripped when it is
 * that course's code. */
export function titleWithoutCourse(title: string, course: { code: string } | null | undefined): string {
  if (!course) return title;
  const m = title.match(/^(.*\S)\s*\[([^\][]+)\]\s*$/);
  if (!m) return title;
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return norm(m[2]).startsWith(norm(course.code)) ? m[1] : title;
}
