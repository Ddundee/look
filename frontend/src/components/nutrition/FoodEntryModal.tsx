"use client";

import { useId, useState } from "react";
import { CircleNotchIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { todayIso } from "@/lib/format";
import { guessMeal, MEAL_LABEL, MEALS } from "@/lib/nutrition";
import { toast } from "@/lib/toast";
import type { DaySummary, FoodEntry, FoodEntryPayload, MealType } from "@/lib/types";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD as FIELD_BASE, LABEL } from "@/lib/ui";
import Dialog from "../Dialog";

const FIELD = `mt-1.5 h-10 w-full ${FIELD_BASE}`;

function num(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

export default function FoodEntryModal({
  entry,
  defaultDate,
  onClose,
  onSaved,
}: {
  entry: FoodEntry | null;
  defaultDate: string;
  onClose: () => void;
  onSaved: (day: DaySummary) => void;
}) {
  const [name, setName] = useState(entry?.name ?? "");
  const [quantity, setQuantity] = useState(entry?.quantity ?? "");
  const [meal, setMeal] = useState<MealType | null>(
    entry ? entry.meal : defaultDate === todayIso() ? guessMeal() : null
  );
  const [calories, setCalories] = useState(entry ? String(entry.calories) : "");
  const [protein, setProtein] = useState(entry ? String(entry.protein_g) : "");
  const [carbs, setCarbs] = useState(entry ? String(entry.carbs_g) : "");
  const [fat, setFat] = useState(entry ? String(entry.fat_g) : "");
  const [eatenOn, setEatenOn] = useState(entry?.eaten_on ?? defaultDate);
  const [eatenAt, setEatenAt] = useState(entry?.eaten_at?.slice(0, 5) ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the food a name.");
    if (calories.trim() === "" || num(calories) < 0) return setError("Enter calories (0 or more).");
    setSaving(true);
    setError(null);
    const payload: FoodEntryPayload = {
      name: name.trim(),
      quantity: quantity.trim() || null,
      meal,
      calories: num(calories),
      protein_g: num(protein),
      carbs_g: num(carbs),
      fat_g: num(fat),
      eaten_on: eatenOn || todayIso(),
      eaten_at: eatenAt || null,
      notes: notes.trim() || null,
    };
    try {
      const res = entry ? await api.updateFoodEntry(entry.id, payload) : await api.createFoodEntry(payload);
      toast(entry ? "Changes saved" : `Logged "${res.entry.name}"`);
      onSaved(res.day);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the entry");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={entry ? "Edit food" : "Add food"}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BUTTON_PRIMARY}>
            {saving && <CircleNotchIcon className="h-4 w-4 animate-spin" aria-hidden />}
            {saving ? "Saving" : entry ? "Save changes" : "Add food"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-[1fr_9rem]">
        <label className={`block ${LABEL}`}>
          Food
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Greek yogurt"
            aria-invalid={!!error && !name.trim()}
            aria-describedby={error ? errorId : undefined}
            className={FIELD}
          />
        </label>
        <label className={`block ${LABEL}`}>
          Amount
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="200 g" className={FIELD} />
        </label>
      </div>

      <fieldset>
        <legend className={LABEL}>Meal</legend>
        <div className="mt-1.5 grid grid-cols-4 gap-1 rounded-lg bg-surface-2 p-1">
          {MEALS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMeal(meal === m ? null : m)}
              aria-pressed={meal === m}
              className={`h-8 rounded-md text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 ${
                meal === m ? "bg-surface text-fg elev-1" : "text-fg-muted hover:text-fg"
              }`}
            >
              {MEAL_LABEL[m]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className={`block ${LABEL}`}>
          Calories
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            required
            value={calories}
            onChange={(e) => setCalories(e.target.value)}
            aria-invalid={!!error && calories === ""}
            aria-describedby={error ? errorId : undefined}
            className={FIELD}
          />
        </label>
        <label className={`block ${LABEL}`}>
          Protein (g)
          <input type="number" inputMode="decimal" min={0} step="any" value={protein} onChange={(e) => setProtein(e.target.value)} className={FIELD} />
        </label>
        <label className={`block ${LABEL}`}>
          Carbs (g)
          <input type="number" inputMode="decimal" min={0} step="any" value={carbs} onChange={(e) => setCarbs(e.target.value)} className={FIELD} />
        </label>
        <label className={`block ${LABEL}`}>
          Fat (g)
          <input type="number" inputMode="decimal" min={0} step="any" value={fat} onChange={(e) => setFat(e.target.value)} className={FIELD} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className={`block ${LABEL}`}>
          Date
          <input type="date" value={eatenOn} onChange={(e) => setEatenOn(e.target.value)} className={FIELD} />
        </label>
        <label className={`block ${LABEL}`}>
          Time
          <input type="time" value={eatenAt} onChange={(e) => setEatenAt(e.target.value)} className={FIELD} />
        </label>
      </div>

      <label className={`block ${LABEL}`}>
        Notes
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className={`mt-1.5 w-full py-2 leading-relaxed ${FIELD_BASE}`}
        />
      </label>

      {error && (
        <p id={errorId} role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <WarningCircleIcon weight="fill" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </Dialog>
  );
}
