// The small Markdown subset notes use, parsed into plain data and rendered
// by components/blocks/NoteText as React elements (never as HTML, so a note
// can't inject markup or scripts).
//
//   # Heading  ## Heading  ### Heading      > quote      ---
//   - item  * item  1. item                 - [ ] todo   - [x] done
//   **bold**  *italic*  _italic_  `code`  [text](https://…)  https://bare.link

export type NoteLine =
  | { kind: "heading"; level: 1 | 2 | 3; text: string; line: number }
  | { kind: "check"; checked: boolean; text: string; line: number }
  | { kind: "bullet"; text: string; line: number }
  | { kind: "number"; n: number; text: string; line: number }
  | { kind: "quote"; text: string; line: number }
  | { kind: "rule"; line: number }
  | { kind: "text"; text: string; line: number }
  | { kind: "blank"; line: number };

const CHECK = /^\s*[-*]\s+\[( |x|X)\]\s?(.*)$/;

export function parseNote(text: string): NoteLine[] {
  return text.split("\n").map((raw, line): NoteLine => {
    const s = raw.trimEnd();
    if (!s.trim()) return { kind: "blank", line };
    const heading = /^(#{1,3})\s+(.*)$/.exec(s);
    if (heading) return { kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2], line };
    const check = CHECK.exec(s);
    if (check) return { kind: "check", checked: check[1] !== " ", text: check[2], line };
    const bullet = /^\s*[-*]\s+(.*)$/.exec(s);
    if (bullet) return { kind: "bullet", text: bullet[1], line };
    const num = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(s);
    if (num) return { kind: "number", n: Number(num[1]), text: num[2], line };
    const quote = /^>\s?(.*)$/.exec(s);
    if (quote) return { kind: "quote", text: quote[1], line };
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(s)) return { kind: "rule", line };
    return { kind: "text", text: s.trim(), line };
  });
}

/** Tick or untick the checklist item on `line`; other lines are unchanged. */
export function toggleCheck(text: string, line: number): string {
  const lines = text.split("\n");
  const m = CHECK.exec(lines[line] ?? "");
  if (!m) return text;
  lines[line] = lines[line].replace(/\[( |x|X)\]/, m[1] === " " ? "[x]" : "[ ]");
  return lines.join("\n");
}

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold" | "italic" | "code"; text: string }
  | { kind: "link"; text: string; href: string };

// Order matters: code first (its contents aren't formatted), then links.
const INLINE = /(`[^`\n]+`)|\[([^\]\n]+)\]\(([^)\s]+)\)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*|_[^_\n]+_)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

/** Only web and mail links; anything else (javascript:, data:…) stays text. */
export function safeHref(href: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[1]) out.push({ kind: "code", text: m[1].slice(1, -1) });
    else if (m[2]) {
      const href = safeHref(m[3]);
      out.push(href ? { kind: "link", text: m[2], href } : { kind: "text", text: m[0] });
    } else if (m[4]) out.push({ kind: "bold", text: m[4].slice(2, -2) });
    else if (m[5]) out.push({ kind: "italic", text: m[5].slice(1, -1) });
    else if (m[6]) out.push({ kind: "link", text: m[6], href: m[6] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** Checklist progress, for the block header. */
export function checkProgress(lines: NoteLine[]): { done: number; total: number } {
  const checks = lines.filter((l) => l.kind === "check");
  return { done: checks.filter((l) => l.kind === "check" && l.checked).length, total: checks.length };
}
