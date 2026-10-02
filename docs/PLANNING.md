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

What kind of thing a task or event is: Personal, School, Research, SOU, …
Tasks and events still store the category as a plain string. That string
is the category's `key`, so renaming or restyling never touches them, and
typing a new category name creates it with a default look.

Migration `0005` seeded the built-in categories (task: LeetCode, school,
project, personal, errands; event: class, social, sports, work,
appointment, other) with their previous colors, plus every other category
string already in use.

## Looks

A course or category has a **color** (14 keys: red … slate) and a **style**:

| Style | Look |
|---|---|
| `solid` | Full-color edge; tinted chips with a solid stripe |
| `soft` | Lighter edge and tint |
| `outline` | Colored outline, neutral inside |
| `striped` | Dashed edge; diagonal-striped chips |
| `glass` | Translucent, blurred tint with a light border |

Only these keys are stored. The CSS lives in `frontend/src/app/globals.css`
(`.look-edge`, `.look-fill`, `.look-ink`), with light and dark palettes.
`lib/palette.ts` decides an item's look: its course's if it has one,
otherwise its category's.

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
