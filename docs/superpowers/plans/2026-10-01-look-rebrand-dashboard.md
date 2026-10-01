# Look Rebrand, Theme and Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the app to Look, re-theme it from the album cover (day/night), and add a `/dashboard` home page combining schedule, tasks and nutrition.

**Architecture:** Theme = new values for the existing semantic tokens in `globals.css` plus new `sea`, `sand` and `cover-*` tokens; components change only where they hard-code a status color. Dashboard = one client page composing existing API calls and components, each card loading independently, plus a `CoverBand` component painted like the cover. Routing sends `/`, login and logged-in `/login` to `/dashboard`.

**Tech Stack:** Next.js 16 client components, Tailwind v4 `@theme inline` tokens, `@phosphor-icons/react` (`TreePalmIcon`, `SquaresFourIcon`).

**Spec:** `docs/superpowers/specs/2026-10-01-look-rebrand-dashboard-design.md`

**Code blocks:** `<!-- file: PATH -->` = create/replace the whole file (PATH from repo root). Other edits are described as exact replacements.

## Global Constraints

- Every text/background token pair passes WCAG AA (4.5:1 normal text, 3:1 for UI marks) in both themes; checked by the contrast script in Task 1.
- Mustard (`sand`) is a fill color only; warning text uses `warn`, a darker ochre in light mode.
- MCP server name and API unchanged. No backend changes.
- Phosphor icons only; no hand-drawn SVG; no em-dashes in visible copy.
- Both themes and phone width (no horizontal scroll) on every page.

## Review Focus

1. **Warning/over-target text on cream** must stay readable (the obvious mustard fails at ~2:1). Pinned by the Task 1 contrast script pair `warn on surface`.
2. **Cream text on the cover band's gradient** at the summary line's height must pass 4.5:1. Pinned by the Task 2 band contrast check (samples the rendered pixel colors behind each text line).
3. **Logged-in user hitting `/login` or `/`** must land on `/dashboard`, not Today. Pinned in Task 2 browser check.
4. **One failing dashboard endpoint** must not blank the page. Pinned in Task 2 by forcing one request to fail in the browser and checking the other cards render.
5. **Task actions inside the dashboard** (check off, plan, edit) must work and refresh the cards. Pinned in Task 2 browser check.

---

### Task 1: Tokens, brand, status colors

**Files:** `frontend/src/app/globals.css`, `frontend/src/app/layout.tsx`, `frontend/src/components/AppShell.tsx`, `frontend/src/app/login/page.tsx`, `frontend/src/components/Toaster.tsx`, `frontend/src/components/TaskRow.tsx`, `frontend/src/components/nutrition/MacroSummary.tsx`, `frontend/src/components/nutrition/WeekChart.tsx`, `frontend/src/lib/format.ts`, `frontend/src/lib/calendarEvents.ts`, `README.md`

**Interfaces — Produces:** Tailwind color utilities `sea`, `sea-soft`, `sand`, `cover-sky-top`, `cover-sky-mid`, `cover-horizon`, `cover-sea`, `cover-line`, `cover-sand`, `cover-ink`, `cover-cream` (via `@theme inline`).

- [ ] **Step 1: Contrast check first (expected to FAIL on the new pairs before the tokens change).** Save as the scratch file `contrast_check.js` and run it in the browser with the javascript tool on `/dashboard` or any page. It reads the live CSS variables in both themes:

```js
(() => {
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const rgb = (col) => { c.clearRect(0, 0, 1, 1); c.fillStyle = "#000"; c.fillStyle = col; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lum = (col) => rgb(col).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const pairs = [
    ["--fg", "--surface", 4.5], ["--fg", "--canvas", 4.5], ["--fg-muted", "--surface", 4.5], ["--fg-faint", "--surface", 4.5],
    ["--fg-faint", "--canvas", 4.5], ["--accent-fg", "--accent", 4.5], ["--accent-text", "--surface", 4.5],
    ["--warn", "--surface", 4.5], ["--danger", "--surface", 4.5], ["--surface", "--danger", 4.5],
    ["--sea", "--surface", 3], ["--surface", "--sea", 4.5], ["--sand", "--surface", 1.5], ["--line-strong", "--surface", 1.3],
  ];
  const out = {};
  for (const dark of [false, true]) {
    document.documentElement.classList.toggle("dark", dark);
    for (const [fg, bg, min] of pairs) {
      const r = cr(v(fg), v(bg));
      out[`${dark ? "dark" : "light"} ${fg} on ${bg}`] = `${r.toFixed(2)}${r >= min ? "" : "  FAIL<" + min}`;
    }
  }
  document.documentElement.classList.toggle("dark", localStorage.getItem("theme") === "dark");
  return out;
})()
```

