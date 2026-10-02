"use client";

import { useState } from "react";
import { ArchiveIcon, ArrowCounterClockwiseIcon, PencilSimpleIcon, PlusIcon, TagIcon, TrashIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { refreshCatalog, useCatalog } from "@/lib/catalog";
import { lookFor, type ColorKey, type StyleKey } from "@/lib/palette";
import { toast, toastError } from "@/lib/toast";
import type { Category } from "@/lib/types";
import { BUTTON_GHOST_SM, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, FIELD, LABEL, MUTED, SECTION_HEADING } from "@/lib/ui";
import { ItemEdge } from "../look/Look";
import LookPicker from "./LookPicker";

function CategoryForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: { name: string; color: string; style: string };
  submitLabel: string;
  onSubmit: (v: { name: string; color: ColorKey; style: StyleKey }) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [look, setLook] = useState({ color: initial.color as ColorKey, style: initial.style as StyleKey });
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
      className="space-y-3"
    >
      <label className={`block ${LABEL}`}>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} placeholder="Research" className={`mt-1.5 h-10 w-full ${FIELD}`} />
      </label>
      <LookPicker color={look.color} style={look.style} onChange={setLook} previewLabel={name.trim() || "Research"} />
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !name.trim()} className={BUTTON_PRIMARY}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={BUTTON_SECONDARY}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function CategoryRow({ category }: { category: Category }) {
  const [editing, setEditing] = useState(false);
  const look = lookFor({ category: category.key }, [category]);

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      toast(done, "info");
      await refreshCatalog();
    } catch (err) {
      toastError(err, "Couldn't change the category");
    }
  }

  if (editing) {
    return (
      <div className="px-5 py-4">
        <CategoryForm
          initial={category}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            await run(() => api.updateCategory(category.id, v), `Saved ${v.name}`);
            setEditing(false);
          }}
        />
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-3 px-5 py-2.5 ${category.archived ? "opacity-60" : ""}`}>
      <span className="flex min-w-0 flex-1 items-stretch gap-2.5">
        <ItemEdge look={look} />
        <span className="min-w-0">
          <span className="block truncate text-sm text-fg">{category.name}</span>
          <span className="block text-xs text-fg-faint">
            {look.style}
            {category.is_system ? " · built in" : ""}
            {category.archived ? " · archived" : ""}
          </span>
        </span>
      </span>
      <button type="button" onClick={() => setEditing(true)} className={BUTTON_GHOST_SM} aria-label={`Edit ${category.name}`}>
        <PencilSimpleIcon className="h-3.5 w-3.5" aria-hidden />
        Edit
      </button>
      <button
        type="button"
        onClick={() =>
          run(() => api.updateCategory(category.id, { archived: !category.archived }), category.archived ? `Restored ${category.name}` : `Archived ${category.name}`)
        }
        className={BUTTON_GHOST_SM}
        aria-label={category.archived ? `Restore ${category.name}` : `Archive ${category.name}`}
        title={category.archived ? "Restore" : "Archive (existing items keep it; it's no longer offered)"}
      >
        {category.archived ? <ArrowCounterClockwiseIcon className="h-3.5 w-3.5" aria-hidden /> : <ArchiveIcon className="h-3.5 w-3.5" aria-hidden />}
      </button>
      {!category.is_system && (
        <button
          type="button"
          onClick={() => run(() => api.deleteCategory(category.id), `Deleted ${category.name}`)}
          className={`${BUTTON_GHOST_SM} hover:text-danger`}
          aria-label={`Delete ${category.name}`}
          title="Delete (only if nothing uses it)"
        >
          <TrashIcon className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Settings → Categories: name, color and style for each category. */
export default function CategoriesSection() {
  const { categories, loaded } = useCatalog();
  const [adding, setAdding] = useState(false);
  const sorted = [...categories].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));

  return (
    <section id="categories" className="scroll-mt-6 space-y-3">
      <h2 className={SECTION_HEADING}>
        <TagIcon weight="bold" className="h-4 w-4 text-accent" aria-hidden />
        Categories
      </h2>
      <div className={`divide-y divide-line ${CARD}`}>
        <p className={`px-5 py-4 text-sm ${MUTED}`}>
          What kind of thing a task or event is. Each gets a color and a style that show up in your lists and calendar.
          Typing a new category on a task or event creates it.
        </p>
        {!loaded ? (
          <p className="px-5 py-4 text-sm text-fg-faint">Loading</p>
        ) : (
          sorted.map((c) => <CategoryRow key={c.id} category={c} />)
        )}
        <div className="px-5 py-4">
          {adding ? (
            <CategoryForm
              initial={{ name: "", color: "teal", style: "solid" }}
              submitLabel="Add category"
              onCancel={() => setAdding(false)}
              onSubmit={async (v) => {
                try {
                  await api.createCategory(v);
                  toast(`Added ${v.name}`);
                  await refreshCatalog();
                  setAdding(false);
                } catch (err) {
                  toastError(err, "Couldn't add the category");
                }
              }}
            />
          ) : (
            <button type="button" onClick={() => setAdding(true)} className={BUTTON_SECONDARY}>
              <PlusIcon weight="bold" className="h-4 w-4" aria-hidden />
              New category
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
