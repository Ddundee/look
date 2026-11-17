"use client";

// What a good day looks like: Daily Floor, Today's 3, While AI runs and
// Break the default (backend app.services.daily). The first three are
// ordinary tasks, completed through the normal task API; the challenge is
// its own small record. No points, coins or levels: progress, a finished
// state and a streak are the reward.
import { useState } from "react";
import {
  ArrowsClockwiseIcon,
  CheckIcon,
  FireIcon,
  LockSimpleIcon,
  LockSimpleOpenIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { completesFloor, formatMinutes, parseQuickDuration, progressPercent, todaysThreeCandidates } from "@/lib/daily";
import { notifyTasksChanged } from "@/lib/events";
import { PRIORITY_RING } from "@/lib/format";
import { toastError } from "@/lib/toast";
import { AI_WAIT_TAG, FLOOR_TAG, type DailyChallenge, type Task } from "@/lib/types";
import { BUTTON_GHOST_SM, BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD, ICON_BUTTON } from "@/lib/ui";
import WeekDots from "./WeekDots";
import { useLive, useToday } from "./widgets";
import { useWidgetCount, WidgetError, WidgetLoading } from "./WidgetShell";

// ---- shared ----------------------------------------------------------------------

/** Ticks a task through the normal task API. The new state shows at once
 * and holds until the reload brings the task back changed (its updated_at
 * moves on), so the box never flickers back. */
function useTaskToggle() {
  const [pending, setPending] = useState<Record<string, { done: boolean; stamp: string }>>({});
  const isDone = (t: Task) => {
    const p = pending[t.id];
    return p && p.stamp === t.updated_at ? p.done : t.status === "completed";
  };
  async function toggle(t: Task) {
    const next = !isDone(t);
    setPending((p) => ({ ...p, [t.id]: { done: next, stamp: t.updated_at } }));
    try {
      if (next) await api.completeTask(t.id);
      else await api.updateTask(t.id, { status: "todo" });
      notifyTasksChanged();
    } catch (err) {
      setPending((p) => {
        const rest = { ...p };
        delete rest[t.id];
        return rest;
      });
      toastError(err, "Couldn't update the task");
    }
  }
  return { isDone, toggle };
}

function CheckButton({ task, done, onToggle }: { task: Task; done: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
      aria-pressed={done}
      className={`relative flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors duration-150 before:absolute before:-inset-2.5 before:content-[''] ${
        done ? "border-accent bg-accent text-accent-fg" : PRIORITY_RING[task.priority]
      }`}
    >
      {done && <CheckIcon weight="bold" className="anim-check h-2.5 w-2.5" aria-hidden />}
    </button>
  );
}

function TaskLine({ task, done, onToggle, children }: { task: Task; done: boolean; onToggle: () => void; children?: React.ReactNode }) {
  return (
    <li className="group flex min-h-9 items-center gap-3 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-surface-2/70">
      <CheckButton task={task} done={done} onToggle={onToggle} />
      <span
        className={`min-w-0 flex-1 text-sm leading-5 [overflow-wrap:anywhere] transition-colors duration-200 ${
          done ? "text-fg-faint line-through decoration-fg-faint/60" : "text-fg"
        }`}
      >
        {task.title}
      </span>
      {children}
    </li>
  );
}

/** A one-line add box: Enter adds, Escape closes. */
function InlineAdd({ placeholder, label, onAdd, autoFocus, onClose }: {
  placeholder: string;
  label: string;
  onAdd: (text: string) => Promise<void>;
  autoFocus?: boolean;
  onClose?: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(text);
      setText("");
    } catch (err) {
      toastError(err, "Couldn't add it");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onClose?.()}
        placeholder={placeholder}
        aria-label={label}
        maxLength={200}
        autoFocus={autoFocus}
        className={`${FIELD} min-w-0 flex-1 py-1.5`}
      />
      <button type="submit" disabled={!text.trim() || busy} className={`${BUTTON_SECONDARY} px-2.5 py-1.5`} aria-label="Add">
        <PlusIcon className="h-4 w-4" aria-hidden />
      </button>
    </form>
  );
}

// ---- Daily Floor ---------------------------------------------------------------------

