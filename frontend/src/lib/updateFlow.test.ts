import assert from "node:assert/strict";
import { test } from "node:test";
import type { UpdateJob, UpdateStatus } from "./types.ts";
import { createUpdateFlow, GIVE_UP_MS, type UpdateDeps, type UpdateUi } from "./updateFlow.ts";

type Call = [string, ...unknown[]];

/** A fake server: `jobs` is what successive status polls return. */
function setup(opts: { jobs?: (Partial<UpdateJob> | Error)[]; startError?: Error; revision?: string } = {}) {
  const calls: Call[] = [];
  let retry: (() => void) | null = null;
  let clock = 0;
  const jobs = [...(opts.jobs ?? [])];
  let starts = 0;
  let reloads = 0;
  const deps: UpdateDeps = {
    startUpdate: async () => {
      starts++;
      if (opts.startError) throw opts.startError;
      return {};
    },
    getUpdateStatus: async (): Promise<UpdateStatus> => {
      const next = jobs.shift() ?? { state: "pulling" };
      if (next instanceof Error) throw next;
      return { enabled: true, job: { error: null, started_at: null, finished_at: null, target: null, ...next } as UpdateJob };
    },
    getVersion: async () => ({ revision: opts.revision ?? "abc123" }),
    reload: () => {
      reloads++;
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  const ui: UpdateUi = {
    progress: (title, description) => calls.push(["progress", title, description]),
    failed: (reason, r) => {
      retry = r;
      calls.push(["failed", reason]);
    },
    slow: () => calls.push(["slow"]),
    succeeded: () => calls.push(["succeeded"]),
  };
  const flow = createUpdateFlow(deps, ui);
  return { flow, calls, counts: () => ({ starts, reloads }), retry: () => retry, opts };
}

function apiError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

test("clicking Update immediately shows a busy state with no buttons", async () => {
  const { flow, calls } = setup({ jobs: [{ state: "done" }] });
  const pending = flow.run("abc123");
  assert.equal(flow.isRunning(), true);
  assert.deepEqual(calls[0], ["progress", "Updating Look…", "Downloading the new version. This takes a minute."]);
  await pending;
});

test("a second click while updating doesn't start another update", async () => {
  const { flow, counts } = setup({ jobs: [{ state: "pulling" }, { state: "done" }] });
  const first = flow.run("abc123");
  assert.equal(await flow.run("abc123"), false);
  assert.equal(await flow.follow("abc123"), false);
  await first;
  assert.equal(counts().starts, 1);
});

test("success keeps the existing behavior: success message, then reload", async () => {
  const { flow, calls, counts } = setup({
    jobs: [{ state: "backing_up" }, { state: "restarting" }, new Error("connection refused"), { state: "done" }],
  });
  await flow.run("abc123");
  const kinds = calls.map((c) => c[0]);
  assert.equal(kinds.at(-1), "succeeded");
  assert.ok(calls.some((c) => c[1] === "Restarting Look…"));
  assert.equal(counts().reloads, 1);
});

test("a failed job restores a working Retry", async () => {
  const { flow, calls, retry, counts } = setup({ jobs: [{ state: "failed", error: "pull failed: no space left" }, { state: "done" }] });
  await flow.run("abc123");
  assert.deepEqual(calls.at(-1), ["failed", "pull failed: no space left"]);
  assert.equal(flow.isRunning(), false);
  retry()!();
  assert.equal(flow.isRunning(), true); // retry starts a fresh attempt
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(counts().starts, 2);
});

test("a start error is shown and can be retried", async () => {
  const { flow, calls } = setup({ startError: apiError(502, "Updater unreachable") });
  await flow.run("abc123");
  assert.deepEqual(calls.at(-1), ["failed", "Updater unreachable"]);
  assert.equal(flow.isRunning(), false);
});

test("an update already running on the server is followed, not failed", async () => {
  const { flow, calls, counts } = setup({ startError: apiError(409, "An update is already running."), jobs: [{ state: "done" }] });
  await flow.run("abc123");
  assert.equal(calls.at(-1)?.[0], "succeeded");
  assert.equal(counts().starts, 1);
});

test("waits for the new version before reloading", async () => {
  const { flow, counts, calls } = setup({ jobs: [{ state: "done" }, { state: "done" }], revision: "old" });
  await flow.run("abc123"); // revision never becomes abc123: gives up
  assert.equal(counts().reloads, 0);
  assert.equal(calls.at(-1)?.[0], "slow");
  assert.equal(flow.isRunning(), false);
  assert.ok(GIVE_UP_MS > 0);
});

test("subscribers hear when an update starts and stops", async () => {
  const { flow } = setup({ jobs: [{ state: "failed", error: "x" }] });
  const seen: boolean[] = [];
  const off = flow.subscribe(() => seen.push(flow.isRunning()));
  await flow.run(null);
  off();
  assert.deepEqual(seen, [true, false]);
});
