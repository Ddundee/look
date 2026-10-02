"use client";

import { fmtKcal } from "@/lib/nutrition";
import type { HistoryDay } from "@/lib/types";

function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Seven daily calorie columns against the target line. Single series, so
 * no legend: the section heading names it. Each column is a button (the
 * whole column is the hit target) with a value-first tooltip on hover and
 * keyboard focus. */
export default function WeekChart({
  days,
  selected,
  onSelect,
  lastSelectable,
}: {
  days: HistoryDay[];
  selected: string;
  onSelect: (iso: string) => void;
  /** Days after this (later in the week) have no data yet and can't be picked. */
  lastSelectable?: string;
}) {
  const target = days[days.length - 1]?.targets?.calories ?? null;
  const peak = Math.max(1, ...days.map((d) => d.totals.calories), target ? target * 1.15 : 0);

  return (
    <div>
      <div className="relative h-36 border-b border-line">
        {target && (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-fg-faint/70"
            style={{ bottom: `${(target / peak) * 100}%` }}
          >
            <span className="absolute -top-5 right-0 bg-surface pl-1 font-mono text-[11px] tabular-nums text-fg-muted">
              {fmtKcal(target)} target
            </span>
          </div>
        )}
        <div className="grid h-full grid-cols-7 gap-2 sm:gap-3">
          {days.map((d) => {
            const date = parse(d.day);
            const cal = d.totals.calories;
            const goal = d.targets?.calories ?? null;
            const over = goal !== null && cal > goal;
            const isSelected = d.day === selected;
            const dateLabel = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
            const value = d.entry_count ? `${fmtKcal(cal)} kcal` : "Nothing logged";
            const detail = goal !== null ? `${over ? "over" : "of"} ${fmtKcal(goal)} target` : null;
            const future = lastSelectable !== undefined && d.day > lastSelectable;
            return (
              <button
                key={d.day}
                type="button"
                onClick={() => onSelect(d.day)}
                disabled={future}
                aria-label={future ? `${dateLabel}: still to come` : `${dateLabel}: ${value}${detail ? `, ${detail}` : ""}`}
                aria-pressed={isSelected}
                className="group relative flex h-full items-end justify-center rounded-t-md outline-offset-2 disabled:cursor-default"
              >
                <span
                  className={`block w-full max-w-6 rounded-t-[4px] transition-[height,background-color,box-shadow] duration-300 ${
                    future
                      ? "bg-line"
                      : d.entry_count === 0
                      ? "bg-line-strong"
                      : over
                        ? "bg-warn group-hover:brightness-110"
                        : "bg-accent group-hover:bg-accent-hover"
                  } ${isSelected ? "ring-2 ring-fg/70 ring-offset-2 ring-offset-surface" : ""}`}
                  style={{ height: d.entry_count ? `${Math.max(2, (cal / peak) * 100)}%` : "2px" }}
                />
                <span
                  role="presentation"
                  className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-surface px-2.5 py-1.5 text-left elev-3 ${
                    future ? "" : "group-hover:block group-focus-visible:block"
                  }`}
                >
                  <span className="block font-mono text-sm font-medium tabular-nums text-fg">{value}</span>
                  <span className="block text-[11px] text-fg-muted">
                    {dateLabel}
                    {detail && `, ${detail}`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-2 sm:gap-3" aria-hidden>
        {days.map((d) => {
          const date = parse(d.day);
          const isSelected = d.day === selected;
          return (
            <span
              key={d.day}
              className={`text-center text-[11px] leading-tight ${isSelected ? "font-semibold text-fg" : "text-fg-faint"}`}
            >
              {date.toLocaleDateString(undefined, { weekday: "narrow" })}
              <span className="block font-mono tabular-nums">{date.getDate()}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
