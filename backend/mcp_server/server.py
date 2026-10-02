"""
MCP server exposing the task manager to AI clients (Claude, ChatGPT, Cursor,
etc). Runs against the SAME database as the REST API / web UI by importing
the shared `app.services.*` layer directly and opening its own short-lived
DB session per call — no HTTP hop, no duplicated business logic.

Two ways to run this:

  * Network (default, used by Docker): streamable-HTTP transport bound to
    BIND_HOST:MCP_PORT, protected by a bearer token (API_TOKEN). This is
    what lets an MCP client on your LAN or over Tailscale connect to a
    server running on a Raspberry Pi.

      python -m mcp_server.server --transport http

  * Local stdio (for MCP clients that spawn a local process, e.g. Claude
    Desktop on the same machine the backend code is checked out on):

      python -m mcp_server.server --transport stdio
"""

import argparse
import logging
from datetime import date, datetime, time, timedelta
from typing import List, Optional

from mcp.server.mcpserver import MCPServer
from pydantic import ValidationError
from sqlmodel import Session

from app import db
from app.migrate import assert_at_head
from app.config import get_settings
from app.logging_config import configure_logging
from app.models.enums import RecurrencePattern, TaskPriority, TaskStatus
from app.schemas import (
    CategoryCreate,
    CategoryRead,
    CategoryUpdate,
    CourseCreate,
    CourseUpdate,
    LeetCodeSubmissionImport,
    CalendarSubscriptionCreate,
    CalendarSubscriptionUpdate,
    LeetCodeAttemptCreate,
    LeetCodeGoalsSet,
    EventCreate,
    EventRead,
    EventUpdate,
    OccurrenceEdit,
    FoodEntryCreate,
    FoodEntryRead,
    FoodEntryUpdate,
    NutritionTargetsSet,
    RecurringTaskCreate,
    TaskCreate,
    TaskUpdate,
)
from app.security import constant_time_equals
from app.services import calendar_sync
from app.services import categories as categories_service
from app.services import courses as courses_service
from app.services import planning as planning_service
from app.services import events as events_service
from app.services import leetcode as leetcode_service
from app.services import nutrition as nutrition_service
from app.services import recurrence as recurrence_service
from app.services import tasks as tasks_service
from app.services.priority import rank_tasks
from app.utils import local_today

configure_logging()
logger = logging.getLogger("mcp_server")

mcp = MCPServer(
    name="personal-task-manager",
    version="1.0.0",
    instructions=(
        "Tools for managing the user's personal tasks: LeetCode/DSA "
        "practice, school assignments, projects, errands, and recurring "
        "daily goals. Also a food log: when the user says what they ate, "
        "estimate calories and macros yourself and record them with "
        "log_food, then tell them their totals and what's left from the "
        "returned day summary. And a schedule of events (classes, games, "
        "parties) with standard RRULE recurrence: create_event, "
        "get_schedule, edit_occurrence for single dates. And a LeetCode "
        "tracker for what the user actually solved (separate from tasks, "
        "which are plans): log_leetcode_attempt, then report progress from "
        "the returned stats. Calendar subscriptions: when the user gives an "
        "ICS/webcal calendar URL (Canvas, school, sports, exported Google "
        "calendars) and asks to add it, call add_calendar_subscription: that "
        "creates a LIVE subscription Look re-fetches automatically, so new "
        "and changed events keep arriving. Never import a URL once. "
        "Imported events are read-only, except that deadlines (assignments, "
        "is_deadline/deadline=true) can be checked off with "
        "set_deadline_completed; find them with get_deadlines or "
        "find_events. get_work_plan lists tasks and assignments to do "
        "together. Assignments and class meetings carry their course "
        "(class); map_event_to_course fixes a wrong or missing one. Dates are ISO "
        "'YYYY-MM-DD', times are "
        "'HH:MM' 24-hour."
    ),
)


def _session() -> Session:
    return Session(db.engine)


def _task_dict(task) -> dict:
    return tasks_service.serialize_task(task).model_dump(mode="json")


def _tasks_list(tasks) -> List[dict]:
    return [_task_dict(t) for t in tasks]


def _not_found(task_id: str) -> dict:
    return {"error": f"Task '{task_id}' not found"}


# ---------------------------------------------------------------------------
# Reading tools
# ---------------------------------------------------------------------------


@mcp.tool()
def get_today() -> dict:
    """Get everything relevant to today: tasks explicitly scheduled for
    today, tasks due today, overdue tasks, today's recurring-task
    occurrences, and a few suggested high-priority unscheduled tasks."""
    with _session() as session:
        bundle = tasks_service.get_today_bundle(session)
        return {
            "date": bundle["date"].isoformat(),
            "scheduled": _tasks_list(bundle["scheduled"]),
            "due_today": _tasks_list(bundle["due_today"]),
            "overdue": _tasks_list(bundle["overdue"]),
            "recurring_today": _tasks_list(bundle["recurring_today"]),
            "suggested_high_priority": _tasks_list(bundle["suggested_high_priority"]),
        }


@mcp.tool()
def get_tasks(
    status: Optional[str] = None,
    category: Optional[str] = None,
    priority: Optional[str] = None,
    tag: Optional[str] = None,
    due_before: Optional[str] = None,
    due_after: Optional[str] = None,
    include_completed: bool = True,
) -> List[dict]:
    """List tasks with optional filters. status/priority are single values
    (e.g. 'todo', 'high'); category is free text (e.g. 'LeetCode',
    'school', 'project', 'personal', 'errands'); due_before/due_after are
    ISO dates."""
    with _session() as session:
        tasks = tasks_service.list_tasks(
            session,
            status=TaskStatus(status) if status else None,
            category=category,
            priority=TaskPriority(priority) if priority else None,
            tag=tag,
            due_before=date.fromisoformat(due_before) if due_before else None,
            due_after=date.fromisoformat(due_after) if due_after else None,
            include_completed=include_completed,
        )
        return _tasks_list(tasks)


@mcp.tool()
def get_task(task_id: str) -> dict:
    """Get a single task by id."""
    with _session() as session:
        task = tasks_service.get_task(session, task_id)
        return _task_dict(task) if task else _not_found(task_id)


@mcp.tool()
def get_overdue_tasks() -> List[dict]:
    """Get every task that is past its due date and still open (not
    completed or cancelled)."""
    with _session() as session:
        return _tasks_list(tasks_service.get_overdue(session))