Run it against the current (cobalt) tokens: `--sea`/`--sand` don't exist yet, so those rows FAIL. That is the RED.

- [ ] **Step 2: Tokens.** In `globals.css`:

In the `@theme inline` block, after `--color-warn-soft: var(--warn-soft);` add:

```css
  --color-sea: var(--sea);
  --color-sea-soft: var(--sea-soft);
  --color-sand: var(--sand);

  --color-cover-sky-top: var(--cover-sky-top);
  --color-cover-sky-mid: var(--cover-sky-mid);
  --color-cover-horizon: var(--cover-horizon);
  --color-cover-sea: var(--cover-sea);
  --color-cover-line: var(--cover-line);
  --color-cover-sand: var(--cover-sand);
  --color-cover-ink: var(--cover-ink);
  --color-cover-cream: var(--cover-cream);
```

`@theme inline` inlines values into utilities and does not define `--color-*` variables at runtime, so the cover colors live as plain variables (the gradient and the band contrast check read them directly). Add, right after the closing `}` of the `@theme inline` block:

```css
/* The album cover itself: identical in both themes (it's artwork). */
:root {
  --cover-sky-top: #173170;
  --cover-sky-mid: #2b56a4;
  --cover-horizon: #8fb3de;
  --cover-sea: #1f6e7a;
  --cover-line: #f7f1e1;
  --cover-sand: #c99a2e;
  --cover-ink: #141414;
  --cover-cream: #fbf6ea;
}
```

Replace the whole `:root { ... }` and `:root.dark { ... }` blocks with:

```css
/* Day: the cover's cream paper frame, ink, ultramarine sky, teal sea and
   mustard sand. */
:root {
  color-scheme: light;
  --canvas: #f2ead5;
  --surface: #fbf6ea;
  --surface-2: #ede3ca;
  --line: #e0d4b6;
  --line-strong: #cbbd99;
  --fg: #1a1a1a;
  --fg-muted: #4f493d;
  --fg-faint: #6b6455;
  --accent: #1f3f8f;
  --accent-hover: #183273;
  --accent-fg: #fbf6ea;
  --accent-soft: rgb(31 63 143 / 0.1);
  --accent-text: #1f3f8f;
  --sea: #1f6e7a;
  --sea-soft: rgb(31 110 122 / 0.12);
  /* Mustard is a fill; text in the warning role uses the darker ochre. */
  --sand: #c99a2e;
  --warn: #85620f;
  --warn-soft: rgb(201 154 46 / 0.2);
  --danger: #a3352b;
  --danger-soft: rgb(163 53 43 / 0.1);
  --shadow-tint: 40 35% 22%;
}

/* Night: the same scene after dark, from the deep top of the sky. */
:root.dark {
  color-scheme: dark;
  --canvas: #0b1e3f;
  --surface: #12294f;
  --surface-2: #18325c;
  --line: #223d69;
  --line-strong: #2e4d80;
  --fg: #f2ead5;
  --fg-muted: #cbc2ac;
  --fg-faint: #a59d8a;
  --accent: #8db4e0;
  --accent-hover: #a7c6ea;
  --accent-fg: #0b1e3f;
  --accent-soft: rgb(141 180 224 / 0.16);
  --accent-text: #a9c7ea;
  --sea: #55b6c2;
  --sea-soft: rgb(85 182 194 / 0.16);
  --sand: #e0b54a;
  --warn: #e0b54a;
  --warn-soft: rgb(224 181 74 / 0.16);
  --danger: #ec8a78;
  --danger-soft: rgb(236 138 120 / 0.14);
  --shadow-tint: 0 0% 0%;
}
```

If a pair fails in Step 3, adjust only the lightness of the failing token (keep the hue) and record the value in the ledger.

