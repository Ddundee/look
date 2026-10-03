"use client";

// Views (Dashboard, Today, custom ones), loaded once and shared by the
// sidebar, view pages and Settings. The server is the source of truth;
// writes go through the API and then update this store.
import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import type { LookView } from "./types";

interface ViewsState {
  views: LookView[]; // archived included
  loaded: boolean;
  error: string | null;
}

const EMPTY: ViewsState = { views: [], loaded: false, error: null };
let state: ViewsState = EMPTY;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: ViewsState) {
  state = next;
  listeners.forEach((l) => l());
}

export function refreshViews(): Promise<void> {
  pending = api
    .listViews(true)
    .then((r) => emit({ views: r.views, loaded: true, error: null }))
    .catch((e) => emit({ ...state, loaded: true, error: e instanceof Error ? e.message : "Couldn't load views" }))
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Replace one view in the store after a successful write. */
export function putView(view: LookView) {
  const exists = state.views.some((v) => v.key === view.key);
  emit({ ...state, views: exists ? state.views.map((v) => (v.key === view.key ? view : v)) : [...state.views, view] });
}

export function dropView(key: string) {
  emit({ ...state, views: state.views.filter((v) => v.key !== key) });
}

export function setViews(views: LookView[]) {
  emit({ ...state, views, loaded: true });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useViews(enabled = true): ViewsState {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  useEffect(() => {
    if (enabled && !state.loaded && !pending) void refreshViews();
  }, [enabled]);
  return snapshot;
}

/** Custom views shown in the sidebar, in order. */
export function navViews(views: LookView[]): LookView[] {
  return views.filter((v) => v.kind === "custom" && v.show_in_nav && !v.archived);
}