@mcp.tool()
def get_upcoming_tasks(days: int = 7) -> List[dict]:
    """Get tasks due within the next N days (default 7), soonest first."""
    with _session() as session:
        return _tasks_list(tasks_service.get_upcoming(session, days=days))


@mcp.tool()
def search_tasks(query: str) -> List[dict]:
    """Full-text search over task titles, descriptions, and notes."""
    with _session() as session:
        return _tasks_list(tasks_service.search_tasks(session, query))


@mcp.tool()
def get_week_summary(start_date: Optional[str] = None) -> dict:
    """Summarize a week (Mon-Sun, defaults to the current week): tasks
    completed, counts by category, tasks created, and tasks still overdue
    by week's end. Use this to answer 'what did I accomplish this week'."""
    with _session() as session:
        parsed = date.fromisoformat(start_date) if start_date else None
        bundle = tasks_service.get_week_summary(session, parsed)
        return {
            "start_date": bundle["start_date"].isoformat(),
            "end_date": bundle["end_date"].isoformat(),
            "completed_count": bundle["completed_count"],
            "completed_by_category": bundle["completed_by_category"],
            "created_count": bundle["created_count"],
            "overdue_count": bundle["overdue_count"],
            "completed_tasks": _tasks_list(bundle["completed_tasks"]),
        }


@mcp.tool()
def get_priority_ranked_tasks(limit: int = 10) -> List[dict]:
    """Get open tasks ordered by a computed, explainable priority score
    (deadline proximity, manual priority, planned-for-today status,
    effort). Each result includes `priority_reasons`. Use this to answer
    'what should I work on next/tonight'. This never changes any task's
    manually-set priority."""
    with _session() as session:
        open_tasks = tasks_service.list_tasks(session, include_completed=False)
        ranked = rank_tasks(open_tasks, local_today())[:limit]
        results = []
        for task, result in ranked:
            d = _task_dict(task)
            d["priority_score"] = result.score
            d["priority_reasons"] = result.reasons
            results.append(d)
        return results


# ---------------------------------------------------------------------------
# Creating tools
# ---------------------------------------------------------------------------


@mcp.tool()
def create_task(
    title: str,
    description: Optional[str] = None,
    status: str = "inbox",
    priority: str = "medium",
    category: str = "personal",
    tags: Optional[List[str]] = None,
    due_date: Optional[str] = None,
    due_time: Optional[str] = None,
    estimated_duration: Optional[int] = None,
    notes: Optional[str] = None,
    planned_for_date: Optional[str] = None,
) -> dict:
    """Create a new task. Only `title` is required; if you don't have
    enough information to categorize it well, leave status='inbox' and it
    will show up for the user to organize later. estimated_duration is in
    minutes."""
    with _session() as session:
        payload = TaskCreate(
            title=title,
            description=description,
            status=TaskStatus(status),
            priority=TaskPriority(priority),
            category=category,
            tags=tags or [],
            due_date=date.fromisoformat(due_date) if due_date else None,
            due_time=time.fromisoformat(due_time) if due_time else None,
            estimated_duration=estimated_duration,
            notes=notes,
            planned_for_date=date.fromisoformat(planned_for_date) if planned_for_date else None,
            source="mcp",
        )
        return _task_dict(tasks_service.create_task(session, payload))


@mcp.tool()
def create_recurring_task(
    title: str,
    pattern: str,
    start_date: Optional[str] = None,
    category: str = "personal",
    priority: str = "medium",
    description: Optional[str] = None,
    estimated_duration: Optional[int] = None,
    tags: Optional[List[str]] = None,
    days_of_week: Optional[List[int]] = None,
    interval_days: Optional[int] = None,
    day_of_month: Optional[int] = None,
    end_date: Optional[str] = None,
) -> dict:
    """Create a recurring task template, e.g. 'solve 1-2 LeetCode problems
    daily' or 'grocery shopping every Sunday'. pattern is one of:
    daily, weekdays, weekly, specific_days, monthly, custom_interval. For
    specific_days pass days_of_week as ints (0=Monday..6=Sunday). For
    custom_interval pass interval_days. For monthly pass day_of_month.
    Occurrences are generated automatically as their date arrives, each as
    its own task so completing one never affects the others."""
    with _session() as session:
        payload = RecurringTaskCreate(
            title=title,
            description=description,
            category=category,
            priority=TaskPriority(priority),
            estimated_duration=estimated_duration,
            tags=tags or [],
            pattern=RecurrencePattern(pattern),
            days_of_week=days_of_week,
            interval_days=interval_days,
            day_of_month=day_of_month,
            start_date=date.fromisoformat(start_date) if start_date else local_today(),
            end_date=date.fromisoformat(end_date) if end_date else None,
        )
        rule = recurrence_service.create_recurring_task(session, payload)
        return {
            "id": rule.id,
            "title": rule.title,
            "pattern": rule.pattern.value,
            "start_date": rule.start_date.isoformat(),
        }


# ---------------------------------------------------------------------------
# Updating tools
# ---------------------------------------------------------------------------


@mcp.tool()
def update_task(
    task_id: str,
    title: Optional[str] = None,
    description: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    category: Optional[str] = None,
    tags: Optional[List[str]] = None,
    due_date: Optional[str] = None,
    due_time: Optional[str] = None,
    estimated_duration: Optional[int] = None,
    notes: Optional[str] = None,
    planned_for_date: Optional[str] = None,
) -> dict:
    """Update any fields on an existing task. Only pass the fields you want
    to change; omitted fields are left untouched."""
    with _session() as session:
        task = tasks_service.get_task(session, task_id)
        if task is None:
            return _not_found(task_id)
        payload = TaskUpdate(
            title=title,
            description=description,
            status=TaskStatus(status) if status else None,
            priority=TaskPriority(priority) if priority else None,
            category=category,
            tags=tags,
            due_date=date.fromisoformat(due_date) if due_date else None,
            due_time=time.fromisoformat(due_time) if due_time else None,
            estimated_duration=estimated_duration,
            notes=notes,
            planned_for_date=date.fromisoformat(planned_for_date) if planned_for_date else None,
        )
        return _task_dict(tasks_service.update_task(session, task, payload))


@mcp.tool()
def complete_task(task_id: str) -> dict:
    """Mark a task as completed."""
    with _session() as session:
        task = tasks_service.get_task(session, task_id)
        if task is None:
            return _not_found(task_id)
        return _task_dict(tasks_service.complete_task(session, task))


