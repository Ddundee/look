"use client";

import { useState } from "react";
import { ArchiveIcon, ArrowCounterClockwiseIcon, GraduationCapIcon, PencilSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { refreshCatalog, useCatalog } from "@/lib/catalog";
import { notifyEventsChanged } from "@/lib/events";
import type { ColorKey, StyleKey } from "@/lib/palette";
import { toast, toastError } from "@/lib/toast";
import type { Course } from "@/lib/types";
import { BUTTON_GHOST_SM, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, FIELD, LABEL, MUTED, SECTION_HEADING } from "@/lib/ui";
import { CourseBadge } from "../look/Look";
import LookPicker from "./LookPicker";

interface CourseFields {
  code: string;
  name: string;
  aliases: string;
  color: ColorKey;
  style: StyleKey;
}

function CourseForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: CourseFields;
  submitLabel: string;
  onSubmit: (v: CourseFields) => Promise<void>;
  onCancel?: () => void;
}) {
  const [v, setV] = useState(initial);
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
      className="space-y-3"
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
      <LookPicker color={v.color} style={v.style} onChange={(look) => patch(look)} previewLabel={v.code.trim() || "CS 3214"} course />
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !v.code.trim()} className={BUTTON_PRIMARY}>
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

const splitAliases = (raw: string) => raw.split(",").map((a) => a.trim()).filter(Boolean);

function CourseRow({ course }: { course: Course }) {
  const [editing, setEditing] = useState(false);

  async function save(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      toast(done, "info");
      await refreshCatalog();
      notifyEventsChanged();
    } catch (err) {
      toastError(err, "Couldn't change the course");
    }
  }

  if (editing) {
    return (
      <div className="px-5 py-4">
        <CourseForm
          initial={{
            code: course.code,
            name: course.name ?? "",
            aliases: course.aliases.join(", "),
            color: course.color as ColorKey,
            style: course.style as StyleKey,
          }}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            await save(
              () => api.updateCourse(course.id, { code: v.code, name: v.name || null, aliases: splitAliases(v.aliases), color: v.color, style: v.style }),
              `Saved ${v.code}`
            );
            setEditing(false);
          }}
        />
      </div>
    );
  }
  return (
    <div className={`flex items-start gap-3 px-5 py-3 ${course.archived ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <CourseBadge course={course} />
          {course.name && <span className="text-sm text-fg">{course.name}</span>}
          {course.archived && <span className="text-xs text-fg-faint">archived</span>}
        </div>
        <p className="text-xs text-fg-muted">
          {course.event_count} item{course.event_count === 1 ? "" : "s"}
          {course.canvas_contexts.length > 0 && <> · Canvas {course.canvas_contexts.map((c) => c.split("/").pop()).join(", ")}</>}
          {course.aliases.length > 0 && <> · also <span className="font-mono">{course.aliases.join(", ")}</span></>}
        </p>
      </div>
      <button type="button" onClick={() => setEditing(true)} className={BUTTON_GHOST_SM} aria-label={`Edit ${course.code}`}>
        <PencilSimpleIcon className="h-3.5 w-3.5" aria-hidden />
        Edit
      </button>
      <button
        type="button"
        onClick={() =>
          save(() => api.updateCourse(course.id, { archived: !course.archived }), course.archived ? `Restored ${course.code}` : `Archived ${course.code}`)
        }
        className={BUTTON_GHOST_SM}
        aria-label={course.archived ? `Restore ${course.code}` : `Archive ${course.code}`}
        title={course.archived ? "Restore" : "Archive: its items stop showing the course, and it won't be re-created"}
      >
        {course.archived ? <ArrowCounterClockwiseIcon className="h-3.5 w-3.5" aria-hidden /> : <ArchiveIcon className="h-3.5 w-3.5" aria-hidden />}
      </button>
    </div>
  );
}

/** Settings → Courses: your classes, their look and how items match them. */
export default function CoursesSection() {
  const { courses, loaded } = useCatalog();
  const [adding, setAdding] = useState(false);
  const sorted = [...courses].sort((a, b) => Number(a.archived) - Number(b.archived) || a.code.localeCompare(b.code));

  return (
    <section id="courses" className="scroll-mt-6 space-y-3">
      <h2 className={SECTION_HEADING}>
        <GraduationCapIcon weight="bold" className="h-4 w-4 text-accent" aria-hidden />
        Courses
      </h2>
      <div className={`divide-y divide-line ${CARD}`}>
        <p className={`px-5 py-4 text-sm ${MUTED}`}>
          Your classes. Canvas assignments link to their course on their own (Look reads the Canvas course from each
          item); events titled like &ldquo;CS 3214 lecture&rdquo; link to an existing course. Fix a wrong one from the
          item&apos;s details and Look remembers it for the rest of that course.
        </p>
        {!loaded ? (
          <p className="px-5 py-4 text-sm text-fg-faint">Loading</p>
        ) : sorted.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-faint">No courses yet. They appear when a Canvas feed syncs, or add one.</p>
        ) : (
          sorted.map((c) => <CourseRow key={c.id} course={c} />)
        )}
        <div className="px-5 py-4">
          {adding ? (
            <CourseForm
              initial={{ code: "", name: "", aliases: "", color: "blue", style: "soft" }}
              submitLabel="Add course"
              onCancel={() => setAdding(false)}
              onSubmit={async (v) => {
                try {
                  await api.createCourse({ code: v.code, name: v.name || null, aliases: splitAliases(v.aliases), color: v.color, style: v.style });
                  toast(`Added ${v.code}`);
                  await refreshCatalog();
                  notifyEventsChanged();
                  setAdding(false);
                } catch (err) {
                  toastError(err, "Couldn't add the course");
                }
              }}
            />
          ) : (
            <button type="button" onClick={() => setAdding(true)} className={BUTTON_SECONDARY}>
              <PlusIcon weight="bold" className="h-4 w-4" aria-hidden />
              New course
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
