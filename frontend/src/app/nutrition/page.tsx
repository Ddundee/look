"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CaretLeftIcon, CaretRightIcon, ForkKnifeIcon, PlusIcon, TargetIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { addDaysIso, formatDateLong, relativeDueLabel, todayIso, weekdayLabel } from "@/lib/format";
import { fmtGrams, fmtKcal, groupByMeal } from "@/lib/nutrition";
import type { DaySummary, FoodEntry, HistorySummary, TargetsResponse } from "@/lib/types";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, CARD_LIST, ICON_BUTTON } from "@/lib/ui";
import { EmptyState, ErrorState, PageHeader, TaskListSkeleton } from "@/components/PageParts";
import FoodEntryModal from "@/components/nutrition/FoodEntryModal";
import FoodRow from "@/components/nutrition/FoodRow";
import MacroSummary from "@/components/nutrition/MacroSummary";
import TargetsModal from "@/components/nutrition/TargetsModal";
import WeekChart from "@/components/nutrition/WeekChart";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function dayTitle(iso: string): string {
  const rel = relativeDueLabel(iso);
  return rel === "Today" || rel === "Yesterday" ? rel : weekdayLabel(iso);
}

function NutritionView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = todayIso();
  const raw = params.get("date");
  // Selected day lives in ?date= so a day is linkable; anything malformed
  // or in the future falls back to today.
  const day = raw && ISO.test(raw) && raw <= today ? raw : today;

  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [week, setWeek] = useState<HistorySummary | null>(null);
  const [targets, setTargets] = useState<TargetsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<FoodEntry | null | "new">(null);
  const [editingTargets, setEditingTargets] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getNutritionDay(day),
      api.getNutritionHistory(addDaysIso(day, -6), day),
      api.getNutritionTargets(),
    ])
      .then(([s, h, t]) => {
        if (cancelled) return;
        setSummary(s);
        setWeek(h);
        setTargets(t);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load nutrition");
      });
    return () => {
      cancelled = true;
    };
  }, [day, version]);

  function goTo(iso: string) {
    router.replace(iso >= today ? pathname : `${pathname}?date=${iso}`, { scroll: false });
  }

  // Mutations return the updated day; show it immediately, then refetch
  // the week chart and targets in the background.
  function refresh(next?: DaySummary) {
    if (next && next.day === day) setSummary(next);
    setVersion((v) => v + 1);
  }

  const groups = summary ? groupByMeal(summary.entries) : [];
  const stale = summary !== null && summary.day !== day;

  return (
    <div>
      <PageHeader
        title={dayTitle(day)}
        subtitle={formatDateLong(day)}
        actions={
          <>
            <button onClick={() => setEditingTargets(true)} className={`h-8 py-0 text-[13px] ${BUTTON_SECONDARY}`}>
              <TargetIcon className="h-4 w-4" aria-hidden />
              Targets
            </button>
            {day !== today && (
              <button onClick={() => goTo(today)} className={`h-8 py-0 text-[13px] ${BUTTON_SECONDARY}`}>
                Today
              </button>
            )}
            <div className="flex items-center rounded-lg border border-line">
              <button onClick={() => goTo(addDaysIso(day, -1))} aria-label="Previous day" className={ICON_BUTTON}>
                <CaretLeftIcon className="h-4 w-4" aria-hidden />
              </button>
              <button
                onClick={() => goTo(addDaysIso(day, 1))}
                disabled={day >= today}
                aria-label="Next day"
                className={ICON_BUTTON}
              >
                <CaretRightIcon className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={() => setVersion((v) => v + 1)} />}

      {!summary ? (
        !error && (
          <div className="space-y-8" aria-busy="true">
            <div className={`shimmer h-40 ${CARD}`} />
            <TaskListSkeleton rows={3} />
          </div>
        )
      ) : (
        <div className={`space-y-10 transition-opacity ${stale ? "opacity-60" : ""}`}>
          <section aria-label="Totals" className="anim-fade-up">
            <MacroSummary summary={summary} onSetTargets={() => setEditingTargets(true)} />
          </section>

          <section aria-labelledby="food-log-heading">
            <div className="flex items-center justify-between px-1 pb-2">
              <h2 id="food-log-heading" className="text-[13px] font-medium text-fg-muted">
                Food log
              </h2>
              {summary.entries.length > 0 && (
                <button onClick={() => setEditing("new")} className={`h-8 py-0 text-[13px] ${BUTTON_PRIMARY}`}>
                  <PlusIcon weight="bold" className="h-4 w-4" aria-hidden />
                  Add food
                </button>
              )}
            </div>
            {summary.entries.length === 0 ? (
              <EmptyState
                icon={ForkKnifeIcon}
                title={day === today ? "Nothing logged yet today" : "Nothing logged this day"}
                action={
                  <button onClick={() => setEditing("new")} className={BUTTON_PRIMARY}>
                    <PlusIcon weight="bold" className="h-4 w-4" aria-hidden />
                    Add food
                  </button>
                }
              >
                Tell ChatGPT what you ate, or add it here.
              </EmptyState>
            ) : (
              <div className="space-y-5">
                {groups.map((g) => (
                  <div key={g.key}>
                    <h3 className="flex items-baseline justify-between px-1 pb-1.5 text-[13px]">
                      <span className="font-medium text-fg">{g.label}</span>
                      <span className="font-mono text-xs tabular-nums text-fg-faint">{fmtKcal(g.calories)} kcal</span>
                    </h3>
                    <ul className={`anim-stagger ${CARD_LIST}`}>
                      {g.entries.map((e, i) => (
                        <FoodRow key={e.id} entry={e} index={i} onEdit={setEditing} onDeleted={refresh} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          {week && (
            <section aria-labelledby="week-heading" className="anim-fade-up">
              <h2 id="week-heading" className="px-1 pb-3 text-[13px] font-medium text-fg-muted">
                Calories, last 7 days
              </h2>
              <div className={`p-5 pt-8 ${CARD}`}>
                <WeekChart days={week.days} selected={day} onSelect={goTo} />
                <p className="mt-5 border-t border-line pt-4 text-sm text-fg-muted">
                  {week.averages ? (
                    <>
                      Averaging <span className="font-mono tabular-nums text-fg">{fmtKcal(week.averages.calories)}</span>{" "}
                      kcal and <span className="font-mono tabular-nums text-fg">{fmtGrams(week.averages.protein_g)}</span>{" "}
                      protein over {week.logged_days} logged {week.logged_days === 1 ? "day" : "days"}.
                    </>
                  ) : (
                    "No entries in these 7 days."
                  )}
                </p>
              </div>
            </section>
          )}
        </div>
      )}

      {editing && (
        <FoodEntryModal
          entry={editing === "new" ? null : editing}
          defaultDate={day}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      {editingTargets && (
        <TargetsModal
          current={targets?.current ?? null}
          onClose={() => setEditingTargets(false)}
          onSaved={() => refresh()}
        />
      )}
    </div>
  );
}

export default function NutritionPage() {
  return (
    <Suspense fallback={<TaskListSkeleton rows={3} />}>
      <NutritionView />
    </Suspense>
  );
}
