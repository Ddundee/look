# MCP server

The MCP server (`backend/mcp_server/server.py`) exposes your tasks to any
MCP-compatible AI client. It shares the same database and the same
`app/services/*` business logic as the REST API — it's not a separate
copy of your data, and creating/completing/rescheduling a task through
MCP is exactly the same operation as doing it through the web UI or the
REST API.

## Transport and auth

- **Streamable HTTP** (default, used by Docker): `http://<host>:8001/mcp`,
  authenticated with `Authorization: Bearer <API_TOKEN>`. This is what you
  want for a client running anywhere on your LAN or Tailscale network,
  talking to the server running in Docker on your Pi/home server.
- **stdio**: `python -m mcp_server.server --transport stdio`, for a client
  that spawns the process locally itself (e.g. Claude Desktop on the same
  machine you've checked the backend code out on, running outside
  Docker). No network auth needed since the client owns the process.

`/health` on the MCP port is unauthenticated (used by the Docker
healthcheck); every other path requires the bearer token.

## Connecting Claude Code

```bash
claude mcp add --transport http personal-tasks http://<host>:8001/mcp \
  --header "Authorization: Bearer <your API_TOKEN>"
```

Replace `<host>` with `localhost`, your Pi's LAN IP, or its Tailscale
address/MagicDNS name, depending on where you're running Claude Code from.

## Connecting Claude Desktop

Claude Desktop's config supports remote (HTTP) MCP servers directly in
recent versions. In Settings → Connectors (or by editing
`claude_desktop_config.json` depending on your version), add:

```json
{
  "mcpServers": {
    "personal-tasks": {
      "url": "http://<host>:8001/mcp",
      "headers": {
        "Authorization": "Bearer <your API_TOKEN>"
      }
    }
  }
}
```

If your installed version only supports locally-spawned (stdio) servers,
use the stdio entry point instead (requires the backend code + a Python
env with `requirements.txt` installed on the same machine):

```json
{
  "mcpServers": {
    "personal-tasks": {
      "command": "/path/to/todo-app/backend/.venv/bin/python",
      "args": ["-m", "mcp_server.server", "--transport", "stdio"],
      "cwd": "/path/to/todo-app/backend",
      "env": {
        "DB_ENGINE": "postgres",
        "POSTGRES_HOST": "<pi-ip-or-tailscale-ip>",
        "POSTGRES_PORT": "5432",
        "POSTGRES_USER": "todo_app",
        "POSTGRES_PASSWORD": "<your POSTGRES_PASSWORD>",
        "POSTGRES_DB": "todo_app"
      }
    }
  }
}
```

(Note: Postgres itself isn't published outside the Docker network in the
default `docker-compose.yml` — the stdio approach above only works if you
also expose port 5432, or if you're running the backend directly against
a local Postgres. For most setups, the HTTP transport above is simpler.)

## Connecting Cursor

Cursor supports remote MCP servers in its MCP settings
(`~/.cursor/mcp.json` or the in-app MCP settings panel):

```json
{
  "mcpServers": {
    "personal-tasks": {
      "url": "http://<host>:8001/mcp",
      "headers": {
        "Authorization": "Bearer <your API_TOKEN>"
      }
    }
  }
}
```

## Connecting ChatGPT / other MCP clients

Any client that supports remote MCP servers over Streamable HTTP with a
custom `Authorization` header can connect the same way: point it at
`http://<host>:8001/mcp` with `Authorization: Bearer <API_TOKEN>`. If a
client only supports MCP servers with OAuth-style auth flows and no
static bearer header option, put a reverse proxy in front that injects
the header, or use `mcp-remote` (a small local proxy some clients use to
bridge stdio-only clients to a remote HTTP MCP server) configured with
the header.

## Tools

### Reading

| Tool | Description |
|---|---|
| `get_today` | Scheduled, due-today, overdue, recurring-today, and suggested high-priority tasks |
| `get_tasks` | List tasks, filterable by status/category/priority/tag/due date |
| `get_task` | Fetch a single task by id |
| `get_overdue_tasks` | Every open task past its due date |
| `get_upcoming_tasks` | Tasks due within the next N days (default 7) |
| `search_tasks` | Full-text search over title/description/notes |
| `get_week_summary` | Completed/created/overdue counts for a week |
| `get_priority_ranked_tasks` | Open tasks ordered by computed priority score, with reasons |

### Creating

| Tool | Description |
|---|---|
| `create_task` | Generic task creation (only `title` required) |
| `create_recurring_task` | Recurring template (daily/weekdays/weekly/specific_days/monthly/custom_interval) |

### Updating

| Tool | Description |
|---|---|
| `update_task` | Partial update of any task field |
| `complete_task` | Mark completed |
| `cancel_task` | Mark cancelled (kept in history) |
| `reschedule_task` | Change due date/time |
| `set_task_priority` | Change manual priority (never auto-overwritten elsewhere) |
| `add_task_note` | Append a timestamped note |

### Planning

| Tool | Description |
|---|---|
| `plan_task_for_today` | Add to today's plan without changing the due date |
| `remove_task_from_today` | Remove from today's plan |
| `carry_unfinished_tasks_forward` | Move unfinished planned tasks to another date, optionally filtered by priority |

### Food and nutrition

