"use client";

// Thin wrapper over Sonner so call sites keep the old `toast(message,
// kind)` / `toastError(err)` API. <Toaster /> renders the Sonner host.
import { toast as sonner } from "sonner";

export type ToastKind = "success" | "error" | "info";

export function toast(message: string, kind: ToastKind = "success"): void {
  if (kind === "error") sonner.error(message, { duration: 6000 });
  else if (kind === "info") sonner.info(message);
  else sonner.success(message);
}

export function toastError(err: unknown, fallback = "Something went wrong"): void {
  toast(err instanceof Error && err.message ? err.message : fallback, "error");
}
