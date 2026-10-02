"use client";

import { useState } from "react";
import { CircleNotchIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { LeetCodeGoals } from "@/lib/types";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD, LABEL } from "@/lib/ui";
import Dialog from "../Dialog";

const INPUT = `mt-1.5 h-10 w-full ${FIELD}`;

export default function GoalsModal({
  goals,
  onClose,
  onSaved,
}: {
  goals: LeetCodeGoals;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [daily, setDaily] = useState(String(goals.daily_target));
  const [weekly, setWeekly] = useState(String(goals.weekly_target));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const d = parseInt(daily, 10);
    const w = parseInt(weekly, 10);
    if (!(d >= 0 && w >= 0)) return setError("Enter whole numbers (0 or more).");
    setSaving(true);
    setError(null);
    try {
      await api.setLeetCodeGoals({ daily_target: d, weekly_target: w });
      toast("Goals updated");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save goals");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="LeetCode goals"
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
            {saving ? "Saving" : "Save goals"}
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-fg-muted">Problems solved, counting re-solves. The week starts on Monday.</p>
      <div className="grid grid-cols-2 gap-3">
        <label className={`block ${LABEL}`}>
          Per day
          <input autoFocus type="number" inputMode="numeric" min={0} value={daily} onChange={(e) => setDaily(e.target.value)} className={INPUT} />
        </label>
        <label className={`block ${LABEL}`}>
          Per week
          <input type="number" inputMode="numeric" min={0} value={weekly} onChange={(e) => setWeekly(e.target.value)} className={INPUT} />
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
