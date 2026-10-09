"use client";

import { useContext, useMemo } from "react";
import { PencilSimpleIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { checkProgress, parseNote, toggleCheck } from "@/lib/blocks/markdown";
import { putBlock, putBlockIf, useBlocks } from "@/lib/blocksStore";
import { formatDateLong } from "@/lib/format";
import { toastError } from "@/lib/toast";
import type { Block, NoteConfig, SmartListConfig, WorkItem } from "@/lib/types";
import { WorkRow } from "@/components/WorkList";
import { useLive, useToday, ViewContext, type WidgetProps } from "@/components/views/widgets";
import { useWidgetCount, WidgetEmpty, WidgetError, WidgetLoading } from "@/components/views/WidgetShell";
import NoteText from "./NoteText";

function SmartListBody({ block }: { block: Block }) {
  const { openEvent } = useContext(ViewContext);
  const config = block.config as SmartListConfig;
  const today = useToday();
  // Reload when the block's filters change (updated_at) or the day turns.
  const data = useLive(() => api.getBlockItems(block.id), [block.id, block.updated_at, today]);
  useWidgetCount(data.data?.total);
  if (data.error && !data.data) return <WidgetError message={data.error} onRetry={data.retry} />;
  if (!data.data) return <WidgetLoading />;
  const { items, total } = data.data;
  if (items.length === 0) return <WidgetEmpty>Nothing matches right now.</WidgetEmpty>;

  const row = (item: WorkItem, i: number) => (
    <WorkRow
      key={`${item.kind}-${item.id}-${item.due_date}`}
      item={item}
      index={i}
      onChanged={data.retry}
      onOpenAssignment={openEvent}
      overdue={!item.done && !!item.due_date && item.due_date < today}
    />
  );
  const more = total - items.length;
  let body: React.ReactNode;
  if (config.group_by_day) {
    const groups = new Map<string, WorkItem[]>();
    for (const item of items) groups.set(item.due_date ?? "", [...(groups.get(item.due_date ?? "") ?? []), item]);
    // Days in date order (no date last); the chosen sort applies within a day.
    const days = [...groups.entries()].sort(([a], [b]) => (!a ? 1 : !b ? -1 : a.localeCompare(b)));
    let n = 0;
    body = days.map(([day, group]) => (
      <section key={day || "none"}>
        <h3 className={`px-3 pb-0.5 pt-2 text-xs font-medium ${day && day < today ? "text-danger" : "text-fg-muted"}`}>
          {!day ? "No due date" : day === today ? "Today" : formatDateLong(day)}
        </h3>
        <ul>{group.map((item) => row(item, n++))}</ul>
      </section>
    ));
  } else {
    body = <ul>{items.map(row)}</ul>;
  }
  return (
    <div className="-mx-3">
      {body}
      {more > 0 && <p className="px-3 pb-1 pt-1 text-xs text-fg-faint">{more} more match (raise the limit to see them)</p>}
    </div>
  );
}

function NoteBody({ block, onEdit }: { block: Block; onEdit?: () => void }) {
  const text = (block.config as NoteConfig).text;
  const lines = useMemo(() => parseNote(text), [text]);
  const progress = checkProgress(lines);
  useWidgetCount(progress.total ? progress.done : null);
  if (!text.trim()) {
    return (
      <WidgetEmpty>
        {onEdit ? (
          <button type="button" onClick={onEdit} className="inline-flex items-center gap-1.5 font-medium text-accent-text underline-offset-4 hover:underline">
            <PencilSimpleIcon className="h-3.5 w-3.5" aria-hidden />
            Write something
          </button>
        ) : (
          "Empty note."
        )}
      </WidgetEmpty>
    );
  }
  async function toggle(line: number) {
    const next = toggleCheck(text, line);
    // Show it now; every view with this note updates from the store. The
    // reply (or a rollback) only lands if no newer tick happened meanwhile;
    // a newer one sends the full text, so it settles the note itself.
    const optimistic: Block = { ...block, config: { text: next } };
    putBlock(optimistic);
    try {
      putBlockIf(optimistic, await api.updateBlock(block.id, { config: { text: next } }));
    } catch (err) {
      putBlockIf(optimistic, block);
      toastError(err, "Couldn't update the note");
    }
  }
  return <NoteText lines={lines} onToggle={toggle} />;
}

/** The body of a block widget: the library block it points at, live. */
export default function BlockBody({ config, onEdit }: WidgetProps & { onEdit?: () => void }) {
  const { blocks, loaded, error } = useBlocks();
  const block = blocks.find((b) => b.id === config.block_id);
  if (!loaded) return <WidgetLoading />;
  if (!block) return <WidgetEmpty>{error ? "Couldn't load blocks." : "This block was deleted."}</WidgetEmpty>;
  return block.kind === "note" ? <NoteBody block={block} onEdit={onEdit} /> : <SmartListBody block={block} />;
}
