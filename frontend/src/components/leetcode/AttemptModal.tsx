"use client";

import { useEffect, useId, useState } from "react";
import { CheckCircleIcon, CircleNotchIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import {
  COMMON_LANGUAGES,
  CONFIDENCE_LABEL,
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  DIFFICULTY_TEXT,
  rememberedLanguage,
  rememberLanguage,
} from "@/lib/leetcode";
import { toast } from "@/lib/toast";
import type { LeetCodeDifficulty, LeetCodeProblemSummary, LeetCodeStats } from "@/lib/types";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD as FIELD_BASE, LABEL } from "@/lib/ui";
import Dialog from "../Dialog";

const FIELD = `mt-1.5 h-10 w-full ${FIELD_BASE}`;

type Outcome = "solved" | "hint" | "unsolved";
const OUTCOMES: { key: Outcome; label: string }[] = [
  { key: "solved", label: "Solved" },
  { key: "hint", label: "Solved with hint" },
  { key: "unsolved", label: "Not solved" },
];

function segment(active: boolean): string {
  return `h-8 rounded-md px-2 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 ${
    active ? "bg-surface text-fg elev-1" : "text-fg-muted hover:text-fg"
  }`;
}

/** Log one attempt. Only the problem number and outcome are needed for a
 * problem that's already tracked; title and difficulty the first time. */