@mcp.tool()
def cancel_task(task_id: str) -> dict:
    """Cancel a task. It stays in history but is marked as not going to be
    done, instead of being deleted."""
    with _session() as session:
        task = tasks_service.get_task(session, task_id)
        if task is None:
            return _not_found(task_id)
        return _task_dict(tasks_service.cancel_task(session, task))


@mcp.tool()
def reschedule_task(
    task_id: str, due_date: Optional[str] = None, due_time: Optional[str] = None
) -> dict:
    """Change a task's due date/time. Omit due_date to clear the deadline
    entirely."""
    with _session() as session:
        task = tasks_service.get_task(session, task_id)
        if task is None:
            return _not_found(task_id)
        new_due = date.fromisoformat(due_date) if due_date else None
        new_time = time.fromisoformat(due_time) if due_time else None
        return _task_dict(tasks_service.reschedule_task(session, task, new_due, new_time))


@mcp.tool()
def set_task_priority(task_id: str, priority: str) -> dict:
    """Set a task's manually-chosen priority: critical, high, medium, or
    low. This is separate from the computed priority score."""
    with _session() as session:
        task = tasks_service.get_task(session, task_id)
        if task is None:
            return _not_found(task_id)
        return _task_dict(tasks_service.set_priority(session, task, TaskPriority(priority)))


@mcp.tool()
def add_task_note(task_id: str, note: str) -> dict:
    """Append a timestamped note to a task."""
    with _session() as session:
        task = tasks_service.get_task(session, task_id)
        if task is None:
            return _not_found(task_id)
        return _task_dict(tasks_service.add_note(session, task, note))


# ---------------------------------------------------------------------------
# Planning tools
# ---------------------------------------------------------------------------


@mcp.tool()
def plan_task_for_today(task_id: str, for_date: Optional[str] = None) -> dict:
    """Add a task to today's (or a given date's) plan WITHOUT changing its
    actual due date. Use this when the user says 'let's work on X today'."""
    with _session() as session:
        task = tasks_service.get_task(session, task_id)
        if task is None:
            return _not_found(task_id)
        parsed = date.fromisoformat(for_date) if for_date else None
        return _task_dict(tasks_service.plan_task_for_today(session, task, parsed))


@mcp.tool()
def remove_task_from_today(task_id: str) -> dict:
    """Remove a task from today's plan without touching its due date."""
    with _session() as session:
        task = tasks_service.get_task(session, task_id)
        if task is None:
            return _not_found(task_id)
        return _task_dict(tasks_service.remove_task_from_today(session, task))


@mcp.tool()
def carry_unfinished_tasks_forward(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    priorities: Optional[List[str]] = None,
) -> List[dict]:
    """Move unfinished tasks planned for one date to another (defaults:
    today -> tomorrow). Optionally restrict to specific priorities, e.g.
    ['low','medium'], to implement 'move unfinished low-priority tasks to
    tomorrow'."""
    with _session() as session:
        f = date.fromisoformat(from_date) if from_date else local_today()
        t = date.fromisoformat(to_date) if to_date else f + timedelta(days=1)
        prio = [TaskPriority(p) for p in priorities] if priorities else None
        return _tasks_list(tasks_service.carry_unfinished_forward(session, f, t, prio))


# ---------------------------------------------------------------------------
# Food log and nutrition targets
# ---------------------------------------------------------------------------


def _error(exc: Exception, prefix: str = "") -> dict:
    if isinstance(exc, ValidationError):
        parts = []
        for err in exc.errors():
            loc = ".".join(str(p) for p in err["loc"])
            parts.append(f"{loc}: {err['msg']}" if loc else err["msg"])
        message = "; ".join(parts)
    else:
        message = str(exc)
    return {"error": f"{prefix}{message}"}


def _food_not_found(entry_id: str) -> dict:
    return {"error": f"No food entry with id '{entry_id}'"}


def _entry_dict(entry) -> dict:
    return FoodEntryRead.model_validate(entry).model_dump(mode="json")


def _day_dict(session: Session, day: Optional[date] = None) -> dict:
    return nutrition_service.day_summary(session, day).model_dump(mode="json")


def _parse_day(value: Optional[str], field: str) -> Optional[date]:
    if value is None:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{field} must be an ISO date like 2026-10-01, got {value!r}.")


@mcp.tool()
def log_food(items: List[FoodEntryCreate]) -> dict:
    """Log what the user ate. Split a meal into one item per food
    ("2 eggs and toast" is two items). You supply the nutrition: estimate
    calories, protein_g, carbs_g and fat_g yourself, searching the web for
    restaurant or branded items, and put the basis of the estimate in
    `notes`. If the user refers to something they've had before ("my usual
    shake"), call search_food_entries first and reuse those numbers.
    `meal` is breakfast, lunch, dinner or snack. `eaten_on` defaults to
    today. If any item is invalid nothing is logged. Returns the new
    entries plus the day's totals, targets and what's left: use that to
    tell the user where they stand."""
    parsed: List[FoodEntryCreate] = []
    for index, item in enumerate(items):
        try:
            parsed.append(
                item if isinstance(item, FoodEntryCreate) else FoodEntryCreate.model_validate(item)
            )
        except ValidationError as exc:
            return _error(exc, prefix=f"items[{index}] ")
    with _session() as session:
        try:
            entries = nutrition_service.log_entries(session, parsed, source="mcp")
        except ValueError as exc:
            return _error(exc)
        dates = sorted({e.eaten_on for e in entries})
        return {
            "entries": [_entry_dict(e) for e in entries],
            "dates": [d.isoformat() for d in dates],
            "day": _day_dict(session, entries[0].eaten_on),
        }


@mcp.tool()
def update_food_entry(
    entry_id: str,
    name: Optional[str] = None,
    calories: Optional[float] = None,
    quantity: Optional[str] = None,
    protein_g: Optional[float] = None,
    carbs_g: Optional[float] = None,
    fat_g: Optional[float] = None,
    meal: Optional[str] = None,
    eaten_on: Optional[str] = None,
    eaten_at: Optional[str] = None,
    notes: Optional[str] = None,
) -> dict:
    """Correct a logged food (e.g. "it was 2 eggs, not 3"). Pass only the
    fields to change. Returns the entry and that day's updated summary."""
    changes = {
        k: v
        for k, v in {
            "name": name,
            "calories": calories,
            "quantity": quantity,
            "protein_g": protein_g,
            "carbs_g": carbs_g,
            "fat_g": fat_g,
            "meal": meal,
            "eaten_on": eaten_on,
            "eaten_at": eaten_at,
            "notes": notes,
        }.items()
        if v is not None
    }
    try:
        payload = FoodEntryUpdate.model_validate(changes)
    except ValidationError as exc:
        return _error(exc)
    with _session() as session:
        entry = nutrition_service.get_entry(session, entry_id)
        if entry is None:
            return _food_not_found(entry_id)
        try:
            entry = nutrition_service.update_entry(session, entry, payload)
        except ValueError as exc:
            return _error(exc)
        return {"entry": _entry_dict(entry), "day": _day_dict(session, entry.eaten_on)}


