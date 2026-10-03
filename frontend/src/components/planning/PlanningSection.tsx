"use client";

import { useEffect, useState } from "react";
import { CaretDownIcon, GraduationCapIcon, PaletteIcon, TagIcon, type Icon } from "@phosphor-icons/react";
import { useCatalog } from "@/lib/catalog";
import { lookFor } from "@/lib/palette";
import { CARD, MUTED, SECTION_HEADING } from "@/lib/ui";
import { CourseBadge, LookMark } from "../look/Look";
import CategoriesManager from "./CategoriesManager";
import CoursesManager from "./CoursesManager";

type Open = "courses" | "categories" | null;

function SummaryCard({
  id,
  icon: CardIcon,
  title,
  description,
  count,
  preview,
  open,
  onToggle,
}: {
  id: string;
  icon: Icon;
  title: string;
  description: string;
  count: string;
  preview: React.ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`flex flex-col gap-3 p-4 ${CARD} ${open ? "ring-1 ring-accent/40" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <CardIcon weight="bold" className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">
            {title} <span className="font-normal text-fg-faint">· {count}</span>
          </p>
          <p className={`text-xs ${MUTED}`}>{description}</p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={id}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 text-[13px] font-medium text-fg hover:bg-surface-2"
        >
          {open ? "Done" : "Manage"}
          <CaretDownIcon className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </div>
      <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1.5">{preview}</div>
    </div>
  );
}

/** Settings → Planning & appearance: courses and categories as two compact
 * summaries; their full lists and editors open on demand. */
export default function PlanningSection() {
  const { courses, categories } = useCatalog();
  const [open, setOpen] = useState<Open>(null);

  // /settings#courses or #categories (from elsewhere in the app) opens it.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL hash
    if (hash === "courses" || hash === "categories") setOpen(hash);
  }, []);

  const activeCourses = courses.filter((c) => !c.archived);
  const activeCategories = categories.filter((c) => !c.archived);
  const toggle = (which: Exclude<Open, null>) => setOpen((cur) => (cur === which ? null : which));

  return (
    <section id="planning" className="scroll-mt-6 space-y-3">
      <h2 className={SECTION_HEADING}>
        <PaletteIcon weight="bold" className="h-4 w-4 text-accent" aria-hidden />
        Planning &amp; appearance
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryCard
          id="courses"
          icon={GraduationCapIcon}
          title="Courses"
          description="Your classes, their colors, and how Canvas items match them."
          count={`${activeCourses.length}`}
          open={open === "courses"}
          onToggle={() => toggle("courses")}
          preview={
            activeCourses.length ? (
              activeCourses.slice(0, 6).map((c) => <CourseBadge key={c.id} course={c} />)
            ) : (
              <span className="text-xs text-fg-faint">Added when a Canvas feed syncs</span>
            )
          }
        />
        <SummaryCard
          id="categories"
          icon={TagIcon}
          title="Categories"
          description="Life areas for tasks and events: Personal, Career, Social…"
          count={`${activeCategories.length}`}
          open={open === "categories"}
          onToggle={() => toggle("categories")}
          preview={activeCategories.slice(0, 7).map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
              <LookMark look={lookFor({ category: c.key }, [c])} className="h-2 w-2" />
              {c.name}
            </span>
          ))}
        />
      </div>
      {open && (
        <div id={open} className={`p-3 ${CARD}`}>
          {open === "courses" ? <CoursesManager /> : <CategoriesManager />}
        </div>
      )}
    </section>
  );
}