- [ ] **Step 3: Status colors and brand.**
  - `layout.tsx`: `title: "Look"`, `description: "Tasks, schedule and food, in one place."`; theme-color light `#f2ead5`, dark `#0b1e3f`.
  - `AppShell.tsx`: import `TreePalmIcon`; in `BrandMark` replace `<CheckIcon weight="bold" className="h-4 w-4" aria-hidden />` with `<TreePalmIcon weight="fill" className="h-4 w-4" aria-hidden />` and the wordmark text `Tasks` with `Look`; the mobile fallback label `"Tasks"` becomes `"Look"`; remove the now-unused `CheckIcon` import if nothing else uses it.
  - `login/page.tsx`: same palm icon in the login mark (replacing `CheckIcon`), heading `Sign in to Look`, subtitle `Tasks, schedule and food, in one place.`
  - `Toaster.tsx`: success icon `text-accent` → `text-sea`.
  - `TaskRow.tsx`: done checkbox `"border-accent bg-accent text-accent-fg"` → `"border-sea bg-sea text-surface"`.
  - `MacroSummary.tsx` and `WeekChart.tsx`: over-target fills `bg-warn` → `bg-sand` (text stays `text-warn`); `WeekChart` hover `group-hover:brightness-110` stays.
  - `format.ts`: `LeetCode: "text-amber-500"` → `"text-orange-600 dark:text-orange-400"` (amber read as warning against sand).
  - `calendarEvents.ts`: `class: "text-amber-500"` → `"text-fuchsia-500"` (same reason).
  - `README.md`: first line `# Personal Task Manager` → `# Look` followed by a blank line and `A self-hosted personal task manager, schedule and food log.`

- [ ] **Step 4: Verify.** `cd frontend && npx tsc --noEmit && npx eslint src` → no output. Re-run the contrast script → no FAIL in either theme (GREEN). Screenshot Today in both themes.

- [ ] **Step 5: Commit** `git add -A frontend/src README.md && git commit -m "Rebrand to Look with the album-cover day/night theme"`

---

### Task 2: Dashboard

**Files:** create `frontend/src/components/dashboard/CoverBand.tsx`, `frontend/src/app/dashboard/page.tsx`; modify `frontend/src/components/AppShell.tsx` (nav), `frontend/src/app/page.tsx`, `frontend/src/proxy.ts`, `frontend/src/app/login/page.tsx` (redirect targets).

**Interfaces — Consumes:** `api.getToday`, `api.getSchedule`, `api.getNutritionDay`, `api.getNutritionHistory`, `api.getWeekSummary`; `AgendaList`, `EventEditor`/`EditorTarget`, `TaskList`, `ErrorState`, `TaskListSkeleton`, `MacroSummary`, `WeekChart`, `TargetsModal`; `onTasksChanged`, `onEventsChanged`. **Produces:** route `/dashboard`; `<CoverBand date: string | null; summary: string | null />`.

- [ ] **Step 1: Failing check.** `curl -s -o /dev/null -w "%{http_code}" -b <session cookie> http://localhost:3001/dashboard` → `404` (route missing). Simpler equivalent used: in the browser, navigate to `/dashboard` → Next.js 404 page. That is the RED.

- [ ] **Step 2: CoverBand**