@mcp.tool()
def delete_food_entry(entry_id: str) -> dict:
    """Permanently delete a logged food. Only do this when the user asks.
    Returns that day's updated summary."""
    with _session() as session:
        entry = nutrition_service.get_entry(session, entry_id)
        if entry is None:
            return _food_not_found(entry_id)
        day = entry.eaten_on
        nutrition_service.delete_entry(session, entry)
        return {"deleted_id": entry_id, "day": _day_dict(session, day)}


@mcp.tool()
def get_nutrition_day(day: Optional[str] = None) -> dict:
    """Everything eaten on one day (default today) in meal order, with
    totals, the targets in effect, what's left, and which macros are over."""
    try:
        parsed = _parse_day(day, "day")
    except ValueError as exc:
        return _error(exc)
    with _session() as session:
        return _day_dict(session, parsed)


@mcp.tool()
def get_nutrition_history(start_date: str, end_date: Optional[str] = None) -> dict:
    """Per-day totals vs targets for a date range (end defaults to today),
    plus averages over the days that have entries. Up to 366 days per call;
    make several calls for longer spans. The full history is kept forever."""
    try:
        start = _parse_day(start_date, "start_date")
        end = _parse_day(end_date, "end_date")
        with _session() as session:
            return nutrition_service.history(session, start, end).model_dump(mode="json")
    except ValueError as exc:
        return _error(exc)


@mcp.tool()
def search_food_entries(query: str, limit: int = 20) -> dict:
    """Find past food entries by name (case-insensitive), newest first.
    Use this to reuse earlier numbers for foods the user eats often."""
    with _session() as session:
        entries = [_entry_dict(e) for e in nutrition_service.search_entries(session, query, limit)]
        return {"entries": entries, "count": len(entries)}


@mcp.tool()
def get_nutrition_targets(day: Optional[str] = None) -> dict:
    """The daily calorie and macro targets in effect on a day (default
    today) and the full history of target changes, newest first."""
    try:
        parsed = _parse_day(day, "day")
    except ValueError as exc:
        return _error(exc)
    with _session() as session:
        return nutrition_service.targets_response(session, parsed).model_dump(mode="json")


@mcp.tool()
def set_nutrition_targets(
    calories: float,
    protein_g: Optional[float] = None,
    carbs_g: Optional[float] = None,
    fat_g: Optional[float] = None,
    effective_from: Optional[str] = None,
) -> dict:
    """Set daily targets. They apply from `effective_from` (default today)
    onward; earlier days keep the targets they had. A macro left out has
    no target. Returns the targets and today's summary against them."""
    try:
        payload = NutritionTargetsSet(
            calories=calories,
            protein_g=protein_g,
            carbs_g=carbs_g,
            fat_g=fat_g,
            effective_from=_parse_day(effective_from, "effective_from"),
        )
    except ValueError as exc:  # ValidationError is a ValueError
        return _error(exc)
    with _session() as session:
        nutrition_service.set_targets(session, payload)
        return {
            "targets": nutrition_service.targets_response(session).model_dump(mode="json"),
            "today": _day_dict(session),
        }


# ---------------------------------------------------------------------------
# Events and schedule
# ---------------------------------------------------------------------------


def _event_not_found(event_id: str) -> dict:
    return {"error": f"No event with id '{event_id}'"}


def _event_context(session: Session, event, dropped=None) -> dict:
    return events_service.with_context(session, event, dropped).model_dump(mode="json")


def _parse_dt(value: str, field: str) -> datetime:
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{field} must be an ISO datetime like 2026-10-01T14:30, got {value!r}.")


@mcp.tool()
def create_event(
    title: str,
    start_at: str,
    end_at: Optional[str] = None,
    all_day: bool = False,
    location: Optional[str] = None,
    category: str = "other",
    notes: Optional[str] = None,
    rrule: Optional[str] = None,
    exdates: Optional[List[str]] = None,
) -> dict:
    """Add an event or a recurring series to the user's schedule.

    Times are local 'YYYY-MM-DDTHH:MM'. All-day events (birthdays, game
    days) take dates: all_day=true and start_at='YYYY-MM-DD'; end_at is
    the day AFTER the last day, or omit it for a single day. category: one
    of class, social, sports, work, appointment, other (or a short word).

    To repeat, pass a standard RFC 5545 RRULE without DTSTART, e.g.
    'FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261212' (MWF class through Dec 12),
    'FREQ=WEEKLY;INTERVAL=2;BYDAY=TH' (every other Thursday),
    'FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1' (last Friday of each month).
    start_at/end_at describe the first occurrence. Give semester-bound
    series an UNTIL. Skip holidays and breaks with exdates (ISO dates). At
    most one occurrence per day. When dates are irregular (a football
    schedule on varying days), create one event per date instead.

    Call check_conflicts first if the user cares about clashes. The result
    has next_occurrences: read them back so the user can confirm the
    pattern, plus any conflicts in the next 60 days."""
    try:
        payload = EventCreate.model_validate(
            {
                "title": title,
                "start_at": start_at,
                "end_at": end_at,
                "all_day": all_day,
                "location": location,
                "category": category,
                "notes": notes,
                "rrule": rrule,
                "exdates": exdates or [],
            }
        )
    except ValidationError as exc:
        return _error(exc)
    with _session() as session:
        try:
            event = events_service.create_event(session, payload, source="mcp")
        except ValueError as exc:
            return _error(exc)
        return _event_context(session, event)


@mcp.tool()
def get_schedule(start_date: str, end_date: Optional[str] = None) -> dict:
    """Every event occurrence between two dates (inclusive; end defaults
    to start), sorted by time, recurring series expanded. Each item has
    event_id and occurrence_date, which edit_occurrence needs. Up to 366
    days per call."""
    try:
        start = _parse_day(start_date, "start_date")
        end = _parse_day(end_date, "end_date") or start
        with _session() as session:
            occs = events_service.occurrences(session, start, end)
            return {
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "occurrences": [o.model_dump(mode="json") for o in occs],
                "count": len(occs),
            }
    except ValueError as exc:
        return _error(exc)


