# Events and Schedule: Design

**Date:** 2026-10-01
**Status:** Approved in conversation, pending spec review

## Goal

Keep the user's schedule (classes, parties, football games, appointments)
in this app, built up over time mostly by talking to ChatGPT through the
existing MCP tunnel. Events can recur with arbitrarily complex rules
(standard iCalendar RRULE), with single dates skipped, moved, or edited
without breaking the series. The web UI shows events on the Calendar and
Today pages and can create and edit them too.

## Decisions

- **Events are separate from tasks.** An event happens at a time; a task
  gets done. Events never appear in task lists and tasks never become
  events.
- **Recurrence = RFC 5545 RRULE**, stored once per series and expanded on
  read with `python-dateutil` (new dependency). Occurrences are never
  materialized as rows.
- **Exceptions:** `exdates` on the series for skipped dates; an
  `event_overrides` row per individually changed or cancelled occurrence.
- **Edit scope:** "just this date" (override) or "all dates" (series).
  "This and following" is out of scope.
- **Times are local wall-clock times in `APP_TIMEZONE`**, stored naive,
  same as the rest of the app (single user, single timezone).
- **Deletes are real; nothing is deleted automatically.** Deleting a series
  deletes its overrides.
- **No external calendar sync** (Google/Apple/.ics) in this version.

Out of scope: calendar sync/subscription feeds, reminders/notifications,
attendees/invites, per-event timezones, "this and following" edits,
linking events to tasks.

## Data model

Two new SQLModel tables, created by the existing `create_all`. Additive.

### `events` (one row per one-off event or recurring series)

| Field | Type | Notes |
|---|---|---|
| `id` | str uuid | |
| `title` | str | required, 1..200 chars after strip |
| `location` | str, nullable | |
| `notes` | str, nullable | |
| `category` | str | default `"other"`; UI suggests `class`, `social`, `sports`, `work`, `appointment`, `other` |
| `all_day` | bool | default false |
| `start_at` | datetime (naive, local) | first occurrence's start; for all-day, 00:00 of the first day |
| `end_at` | datetime (naive, local) | must be > `start_at`; for all-day, 00:00 of the day after the last day (exclusive end) |
| `rrule` | str, nullable | RRULE body without `DTSTART`, e.g. `FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261212T235959` |
| `exdates` | JSON list[date] | occurrence dates to skip |
| `source` | str | `"mcp"` or `"manual"` |
| `created_at`, `updated_at` | datetime | |

Occurrence duration = `end_at - start_at`, applied to every occurrence.

### `event_overrides` (one changed or cancelled date of a series)

| Field | Type | Notes |
|---|---|---|
| `id` | str uuid | |
| `event_id` | FK → events.id | deleted with the series |
| `original_date` | date | the occurrence date being changed; unique with `event_id` |
| `cancelled` | bool | default false |
| `start_at`, `end_at` | datetime, nullable | new time for this occurrence (both or neither) |
| `title`, `location`, `notes` | str, nullable | null = inherit from series |
| `created_at`, `updated_at` | datetime | |

## Recurrence rules and validation

- `rrule` is parsed with `dateutil.rrule.rrulestr(rrule, dtstart=start_at)`.
  Invalid syntax → validation error naming the problem.
- Rejected: a `DTSTART` inside the rule (start comes from `start_at`),
  `FREQ` of `SECONDLY`/`MINUTELY`/`HOURLY`, and rules that produce no
  occurrence on or after `start_at`.
- `UNTIL` and `COUNT` are both allowed (not together, per RFC). A rule
  with neither is an open-ended series.
- `exdates` must be dates; ones that aren't occurrences are kept but
  harmless.
- Override dates must be real occurrence dates of the series (and not in
  `exdates`).
- Changing a series' `rrule` or `start_at` keeps overrides whose
  `original_date` is still an occurrence and deletes the rest (returned in
  the response so the client can mention them).

## Expansion

`occurrences(session, range_start: date, range_end: date)` returns every
occurrence overlapping the inclusive local-date range, sorted by start:

1. One-off events overlapping the range.
2. For each series: generate occurrence starts with
   `rule.between(range_start_dt - duration, range_end_dt_exclusive, inc=True)`
   so an occurrence that starts before the range but ends inside it is
   included; drop `exdates`; apply overrides (cancelled → dropped; changed
   fields replace series fields).
3. Overrides that move an occurrence into the range from outside it are
   found by querying overrides whose new `start_at`/`end_at` overlaps the
   range.

Each occurrence: `event_id`, `occurrence_date` (the original date of a
series occurrence; the start date for a one-off, so it is always present),
`start_at`, `end_at`, `all_day`, `title`, `location`,
`category`, `notes`, `recurring` (bool), `rrule` (series rule or null),
`overridden` (bool).

Limits: range at most 366 days per call; at most 2000 occurrences per
response (error asks for a smaller range).

## Conflicts

`conflicts(session, start_at, end_at, exclude_event_id=None)` returns
timed (not all-day) occurrences overlapping `[start_at, end_at)`.
Creating or updating an event returns conflicts for its next occurrences
within 60 days (capped at 20 listed) without blocking the save.

## Service: `app/services/events.py`

- `create_event(session, payload, source) -> Event`
- `get_event(session, event_id)`, `search_events(session, query, limit=20)`
  (title, location, category; case-insensitive; literal `%`/`_`)
