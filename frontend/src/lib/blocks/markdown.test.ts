import assert from "node:assert/strict";
import { test } from "node:test";
import { checkProgress, parseInline, parseNote, safeHref, toggleCheck } from "./markdown.ts";

test("lines: headings, checklists, lists, quotes, rules, text", () => {
  const lines = parseNote("# Week\n- [ ] Call Mom\n- [x] Pay rent\n- milk\n2. second\n> keep going\n---\nplain\n");
  assert.deepEqual(lines.map((l) => l.kind), ["heading", "check", "check", "bullet", "number", "quote", "rule", "text", "blank"]);
  assert.deepEqual(checkProgress(lines), { done: 1, total: 2 });
});

test("toggling a checklist item changes only that line", () => {
  const text = "- [ ] a\n- [x] b\nnot a check";
  assert.equal(toggleCheck(text, 0), "- [x] a\n- [x] b\nnot a check");
  assert.equal(toggleCheck(text, 1), "- [ ] a\n- [ ] b\nnot a check");
  assert.equal(toggleCheck(text, 2), text);
  assert.equal(toggleCheck(text, 99), text);
});

test("inline formatting and safe links", () => {
  assert.deepEqual(parseInline("a **b** *c* `d` [e](https://x.dev) f"), [
    { kind: "text", text: "a " },
    { kind: "bold", text: "b" },
    { kind: "text", text: " " },
    { kind: "italic", text: "c" },
    { kind: "text", text: " " },
    { kind: "code", text: "d" },
    { kind: "text", text: " " },
    { kind: "link", text: "e", href: "https://x.dev" },
    { kind: "text", text: " f" },
  ]);
  // Never a javascript: link; it stays plain text.
  assert.ok(parseInline("[x](javascript:alert(1))").every((i) => i.kind === "text"));
  assert.equal(safeHref("data:text/html,hi"), null);
  // Bare URLs link, without the trailing period.
  assert.deepEqual(parseInline("see https://look.dev."), [
    { kind: "text", text: "see " },
    { kind: "link", text: "https://look.dev", href: "https://look.dev" },
    { kind: "text", text: "." },
  ]);
});