export function DailyFloorWidget() {
  const today = useToday();
  const floor = useLive(() => api.getDailyFloor(), [today]);
  const { isDone, toggle } = useTaskToggle();
  const [celebrate, setCelebrate] = useState(false);
  const [adding, setAdding] = useState(false);
  if (floor.error && !floor.data) return <WidgetError message={floor.error} onRetry={floor.retry} />;
  if (!floor.data) return <WidgetLoading rows={4} />;

  const f = floor.data;
  const items = f.items.map((t) => ({ task: t, done: isDone(t) }));
  const done = items.filter((i) => i.done).length;
  const won = items.length > 0 && done === items.length;

  function onToggle(task: Task) {
    // Celebrate only the click that finishes the day, never on load.
    setCelebrate(completesFloor(items.map((i) => ({ id: i.task.id, done: i.done })), task.id));
    void toggle(task);
  }

  async function addHabit(text: string) {
    // A daily recurring task with the tag: one fresh item every day.
    const { title, minutes } = parseQuickDuration(text);
    await api.createRecurringTask({ title, pattern: "daily", start_date: today, tags: [FLOOR_TAG], estimated_duration: minutes });
    notifyTasksChanged();
  }

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col justify-center gap-3">
        <div>
          <p className="text-sm font-medium text-fg">What makes today a win?</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            Add a few small daily habits. Any task tagged <span className="font-mono">{FLOOR_TAG}</span> counts.
          </p>
        </div>
        <InlineAdd placeholder="30 pushups" label="Add a daily habit" onAdd={addHabit} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {won ? (
        <div
          role="status"
          className={`flex items-center justify-between rounded-xl bg-accent-soft px-3 py-2.5 ${celebrate ? "anim-pop" : ""}`}
        >
          <span className="inline-flex items-center gap-2 text-base font-semibold tracking-wide text-accent-text">
            DAY WON <CheckIcon weight="bold" className={`h-4 w-4 ${celebrate ? "anim-check" : ""}`} aria-hidden />
          </span>
          <Streak days={f.streak} />
        </div>
      ) : (
        <div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-2xl font-medium tabular-nums tracking-tight text-fg">
              {done}
              <span className="text-fg-faint"> / {items.length}</span>
            </span>
            <Streak days={f.streak} />
          </div>
          <span
            className="mt-2 block h-2 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-label="Daily Floor progress"
            aria-valuemin={0}
            aria-valuemax={items.length}
            aria-valuenow={done}
          >
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
              style={{ width: `${progressPercent(done, items.length)}%` }}
            />
          </span>
        </div>
      )}

      <ul className="-mx-2">
        {items.map(({ task, done: d }) => (
          <TaskLine key={task.id} task={task} done={d} onToggle={() => onToggle(task)}>
            {task.estimated_duration ? (
              <span className="shrink-0 font-mono text-[11px] text-fg-faint">{formatMinutes(task.estimated_duration)}</span>
            ) : null}
          </TaskLine>
        ))}
      </ul>

      {adding ? (
        <InlineAdd placeholder="Leave the room" label="Add a daily habit" onAdd={addHabit} autoFocus onClose={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={`${BUTTON_GHOST_SM} -ml-2 self-start`}>
          <PlusIcon className="h-3.5 w-3.5" aria-hidden /> Add a habit
        </button>
      )}

      <div className="mt-auto flex items-end justify-between gap-3 border-t border-line pt-3">
        <Leisure unlocked={won} />
        <WeekDots days={f.week} today={today} filled={(d) => (d.date === today ? won : d.floor_won)} label="Days won this week" />
      </div>
    </div>
  );
}

function Streak({ days }: { days: number }) {
  if (days < 1) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
      <FireIcon weight="fill" className="h-3.5 w-3.5 text-warn" aria-hidden />
      <span className="font-mono tabular-nums">{days}</span> day{days === 1 ? "" : "s"} won
    </span>
  );
}

/** Hard things first, then the easy fun. Encouragement only: nothing is
 * blocked and nothing is scored. */
