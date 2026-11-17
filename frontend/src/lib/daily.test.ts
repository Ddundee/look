import assert from "node:assert/strict";
import { test } from "node:test";
import { completesFloor, formatMinutes, hasTag, parseQuickDuration, progressPercent, todaysThreeCandidates } from "./daily.ts";

test("quick add reads a trailing duration", () => {
  assert.deepEqual(parseQuickDuration("Read one systems article 15m"), { title: "Read one systems article", minutes: 15 });
  assert.deepEqual(parseQuickDuration("30 pushups 5 min"), { title: "30 pushups", minutes: 5 });
  assert.deepEqual(parseQuickDuration("Architecture notes (1h)"), { title: "Architecture notes", minutes: 60 });
  assert.deepEqual(parseQuickDuration("Apply 1h30m"), { title: "Apply", minutes: 90 });
  // Numbers that aren't a trailing duration stay in the title.
  assert.deepEqual(parseQuickDuration("30 pushups"), { title: "30 pushups", minutes: null });
  assert.deepEqual(parseQuickDuration("Review LeetCode 15"), { title: "Review LeetCode 15", minutes: null });
  assert.deepEqual(parseQuickDuration("15m"), { title: "15m", minutes: null });
  assert.deepEqual(parseQuickDuration("  Clean desk  "), { title: "Clean desk", minutes: null });
});

test("durations and progress", () => {
  assert.equal(formatMinutes(15), "15m");
  assert.equal(formatMinutes(60), "1h");
  assert.equal(formatMinutes(95), "1h 35m");
  assert.equal(progressPercent(3, 4), 75);
  assert.equal(progressPercent(0, 0), 0);
  assert.equal(progressPercent(5, 4), 100);
});

test("tags match like the backend", () => {
  assert.ok(hasTag({ tags: ["#Daily-Floor"] }, "daily-floor"));
  assert.ok(!hasTag({ tags: ["daily"] }, "daily-floor"));
});

test("today's 3 candidates skip planned and floor tasks, keep ranked order", () => {
  const t = (id: string, extra: Partial<{ tags: string[]; planned_for_date: string | null }> = {}) => ({
    id, title: `Task ${id}`, tags: [], planned_for_date: null, ...extra,
  });
  const ranked = [t("a"), t("b", { planned_for_date: "2026-11-17" }), t("c", { tags: ["daily-floor"] }), t("d", { planned_for_date: "2026-11-18" })];
  assert.deepEqual(todaysThreeCandidates(ranked, "2026-11-17").map((x) => x.id), ["a", "d"]);
  assert.deepEqual(todaysThreeCandidates(ranked, "2026-11-17", "task D").map((x) => x.id), ["d"]);
});

test("the day-won moment is the click that finishes the floor", () => {
  const items = [{ id: "a", done: true }, { id: "b", done: false }];
  assert.ok(completesFloor(items, "b"));
  assert.ok(!completesFloor(items, "a")); // un-checking
  assert.ok(!completesFloor([...items, { id: "c", done: false }], "b"));
  assert.ok(!completesFloor([], "x"));
});
