import assert from "node:assert/strict";
import { test } from "node:test";
import { fallbackColor, lookFor, lookVars, titleWithoutCourse, toColor, toStyle } from "./palette.ts";

const categories = [
  { key: "personal", name: "Personal", color: "green", style: "solid" },
  { key: "Research", name: "Research", color: "teal", style: "striped" },
];

test("a course decides the look over the category", () => {
  const look = lookFor({ course: { code: "CS 3214", color: "violet", style: "soft" }, category: "personal" }, categories);
  assert.deepEqual(look, { color: "violet", style: "soft", kind: "course", label: "CS 3214" });
});

test("otherwise the category's color, style and name", () => {
  assert.deepEqual(lookFor({ category: "Research" }, categories), { color: "teal", style: "striped", kind: "category", label: "Research" });
});

test("unknown categories get a stable fallback, never a crash", () => {
  const a = lookFor({ category: "SOU" }, categories);
  assert.equal(a.kind, "category");
  assert.equal(a.color, fallbackColor("SOU"));
  assert.equal(lookFor({ category: "SOU" }, []).color, a.color);
});

test("only palette keys reach CSS", () => {
  assert.equal(toColor("url(evil)"), "slate");
  assert.equal(toStyle("background:red"), "solid");
  assert.deepEqual(lookVars({ color: "indigo" }), { "--look": "var(--c-indigo)" });
  assert.deepEqual(lookVars({ color: "x;color:red" as never }), { "--look": "var(--c-slate)" });
});

test("the Canvas course suffix is dropped only when it's that course", () => {
  assert.equal(titleWithoutCourse("Project 2 [CS-3214]", { code: "CS 3214" }), "Project 2");
  assert.equal(titleWithoutCourse("Lab [CS3214-F26]", { code: "CS 3214" }), "Lab");
  assert.equal(titleWithoutCourse("Project 2 [CS-3214]", { code: "CS 3304" }), "Project 2 [CS-3214]");
  assert.equal(titleWithoutCourse("Project 2 [CS-3214]", null), "Project 2 [CS-3214]");
});
