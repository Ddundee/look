"use client";

import { useSyncExternalStore } from "react";
import { CheckCircleIcon, InfoIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { dismissToast, getServerToasts, getToasts, subscribeToasts } from "@/lib/toast";

const ICONS = {
  success: <CheckCircleIcon weight="fill" className="h-4 w-4 shrink-0 text-sea" aria-hidden />,
  error: <WarningCircleIcon weight="fill" className="h-4 w-4 shrink-0 text-danger" aria-hidden />,
  info: <InfoIcon weight="fill" className="h-4 w-4 shrink-0 text-fg-faint" aria-hidden />,
};

export default function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getServerToasts);

  return (
    <div
      aria-live="polite"
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4 sm:bottom-6"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="anim-pop pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-xl bg-surface py-2.5 pl-3.5 pr-2 text-sm text-fg elev-3"
        >
          {ICONS[t.kind]}
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t.message}</span>
          <button
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss notification"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-fg-faint hover:bg-surface-2 hover:text-fg"
          >
            <XIcon className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
