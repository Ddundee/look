"use client";

// Shared rendering of an item's look (course or category: lib/palette.ts).
// Every list, calendar and badge goes through these, so one change in
// Settings restyles the whole app consistently.
import { GraduationCapIcon, HashIcon } from "@phosphor-icons/react";
import { useCatalog } from "@/lib/catalog";
import { lookFor, lookVars, type Look } from "@/lib/palette";
import type { CourseSummary } from "@/lib/types";

/** The look of a task or event: its course's if it has one, otherwise its
 * category's. */
export function useLook(item: { course?: CourseSummary | null; category?: string | null }): Look {
  const { categories } = useCatalog();
  return lookFor(item, categories);
}

/** The thin colored marker beside an item in a list. */
export function ItemEdge({ look, className = "" }: { look: Look; className?: string }) {
  return <span className={`look-edge ${className}`} data-style={look.style} style={lookVars(look)} aria-hidden />;
}

/** "CS 3214" with a cap icon: marks school work beyond its color. */
export function CourseBadge({ course, className = "" }: { course: CourseSummary; className?: string }) {
  const look = lookFor({ course }, []);
  return (
    <span
      className={`look-fill inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-px text-[11px] font-medium leading-4 text-fg ${className}`}
      data-style={look.style}
      style={lookVars(look)}
      title={course.name ? `${course.code}: ${course.name}` : course.code}
    >
      <GraduationCapIcon weight="fill" className="look-ink h-3 w-3 shrink-0" aria-hidden />
      <span className="font-mono tabular-nums">{course.code}</span>
    </span>
  );
}

/** A category name with a "#" in its color. */
export function CategoryTag({ category }: { category: string }) {
  const look = useLook({ category });
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap" style={lookVars(look)}>
      <HashIcon weight="bold" className="look-ink h-3.5 w-3.5" aria-hidden />
      {look.label}
    </span>
  );
}

/** A small swatch showing a color + style, for previews and pickers. */
export function LookSwatch({ look, className = "" }: { look: Look; className?: string }) {
  return (
    <span
      className={`look-fill inline-block rounded-md ${className}`}
      data-style={look.style}
      style={lookVars(look)}
      aria-hidden
    />
  );
}
