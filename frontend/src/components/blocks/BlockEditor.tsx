"use client";

import { useEffect, useState } from "react";
import { ListChecksIcon, NoteIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { putBlock } from "@/lib/blocksStore";
import { activeCategories, useCatalog } from "@/lib/catalog";
import { COLORS, PRIMARY_COLORS, toColor } from "@/lib/palette";
import { toastError } from "@/lib/toast";
import type { Block, BlockItems, BlockKind, DueWindow, NoteConfig, SmartListConfig, TaskPriority } from "@/lib/types";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD, LABEL } from "@/lib/ui";
import Dialog from "@/components/Dialog";
import { Swatch } from "@/components/planning/LookPicker";
import IconPicker from "@/components/views/IconPicker";

export const DEFAULT_SMART_LIST: SmartListConfig = {
  show: ["tasks", "assignments"],
  categories: [],
  courses: [],
  priorities: [],
  tags: [],
  search: "",
  due: "any",
  status: "open",
  sort: "due",
  limit: 20,
  group_by_day: false,
};

const DUE_LABEL: Record<DueWindow, string> = {
  any: "Any time",
  overdue: "Overdue",
  today: "Today",
  this_week: "This week (Mon–Sun)",
  next_7: "Next 7 days",
  next_14: "Next 14 days",
  next_30: "Next 30 days",
  no_date: "No due date",
};
const SHOW = [
  { key: "tasks", label: "Tasks" },
  { key: "assignments", label: "Assignments" },
  { key: "events", label: "Events" },
] as const;
const PRIORITIES: TaskPriority[] = ["critical", "high", "medium", "low"];
const SELECT = `h-9 ${FIELD}`;

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors ${
        selected ? "border-accent bg-accent-soft text-accent-text" : "border-line text-fg-muted hover:border-line-strong hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <span className={LABEL}>{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-xs text-fg-faint">{hint}</p>}
    </div>
  );
}

