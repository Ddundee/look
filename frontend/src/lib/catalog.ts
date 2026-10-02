"use client";

// Categories and courses, loaded once and shared by every component that
// styles items (lists, calendar, badges, forms). Settings calls
// refreshCatalog() after changes so everything restyles at once.
import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import type { Category, Course } from "./types";

interface Catalog {
  categories: Category[]; // archived included: existing items keep their look
  courses: Course[];
  loaded: boolean;
}

const EMPTY: Catalog = { categories: [], courses: [], loaded: false };
let state: Catalog = EMPTY;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: Catalog) {
  state = next;
  listeners.forEach((l) => l());
}

export function refreshCatalog(): Promise<void> {
  pending = Promise.all([api.listCategories(true), api.listCourses(true)])
    .then(([categories, courses]) => emit({ categories, courses, loaded: true }))
    .catch(() => {
      // Keep whatever we had; items fall back to default looks.
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCatalog(): Catalog {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  useEffect(() => {
    if (!state.loaded && !pending) void refreshCatalog();
  }, []);
  return snapshot;
}

/** Active categories, for pickers (archived ones aren't offered). */
export function activeCategories(catalog: Catalog): Category[] {
  return catalog.categories.filter((c) => !c.archived);
}
