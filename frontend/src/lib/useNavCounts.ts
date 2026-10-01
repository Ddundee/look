"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import { onTasksChanged } from "./events";
import { isTaskDone } from "./types";

export interface NavCounts {
  today: number;
  overdue: number;
  inbox: number;
}

/** Live badge counts for the sidebar, refreshed whenever any task changes. */
export function useNavCounts(enabled: boolean): NavCounts | null {
  const [counts, setCounts] = useState<NavCounts | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    function load() {
      Promise.all([api.getToday(), api.listTasks({ status: "inbox" })])
        .then(([today, inbox]) => {
          if (cancelled) return;
          const open = new Set<string>();
          for (const t of [...today.overdue, ...today.scheduled, ...today.due_today]) {
            if (!isTaskDone(t)) open.add(t.id);
          }
          setCounts({
            today: open.size,
            overdue: today.overdue.filter((t) => !isTaskDone(t)).length,
            inbox: inbox.count,
          });
        })
        .catch(() => {
          // Counts are decorative; a failed fetch just leaves the old ones.
        });
    }

    load();
    const unsubscribe = onTasksChanged(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled]);

  return counts;
}