- `update_event(session, event, changes) -> (Event, dropped_override_dates)`
- `delete_event(session, event)`
- `edit_occurrence(session, event, original_date, changes) -> EventOverride`
  (`cancel=True` cancels; otherwise fields are changed)
- `restore_occurrence(session, event, original_date)` (deletes the
  override; un-cancels/un-edits)
- `occurrences(session, start, end) -> list[Occurrence]`
- `preview(event, count=5) -> list[Occurrence]` (next occurrences from the
  later of today and the series start)
- `conflicts(session, start_at, end_at, exclude_event_id=None)`

Validation errors raise `ValueError` with a message stating what's wrong
and how to fix it.

## MCP tools

| Tool | Returns |
|---|---|
| `create_event(title, start_at, end_at, all_day?, location?, category?, notes?, rrule?, exdates?)` | event, `next_occurrences` (5), `conflicts` |
| `get_schedule(start_date, end_date?)` | occurrences (end defaults to start) |
| `find_events(query, limit?)` | events (series and one-offs) |
| `update_event(event_id, …any event field…)` | event, `next_occurrences`, `conflicts`, `dropped_overrides`. String fields set to `""` clear them (location, notes, rrule); omitted fields are unchanged |
| `edit_occurrence(event_id, date, cancel?, start_at?, end_at?, title?, location?, notes?)` | the occurrence after the change |
| `restore_occurrence(event_id, date)` | the occurrence restored to the series |
| `delete_event(event_id)` | `deleted_id` |
| `check_conflicts(start_at, end_at)` | occurrences overlapping the slot |

Datetimes are ISO `YYYY-MM-DDTHH:MM` local; all-day events take dates.
Docstrings instruct the client to: write standard RRULEs (no DTSTART),
give semester-bound series an `UNTIL`, use `exdates` for holidays and
breaks, call `check_conflicts` before adding, read the `next_occurrences`
preview back to the user, and use one-off events when dates are irregular
(e.g. a football schedule with varying days).

Also an MCP resource `events://today` (today's schedule).

## REST API: `/api/events` (auth via `require_auth`)

- `GET /schedule?start_date=&end_date=` → occurrences
- `GET /search?q=&limit=` → events
- `GET /preview?start_at=&end_at=&rrule=&all_day=` → next 5 occurrences
  for an unsaved rule (powers the form preview; 422 on invalid rule)
- `POST /` → create; `GET /{id}`; `PATCH /{id}`; `DELETE /{id}`
- `PUT /{id}/occurrences/{date}` → edit or cancel one occurrence
- `DELETE /{id}/occurrences/{date}` → restore it
- `GET /conflicts?start_at=&end_at=&exclude_event_id=`

## Web UI

1. **Calendar page:** month cells list events first (start time + title,
   max 3 combined with tasks, "+N more"), then due tasks. The selected-day
   panel shows that day's events as a time-ordered list (time range or
   "All day", title, location, repeat icon for series, category marker
   with its name) above the day's tasks. "Add event" button next to the
   month controls; clicking an event opens it.
2. **Event form (Dialog):** title; date; start/end time or "All day"
   toggle (with end date for multi-day); location; category (select with
   the suggested values, free text allowed); notes; **Repeat** presets:
   none, daily, every weekday, weekly on chosen days, every 2 weeks on
   chosen days, monthly (same day of month); **Ends**: never / on date /
   after N times; "Advanced" disclosure showing the raw RRULE (editable;
   presets are derived from it when it matches one, otherwise "Custom");
   a live preview of the next 5 dates from `/api/events/preview`.
3. **Editing an occurrence of a series** first asks "Just this date" or
   "All dates in the series". Just-this-date edits time/title/location/
   notes or cancels; a cancelled or edited occurrence shows "Restore to
   series". Deleting a series asks for a second click like other deletes.
4. **Today page:** a "Schedule" section at the top with today's events
   (time range, title, location), hidden when there are none.
5. Category markers: colored glyph plus the category name (never color
   alone), same pattern as task categories.

## Error handling

- Invalid RRULE, end before start, mixed all-day/timed values, bad dates,
  range too large, too many occurrences → 422 / `{"error": ...}` with a
  specific message.
- Unknown event → 404 / `{"error": "No event with id ..."}`; override
  date not an occurrence → 422.
- Web UI: form errors inline in the Dialog; load failures show
  `ErrorState` with Retry; mutation failures toast.

## Testing

Backend (pytest):
- Expansion: weekly multi-day rule; `UNTIL` and `COUNT`; `INTERVAL=2`;
  `BYSETPOS=-1` (last Friday of month); exdates; cancelled override;
  moved override within range and moved into range from outside; edited
  title; all-day single and multi-day; occurrence starting before range
  and ending inside; event crossing midnight; open-ended series in a far
  range; occurrence cap and range cap.
- Validation: bad RRULE, DTSTART in rule, HOURLY, end ≤ start, override on
  non-occurrence date.
- Update: changing rule drops orphaned overrides and reports them.
- Conflicts: overlapping timed events found, all-day ignored, excluded id
  ignored.
- REST and MCP: each endpoint/tool happy path, auth, 404, 422.

Frontend: `tsc`, `eslint`, `next build`, browser pass (create a weekly
series with an exdate, cancel and move single occurrences, Today page
schedule, light/dark, phone width), and a real MCP call against the
running server. Existing backend tests (99) keep passing.
