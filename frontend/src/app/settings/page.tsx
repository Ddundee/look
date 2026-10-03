"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CaretRightIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { useCatalog } from "@/lib/catalog";
import { getServerThemeSnapshot, getThemeSnapshot, subscribeTheme } from "@/lib/theme";
import type { CalendarSubscription, UpdateStatus } from "@/lib/types";
import { CARD } from "@/lib/ui";
import { useViews } from "@/lib/viewsStore";
import { LEGACY_HASHES, SETTINGS_GROUPS } from "@/components/settings/sections";

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Settings at a glance: each section with its current state. On phones
 * this is also the list you drill into. */
export default function SettingsOverview() {
  const router = useRouter();
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
  const { courses, categories, loaded: catalogLoaded } = useCatalog();
  const { views, loaded: viewsLoaded } = useViews();
  const [feeds, setFeeds] = useState<CalendarSubscription[] | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);

  // Old links (/settings#calendars, #openai-tunnel…) go to their section.
  useEffect(() => {
    const target = LEGACY_HASHES[window.location.hash.slice(1)];
    if (target) router.replace(`/settings/${target}`);
  }, [router]);

  useEffect(() => {
    api.listCalendarSubscriptions().then((r) => setFeeds(r.subscriptions)).catch(() => setFeeds([]));
    api.getUpdateStatus().then(setUpdate).catch(() => setUpdate({ enabled: false }));
  }, []);

  const custom = views.filter((v) => v.kind === "custom" && !v.archived);
  const customizedSystem = views.filter((v) => v.kind === "system" && v.customized).map((v) => v.name);
  const failing = (feeds ?? []).filter((f) => f.last_error).length;

  const status: Record<string, string | null> = {
    appearance: `${theme === "dark" ? "Dark" : "Light"} theme`,
    views: viewsLoaded
      ? `${plural(custom.length, "custom view")}${customizedSystem.length ? ` · ${customizedSystem.join(" and ")} customized` : ""}`
      : null,
    courses: catalogLoaded ? plural(courses.filter((c) => !c.archived).length, "course") : null,
    categories: catalogLoaded
      ? (() => {
          const n = categories.filter((c) => !c.archived).length;
          return `${n} ${n === 1 ? "category" : "categories"}`;
        })()
      : null,
    calendars: feeds === null ? null : feeds.length === 0 ? "No calendars yet" : `${plural(feeds.length, "calendar")}${failing ? ` · ${failing} failing` : ""}`,
    integrations: "MCP server on port 8001",
    system: update === null ? null : !update.enabled ? "Updates not set up" : update.update_available ? "Update available" : "Up to date",
  };

  return (
    <div className="space-y-6">
      {SETTINGS_GROUPS.map((group) => (
        <section key={group.label} aria-label={group.label} className="space-y-2">
          <h2 className="px-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint">{group.label}</h2>
          <ul className={`divide-y divide-line ${CARD}`}>
            {group.sections.map((s) => {
              const SectionIcon = s.icon;
              const line = status[s.slug];
              return (
                <li key={s.slug}>
                  <Link href={`/settings/${s.slug}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                      <SectionIcon weight="bold" className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-fg">{s.title}</span>
                      <span className="block truncate text-xs text-fg-muted">
                        {line ?? <span className="shimmer inline-block h-3 w-28 rounded align-middle" />}
                      </span>
                    </span>
                    <CaretRightIcon className="h-4 w-4 shrink-0 text-fg-faint" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
