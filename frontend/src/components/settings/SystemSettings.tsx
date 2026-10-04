"use client";

import { PackageIcon } from "@phosphor-icons/react";
import VersionSection from "@/components/VersionSection";
import { CARD, MUTED } from "@/lib/ui";
import SectionHeader from "./SectionHeader";

/** Settings → Updates & version. */
export default function SystemSettings() {
  return (
    <div className="space-y-4 [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-fg">
      <SectionHeader icon={PackageIcon} title="Updates & version" summary="What's running and whether a newer version is published." />
      <VersionSection />
      <details className={`group ${CARD} [&_summary::-webkit-details-marker]:hidden`}>
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-medium text-fg">
          Advanced: upgrades, backups and restores
          <span className="text-xs font-normal text-fg-muted group-open:hidden">Show</span>
          <span className="hidden text-xs font-normal text-fg-muted group-open:inline">Hide</span>
        </summary>
        <div className={`space-y-2 border-t border-line px-5 py-4 text-sm ${MUTED}`}>
          <p>
            From a shell on the server, <code>./scripts/upgrade.sh</code> backs up the database, pulls the new images,
            migrates, restarts and checks health. <code>./scripts/backup.sh</code> makes a backup on its own;
            <code> ./scripts/restore.sh &lt;file&gt;</code> restores one.
          </p>
          <p>
            Details are in <code>docs/DATABASE.md</code> and <code>docs/DEPLOYMENT.md</code> in the repository.
          </p>
        </div>
      </details>
    </div>
  );
}
