// Pure layout operations for views: what Customize mode does, kept out of
// components so it can be tested. The server validates every save too.
import { HEIGHTS, SIZES, WIDGET_DEFS, isWidgetType, type WidgetHeight, type WidgetSize, type WidgetType } from "./widgets.ts";

export interface Widget {
  id: string;
  type: string;
  size: WidgetSize;
  height: WidgetHeight;
  visible: boolean;
  config: Record<string, unknown>;
}

/** Drop unknown widget types (e.g. from a newer server), clamp sizes and
 * heights to what each widget allows, fill config defaults, drop repeats
 * of single-instance widgets and duplicate ids. */
export function normalizeLayout(widgets: Widget[]): Widget[] {
  const out: Widget[] = [];
  const ids = new Set<string>();
  const singles = new Set<string>();
  for (const w of widgets) {
    if (!isWidgetType(w.type) || ids.has(w.id)) continue;
    const def = WIDGET_DEFS[w.type];
    if (!def.multiple) {
      if (singles.has(w.type)) continue;
      singles.add(w.type);
    }
    ids.add(w.id);
    const config: Record<string, unknown> = {};
    for (const field of def.config) config[field.key] = w.config?.[field.key] ?? field.default;
    out.push({
      id: w.id,
      type: w.type,
      size: (def.sizes as readonly string[]).includes(w.size) ? w.size : def.defaultSize,
      height: (def.heights as readonly string[]).includes(w.height) ? w.height : def.defaultHeight,
      visible: w.visible !== false,
      config,
    });
  }
  return out;
}

/** Move one item; out-of-range moves return the list unchanged. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function moveWidget(widgets: Widget[], from: number, to: number): Widget[] {
  return moveItem(widgets, from, to);
}

export function moveById(widgets: Widget[], activeId: string, overId: string): Widget[] {
  return moveWidget(widgets, widgets.findIndex((w) => w.id === activeId), widgets.findIndex((w) => w.id === overId));
}

/** Types that can still be added (single-instance ones that aren't there yet). */
export function addableTypes(widgets: Widget[]): WidgetType[] {
  const present = new Set(widgets.map((w) => w.type));
  return (Object.keys(WIDGET_DEFS) as WidgetType[]).filter((t) => WIDGET_DEFS[t].multiple || !present.has(t));
}

export function addWidget(widgets: Widget[], type: WidgetType, makeId: () => string = () => Math.random().toString(36).slice(2, 8)): Widget[] {
  const def = WIDGET_DEFS[type];
  const existing = widgets.find((w) => w.type === type);
  if (existing && !def.multiple) {
    // Adding a hidden single-instance widget shows it again.
    return widgets.map((w) => (w.id === existing.id ? { ...w, visible: true } : w));
  }
  const config: Record<string, unknown> = {};
  for (const field of def.config) config[field.key] = field.default;
  return [...widgets, { id: `${type.replace(/_/g, "-")}-${makeId()}`, type, size: def.defaultSize, height: def.defaultHeight, visible: true, config }];
}

export function updateWidget(widgets: Widget[], id: string, patch: Partial<Omit<Widget, "id" | "type">>): Widget[] {
  return widgets.map((w) => (w.id === id ? { ...w, ...patch, config: patch.config ? { ...w.config, ...patch.config } : w.config } : w));
}

export function removeWidget(widgets: Widget[], id: string): Widget[] {
  return widgets.filter((w) => w.id !== id);
}

/** Grid classes: 1 column on phones, 2 on tablets, 12 on desktop, where the
 * height is in sixths of the screen (see .view-grid in globals.css). */
export const SPAN_CLASS: Record<WidgetSize, string> = {
  quarter: "md:col-span-1 lg:col-span-3",
  third: "md:col-span-1 lg:col-span-4",
  half: "md:col-span-1 lg:col-span-6",
  two_thirds: "md:col-span-2 lg:col-span-8",
  full: "md:col-span-2 lg:col-span-12",
};
export const ROW_CLASS: Record<WidgetHeight, string> = {
  short: "lg:row-span-2",
  medium: "lg:row-span-3",
  tall: "lg:row-span-4",
  full: "lg:row-span-6",
};

export function widgetClasses(w: Pick<Widget, "size" | "height">): string {
  return `${SPAN_CLASS[w.size]} ${ROW_CLASS[w.height]}`;
}

export function sameLayout(a: Widget[], b: Widget[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export { HEIGHTS, SIZES };
