import type { LeetCodeDifficulty } from "./types";

export const DIFFICULTIES: LeetCodeDifficulty[] = ["easy", "medium", "hard"];

export const DIFFICULTY_LABEL: Record<LeetCodeDifficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

// Text color for the difficulty name. Always shown with the word, never
// color alone. Spelled out in full for Tailwind's static scanner.
export const DIFFICULTY_TEXT: Record<LeetCodeDifficulty, string> = {
  easy: "text-emerald-600 dark:text-emerald-400",
  medium: "text-amber-600 dark:text-amber-400",
  hard: "text-rose-600 dark:text-rose-400",
};

export const CONFIDENCE_LABEL: Record<number, string> = {
  1: "Very weak",
  2: "Weak",
  3: "Okay",
  4: "Strong",
  5: "Very strong",
};

export const COMMON_LANGUAGES = ["Python", "Java", "C++", "JavaScript", "TypeScript", "Go", "C#", "Kotlin", "Rust"];

export function pct(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? "-" : `${Math.round(rate * 100)}%`;
}

const LAST_LANGUAGE_KEY = "look-leetcode-language";

export function rememberedLanguage(): string {
  try {
    return localStorage.getItem(LAST_LANGUAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberLanguage(language: string): void {
  try {
    if (language) localStorage.setItem(LAST_LANGUAGE_KEY, language);
  } catch {
    // storage blocked: the field just won't prefill
  }
}
