"use client";

import { useEffect } from "react";
import { toast as sonner } from "sonner";
import { api } from "@/lib/api";
import type { UpdateStatus } from "@/lib/types";

const TOAST_ID = "look-update";
const CHECK_EVERY_MS = 15 * 60 * 1000;
const POLL_MS = 2000;
const GIVE_UP_MS = 5 * 60 * 1000;
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

// Module-level, not React state: nothing here renders, and there is only
// ever one app shell (so one checker) per page.
let updating = false;

function showFailed(reason: string, target: string | null): void {
  updating = false;
  sonner.error("Update failed", {
    id: TOAST_ID,
    duration: Infinity,
    description: reason,
    action: {
      label: "Retry",
      onClick: (e) => {
        e.preventDefault();
        void runUpdate(target);
      },
    },
  });
}

async function runUpdate(target: string | null): Promise<void> {
  updating = true;
  sonner.loading("Downloading update", { id: TOAST_ID, duration: Infinity, description: "This takes a minute." });
  try {
    await api.startUpdate();
  } catch (err) {
    showFailed(err instanceof Error ? err.message : "Couldn't start the update.", target);
    return;
  }

  const started = Date.now();
  const restarting = () =>
    sonner.loading("Restarting", { id: TOAST_ID, duration: Infinity, description: "Back in a few seconds." });

  const poll = async () => {
    if (Date.now() - started > GIVE_UP_MS) {
      updating = false;
      sonner.error("The update is taking longer than expected", {
        id: TOAST_ID,
        duration: Infinity,
        description: "Check the server, then reload this page.",
      });
      return;
    }
    try {
      const job = (await api.getUpdateStatus()).job;
      if (job?.state === "failed") return showFailed(job.error ?? "The update failed.", target);
      if (job?.state === "backing_up") {
        sonner.loading("Backing up your data", { id: TOAST_ID, duration: Infinity, description: "Before the new version starts." });
      }
      if (job?.state === "restarting" || job?.state === "done") restarting();
      if (job?.state === "done") {
        const { revision } = await api.getVersion();
        if (!target || revision === target) {
          sonner.success("Updated. Reloading", { id: TOAST_ID, duration: Infinity, description: undefined });
          setTimeout(() => window.location.reload(), 800);
          return;
        }
      }
    } catch {
      // Expected while the app's containers restart.
      restarting();
    }
    setTimeout(poll, POLL_MS);
  };
  setTimeout(poll, POLL_MS);
}

async function check(manual = false): Promise<void> {
  if (updating) return;
  let status: UpdateStatus;
  try {
    status = await api.getUpdateStatus(manual);
  } catch {
    return;
  }
  if (!status.enabled || !status.update_available || !status.latest) return;
  const target = status.latest.sha;
  if (manual) writeDismissed(null);
  else if (readDismissed() === target) return;
  sonner.info("Update available", {
    id: TOAST_ID,
    duration: Infinity,
    description: summary(status),
    action: {
      label: "Update",
      onClick: (e) => {
        e.preventDefault();
        void runUpdate(target);
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
