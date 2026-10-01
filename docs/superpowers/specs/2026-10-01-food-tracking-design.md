# Food Tracking: Design

**Date:** 2026-10-01
**Status:** Approved in conversation, pending spec review

## Goal

Log what you eat by talking to ChatGPT (connected over the existing OpenAI
Secure MCP Tunnel). ChatGPT estimates calories and macros, writes them into
this app, and replies with the running totals for the day against
configurable daily targets. The app is the durable record; ChatGPT is the
nutrition estimator. The web UI shows the same data and allows manual
entry, editing, and target changes.

## Decisions

- **ChatGPT supplies the numbers.** The app never looks up nutrition
  itself (no USDA or other external API). It stores whatever the client
  sends. Numbers are estimates and only as good as the client's estimate.
- **One row per food item.** "Two eggs and toast" is two entries, logged
  in a single MCP call.
- **Deletes are real; nothing is ever removed automatically.** User- or
  ChatGPT-initiated deletes hard-delete the row. Edits update in place (no
  version history). There is no retention, pruning, or expiry of any kind,
  so the full history stays readable by MCP clients.
- **Targets are effective-dated.** Changing targets inserts a new row
  starting on a date (default today) instead of overwriting, so past days
  are judged against the targets that applied then.
- **Separate from tasks.** Food entries never become tasks or affect any
  task view.
- **Days use `APP_TIMEZONE`** via the existing `app.utils.local_today()`,
  the same as tasks.

Out of scope (deliberately): saved foods / food library, app-side
nutrition lookup, micronutrients, per-weekday targets, version history of
edits, photo logging.

## Data model

Two new SQLModel tables, created by the existing `SQLModel.metadata.create_all`
in `init_db()`. Purely additive: no existing table changes, no migration
needed on the Postgres volume.

### `food_entries`

| Field | Type | Notes |
|---|---|---|
| `id` | str (uuid4) | primary key, same `_uuid` pattern as tasks |
| `name` | str | required, non-empty |
| `quantity` | str, nullable | free text: "200 g", "1 cup", "2 eggs" |
| `calories` | float | required, >= 0 |
| `protein_g` | float | default 0, >= 0 |
| `carbs_g` | float | default 0, >= 0 |
| `fat_g` | float | default 0, >= 0 |
| `meal` | enum, nullable | `breakfast`, `lunch`, `dinner`, `snack` |
| `eaten_on` | date | required; defaults to `local_today()`; indexed |
| `eaten_at` | time, nullable | |
| `notes` | str, nullable | e.g. source of an estimate |
| `source` | str | `"mcp"` or `"manual"` (matches `Task.source` convention) |
| `created_at`, `updated_at` | datetime | `utcnow()` |

### `nutrition_targets`

| Field | Type | Notes |
|---|---|---|
| `id` | str (uuid4) | primary key |
| `calories` | float | required, > 0 |
| `protein_g`, `carbs_g`, `fat_g` | float, nullable | a macro with no target shows totals only |
| `effective_from` | date | unique; setting targets again for the same date replaces that row |
| `created_at` | datetime | |

**Target for a day** = the row with the greatest `effective_from <= day`.
None if no row qualifies (before any targets were set).

## Service layer: `app/services/nutrition.py`

Shared by REST and MCP, like `app/services/tasks.py`.

- `log_entries(session, items, source) -> list[FoodEntry]`: validates and
  inserts all items in one transaction; any invalid item rejects the
  whole call.
- `update_entry(session, entry_id, changes) -> FoodEntry | None`: partial
  update, bumps `updated_at`.
- `delete_entry(session, entry_id) -> FoodEntry | None`: hard delete,
  returns the deleted row (so callers know which day to summarize).
- `get_entry(session, entry_id)`
- `day_summary(session, day) -> DaySummary`: entries ordered by
  meal (breakfast, lunch, dinner, snack, unlabeled) then `eaten_at` then
  `created_at`; totals; target in effect; remaining (target minus total,
  may be negative); per-macro `over` flags.
- `history(session, start, end) -> HistorySummary`: per-day totals and
  targets for every day in the range (days with no entries included with
  zeros), plus averages over days that have at least one entry, and the
  count of logged days. `end - start` capped at 366 days per call.
- `search_entries(session, query, limit=20)`: case-insensitive substring
  match on `name`, newest first, so a client can reuse earlier numbers.
- `get_targets(session, day=None)`, `set_targets(session, values, effective_from=None)`,
  `target_history(session)`.

Validation errors raise `ValueError` with a message stating what is wrong
and how to fix it; routers map to 422, MCP tools return
`{"error": message}` like the existing `_not_found` pattern.

## MCP tools (`mcp_server/server.py`)

