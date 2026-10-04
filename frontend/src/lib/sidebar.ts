"use client";

// The desktop sidebar's collapsed state: remembered per browser, toggled by
// the sidebar button, ⌘S, or Settings → Appearance.
export const SIDEBAR_COLLAPSED_KEY = "look-sidebar-collapsed";
export const SIDEBAR_EVENT = "look:sidebar-collapsed";

export function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // not persisted; still applies for this visit
  }
  window.dispatchEvent(new CustomEvent(SIDEBAR_EVENT, { detail: collapsed }));
}