<!-- file: frontend/src/components/dashboard/CoverBand.tsx -->
```tsx
"use client";

import { TreePalmIcon } from "@phosphor-icons/react";
import { formatDateLong } from "@/lib/format";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** The dashboard's header, painted like the album cover: a deep sky
 * fading to the horizon, a teal sea, a thin white line, mustard sand and
 * a palm rising from it. Text sits on the darkest part of the sky. The
 * greeting needs the client clock, so it only renders once `date` (from
 * the API) arrives, which also keeps server and client markup equal. */
export default function CoverBand({ date, summary }: { date: string | null; summary: string | null }) {
  return (
    <section aria-label="Overview" className="relative isolate overflow-hidden rounded-2xl elev-1">
      <div className="h-40 bg-[linear-gradient(to_bottom,var(--cover-sky-top)_0%,var(--cover-sky-mid)_58%,var(--cover-horizon)_100%)] sm:h-48">
        <div className="relative z-10 max-w-[68%] px-5 pt-5 sm:px-7 sm:pt-6">
          {date ? (
            <>
              <p className="text-[13px] font-medium text-cover-cream/80">{formatDateLong(date)}</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-cover-cream sm:text-3xl">{greeting()}</h1>
              {summary && <p className="mt-1.5 text-sm text-cover-cream/90">{summary}</p>}
            </>
          ) : (
            <span className="shimmer block h-16 w-56 rounded-lg opacity-30" aria-hidden />
          )}
        </div>
      </div>
      <div className="h-6 bg-cover-sea sm:h-8" />
      <div className="h-[3px] bg-cover-line" />
      <div className="h-4 bg-cover-sand sm:h-5" />
      <TreePalmIcon
        weight="fill"
        aria-hidden
        className="pointer-events-none absolute -bottom-3 right-4 h-44 w-44 text-cover-ink sm:right-12 sm:h-56 sm:w-56"
      />
    </section>
  );
}
```

- [ ] **Step 3: Dashboard page**

