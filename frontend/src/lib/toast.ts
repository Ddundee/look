"use client";

// Tiny toast store, same pub/sub shape as events.ts, read by <Toaster />
// via useSyncExternalStore so no provider/context is needed.

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const EMPTY: Toast[] = [];

function emit() {
  listeners.forEach((l) => l());
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(message: string, kind: ToastKind = "success"): void {
  const id = nextId++;
  // Keep at most 3 on screen; the oldest drops off first.
  toasts = [...toasts.slice(-2), { id, kind, message }];
  emit();
  setTimeout(() => dismissToast(id), kind === "error" ? 6000 : 3500);
}

export function toastError(err: unknown, fallback = "Something went wrong"): void {
  toast(err instanceof Error && err.message ? err.message : fallback, "error");
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToasts(): Toast[] {
  return toasts;
}

export function getServerToasts(): Toast[] {
  return EMPTY;
}