function SmartListFields({ config, onChange }: { config: SmartListConfig; onChange: (c: SmartListConfig) => void }) {
  const catalog = useCatalog();
  const categories = activeCategories(catalog);
  const courses = catalog.courses.filter((c) => !c.archived);
  const set = (patch: Partial<SmartListConfig>) => onChange({ ...config, ...patch });
  const [tags, setTags] = useState(config.tags.join(", "));
  return (
    <div className="space-y-4">
      <Field label="Show">
        <div className="flex flex-wrap gap-1.5">
          {SHOW.map((s) => (
            <Chip
              key={s.key}
              selected={config.show.includes(s.key)}
              onClick={() => {
                const next = toggle(config.show, s.key);
                if (next.length) set({ show: next });
              }}
            >
              {s.label}
            </Chip>
          ))}
        </div>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Due">
          <select value={config.due} onChange={(e) => set({ due: e.target.value as DueWindow })} className={`w-full ${SELECT}`}>
            {Object.entries(DUE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select value={config.status} onChange={(e) => set({ status: e.target.value as SmartListConfig["status"] })} className={`w-full ${SELECT}`}>
            <option value="open">Not done</option>
            <option value="done">Done</option>
            <option value="all">All</option>
          </select>
        </Field>
      </div>
      {categories.length > 0 && (
        <Field label="Categories" hint={config.categories.length ? undefined : "None picked: every category."}>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <Chip key={c.key} selected={config.categories.includes(c.key)} onClick={() => set({ categories: toggle(config.categories, c.key) })}>
                <span className="h-2 w-2 rounded-full" style={{ background: `var(--c-${toColor(c.color)})` }} aria-hidden />
                {c.name}
              </Chip>
            ))}
          </div>
        </Field>
      )}
      {courses.length > 0 && (
        <Field label="Courses" hint={config.courses.length ? "Courses belong to assignments and events, so tasks are left out." : "None picked: any course or none."}>
          <div className="flex flex-wrap gap-1.5">
            {courses.map((c) => (
              <Chip key={c.id} selected={config.courses.includes(c.id)} onClick={() => set({ courses: toggle(config.courses, c.id) })}>
                <span className="h-2 w-2 rounded-full" style={{ background: `var(--c-${toColor(c.color)})` }} aria-hidden />
                {c.code}
              </Chip>
            ))}
          </div>
        </Field>
      )}
      <Field label="Priority" hint={config.priorities.length ? "Only tasks have a priority, so assignments and events are left out." : undefined}>
        <div className="flex flex-wrap gap-1.5">
          {PRIORITIES.map((p) => (
            <Chip key={p} selected={config.priorities.includes(p)} onClick={() => set({ priorities: toggle(config.priorities, p) })}>
              {p[0].toUpperCase() + p.slice(1)}
            </Chip>
          ))}
        </div>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title contains">
          <input value={config.search} maxLength={100} onChange={(e) => set({ search: e.target.value })} placeholder="e.g. exam" className={`w-full ${SELECT}`} />
        </Field>
        <Field label="Tags" hint="Comma separated; tasks only.">
          <input
            value={tags}
            onChange={(e) => {
              setTags(e.target.value);
              set({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10) });
            }}
            placeholder="jobs, urgent"
            className={`w-full ${SELECT}`}
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Sort by">
          <select value={config.sort} onChange={(e) => set({ sort: e.target.value as SmartListConfig["sort"] })} className={`w-full ${SELECT}`}>
            <option value="due">Due date</option>
            <option value="priority">Priority</option>
            <option value="title">Title</option>
          </select>
        </Field>
        <Field label="Show at most">
          <select value={config.limit} onChange={(e) => set({ limit: Number(e.target.value) })} className={`w-full ${SELECT}`}>
            {[5, 10, 20, 50].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-fg">
          <input type="checkbox" checked={config.group_by_day} onChange={(e) => set({ group_by_day: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" />
          Group by day
        </label>
      </div>
    </div>
  );
}

function Preview({ config }: { config: SmartListConfig }) {
  const [result, setResult] = useState<BlockItems | null>(null);
  const key = JSON.stringify(config);
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      api
        .previewSmartList(JSON.parse(key))
        .then((r) => !cancelled && setResult(r))
        .catch(() => !cancelled && setResult(null));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [key]);
  return (
    <div aria-live="polite" className="rounded-xl bg-surface-2/50 px-3 py-2.5 text-xs text-fg-muted">
      {result === null ? (
        "Checking what matches…"
      ) : result.total === 0 ? (
        "Nothing matches right now. It will fill in as things do."
      ) : (
        <>
          <span className="font-medium text-fg">
            {result.total} {result.total === 1 ? "match" : "matches"} now
          </span>
          {": "}
          {result.items
            .slice(0, 4)
            .map((i) => i.title)
            .join(" · ")}
          {result.total > 4 && " …"}
        </>
      )}
    </div>
  );
}

/** Make or edit a library block. Editing changes it on every view. */
export default function BlockEditor({
  block,
  kind: initialKind = "smart_list",
  onClose,
  onSaved,
}: {
  block?: Block;
  kind?: BlockKind;
  onClose: () => void;
  onSaved?: (block: Block) => void;
}) {
  const [kind, setKind] = useState<BlockKind>(block?.kind ?? initialKind);
  const [name, setName] = useState(block?.name ?? "");
  const [icon, setIcon] = useState(block?.icon ?? (initialKind === "note" ? "book" : "list"));
  const [color, setColor] = useState(toColor(block?.color ?? "blue"));
  const [smart, setSmart] = useState<SmartListConfig>(block?.kind === "smart_list" ? (block.config as SmartListConfig) : DEFAULT_SMART_LIST);
  const [text, setText] = useState(block?.kind === "note" ? (block.config as NoteConfig).text : "");
  const [moreColors, setMoreColors] = useState(!PRIMARY_COLORS.includes(color));
  const [busy, setBusy] = useState(false);
  const elsewhere = block ? block.used_in.length : 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const config = kind === "note" ? { text } : smart;
    try {
      const saved = block
        ? await api.updateBlock(block.id, { name: name.trim(), icon, color, config })
        : await api.createBlock({ name: name.trim(), kind, icon, color, config });
      putBlock(saved);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      toastError(err, "Couldn't save the block");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={block ? `Edit ${block.name}` : kind === "note" ? "New note" : "New smart list"}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !name.trim()} className={BUTTON_PRIMARY}>
            {block ? "Save" : "Create"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {elsewhere > 1 && (
          <p className="rounded-lg bg-accent-soft/60 px-3 py-2 text-xs text-accent-text">
            Shown on {block!.used_in.map((v) => v.name).join(", ")}. Changes apply to all of them.
          </p>
        )}
        {!block && (
          <div role="radiogroup" aria-label="Kind" className="grid grid-cols-2 gap-2">
            {(
              [
                { key: "smart_list", label: "Smart list", hint: "Tasks and events matching filters", Icon: ListChecksIcon },
                { key: "note", label: "Note", hint: "Text, checklists and links", Icon: NoteIcon },
              ] as const
            ).map((k) => (
              <button
                key={k.key}
                type="button"
                role="radio"
                aria-checked={kind === k.key}
                onClick={() => {
                  setKind(k.key);
                  setIcon(k.key === "note" ? "book" : "list");
                }}
                className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                  kind === k.key ? "border-accent bg-accent-soft/50" : "border-line hover:border-line-strong"
                }`}
              >
                <k.Icon weight="bold" className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                <span>
                  <span className="block text-sm font-medium text-fg">{k.label}</span>
                  <span className="block text-xs text-fg-muted">{k.hint}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <Field label="Name">
          <input
            autoFocus
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === "note" ? "Pinned" : "High priority this week"}
            className={`w-full h-10 ${FIELD}`}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Icon">
            <IconPicker value={icon} onChange={setIcon} />
          </Field>
          <Field label="Color">
            <div role="radiogroup" aria-label="Color" className="flex flex-wrap items-center gap-2">
              {(moreColors ? COLORS : PRIMARY_COLORS).map((c) => (
                <Swatch key={c} color={c} selected={c === color} onPick={() => setColor(c)} />
              ))}
              {!moreColors && (
                <button type="button" onClick={() => setMoreColors(true)} className="text-xs font-medium text-fg-muted hover:text-fg">
                  More
                </button>
              )}
            </div>
          </Field>
        </div>
        {kind === "smart_list" ? (
          <>
            <SmartListFields config={smart} onChange={setSmart} />
            <Preview config={smart} />
          </>
        ) : (
          <Field label="Text" hint="# heading · - [ ] checklist · - bullet · **bold** · *italic* · `code` · [link](https://…)">
            <textarea
              value={text}
              maxLength={10000}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder={"# This week\n- [ ] Office hours Tue 3pm\n- [ ] Email recruiter\n\nRoom **McB 209**"}
              className={`w-full resize-y py-2 font-mono text-[13px] leading-6 ${FIELD}`}
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