function Leisure({ unlocked }: { unlocked: boolean }) {
  return unlocked ? (
    <p className="flex items-center gap-2 text-xs">
      <LockSimpleOpenIcon className="h-4 w-4 text-accent-text" aria-hidden />
      <span>
        <span className="font-medium text-fg">Leisure ✓</span> <span className="text-fg-muted">Guilt-free.</span>
      </span>
    </p>
  ) : (
    <p className="flex items-center gap-2 text-xs text-fg-faint">
      <LockSimpleIcon className="h-4 w-4" aria-hidden />
      <span>
        <span className="font-medium text-fg-muted">Leisure</span> after your Daily Floor.
      </span>
    </p>
  );
}

// ---- Today's 3 -----------------------------------------------------------------------

const THREE = 3;

export function TodaysThreeWidget() {
  const today = useToday();
  const three = useLive(() => api.getTodaysThree(), [today]);
  const { isDone, toggle } = useTaskToggle();
  const [choosing, setChoosing] = useState(false);
  useWidgetCount(three.data ? three.data.items.filter((t) => !isDone(t)).length : null);
  if (three.error && !three.data) return <WidgetError message={three.error} onRetry={three.retry} />;
  if (!three.data) return <WidgetLoading rows={3} />;
  const t3 = three.data;

  async function unplan(task: Task) {
    try {
      await api.unplanFromToday(task.id); // planned_for_date only; the due date stays
      notifyTasksChanged();
    } catch (err) {
      toastError(err, "Couldn't change today's plan");
    }
  }

  if (choosing) return <ChooseForToday today={today} open={THREE - t3.planned_total} onDone={() => setChoosing(false)} />;

  const empty = Math.max(0, THREE - t3.items.length);
  return (
    <div className="flex h-full flex-col gap-2">
      <p className="text-xs text-fg-muted">The three things you actually want done today.</p>
      <ol className="-mx-2">
        {t3.items.map((task) => (
          <TaskLine key={task.id} task={task} done={isDone(task)} onToggle={() => toggle(task)}>
            <button
              type="button"
              onClick={() => unplan(task)}
              aria-label={`Take "${task.title}" off today`}
              title="Take off today (keeps its due date)"
              className={`${ICON_BUTTON} h-7 w-7 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100`}
            >
              <XIcon className="h-3.5 w-3.5" aria-hidden />
            </button>
          </TaskLine>
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <li key={`slot-${i}`}>
            <button
              type="button"
              onClick={() => setChoosing(true)}
              className="flex min-h-9 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm text-fg-faint transition-colors duration-150 hover:bg-surface-2/70 hover:text-fg-muted"
            >
              <span className="h-[18px] w-[18px] shrink-0 rounded-full border-[1.5px] border-dashed border-line-strong" aria-hidden />
              {i === 0 && t3.items.length === 0 ? "Choose your first" : "Choose another"}
            </button>
          </li>
        ))}
      </ol>
      <div className="mt-auto flex items-center justify-between gap-2">
        {t3.more > 0 ? (
          <span className="text-xs text-fg-faint">+{t3.more} more planned for today</span>
        ) : (
          <span />
        )}
        {empty === 0 && (
          <button type="button" onClick={() => setChoosing(true)} className={BUTTON_GHOST_SM}>
            <ArrowsClockwiseIcon className="h-3.5 w-3.5" aria-hidden /> Change
          </button>
        )}
      </div>
    </div>
  );
}

/** Pick from your open tasks, most important first. Choosing only plans
 * the task for today; its due date never changes. */
