"use client";

import { useEffect } from "react";
import { toast as sonner } from "sonner";
import { api } from "@/lib/api";
import type { UpdateStatus } from "@/lib/types";
import { ACTIVE_JOB_STATES, createUpdateFlow } from "@/lib/updateFlow";

const TOAST_ID = "look-update";
const CHECK_EVERY_MS = 15 * 60 * 1000;
const DISMISSED_KEY = "look-update-dismissed";
/** Fired by Settings' "Check for updates" to show the toast right away. */
export const CHECK_UPDATE_EVENT = "look:check-update";

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(sha: string | null): void {
  try {
    if (sha) localStorage.setItem(DISMISSED_KEY, sha);
    else localStorage.removeItem(DISMISSED_KEY);
  } catch {
    // storage blocked: "Later" just won't be remembered
  }
}

function summary(status: UpdateStatus): string {
  const changes = status.changes ?? [];
  if (changes.length === 0) return "A newer version of Look is ready to install.";
  const shown = changes.slice(0, 3).map((c) => c.message);
  return changes.length > 3 ? `${shown.join("; ")}; and ${changes.length - 3} more` : shown.join("; ");
}

// While an update runs the toast has no buttons and can't be dismissed.
// Sonner merges options when a toast is updated by id, so the offer's
// Update/Later buttons must be cleared explicitly.
const BUSY = { action: undefined, cancel: undefined, dismissible: false, closeButton: false } as const;
const SETTLED = { dismissible: true, closeButton: true } as const;

/** The one update flow per page; Settings → Version reads its state. */
export const updateFlow = createUpdateFlow(
  {
    startUpdate: () => api.startUpdate(),
    getUpdateStatus: () => api.getUpdateStatus(),
    getVersion: () => api.getVersion(),
    reload: () => window.location.reload(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  },
  {
    progress: (title, description) =>
      sonner.loading(title, { id: TOAST_ID, duration: Infinity, description, ...BUSY }),
    failed: (reason, retry) =>
      sonner.error("Update failed", {
        id: TOAST_ID,
        duration: Infinity,
        description: reason,
        cancel: undefined,
        ...SETTLED,
        action: {
          label: "Retry",
          onClick: (e) => {
            e.preventDefault();
            retry();
          },
        },
      }),
    slow: () =>
      sonner.error("The update is taking longer than expected", {
        id: TOAST_ID,
        duration: Infinity,
        description: "Check the server, then reload this page.",
        action: undefined,
        cancel: undefined,
        ...SETTLED,
      }),
    succeeded: () =>
      sonner.success("Updated. Reloading", { id: TOAST_ID, duration: Infinity, description: undefined, ...BUSY }),
  }
);

async function check(manual = false): Promise<void> {
  if (updateFlow.isRunning()) return;
  let status: UpdateStatus;
  try {
    status = await api.getUpdateStatus(manual);
  } catch {
    return;
  }
  if (!status.enabled) return;
  // Already updating (started in another tab, or before this page
  // loaded): show its progress instead of offering another Update.
  if (status.job && (ACTIVE_JOB_STATES as readonly string[]).includes(status.job.state)) {
    void updateFlow.follow(status.job.target);
    return;
  }
  if (!status.update_available || !status.latest) return;
  const target = status.latest.sha;
  if (manual) writeDismissed(null);
  else if (readDismissed() === target) return;
  sonner.info("Update available", {
    id: TOAST_ID,
    duration: Infinity,
    description: summary(status),
    ...SETTLED,
    action: {
      label: "Update",
      onClick: (e) => {
        e.preventDefault();
        void updateFlow.run(target);
      },
    },
    cancel: { label: "Later", onClick: () => writeDismissed(target) },
  });
}

/** Polls the self-update status and drives the one-click update through a
 * single persistent Sonner toast. Renders nothing; hidden entirely when the
 * server has no updater. */
export default function UpdateChecker() {
  useEffect(() => {
    void check();
    const interval = setInterval(() => void check(), CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onManual = () => void check(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(CHECK_UPDATE_EVENT, onManual);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(CHECK_UPDATE_EVENT, onManual);
    };
  }, []);

  return null;
}
