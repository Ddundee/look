"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Announcements,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowCounterClockwiseIcon, CheckIcon, PencilSimpleIcon, PlusIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { formatDateLong, todayIso } from "@/lib/format";
import { toast, toastError } from "@/lib/toast";
import type { LookView, Occurrence, ViewWidget } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { BUTTON_GHOST_SM, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/lib/ui";
import {
  addableTypes,
  addWidget,
  moveById,
  moveWidget,
  normalizeLayout,
  removeWidget,
  sameLayout,
  updateWidget,
  widgetClasses,
  type Widget,
} from "@/lib/views/layout";
import { WIDGET_DEFS, isWidgetType, type ConfigField, type WidgetType } from "@/lib/views/widgets";
import { putView, refreshViews, useViews } from "@/lib/viewsStore";
import Dialog from "@/components/Dialog";
import { EmptyState, ErrorState, Page, PageHeader, TaskListSkeleton } from "@/components/PageParts";
import EventEditor, { type EditorTarget } from "@/components/events/EventEditor";
import { WIDGET_VIEWS } from "./registry";
import WidgetShell, { type EditControls } from "./WidgetShell";
import { ViewContext } from "./widgets";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

function SortableWidget({
  widget,
  editing,
  reducedMotion,
  controls,
}: {
  widget: Widget;
  editing: boolean;
  reducedMotion: boolean;
  controls: Omit<EditControls, "handleProps">;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id, disabled: !editing });
  const type = widget.type as WidgetType;
  const def = WIDGET_DEFS[type];
  const view = WIDGET_VIEWS[type];
  const Body = view.component;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition: reducedMotion ? undefined : transition }}
      className={`${widgetClasses(widget)} min-w-0 ${isDragging ? "relative z-10 opacity-80" : ""}`}
    >
      <WidgetShell
        def={def}
        icon={view.icon}
        link={view.link}
        widget={widget}
        edit={editing ? { ...controls, handleProps: { ...attributes, ...listeners } } : undefined}
      >
        <Body config={widget.config} />
      </WidgetShell>
    </div>
  );
}