<!-- file: frontend/src/app/dashboard/page.tsx -->
```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRightIcon,
  CalendarBlankIcon,
  ChartBarIcon,
  ForkKnifeIcon,
  ListChecksIcon,
  type Icon,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { onEventsChanged, onTasksChanged } from "@/lib/events";
import { addDaysIso, todayIso } from "@/lib/format";
import { fmtKcal } from "@/lib/nutrition";
import { isTaskDone, type Task } from "@/lib/types";
import { CARD } from "@/lib/ui";
import { ErrorState, TaskList, TaskListSkeleton } from "@/components/PageParts";
import CoverBand from "@/components/dashboard/CoverBand";
import AgendaList from "@/components/events/AgendaList";
import EventEditor, { type EditorTarget } from "@/components/events/EventEditor";
import MacroSummary from "@/components/nutrition/MacroSummary";
import TargetsModal from "@/components/nutrition/TargetsModal";
import WeekChart from "@/components/nutrition/WeekChart";

const MAX_DUE = 6;

/** Loads one card's data independently, so a failing endpoint only
 * affects its own card. Keeps the previous data while reloading. */
function useCard<T>(load: () => Promise<T>, version: number) {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) setState({ data, error: null });
      })
      .catch((e) => {
        if (!cancelled) setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : "Couldn't load" }));
      });
    return () => {
      cancelled = true;
    };
    // `load` is a new closure every render; version and attempt drive reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, attempt]);
  return { ...state, retry: () => setAttempt((a) => a + 1) };
}

function CardHeader({ title, icon: HeaderIcon, href, link }: { title: string; icon: Icon; href?: string; link?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1 pb-2">
      <h2 className="flex items-center gap-2 text-[13px] font-medium text-fg-muted">
        <HeaderIcon weight="bold" className="h-4 w-4 text-accent" aria-hidden />
        {title}
      </h2>
      {href && link && (
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-xs font-medium text-accent-text underline-offset-4 hover:underline"
        >
          {link}
          <ArrowRightIcon className="h-3 w-3" aria-hidden />
        </Link>
      )}
    </div>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className={`${CARD} px-4 py-6 text-center text-sm text-fg-faint`}>{children}</p>;
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div>
      <div className="font-mono text-2xl font-medium tabular-nums tracking-tight text-fg">{value}</div>
      <div className="mt-0.5 text-xs text-fg-muted">{label}</div>
    </div>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [version, setVersion] = useState(0);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [editingTargets, setEditingTargets] = useState(false);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const offTasks = onTasksChanged(bump);
    const offEvents = onEventsChanged(bump);
    return () => {
      offTasks();
      offEvents();
    };
  }, []);

  const today = todayIso();
  const todayView = useCard(() => api.getToday(), version);
  const schedule = useCard(() => api.getSchedule(today, today).then((s) => s.occurrences), version);
  const nextWeek = useCard(() => api.getSchedule(today, addDaysIso(today, 6)).then((s) => s.count), version);
  const nutrition = useCard(() => api.getNutritionDay(today), version);
  const history = useCard(() => api.getNutritionHistory(addDaysIso(today, -6), today), version);
  const week = useCard(() => api.getWeekSummary(), version);

  const due: Task[] = (() => {
    if (!todayView.data) return [];
    const seen = new Set<string>();
    const out: Task[] = [];
    for (const t of [...todayView.data.overdue, ...todayView.data.due_today]) {
      if (seen.has(t.id) || isTaskDone(t)) continue;
      seen.add(t.id);
      out.push(t);
    }
    return out;
  })();

  const summaryParts: string[] = [];
  if (schedule.data) summaryParts.push(plural(schedule.data.length, "event"));
  if (todayView.data) summaryParts.push(`${plural(due.length, "task")} due`);
  if (nutrition.data?.remaining) {
    const left = nutrition.data.remaining.calories;
    summaryParts.push(left >= 0 ? `${fmtKcal(left)} kcal left` : `${fmtKcal(-left)} kcal over`);
  }
  const bandDate = todayView.data?.date ?? nutrition.data?.day ?? null;

  const refresh = () => setVersion((v) => v + 1);

  return (
    <div className="space-y-8">
      <CoverBand date={bandDate} summary={summaryParts.length ? summaryParts.join(", ") : null} />

      <div className="grid gap-x-6 gap-y-8 md:grid-cols-2">
        <section aria-label="Schedule today" className="min-w-0">
          <CardHeader title="Schedule today" icon={CalendarBlankIcon} href="/calendar" link="Calendar" />
          {schedule.error && !schedule.data ? (
            <ErrorState message={schedule.error} onRetry={schedule.retry} />
          ) : !schedule.data ? (
            <TaskListSkeleton rows={2} />
          ) : schedule.data.length === 0 ? (
            <Quiet>Nothing scheduled today.</Quiet>
          ) : (
            <AgendaList occurrences={schedule.data} onOpen={(occ) => setEditor({ kind: "occurrence", occ })} />
          )}
        </section>

        <section aria-label="Due and overdue" className="min-w-0">
          <CardHeader title="Due and overdue" icon={ListChecksIcon} href="/today" link="Today" />
          {todayView.error && !todayView.data ? (
            <ErrorState message={todayView.error} onRetry={todayView.retry} />
          ) : !todayView.data ? (
            <TaskListSkeleton rows={3} />
          ) : due.length === 0 ? (
            <Quiet>Nothing due. Nice.</Quiet>
          ) : (
            <>
              <TaskList tasks={due.slice(0, MAX_DUE)} onUpdated={refresh} onDeleted={refresh} />
              {due.length > MAX_DUE && (
                <p className="px-1 pt-2 text-xs text-fg-muted">
                  {due.length - MAX_DUE} more on{" "}
                  <Link href="/today" className="font-medium text-accent-text underline-offset-4 hover:underline">
                    Today
                  </Link>
                </p>
              )}
            </>
          )}
        </section>

        <section aria-label="Nutrition today" className="min-w-0">
          <CardHeader title="Nutrition today" icon={ForkKnifeIcon} href="/nutrition" link="Food log" />
          {nutrition.error && !nutrition.data ? (
            <ErrorState message={nutrition.error} onRetry={nutrition.retry} />
          ) : !nutrition.data ? (
            <div className={`shimmer h-40 ${CARD}`} />
          ) : (
            <MacroSummary summary={nutrition.data} onSetTargets={() => setEditingTargets(true)} />
          )}
        </section>

        <section aria-label="This week" className="min-w-0">
          <CardHeader title="This week" icon={ChartBarIcon} href="/completed" link="Completed" />
          <div className={`${CARD} p-5`}>
            <dl className="grid grid-cols-3 gap-4">
              <Stat value={week.data ? week.data.completed_count : "-"} label="Tasks done" />
              <Stat value={nextWeek.data ?? "-"} label="Events, next 7 days" />
              <Stat
                value={history.data?.averages ? fmtKcal(history.data.averages.calories) : "-"}
                label="Avg kcal a day"
              />
            </dl>
            {history.data && (
              <div className="mt-6 pt-6">
                <WeekChart
                  days={history.data.days}
                  selected={today}
                  onSelect={(iso) => router.push(iso === today ? "/nutrition" : `/nutrition?date=${iso}`)}
                />
              </div>
            )}
            {(week.error || history.error || nextWeek.error) && (
              <p className="mt-4 text-xs text-danger">
                Some numbers couldn&apos;t load.{" "}
                <button
                  type="button"
                  onClick={() => {
                    week.retry();
                    history.retry();
                    nextWeek.retry();
                  }}
                  className="font-medium underline underline-offset-4"
                >
                  Retry
                </button>
              </p>
            )}
          </div>
        </section>
      </div>

      {editor && <EventEditor target={editor} onClose={() => setEditor(null)} />}
      {editingTargets && (
        <TargetsModal
          current={nutrition.data?.targets ?? null}
          onClose={() => setEditingTargets(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Navigation and routing**
  - `AppShell.tsx`: import `SquaresFourIcon`; insert `{ href: "/dashboard", label: "Dashboard", icon: SquaresFourIcon },` as the first `NAV` entry.
  - `frontend/src/app/page.tsx`: `redirect("/today")` → `redirect("/dashboard")`.
  - `frontend/src/proxy.ts`: the logged-in redirect `new URL("/today", request.url)` → `new URL("/dashboard", request.url)`.
  - `login/page.tsx`: `router.push("/today")` → `router.push("/dashboard")`.

- [ ] **Step 5: Verify.** `npx tsc --noEmit && npx eslint src` → no output. Browser:
  - `/dashboard` renders band + four cards (GREEN for Step 1); `/` and `/login` (while signed in) land on `/dashboard`.
  - Band text contrast: run in the page

```js
(async () => {
  const band = document.querySelector('[aria-label="Overview"]');
  const texts = [...band.querySelectorAll("p, h1")];
  const r = band.getBoundingClientRect();
  // Sample the gradient behind each text line by drawing the same gradient on a canvas.
  const cs = getComputedStyle(document.documentElement);
  const stops = ["--cover-sky-top", "--cover-sky-mid", "--cover-horizon"].map((n) => cs.getPropertyValue(n).trim());
  const sky = band.firstElementChild.getBoundingClientRect();
  const c = document.createElement("canvas"); c.width = 1; c.height = Math.round(sky.height);
  const g = c.getContext("2d", { willReadFrequently: true });
  const grad = g.createLinearGradient(0, 0, 0, c.height); grad.addColorStop(0, stops[0]); grad.addColorStop(0.58, stops[1]); grad.addColorStop(1, stops[2]);
  g.fillStyle = grad; g.fillRect(0, 0, 1, c.height);
  const lum = ([R, G, B]) => [R, G, B].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const out = {};
  for (const t of texts) {
    const tr = t.getBoundingClientRect();
    const y = Math.min(c.height - 1, Math.round(tr.bottom - sky.top));
    const bg = [...g.getImageData(0, y, 1, 1).data].slice(0, 3);
    const m = getComputedStyle(t).color.match(/[\d.]+/g).map(Number);
    const a = m[3] ?? 1;
    const fg = [0, 1, 2].map((i) => m[i] * a + bg[i] * (1 - a));
    const x = lum(fg), yy = lum(bg);
    out[t.textContent.slice(0, 24)] = ((Math.max(x, yy) + 0.05) / (Math.min(x, yy) + 0.05)).toFixed(2);
  }
  return out;
})()
```

    Every line ≥ 4.5 (worst case = the line's bottom edge).
  - Failure isolation: in the browser, temporarily wrap `window.fetch` so requests to `/api/nutrition/day` reject, bump a task change (e.g. reload), confirm the nutrition card shows Retry and the other three cards render; restore fetch.
  - Check off a due task on the dashboard; it disappears from "Due and overdue" and the band summary count drops. Undo it.
  - Light and dark; 390px width without horizontal scroll.

- [ ] **Step 6: Commit** `git add -A frontend/src && git commit -m "Add the Look dashboard as the home page"`

---

### Task 3: Whole-app pass

- [ ] `npx next build` in a scratch copy → success, `/dashboard` listed.
- [ ] Backend suite → 145 pass (no backend change).
- [ ] Browser, both themes: Today, Inbox, All Tasks, Upcoming, Calendar (with an event), Nutrition, Completed, Settings, Login, an open modal. Fix any page where a hard-coded color clashes; commit fixes as `Fix <page> colors for the Look theme`.
- [ ] Remove any test data created during checks.
