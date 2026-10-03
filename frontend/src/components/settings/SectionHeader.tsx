import type { Icon } from "@phosphor-icons/react";

/** The top of a settings section: what it is, in one line, and actions. */
export default function SectionHeader({
  icon: SectionIcon,
  title,
  summary,
  actions,
}: {
  icon: Icon;
  title: string;
  summary?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <SectionIcon weight="bold" className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-fg">{title}</h2>
          {summary && <p className="text-sm text-fg-muted">{summary}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
