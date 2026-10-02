# Calendar subscriptions (ICS)

Look can show events from any calendar that publishes an ICS (iCalendar)
feed: Canvas, school or team calendars, Google Calendar's "secret address in
iCal format", and so on. They appear in the Calendar, Today and Dashboard
next to your own events, labeled with the calendar's name.

Manage them in **Settings → Calendars**, over the REST API, or from an AI
client over MCP.

## URL subscriptions vs uploaded files

| | ICS URL | Uploaded `.ics` file |
|---|---|---|
| What it is | A live subscription | A one-time snapshot |
| Updates | Re-fetched automatically on its interval (default every 30 minutes), plus "Sync now" | Never by itself. Upload a file with the same name again to update that import |
| New events published later (e.g. a new Canvas assignment) | Show up on the next sync | Only if you re-upload |

`webcal://` links are accepted and fetched over `https://`.

## How syncing works

Every sync of a URL subscription:

1. **Makes a fresh HTTP request** to the URL. The `ETag`/`Last-Modified`
   from the previous response are sent so the server can answer `304 Not
   Modified`, but they never skip the request. The timeout is 20 seconds
   and feeds are capped at 10 MB.
2. **Parses the whole feed** with the [`icalendar`](https://pypi.org/project/icalendar/) package.
3. **Only if both succeeded**, reconciles it with the events already
   imported from this subscription, in one database transaction:
   - **New UID:** creates an event. This is how an assignment published
     weeks later appears without you doing anything.
   - **Known UID with changed content:** updates that same event in place
     (title, times, description, URL, location, recurrence, status).
   - **Known UID, same content:** left alone.
   - **UID no longer in the feed:** marked *removed from feed*. It's hidden
     from the calendar but not deleted, and it comes back if the UID
     reappears.
   - **`STATUS:CANCELLED`:** kept and shown as cancelled.

If the request fails (network, timeout, HTTP error) or the response isn't
a valid calendar, **nothing is changed**. The error is shown in Settings
and Look tries again at the next interval.

**No duplicates.** An imported event is identified by its subscription plus
its ICS `UID`. A database constraint (`UNIQUE(subscription_id,
external_uid)`) guarantees repeated syncs can never duplicate it. Adding the
same URL twice is refused.

**Scheduling.** The backend checks every minute which enabled URL
subscriptions are due. It syncs all of them once shortly after startup, but
startup never waits for a remote calendar. Feeds are synced one at a time,
and a failure in one doesn't stop the others. A per-subscription lock (a
PostgreSQL advisory lock) keeps a scheduled sync and a manual or MCP
"sync now" from overlapping. Paused (disabled) subscriptions aren't synced.

Settings (env vars, normally left alone): `CALENDAR_SYNC_ENABLED` (default
`true`), `CALENDAR_SYNC_CHECK_SECONDS` (60) and
`CALENDAR_SYNC_STARTUP_DELAY_SECONDS` (15).

## What's imported

| ICS | In Look |
|---|---|
| `UID` | Identity (with the subscription) |
| `SUMMARY`, `DESCRIPTION`, `LOCATION`, `URL` | Title, notes, location, "Open source" link |
| `DTSTART`/`DTEND`/`DURATION` | Start/end, converted to `APP_TIMEZONE` (UTC and `TZID` times are converted, floating times kept) |
| `DATE` values | All-day events |
| Start with no end (e.g. Canvas due dates) | A deadline at that time |
| `VTODO` with `DUE` | A deadline at the due time |
| `RRULE`, `EXDATE` | A recurring series with skipped dates |
| `RECURRENCE-ID` instances | Changes to (or cancellations of) single dates of the series |
| `STATUS:CANCELLED` | Cancelled |
| `SEQUENCE` | Picks the newest copy if a feed repeats a UID |

Rules Look can't represent (more than once a day, e.g. `FREQ=HOURLY`) are
imported as their first occurrence, with a warning in the sync result.

## Imported events are read-only

The feed owns them, so they can't be edited or deleted in Look (the API
returns 422, and the UI shows details plus "Open source" instead of a
form). Change them at the source and they update on the next sync.

## Removing a calendar

You choose what happens to its events:

- **Delete its events.** The calendar and everything imported from it are
  removed.
- **Keep them as my events.** They become normal, editable Look events
  and stop syncing. Events already "removed from feed" are deleted either
  way.

## API

| Method | Path | |
|---|---|---|
| `GET` | `/api/calendar-subscriptions` | List, with event counts and next sync time |
| `POST` | `/api/calendar-subscriptions` | `{name, url, sync_interval_minutes}`: subscribe and sync once. `409` if already subscribed |
| `GET` | `/api/calendar-subscriptions/{id}` | One subscription |
| `PATCH` | `/api/calendar-subscriptions/{id}` | `{name?, enabled?, sync_interval_minutes?}` (5 to 1440) |
| `DELETE` | `/api/calendar-subscriptions/{id}?keep_events=true\|false` | Remove |
| `POST` | `/api/calendar-subscriptions/{id}/sync` | Sync now |
| `POST` | `/api/calendar-import` | Multipart `file` (`.ics`, up to 10 MB), optional `name`: import a snapshot |

Sync results look like:

```json
{"status": "ok", "created": 3, "updated": 1, "unchanged": 27, "removed": 0, "error": null, "warnings": [], "subscription": {...}}
```

`status` is `ok`, `not_modified` (HTTP 304), `error` (nothing changed), or
`skipped` (paused, or a sync is already running).

MCP tools are listed in [MCP.md](MCP.md#calendar-subscriptions).

## Feed URLs

Anyone with a feed URL can read that
calendar. Look stores and shows it as-is (it's your own server). Canvas lets
you reset the link (Calendar → Calendar Feed); if you do, update the URL in
Look by removing and re-adding the subscription.
