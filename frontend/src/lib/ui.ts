// Small set of shared class-name tokens so the same "card", "muted text",
// etc. look identical across every page without redefining them in each
// file. Kept as plain literal strings (not a template/generator) so
// Tailwind's static scanner can see and compile every class used. Colors
// come from the semantic tokens in globals.css, so none of these need a
// separate `dark:` variant.

export const CARD = "rounded-xl bg-surface elev-1";

export const CARD_LIST = "rounded-xl bg-surface elev-1 p-1";

export const SECTION_HEADING = "flex items-center gap-2 px-1 pb-2 text-[13px] font-medium text-fg-muted";

export const MUTED = "text-fg-muted";

export const FAINT = "text-fg-faint";

// No padding-y baked in — callers add py-1.5 (compact, filters) or py-2
// (roomier, forms) so two conflicting py-* utilities never land on the
// same element.
export const FIELD =
  "rounded-lg border border-line bg-surface px-3 text-sm text-fg placeholder:text-fg-faint transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft";

export const LABEL = "text-[13px] font-medium text-fg-muted";

export const BUTTON_PRIMARY =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition-[background-color,transform] duration-150 hover:bg-accent-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45";

export const BUTTON_SECONDARY =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium text-fg transition-[background-color,border-color,transform] duration-150 hover:border-line-strong hover:bg-surface-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45";

export const BUTTON_GHOST_SM =
  "inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-fg-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg disabled:opacity-45";

// Square icon-only button. Callers must pass aria-label.
export const ICON_BUTTON =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-faint transition-colors duration-150 hover:bg-surface-2 hover:text-fg disabled:opacity-45";

export const KBD =
  "inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1 font-mono text-[11px] text-fg-faint";

export const LINK = "font-medium text-accent-text underline decoration-accent/30 underline-offset-2 hover:decoration-accent";

export const INLINE_CODE = "rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em] text-fg";
