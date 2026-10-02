"use client";

import { TargetIcon } from "@phosphor-icons/react";
import { fmtGrams, fmtKcal, MACRO_LABEL, MACROS } from "@/lib/nutrition";
import type { DaySummary, MacroKey } from "@/lib/types";
import { BUTTON_SECONDARY, CARD } from "@/lib/ui";

function Bar({ value, goal, over, thick }: { value: number; goal: number; over: boolean; thick?: boolean }) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
  return (
    <span className={`relative block overflow-hidden rounded-full bg-surface-2 ${thick ? "h-2.5" : "h-1.5"}`}>
      <span
        className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out ${
          over ? "bg-warn" : "bg-accent"
        }`}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

export default function MacroSummary({
  summary,
  onSetTargets,
}: {
  summary: DaySummary;
  onSetTargets: () => void;
}) {
  const { totals, targets, remaining, over } = summary;
  const isOver = (k: MacroKey) => over.includes(k);
  const calLeft = remaining?.calories ?? null;

  return (
    <div className={`p-5 ${CARD}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-4xl font-medium tabular-nums tracking-tight text-fg">
            {fmtKcal(totals.calories)}
          </span>
          {targets && (
            <span className="font-mono text-base tabular-nums text-fg-faint">/ {fmtKcal(targets.calories)}</span>
          )}
          <span className="text-sm text-fg-muted">kcal</span>
        </div>
        {calLeft !== null ? (
          <p className={`text-sm font-medium ${isOver("calories") ? "text-warn" : "text-fg-muted"}`}>
            <span className="font-mono tabular-nums">{fmtKcal(Math.abs(calLeft))}</span>{" "}
            {isOver("calories") ? "over" : "left"}
          </p>
        ) : (
          <button onClick={onSetTargets} className={`h-8 py-0 text-[13px] ${BUTTON_SECONDARY}`}>
            <TargetIcon className="h-4 w-4" aria-hidden />
            Set targets
          </button>
        )}
      </div>

      {targets && (
        <div className="mt-3">
          <Bar value={totals.calories} goal={targets.calories} over={isOver("calories")} thick />
        </div>
      )}

      <dl className="mt-4 grid grid-cols-3 gap-4 sm:gap-6">
        {MACROS.map((m) => {
          const goal = targets?.[m] ?? null;
          return (
            <div key={m} className="min-w-0">
              <dt className="text-[13px] text-fg-muted">{MACRO_LABEL[m]}</dt>
              <dd className="mt-1">
                <span className={`font-mono text-sm tabular-nums ${isOver(m) ? "text-warn" : "text-fg"}`}>
                  {fmtGrams(totals[m])}
                </span>
                {goal !== null && (
                  <span className="font-mono text-xs tabular-nums text-fg-faint"> / {fmtGrams(goal)}</span>
                )}
                {isOver(m) && <span className="ml-1 text-xs font-medium text-warn">over</span>}
                {goal !== null && (
                  <span className="mt-2 block">
                    <Bar value={totals[m]} goal={goal} over={isOver(m)} />
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
