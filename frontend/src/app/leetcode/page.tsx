"use client";

import { useEffect, useState } from "react";
import {
  ArrowSquareOutIcon,
  CodeIcon,
  FireIcon,
  LightbulbIcon,
  PlusIcon,
  TargetIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { formatDate, relativeDueLabel } from "@/lib/format";
import { CONFIDENCE_LABEL, DIFFICULTIES, DIFFICULTY_LABEL, DIFFICULTY_TEXT, pct } from "@/lib/leetcode";
import { toast, toastError } from "@/lib/toast";
import type { LeetCodeAttempt, LeetCodeStats, LeetCodeTopicStats } from "@/lib/types";
import { BUTTON_GHOST_SM, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, FIELD, ICON_BUTTON } from "@/lib/ui";
import { EmptyState, ErrorState, Page, PageHeader, Panel, TaskListSkeleton } from "@/components/PageParts";
import AttemptModal from "@/components/leetcode/AttemptModal";
import GoalsModal from "@/components/leetcode/GoalsModal";

const SELECT = `h-8 pr-8 text-[13px] ${FIELD}`;

function Meter({ value, target }: { value: number; target: number }) {
  const width = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-surface-2">
      <span className="block h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${width}%` }} />
    </span>
  );
}

function Stat({ label, value, sub, children }: { label: string; value: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 px-5 py-3">
      <div className="text-[13px] text-fg-muted">{label}</div>
      <div className="mt-1 font-mono text-2xl font-medium tabular-nums tracking-tight text-fg">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-fg-faint">{sub}</div>}
      {children}
    </div>
  );
}

function outcome(a: LeetCodeAttempt): { label: string; className: string } {
  if (!a.solved) return { label: "Not solved", className: "bg-danger-soft text-danger" };
  if (a.hint_used) return { label: "Solved with hint", className: "bg-warn-soft text-warn" };
  // false = needed help; null = not recorded (imported history), shown as plain "Solved".
  return { label: a.solved_independently === false ? "Solved with help" : "Solved", className: "bg-accent-soft text-accent-text" };
}

function AttemptRow({ attempt, index, onDeleted }: { attempt: LeetCodeAttempt; index: number; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(id);
  }, [confirming]);

  async function remove() {
    if (!confirming) return setConfirming(true);
    setBusy(true);
    try {
      await api.deleteLeetCodeAttempt(attempt.id);
      toast(`Deleted the attempt on #${attempt.problem.number}`, "info");
      onDeleted();
    } catch (err) {
      toastError(err, "Couldn't delete the attempt");
      setBusy(false);
    }
  }

  const p = attempt.problem;
  const result = outcome(attempt);
  const day = attempt.attempted_at.slice(0, 10);
  return (
    <li
      style={{ "--i": index } as React.CSSProperties}
      className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-surface-2/70 focus-within:bg-surface-2/70"
    >
      <span className="w-12 shrink-0 pt-px font-mono text-xs tabular-nums text-fg-faint">#{p.number}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {p.url ? (
            <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-fg [overflow-wrap:anywhere] hover:underline hover:underline-offset-4">
              {p.title}
              <ArrowSquareOutIcon className="h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden />
              <span className="sr-only">(opens LeetCode)</span>
            </a>
          ) : (
            <span className="text-sm text-fg">{p.title}</span>
          )}
          <span className={`rounded-md px-1.5 py-px text-[11px] font-medium ${result.className}`}>{result.label}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-muted">
          <span className={DIFFICULTY_TEXT[p.difficulty]}>{DIFFICULTY_LABEL[p.difficulty]}</span>
          <span>{relativeDueLabel(day) === formatDate(day) ? formatDate(day) : relativeDueLabel(day)}</span>
          {attempt.duration_minutes !== null && <span className="font-mono tabular-nums">{attempt.duration_minutes}m</span>}
          {attempt.language && <span>{attempt.language}</span>}
          {attempt.source === "leetcode" &&
            (attempt.external_url ? (
              <a href={attempt.external_url} target="_blank" rel="noopener noreferrer" className="text-fg-faint hover:underline hover:underline-offset-4" title="Imported from your LeetCode submission history">
                Imported
              </a>
            ) : (
              <span className="text-fg-faint">Imported</span>
            ))}
          {attempt.confidence !== null && (
            <span title={CONFIDENCE_LABEL[attempt.confidence]}>
              confidence <span className="font-mono tabular-nums">{attempt.confidence}/5</span>
            </span>
          )}
          {p.topics.length > 0 && <span className="text-fg-faint">{p.topics.join(", ")}</span>}
        </div>
        {attempt.notes && <p className="mt-1 text-xs leading-relaxed text-fg-muted">{attempt.notes}</p>}
      </div>
      <button
        onClick={remove}
        disabled={busy}
        aria-label={confirming ? `Confirm delete attempt on ${p.title}` : `Delete attempt on ${p.title}`}
        title={confirming ? "Click again to delete" : "Delete"}
        className={
          confirming
            ? "-my-1 inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-danger px-2 text-xs font-medium text-surface"
            : `-my-1 ${ICON_BUTTON} hover:bg-danger-soft hover:text-danger [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100`
        }
      >
        <TrashIcon className="h-4 w-4" aria-hidden />
        {confirming && "Delete?"}
      </button>
    </li>
  );
}

