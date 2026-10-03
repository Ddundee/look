"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  DotsSixVerticalIcon,
  EyeIcon,
  EyeSlashIcon,
  GearSixIcon,
  TrashIcon,
  type Icon,
} from "@phosphor-icons/react";
import { HEIGHT_LABEL, SIZE_LABEL, type WidgetDef, type WidgetHeight, type WidgetSize } from "@/lib/views/widgets";
import type { Widget } from "@/lib/views/layout";
import { ICON_BUTTON } from "@/lib/ui";

/** Lets a widget put a count next to its title ("Things to do · 5"). */
const CountContext = createContext<(n: number | null) => void>(() => {});
export function useWidgetCount(n: number | null | undefined) {
  const set = useContext(CountContext);
  useEffect(() => set(n ?? null), [n, set]);
}

/** Loading / error / empty states, the same in every widget. */
export function WidgetLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="shimmer block h-9 rounded-lg" style={{ width: `${92 - i * 12}%` }} />
      ))}
    </div>
  );
}
export function WidgetError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex h-full min-h-20 flex-col items-start justify-center gap-2 text-sm text-danger">
      <span>{message}</span>
      <button type="button" onClick={onRetry} className="font-medium underline underline-offset-4">
        Retry
      </button>
    </div>
  );
}
export function WidgetEmpty({ children }: { children: React.ReactNode }) {
  return <p className="flex h-full min-h-20 items-center justify-center text-center text-sm text-fg-faint">{children}</p>;
}

export interface EditControls {
  index: number;
  count: number;
  canRemove: boolean; // custom views remove; built-in views hide
  onMove: (to: number) => void;
  onChange: (patch: Partial<Pick<Widget, "size" | "height" | "visible">>) => void;
  onRemove: () => void;
  onConfigure?: () => void;
  /** dnd-kit's listeners/attributes, put on the handle only. */
  handleProps: Record<string, unknown>;
}

const SELECT = "h-7 rounded-md border border-line bg-surface px-1.5 text-xs text-fg focus:border-accent focus:outline-none";

/** The frame every widget renders in: header (icon, title, count, link),
 * a body that scrolls inside the widget on desktop, and in Customize mode
 * a drag handle, move buttons, size/height, settings and hide/remove. */
export default function WidgetShell({
  def,
  icon: WidgetIcon,
  link,
  widget,
  edit,
  children,
}: {
  def: WidgetDef;
  icon: Icon;
  link?: { href: string; label: string };
  widget: Widget;
  edit?: EditControls;
  children: React.ReactNode;
}) {
  const [count, setCount] = useState<number | null>(null);
  const hidden = !widget.visible;
  return (
    <section
      aria-label={def.title}
      className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl bg-surface p-4 elev-1 ${
        edit ? "ring-1 ring-line-strong" : ""
      } ${edit && hidden ? "opacity-60" : ""}`}
    >
      <div className="mb-3 flex shrink-0 items-center gap-2">
        {edit && (
          <button
            type="button"
            {...edit.handleProps}
            aria-label={`Move ${def.title}. Press space to pick up, arrows to move, space to drop.`}
            className={`${ICON_BUTTON} -ml-1.5 cursor-grab touch-none active:cursor-grabbing`}
          >
            <DotsSixVerticalIcon weight="bold" className="h-4 w-4" aria-hidden />
          </button>
        )}
        <h2 className="flex min-w-0 flex-1 items-center gap-2 text-[13px] font-medium text-fg-muted">
          <WidgetIcon weight="bold" className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span className="truncate">{def.title}</span>
          {count !== null && !edit && <span className="font-mono text-xs font-normal tabular-nums text-fg-faint">{count}</span>}
          {edit && hidden && <span className="rounded bg-surface-2 px-1.5 text-[11px] font-medium text-fg-muted">Hidden</span>}
        </h2>
        {!edit && link && (
          <Link
            href={link.href}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent-text underline-offset-4 hover:underline"
          >
            {link.label}
            <ArrowRightIcon className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </div>

      {edit && (
        <div className="mb-3 flex shrink-0 flex-wrap items-center gap-1.5" role="group" aria-label={`${def.title} options`}>
          <button
            type="button"
            onClick={() => edit.onMove(edit.index - 1)}
            disabled={edit.index === 0}
            aria-label={`Move ${def.title} earlier`}
            className={ICON_BUTTON}
          >
            <ArrowUpIcon className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => edit.onMove(edit.index + 1)}
            disabled={edit.index === edit.count - 1}
            aria-label={`Move ${def.title} later`}
            className={ICON_BUTTON}
          >
            <ArrowDownIcon className="h-3.5 w-3.5" aria-hidden />
          </button>
          {def.sizes.length > 1 && (
            <select
              aria-label={`${def.title} width`}
              value={widget.size}
              onChange={(e) => edit.onChange({ size: e.target.value as WidgetSize })}
              className={`${SELECT} hidden lg:block`}
            >
              {def.sizes.map((s) => (
                <option key={s} value={s}>
                  {SIZE_LABEL[s]}
                </option>
              ))}
            </select>
          )}
          {def.heights.length > 1 && (
            <select
              aria-label={`${def.title} height`}
              value={widget.height}
              onChange={(e) => edit.onChange({ height: e.target.value as WidgetHeight })}
              className={`${SELECT} hidden lg:block`}
            >
              {def.heights.map((h) => (
                <option key={h} value={h}>
                  {HEIGHT_LABEL[h]}
                </option>
              ))}
            </select>
          )}
          <span className="ml-auto flex gap-1">
            {edit.onConfigure && (
              <button type="button" onClick={edit.onConfigure} aria-label={`${def.title} settings`} title="Settings" className={ICON_BUTTON}>
                <GearSixIcon className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
            {edit.canRemove ? (
              <button type="button" onClick={edit.onRemove} aria-label={`Remove ${def.title}`} title="Remove from this view" className={`${ICON_BUTTON} hover:text-danger`}>
                <TrashIcon className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => edit.onChange({ visible: hidden })}
                aria-label={hidden ? `Show ${def.title}` : `Hide ${def.title}`}
                aria-pressed={hidden}
                title={hidden ? "Show" : "Hide"}
                className={ICON_BUTTON}
              >
                {hidden ? <EyeIcon className="h-3.5 w-3.5" aria-hidden /> : <EyeSlashIcon className="h-3.5 w-3.5" aria-hidden />}
              </button>
            )}
          </span>
        </div>
      )}

      {/* While customizing, the widget is a preview: not clickable, so a
          drag never turns into a checkbox toggle or a link. */}
      <div
        className={`scroll-area min-h-0 flex-1 lg:overflow-y-auto ${edit ? "pointer-events-none select-none" : ""}`}
        inert={edit ? true : undefined}
      >
        <CountContext.Provider value={setCount}>{children}</CountContext.Provider>
      </div>
    </section>
  );
}
