"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CaretLeftIcon, CaretRightIcon, ForkKnifeIcon, PlusIcon, TargetIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { addDaysIso, formatDate, formatDateLong, relativeDueLabel, todayIso, weekdayLabel } from "@/lib/format";
import { weekRangeIso } from "@/lib/week";
import { fmtGrams, fmtKcal, groupByMeal } from "@/lib/nutrition";
import type { DaySummary, FoodEntry, HistorySummary, TargetsResponse } from "@/lib/types";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, ICON_BUTTON } from "@/lib/ui";
import { EmptyState, ErrorState, Page, PageHeader, Panel, TaskListSkeleton } from "@/components/PageParts";
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
  // The chart is the calendar week (Mon-Sun) containing the selected day,
  // so picking another day of the same week keeps the same seven bars.
  const week = weekRangeIso(day);

  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [weekSummary, setWeek] = useState<HistorySummary | null>(null);
  const [targets, setTargets] = useState<TargetsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<FoodEntry | null | "new">(null);
  const [editingTargets, setEditingTargets] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getNutritionDay(day),
      api.getNutritionHistory(week.start, week.end),
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
  }, [day, week.start, week.end, version]);

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
    <Page>
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
          <div className="space-y-4" aria-busy="true">
            <div className={`shimmer h-36 ${CARD}`} />
            <TaskListSkeleton rows={3} />
          </div>
        )
      ) : (
        <div
          className={`grid gap-4 transition-opacity lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_20rem] ${
            stale ? "opacity-60" : ""
          }`}
        >
          <div className="flex flex-col gap-4 lg:min-h-0">
            <section aria-label="Totals" className="anim-fade-up shrink-0">
              <MacroSummary summary={summary} onSetTargets={() => setEditingTargets(true)} />
            </section>

            <Panel
              title="Food log"
              icon={ForkKnifeIcon}
              count={summary.entries.length}
              labelledBy="food-log-heading"
              className="lg:flex-1"
              bodyClassName="p-1"
              actions={
                summary.entries.length > 0 && (
                  <button onClick={() => setEditing("new")} className={`h-8 py-0 text-[13px] ${BUTTON_PRIMARY}`}>
                    <PlusIcon weight="bold" className="h-4 w-4" aria-hidden />
                    Add food
                  </button>
                )
              }
            >
              {summary.entries.length === 0 ? (
                <EmptyState
                  variant="panel"
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
                groups.map((g) => (
                  <div key={g.key}>
                    <h3 className="flex items-baseline justify-between px-3 pb-0.5 pt-2.5 text-xs">
                      <span className="font-medium text-fg">{g.label}</span>
                      <span className="font-mono tabular-nums text-fg-faint">{fmtKcal(g.calories)} kcal</span>
                    </h3>
                    <ul className="anim-stagger">
                      {g.entries.map((e, i) => (
                        <FoodRow key={e.id} entry={e} index={i} onEdit={setEditing} onDeleted={refresh} />
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </Panel>
          </div>

          {weekSummary && (
            <section aria-labelledby="week-heading" className={`anim-fade-up self-start p-5 ${CARD}`}>
              <h2 id="week-heading" className="pb-6 text-[13px] font-medium text-fg-muted">
                Calories, week of {formatDate(week.start)}
              </h2>
              <WeekChart days={weekSummary.days} selected={day} onSelect={goTo} lastSelectable={today} />
              <p className="mt-5 border-t border-line pt-4 text-sm text-fg-muted">
                {weekSummary.averages ? (
                  <>
                    Averaging <span className="font-mono tabular-nums text-fg">{fmtKcal(weekSummary.averages.calories)}</span>{" "}
                    kcal and <span className="font-mono tabular-nums text-fg">{fmtGrams(weekSummary.averages.protein_g)}</span>{" "}
                    protein over {weekSummary.logged_days} logged {weekSummary.logged_days === 1 ? "day" : "days"}.
                  </>
                ) : (
                  "Nothing logged this week."
                )}
              </p>
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
    </Page>
  );
}

export default function NutritionPage() {
  return (
    <Suspense fallback={<TaskListSkeleton rows={3} />}>
      <NutritionView />
    </Suspense>
  );
}