export default function LeetCodePage() {
  const [stats, setStats] = useState<LeetCodeStats | null>(null);
  const [topics, setTopics] = useState<LeetCodeTopicStats | null>(null);
  const [attempts, setAttempts] = useState<LeetCodeAttempt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [difficulty, setDifficulty] = useState("");
  const [topic, setTopic] = useState("");
  const [result, setResult] = useState("");
  const [logging, setLogging] = useState(false);
  const [editingGoals, setEditingGoals] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getLeetCodeStats(), api.getLeetCodeTopics()])
      .then(([s, t]) => {
        if (cancelled) return;
        setStats(s);
        setTopics(t);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load LeetCode progress");
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  useEffect(() => {
    let cancelled = false;
    api
      .listLeetCodeAttempts({
        limit: 30,
        difficulty: difficulty || undefined,
        topic: topic || undefined,
        solved: result === "" ? undefined : result === "solved",
      })
      .then((r) => {
        if (!cancelled) setAttempts(r.attempts);
      })
      .catch(() => {
        if (!cancelled) setAttempts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [version, difficulty, topic, result]);

  const refresh = () => setVersion((v) => v + 1);
  const filtered = !!(difficulty || topic || result);
  const knownTopics = topics?.topics.map((t) => t.topic) ?? [];
  const goals = stats?.goals;

  return (
    <Page>
      <PageHeader
        title="LeetCode"
        subtitle="What you actually solved. Plans stay in your tasks."
        actions={
          <>
            {goals && (
              <button onClick={() => setEditingGoals(true)} className={`h-8 py-0 text-[13px] ${BUTTON_SECONDARY}`}>
                <TargetIcon className="h-4 w-4" aria-hidden />
                Goals
              </button>
            )}
            <button onClick={() => setLogging(true)} className={`h-8 py-0 text-[13px] ${BUTTON_PRIMARY}`}>
              <PlusIcon weight="bold" className="h-4 w-4" aria-hidden />
              Log attempt
            </button>
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={refresh} />}

      {!stats || !topics ? (
        !error && (
          <div className="space-y-8" aria-busy="true">
            <div className={`shimmer h-28 ${CARD}`} />
            <TaskListSkeleton rows={4} />
          </div>
        )
      ) : stats.total_attempts === 0 ? (
        <EmptyState
          icon={CodeIcon}
          title="No attempts logged yet"
          action={
            <button onClick={() => setLogging(true)} className={BUTTON_PRIMARY}>
              <PlusIcon weight="bold" className="h-4 w-4" aria-hidden />
              Log attempt
            </button>
          }
        >
          Log a problem here, or tell ChatGPT something like &ldquo;I solved 560 in 23 minutes in Java, needed one hint,
          confidence 3/5.&rdquo;
        </EmptyState>
      ) : (
        <>
        <section aria-label="Progress" className={`anim-fade-up grid shrink-0 grid-cols-2 divide-line overflow-hidden sm:grid-cols-4 sm:divide-x ${CARD}`}>
          <Stat label="Today" value={`${stats.solved_today}/${stats.goals.daily_target}`} sub="solved vs daily goal">
            <Meter value={stats.solved_today} target={stats.goals.daily_target} />
          </Stat>
          <Stat label="This week" value={`${stats.solved_this_week}/${stats.goals.weekly_target}`} sub={`since ${formatDate(stats.week_start)}`}>
            <Meter value={stats.solved_this_week} target={stats.goals.weekly_target} />
          </Stat>
          <Stat
            label="Streak"
            value={
              <span className="inline-flex items-center gap-1.5">
                {stats.current_streak}
                {stats.current_streak > 0 && <FireIcon weight="fill" className="h-5 w-5 text-warn" aria-hidden />}
              </span>
            }
            sub={`day${stats.current_streak === 1 ? "" : "s"}, best ${stats.best_streak}`}
          />
          <Stat label="Solved" value={stats.total_solved} sub={`problems, ${stats.total_attempts} attempts`} />
        </section>

          <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Panel
              title="Recent attempts"
              icon={CodeIcon}
              count={attempts?.length}
              labelledBy="lc-recent"
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <select aria-label="Filter by difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className={SELECT}>
                    <option value="">Any difficulty</option>
                    {DIFFICULTIES.map((d) => (
                      <option key={d} value={d}>
                        {DIFFICULTY_LABEL[d]}
                      </option>
                    ))}
                  </select>
                  <select aria-label="Filter by topic" value={topic} onChange={(e) => setTopic(e.target.value)} className={SELECT}>
                    <option value="">Any topic</option>
                    {knownTopics.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <select aria-label="Filter by result" value={result} onChange={(e) => setResult(e.target.value)} className={SELECT}>
                    <option value="">Any result</option>
                    <option value="solved">Solved</option>
                    <option value="unsolved">Not solved</option>
                  </select>
                  {filtered && (
                    <button
                      onClick={() => {
                        setDifficulty("");
                        setTopic("");
                        setResult("");
                      }}
                      className={`h-8 ${BUTTON_GHOST_SM}`}
                    >
                      <XIcon className="h-3.5 w-3.5" aria-hidden />
                      Clear
                    </button>
                  )}
                </div>
              }
            >
              {attempts === null ? (
                <TaskListSkeleton rows={3} className="" />
              ) : attempts.length === 0 ? (
                <p className="flex h-full min-h-32 items-center justify-center px-4 text-center text-sm text-fg-faint">
                  No attempts match these filters.
                </p>
              ) : (
                <ul className="anim-stagger">
                  {attempts.map((a, i) => (
                    <AttemptRow key={a.id} attempt={a} index={i} onDeleted={refresh} />
                  ))}
                </ul>
              )}
            </Panel>

            <div className="flex flex-col gap-4 lg:min-h-0">
              <section aria-labelledby="lc-breakdown" className={`anim-fade-up shrink-0 p-4 ${CARD}`}>
                <h2 id="lc-breakdown" className="sr-only">
                  Difficulty and habits
                </h2>
                <dl className="grid grid-cols-3 gap-3">
                  {DIFFICULTIES.map((d) => (
                    <div key={d}>
                      <dt className={`text-[13px] font-medium ${DIFFICULTY_TEXT[d]}`}>{DIFFICULTY_LABEL[d]}</dt>
                      <dd className="mt-0.5 font-mono text-lg tabular-nums text-fg">{stats.solved_by_difficulty[d]}</dd>
                    </div>
                  ))}
                </dl>
                <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-line pt-3">
                  <div>
                    <dt className="text-[13px] text-fg-muted">Avg time</dt>
                    <dd className="mt-0.5 font-mono text-lg tabular-nums text-fg">
                      {stats.avg_solve_minutes === null ? "-" : `${Math.round(stats.avg_solve_minutes)}m`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[13px] text-fg-muted">Hints</dt>
                    <dd className="mt-0.5 font-mono text-lg tabular-nums text-fg">{pct(stats.hint_usage_rate)}</dd>
                  </div>
                  <div>
                    <dt className="text-[13px] text-fg-muted">On your own</dt>
                    <dd className="mt-0.5 font-mono text-lg tabular-nums text-fg">{pct(stats.independent_solve_rate)}</dd>
                  </div>
                </dl>
              </section>

              <Panel
                title="Topics"
                icon={LightbulbIcon}
                labelledBy="lc-topics"
                className="lg:flex-1"
                actions={<span className="text-xs text-fg-faint">weakest first, last {topics.recent_window} attempts each</span>}
              >
                {stats.insights.length > 0 && (
                  <ul aria-label="Insights" className="mb-1 space-y-1.5 border-b border-line px-3 pb-3 pt-2">
                    {stats.insights.map((line) => (
                      <li key={line} className="flex items-start gap-2.5 text-sm leading-relaxed text-fg">
                        <LightbulbIcon weight="duotone" className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                        {line}
                      </li>
                    ))}
                  </ul>
                )}
                {topics.topics.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-fg-faint">Topics show up once attempts have them.</p>
                ) : (
                  <ul>
                    {topics.topics.map((t) => {
                      const weak = topics.weakest.includes(t.topic);
                      return (
                        <li key={t.topic}>
                          <button
                            type="button"
                            onClick={() => setTopic(topic === t.topic ? "" : t.topic)}
                            aria-pressed={topic === t.topic}
                            className={`flex w-full items-start gap-4 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface-2/70 ${
                              topic === t.topic ? "bg-accent-soft" : ""
                            }`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2 text-sm text-fg">
                                {t.topic}
                                {weak && <span className="rounded-md bg-warn-soft px-1.5 py-px text-[11px] font-medium text-warn">Needs work</span>}
                              </span>
                              <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">{t.reasons.join(", ")}</span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block font-mono text-sm tabular-nums text-fg">
                                {t.solved_problems}/{t.problems}
                              </span>
                              <span className="block text-[11px] text-fg-faint">solved</span>
                            </span>
                            <span className="w-20 shrink-0 pt-1.5" aria-hidden={t.weakness === null}>
                              {t.weakness === null ? (
                                <span className="block text-right text-[11px] text-fg-faint">not rated</span>
                              ) : (
                                <>
                                  <span className="block h-1.5 overflow-hidden rounded-full bg-surface-2">
                                    <span
                                      className={`block h-full rounded-full ${weak ? "bg-warn" : "bg-accent"}`}
                                      style={{ width: `${Math.max(4, t.weakness * 100)}%` }}
                                    />
                                  </span>
                                  <span className="mt-1 block text-right text-[11px] text-fg-faint">
                                    weakness <span className="font-mono tabular-nums">{Math.round(t.weakness * 100)}</span>
                                  </span>
                                </>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>
            </div>
          </div>
        </>
      )}

      {logging && <AttemptModal knownTopics={knownTopics} onClose={() => setLogging(false)} onLogged={refresh} />}
      {editingGoals && goals && <GoalsModal goals={goals} onClose={() => setEditingGoals(false)} onSaved={refresh} />}
    </Page>
  );
}
