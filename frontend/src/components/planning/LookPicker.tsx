"use client";

import { useState } from "react";
import { CaretDownIcon, CheckIcon, GraduationCapIcon } from "@phosphor-icons/react";
import {
  PRIMARY_COLORS,
  SECONDARY_COLORS,
  STYLE_LABEL,
  STYLES,
  lookVars,
  toColor,
  toStyle,
  type ColorKey,
  type Look,
  type StyleKey,
} from "@/lib/palette";
import { LABEL } from "@/lib/ui";
import { ItemEdge, LookMark } from "../look/Look";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function Swatch({ color, selected, onPick }: { color: ColorKey; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={cap(color)}
      title={cap(color)}
      onClick={onPick}
      className="flex h-7 w-7 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-checked:ring-2 aria-checked:ring-fg/70"
      style={{ background: `var(--c-${color})` }}
    >
      {selected && <CheckIcon weight="bold" className="h-3.5 w-3.5 text-white drop-shadow" aria-hidden />}
    </button>
  );
}

/** A style shown as what it looks like: a mini row and a mini chip. */
function StyleCard({ color, style, selected, onPick }: { color: ColorKey; style: StyleKey; selected: boolean; onPick: () => void }) {
  const look: Look = { color, style, kind: "category", label: STYLE_LABEL[style] };
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={STYLE_LABEL[style]}
      onClick={onPick}
      className={`relative flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        selected ? "border-accent bg-accent-soft/50" : "border-line hover:border-line-strong"
      }`}
    >
      <span className="flex items-center gap-1.5">
        <LookMark look={look} />
        <span className="h-1.5 flex-1 rounded-full bg-line-strong" aria-hidden />
      </span>
      <span className="look-fill block h-4 rounded" data-style={style} style={lookVars(look)} aria-hidden />
      <span className="text-xs font-medium text-fg">{STYLE_LABEL[style]}</span>
      {selected && (
        <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-fg">
          <CheckIcon weight="bold" className="h-2.5 w-2.5" aria-hidden />
        </span>
      )}
    </button>
  );
}

/** Color (and, for categories, style) chosen by looking, with a preview
 * of how it shows up in lists and the calendar. Only palette keys. */
export default function LookPicker({
  color,
  style,
  onChange,
  previewLabel,
  kind = "category",
}: {
  color: string;
  style: string;
  onChange: (next: { color: ColorKey; style: StyleKey }) => void;
  previewLabel: string;
  /** Courses all share one academic look; only their color is chosen. */
  kind?: "course" | "category";
}) {
  const c = toColor(color);
  const s = toStyle(style);
  const [more, setMore] = useState(() => SECONDARY_COLORS.includes(c));
  return (
    <div className="space-y-4">
      <div>
        <span className={LABEL}>Color</span>
        <div role="radiogroup" aria-label="Color" className="mt-2 flex flex-wrap items-center gap-2">
          {PRIMARY_COLORS.map((key) => (
            <Swatch key={key} color={key} selected={key === c} onPick={() => onChange({ color: key, style: s })} />
          ))}
          {more &&
            SECONDARY_COLORS.map((key) => (
              <Swatch key={key} color={key} selected={key === c} onPick={() => onChange({ color: key, style: s })} />
            ))}
          {!more && (
            <button
              type="button"
              onClick={() => setMore(true)}
              className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              More colors
              <CaretDownIcon className="h-3 w-3" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {kind === "category" && (
        <div>
          <span className={LABEL}>Style</span>
          <div role="radiogroup" aria-label="Style" className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {STYLES.map((key) => (
              <StyleCard key={key} color={c} style={key} selected={key === s} onPick={() => onChange({ color: c, style: key })} />
            ))}
          </div>
        </div>
      )}

      <LookPreview color={c} style={s} label={previewLabel} kind={kind} />
    </div>
  );
}

/** How the look shows up: a list row and a calendar chip. */
export function LookPreview({ color, style, label, kind = "category" }: { color: string; style: string; label: string; kind?: "course" | "category" }) {
  const look: Look = { color: toColor(color), style: toStyle(style), kind, label: label || "Preview" };
  return (
    <div className="space-y-2 rounded-xl bg-surface-2/60 p-3" aria-label={`Preview of ${look.label}`}>
      <span className="block text-[11px] font-medium uppercase tracking-wide text-fg-faint">Preview</span>
      <div className="flex items-stretch gap-2.5">
        <ItemEdge look={look} />
        <span className="min-w-0">
          <span className="block text-sm text-fg">{kind === "course" ? "Project 2" : "Example item"}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-muted">
            {kind === "course" ? (
              <span
                className="look-fill inline-flex items-center gap-1 rounded-md py-px pl-2 pr-1.5 text-[11px] font-medium text-fg"
                data-kind="course"
                style={lookVars(look)}
              >
                <GraduationCapIcon weight="fill" className="look-ink h-3 w-3" aria-hidden />
                <span className="font-mono">{look.label}</span>
              </span>
            ) : (
              <>
                <LookMark look={look} className="h-2 w-2" />
                {look.label}
              </>
            )}
          </span>
        </span>
      </div>
      <span
        className={`look-fill flex max-w-56 items-center gap-1 rounded py-px pr-1 text-[11px] leading-4 text-fg ${kind === "course" ? "pl-1.5" : "pl-1"}`}
        data-kind={kind}
        data-style={look.style}
        style={lookVars(look)}
      >
        {kind === "course" ? <GraduationCapIcon weight="fill" className="look-ink h-3 w-3" aria-hidden /> : <LookMark look={look} className="h-1.5 w-1.5" />}
        <span className="font-mono text-fg-muted">2p</span>
        {kind === "course" ? "Lecture" : "Calendar entry"}
      </span>
    </div>
  );
}
