"use client";

import { Fragment } from "react";
import { CheckIcon } from "@phosphor-icons/react";
import { parseInline, type NoteLine } from "@/lib/blocks/markdown";

function InlineText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((part, i) => {
        switch (part.kind) {
          case "bold":
            return <strong key={i} className="font-semibold">{part.text}</strong>;
          case "italic":
            return <em key={i}>{part.text}</em>;
          case "code":
            return <code key={i} className="rounded bg-surface-2 px-1 font-mono text-[0.85em] text-fg">{part.text}</code>;
          case "link":
            return (
              <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-text underline underline-offset-4 [overflow-wrap:anywhere]">
                {part.text}
              </a>
            );
          default:
            return <Fragment key={i}>{part.text}</Fragment>;
        }
      })}
    </>
  );
}

/** A note, rendered from parsed lines (never as HTML). Checklist items
 * toggle in place when `onToggle` is given. */
export default function NoteText({ lines, onToggle }: { lines: NoteLine[]; onToggle?: (line: number) => void }) {
  return (
    <div className="space-y-1 text-sm leading-6 text-fg [overflow-wrap:anywhere]">
      {lines.map((l) => {
        switch (l.kind) {
          case "heading":
            return (
              <p key={l.line} className={`font-semibold tracking-tight text-fg ${l.level === 1 ? "pt-1 text-base" : l.level === 2 ? "pt-1 text-[15px]" : "text-sm"}`}>
                <InlineText text={l.text} />
              </p>
            );
          case "check":
            return (
              <label key={l.line} className="flex cursor-pointer items-start gap-2.5">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={l.checked}
                  disabled={!onToggle}
                  onClick={() => onToggle?.(l.line)}
                  className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                    l.checked ? "border-accent bg-accent text-accent-fg" : "border-line-strong hover:border-accent"
                  }`}
                >
                  {l.checked && <CheckIcon weight="bold" className="h-3 w-3" aria-hidden />}
                </button>
                <span className={l.checked ? "text-fg-faint line-through decoration-fg-faint/60" : ""}>
                  <InlineText text={l.text} />
                </span>
              </label>
            );
          case "bullet":
          case "number":
            return (
              <p key={l.line} className="flex gap-2.5 pl-0.5">
                <span className="w-5 shrink-0 whitespace-nowrap text-right font-mono text-xs leading-6 text-fg-faint" aria-hidden>
                  {l.kind === "number" ? `${l.n}.` : "•"}
                </span>
                <span className="min-w-0">
                  <InlineText text={l.text} />
                </span>
              </p>
            );
          case "quote":
            return (
              <p key={l.line} className="border-l-2 border-line-strong pl-3 text-fg-muted">
                <InlineText text={l.text} />
              </p>
            );
          case "rule":
            return <hr key={l.line} className="my-2 border-line" />;
          case "blank":
            return <div key={l.line} className="h-1.5" aria-hidden />;
          default:
            return (
              <p key={l.line}>
                <InlineText text={l.text} />
              </p>
            );
        }
      })}
    </div>
  );
}
