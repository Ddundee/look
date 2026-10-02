import assert from "node:assert/strict";
import { test } from "node:test";
import { msToNextMinute, nowPlacement, zonedNow } from "./now.ts";

const ev = (start: string, end: string, all_day = false) => ({ start_at: `${start}:00`, end_at: `${end}:00`, all_day });

test("the app timezone, not the browser's, with DST", () => {
  const instant = new Date("2026-10-08T16:47:30Z");
  assert.equal(zonedNow("America/New_York", instant), "2026-10-08T12:47"); // EDT, UTC-4
  assert.equal(zonedNow("America/New_York", new Date("2026-11-08T16:47:30Z")), "2026-11-08T11:47"); // EST, UTC-5
  assert.equal(zonedNow("Asia/Kolkata", instant), "2026-10-08T22:17");
  assert.equal(zonedNow("America/Los_Angeles", new Date("2026-10-09T03:30:00Z")), "2026-10-08T20:30"); // day boundary
});

test("the marker goes before the first item that hasn't started", () => {
  const day = [ev("2026-10-08T09:05", "2026-10-08T09:55"), ev("2026-10-08T10:10", "2026-10-08T11:00"),
    ev("2026-10-08T12:30", "2026-10-08T13:45"), ev("2026-10-08T14:00", "2026-10-08T15:00")];
  assert.deepEqual(nowPlacement(day, "2026-10-08T12:47"), { before: 3, active: new Set([2]) });
  assert.deepEqual(nowPlacement(day, "2026-10-08T11:30"), { before: 2, active: new Set() });
  assert.deepEqual(nowPlacement(day, "2026-10-08T07:00"), { before: 0, active: new Set() });
  assert.deepEqual(nowPlacement(day, "2026-10-08T23:00"), { before: 4, active: new Set() });
});

test("events end exclusively; all-day items are ignored", () => {
  const day = [ev("2026-10-08T00:00", "2026-10-09T00:00", true), ev("2026-10-08T09:00", "2026-10-08T10:00")];
  assert.deepEqual(nowPlacement(day, "2026-10-08T10:00"), { before: 2, active: new Set() });
  assert.deepEqual(nowPlacement(day, "2026-10-08T09:00"), { before: 2, active: new Set([1]) });
  assert.deepEqual(nowPlacement([], "2026-10-08T09:00"), { before: 0, active: new Set() });
});

test("ticks line up with the minute", () => {
  assert.equal(msToNextMinute(new Date(2026, 9, 8, 12, 47, 30, 250)), 29_750);
});