function ChooseForToday({ today, open, onDone }: { today: string; open: number; onDone: () => void }) {
  const ranked = useLive(() => api.rankedTasks(40).then((r) => r.tasks), []);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const candidates = todaysThreeCandidates(ranked.data ?? [], today, filter).slice(0, 12);

  async function choose(task: Task) {
    setBusy(task.id);
    try {
      await api.planForToday(task.id);
      notifyTasksChanged();
      if (open <= 1) onDone();
    } catch (err) {
      toastError(err, "Couldn't plan it for today");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onDone()}
          placeholder="Find a task"
          aria-label="Find a task to do today"
          autoFocus
          className={`${FIELD} min-w-0 flex-1 py-1.5`}
        />
        <button type="button" onClick={onDone} className={`${BUTTON_PRIMARY} px-3 py-1.5`}>
          Done
        </button>
      </div>
      {open <= 0 && <p className="text-xs text-fg-muted">You have three. Take one off to swap, or add more anyway.</p>}
      {ranked.error && !ranked.data ? (
        <WidgetError message={ranked.error} onRetry={ranked.retry} />
      ) : !ranked.data ? (
        <WidgetLoading rows={3} />
      ) : candidates.length === 0 ? (
        <p className="py-4 text-center text-sm text-fg-faint">{filter ? "No match." : "No open tasks to choose from."}</p>
      ) : (
        <ul className="-mx-2">
          {candidates.map((task) => (
            <li key={task.id}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => choose(task)}
                className="flex min-h-9 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm text-fg transition-colors duration-150 hover:bg-surface-2/70 disabled:opacity-60"
              >
                <PlusIcon className="h-4 w-4 shrink-0 text-fg-faint" aria-hidden />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{task.title}</span>
                {task.due_date && <span className="shrink-0 font-mono text-[11px] text-fg-faint">due {task.due_date.slice(5)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- While AI runs -------------------------------------------------------------------

export function AiWaitQueueWidget() {
  const today = useToday();
  const queue = useLive(() => api.getAiWait(), [today]);
  const { isDone, toggle } = useTaskToggle();
  const [adding, setAdding] = useState(false);
  useWidgetCount(queue.data?.total);
  if (queue.error && !queue.data) return <WidgetError message={queue.error} onRetry={queue.retry} />;
  if (!queue.data) return <WidgetLoading rows={2} />;

  async function add(text: string) {
    const { title, minutes } = parseQuickDuration(text);
    await api.createTask({ title, status: "todo", tags: [AI_WAIT_TAG], estimated_duration: minutes });
    notifyTasksChanged();
  }

  const items = queue.data.items;
  return (
    <div className="flex h-full flex-col gap-2">
      {items.length === 0 ? (
        <p className="text-xs text-fg-muted">Agent running? Line up small, useful things to do instead of scrolling.</p>
      ) : (
        <ul className="-mx-2">
          {items.map((task) => (
            <TaskLine key={task.id} task={task} done={isDone(task)} onToggle={() => toggle(task)}>
              {task.estimated_duration ? (
                <span className="shrink-0 font-mono text-[11px] text-fg-faint">{formatMinutes(task.estimated_duration)}</span>
              ) : null}
            </TaskLine>
          ))}
        </ul>
      )}
      {adding || items.length === 0 ? (
        <InlineAdd
          placeholder="Read one systems article 15m"
          label="Add a task for while AI runs"
          onAdd={add}
          autoFocus={adding}
          onClose={() => setAdding(false)}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={`${BUTTON_GHOST_SM} -ml-2 self-start`}>
          <PlusIcon className="h-3.5 w-3.5" aria-hidden /> Add one
        </button>
      )}
    </div>
  );
}

// ---- Break the default ----------------------------------------------------------------

export function BreakDefaultWidget() {
  const today = useToday();
  const ch = useLive(() => api.getChallenge(), [today]);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<DailyChallenge | null>(null);
  if (ch.error && !ch.data) return <WidgetError message={ch.error} onRetry={ch.retry} />;
  if (!ch.data) return <WidgetLoading rows={1} />;
  // Task changes don't reload the challenge, so a button's answer is the
  // latest state for the day.
  const c = shown?.date === ch.data.date ? shown : ch.data;

  async function run(action: () => Promise<DailyChallenge>) {
    setBusy(true);
    try {
      setShown(await action());
    } catch (err) {
      toastError(err, "Couldn't update the challenge");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <p key={c.key} className={`anim-fade-up text-sm leading-5 ${c.done ? "text-fg-muted" : "text-fg"}`}>
        {c.text}
      </p>
      {c.done ? (
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-text">
            <CheckIcon weight="bold" className="anim-check h-4 w-4" aria-hidden /> Done. Nice.
          </span>
          <button type="button" disabled={busy} onClick={() => run(() => api.setChallengeDone(false))} className={BUTTON_GHOST_SM}>
            Undo
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => run(() => api.setChallengeDone(true))} className={`${BUTTON_PRIMARY} px-3 py-1.5`}>
            Done
          </button>
          <button type="button" disabled={busy} onClick={() => run(() => api.anotherChallenge())} className={`${BUTTON_SECONDARY} px-3 py-1.5`}>
            Give me another
          </button>
        </div>
      )}
    </div>
  );
}