The client estimates calories and macros itself (the app never looks
nutrition up) and records them here. Every tool that changes something
returns that day's totals, targets and what's left. Deletes are real and
only happen when asked; nothing is ever removed automatically, so the full
history stays readable.

| Tool | Description |
|---|---|
| `log_food` | Log one or more foods in one call (`items`: name, calories, optional quantity, protein_g, carbs_g, fat_g, meal, eaten_on, eaten_at, notes). Rejects the whole batch if any item is invalid |
| `update_food_entry` | Correct an entry; pass only the fields to change |
| `delete_food_entry` | Permanently delete an entry |
| `get_nutrition_day` | One day's entries in meal order, totals, targets, what's left, macros over target |
| `get_nutrition_history` | Per-day totals vs targets for a range (max 366 days per call) plus averages over logged days |
| `search_food_entries` | Find past entries by name to reuse their numbers |
| `get_nutrition_targets` | Targets in effect on a day plus the full history of target changes |
| `set_nutrition_targets` | Set daily targets from a date (default today); earlier days keep their old targets |

### Events and schedule

Classes, games, parties and appointments. A recurring series stores one
standard RFC 5545 RRULE (no DTSTART; the event's start is the first
occurrence) and is expanded when read. Single dates can be skipped
(`exdates`), moved, edited or cancelled without touching the rest of the
series. Deletes only happen when asked.

| Tool | Description |
|---|---|
| `create_event` | One-off or recurring event: title, start_at/end_at (or all_day with dates), location, category, notes, `rrule`, `exdates`. Returns the next occurrences and any conflicts in the next 60 days |
| `get_schedule` | Every occurrence between two dates (max 366 days per call), sorted, with `event_id` and `occurrence_date` |
| `find_events` | Search events and series by title, location or category |
| `update_event` | Change a one-off or a whole series; `''` clears location, notes or rrule. Reports single-date edits dropped by a pattern change |
| `edit_occurrence` | Move, retitle, relocate or cancel one date of a series |
| `restore_occurrence` | Undo a single-date change or cancellation |
| `delete_event` | Permanently delete a one-off or a whole series |
| `check_conflicts` | Timed events overlapping a slot (all-day events don't count) |

### LeetCode tracking

What the user actually solved, separate from tasks (plans). Problems are
identified by their LeetCode number, so logging the same problem again adds
an attempt to it. See [`LEETCODE.md`](LEETCODE.md) for how stats, streaks
and topic weakness are calculated.

| Tool | Description |
|---|---|
| `log_leetcode_attempt` | Record an attempt: problem number, plus title/difficulty the first time; topics, solved, solved_independently (defaults to solved without a hint), hint_used, duration_minutes, language, confidence 1-5, notes. Returns updated progress |
| `get_leetcode_progress` | Totals, by difficulty, rates, streaks, today/week vs goals, insights |
| `get_recent_leetcode_attempts` | Newest attempts, filterable by difficulty, topic, solved |
| `get_leetcode_topic_stats` | Per-topic progress, weakest first, with the reasons |
| `get_leetcode_problem` | One problem by number, with every attempt |
| `set_leetcode_goals` | Daily and weekly targets |

### Calendar subscriptions

ICS calendars (Canvas, school, sports, exported Google calendars). Giving
the assistant a calendar URL creates a **live subscription** that Look
re-fetches on its own; it never imports a URL just once. Imported events
appear in `get_schedule` with `subscription_name` and are read-only. See
[`CALENDARS.md`](CALENDARS.md).

| Tool | Description |
|---|---|
| `add_calendar_subscription` | Subscribe to an ICS/webcal URL (name, url, sync_interval_minutes, default 30) and sync it once. Returns the counts |
| `list_calendar_subscriptions` | All sources with interval, last sync, last error, event count |
| `sync_calendar_subscription` | Re-fetch a URL subscription now |
| `update_calendar_subscription` | Rename, pause/resume (enabled), change the interval |
| `remove_calendar_subscription` | Remove one; keep_events=true keeps its events as normal events |
| `import_ics` | One-time import of raw iCalendar text (a snapshot; prefer a URL subscription) |

## Resources (read-only)

| URI | Contents |
|---|---|
| `tasks://today` | Same payload as `get_today` |
| `tasks://overdue` | Same payload as `get_overdue_tasks` |
| `tasks://upcoming` | Same payload as `get_upcoming_tasks` |
| `nutrition://today` | Same payload as `get_nutrition_day` |
| `leetcode://progress` | Same payload as `get_leetcode_progress` |
| `events://today` | Same payload as `get_schedule` for today |

## Example prompts once connected

- "What do I need to do today?"
- "Add a task to finish problem set 3, due Friday."
- "Mark the CI pipeline task as completed."
- "What should I prioritize tonight?"
- "Move my unfinished low-priority tasks to tomorrow."
- "What did I accomplish this week?"
- "I had 2 eggs and a slice of toast for breakfast."
- "How am I doing on protein this week?"
- "I solved LeetCode 560 in 23 minutes in Java, needed one hint, confidence 3/5."
- "Which LeetCode topics am I weakest at?"
- "Add CS 101, Mon/Wed/Fri 10 to 10:50 through Dec 12, skipping Thanksgiving week."
- "No class this Friday."
- "Add my Canvas calendar: https://canvas.example.edu/feeds/calendars/user_….ics"
