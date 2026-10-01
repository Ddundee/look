"use client";

// Minimal pub/sub so a task created from the always-visible QuickAddBar
// (which lives outside any single page's state) can prompt whichever page
// is currently mounted to refetch, without pulling in a data-fetching
// library for a single-user local app.
type Listener = () => void;

const listeners = new Set<Listener>();

export function onTasksChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyTasksChanged(): void {
  listeners.forEach((l) => l());
}

// Same pattern for calendar events, so the Calendar and Today pages refresh
// after an event is added or edited from anywhere.
const eventListeners = new Set<Listener>();

export function onEventsChanged(listener: Listener): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

export function notifyEventsChanged(): void {
  eventListeners.forEach((l) => l());
}
