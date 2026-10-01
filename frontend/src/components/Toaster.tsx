"use client";

import { useSyncExternalStore } from "react";
import { Toaster as Sonner } from "sonner";
import { CheckCircleIcon, CircleNotchIcon, InfoIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { getServerThemeSnapshot, getThemeSnapshot, subscribeTheme } from "@/lib/theme";

/** Sonner host, themed with the app's tokens and following the manual
 * light/dark toggle rather than only the OS preference. */
export default function Toaster() {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);

  return (
    <Sonner
      theme={theme}
      position="bottom-center"
      visibleToasts={3}
      gap={8}
      closeButton
      icons={{
        success: <CheckCircleIcon weight="fill" className="h-4 w-4 text-accent" aria-hidden />,
        error: <WarningCircleIcon weight="fill" className="h-4 w-4 text-danger" aria-hidden />,
        info: <InfoIcon weight="fill" className="h-4 w-4 text-fg-faint" aria-hidden />,
        loading: <CircleNotchIcon className="h-4 w-4 animate-spin text-accent" aria-hidden />,
      }}
      style={
        {
          "--normal-bg": "var(--surface)",
          "--normal-border": "var(--line)",
          "--normal-text": "var(--fg)",
          "--border-radius": "12px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "font-sans elev-3",
          description: "text-fg-muted!",
          actionButton: "bg-accent! text-accent-fg! font-medium!",
          cancelButton: "bg-surface-2! text-fg!",
        },
      }}
    />
  );
}
