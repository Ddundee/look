"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CaretLeftIcon } from "@phosphor-icons/react";
import { PageHeader } from "@/components/PageParts";
import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from "@/components/settings/sections";

/** Settings: a small sidebar of sections on desktop; on phones the
 * overview is the list and each section has a way back. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/settings";
  const slug = pathname.split("/")[2] ?? "";
  const section = SETTINGS_SECTIONS.find((s) => s.slug === slug);

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Settings" className="hidden lg:block">
          <div className="sticky top-0 space-y-5">
            {SETTINGS_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-faint">{group.label}</p>
                <ul className="space-y-0.5">
                  {group.sections.map((s) => {
                    const active = s.slug === slug;
                    const SectionIcon = s.icon;
                    return (
                      <li key={s.slug}>
                        <Link
                          href={`/settings/${s.slug}`}
                          aria-current={active ? "page" : undefined}
                          className={`flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] transition-colors ${
                            active ? "bg-surface font-medium text-fg elev-1" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                          }`}
                        >
                          <SectionIcon weight={active ? "fill" : "regular"} className={`h-4 w-4 ${active ? "text-accent" : "text-fg-faint"}`} aria-hidden />
                          {s.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>
        <div className="min-w-0 space-y-4">
          {section && (
            <Link href="/settings" className="inline-flex items-center gap-1 text-[13px] font-medium text-fg-muted hover:text-fg lg:hidden">
              <CaretLeftIcon className="h-3.5 w-3.5" aria-hidden />
              Settings
            </Link>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
