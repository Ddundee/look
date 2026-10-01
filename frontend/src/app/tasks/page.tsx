"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FunnelSimpleIcon, MagnifyingGlassIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { notifyTasksChanged } from "@/lib/events";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/lib/format";
import { useTaskListState } from "@/lib/useTasks";
import { isTaskDone, SEED_CATEGORIES, type TaskPriority, type TaskStatus } from "@/lib/types";
import { BUTTON_GHOST_SM, BUTTON_PRIMARY, FIELD } from "@/lib/ui";
import { EmptyState, ErrorState, PageHeader, TaskList, TaskListSkeleton } from "@/components/PageParts";
import TaskEditModal from "@/components/TaskEditModal";

const STATUSES: TaskStatus[] = ["inbox", "todo", "in_progress", "blocked", "completed", "cancelled"];
const PRIORITIES: TaskPriority[] = ["critical", "high", "medium", "low"];

const SELECT = `h-9 pr-8 ${FIELD}`;

function AllTasksView() {
  // ?status= pre-selects the status filter (the old /inbox URL redirects to
  // /tasks?status=inbox). Anything unrecognized is ignored.
  const params = useSearchParams();
  const [status, setStatus] = useState<string>(() => {
    const requested = params.get("status") ?? "";
    return (STATUSES as string[]).includes(requested) ? requested : "";
  });
  const [category, setCategory] = useState<string>("");
  const [priority, setPriority] = useState<string>("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const { tasks, handleUpdated, handleDeleted, loading, error } = useTaskListState(
    () =>
      api
        .listTasks({
          status: status || undefined,
          category: category || undefined,
          priority: priority || undefined,
          q: search || undefined,
          include_completed: true,
        })
        .then((r) => r.tasks),
    [status, category, priority, search]
  );

  // Array.sort is stable, so this only moves done tasks after not-done ones
  // without disturbing whatever order the API returned within each group.
  const sortedTasks = [...tasks].sort((a, b) => Number(isTaskDone(a)) - Number(isTaskDone(b)));
  const filtered = !!(status || category || priority || search);
  const openCount = tasks.filter((t) => !isTaskDone(t)).length;

  function clearFilters() {
    setStatus("");
    setCategory("");
    setPriority("");
    setSearch("");
  }

  return (
    <div>
      <PageHeader
        title="All Tasks"
        subtitle={
          loading ? (
            <span className="shimmer inline-block h-4 w-28 rounded align-middle" />
          ) : (
            <>
              <span className="font-mono tabular-nums">{openCount}</span> open,{" "}
              <span className="font-mono tabular-nums">{tasks.length - openCount}</span> done
              {filtered && " in this view"}
            </>
          )
        }
        actions={
          <button onClick={() => setCreating(true)} className={BUTTON_PRIMARY}>
            <PlusIcon weight="bold" className="h-4 w-4" aria-hidden />
            New task
          </button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <MagnifyingGlassIcon
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint"
            aria-hidden
          />
          <label htmlFor="task-search" className="sr-only">
            Search tasks
          </label>
          <input
            id="task-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, description, notes"
            className={`h-9 w-full pl-9 ${FIELD}`}
          />
        </div>
        <FunnelSimpleIcon className="ml-1 hidden h-4 w-4 text-fg-faint sm:block" aria-hidden />
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT}>
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className={SELECT}
        >
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={SELECT}
        >
          <option value="">Any category</option>
          {SEED_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {filtered && (
          <button onClick={clearFilters} className={`h-9 ${BUTTON_GHOST_SM}`}>
            <XIcon className="h-3.5 w-3.5" aria-hidden />
            Clear
          </button>
        )}
      </div>

      {error && <ErrorState message={error} onRetry={notifyTasksChanged} />}
      {loading ? (
        <TaskListSkeleton rows={6} />
      ) : tasks.length === 0 ? (
        !error &&
        (filtered ? (
          <EmptyState
            icon={MagnifyingGlassIcon}
            title="No matches"
            action={
              <button onClick={clearFilters} className={BUTTON_GHOST_SM}>
                Clear filters
              </button>
            }
          >
            Nothing fits these filters.
          </EmptyState>
        ) : (
          <EmptyState
            icon={PlusIcon}
            title="No tasks yet"
            action={
              <button onClick={() => setCreating(true)} className={BUTTON_PRIMARY}>
                New task
              </button>
            }
          >
            Create your first task here, or add one from the Dashboard.
          </EmptyState>
        ))
      ) : (
        <TaskList tasks={sortedTasks} onUpdated={handleUpdated} onDeleted={handleDeleted} />
      )}

      {creating && (
        <TaskEditModal task={null} onClose={() => setCreating(false)} onSaved={() => setCreating(false)} />
      )}
    </div>
  );
}

export default function AllTasksPage() {
  return (
    <Suspense fallback={<TaskListSkeleton rows={6} />}>
      <AllTasksView />
    </Suspense>
  );
}
