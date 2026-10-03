"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDotsIcon,
  CheckCircleIcon,
  CodeIcon,
  TreePalmIcon,
  ForkKnifeIcon,
  GearSixIcon,
  ListChecksIcon,
  ListIcon,
  SidebarSimpleIcon,
  SignOutIcon,
  SquaresFourIcon,
  SunIcon,
  XIcon,
  type Icon,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { useNavCounts, type NavCounts } from "@/lib/useNavCounts";
import type { LookView } from "@/lib/types";
import { readSidebarCollapsed, SIDEBAR_COLLAPSED_KEY, SIDEBAR_EVENT } from "@/lib/sidebar";
import { ICON_BUTTON } from "@/lib/ui";
import { navViews, useViews } from "@/lib/viewsStore";
import { viewIcon } from "./views/icons";
import ThemeToggle from "./ThemeToggle";
import Toaster from "./Toaster";
import UpdateChecker from "./UpdateChecker";

const NAV: { href: string; label: string; icon: Icon; count?: keyof NavCounts }[] = [
  { href: "/dashboard", label: "Dashboard", icon: SquaresFourIcon },
  { href: "/today", label: "Today", icon: SunIcon, count: "today" },
  { href: "/tasks", label: "All Tasks", icon: ListChecksIcon },
  { href: "/calendar", label: "Calendar", icon: CalendarDotsIcon },
  { href: "/nutrition", label: "Nutrition", icon: ForkKnifeIcon },
  { href: "/leetcode", label: "LeetCode", icon: CodeIcon },
  { href: "/completed", label: "Completed", icon: CheckCircleIcon },
];

const SHORTCUT_LABEL = "⌘S";

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg">
        <TreePalmIcon weight="fill" className="h-4 w-4" aria-hidden />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-fg">Look</span>
    </div>
  );
}