@mcp.tool()
def find_events(query: str, limit: int = 20) -> dict:
    """Find events and series by title, location or category
    (case-insensitive), e.g. 'CS 101', 'stadium', 'sports'."""
    with _session() as session:
        events = [
            EventRead.model_validate(e).model_dump(mode="json")
            for e in events_service.search_events(session, query, limit)
        ]
        return {"events": events, "count": len(events)}


@mcp.tool()
def update_event(
    event_id: str,
    title: Optional[str] = None,
    start_at: Optional[str] = None,
    end_at: Optional[str] = None,
    all_day: Optional[bool] = None,
    location: Optional[str] = None,
    category: Optional[str] = None,
    notes: Optional[str] = None,
    rrule: Optional[str] = None,
    exdates: Optional[List[str]] = None,
) -> dict:
    """Change a one-off event or a WHOLE series. Pass only the fields to
    change; pass '' to clear location, notes or rrule (clearing rrule turns
    a series into a one-off). Changing start_at keeps the duration unless
    end_at is given. exdates replaces the whole skip list. For ONE date of
    a series use edit_occurrence instead. dropped_overrides lists
    single-date changes that no longer fit the new pattern and were
    removed: tell the user about them."""
    changes = {
        k: v
        for k, v in {
            "title": title,
            "start_at": start_at,
            "end_at": end_at,
            "all_day": all_day,
            "location": location,
            "category": category,
            "notes": notes,
            "rrule": rrule,
            "exdates": exdates,
        }.items()
        if v is not None
    }
    try:
        payload = EventUpdate.model_validate(changes)
    except ValidationError as exc:
        return _error(exc)
    with _session() as session:
        event = events_service.get_event(session, event_id)
        if event is None:
            return _event_not_found(event_id)
        try:
            event, dropped = events_service.update_event(session, event, payload)
        except ValueError as exc:
            return _error(exc)
        return _event_context(session, event, dropped)


@mcp.tool()
def edit_occurrence(
    event_id: str,
    day: str,
    cancel: bool = False,
    start_at: Optional[str] = None,
    end_at: Optional[str] = None,
    title: Optional[str] = None,
    location: Optional[str] = None,
    notes: Optional[str] = None,
) -> dict:
    """Change or cancel ONE date of a recurring series without touching
    the rest ('no class Monday', 'this week's game is at 7pm'). day is the
    occurrence_date from get_schedule (the original date, even if it was
    moved). cancel=true skips that date. Otherwise pass the new start_at
    (end keeps the duration unless end_at is given; it may be on another
    day), title, location or notes. Undo with restore_occurrence."""
    changes = {
        k: v
        for k, v in {
            "cancel": cancel,
            "start_at": start_at,
            "end_at": end_at,
            "title": title,
            "location": location,
            "notes": notes,
        }.items()
        if v is not None
    }
    try:
        parsed_day = _parse_day(day, "day")
        payload = OccurrenceEdit.model_validate(changes)
    except ValueError as exc:
        return _error(exc)
    with _session() as session:
        event = events_service.get_event(session, event_id)
        if event is None:
            return _event_not_found(event_id)
        try:
            return events_service.edit_occurrence(session, event, parsed_day, payload).model_dump(mode="json")
        except ValueError as exc:
            return _error(exc)


@mcp.tool()
def restore_occurrence(event_id: str, day: str) -> dict:
    """Undo edit_occurrence for one date: un-cancel it and drop any
    single-date changes so it matches the series again."""
    try:
        parsed_day = _parse_day(day, "day")
    except ValueError as exc:
        return _error(exc)
    with _session() as session:
        event = events_service.get_event(session, event_id)
        if event is None:
            return _event_not_found(event_id)
        try:
            return events_service.restore_occurrence(session, event, parsed_day).model_dump(mode="json")
        except ValueError as exc:
            return _error(exc)


@mcp.tool()
def delete_event(event_id: str) -> dict:
    """Permanently delete a one-off event or a WHOLE series (all dates).
    Only when the user asks. To drop one date use edit_occurrence with
    cancel=true."""
    with _session() as session:
        event = events_service.get_event(session, event_id)
        if event is None:
            return _event_not_found(event_id)
        try:
            events_service.delete_event(session, event)
        except ValueError as exc:
            return _error(exc)
        return {"deleted_id": event_id}


@mcp.tool()
def get_deadlines(start_date: str, end_date: Optional[str] = None, include_completed: bool = True) -> dict:
    """Things due between two dates (inclusive; end defaults to start):
    assignments imported from Canvas or other calendars, each with
    event_id, title (Canvas appends the course code, e.g. '[CS-3214]'),
    start_at (the due time), completed and completion_source ('local' if
    the user checked it, 'external' if the source said so). Up to 366
    days per call."""
    try:
        start = _parse_day(start_date, "start_date")
        end = _parse_day(end_date, "end_date") or start
        with _session() as session:
            due = [
                o.model_dump(mode="json")
                for o in events_service.occurrences(session, start, end)
                if o.deadline and (include_completed or not o.completed)
            ]
            return {"start_date": start.isoformat(), "end_date": end.isoformat(), "deadlines": due, "count": len(due)}
    except ValueError as exc:
        return _error(exc)


@mcp.tool()
def set_deadline_completed(event_id: str, completed: bool = True) -> dict:
    """Check off (completed=true) or un-check a deadline, e.g. 'mark my CS
    3214 assignment done'. Use get_deadlines or find_events to get the
    event_id. Only works on deadlines (is_deadline=true); ordinary events
    can't be completed. This changes only completion: an imported event's
    title, time and other fields stay controlled by its calendar feed, and
    later syncs keep the checkmark."""
    with _session() as session:
        event = events_service.get_event(session, event_id)
        if event is None:
            return _event_not_found(event_id)
        try:
            event = events_service.set_completed(session, event, completed)
        except ValueError as exc:
            return _error(exc)
        return EventRead.model_validate(event).model_dump(mode="json")


@mcp.tool()
def check_conflicts(start_at: str, end_at: str) -> dict:
    """Timed events overlapping a slot ('YYYY-MM-DDTHH:MM' local). Use
    before adding something when the user cares about clashes. All-day
    events are not counted as conflicts."""
    try:
        start = _parse_dt(start_at, "start_at")
        end = _parse_dt(end_at, "end_at")
        with _session() as session:
            occs = events_service.conflicts(session, start, end)
            return {"occurrences": [o.model_dump(mode="json") for o in occs], "count": len(occs)}
    except ValueError as exc:
        return _error(exc)