export default function AttemptModal({
  knownTopics,
  onClose,
  onLogged,
}: {
  knownTopics: string[];
  onClose: () => void;
  onLogged: (progress: LeetCodeStats) => void;
}) {
  const [number, setNumber] = useState("");
  const [existing, setExisting] = useState<LeetCodeProblemSummary | null>(null);
  const [lookedUp, setLookedUp] = useState<string>("");
  const [title, setTitle] = useState("");
  const [difficulty, setDifficulty] = useState<LeetCodeDifficulty>("medium");
  const [topics, setTopics] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("solved");
  const [minutes, setMinutes] = useState("");
  const [language, setLanguage] = useState(() => rememberedLanguage());
  const [confidence, setConfidence] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const topicListId = useId();

  // Look the number up as it's typed: a tracked problem needs no details.
  useEffect(() => {
    const n = number.trim();
    if (!/^\d+$/.test(n)) return;
    const id = setTimeout(() => {
      api
        .listLeetCodeProblems({ q: n })
        .then((r) => {
          setExisting(r.problems.find((p) => String(p.number) === n) ?? null);
          setLookedUp(n);
        })
        .catch(() => setLookedUp(n));
    }, 250);
    return () => clearTimeout(id);
  }, [number]);

  const typed = number.trim();
  const tracked = existing && String(existing.number) === typed ? existing : null;
  const isNew = /^\d+$/.test(typed) && lookedUp === typed && !tracked;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(typed, 10);
    if (!Number.isFinite(n) || n < 1) return setError("Enter the LeetCode problem number.");
    if (!tracked && !title.trim()) return setError("First time logging this problem: add its title.");
    setSaving(true);
    setError(null);
    try {
      const res = await api.logLeetCodeAttempt({
        problem_number: n,
        title: tracked ? null : title.trim(),
        difficulty: tracked ? null : difficulty,
        topics: topics.split(",").map((t) => t.trim()).filter(Boolean),
        solved: outcome !== "unsolved",
        hint_used: outcome === "hint",
        duration_minutes: minutes.trim() ? Math.max(0, parseInt(minutes, 10) || 0) : null,
        language: language.trim() || null,
        confidence,
        notes: notes.trim() || null,
      });
      rememberLanguage(language.trim());
      const p = res.progress;
      toast(
        `Logged #${n}. ${p.solved_today} of ${p.goals.daily_target} today${
          p.current_streak > 1 ? `, ${p.current_streak}-day streak` : ""
        }.`
      );
      onLogged(p);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't log the attempt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="Log a LeetCode attempt"
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BUTTON_PRIMARY}>
            {saving && <CircleNotchIcon className="h-4 w-4 animate-spin" aria-hidden />}
            {saving ? "Saving" : "Log attempt"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-[7rem_1fr] gap-3">
        <label className={`block ${LABEL}`}>
          Problem #
          <input
            autoFocus
            inputMode="numeric"
            value={number}
            onChange={(e) => setNumber(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="560"
            aria-describedby={error ? errorId : undefined}
            className={`${FIELD} font-mono`}
          />
        </label>
        {tracked ? (
          <div className="mt-6 min-w-0 rounded-lg bg-surface-2 px-3 py-2 text-sm" aria-live="polite">
            <span className="flex items-center gap-1.5 text-fg">
              <CheckCircleIcon weight="fill" className="h-4 w-4 shrink-0 text-accent" aria-hidden />
              <span className="truncate">{tracked.title}</span>
            </span>
            <span className="mt-0.5 block text-xs text-fg-muted">
              <span className={DIFFICULTY_TEXT[tracked.difficulty]}>{DIFFICULTY_LABEL[tracked.difficulty]}</span>
              {` · ${tracked.attempts} earlier attempt${tracked.attempts === 1 ? "" : "s"}`}
            </span>
          </div>
        ) : (
          <label className={`block ${LABEL}`}>
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={isNew ? "New problem: its title" : "Subarray Sum Equals K"}
              className={FIELD}
            />
          </label>
        )}
      </div>

      {!tracked && (
        <fieldset>
          <legend className={LABEL}>Difficulty</legend>
          <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1">
            {DIFFICULTIES.map((d) => (
              <button key={d} type="button" aria-pressed={difficulty === d} onClick={() => setDifficulty(d)} className={segment(difficulty === d)}>
                <span className={difficulty === d ? DIFFICULTY_TEXT[d] : ""}>{DIFFICULTY_LABEL[d]}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset>
        <legend className={LABEL}>Outcome</legend>
        <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1">
          {OUTCOMES.map((o) => (
            <button key={o.key} type="button" aria-pressed={outcome === o.key} onClick={() => setOutcome(o.key)} className={segment(outcome === o.key)}>
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <label className={`block ${LABEL}`}>
          Time (minutes)
          <input type="number" inputMode="numeric" min={0} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="Optional" className={FIELD} />
        </label>
        <label className={`block ${LABEL}`}>
          Language
          <input list="leetcode-languages" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="Optional" className={FIELD} />
          <datalist id="leetcode-languages">
            {COMMON_LANGUAGES.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </label>
      </div>

      <fieldset>
        <legend className={LABEL}>
          Confidence{" "}
          <span className="font-normal text-fg-faint">{confidence ? `${confidence}/5, ${CONFIDENCE_LABEL[confidence].toLowerCase()}` : "(optional)"}</span>
        </legend>
        <div className="mt-1.5 grid grid-cols-5 gap-1 rounded-lg bg-surface-2 p-1">
          {[1, 2, 3, 4, 5].map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={confidence === c}
              aria-label={`Confidence ${c} of 5, ${CONFIDENCE_LABEL[c]}`}
              onClick={() => setConfidence(confidence === c ? null : c)}
              className={`${segment(confidence === c)} font-mono`}
            >
              {c}
            </button>
          ))}
        </div>
      </fieldset>

      <label className={`block ${LABEL}`}>
        {tracked ? "Add topics" : "Topics"}
        <input
          list={topicListId}
          value={topics}
          onChange={(e) => setTopics(e.target.value)}
          placeholder={tracked?.topics.length ? `Has: ${tracked.topics.join(", ")}` : "Comma separated, e.g. Prefix Sum, Hash Table"}
          className={FIELD}
        />
        <datalist id={topicListId}>
          {knownTopics.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </label>

      <label className={`block ${LABEL}`}>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="What tripped you up, the key idea…" className={`mt-1.5 w-full py-2 leading-relaxed ${FIELD_BASE}`} />
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
