"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowsClockwiseIcon, CircleNotchIcon, PackageIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { toast } from "@/lib/toast";
import type { UpdateStatus } from "@/lib/types";
import { BUTTON_SECONDARY, CARD, MUTED, SECTION_HEADING } from "@/lib/ui";
import { CHECK_UPDATE_EVENT, updateFlow } from "./UpdateChecker";

function short(sha: string | null | undefined): string | null {
  return sha ? sha.slice(0, 7) : null;
}

/** Settings → Version: what's running, what's published, and a manual
 * "Check for updates" that opens the update toast when one exists. */
export default function VersionSection() {
  const [revision, setRevision] = useState<string | null | undefined>(undefined);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  // Same state as the update toast: while it runs, say so and don't offer
  // another check (which would just reopen the toast).
  const updating = useSyncExternalStore(updateFlow.subscribe, updateFlow.isRunning, () => false);

  useEffect(() => {
    api
      .getVersion()
      .then((v) => setRevision(v.revision))
      .catch(() => setRevision(null));
    api
      .getUpdateStatus()
      .then(setStatus)
      .catch(() => setStatus({ enabled: false }));
  }, []);

  async function checkNow() {
    setChecking(true);
    try {
      const next = await api.getUpdateStatus(true);
      setStatus(next);
      if (!next.enabled) toast("Updates aren't set up on this server.", "info");
      else if (next.check_error) toast(next.check_error, "error");
      else if (next.update_available) window.dispatchEvent(new Event(CHECK_UPDATE_EVENT));
      else toast("You're on the latest version.", "info");
    } catch {
      toast("Couldn't check for updates.", "error");
    } finally {
      setChecking(false);
    }
  }

  const latest = status?.latest ?? null;
  const stateLine = updating
    ? "Updating Look…"
    : !status
    ? "Checking"
    : !status.enabled
      ? "Updates aren't set up on this server."
      : status.check_error
        ? status.check_error
        : status.update_available
          ? "An update is available."
          : latest
            ? "Up to date."
            : "No published version found yet.";

  return (
    <section className="space-y-3">
      <h2 className={SECTION_HEADING}>
        <PackageIcon weight="bold" className="h-4 w-4 text-accent" aria-hidden />
        Version
      </h2>
      <div className={`flex flex-wrap items-end justify-between gap-4 p-5 ${CARD}`}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className={MUTED}>Running</dt>
          <dd className="font-mono tabular-nums text-fg">
            {revision === undefined ? "…" : short(revision) ?? "Local build"}
          </dd>
          <dt className={MUTED}>Latest published</dt>
          <dd className="font-mono tabular-nums text-fg">
            {latest ? (
              <>
                {short(latest.sha)}
                <span className="ml-2 font-sans text-fg-muted">{formatDate(latest.published_at.slice(0, 10))}</span>
              </>
            ) : (
              "Unknown"
            )}
          </dd>
          <dt className={MUTED}>Status</dt>
          <dd className="text-fg" aria-live="polite">
            {stateLine}
          </dd>
        </dl>
        {status?.enabled !== false && (
          <button onClick={checkNow} disabled={checking || updating} className={`h-9 py-0 text-[13px] ${BUTTON_SECONDARY}`}>
            {checking || updating ? (
              <CircleNotchIcon className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <ArrowsClockwiseIcon className="h-4 w-4" aria-hidden />
            )}
            {updating ? "Updating…" : "Check for updates"}
          </button>
        )}
      </div>
    </section>
  );
}
