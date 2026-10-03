import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addableTypes,
  addWidget,
  moveById,
  moveWidget,
  normalizeLayout,
  removeWidget,
  sameLayout,
  updateWidget,
  widgetClasses,
  type Widget,
} from "./layout.ts";
import { WIDGET_DEFS, WIDGET_TYPES } from "./widgets.ts";

const w = (type: string, id = type, extra: Partial<Widget> = {}): Widget =>
  ({ id, type, size: "half", height: "medium", visible: true, config: {}, ...extra }) as Widget;

test("registry: every widget's defaults are among its allowed values", () => {
  assert.equal(WIDGET_TYPES.length, 8);
  for (const def of Object.values(WIDGET_DEFS)) {
    assert.ok(def.sizes.includes(def.defaultSize), def.type);
    assert.ok(def.heights.includes(def.defaultHeight), def.type);
    for (const f of def.config) if (f.kind === "choice") assert.ok(f.options.some((o) => o.value === f.default));
  }
});

test("normalize drops unknown types and repeats, clamps sizes, fills config", () => {
  const out = normalizeLayout([
    w("things_to_do", "a", { config: { show_done: false } }),
    w("iframe", "b"),
    w("things_to_do", "c"),
    w("quick_add", "d", { size: "quarter" as never, height: "tall" as never }),
    w("schedule", "a"),
  ]);
  assert.deepEqual(out.map((x) => x.id), ["a", "d"]);
  assert.deepEqual(out[0].config, { show_done: false, undated_limit: 6 });
  assert.equal(out[1].size, "half"); // quarter isn't allowed for quick add
  assert.equal(out[1].height, "short");
});

test("drag reorder moves one item and keeps the rest in order", () => {
  const ws = [w("things_to_do"), w("schedule"), w("week_stats")];
  assert.deepEqual(moveById(ws, "schedule", "things_to_do").map((x) => x.id), ["schedule", "things_to_do", "week_stats"]);
  assert.deepEqual(moveWidget(ws, 0, 2).map((x) => x.id), ["schedule", "week_stats", "things_to_do"]);
  assert.equal(moveWidget(ws, 0, 9), ws);
});

test("add, hide and remove", () => {
  let ws = [w("things_to_do")];
  assert.ok(!addableTypes(ws).includes("things_to_do"));
  ws = addWidget(ws, "schedule", () => "x1");
  assert.deepEqual(ws[1], { id: "schedule-x1", type: "schedule", size: "third", height: "tall", visible: true, config: { include_assignments: false } });
  ws = updateWidget(ws, "schedule-x1", { visible: false });
  assert.equal(ws[1].visible, false);
  ws = addWidget(ws, "schedule"); // shows the hidden one instead of adding another
  assert.equal(ws.length, 2);
  assert.equal(ws[1].visible, true);
  ws = updateWidget(ws, "things_to_do", { config: { undated_limit: 3 } });
  assert.deepEqual(ws[0].config, { undated_limit: 3 });
  assert.deepEqual(removeWidget(ws, "things_to_do").map((x) => x.id), ["schedule-x1"]);
});

test("sizes map to responsive spans: 1 col phone, 2 tablet, 12 desktop", () => {
  assert.equal(widgetClasses({ size: "quarter", height: "short" }), "md:col-span-1 lg:col-span-3 lg:row-span-2");
  assert.equal(widgetClasses({ size: "full", height: "full" }), "md:col-span-2 lg:col-span-12 lg:row-span-6");
  assert.ok(!widgetClasses({ size: "half", height: "medium" }).match(/(^| )col-span/)); // phones: always full width
});

test("sameLayout notices any change", () => {
  const a = [w("schedule")];
  assert.ok(sameLayout(a, [w("schedule")]));
  assert.ok(!sameLayout(a, updateWidget(a, "schedule", { size: "full" })));
});
