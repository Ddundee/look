import assert from "node:assert/strict";
import { test } from "node:test";
import { weekRangeIso, weekStartIso } from "./week.ts";

test("any day maps to its Monday-to-Sunday week", () => {
  // Week of Mon Oct 5 - Sun Oct 11, 2026.
  for (const day of ["2026-10-05", "2026-10-06", "2026-10-09", "2026-10-11"]) {
    assert.deepEqual(weekRangeIso(day), { start: "2026-10-05", end: "2026-10-11" }, day);
  }
});

test("Monday is its own week start; Sunday belongs to the week before", () => {
  assert.equal(weekStartIso("2026-10-12"), "2026-10-12");
  assert.equal(weekStartIso("2026-10-11"), "2026-10-05");
});

test("weeks that cross a month", () => {
  assert.deepEqual(weekRangeIso("2026-10-01"), { start: "2026-09-28", end: "2026-10-04" });
  assert.deepEqual(weekRangeIso("2026-09-28"), { start: "2026-09-28", end: "2026-10-04" });
});

test("weeks that cross a year", () => {
  assert.deepEqual(weekRangeIso("2027-01-01"), { start: "2026-12-28", end: "2027-01-03" });
  assert.deepEqual(weekRangeIso("2026-12-31"), { start: "2026-12-28", end: "2027-01-03" });
});

test("DST changes don't shift the week", () => {
  // US DST ends Sun Nov 1 2026 and starts Sun Mar 14 2027.
  assert.deepEqual(weekRangeIso("2026-11-01"), { start: "2026-10-26", end: "2026-11-01" });
  assert.deepEqual(weekRangeIso("2027-03-15"), { start: "2027-03-15", end: "2027-03-21" });
});
