"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDotsIcon,
  CheckCircleIcon,
  CheckIcon,
  GearSixIcon,
  ListChecksIcon,
  ListIcon,
  SignOutIcon,
  SunHorizonIcon,
  SunIcon,
  TrayIcon,
  XIcon,
  type Icon,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { notifyTasksChanged } from "@/lib/events";
import { useNavCounts, type NavCounts } from "@/lib/useNavCounts";
import { ICON_BUTTON } from "@/lib/ui";
import QuickAddBar from "./QuickAddBar";
import ThemeToggle from "./ThemeToggle";
import Toaster from "./Toaster";

const NAV: { href: string; label: string; icon: Icon; count?: keyof NavCounts }[] = [
  { href: "/today", label: "Today", icon: SunIcon, count: "today" },
  { href: "/inbox", label: "Inbox", icon: TrayIcon, count: "inbox" },
  { href: "/tasks", label: "All Tasks", icon: ListChecksIcon },
  { href: "/upcoming", label: "Upcoming", icon: SunHorizonIcon },
  { href: "/calendar", label: "Calendar", icon: CalendarDotsIcon },
  { href: "/completed", label: "Completed", icon: CheckCircleIcon },
];

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg">
        <CheckIcon weight="bold" className="h-4 w-4" aria-hidden />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-fg">Tasks</span>
    </div>
  );
}

function Sidebar({
  pathname,
  counts,
  onNavigate,
  onLogout,
}: {
  pathname: string | null;
  counts: NavCounts | null;
  onNavigate?: () => void;
  onLogout: () => void;
}) {
  const settingsActive = pathname?.startsWith("/settings");

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <BrandMark />
      </div>

      <nav aria-label="Main" className="flex-1 space-y-0.5 px-2.5 pt-2">
        {NAV.map((item) => {
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
              className={`group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors duration-150 ${
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
              <span className="flex-1">{item.label}</span>
              {count > 0 && (
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
        })}
      </nav>

      <div className="space-y-0.5 px-2.5 pb-3">
        <Link
          href="/settings"
          onClick={onNavigate}
          aria-current={settingsActive ? "page" : undefined}
          className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors duration-150 ${
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
          Settings
        </Link>
        <div className="mt-2 flex items-center justify-between border-t border-line px-1 pt-3">
          <button
            onClick={onLogout}
            className="inline-flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] text-fg-faint transition-colors hover:bg-danger-soft hover:text-danger"
          >
            <SignOutIcon className="h-4 w-4" aria-hidden />
            Log out
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
  const counts = useNavCounts(!isLogin);
  const [drawerOpen, setDrawerOpen] = useState(false);

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
    (pathname?.startsWith("/settings") ? "Settings" : "Tasks");

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:elev-3"
      >
        Skip to content
      </a>

      <aside className="hidden w-60 shrink-0 md:block">
        <Sidebar pathname={pathname} counts={counts} onLogout={handleLogout} />
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

          <header className="shrink-0 border-b border-line px-4 py-3 sm:px-8">
            <div className="mx-auto w-full max-w-3xl">
              <QuickAddBar onCreated={() => notifyTasksChanged()} />
            </div>
          </header>

          <main
            id="main"
            tabIndex={-1}
            className="scroll-area min-h-0 flex-1 overflow-y-auto px-4 [scrollbar-gutter:stable_both-edges] focus:outline-none sm:px-8"
          >
            <div className="mx-auto w-full max-w-3xl pb-24 pt-8 sm:pt-10">{children}</div>
          </main>
        </div>
      </div>

      <Toaster />
    </div>
  );
}
