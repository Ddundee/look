"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { refreshCatalog, useCatalog } from "@/lib/catalog";
import { notifyEventsChanged } from "@/lib/events";
import { toast, toastError } from "@/lib/toast";
import { FIELD, LABEL } from "@/lib/ui";

/** Which class an event belongs to, chosen by hand. Saved immediately
 * (it's Look's own data, so it works on read-only imported events too);
 * for a Canvas item it's remembered for that whole Canvas course. */
export default function CourseSelect({
  eventId,
  courseId,
  imported = false,
}: {
  eventId: string;
  courseId: string | null;
  imported?: boolean;
}) {
  const { courses } = useCatalog();
  const [value, setValue] = useState(courseId ?? "");
  const [busy, setBusy] = useState(false);
  const active = courses.filter((c) => !c.archived || c.id === value);

  async function change(next: string) {
    const previous = value;
    setValue(next);
    setBusy(true);
    try {
      await api.setEventCourse(eventId, next || null);
      const course = courses.find((c) => c.id === next);
      toast(
        course
          ? imported
            ? `Linked to ${course.code}. Other items from this course will follow.`
            : `Linked to ${course.code}`
          : "No course",
        "info"
      );
      notifyEventsChanged();
      void refreshCatalog();
    } catch (err) {
      setValue(previous);
      toastError(err, "Couldn't change the course");
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className={`block ${LABEL}`}>
      Course
      <select
        value={value}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className={`mt-1.5 h-10 w-full ${FIELD}`}
      >
        <option value="">No course</option>
        {active.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code}
            {c.name ? `: ${c.name}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
