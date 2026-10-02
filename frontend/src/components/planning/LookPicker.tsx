"use client";

import { CheckIcon } from "@phosphor-icons/react";
import { COLORS, lookVars, STYLE_LABEL, STYLES, toColor, toStyle, type ColorKey, type StyleKey } from "@/lib/palette";
import { LABEL } from "@/lib/ui";

/** Color swatches + style choice + a live preview. Only palette keys. */
export default function LookPicker({
  color,
  style,
  onChange,
  previewLabel,
  course = false,
}: {
  color: string;
  style: string;
  onChange: (next: { color: ColorKey; style: StyleKey }) => void;
  previewLabel: string;
  course?: boolean;
}) {
  const c = toColor(color);
  const s = toStyle(style);
  return (
    <div className="space-y-3">
      <div>
        <span className={LABEL}>Color</span>
        <div role="radiogroup" aria-label="Color" className="mt-1.5 flex flex-wrap gap-1.5">
          {COLORS.map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={key === c}
              aria-label={key}
              title={key}
              onClick={() => onChange({ color: key, style: s })}
              className="flex h-6 w-6 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition-shadow aria-checked:ring-2 aria-checked:ring-fg/60"
              style={{ background: `var(--c-${key})` }}
            >
              {key === c && <CheckIcon weight="bold" className="h-3 w-3 text-white" aria-hidden />}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className={LABEL}>Style</span>
        <div role="radiogroup" aria-label="Style" className="mt-1.5 grid grid-cols-5 gap-1.5">
          {STYLES.map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={key === s}
              onClick={() => onChange({ color: c, style: key })}
              className="look-fill flex h-9 items-center justify-center rounded-lg text-xs font-medium text-fg ring-offset-2 ring-offset-surface aria-checked:ring-2 aria-checked:ring-accent"
              data-style={key}
              style={lookVars({ color: c })}
            >
              {STYLE_LABEL[key]}
            </button>
          ))}
        </div>
      </div>
      <LookPreview color={c} style={s} label={previewLabel} course={course} />
    </div>
  );
}

/** How the look shows up in lists and the calendar. */
export function LookPreview({ color, style, label, course = false }: { color: string; style: string; label: string; course?: boolean }) {
  const look = { color: toColor(color), style: toStyle(style) };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2/60 px-3 py-2" aria-label={`Preview of ${label}`}>
      <span className="flex items-stretch gap-2">
        <span className="look-edge" data-style={look.style} style={lookVars(look)} aria-hidden />
        <span className="text-sm text-fg">{label || "Preview"}</span>
      </span>
      <span
        className="look-fill rounded px-1.5 py-px text-[11px] leading-4 text-fg"
        data-style={look.style}
        style={lookVars(look)}
      >
        <span className="font-mono text-fg-muted">2p</span> {course ? "Lecture" : "Event"}
      </span>
    </div>
  );
}
