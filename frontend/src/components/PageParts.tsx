"use client";

import type { Icon } from "@phosphor-icons/react";
import type { Task } from "@/lib/types";
import { CARD_LIST, SECTION_HEADING } from "@/lib/ui";
import TaskRow from "./TaskRow";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-fg [text-wrap:balance]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function TaskList({
  tasks,
  onUpdated,
  onDeleted,
  className = CARD_LIST,
}: {
  tasks: Task[];
  onUpdated: (t: Task) => void;
  onDeleted: (id: string) => void;
  className?: string;
}) {
  return (
    <ul className={`anim-stagger ${className}`}>
      {tasks.map((t, i) => (
        <TaskRow key={t.id} index={i} task={t} onUpdated={onUpdated} onDeleted={onDeleted} />
      ))}
    </ul>
  );
}

export function TaskSection({
  title,
  icon: SectionIcon,
  iconClassName = "text-fg-faint",
  tasks,
  onUpdated,
  onDeleted,
  tone = "default",
}: {
  title: string;
  icon?: Icon;
  iconClassName?: string;
  tasks: Task[];
  onUpdated: (t: Task) => void;
  onDeleted: (id: string) => void;
  tone?: "default" | "danger";
}) {
  if (tasks.length === 0) return null;
  return (
    <section className="anim-fade-up">
      <h2 className={`${SECTION_HEADING} ${tone === "danger" ? "text-danger" : ""}`}>
        {SectionIcon && <SectionIcon weight="bold" className={`h-4 w-4 ${iconClassName}`} aria-hidden />}
        {title}
        <span className="font-mono text-xs font-normal tabular-nums text-fg-faint">{tasks.length}</span>
      </h2>
      <TaskList
        tasks={tasks}
        onUpdated={onUpdated}
        onDeleted={onDeleted}
        className={
          tone === "danger"
            ? "rounded-xl bg-surface p-1 ring-1 ring-danger/30"
            : CARD_LIST
        }
      />
    </section>
  );
}

export function EmptyState({
  icon: EmptyIcon,
  title,
  children,
  action,
}: {
  icon: Icon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="anim-fade-up flex flex-col items-center rounded-2xl border border-dashed border-line-strong px-6 py-14 text-center">
      <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <EmptyIcon weight="duotone" className="h-6 w-6" aria-hidden />
      </span>
      <p className="text-[15px] font-medium text-fg">{title}</p>
      {children && <p className="mt-1 max-w-[42ch] text-sm leading-relaxed text-fg-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function TaskListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className={CARD_LIST} aria-busy="true" aria-label="Loading tasks">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-start gap-3 px-3 py-3">
          <span className="shimmer h-[18px] w-[18px] shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <span className="shimmer block h-3.5 rounded" style={{ width: `${68 - i * 9}%` }} />
            <span className="shimmer block h-2.5 w-1/4 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
      <span>{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 rounded-md px-2 py-1 font-medium hover:bg-danger-soft">
          Retry
        </button>
      )}
    </div>
  );
}
