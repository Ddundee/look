"use client";

import { useEffect, useState } from "react";
import { PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { fmtGrams, fmtKcal } from "@/lib/nutrition";
import { toast, toastError } from "@/lib/toast";
import type { DaySummary, FoodEntry } from "@/lib/types";
import { ICON_BUTTON } from "@/lib/ui";

export default function FoodRow({
  entry,
  index,
  onEdit,
  onDeleted,
}: {
  entry: FoodEntry;
  index: number;
  onEdit: (entry: FoodEntry) => void;
  onDeleted: (day: DaySummary) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // Same two-click delete as task rows; the armed state quietly expires.
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(id);
  }, [confirming]);

  async function remove() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      const res = await api.deleteFoodEntry(entry.id);
      toast(`Deleted "${entry.name}"`, "info");
      onDeleted(res.day);
    } catch (err) {
      toastError(err, "Couldn't delete the entry");
      setBusy(false);
    }
  }

  const macroLabel = `Protein ${Math.round(entry.protein_g)} grams, carbs ${Math.round(
    entry.carbs_g
  )} grams, fat ${Math.round(entry.fat_g)} grams`;

  return (
    <li
      style={{ "--i": index } as React.CSSProperties}
      className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-surface-2/70 focus-within:bg-surface-2/70"
    >
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onEdit(entry)}
          className="block max-w-full text-left text-sm leading-5 text-fg [overflow-wrap:anywhere] hover:underline hover:decoration-line-strong hover:underline-offset-4"
        >
          {entry.name}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-fg-muted">
          {entry.quantity && <span>{entry.quantity}</span>}
          <span className="font-mono tabular-nums">
            <span className="sr-only">{macroLabel}</span>
            <span aria-hidden>
              P {fmtGrams(entry.protein_g)} <span className="text-fg-faint">/</span> C {fmtGrams(entry.carbs_g)}{" "}
              <span className="text-fg-faint">/</span> F {fmtGrams(entry.fat_g)}
            </span>
          </span>
        </div>
      </div>
      <span className="shrink-0 font-mono text-sm tabular-nums text-fg">
        {fmtKcal(entry.calories)}
        <span className="ml-0.5 text-xs text-fg-faint">kcal</span>
      </span>
      <div className="-my-1 flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
        <button onClick={() => onEdit(entry)} aria-label={`Edit ${entry.name}`} title="Edit" className={ICON_BUTTON}>
          <PencilSimpleIcon className="h-4 w-4" aria-hidden />
        </button>
        <button
          onClick={remove}
          disabled={busy}
          aria-label={confirming ? `Confirm delete ${entry.name}` : `Delete ${entry.name}`}
          title={confirming ? "Click again to delete" : "Delete"}
          className={
            confirming
              ? "inline-flex h-8 items-center gap-1 rounded-lg bg-danger px-2 text-xs font-medium text-surface"
              : `${ICON_BUTTON} hover:bg-danger-soft hover:text-danger`
          }
        >
          <TrashIcon className="h-4 w-4" aria-hidden />
          {confirming && "Delete?"}
        </button>
      </div>
    </li>
  );
}
