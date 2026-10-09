"use client";

import { VIEW_ICONS } from "./icons";

/** One of the fixed icons views and blocks can use. */
export default function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Icon" className="flex flex-wrap gap-1.5">
      {Object.entries(VIEW_ICONS).map(([key, IconC]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          aria-label={key.replace("-", " ")}
          onClick={() => onChange(key)}
          className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
            value === key ? "border-accent bg-accent-soft text-accent" : "border-line text-fg-muted hover:border-line-strong hover:text-fg"
          }`}
        >
          <IconC weight={value === key ? "fill" : "regular"} className="h-4 w-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}
