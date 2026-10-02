"use client";

// The current minute in the app's timezone, shared by every timeline: one
// timer for the whole page, ticking on the minute.
import { useSyncExternalStore } from "react";
import { api } from "./api";
import { msToNextMinute, zonedNow } from "./now";

let timeZone: string | null = null;
let now = "";
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function tick() {
  now = zonedNow(timeZone);
  listeners.forEach((l) => l());
  timer = setTimeout(tick, msToNextMinute());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    if (timeZone === null) {
      api
        .getVersion()
        .then((v) => {
          timeZone = v.timezone ?? "";
          now = zonedNow(timeZone);
          listeners.forEach((l) => l());
        })
        .catch(() => {});
    }
    now = zonedNow(timeZone);
    timer = setTimeout(tick, msToNextMinute());
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

/** "YYYY-MM-DDTHH:MM" now, in APP_TIMEZONE; "" during server rendering. */
export function useNow(): string {
  return useSyncExternalStore(subscribe, () => now, () => "");
}