# ---------------------------------------------------------------------------
# LeetCode tracking
# ---------------------------------------------------------------------------


@mcp.tool()
def log_leetcode_attempt(
    problem_number: int,
    title: Optional[str] = None,
    difficulty: Optional[str] = None,
    topics: Optional[List[str]] = None,
    solved: bool = True,
    solved_independently: Optional[bool] = None,
    hint_used: Optional[bool] = False,
    duration_minutes: Optional[int] = None,
    language: Optional[str] = None,
    confidence: Optional[int] = None,
    notes: Optional[str] = None,
    attempted_at: Optional[str] = None,
) -> dict:
    """Record what the user actually did on a LeetCode problem, solved or
    not. Example: "I solved 560 in 23 minutes in Java, needed one hint,
    confidence 3/5" -> problem_number=560, solved=true, hint_used=true,
    duration_minutes=23, language="Java", confidence=3.

    A problem is identified by its number: logging it again adds an attempt
    to the same problem. title and difficulty (easy/medium/hard) are needed
    only the first time a number is logged; fill them in from your own
    knowledge of LeetCode, along with its main topics/patterns (e.g.
    "Prefix Sum", "Sliding Window", "Graphs", "DP"), which are merged into
    the problem. solved_independently defaults to solved without a hint.
    Pass hint_used=null when it isn't known (never guess false). confidence
    is 1 (very weak) to 5 (very strong). attempted_at is local
    'YYYY-MM-DDTHH:MM', default now. notes are only the user's own words;
    to import past LeetCode submissions use import_leetcode_submissions.

    This is the record of practice; a planned "do 2 LeetCodes" stays a
    task. Returns the attempt and updated progress (today vs goal, streak,
    week) to tell the user where they stand."""
    try:
        payload = LeetCodeAttemptCreate.model_validate({
            "problem_number": problem_number, "title": title, "difficulty": difficulty,
            "topics": topics or [], "solved": solved, "solved_independently": solved_independently,
            "hint_used": hint_used, "duration_minutes": duration_minutes, "language": language,
            "confidence": confidence, "notes": notes, "attempted_at": attempted_at,
        })
    except ValidationError as exc:
        return _error(exc)
    with _session() as session:
        try:
            attempt, problem, created = leetcode_service.log_attempt(session, payload, source="mcp")
        except ValueError as exc:
            return _error(exc)
        return {
            "attempt": leetcode_service.attempt_read(attempt, problem).model_dump(mode="json"),
            "problem_created": created,
            "progress": leetcode_service.stats(session).model_dump(mode="json"),
        }


@mcp.tool()
def import_leetcode_submissions(submissions: List[LeetCodeSubmissionImport]) -> dict:
    """Import past LeetCode submissions, e.g. from the user's lc-solutions
    submission_history.json (fields id, title, titleSlug, statusDisplay,
    lang, timestamp in epoch ms). For each give submission_id (the id),
    problem_number, title and difficulty (look these up from the title, as
    for log_leetcode_attempt), topics, status (statusDisplay; 'Accepted'
    counts as solved), submitted_at (ISO with timezone, from the timestamp)
    and language. Re-importing is safe: submissions already imported are
    skipped. Don't put any import details in notes; hint use, independence,
    duration and confidence are recorded as unknown."""
    with _session() as session:
        try:
            return leetcode_service.import_submissions(session, submissions).model_dump(mode="json")
        except ValueError as exc:
            return _error(exc)


@mcp.tool()
def get_leetcode_progress() -> dict:
    """LeetCode progress: distinct problems solved (and by difficulty),
    attempts, average solve time, hint usage and independent-solve rates,
    current and best streak, solved today / this week against the daily and
    weekly goals, and plain-language insights about weak topics."""
    with _session() as session:
        return leetcode_service.stats(session).model_dump(mode="json")


@mcp.tool()
def get_recent_leetcode_attempts(
    limit: int = 10,
    difficulty: Optional[str] = None,
    topic: Optional[str] = None,
    solved: Optional[bool] = None,
) -> dict:
    """Most recent LeetCode attempts, newest first, each with its problem.
    Optionally filter by difficulty, topic or solved."""
    if difficulty is not None and difficulty not in ("easy", "medium", "hard"):
        return {"error": "difficulty must be easy, medium or hard."}
    with _session() as session:
        attempts = leetcode_service.list_attempts(
            session, limit=limit, difficulty=difficulty, topic=topic, solved=solved
        )
        return {"attempts": [a.model_dump(mode="json") for a in attempts], "count": len(attempts)}


@mcp.tool()
def get_leetcode_topic_stats() -> dict:
    """Per-topic progress, weakest first. weakness (0 strong .. 1 weak) is
    the mean of unsolved rate, not-independent rate, hint rate and low
    confidence over each topic's recent attempts; `reasons` explains it in
    words. Use it to suggest what to practice next."""
    with _session() as session:
        return leetcode_service.topic_stats(session).model_dump(mode="json")


@mcp.tool()
def get_leetcode_problem(problem_number: int) -> dict:
    """One tracked problem by its LeetCode number, with every attempt."""
    with _session() as session:
        problem = leetcode_service.get_problem_by_number(session, problem_number)
        if problem is None:
            return {"error": f"Problem {problem_number} isn't tracked yet."}
        return {
            "problem": leetcode_service.problem_summary(session, problem).model_dump(mode="json"),
            "attempts": [
                a.model_dump(mode="json")
                for a in leetcode_service.list_attempts(session, limit=500, problem_id=problem.id)
            ],
        }


@mcp.tool()
def set_leetcode_goals(daily_target: int, weekly_target: int) -> dict:
    """Set the daily and weekly LeetCode targets (solved problems)."""
    try:
        payload = LeetCodeGoalsSet(daily_target=daily_target, weekly_target=weekly_target)
    except ValidationError as exc:
        return _error(exc)
    with _session() as session:
        return leetcode_service.set_goals(session, payload).model_dump(mode="json")


# ---------------------------------------------------------------------------
# Resources (read-only)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Calendar subscriptions (ICS)
# ---------------------------------------------------------------------------


def _subscription_not_found(subscription_id: str) -> dict:
    return {"error": f"No calendar subscription with id '{subscription_id}'. Use list_calendar_subscriptions."}


