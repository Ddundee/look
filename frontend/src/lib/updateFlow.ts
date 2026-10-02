// The one-click self-update, independent of how it's displayed: start the
// job, follow it until the new version answers, then reload. The UI (a
// Sonner toast in UpdateChecker) is passed in, so this is testable on its
// own (updateFlow.test.ts).
import type { UpdateStatus } from "./types.ts";

export const POLL_MS = 2000;
export const GIVE_UP_MS = 5 * 60 * 1000;

export interface UpdateUi {
  /** Running: a status line, no buttons, can't be dismissed. */
  progress(title: string, description: string): void;
  /** Failed: the reason and a way to try again. */
  failed(reason: string, retry: () => void): void;
  /** Gave up waiting (the server may still finish on its own). */
  slow(): void;
  /** The new version is up; about to reload. */
  succeeded(): void;
}

export interface UpdateDeps {
  startUpdate(): Promise<unknown>;
  getUpdateStatus(): Promise<UpdateStatus>;
  getVersion(): Promise<{ revision: string | null }>;
  reload(): void;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export interface UpdateFlow {
  /** Start updating to `target` (a commit sha, or null for "whatever is
   * latest"). Ignored, returning false, while an update is already in
   * progress, so repeated clicks can't start a second one. */
  run(target: string | null): Promise<boolean>;
  /** Follow an update that's already running on the server (started from
   * another tab, or before a reload), without starting a new one. */
  follow(target: string | null): Promise<boolean>;
  isRunning(): boolean;
  /** For React (useSyncExternalStore): called when isRunning changes. */
  subscribe(listener: () => void): () => void;
}

/** Job states during which the server is busy updating. */
export const ACTIVE_JOB_STATES = ["pulling", "backing_up", "restarting"] as const;

function message(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function createUpdateFlow(deps: UpdateDeps, ui: UpdateUi): UpdateFlow {
  let running = false;
  const listeners = new Set<() => void>();
  const setRunning = (value: boolean) => {
    running = value;
    listeners.forEach((l) => l());
  };

  async function drive(target: string | null, start: boolean): Promise<boolean> {
    if (running) return false;
    setRunning(true);
    ui.progress("Updating Look…", "Downloading the new version. This takes a minute.");

    const fail = (reason: string) => {
      setRunning(false);
      ui.failed(reason, () => void drive(target, true));
    };

    if (start) {
      try {
        await deps.startUpdate();
      } catch (err) {
        // Someone else already started it (another tab): follow that one.
        const status = (err as { status?: number }).status;
        if (!(status === 409 && /already running/i.test(message(err, "")))) {
          fail(message(err, "Couldn't start the update."));
          return true;
        }
      }
    }

    const started = deps.now();
    const restarting = () => ui.progress("Restarting Look…", "Back in a few seconds.");
    for (;;) {
      await deps.sleep(POLL_MS);
      if (deps.now() - started > GIVE_UP_MS) {
        setRunning(false);
        ui.slow();
        return true;
      }
      try {
        const job = (await deps.getUpdateStatus()).job;
        if (job?.state === "failed") {
          fail(job.error ?? "The update failed.");
          return true;
        }
        if (job?.state === "backing_up") ui.progress("Updating Look…", "Backing up your data first.");
        if (job?.state === "restarting" || job?.state === "done") restarting();
        if (job?.state === "done") {
          const { revision } = await deps.getVersion();
          if (!target || revision === target) {
            ui.succeeded();
            await deps.sleep(800);
            deps.reload();
            return true;
          }
        }
      } catch {
        // Expected while the app's containers restart.
        restarting();
      }
    }
  }

  return {
    run: (target) => drive(target, true),
    follow: (target) => drive(target, false),
    isRunning: () => running,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
