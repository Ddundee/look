# Courses, categories and planning

## Courses

A course is a class you take (`CS 3214`). Imported assignments and class
meetings link to it and share its color and style. Every course-linked item
also shows a graduation-cap course badge, so school work is recognizable
without relying on color.

**Matching** (`backend/app/services/courses.py`), strongest evidence first:

1. **A remembered Canvas course.** Canvas item URLs carry the course
   (`…/calendar?include_contexts=course_123…`). Look stores it per event
   (`external_context`) and remembers which course it is (`course_links`).
2. **Canvas's own course code** appended to the title (`Project 2 [CS-3214]`),
   together with a Canvas course context. The course is created if it
   doesn't exist, but only for a recognizable code (letters + number, like
   `CS-3214`), and the Canvas course is remembered.
3. **A bracketed code from another feed,** or a title starting with a course
   code ("CS 3214 lecture"). These only match courses that already exist, by
   code or alias; they never create one.
4. **Otherwise unmapped.** Opaque codes like `[2026FA-13123]` stay unmapped
   until you choose.

**Manual corrections** (event details → Course, `PUT
/api/events/{id}/course`, MCP `map_event_to_course`):
- They're stored as `course_source = "manual"` and never overwritten by a sync.
- For a Canvas item, the Canvas course is linked to your choice and its code
  becomes an alias, so every other item from that Canvas course, now and
  later, maps the same way.
- Choosing "No course" also sticks.

**Archiving** a course hides it from items. Its Canvas links stay, so it
isn't re-created by the next sync.

## Categories

Life areas for tasks and events. Tasks and events store the category as a
plain string, which is the category's `key`. Renaming or restyling a
category never touches them, and typing a new category name creates it
(Soft style, default color).

Built-in set (after migration `0007`):

| Key | Shown as | Look |
|---|---|---|
| `personal` | Personal | blue, soft |
| `school` | School | amber, striped (also every Canvas-course item without a course match) |
| `work` | Career | violet, soft |
| `project` | Projects | teal, outline |
| `organizations` | Organizations | indigo, outline |
| `health` | Health | green, soft |
| `errands` | Errands | orange, outline |
| `social` | Social | pink, glass |
| `other` | Other | slate, soft |
| `LeetCode` | LeetCode | violet, striped |

Migration `0007` changed only built-in categories nobody had edited:
- it renamed by display name (`work` and `project` keep their keys)
- it moved `class` items to School and archived `class`
- it archived `sports` and `appointment` only if unused

Your own categories and anything you've edited are never changed.

## Looks

Two families, told apart by shape as well as color, so they still read in
grayscale:

- **Courses** share one academic signature: a hatched rail beside list
  rows, a cap-icon course badge, and a calm tint with a small hatched rail
  on calendar chips. Only the color differs between classes (the course's
  stored `style` is kept but not used for rendering). New courses get
  colors spread around the wheel: blue, orange, violet, green, pink,
  teal, …
- **Categories** show a small mark whose shape follows the style, and a
  restrained tint:

| Style | Mark | Tint |
|---|---|---|
| `soft` (default) | dot | light |
| `solid` | filled square | a little stronger |
| `outline` | ring | neutral, colored border |
| `striped` | hatched square | faint diagonal lines |
| `glass` | frosted square | soft gradient, border and highlight |

For a course item, the course badge replaces the category and feed name;
items never show a stack of identity badges.

There's no `backdrop-filter`, since these repeat dozens of times on a
screen; Glass is a gradient, a border and a highlight.

Colors come from 14 keys. Pickers show ten first (red, orange, amber,
green, teal, blue, indigo, violet, pink, slate); yellow, lime, cyan and sky
are under "More colors" and stay valid. Only these keys are stored. The CSS
is in `frontend/src/app/globals.css` (`.look-edge`, `.look-mark`,
`.look-fill`, `.look-ink`), and `lib/palette.ts` picks an item's look:
course first, then category.

**Settings → Courses** and **Settings → Categories** list them; a row
opens its editor. A course's aliases and Canvas links are under "Advanced" in its
editor.

## Things to do

`GET /api/today/work` (MCP `get_work_plan`) lists tasks and imported
assignments together:

- **Overdue:** tasks due earlier, and assignments from the last 14 days that
  aren't checked off.
- **Due today:** tasks due or planned today, and assignments due today. Done
  ones stay listed.
- **No due date:** open tasks without a due date, most important first. Only
  the top 6 are listed (`undated_total` has the count). These are never
  called overdue.

Assignments stay events; nothing is copied into tasks. Completing a row
goes to the task API or to the event's complete/uncomplete. Today and the
Dashboard show this as **Things to do**, counted as "to do" rather than
"tasks".

## Now

Today's schedules (Today, Dashboard, and Calendar when today is selected):
- show a **Now · 12:47 PM** line
- mark the event in progress
- scroll their panel to the current part of the day once after loading

"Now" uses `APP_TIMEZONE` (from `/api/system/version`) and updates on the
minute from a single shared timer (`lib/useNow.ts`).