@mcp.tool()
def add_calendar_subscription(name: str, url: str, sync_interval_minutes: int = 30) -> dict:
    """Subscribe Look to an ICS calendar URL (https://, http:// or
    webcal://), e.g. a Canvas calendar feed ('.../feeds/calendars/user_...ics'),
    a school or team calendar, or a Google Calendar 'secret address in iCal
    format'. Use this whenever the user gives a calendar URL and wants it in
    Look: it creates a PERSISTENT subscription that Look re-fetches every
    sync_interval_minutes (default 30, 5-1440), so assignments published
    later, moved deadlines and cancellations show up on their own. It also
    syncs once immediately; report the counts (and error, if any; the
    subscription is kept and retried even if the first sync failed).
    name is how events are labeled, e.g. 'Canvas'."""
    try:
        payload = CalendarSubscriptionCreate(name=name, url=url, sync_interval_minutes=sync_interval_minutes)
    except ValidationError as exc:
        return _error(exc)
    with _session() as session:
        try:
            sub = calendar_sync.create_subscription(session, payload)
        except calendar_sync.DuplicateSubscription as exc:
            return {**_error(exc), "subscription": calendar_sync.read(session, exc.existing).model_dump(mode="json")}
        except ValueError as exc:
            return _error(exc)
        return calendar_sync.sync_subscription(session, sub).model_dump(mode="json")


@mcp.tool()
def list_calendar_subscriptions() -> dict:
    """Every calendar source: URL subscriptions (with their interval, last
    sync, last error and how many events they currently provide) and
    one-time .ics file imports (source_type 'file', never re-fetched)."""
    with _session() as session:
        subs = [s.model_dump(mode="json") for s in calendar_sync.list_subscriptions(session)]
        return {"subscriptions": subs, "count": len(subs)}


@mcp.tool()
def sync_calendar_subscription(subscription_id: str) -> dict:
    """Re-fetch a URL subscription now instead of waiting for its interval.
    Returns created/updated/unchanged/removed counts. On a network or feed
    error nothing is changed and status is 'error'."""
    with _session() as session:
        sub = calendar_sync.get_subscription(session, subscription_id)
        if sub is None:
            return _subscription_not_found(subscription_id)
        try:
            return calendar_sync.sync_subscription(session, sub).model_dump(mode="json")
        except ValueError as exc:
            return _error(exc)


@mcp.tool()
def update_calendar_subscription(
    subscription_id: str,
    name: Optional[str] = None,
    enabled: Optional[bool] = None,
    sync_interval_minutes: Optional[int] = None,
) -> dict:
    """Rename a calendar source, pause/resume a URL subscription
    (enabled=false stops syncing; its events stay), or change its interval."""
    try:
        payload = CalendarSubscriptionUpdate.model_validate(
            {k: v for k, v in {"name": name, "enabled": enabled, "sync_interval_minutes": sync_interval_minutes}.items() if v is not None}
        )
    except ValidationError as exc:
        return _error(exc)
    with _session() as session:
        sub = calendar_sync.get_subscription(session, subscription_id)
        if sub is None:
            return _subscription_not_found(subscription_id)
        try:
            sub = calendar_sync.update_subscription(session, sub, payload)
        except ValueError as exc:
            return _error(exc)
        return calendar_sync.read(session, sub).model_dump(mode="json")


@mcp.tool()
def remove_calendar_subscription(subscription_id: str, keep_events: bool = False) -> dict:
    """Remove a calendar source. Only when the user asks, and ask them
    first whether to keep its events: keep_events=true turns them into
    normal, editable Look events; false deletes them with the subscription."""
    with _session() as session:
        sub = calendar_sync.get_subscription(session, subscription_id)
        if sub is None:
            return _subscription_not_found(subscription_id)
        name = sub.name
        result = calendar_sync.delete_subscription(session, sub, keep_events=keep_events)
        return {"removed": name, **result}


@mcp.tool()
def import_ics(content: str, name: str) -> dict:
    """Import raw iCalendar text (BEGIN:VCALENDAR ... END:VCALENDAR) ONCE,
    e.g. pasted or attached .ics content. This is a snapshot that never
    updates by itself; importing again with the same name updates it. If
    the user has a URL instead, use add_calendar_subscription."""
    with _session() as session:
        try:
            return calendar_sync.import_file(session, content.encode(), name).model_dump(mode="json")
        except ValueError as exc:
            return _error(exc)


# ---------------------------------------------------------------------------
# Courses, categories and the combined to-do list
# ---------------------------------------------------------------------------

@mcp.tool()
def get_work_plan(day: Optional[str] = None) -> dict:
    """Everything to do around a day (default today), tasks and imported
    assignments together: overdue (tasks due earlier, assignments from the
    last 14 days not checked off), today (due or planned, done ones
    included), and undated (open tasks with no due date, most important
    first; undated_total says how many exist). Each item has kind
    ('task'/'assignment'), done, due_at and its course if any. Complete a
    task with complete_task, an assignment with set_deadline_completed."""
    try:
        parsed = _parse_day(day, "day")
    except ValueError as exc:
        return _error(exc)
    with _session() as session:
        return planning_service.work_plan(session, parsed).model_dump(mode="json")


@mcp.tool()
def list_courses(include_archived: bool = False) -> dict:
    """The user's classes (e.g. CS 3214), with aliases, linked Canvas
    course contexts and how many events/assignments belong to each. Use the
    id with map_event_to_course."""
    with _session() as session:
        items = [courses_service.read(session, c).model_dump(mode="json")
                 for c in courses_service.list_courses(session, include_archived)]
        return {"courses": items, "count": len(items)}


@mcp.tool()
def create_course(code: str, name: Optional[str] = None, color: Optional[str] = None,
                  style: Optional[str] = None, aliases: Optional[List[str]] = None) -> dict:
    """Add a class, e.g. code='CS 3214', name='Computer Systems'. color:
    red, orange, amber, yellow, lime, green, teal, cyan, sky, blue, indigo, violet, pink or slate (default: one no other course uses). style: solid, soft, outline, striped or glass. aliases are
    other spellings to match ('CS3214'). Existing events titled like
    'CS 3214 lecture' are linked automatically. Canvas courses are usually
    created on their own when the feed syncs."""
    try:
        payload = CourseCreate(code=code, name=name, color=color, style=style, aliases=aliases or [])
    except ValidationError as exc:
        return _error(exc)
    with _session() as session:
        try:
            return courses_service.read(session, courses_service.create_course(session, payload)).model_dump(mode="json")
        except ValueError as exc:
            return _error(exc)


