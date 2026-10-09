"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  DotsSixVerticalIcon,
  PlusIcon,
  SquaresFourIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { toast, toastError } from "@/lib/toast";
import type { LookView } from "@/lib/types";
import { BUTTON_GHOST_SM, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, FIELD, ICON_BUTTON, LABEL } from "@/lib/ui";
import { moveItem } from "@/lib/views/layout";
import { dropView, putView, setViews, useViews } from "@/lib/viewsStore";
import IconPicker from "../views/IconPicker";
import { ViewIconGlyph } from "../views/icons";
import SectionHeader from "./SectionHeader";

const PRESETS = [
  { key: "blank", title: "Blank", description: "Start empty and add widgets." },
  { key: "planning", title: "Planning", description: "Things to do beside today's schedule." },
  { key: "school", title: "School", description: "Upcoming assignments, things to do and schedule." },
  { key: "overview", title: "Overview", description: "The same widgets as the Dashboard." },
];

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative h-5 w-8 shrink-0 rounded-full transition-colors duration-150 ${checked ? "bg-accent" : "bg-line-strong"}`}
    >
      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-surface shadow-sm transition-transform duration-150 ${checked ? "translate-x-3" : ""}`} />
    </button>
  );
}

function SystemViewRow({ view }: { view: LookView }) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const id = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(id);
  }, [confirm]);
  async function reset() {
    if (!confirm) return setConfirm(true);
    try {
      putView(await api.resetView(view.key));
      toast(`${view.name} is back to the default layout`, "info");
    } catch (err) {
      toastError(err, "Couldn't reset it");
    }
    setConfirm(false);
  }
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <ViewIconGlyph name={view.icon} className="h-4 w-4 shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1 text-sm text-fg">{view.name}</span>
      <span className="text-xs text-fg-muted">{view.customized ? "Customized" : "Default layout"}</span>
      <Link href={view.key === "dashboard" ? "/dashboard" : "/today"} className={BUTTON_GHOST_SM}>
        Open
      </Link>
      {view.customized && (
        <button
          type="button"
          onClick={reset}
          className={confirm ? "inline-flex h-7 items-center gap-1 rounded-md bg-danger px-2 text-xs font-medium text-surface" : BUTTON_GHOST_SM}
        >
          <ArrowCounterClockwiseIcon className="h-3.5 w-3.5" aria-hidden />
          {confirm ? "Reset?" : "Reset"}
        </button>
      )}
    </li>
  );
}

function CustomViewRow({
  view,
  index,
  count,
  onMove,
}: {
  view: LookView;
  index: number;
  count: number;
  onMove: (to: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: view.key });
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(view.name);
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!confirmDelete) return;
    const id = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(id);
  }, [confirmDelete]);
  async function update(payload: { name?: string; icon?: string; show_in_nav?: boolean }) {
    try {
      putView(await api.updateView(view.key, payload));
    } catch (err) {
      toastError(err, "Couldn't change the view");
    }
  }
  async function remove() {
    if (!confirmDelete) return setConfirmDelete(true);
    try {
      await api.deleteView(view.key);
      dropView(view.key);
      toast(`Deleted ${view.name}. Your tasks and events weren't touched.`, "info");
    } catch (err) {
      toastError(err, "Couldn't delete the view");
    }
  }

  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className="bg-surface px-3 py-2.5">
      <div className="flex items-center gap-2">
        <button type="button" {...attributes} {...listeners} aria-label={`Reorder ${view.name}`} className={`${ICON_BUTTON} cursor-grab touch-none`}>
          <DotsSixVerticalIcon weight="bold" className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" onClick={() => setPicking((p) => !p)} aria-label={`Change icon of ${view.name}`} aria-expanded={picking} className={ICON_BUTTON}>
          <ViewIconGlyph name={view.icon} className="h-4 w-4" />
        </button>
        {renaming ? (
          <form
            className="flex min-w-0 flex-1 gap-1.5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (name.trim()) await update({ name: name.trim() });
              setRenaming(false);
            }}
          >
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="View name" className={`h-8 min-w-0 flex-1 ${FIELD}`} />
            <button type="submit" className={BUTTON_GHOST_SM}>
              Save
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setRenaming(true)} className="min-w-0 flex-1 truncate text-left text-sm text-fg hover:underline hover:underline-offset-4" title="Rename">
            {view.name}
          </button>
        )}
        <span className="hidden text-xs text-fg-muted sm:inline">{view.show_in_nav ? "In sidebar" : "Hidden"}</span>
        <Switch checked={view.show_in_nav} label={`Show ${view.name} in the sidebar`} onChange={() => update({ show_in_nav: !view.show_in_nav })} />
        <button type="button" onClick={() => onMove(index - 1)} disabled={index === 0} aria-label={`Move ${view.name} up`} className={`${ICON_BUTTON} hidden sm:inline-flex`}>
          <ArrowUpIcon className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button type="button" onClick={() => onMove(index + 1)} disabled={index === count - 1} aria-label={`Move ${view.name} down`} className={`${ICON_BUTTON} hidden sm:inline-flex`}>
          <ArrowDownIcon className="h-3.5 w-3.5" aria-hidden />
        </button>
        <Link href={`/views/${view.key}`} className={BUTTON_GHOST_SM}>
          Open
        </Link>
        <button
          type="button"
          onClick={remove}
          aria-label={confirmDelete ? `Confirm delete ${view.name}` : `Delete ${view.name}`}
          className={confirmDelete ? "inline-flex h-7 items-center gap-1 rounded-md bg-danger px-2 text-xs font-medium text-surface" : `${ICON_BUTTON} hover:text-danger`}
        >
          <TrashIcon className="h-3.5 w-3.5" aria-hidden />
          {confirmDelete && "Delete?"}
        </button>
      </div>
      {picking && (
        <div className="mt-2 pl-10">
          <IconPicker
            value={view.icon}
            onChange={(icon) => {
              setPicking(false);
              void update({ icon });
            }}
          />
        </div>
      )}
    </li>
  );
}

function NewViewForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("graduation-cap");
  const [preset, setPreset] = useState("blank");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4 rounded-xl bg-surface-2/40 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        try {
          const view = await api.createView({ name: name.trim(), icon, preset });
          putView(view);
          onDone();
          router.push(`/views/${view.key}`);
        } catch (err) {
          toastError(err, "Couldn't create the view");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className={`block ${LABEL}`}>
        Name
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="School" className={`mt-1.5 h-10 w-full ${FIELD}`} />
      </label>
      <div>
        <span className={LABEL}>Icon</span>
        <div className="mt-1.5">
          <IconPicker value={icon} onChange={setIcon} />
        </div>
      </div>
      <fieldset>
        <legend className={LABEL}>Start with</legend>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
          {PRESETS.map((p) => (
            <label
              key={p.key}
              className={`flex cursor-pointer gap-2.5 rounded-lg border px-3 py-2 ${preset === p.key ? "border-accent bg-accent-soft/50" : "border-line hover:border-line-strong"}`}
            >
              <input type="radio" name="preset" value={p.key} checked={preset === p.key} onChange={() => setPreset(p.key)} className="mt-0.5 accent-[var(--accent)]" />
              <span>
                <span className="block text-sm font-medium text-fg">{p.title}</span>
                <span className="block text-xs text-fg-muted">{p.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !name.trim()} className={BUTTON_PRIMARY}>
          Create view
        </button>
        <button type="button" onClick={onDone} className={BUTTON_SECONDARY}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Settings → Views & dashboards: the built-in views (reset) and your own
 * (order, name, icon, sidebar visibility, delete). Layouts are edited on
 * each view with Customize. */
export default function ViewsSettings() {
  const { views, loaded } = useViews();
  const [creating, setCreating] = useState(false);
  const system = views.filter((v) => v.kind === "system");
  const custom = views.filter((v) => v.kind === "custom" && !v.archived);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function reorder(keys: string[]) {
    const previous = views;
    // Optimistic: show the new order now; the server decides.
    setViews([...system, ...keys.map((k) => custom.find((v) => v.key === k)!), ...views.filter((v) => v.kind === "custom" && v.archived)]);
    try {
      setViews((await api.reorderViews(keys)).views);
    } catch (err) {
      setViews(previous);
      toastError(err, "Couldn't reorder views");
    }
  }
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const keys = custom.map((v) => v.key);
    void reorder(moveItem(keys, keys.indexOf(String(e.active.id)), keys.indexOf(String(e.over.id))));
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={SquaresFourIcon}
        title="Views & dashboards"
        summary="Arrange widgets on any view with Customize. Your layouts are saved to Look, so they follow you to every device."
        actions={
          !creating && (
            <button type="button" onClick={() => setCreating(true)} className={BUTTON_PRIMARY}>
              <PlusIcon weight="bold" className="h-4 w-4" aria-hidden />
              New view
            </button>
          )
        }
      />
      {creating && <NewViewForm onDone={() => setCreating(false)} />}

      <section aria-label="Built-in views" className="space-y-2">
        <h3 className="px-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint">Built in</h3>
        <ul className={`divide-y divide-line ${CARD}`}>{system.map((v) => <SystemViewRow key={v.key} view={v} />)}</ul>
      </section>

      <section aria-label="Your views" className="space-y-2">
        <h3 className="px-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint">Your views</h3>
        {!loaded ? (
          <p className="px-1 text-sm text-fg-faint">Loading</p>
        ) : custom.length === 0 ? (
          <p className={`px-4 py-4 text-sm text-fg-muted ${CARD}`}>
            None yet. Make one for school, recruiting or a project and pick the widgets it shows.
          </p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={custom.map((v) => v.key)} strategy={verticalListSortingStrategy}>
              <ul className={`divide-y divide-line overflow-hidden ${CARD}`}>
                {custom.map((v, i) => (
                  <CustomViewRow
                    key={v.key}
                    view={v}
                    index={i}
                    count={custom.length}
                    onMove={(to) => void reorder(moveItem(custom.map((x) => x.key), i, to))}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </section>
    </div>
  );
}
