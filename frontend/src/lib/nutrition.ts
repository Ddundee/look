import type { FoodEntry, MacroKey, MealType } from "./types";

export const MEALS: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

export const MEAL_LABEL: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export const MACROS: Exclude<MacroKey, "calories">[] = ["protein_g", "carbs_g", "fat_g"];

export const MACRO_LABEL: Record<MacroKey, string> = {
  calories: "Calories",
  protein_g: "Protein",
  carbs_g: "Carbs",
  fat_g: "Fat",
};

const INT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function fmtKcal(n: number): string {
  return INT.format(Math.round(n));
}

export function fmtGrams(n: number): string {
  return `${INT.format(Math.round(n))}g`;
}

/** Sensible default meal for a new entry logged now. */
export function guessMeal(now: Date = new Date()): MealType {
  const h = now.getHours();
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

export interface MealGroup {
  key: MealType | "other";
  label: string;
  entries: FoodEntry[];
  calories: number;
}

/** Entries arrive in meal order from the API; group them, dropping empty groups. */
export function groupByMeal(entries: FoodEntry[]): MealGroup[] {
  const groups: MealGroup[] = [...MEALS, "other" as const].map((key) => ({
    key,
    label: key === "other" ? "Other" : MEAL_LABEL[key],
    entries: [],
    calories: 0,
  }));
  for (const e of entries) {
    const g = groups.find((x) => x.key === (e.meal ?? "other"))!;
    g.entries.push(e);
    g.calories += e.calories;
  }
  return groups.filter((g) => g.entries.length > 0);
}
