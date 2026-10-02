"use client";

import { useState } from "react";
import { ArchiveIcon, ArrowCounterClockwiseIcon, CaretRightIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { refreshCatalog, useCatalog } from "@/lib/catalog";
import { lookFor, toColor, toStyle, type ColorKey, type StyleKey } from "@/lib/palette";
import { toast, toastError } from "@/lib/toast";
import type { Category } from "@/lib/types";
import { BUTTON_GHOST_SM, BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD, LABEL } from "@/lib/ui";
import { LookMark } from "../look/Look";
import LookPicker from "./LookPicker";

function CategoryForm({
  category,
  submitLabel,
  onSubmit,
  onCancel,
  onArchive,
  onDelete,
}: {
  category?: Category;
  submitLabel: string;
  onSubmit: (v: { name: string; color: ColorKey; style: StyleKey }) => Promise<void>;
  onCancel: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [look, setLook] = useState({ color: toColor(category?.color ?? "teal"), style: toStyle(category?.style ?? "soft") });
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        try {
          await onSubmit({ name: name.trim(), ...look });
        } finally {
          setBusy(false);
        }
      }}
      className="space-y-4 rounded-xl bg-surface-2/40 p-4"
    >
      <label className={`block ${LABEL}`}>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} placeholder="Organizations" className={`mt-1.5 h-10 w-full ${FIELD}`} />
      </label>
      <LookPicker color={look.color} style={look.style} onChange={setLook} previewLabel={name.trim() || "Organizations"} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy || !name.trim()} className={BUTTON_PRIMARY}>
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className={BUTTON_SECONDARY}>
          Cancel
        </button>
        {category && (
          <span className="ml-auto flex gap-1">
            {onArchive && (
              <button type="button" onClick={onArchive} className={BUTTON_GHOST_SM} title={category.archived ? undefined : "Items keep it; it's no longer offered"}>
                {category.archived ? <ArrowCounterClockwiseIcon className="h-3.5 w-3.5" aria-hidden /> : <ArchiveIcon className="h-3.5 w-3.5" aria-hidden />}
                {category.archived ? "Restore" : "Archive"}
              </button>
            )}
            {onDelete && (
              <button type="button" onClick={onDelete} className={`${BUTTON_GHOST_SM} hover:text-danger`}>
                <TrashIcon className="h-3.5 w-3.5" aria-hidden />
                Delete
              </button>
            )}
          </span>
        )}
      </div>
    </form>
  );
}

async function saved(action: () => Promise<unknown>, message: string): Promise<boolean> {
  try {
    await action();
    toast(message, "info");
    await refreshCatalog();
    return true;
  } catch (err) {
    toastError(err, "Couldn't change the category");
    return false;
  }
}

/** Categories, compact: shape, name, how many items use it. A row opens
 * its editor. Archived ones are listed last, dimmed. */
export default function CategoriesManager() {
  const { categories } = useCatalog();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const sorted = [...categories].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));

  return (
    <div className="space-y-1">
      {sorted.map((c) =>
        editing === c.id ? (
          <CategoryForm
            key={c.id}
            category={c}
            submitLabel="Save"
            onCancel={() => setEditing(null)}
            onArchive={async () => {
              if (await saved(() => api.updateCategory(c.id, { archived: !c.archived }), c.archived ? `Restored ${c.name}` : `Archived ${c.name}`)) setEditing(null);
            }}
            onDelete={
              !c.is_system && c.item_count === 0
                ? async () => {
                    if (await saved(() => api.deleteCategory(c.id), `Deleted ${c.name}`)) setEditing(null);
                  }
                : undefined
            }
            onSubmit={async (v) => {
              if (await saved(() => api.updateCategory(c.id, v), `Saved ${v.name}`)) setEditing(null);
            }}
          />
        ) : (
          <button
            key={c.id}
            type="button"
            onClick={() => setEditing(c.id)}
            className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2/70 ${c.archived ? "opacity-55" : ""}`}
          >
            <LookMark look={lookFor({ category: c.key }, [c])} className="h-3 w-3" />
            <span className="min-w-0 flex-1 truncate text-sm text-fg">{c.name}</span>
            {c.archived && <span className="text-xs text-fg-faint">Archived</span>}
            <span className="font-mono text-xs tabular-nums text-fg-faint">
              {c.item_count} item{c.item_count === 1 ? "" : "s"}
            </span>
            <CaretRightIcon className="h-3.5 w-3.5 text-fg-faint" aria-hidden />
          </button>
        )
      )}
      {editing === "new" ? (
        <CategoryForm
          submitLabel="Add category"
          onCancel={() => setEditing(null)}
          onSubmit={async (v) => {
            if (await saved(() => api.createCategory(v), `Added ${v.name}`)) setEditing(null);
          }}
        />
      ) : (
        <button type="button" onClick={() => setEditing("new")} className={`mt-1 ${BUTTON_GHOST_SM}`}>
          <PlusIcon weight="bold" className="h-3.5 w-3.5" aria-hidden />
          New category
        </button>
      )}
    </div>
  );
}
