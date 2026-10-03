"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { MoonIcon, PaintBrushIcon, SunIcon } from "@phosphor-icons/react";
import { readSidebarCollapsed, setSidebarCollapsed } from "@/lib/sidebar";
import { getServerThemeSnapshot, getThemeSnapshot, setTheme, subscribeTheme } from "@/lib/theme";
import { CARD } from "@/lib/ui";
import SectionHeader from "./SectionHeader";

/** Settings → Appearance: theme and sidebar. Course and category colors
 * are under Courses and Categories. */
export default function AppearanceSettings() {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a browser-only preference
    setCollapsed(readSidebarCollapsed());
  }, []);

  return (
    <div className="space-y-4">
      <SectionHeader icon={PaintBrushIcon} title="Appearance" summary="How Look looks on this device." />
      <div className={`divide-y divide-line ${CARD}`}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-fg">Theme</p>
            <p className="text-xs text-fg-muted">Also in the sidebar, next to Log out.</p>
          </div>
          <div role="radiogroup" aria-label="Theme" className="flex gap-1 rounded-lg bg-surface-2 p-1">
            {(["light", "dark"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={theme === t}
                onClick={() => setTheme(t)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors ${
                  theme === t ? "bg-surface text-fg elev-1" : "text-fg-muted hover:text-fg"
                }`}
              >
                {t === "light" ? <SunIcon className="h-4 w-4" aria-hidden /> : <MoonIcon className="h-4 w-4" aria-hidden />}
                {t === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-fg">Collapsed sidebar</p>
            <p className="text-xs text-fg-muted">Icons only, more room for pages. Toggle anytime with ⌘S.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={collapsed}
            aria-label="Collapsed sidebar"
            onClick={() => {
              setCollapsed(!collapsed);
              setSidebarCollapsed(!collapsed);
            }}
            className={`relative h-5 w-8 shrink-0 rounded-full transition-colors duration-150 ${collapsed ? "bg-accent" : "bg-line-strong"}`}
          >
            <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-surface shadow-sm transition-transform duration-150 ${collapsed ? "translate-x-3" : ""}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