@mcp.tool()
def update_course(course_id: str, code: Optional[str] = None, name: Optional[str] = None,
                  color: Optional[str] = None, style: Optional[str] = None,
                  aliases: Optional[List[str]] = None, archived: Optional[bool] = None) -> dict:
    """Rename or restyle a class (color: red, orange, amber, yellow, lime, green, teal, cyan, sky, blue, indigo, violet, pink or slate; style: solid, soft, outline, striped or glass), replace its aliases, or archive it
    (archived classes stop matching; their items show no course)."""
    raw = {"code": code, "name": name, "color": color, "style": style, "aliases": aliases, "archived": archived}
    try:
        payload = CourseUpdate.model_validate({k: v for k, v in raw.items() if v is not None})
    except ValidationError as exc:
        return _error(exc)
    with _session() as session:
        course = courses_service.get_course(session, course_id)
        if course is None:
            return {"error": f"No course with id '{course_id}'"}
        try:
            return courses_service.read(session, courses_service.update_course(session, course, payload)).model_dump(mode="json")
        except ValueError as exc:
            return _error(exc)


@mcp.tool()
def map_event_to_course(event_id: str, course_id: Optional[str] = None) -> dict:
    """Set which class an event or assignment belongs to (course_id=null:
    none). Never changes anything else about the event. For a Canvas item
    it's remembered for that whole Canvas course, so its other and future
    assignments map the same way."""
    with _session() as session:
        event = events_service.get_event(session, event_id)
        if event is None:
            return _event_not_found(event_id)
        course = None
        if course_id:
            course = courses_service.get_course(session, course_id)
            if course is None:
                return {"error": f"No course with id '{course_id}'"}
        event = courses_service.set_event_course(session, event, course)
        return EventRead.model_validate(event).model_dump(mode="json")


@mcp.tool()
def list_categories(include_archived: bool = False) -> dict:
    """Categories for tasks and events (Personal, School, Research…), each
    with key (what a task/event's category field holds), name, color and
    style."""
    with _session() as session:
        items = [CategoryRead.model_validate(c).model_dump(mode="json")
                 for c in categories_service.list_categories(session, include_archived)]
        return {"categories": items, "count": len(items)}


@mcp.tool()
def create_category(name: str, color: Optional[str] = None, style: Optional[str] = None) -> dict:
    """Add a category, e.g. 'VT Hacks' or 'Recruiting'. color: red, orange, amber, yellow, lime, green, teal, cyan, sky, blue, indigo, violet, pink or slate.
    style: solid, soft, outline, striped or glass. Tasks and events then use its name as their
    category."""
    try:
        payload = CategoryCreate(name=name, color=color, style=style)
    except ValidationError as exc:
        return _error(exc)
    with _session() as session:
        try:
            return CategoryRead.model_validate(categories_service.create_category(session, payload)).model_dump(mode="json")
        except ValueError as exc:
            return _error(exc)


@mcp.tool()
def update_category(category_key: str, name: Optional[str] = None, color: Optional[str] = None,
                    style: Optional[str] = None, archived: Optional[bool] = None) -> dict:
    """Rename, recolor, restyle or archive a category, by its key (from
    list_categories). Items keep it; only its display changes."""
    raw = {"name": name, "color": color, "style": style, "archived": archived}
    try:
        payload = CategoryUpdate.model_validate({k: v for k, v in raw.items() if v is not None})
    except ValidationError as exc:
        return _error(exc)
    with _session() as session:
        category = categories_service.get_by_key(session, category_key)
        if category is None:
            return {"error": f"No category '{category_key}'. Use list_categories."}
        return CategoryRead.model_validate(categories_service.update_category(session, category, payload)).model_dump(mode="json")


@mcp.resource("tasks://today")
def resource_today() -> dict:
    """Today's task bundle: scheduled, due today, overdue, recurring."""
    return get_today()


@mcp.resource("leetcode://progress")
def resource_leetcode_progress() -> dict:
    """LeetCode progress, goals, streak and insights."""
    return get_leetcode_progress()


@mcp.resource("tasks://overdue")
def resource_overdue() -> List[dict]:
    """All overdue tasks."""
    return get_overdue_tasks()


@mcp.resource("tasks://upcoming")
def resource_upcoming() -> List[dict]:
    """Tasks due in the next 7 days."""
    return get_upcoming_tasks()


@mcp.resource("nutrition://today")
def resource_nutrition_today() -> dict:
    """Today's food log, totals and targets."""
    return get_nutrition_day()


@mcp.resource("events://today")
def resource_events_today() -> dict:
    """Today's schedule."""
    return get_schedule(local_today().isoformat())


# ---------------------------------------------------------------------------
# ASGI app (streamable-HTTP transport) with bearer-token auth
# ---------------------------------------------------------------------------


def create_app():
    """ASGI app for the MCP server, wrapped with a bearer-token check so it
    is safe to expose on the LAN / over Tailscale."""
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.requests import Request
    from starlette.responses import JSONResponse

    settings = get_settings()
    inner_app = mcp.streamable_http_app(host=settings.bind_host)

    class TokenAuthMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            if request.url.path.startswith("/health"):
                return await call_next(request)

            auth_header = request.headers.get("authorization", "")
            if not auth_header.lower().startswith("bearer "):
                return JSONResponse({"error": "missing bearer token"}, status_code=401)

            token = auth_header.split(" ", 1)[1].strip()
            if not constant_time_equals(token, settings.api_token):
                return JSONResponse({"error": "invalid token"}, status_code=401)

            return await call_next(request)

    inner_app.add_middleware(TokenAuthMiddleware)

    async def health(_request):
        from starlette.responses import PlainTextResponse

        return PlainTextResponse("ok")

    inner_app.add_route("/health", health)

    return inner_app


def main() -> None:
    parser = argparse.ArgumentParser(description="Personal task manager MCP server")
    parser.add_argument("--transport", choices=["stdio", "http"], default="http")
    args = parser.parse_args()

    # Migrations run before this starts (python -m app.migrate); refuse to
    # serve against a schema this code version wasn't built for.
    assert_at_head(db.engine)

    if args.transport == "stdio":
        logger.info("Starting MCP server on stdio transport")
        mcp.run(transport="stdio")
        return

    import uvicorn

    settings = get_settings()
    logger.info(
        "Starting MCP server on http transport at %s:%s", settings.bind_host, settings.mcp_port
    )
    uvicorn.run(create_app(), host=settings.bind_host, port=settings.mcp_port)


if __name__ == "__main__":
    main()
