# Views and dashboards

Dashboard, Today and any views you make are **views**: a list of widgets
on a grid. Arrange one with **Customize** on the page; manage them in
**Settings → Views & dashboards**. Layouts are stored in the database
(`views` table, migration `0008`), so they follow you across devices.

## Widgets

Widgets are a fixed registry. Only their keys are stored, never component
names or arbitrary JSON. The server validates every layout
(`backend/app/services/views.py`); `frontend/src/lib/views/widgets.ts`
mirrors it, and a backend test fails if the two drift.

| Key | Widget | Settings |
|---|---|---|
| `quick_add` | Quick add | |
| `things_to_do` | Things to do (overdue, today, top undated) | show done today; undated count 0/3/6 |
| `schedule` | Today's schedule with the now line | include assignments |
| `upcoming_assignments` | Assignments due soon, by day | next 3/7/14 days |
| `week_preview` | Next 7 days | |
| `nutrition_summary` | Calories and macros today | |
| `week_stats` | This week: tasks done, events, average kcal | |
| `leetcode_summary` | LeetCode today, this week, streak | |
| `block` | A block from your library (below) | which block (`block_id`) |

Each widget has a **size** (¼, ⅓, ½, ⅔ or full width of the 12-column
desktop grid; some widgets allow only some sizes) and a **height**
(short, medium, tall, full; a sixth of the screen per unit, so the
default layouts fit one screen). Tablets use two columns, phones one,
both at natural height. A view holds at most 24 widgets.

## Blocks

Blocks are things you build yourself, kept in one library
(**Settings → Blocks**, table `blocks`, migration `0009`) and placed on
any number of views. A view stores only the block's id, so editing a block
changes it everywhere it's shown. Each block has a name, an icon and a
color. Any number of blocks can go on a view, each block once per view.

- **Smart list:** tasks, assignments and/or events matching filters:
  categories, courses, priorities, tags, title text, a due window
  (overdue, today, this week, next 7/14/30 days, no date, any), status
  (not done, done, all), sort (due, priority, title), a limit (up to 50)
  and optional grouping by day. The server evaluates it
  (`app/services/blocks.py`), so the web app and MCP see the same items.
  Filters apply where the field exists: a course filter narrows to
  assignments and events (tasks have no course); priorities and tags
  narrow to tasks. "Any" looks 14 days back and 60 days ahead for
  assignments and events.
- **Note:** up to 10,000 characters of a Markdown subset: `#` headings,
  `- [ ]` checklists (tick them right on the view), `-`/`1.` lists, `>`
  quotes, `---`, `**bold**`, `*italic*`, `` `code` `` and links (http,
  https and mailto only). Notes are rendered as text, never as HTML.

Make one from Customize → **Add widget** (it's placed on that view) or
from Settings → Blocks. Deleting a block takes it off every view; tasks
and events are never changed by blocks.

## Customize mode

- Drag a widget by its handle (mouse, touch, or keyboard: focus the
  handle, Space, arrow keys, Space). The arrow buttons move it too.
- Pick a size and height (desktop), hide or remove a widget, open its
  settings, or add widgets.
- **Done** saves; **Cancel** throws the changes away.
- Built-in views can't lose their built-in widgets, only hide them
  (blocks you placed can be removed); **Reset layout** returns them to
  the default.

## Built-in vs custom views

Dashboard and Today are built in. Their default layout lives in code
(`SYSTEM_VIEWS`); a row is written only once you customize, and Reset
deletes it, so improvements to the defaults reach you unless you have
customized. Built-in views can't be renamed or deleted.

Custom views get a URL (`/views/<key>`), a name, an icon, a place in the
sidebar under **Views** (drag to reorder, or hide), and start from a
preset: Blank, Planning, School or Overview. Deleting a view never
touches tasks or events.

## API

`GET /api/views`, `GET /api/views/widgets`, `POST /api/views`,
`PUT /api/views/order`, `GET|PATCH|DELETE /api/views/{key}`,
`PUT /api/views/{key}/layout`, `POST /api/views/{key}/reset`.
Blocks: `GET|POST /api/blocks`, `GET|PATCH|DELETE /api/blocks/{id}`,
`GET /api/blocks/{id}/items`, `POST /api/blocks/preview` (a smart list's
items before saving). MCP: `list_views`, `get_view`, `list_blocks`,
`get_block_items` (read-only).
