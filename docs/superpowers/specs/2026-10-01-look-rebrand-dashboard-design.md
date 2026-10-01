# Look: Rebrand, Album-Cover Theme, and Dashboard

**Date:** 2026-10-01
**Status:** Approved in conversation, pending spec review

## Goal

Rename the app to **Look**, restyle it after the user's chosen album cover
(a flat mid-century poster: cream paper frame, ultramarine sky fading to
light blue at the horizon, a teal sea, a thin white line, a mustard sand
stripe, a black palm silhouette), and add a dashboard home page that shows
tasks, schedule, and nutrition in one place.

## Decisions

- **Re-token, don't restyle components.** Every component already reads
  semantic color tokens from `globals.css`; the theme change is a new set
  of token values (light = "day", dark = "night") plus two new tokens for
  the cover's secondary colors. Components only change where they use a
  hard-coded hue that would clash.
- **One strong cover moment.** The dashboard's top band is painted like
  the cover (sky gradient, sea, white line, sand). Everywhere else stays
  calm and flat. No cover art is reproduced.
- **Brand mark:** Phosphor `TreePalmIcon` in an ultramarine tile (no
  hand-drawn SVG).
- **Dashboard route:** `/dashboard`. `/`, the post-login redirect, and the
  logged-in visit to `/login` all go there. Today stays at `/today`.
- **No backend changes.** The dashboard composes existing endpoints.
- Design guidance normally discourages cream + mustard as an overused
  default; it is used here because the brand source literally is this
  palette.

## Palette

Hex values are the targets; implementation may express them in `oklch`
and nudge lightness only as needed to pass contrast.

| Token | Light (day) | Dark (night) | Use |
|---|---|---|---|
| `--canvas` | `#F2EAD5` paper | `#0B1E3F` | page background, sidebar |
| `--surface` | `#FBF6EA` | `#12294F` | cards, panels, inputs |
| `--surface-2` | `#EDE3CA` | `#18325C` | hover, subtle fills, tracks |
| `--line` / `--line-strong` | `#E0D4B6` / `#CBBD99` | `#223D69` / `#2E4D80` | borders |
| `--fg` | `#1A1A1A` ink | `#F2EAD5` cream | primary text |
| `--fg-muted` / `--fg-faint` | ink at reduced lightness | cream at reduced lightness | secondary text (≥ 4.5:1) |
| `--accent` | `#1F3F8F` ultramarine | `#8DB4E0` horizon blue | buttons, active nav, today, links |
| `--accent-fg` | cream | `#0B1E3F` | text on accent |
| `--sea` (new) | `#1F6E7A` | lighter teal | success / done, chart "on target" |
| `--sand` (new) | `#C99A2E` | brighter mustard | highlights; maps onto `--warn` |
| `--danger` | muted brick | lighter brick | errors, overdue |

`--warn` becomes the sand mustard. Text on mustard uses ink in both
themes. Every text/background pair passes WCAG AA (4.5:1 body, 3:1 large
text and UI marks); verified with the same in-browser contrast check used
for the cobalt theme. `<meta name="theme-color">` values match `--canvas`.

Category hues for tasks and events stay as they are (they are labeled,
not themed), except any that collide with the new accents are shifted so
categories don't read as status.

## Brand changes

- Sidebar wordmark "Tasks" → "Look"; mark = palm icon in an ultramarine
  tile.
- `<title>` "Look"; description "Tasks, schedule and food, in one place."
- Login heading "Sign in to Look".
- Mobile top bar fallback label "Tasks" → "Look".
- README title "Look" (subtitle keeps "self-hosted personal task manager").
- The MCP server name and API are unchanged (renaming them would break
  existing ChatGPT/Claude connections).

## Dashboard (`/dashboard`)

New nav item "Dashboard" (Phosphor `SquaresFourIcon`) at the top of the
sidebar, above Today.

1. **Cover band** (full content width, rounded like other cards, about
   180px tall on desktop, shorter on phones):
   - background: vertical gradient deep ultramarine → light horizon blue
     over the top ~70%, then a teal sea band, a 3px cream line, and a
     mustard sand band at the bottom;
   - on the sky: greeting ("Good morning" etc.), the long date, and a
     one-line summary ("3 events, 2 tasks due, 1,240 kcal left"), cream
     text with contrast verified against the gradient;
   - the palm mark, large and semi-transparent ink, at the right edge,
     rising from the sand like the cover's palm. Hidden from assistive
     tech.
2. **Grid** (2 columns ≥ md, stacked on phones in this order):
   - **Schedule today:** `AgendaList` of today's occurrences (or a quiet
     "Nothing scheduled" line), header link to `/calendar`. Clicking opens
     the existing `EventEditor`.
   - **Due and overdue:** overdue tasks then tasks due today, using the
     existing `TaskList`/`TaskRow` (complete, plan, edit, delete all work),
     max 6 with a "View all in Today" link.
   - **Nutrition:** the existing `MacroSummary` for today, header link to
     `/nutrition`.
   - **This week:** three stats (tasks completed this week, events in the
     next 7 days, average daily calories over logged days) plus a 7-day
     calorie strip reusing `WeekChart`; links to Completed and Nutrition.
3. Data: `getToday`, `getSchedule(today)`, `getSchedule(today, +6)`,
   `getNutritionDay`, `getNutritionHistory(-6, today)`, `getWeekSummary`
   in parallel; each card shows its own skeleton and its own error/retry so
   one failing endpoint doesn't blank the page. Refreshes on task and event
   change notifications.

## Error handling and states

Per-card loading skeletons, per-card `ErrorState` with Retry, empty states
in each card's own words. No new backend errors.

## Testing

- `tsc`, `eslint`, production `next build`.
- Contrast check script (in-browser, as before) over every token pair in
  both themes, including cream text on the darkest and lightest points of
  the cover band gradient.
- Browser pass: dashboard in both themes and at phone width; every
  existing page in both themes (Today, Inbox, All Tasks, Upcoming,
  Calendar, Nutrition, Completed, Settings, Login, a modal); `/` and login
  land on `/dashboard`.
- Existing backend tests (145) still pass (no backend change expected).
