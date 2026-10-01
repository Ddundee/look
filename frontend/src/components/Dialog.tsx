"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "@phosphor-icons/react";
import { ICON_BUTTON, KBD } from "@/lib/ui";

interface Props {
  title: string;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  footer: React.ReactNode;
  children: React.ReactNode;
  size?: "md" | "sm";
  /** Show the "⌘ ↵ to save" hint (off for dialogs that only offer choices). */
  hint?: boolean;
}

/** Modal form shell: portal, Escape to close, Tab trapped inside, focus
 * restored on close, background scroll locked, Cmd/Ctrl+Enter submits,
 * bottom sheet on phones. */
export default function Dialog({ title, onClose, onSubmit, footer, children, size = "md", hint = true }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  // Callers pass an inline arrow, so read it through a ref; otherwise the
  // effect below would re-run (and bounce focus) on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Captured during the first render: by the time effects run, autoFocus
  // inside the dialog has already moved focus away from the opener.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    const form = formRef.current;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !formRef.current) return;
      const focusable = formRef.current.querySelectorAll<HTMLElement>(
        "input, select, textarea, button:not(:disabled), [href]"
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // Dev Strict Mode runs this cleanup once while the dialog stays
      // mounted; only hand focus back once the form is really gone.
      setTimeout(() => {
        if (!form?.isConnected) opener?.focus?.();
      });
    };
  }, [opener]);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="anim-overlay absolute inset-0 bg-black/35 backdrop-blur-[2px] dark:bg-black/60"
        onClick={onClose}
      />
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={onSubmit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) formRef.current?.requestSubmit();
        }}
        className={`anim-pop relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-surface elev-3 sm:rounded-2xl ${
          size === "sm" ? "max-w-sm" : "max-w-lg"
        }`}
      >
        <div className="flex items-center justify-between px-5 pb-1 pt-4">
          <h2 id={titleId} className="text-sm font-semibold text-fg">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={ICON_BUTTON}>
            <XIcon className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="scroll-area space-y-4 overflow-y-auto px-5 pb-5 pt-2">{children}</div>
        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          {hint && (
            <span className="hidden items-center gap-1 text-xs text-fg-faint sm:inline-flex">
              <kbd className={KBD}>⌘</kbd>
              <kbd className={KBD}>↵</kbd>
              to save
            </span>
          )}
          <div className="ml-auto flex flex-wrap justify-end gap-2">{footer}</div>
        </div>
      </form>
    </div>,
    document.body
  );
}
