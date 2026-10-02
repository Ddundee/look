"use client";

import type { Icon } from "@phosphor-icons/react";
import type { Task } from "@/lib/types";
import { CARD_LIST, SECTION_HEADING } from "@/lib/ui";
import TaskRow from "./TaskRow";

/** Top of a page: title, optional one-line subtitle, actions on the right.
 * Compact so the content below gets the height. Spacing comes from the
 * parent (Page's gap, or Settings' section spacing). */
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
    <div className="flex shrink-0 flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-fg [text-wrap:balance]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** An app page: on desktop (lg+) it fills the shell's height and its
 * panels scroll on their own, so the page itself doesn't. Below lg it
 * flows and the page scrolls normally (no nested scrolling on phones).
 * The min height keeps panels usable in very short windows, where the
 * page scrolls instead of squeezing them. */
export function Page({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex flex-1 flex-col gap-4 lg:min-h-[32rem] ${className}`}>{children}</div>;
}

/** A card whose body scrolls inside it on desktop. Give it its height
 * from the layout (a grid/flex track), not a fixed pixel value. */
export function Panel({
  title,
  icon: PanelIcon,
  iconClassName = "text-accent",
  count,
  actions,
  className = "",
  bodyClassName = "p-1",
  labelledBy,
  children,
}: {
  title?: React.ReactNode;
  icon?: Icon;
  iconClassName?: string;
  count?: number;
  actions?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  labelledBy?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      aria-label={labelledBy || typeof title !== "string" ? undefined : title}
      className={`flex min-w-0 flex-col rounded-xl bg-surface elev-1 lg:min-h-0 ${className}`}
    >
      {(title || actions) && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          {title && (
            <h2 id={labelledBy} className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-fg-muted">
              {PanelIcon && <PanelIcon weight="bold" className={`h-4 w-4 shrink-0 ${iconClassName}`} aria-hidden />}
              {title}
              {count !== undefined && (
                <span className="font-mono text-xs font-normal tabular-nums text-fg-faint">{count}</span>
              )}
            </h2>
          )}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={`scroll-area lg:min-h-0 lg:flex-1 lg:overflow-y-auto ${bodyClassName}`}>{children}</div>
    </section>
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
  bare = false,
}: {
  title: string;
  icon?: Icon;
  iconClassName?: string;
  tasks: Task[];
  onUpdated: (t: Task) => void;
  onDeleted: (id: string) => void;
  tone?: "default" | "danger";
  /** Inside a Panel: no card of its own, a compact heading. */
  bare?: boolean;
}) {
  if (tasks.length === 0) return null;
  if (bare) {
    return (
      <section className="anim-fade-up">
        <h3 className={`flex items-center gap-2 px-3 pb-1 pt-2.5 text-xs font-medium ${tone === "danger" ? "text-danger" : "text-fg-muted"}`}>
          {SectionIcon && <SectionIcon weight="bold" className={`h-3.5 w-3.5 ${iconClassName}`} aria-hidden />}
          {title}
          <span className="font-mono font-normal tabular-nums text-fg-faint">{tasks.length}</span>
        </h3>
        <TaskList tasks={tasks} onUpdated={onUpdated} onDeleted={onDeleted} className="" />
      </section>
    );
  }
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
  variant = "page",
}: {
  icon: Icon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  /** "panel": fills and centers inside a Panel instead of a dashed box. */
  variant?: "page" | "panel";
}) {
  return (
    <div
      className={`anim-fade-up flex flex-col items-center px-6 text-center ${
        variant === "panel"
          ? "h-full min-h-48 justify-center py-8"
          : "rounded-2xl border border-dashed border-line-strong py-14"
      }`}
    >
      <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <EmptyIcon weight="duotone" className="h-6 w-6" aria-hidden />
      </span>
      <p className="text-[15px] font-medium text-fg">{title}</p>
      {children && <p className="mt-1 max-w-[42ch] text-sm leading-relaxed text-fg-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function TaskListSkeleton({ rows = 4, className = CARD_LIST }: { rows?: number; className?: string }) {
  return (
    <div className={className} aria-busy="true" aria-label="Loading tasks">
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