function Sidebar({
  pathname,
  counts,
  views,
  onNavigate,
  onLogout,
  collapsed = false,
  onToggleCollapsed,
}: {
  pathname: string | null;
  counts: NavCounts | null;
  views: LookView[];
  onNavigate?: () => void;
  onLogout: () => void;
  /** Icon-only rail (desktop). */
  collapsed?: boolean;
  /** Desktop only; the phone drawer has no collapse button. */
  onToggleCollapsed?: () => void;
}) {
  const settingsActive = pathname?.startsWith("/settings");
  const toggleLabel = `${collapsed ? "Expand" : "Collapse"} sidebar (${SHORTCUT_LABEL})`;

  const customViews = navViews(views);

  function renderItem(item: { href: string; label: string; icon: Icon; count?: keyof NavCounts }) {
          const active = pathname?.startsWith(item.href);
          const count = item.count && counts ? counts[item.count] : 0;
          const overdue = item.count === "today" && counts ? counts.overdue : 0;
          const ItemIcon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              className={`group relative flex h-9 items-center gap-2.5 rounded-lg text-sm transition-colors duration-150 ${
                collapsed ? "justify-center px-0" : "px-2.5"
              } ${
                active
                  ? "bg-surface font-medium text-fg elev-1"
                  : "text-fg-muted hover:bg-surface-2 hover:text-fg"
              }`}
            >
              <ItemIcon
                weight={active ? "fill" : "regular"}
                className={`h-[18px] w-[18px] shrink-0 ${active ? "text-accent" : "text-fg-faint group-hover:text-fg-muted"}`}
                aria-hidden
              />
              <span className={collapsed ? "sr-only" : "flex-1"}>{item.label}</span>
              {collapsed && count > 0 && (
                <span
                  className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${overdue > 0 ? "bg-danger" : "bg-fg-faint"}`}
                  aria-label={overdue > 0 ? `${count} open, ${overdue} overdue` : `${count} open`}
                />
              )}
              {!collapsed && count > 0 && (
                <span
                  className={`font-mono text-xs tabular-nums ${overdue > 0 ? "text-danger" : "text-fg-faint"}`}
                  aria-label={
                    overdue > 0 ? `${count} open, ${overdue} overdue` : `${count} open`
                  }
                >
                  {count}
                </span>
              )}
            </Link>
          );
  }

  return (
    <div className="flex h-full flex-col">
      <div className={`flex h-14 items-center ${collapsed ? "justify-center px-2" : "justify-between pl-4 pr-2.5"}`}>
        {!collapsed && <BrandMark />}
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            title={toggleLabel}
            className={ICON_BUTTON}
          >
            <SidebarSimpleIcon className="h-[18px] w-[18px]" aria-hidden />
          </button>
        )}
      </div>

      <nav
        aria-label="Main"
        className={`scroll-area min-h-0 flex-1 space-y-0.5 overflow-y-auto pt-2 ${collapsed ? "px-2" : "px-2.5"}`}
      >
        {NAV.slice(0, 2).map(renderItem)}
        {/* Views you made (Settings → Views & dashboards), between the
            built-in pages, which always stay where they are. */}
        {customViews.length > 0 && (
          <div role="group" aria-label="Views" className="py-1.5">
            {collapsed ? (
              <div className="mx-2 mb-1.5 border-t border-line" aria-hidden />
            ) : (
              <p className="px-2.5 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint">Views</p>
            )}
            <div className="space-y-0.5">
              {customViews.map((v) => renderItem({ href: `/views/${v.key}`, label: v.name, icon: viewIcon(v.icon) }))}
            </div>
          </div>
        )}
        {NAV.slice(2).map(renderItem)}
      </nav>

      <div className={`space-y-0.5 pb-3 ${collapsed ? "px-2" : "px-2.5"}`}>
        <Link
          href="/settings"
          onClick={onNavigate}
          aria-current={settingsActive ? "page" : undefined}
          title={collapsed ? "Settings" : undefined}
          className={`flex h-9 items-center gap-2.5 rounded-lg text-sm transition-colors duration-150 ${
            collapsed ? "justify-center px-0" : "px-2.5"
          } ${
            settingsActive
              ? "bg-surface font-medium text-fg elev-1"
              : "text-fg-muted hover:bg-surface-2 hover:text-fg"
          }`}
        >
          <GearSixIcon
            weight={settingsActive ? "fill" : "regular"}
            className={`h-[18px] w-[18px] ${settingsActive ? "text-accent" : "text-fg-faint"}`}
            aria-hidden
          />
          <span className={collapsed ? "sr-only" : undefined}>Settings</span>
        </Link>
        <div
          className={`mt-2 flex border-t border-line pt-3 ${
            collapsed ? "flex-col items-center gap-1" : "items-center justify-between px-1"
          }`}
        >
          <button
            onClick={onLogout}
            title={collapsed ? "Log out" : undefined}
            className="inline-flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] text-fg-faint transition-colors hover:bg-danger-soft hover:text-danger"
          >
            <SignOutIcon className="h-4 w-4" aria-hidden />
            <span className={collapsed ? "sr-only" : undefined}>Log out</span>
          </button>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/login";
  // Operational pages are app screens: wide, full height, panels scroll on
  // their own (see Page/Panel in PageParts). Settings is configuration and
  // reads as a document: a narrower column that scrolls as a whole.
  const isDocument = pathname?.startsWith("/settings") ?? false;
  const counts = useNavCounts(!isLogin);
  const { views } = useViews(!isLogin);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Desktop sidebar: full, or an icon rail that gives pages more width.
  // Remembered per browser; read after mount so server and client match.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a browser-only preference
    setCollapsed(readSidebarCollapsed());
    // Settings → Appearance changes it too.
    const onChange = (e: Event) => setCollapsed(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener(SIDEBAR_EVENT, onChange);
    return () => window.removeEventListener(SIDEBAR_EVENT, onChange);
  }, []);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, c ? "0" : "1");
      } catch {
        // not persisted; still toggles for this visit
      }
      return !c;
    });
  }, []);

  // Cmd+S / Ctrl+S toggles it (instead of the browser's "Save page").
  useEffect(() => {
    if (isLogin) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        toggleCollapsed();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isLogin, toggleCollapsed]);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  if (isLogin) {
    return (
      <>
        {children}
        <Toaster />
      </>
    );
  }

  async function handleLogout() {
    await api.logout().catch(() => {});
    router.push("/login");
  }

  const currentLabel =
    NAV.find((n) => pathname?.startsWith(n.href))?.label ??
    (pathname?.startsWith("/settings") ? "Settings" : "Look");

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:elev-3"
      >
        Skip to content
      </a>

      <aside
        className={`hidden shrink-0 transition-[width] duration-200 ease-out md:block ${collapsed ? "w-16" : "w-60"}`}
      >
        <Sidebar
          pathname={pathname}
          counts={counts}
          views={views}
          onLogout={handleLogout}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
        />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div
            className="anim-overlay absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="anim-drawer absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-canvas elev-3">
            <button
              onClick={() => setDrawerOpen(false)}
              aria-label="Close navigation"
              className={`absolute right-3 top-3 ${ICON_BUTTON}`}
            >
              <XIcon className="h-4 w-4" aria-hidden />
            </button>
            <Sidebar
              pathname={pathname}
              counts={counts}
              views={views}
              onNavigate={() => setDrawerOpen(false)}
              onLogout={handleLogout}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col md:py-2 md:pr-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface md:rounded-2xl md:elev-1">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3 md:hidden">
            <button onClick={() => setDrawerOpen(true)} aria-label="Open navigation" className={ICON_BUTTON}>
              <ListIcon className="h-5 w-5" aria-hidden />
            </button>
            <span className="text-sm font-semibold text-fg">{currentLabel}</span>
          </div>

          {/* The one page-level scroller. App pages fill it exactly on
              desktop (h-full + min-h-0 chain), so it only scrolls when a
              window is too short or on smaller screens. Their width tracks
              the space next to the sidebar (so collapsing it widens them),
              capped at 100rem so ultrawide screens don't stretch them thin. */}
          <main
            id="main"
            tabIndex={-1}
            className={`scroll-area min-h-0 flex-1 overflow-y-auto focus:outline-none ${
              isDocument ? "px-4 [scrollbar-gutter:stable_both-edges] sm:px-8" : "px-4 sm:px-6"
            }`}
          >
            <div
              className={
                isDocument
                  ? "mx-auto w-full max-w-5xl pb-16 pt-6 sm:pt-8"
                  : "mx-auto flex min-h-full w-full max-w-[100rem] flex-col py-4 sm:py-5 md:h-full"
              }
            >
              {children}
            </div>
          </main>
        </div>
      </div>

      <Toaster />
      <UpdateChecker />
    </div>
  );
}