| Tool | Args | Returns |
|---|---|---|
| `log_food` | `items: list[{name, calories, quantity?, protein_g?, carbs_g?, fat_g?, meal?, eaten_on?, eaten_at?, notes?}]` | `{entries, day}` where `day` is the day summary for the (first) date logged |
| `update_food_entry` | `entry_id`, any entry fields | `{entry, day}` |
| `delete_food_entry` | `entry_id` | `{deleted_id, day}` |
| `get_nutrition_day` | `date?` (default today) | day summary |
| `get_nutrition_history` | `start_date`, `end_date?` (default today) | history summary |
| `search_food_entries` | `query`, `limit?` | entries |
| `get_nutrition_targets` | `date?` | targets in effect + full target history |
| `set_nutrition_targets` | `calories`, `protein_g?`, `carbs_g?`, `fat_g?`, `effective_from?` | targets + day summary for today |

Every mutating tool returns the affected day's summary so the client can
report totals and what's left without another call. If `log_food` items
span several dates, `day` is for the first item's date and the response
also lists all dates touched.

Tool docstrings instruct the client to: estimate nutrition itself
(searching the web for restaurant and branded items), call
`search_food_entries` first when the user refers to something they've
eaten before, split meals into separate items, and put the basis of an
estimate in `notes`. Source is recorded as `"mcp"`.

Also one MCP resource, `nutrition://today`, mirroring `get_nutrition_day()`.

## REST API: `app/routers/nutrition.py`

Session-cookie or Bearer auth via the existing `app.deps.require_auth` dependency, mounted under
`/api/nutrition`:

- `GET /day?date=` → day summary
- `GET /history?start_date=&end_date=` → history summary
- `POST /entries` (single entry body) → `{entry, day}`, source `"manual"`
- `PATCH /entries/{id}` → `{entry, day}`
- `DELETE /entries/{id}` → `{deleted_id, day}`
- `GET /entries/search?q=&limit=`
- `GET /targets?date=` → targets in effect + history
- `PUT /targets` → set targets

Pydantic schemas in `app/schemas.py` alongside the task schemas.

## Web UI: `/nutrition`

New sidebar item "Nutrition" (Phosphor `ForkKnifeIcon`) after Calendar.
Uses the existing tokens, `PageHeader`, cards, skeletons, toasts,
empty/error states, dark mode, and phone layout.

1. **Header:** date title; previous/next day arrows; "Today" button when
   not on today. Selected date in the `?date=` query string so a day is
   linkable.
2. **Summary card:** large calorie figure "1,640 / 2,400 kcal" with
   "760 left" (or "120 over"), a calorie progress bar, then protein, carbs
   and fat bars with grams eaten / target. Over target → bar and text in
   the warning color, with the word "over" (not color alone). No targets →
   totals only plus a "Set targets" button.
3. **Food log:** entries grouped under Breakfast, Lunch, Dinner, Snack,
   Other (omitting empty groups). Row: name, quantity, calories, and
   P/C/F grams in mono. Hover/focus/touch actions: edit (modal) and
   two-click delete, matching `TaskRow`. "Add food" button opens the same
   modal empty. Empty day → empty state with "Add food".
4. **This week:** 7 bars (the selected day and the 6 before it) of daily
   calories with the target as a horizontal line, hand-built inline SVG
   (no chart dependency). Bars are buttons that select that day, with
   accessible labels ("Tue Sep 29: 2,130 kcal of 2,400"). Below: 7-day
   average calories and protein over logged days.
5. **Targets modal:** four number fields (calories required), applies
   from today; shows the date the current targets started.

The sidebar does not get a count badge for this page.

## Error handling

- Invalid input (negative numbers, empty name, unknown meal, bad date,
  history range > 366 days) → 422 with a specific message; MCP returns
  `{"error": ...}` with the same message.
- Unknown entry id → 404 / `{"error": "No food entry with id ..."}`.
- Web UI: failed saves keep the modal open with the error inline; failed
  deletes and loads show a toast or error state with Retry.

## Testing

Backend (pytest, following the existing fixtures in `tests/conftest.py`):

- Service: logging multiple items in one call; rejecting a batch with one
  invalid item; totals and remaining; target-in-effect selection across
  several effective dates and before any targets; same-date target
  replacement; update and hard delete; history zero-fills empty days,
  averages over logged days only, and enforces the range cap; search is
  case-insensitive and newest-first.
- REST: each endpoint's happy path, auth required, 404 and 422 cases.
- MCP: each tool through the same harness as `test_mcp_tools.py`,
  including the day summary returned from mutating tools.

Frontend: `tsc`, `eslint`, `next build`, then a browser pass of
`/nutrition` with real entries in light and dark mode and at phone width.
The existing 71 backend tests must still pass.
