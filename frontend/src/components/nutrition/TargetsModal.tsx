"use client";

import { useState } from "react";
import { CircleNotchIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { toast } from "@/lib/toast";
import type { NutritionTargets } from "@/lib/types";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD, LABEL } from "@/lib/ui";
import Dialog from "../Dialog";

const INPUT = `mt-1.5 h-10 w-full ${FIELD}`;

function optional(value: string): number | null {
  if (value.trim() === "") return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export default function TargetsModal({
  current,
  onClose,
  onSaved,
}: {
  current: NutritionTargets | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [calories, setCalories] = useState(current ? String(current.calories) : "");
  const [protein, setProtein] = useState(current?.protein_g?.toString() ?? "");
  const [carbs, setCarbs] = useState(current?.carbs_g?.toString() ?? "");
  const [fat, setFat] = useState(current?.fat_g?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cal = optional(calories);
    if (cal === null || cal <= 0) return setError("Enter a calorie target above 0.");
    setSaving(true);
    setError(null);
    try {
      await api.setNutritionTargets({
        calories: cal,
        protein_g: optional(protein),
        carbs_g: optional(carbs),
        fat_g: optional(fat),
      });
      toast("Targets updated");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save targets");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="Daily targets"
      size="sm"
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BUTTON_PRIMARY}>
            {saving && <CircleNotchIcon className="h-4 w-4 animate-spin" aria-hidden />}
            {saving ? "Saving" : "Save targets"}
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-fg-muted">
        Applies from today. Earlier days keep the targets they had.
        {current && <> Current targets started {formatDate(current.effective_from)}.</>}
      </p>
      <label className={`block ${LABEL}`}>
        Calories
        <input
          autoFocus
          type="number"
          inputMode="decimal"
          min={1}
          step="any"
          required
          value={calories}
          onChange={(e) => setCalories(e.target.value)}
          className={INPUT}
        />
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className={`block ${LABEL}`}>
          Protein (g)
          <input type="number" inputMode="decimal" min={0} step="any" value={protein} onChange={(e) => setProtein(e.target.value)} placeholder="None" className={INPUT} />
        </label>
        <label className={`block ${LABEL}`}>
          Carbs (g)
          <input type="number" inputMode="decimal" min={0} step="any" value={carbs} onChange={(e) => setCarbs(e.target.value)} placeholder="None" className={INPUT} />
        </label>
        <label className={`block ${LABEL}`}>
          Fat (g)
          <input type="number" inputMode="decimal" min={0} step="any" value={fat} onChange={(e) => setFat(e.target.value)} placeholder="None" className={INPUT} />
        </label>
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <WarningCircleIcon weight="fill" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </Dialog>
  );
}
