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

Each widget has a **size** (¼, ⅓, ½, ⅔ or full width of the 12-column
desktop grid; some widgets allow only some sizes) and a **height**
(short, medium, tall, full; a sixth of the screen per unit, so the
default layouts fit one screen). Tablets use two columns, phones one,
both at natural height. A view holds at most 24 widgets.

## Customize mode

- Drag a widget by its handle (mouse, touch, or keyboard: focus the
  handle, Space, arrow keys, Space). The arrow buttons move it too.
- Pick a size and height (desktop), hide or remove a widget, open its
  settings, or add widgets.
- **Done** saves; **Cancel** throws the changes away.
- Built-in views can't lose widgets, only hide them; **Reset layout**
  returns them to the default.

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
`PUT /api/views/{key}/layout`, `POST /api/views/{key}/reset`. MCP:
`list_views`, `get_view` (read-only).
