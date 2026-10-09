"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CubeIcon, ListChecksIcon, NoteIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { dropBlock, useBlocks } from "@/lib/blocksStore";
import { lookVars, toColor } from "@/lib/palette";
import { toast, toastError } from "@/lib/toast";
import type { Block, BlockKind } from "@/lib/types";
import { BUTTON_SECONDARY, CARD, ICON_BUTTON } from "@/lib/ui";
import { refreshViews } from "@/lib/viewsStore";
import BlockEditor from "../blocks/BlockEditor";
import { ViewIconGlyph } from "../views/icons";
import SectionHeader from "./SectionHeader";

function BlockRow({ block, onEdit }: { block: Block; onEdit: () => void }) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const id = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(id);
  }, [confirm]);
  const views = block.used_in;

  async function remove() {
    if (!confirm) return setConfirm(true);
    try {
      await api.deleteBlock(block.id);
      dropBlock(block.id);
      if (views.length) void refreshViews(); // it was taken off those views
      toast(`Deleted ${block.name}. Your tasks and events weren't touched.`, "info");
    } catch (err) {
      toastError(err, "Couldn't delete the block");
    }
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="look-fill flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" data-style="soft" style={lookVars({ color: toColor(block.color) })}>
        <ViewIconGlyph name={block.icon} className="look-ink h-4 w-4" weight="bold" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{block.name}</p>
        <p className="truncate text-xs text-fg-muted">
          {block.kind === "note" ? "Note" : "Smart list"} ·{" "}
          {views.length === 0 ? (
            "not on any view"
          ) : (
            <>
              on{" "}
              {views.map((v, i) => (
                <span key={v.key}>
                  {i > 0 && ", "}
                  <Link href={v.key === "dashboard" || v.key === "today" ? `/${v.key}` : `/views/${v.key}`} className="hover:text-fg hover:underline">
                    {v.name}
                  </Link>
                </span>
              ))}
            </>
          )}
        </p>
      </div>
      <button type="button" onClick={onEdit} aria-label={`Edit ${block.name}`} className={ICON_BUTTON}>
        <PencilSimpleIcon className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={remove}
        aria-label={confirm ? `Confirm delete ${block.name}` : `Delete ${block.name}`}
        className={confirm ? "inline-flex h-7 items-center gap-1 rounded-md bg-danger px-2 text-xs font-medium text-surface" : `${ICON_BUTTON} hover:text-danger`}
      >
        <TrashIcon className="h-3.5 w-3.5" aria-hidden />
        {confirm && (views.length ? `Delete, and remove from ${views.length} ${views.length === 1 ? "view" : "views"}?` : "Delete?")}
      </button>
    </li>
  );
}

/** Settings → Blocks: the library of smart lists and notes. Place them on
 * a view from Customize → Add widget. */
export default function BlocksSettings() {
  const { blocks, loaded } = useBlocks();
  const [editing, setEditing] = useState<{ block?: Block; kind?: BlockKind } | null>(null);
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={CubeIcon}
        title="Blocks"
        summary="Smart lists and notes you build once and place on any view. Edit one and it changes everywhere it's shown."
        actions={
          <>
            <button type="button" onClick={() => setEditing({ kind: "smart_list" })} className={BUTTON_SECONDARY}>
              <ListChecksIcon className="h-4 w-4" aria-hidden />
              New smart list
            </button>
            <button type="button" onClick={() => setEditing({ kind: "note" })} className={BUTTON_SECONDARY}>
              <NoteIcon className="h-4 w-4" aria-hidden />
              New note
            </button>
          </>
        }
      />
      {!loaded ? (
        <p className="px-1 text-sm text-fg-faint">Loading</p>
      ) : blocks.length === 0 ? (
        <div className={`space-y-1 px-4 py-4 text-sm text-fg-muted ${CARD}`}>
          <p className="font-medium text-fg">No blocks yet.</p>
          <p>
            A <strong className="font-medium text-fg">smart list</strong> shows tasks, assignments and events that match filters, like
            &quot;High-priority career tasks this week&quot; or &quot;CS 3214 assignments&quot;. A{" "}
            <strong className="font-medium text-fg">note</strong> holds text, links and checklists.
          </p>
        </div>
      ) : (
        <ul className={`divide-y divide-line ${CARD}`}>
          {blocks.map((b) => (
            <BlockRow key={b.id} block={b} onEdit={() => setEditing({ block: b })} />
          ))}
        </ul>
      )}
      <p className="px-1 text-xs text-fg-faint">To put a block on a view, open the view, press Customize, then Add widget.</p>
      {editing && <BlockEditor block={editing.block} kind={editing.kind} onClose={() => setEditing(null)} />}
    </div>
  );
}