function AddWidgetDialog({ widgets, onAdd, onClose }: { widgets: Widget[]; onAdd: (t: WidgetType) => void; onClose: () => void }) {
  const hidden = new Set(widgets.filter((w) => !w.visible).map((w) => w.type));
  const types = [...new Set([...addableTypes(widgets), ...[...hidden].filter(isWidgetType)])];
  return (
    <Dialog title="Add widget" size="sm" hint={false} onClose={onClose} onSubmit={(e) => e.preventDefault()} footer={<button type="button" onClick={onClose} className={BUTTON_SECONDARY}>Close</button>}>
      {types.length === 0 ? (
        <p className="text-sm text-fg-muted">Every widget is already on this view.</p>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {types.map((t) => {
            const WidgetIcon = WIDGET_VIEWS[t].icon;
            return (
              <li key={t}>
                <button
                  type="button"
                  onClick={() => onAdd(t)}
                  className="flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface-2/70"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <WidgetIcon weight="bold" className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-fg">
                      {WIDGET_DEFS[t].title}
                      {hidden.has(t) && <span className="ml-1.5 text-xs font-normal text-fg-faint">hidden, show again</span>}
                    </span>
                    <span className="block text-xs text-fg-muted">{WIDGET_DEFS[t].description}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}

function ConfigDialog({
  widget,
  onSave,
  onClose,
}: {
  widget: Widget;
  onSave: (config: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const def = WIDGET_DEFS[widget.type as WidgetType];
  const [config, setConfig] = useState(widget.config);
  const field = (f: ConfigField) =>
    f.kind === "bool" ? (
      <label key={f.key} className="flex items-center justify-between gap-3 text-sm text-fg">
        {f.label}
        <input
          type="checkbox"
          checked={Boolean(config[f.key])}
          onChange={(e) => setConfig({ ...config, [f.key]: e.target.checked })}
          className="h-4 w-4 accent-[var(--accent)]"
        />
      </label>
    ) : (
      <label key={f.key} className="flex items-center justify-between gap-3 text-sm text-fg">
        {f.label}
        <select
          value={String(config[f.key])}
          onChange={(e) => setConfig({ ...config, [f.key]: Number(e.target.value) })}
          className="h-8 rounded-md border border-line bg-surface px-2 text-sm"
        >
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <Dialog
      title={`${def.title} settings`}
      size="sm"
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(config);
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
            Cancel
          </button>
          <button type="submit" className={BUTTON_PRIMARY}>
            Apply
          </button>
        </>
      }
    >
      <div className="space-y-3">{def.config.map(field)}</div>
    </Dialog>
  );
}

/** A view (Dashboard, Today, or a custom one): its widgets on a grid, and
 * a Customize mode to arrange them. The server keeps the layout. */
export default function ViewPage({ viewKey }: { viewKey: string }) {
  const { views, loaded, error } = useViews();
  const view: LookView | undefined = views.find((v) => v.key === viewKey);
  const stored = useMemo(() => normalizeLayout((view?.widgets ?? []) as Widget[]), [view]);
  const [draft, setDraft] = useState<Widget[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [configuring, setConfiguring] = useState<Widget | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const now = useNow();
  const editing = draft !== null;
  const widgets = draft ?? stored;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!confirmReset) return;
    const id = setTimeout(() => setConfirmReset(false), 3000);
    return () => clearTimeout(id);
  }, [confirmReset]);

  const titleOf = (id: unknown) => {
    const w = widgets.find((x) => x.id === id);
    return w ? WIDGET_DEFS[w.type as WidgetType]?.title ?? "widget" : "widget";
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${titleOf(active.id)} is over ${titleOf(over.id)}.` : `${titleOf(active.id)} is no longer over a widget.`,
    onDragEnd: ({ active, over }) =>
      over ? `Dropped ${titleOf(active.id)} where ${titleOf(over.id)} was.` : `Dropped ${titleOf(active.id)}.`,
    onDragCancel: ({ active }) => `Moving ${titleOf(active.id)} was cancelled.`,
  };

  if (!loaded) {
    return (
      <Page>
        <PageHeader title=" " />
        <TaskListSkeleton />
      </Page>
    );
  }
  if (!view) {
    return (
      <Page>
        <PageHeader title="View not found" />
        {error ? (
          <ErrorState message={error} onRetry={() => void refreshViews()} />
        ) : (
          <EmptyState icon={SquaresFourIcon} title="This view doesn't exist" action={<Link href="/settings/views" className={BUTTON_SECONDARY}>Manage views</Link>}>
            It may have been deleted or renamed.
          </EmptyState>
        )}
      </Page>
    );
  }

  const isSystem = view.kind === "system";
  const day = now ? now.slice(0, 10) : todayIso();
  const title = isSystem && view.key === "today" ? greeting() : view.name;
  const subtitle = isSystem ? formatDateLong(day) : undefined;
  const shown = editing ? widgets : widgets.filter((w) => w.visible);

  function onDragEnd(event: DragEndEvent) {
    if (event.over && event.active.id !== event.over.id) {
      setDraft((d) => moveById(d ?? stored, String(event.active.id), String(event.over!.id)));
    }
  }

  async function save() {
    if (!draft || !view) return;
    if (sameLayout(draft, stored)) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      putView(await api.saveViewLayout(view.key, draft as ViewWidget[]));
      setDraft(null);
      toast("Layout saved");
    } catch (err) {
      toastError(err, "Couldn't save the layout");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!view) return;
    if (!confirmReset) return setConfirmReset(true);
    setSaving(true);
    try {
      putView(await api.resetView(view.key));
      setDraft(null);
      setConfirmReset(false);
      toast(`${view.name} is back to the default layout`, "info");
    } catch (err) {
      toastError(err, "Couldn't reset the layout");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ViewContext.Provider value={{ openEvent: (occ: Occurrence) => setEditor({ kind: "occurrence", occ }) }}>
      <Page>
        <PageHeader
          title={title}
          subtitle={editing ? "Drag widgets by their handle, or use the arrows. Changes save when you press Done." : subtitle}
          actions={
            editing ? (
              <>
                <button type="button" onClick={() => setAdding(true)} className={BUTTON_SECONDARY}>
                  <PlusIcon weight="bold" className="h-4 w-4" aria-hidden />
                  Add widget
                </button>
                {isSystem && view.customized && (
                  <button type="button" onClick={reset} disabled={saving} className={confirmReset ? "inline-flex h-9 items-center gap-1.5 rounded-lg bg-danger px-3 text-sm font-medium text-surface" : BUTTON_GHOST_SM}>
                    <ArrowCounterClockwiseIcon className="h-4 w-4" aria-hidden />
                    {confirmReset ? "Reset to default?" : "Reset layout"}
                  </button>
                )}
                <button type="button" onClick={() => setDraft(null)} disabled={saving} className={BUTTON_SECONDARY}>
                  Cancel
                </button>
                <button type="button" onClick={save} disabled={saving} className={BUTTON_PRIMARY}>
                  <CheckIcon weight="bold" className="h-4 w-4" aria-hidden />
                  Done
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setDraft(stored)} className={BUTTON_SECONDARY} aria-label={`Customize ${view.name}`}>
                <PencilSimpleIcon className="h-4 w-4" aria-hidden />
                Customize
              </button>
            )
          }
        />

        {shown.length === 0 ? (
          <EmptyState
            icon={SquaresFourIcon}
            title={editing ? "No widgets yet" : "This view is empty"}
            action={
              editing ? (
                <button type="button" onClick={() => setAdding(true)} className={BUTTON_PRIMARY}>
                  <PlusIcon weight="bold" className="h-4 w-4" aria-hidden />
                  Add widget
                </button>
              ) : (
                <button type="button" onClick={() => setDraft(stored)} className={BUTTON_PRIMARY}>
                  Customize
                </button>
              )
            }
          >
            Add widgets like Things to do or Schedule.
          </EmptyState>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            accessibility={{
              announcements,
              screenReaderInstructions: {
                draggable: "To move a widget, press space or enter to pick it up, use the arrow keys to move it, and press space or enter again to drop it. Press escape to cancel.",
              },
            }}
          >
            <SortableContext items={shown.map((w) => w.id)} strategy={rectSortingStrategy}>
              <div className="view-grid grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12 lg:[grid-auto-flow:row_dense]">
                {shown.map((w, i) => (
                  <SortableWidget
                    key={w.id}
                    widget={w}
                    editing={editing}
                    reducedMotion={reducedMotion}
                    controls={{
                      index: i,
                      count: shown.length,
                      canRemove: !isSystem,
                      onMove: (to) => setDraft((d) => moveWidget(d ?? stored, i, to)),
                      onChange: (patch) => setDraft((d) => updateWidget(d ?? stored, w.id, patch)),
                      onRemove: () => setDraft((d) => removeWidget(d ?? stored, w.id)),
                      onConfigure: WIDGET_DEFS[w.type as WidgetType].config.length ? () => setConfiguring(w) : undefined,
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {adding && (
          <AddWidgetDialog
            widgets={widgets}
            onClose={() => setAdding(false)}
            onAdd={(t) => {
              setDraft((d) => addWidget(d ?? stored, t));
              setAdding(false);
            }}
          />
        )}
        {configuring && (
          <ConfigDialog
            widget={configuring}
            onClose={() => setConfiguring(null)}
            onSave={(config) => {
              setDraft((d) => updateWidget(d ?? stored, configuring.id, { config }));
              setConfiguring(null);
            }}
          />
        )}
        {editor && <EventEditor target={editor} onClose={() => setEditor(null)} />}
      </Page>
    </ViewContext.Provider>
  );
}
