"use client";

import { useState } from "react";
import { ArchiveIcon, ArrowCounterClockwiseIcon, CaretRightIcon, PlusIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { refreshCatalog, useCatalog } from "@/lib/catalog";
import { notifyEventsChanged } from "@/lib/events";
import { toColor, type ColorKey } from "@/lib/palette";
import { toast, toastError } from "@/lib/toast";
import type { Course } from "@/lib/types";
import { BUTTON_GHOST_SM, BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD, LABEL } from "@/lib/ui";
import { CourseBadge } from "../look/Look";
import LookPicker from "./LookPicker";

interface CourseFields {
  code: string;
  name: string;
  aliases: string;
  color: ColorKey;
}

const splitAliases = (raw: string) => raw.split(",").map((a) => a.trim()).filter(Boolean);

function CourseForm({
  course,
  submitLabel,
  onSubmit,
  onCancel,
  onArchive,
}: {
  course?: Course;
  submitLabel: string;
  onSubmit: (v: CourseFields) => Promise<void>;
  onCancel: () => void;
  onArchive?: () => void;
}) {
  const [v, setV] = useState<CourseFields>({
    code: course?.code ?? "",
    name: course?.name ?? "",
    aliases: course?.aliases.join(", ") ?? "",
    color: toColor(course?.color ?? "blue"),
  });
  const [busy, setBusy] = useState(false);
  const patch = (p: Partial<CourseFields>) => setV((cur) => ({ ...cur, ...p }));
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!v.code.trim()) return;
        setBusy(true);
        try {
          await onSubmit(v);
        } finally {
          setBusy(false);
        }
      }}
      className="space-y-4 rounded-xl bg-surface-2/40 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <label className={`block ${LABEL}`}>
          Code
          <input value={v.code} onChange={(e) => patch({ code: e.target.value })} placeholder="CS 3214" className={`mt-1.5 h-10 w-full font-mono ${FIELD}`} />
        </label>
        <label className={`block ${LABEL}`}>
          Name
          <input value={v.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Computer Systems" className={`mt-1.5 h-10 w-full ${FIELD}`} />
        </label>
      </div>
      <LookPicker color={v.color} style="soft" kind="course" onChange={({ color }) => patch({ color })} previewLabel={v.code.trim() || "CS 3214"} />
      <details className="group rounded-lg border border-line px-3 py-2">
        <summary className="cursor-pointer text-[13px] font-medium text-fg-muted">Advanced: matching</summary>
        <div className="mt-3 space-y-3">
          <label className={`block ${LABEL}`}>
            Other spellings
            <input
              value={v.aliases}
              onChange={(e) => patch({ aliases: e.target.value })}
              placeholder="CS3214-F26, CSE 3214"
              className={`mt-1.5 h-10 w-full font-mono text-xs ${FIELD}`}
            />
            <span className="mt-1 block text-xs font-normal text-fg-faint">
              Comma-separated. Items tagged with one of these codes, or titled starting with one, link here.
            </span>
          </label>
          {course && (
            <p className="text-xs text-fg-muted">
              {course.event_count} linked item{course.event_count === 1 ? "" : "s"}
              {course.canvas_contexts.length > 0 && (
                <>
                  {" · "}Canvas {course.canvas_contexts.map((c) => c.split("/").pop()).join(", ")}
                </>
              )}
            </p>
          )}
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy || !v.code.trim()} className={BUTTON_PRIMARY}>
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className={BUTTON_SECONDARY}>
          Cancel
        </button>
        {onArchive && course && (
          <button type="button" onClick={onArchive} className={`ml-auto ${BUTTON_GHOST_SM}`}>
            {course.archived ? <ArrowCounterClockwiseIcon className="h-3.5 w-3.5" aria-hidden /> : <ArchiveIcon className="h-3.5 w-3.5" aria-hidden />}
            {course.archived ? "Restore" : "Archive"}
          </button>
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
    notifyEventsChanged();
    return true;
  } catch (err) {
    toastError(err, "Couldn't save the course");
    return false;
  }
}

/** Courses, compact: badge, name, color. A row opens its editor. */
export default function CoursesManager() {
  const { courses } = useCatalog();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const sorted = [...courses].sort((a, b) => Number(a.archived) - Number(b.archived) || a.code.localeCompare(b.code));

  return (
    <div className="space-y-1">
      {sorted.length === 0 && <p className="px-2 py-3 text-sm text-fg-faint">No courses yet. They appear when a Canvas feed syncs, or add one.</p>}
      {sorted.map((c) =>
        editing === c.id ? (
          <CourseForm
            key={c.id}
            course={c}
            submitLabel="Save"
            onCancel={() => setEditing(null)}
            onArchive={async () => {
              if (await saved(() => api.updateCourse(c.id, { archived: !c.archived }), c.archived ? `Restored ${c.code}` : `Archived ${c.code}`)) setEditing(null);
            }}
            onSubmit={async (v) => {
              const ok = await saved(
                () => api.updateCourse(c.id, { code: v.code, name: v.name || null, aliases: splitAliases(v.aliases), color: v.color }),
                `Saved ${v.code}`
              );
              if (ok) setEditing(null);
            }}
          />
        ) : (
          <button
            key={c.id}
            type="button"
            onClick={() => setEditing(c.id)}
            className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2/70 ${c.archived ? "opacity-55" : ""}`}
          >
            <CourseBadge course={c} />
            <span className="min-w-0 flex-1 truncate text-sm text-fg">{c.name ?? <span className="text-fg-faint">No name</span>}</span>
            {c.archived && <span className="text-xs text-fg-faint">Archived</span>}
            <span className="hidden text-xs capitalize text-fg-faint sm:inline">{toColor(c.color)}</span>
            <CaretRightIcon className="h-3.5 w-3.5 text-fg-faint" aria-hidden />
          </button>
        )
      )}
      {editing === "new" ? (
        <CourseForm
          submitLabel="Add course"
          onCancel={() => setEditing(null)}
          onSubmit={async (v) => {
            const ok = await saved(
              () => api.createCourse({ code: v.code, name: v.name || null, aliases: splitAliases(v.aliases), color: v.color }),
              `Added ${v.code}`
            );
            if (ok) setEditing(null);
          }}
        />
      ) : (
        <button type="button" onClick={() => setEditing("new")} className={`mt-1 ${BUTTON_GHOST_SM}`}>
          <PlusIcon weight="bold" className="h-3.5 w-3.5" aria-hidden />
          New course
        </button>
      )}
    </div>
  );
}
