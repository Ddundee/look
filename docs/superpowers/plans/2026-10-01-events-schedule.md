# Events and Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user (mostly through ChatGPT over MCP) build up a schedule of one-off and complex recurring events, shown on the Calendar and Today pages.

**Architecture:** Two new SQLModel tables (`events`, `event_overrides`). A series stores one RFC 5545 RRULE and is expanded on read with `python-dateutil`; single dates are skipped (`exdates`) or changed/cancelled (`event_overrides`). One service module (`app/services/events.py`) is shared by a new REST router (`/api/events`) and new MCP tools, exactly like tasks and nutrition. Frontend adds event components (agenda list, event form, single-date form, scope chooser) and wires them into Calendar and Today.

**Tech Stack:** FastAPI, SQLModel/SQLAlchemy 2.0, Pydantic 2.13, `python-dateutil` 2.9 (new), `mcp` 2.x `MCPServer`, pytest; Next.js 16 client components, Tailwind v4 tokens, `@phosphor-icons/react`.

**Spec:** `docs/superpowers/specs/2026-10-01-events-schedule-design.md`

**Code blocks:** every block that a step says to write is preceded by a marker line: `<!-- file: PATH -->` (create/replace the whole file), `<!-- append: PATH -->` (append to the end), or `<!-- insert-before: PATH :: MARKER -->` (insert immediately above the `# ----` banner line that sits directly above the first line equal to MARKER, i.e. above that whole section header). PATH is relative to the repo root.

## Global Constraints

- Times are naive local wall-clock datetimes in `APP_TIMEZONE`. All-day events are midnight-to-midnight with an exclusive end.
- RRULEs are stored without `DTSTART`; at most one occurrence per day (no `BYHOUR`/`BYMINUTE`/`BYSECOND`, no `HOURLY`/`MINUTELY`/`SECONDLY`).
- A date-only `UNTIL` means "through that day" (normalized to `T235959`); a trailing `Z` on `UNTIL` is dropped (local time).
- Schedule ranges: at most 366 days and 2000 occurrences per call.
- Deletes are real; nothing deletes automatically, except overrides orphaned by a series rule/start change, which are reported back.
- `source` is `"mcp"` for MCP-created events, `"manual"` for web/REST.
- Frontend: semantic tokens only, Phosphor icons only, no em-dashes in visible copy, both themes, phone width, hyphen (not en-dash) in time ranges.
- Existing backend tests (99) keep passing.

## Review Focus

1. **`UNTIL=20261212` written date-only** must include Dec 12 (dateutil alone would stop at midnight before it). Pinned in Task 2 `test_weekly_multi_day_with_until_and_exdates`.
2. **An occurrence that starts before the requested range but runs into it** (late-night event crossing midnight) must appear. Pinned in Task 2 `test_occurrence_starting_before_range_and_crossing_midnight`.
3. **A single date moved to another day** must show on the new day and not the old one. Pinned in Task 2 `test_moved_into_and_out_of_range`.
4. **Changing a series' days** must drop single-date edits that no longer land on a series date, and report them. Pinned in Task 2 `test_update_series_prunes_orphaned_overrides`.
5. **ChatGPT pasting `RRULE:` prefixes or a `DTSTART` line** must be normalized or rejected with a clear message, never silently ignore the event's start. Pinned in Task 2 `test_normalize_rrule` / `test_normalize_rejects`.

---

## File Structure

Backend (`backend/`):
- `requirements.txt` (modify): add `python-dateutil>=2.9`.
- `app/models/events.py` (create): `Event`, `EventOverride`.
- `app/models/__init__.py` (modify): register them.
- `app/schemas.py` (modify): event schemas.
- `app/services/events.py` (create): rules, CRUD, expansion, preview, conflicts.
- `app/routers/events.py` (create), `app/main.py` (modify).
- `mcp_server/server.py` (modify): 8 tools + `events://today`.
- `tests/test_events_service.py`, `tests/test_events_api.py`, `tests/test_events_mcp.py` (create).

Docs: `docs/MCP.md` (modify).

Frontend (`frontend/src/`):
- `lib/types.ts`, `lib/api.ts`, `lib/events.ts` (modify): types, client, `onEventsChanged`/`notifyEventsChanged`.
- `lib/calendarEvents.ts` (create): categories, hues, time labels, repeat presets <-> RRULE.
- `components/Dialog.tsx` (modify): `hint` prop, wrapping footer.
- `components/events/AgendaList.tsx`, `EventModal.tsx`, `OccurrenceModal.tsx`, `EventEditor.tsx` (create).
- `app/calendar/page.tsx` (replace), `app/today/page.tsx` (modify).

---

### Task 1: Models, schemas, dependency

**Files:** `backend/requirements.txt`, `backend/app/models/events.py`, `backend/app/models/__init__.py`, `backend/app/schemas.py`, test `backend/tests/test_events_service.py`

**Interfaces — Produces:** tables `Event` (`exdates: List[str]` ISO dates), `EventOverride`; schemas `EventCreate`, `EventUpdate`, `OccurrenceEdit`, `EventRead`, `Occurrence`, `EventWithContext`, `ScheduleResponse`, `EventList`.

- [ ] **Step 1: Failing test**

<!-- file: backend/tests/test_events_service.py -->
```python
from datetime import date, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.models.events import Event, EventOverride
from app.schemas import EventCreate, EventUpdate, OccurrenceEdit


def dt(s: str) -> datetime:
    return datetime.fromisoformat(s)


def test_event_create_schema_parses_dates_and_strips_title():
    e = EventCreate(title="  CS 101 ", start_at="2026-08-24T10:00", end_at="2026-08-24T10:50", exdates=["2026-11-27"])
    assert e.title == "CS 101" and e.start_at == dt("2026-08-24T10:00")
    assert e.exdates == [date(2026, 11, 27)] and e.category == "other" and e.end_at is not None


def test_event_create_schema_accepts_date_only_start():
    assert EventCreate(title="Game day", start_at="2026-10-03", all_day=True).start_at == dt("2026-10-03T00:00")


@pytest.mark.parametrize("bad", [{"title": ""}, {"title": "   "}, {"title": "x", "start_at": "soon"}])
def test_event_create_schema_rejects(bad):
    with pytest.raises(ValidationError):
        EventCreate(**{"start_at": "2026-08-24T10:00", **bad})


def test_tables_persist(session):
    from sqlmodel import select

    ev = Event(title="X", start_at=dt("2026-08-24T10:00"), end_at=dt("2026-08-24T11:00"), exdates=["2026-08-31"])
    session.add(ev)
    session.commit()
    session.add(EventOverride(event_id=ev.id, original_date=date(2026, 8, 24), cancelled=True))
    session.commit()
    got = session.exec(select(Event)).one()
    assert got.exdates == ["2026-08-31"] and got.source == "manual" and got.category == "other"
    assert session.exec(select(EventOverride)).one().cancelled is True
```

- [ ] **Step 2: Run, expect FAIL** — `cd backend && .venv/bin/pytest tests/test_events_service.py -q` → `ModuleNotFoundError: No module named 'app.models.events'`.

- [ ] **Step 3: Implement**

`backend/requirements.txt`: add the line `python-dateutil>=2.9` after `tzdata>=2024.1`, and run `.venv/bin/pip install -r requirements.txt`.

<!-- file: backend/app/models/events.py -->
```python
import uuid
from datetime import date, datetime
from typing import List, Optional

from sqlalchemy import Column, JSON, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.utils import utcnow


def _uuid() -> str:
    return str(uuid.uuid4())


class Event(SQLModel, table=True):
    """A one-off event, or a recurring series when `rrule` is set.
    Occurrences of a series are computed on read (app.services.events),
    never stored as rows."""

    __tablename__ = "events"

    id: str = Field(default_factory=_uuid, primary_key=True)
    title: str
    location: Optional[str] = None
    notes: Optional[str] = None
    category: str = Field(default="other", index=True)
    all_day: bool = False
    # Local wall-clock times in APP_TIMEZONE. For all-day events both are
    # midnight and end_at is exclusive (the day after the last day).
    start_at: datetime = Field(index=True)
    end_at: datetime
    # RFC 5545 RRULE body without DTSTART; None for one-off events.
    rrule: Optional[str] = None
    # Skipped occurrence dates as ISO strings (JSON can't hold date objects).
    exdates: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    source: str = Field(default="manual")
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class EventOverride(SQLModel, table=True):
    """One changed or cancelled date of a recurring series. Null fields
    inherit from the series."""

    __tablename__ = "event_overrides"
    __table_args__ = (UniqueConstraint("event_id", "original_date"),)

    id: str = Field(default_factory=_uuid, primary_key=True)
    event_id: str = Field(foreign_key="events.id", index=True)
    original_date: date
    cancelled: bool = False
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    title: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
```

`backend/app/models/__init__.py`: add `from app.models.events import Event, EventOverride` and `"Event", "EventOverride"` to `__all__`.

<!-- append: backend/app/schemas.py -->
```python


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------


def _clean_title(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    if not value:
        raise ValueError("title can't be blank")
    return value


class EventCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    start_at: datetime
    end_at: Optional[datetime] = None  # all-day events default to one day
    all_day: bool = False
    location: Optional[str] = Field(default=None, max_length=200)
    category: str = Field(default="other", min_length=1, max_length=50)
    notes: Optional[str] = None
    rrule: Optional[str] = None
    exdates: List[date] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def _title(cls, v: Optional[str]) -> Optional[str]:
        return _clean_title(v)


class EventUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    all_day: Optional[bool] = None
    location: Optional[str] = Field(default=None, max_length=200)
    category: Optional[str] = Field(default=None, min_length=1, max_length=50)
    notes: Optional[str] = None
    rrule: Optional[str] = None
    exdates: Optional[List[date]] = None

    @field_validator("title")
    @classmethod
    def _title(cls, v: Optional[str]) -> Optional[str]:
        return _clean_title(v)


class OccurrenceEdit(BaseModel):
    cancel: bool = False
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    location: Optional[str] = Field(default=None, max_length=200)
    notes: Optional[str] = None

    @field_validator("title")
    @classmethod
    def _title(cls, v: Optional[str]) -> Optional[str]:
        return _clean_title(v)


class EventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    location: Optional[str]
    notes: Optional[str]
    category: str
    all_day: bool
    start_at: datetime
    end_at: datetime
    rrule: Optional[str]
    exdates: List[date]
    source: str
    created_at: datetime
    updated_at: datetime


class Occurrence(BaseModel):
    event_id: str
    occurrence_date: date  # original series date; the start date for one-offs
    start_at: datetime
    end_at: datetime
    all_day: bool
    title: str
    location: Optional[str]
    category: str
    notes: Optional[str]
    recurring: bool
    rrule: Optional[str]
    overridden: bool = False
    cancelled: bool = False


class EventWithContext(BaseModel):
    event: EventRead
    next_occurrences: List[Occurrence]
    conflicts: List[Occurrence]
    dropped_overrides: List[date] = Field(default_factory=list)


class ScheduleResponse(BaseModel):
    start_date: date
    end_date: date
    occurrences: List[Occurrence]
    count: int


class EventList(BaseModel):
    events: List[EventRead]
    count: int
```

- [ ] **Step 4: Run** — `cd backend && .venv/bin/pytest tests/test_events_service.py -q && .venv/bin/pytest -q` → all PASS.

- [ ] **Step 5: Commit** — `git add backend/requirements.txt backend/app/models backend/app/schemas.py backend/tests/test_events_service.py && git commit -m "Add event and event override models and schemas"`

---

### Task 2: Events service

**Files:** create `backend/app/services/events.py`; append to `backend/tests/test_events_service.py`

**Interfaces — Produces (module `app.services.events`):** constants `MAX_RANGE_DAYS=366`, `MAX_OCCURRENCES=2000`, `CONFLICT_WINDOW_DAYS=60`, `MAX_CONFLICTS=20`; `normalize_rrule(raw) -> Optional[str]`; `build_rule(rule, dtstart) -> dateutil rrule`; `draft_event(payload: EventCreate, source) -> Event` (validated, unsaved); `create_event(session, payload, source="manual") -> Event`; `get_event`; `search_events(session, query, limit=20) -> List[Event]`; `update_event(session, event, changes: EventUpdate) -> Tuple[Event, List[date]]`; `delete_event(session, event)`; `edit_occurrence(session, event, day, changes: OccurrenceEdit) -> Occurrence`; `restore_occurrence(session, event, day) -> Occurrence`; `occurrences(session, start, end, include_cancelled=False) -> List[Occurrence]`; `preview(session, event, count=5) -> List[Occurrence]`; `conflicts(session, start_at, end_at, exclude_event_id=None) -> List[Occurrence]`; `upcoming_conflicts(session, event) -> List[Occurrence]`; `with_context(session, event, dropped=None) -> EventWithContext`. All validation failures raise `ValueError`.

- [ ] **Step 1: Failing tests**

<!-- append: backend/tests/test_events_service.py -->
```python


from app.services import events as svc  # noqa: E402


def make(session, **kw):
    data = {"title": "Event", "start_at": "2026-08-24T10:00", "end_at": "2026-08-24T10:50", **kw}
    return svc.create_event(session, EventCreate.model_validate(data))


def series(session):
    return make(session, title="CS 101", rrule="FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261212")


def starts(occs):
    return [o.start_at.isoformat(timespec="minutes") for o in occs]


def days_of(occs):
    return [o.occurrence_date.isoformat() for o in occs]


def test_normalize_rrule():
    assert svc.normalize_rrule(None) is None
    assert svc.normalize_rrule("  ") is None
    assert svc.normalize_rrule("RRULE:freq=weekly;byday=mo;") == "FREQ=WEEKLY;BYDAY=MO"
    assert svc.normalize_rrule("FREQ=DAILY;UNTIL=20261212") == "FREQ=DAILY;UNTIL=20261212T235959"
    assert svc.normalize_rrule("FREQ=DAILY;UNTIL=20261212T050000Z") == "FREQ=DAILY;UNTIL=20261212T050000"


@pytest.mark.parametrize("rule", ["DTSTART:20260101T000000\nRRULE:FREQ=DAILY", "FREQ=DAILY;BYHOUR=9,17"])
def test_normalize_rejects(rule):
    with pytest.raises(ValueError):
        svc.normalize_rrule(rule)


@pytest.mark.parametrize(
    "kw",
    [
        {"rrule": "FREQ=WEEKLY;BYDAY=XX"},
        {"rrule": "FREQ=HOURLY"},
        {"rrule": "FREQ=DAILY;UNTIL=20260101"},
        {"end_at": "2026-08-24T09:00"},
        {"end_at": None},
        {"all_day": True},
    ],
)
def test_create_rejects_invalid(session, kw):
    with pytest.raises(ValueError):
        make(session, **kw)


def test_all_day_defaults_to_one_day(session):
    e = make(session, all_day=True, start_at="2026-10-03", end_at=None)
    assert e.end_at == dt("2026-10-04T00:00")
    occs = svc.occurrences(session, date(2026, 10, 3), date(2026, 10, 3))
    assert [o.title for o in occs] == ["Event"] and occs[0].all_day
    assert svc.occurrences(session, date(2026, 10, 4), date(2026, 10, 4)) == []


def test_multi_day_all_day_spans_range(session):
    make(session, title="Trip", all_day=True, start_at="2026-10-09", end_at="2026-10-12")
    assert [o.title for o in svc.occurrences(session, date(2026, 10, 11), date(2026, 10, 11))] == ["Trip"]


def test_weekly_multi_day_with_until_and_exdates(session):
    make(session, title="CS 101", rrule="FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20260904", exdates=["2026-08-31"])
    occs = svc.occurrences(session, date(2026, 8, 24), date(2026, 9, 30))
    assert starts(occs) == [
        "2026-08-24T10:00", "2026-08-26T10:00", "2026-08-28T10:00", "2026-09-02T10:00", "2026-09-04T10:00",
    ]
    assert all(o.recurring and o.end_at - o.start_at == timedelta(minutes=50) for o in occs)


def test_count_interval_and_last_friday(session):
    make(session, title="Every other Thu", start_at="2026-09-03T18:00", end_at="2026-09-03T19:00",
         rrule="FREQ=WEEKLY;INTERVAL=2;COUNT=3")
    make(session, title="Last Fri", start_at="2026-09-01T20:00", end_at="2026-09-01T23:00",
         rrule="FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1")
    occs = svc.occurrences(session, date(2026, 9, 1), date(2026, 11, 30))
    assert [o.start_at.date().isoformat() for o in occs if o.title == "Every other Thu"] == [
        "2026-09-03", "2026-09-17", "2026-10-01"]
    assert [o.start_at.date().isoformat() for o in occs if o.title == "Last Fri"] == [
        "2026-09-25", "2026-10-30", "2026-11-27"]


def test_occurrence_starting_before_range_and_crossing_midnight(session):
    make(session, title="Party", start_at="2026-10-02T22:00", end_at="2026-10-03T02:00")
    make(session, title="Late study", start_at="2026-09-01T23:00", end_at="2026-09-02T01:00", rrule="FREQ=DAILY")
    occs = svc.occurrences(session, date(2026, 10, 3), date(2026, 10, 3))
    assert ("Party", "2026-10-02T22:00") in [(o.title, o.start_at.isoformat(timespec="minutes")) for o in occs]
    assert days_of([o for o in occs if o.title == "Late study"]) == ["2026-10-02", "2026-10-03"]


def test_open_ended_series_far_in_future(session):
    make(session, title="Gym", rrule="FREQ=WEEKLY;BYDAY=TU")
    assert len(svc.occurrences(session, date(2030, 1, 1), date(2030, 1, 31))) == 5


def test_range_and_count_caps(session, monkeypatch):
    with pytest.raises(ValueError, match="366"):
        svc.occurrences(session, date(2026, 1, 1), date(2027, 1, 2))
    with pytest.raises(ValueError):
        svc.occurrences(session, date(2026, 1, 5), date(2026, 1, 1))
    make(session, rrule="FREQ=DAILY")
    monkeypatch.setattr(svc, "MAX_OCCURRENCES", 10)
    with pytest.raises(ValueError, match="smaller range"):
        svc.occurrences(session, date(2026, 9, 1), date(2026, 9, 30))


def test_cancel_and_restore_occurrence(session):
    e = series(session)
    cancelled = svc.edit_occurrence(session, e, date(2026, 8, 26), OccurrenceEdit(cancel=True))
    assert cancelled.cancelled

    def week(**kw):
        return days_of(svc.occurrences(session, date(2026, 8, 24), date(2026, 8, 28), **kw))

    assert week() == ["2026-08-24", "2026-08-28"]
    assert week(include_cancelled=True) == ["2026-08-24", "2026-08-26", "2026-08-28"]
    restored = svc.restore_occurrence(session, e, date(2026, 8, 26))
    assert not restored.overridden and not restored.cancelled
    assert week() == ["2026-08-24", "2026-08-26", "2026-08-28"]


def test_move_and_edit_one_occurrence(session):
    e = series(session)
    occ = svc.edit_occurrence(
        session, e, date(2026, 8, 26), OccurrenceEdit(start_at=dt("2026-08-26T14:00"), location="Room 210"))
    assert occ.start_at == dt("2026-08-26T14:00") and occ.end_at == dt("2026-08-26T14:50")
    assert occ.location == "Room 210" and occ.title == "CS 101" and occ.overridden
    moved = svc.occurrences(session, date(2026, 8, 26), date(2026, 8, 26))
    assert [(o.start_at.hour, o.location) for o in moved] == [(14, "Room 210")]


def test_moved_into_and_out_of_range(session):
    e = series(session)
    svc.edit_occurrence(session, e, date(2026, 8, 28), OccurrenceEdit(start_at=dt("2026-08-29T09:00")))
    assert days_of(svc.occurrences(session, date(2026, 8, 29), date(2026, 8, 29))) == ["2026-08-28"]
    assert svc.occurrences(session, date(2026, 8, 28), date(2026, 8, 28)) == []


def test_edit_occurrence_rejects_non_dates(session):
    e = series(session)
    with pytest.raises(ValueError, match="isn't a date"):
        svc.edit_occurrence(session, e, date(2026, 8, 25), OccurrenceEdit(cancel=True))
    one = make(session, title="Once")
    with pytest.raises(ValueError, match="one-off"):
        svc.edit_occurrence(session, one, date(2026, 8, 24), OccurrenceEdit(cancel=True))


def test_update_series_prunes_orphaned_overrides(session):
    e = series(session)
    svc.edit_occurrence(session, e, date(2026, 8, 26), OccurrenceEdit(cancel=True))
    svc.edit_occurrence(session, e, date(2026, 8, 28), OccurrenceEdit(title="Quiz"))
    _, dropped = svc.update_event(session, e, EventUpdate(rrule="FREQ=WEEKLY;BYDAY=MO,FR;UNTIL=20261212"))
    assert dropped == [date(2026, 8, 26)]
    assert [o.title for o in svc.occurrences(session, date(2026, 8, 28), date(2026, 8, 28))] == ["Quiz"]


def test_update_keeps_duration_and_clears_with_empty_string(session):
    e = make(session, location="Hall A", rrule="FREQ=DAILY;COUNT=3")
    updated, _ = svc.update_event(session, e, EventUpdate(start_at=dt("2026-08-24T13:00"), location="", rrule=""))
    assert updated.end_at == dt("2026-08-24T13:50")
    assert updated.location is None and updated.rrule is None


def test_update_rejects_clearing_required(session):
    e = make(session)
    with pytest.raises(ValueError, match="start_at"):
        svc.update_event(session, e, EventUpdate.model_validate({"start_at": None}))


def test_delete_series_removes_overrides(session):
    from sqlmodel import select

    e = series(session)
    svc.edit_occurrence(session, e, date(2026, 8, 26), OccurrenceEdit(cancel=True))
    svc.delete_event(session, e)
    assert svc.get_event(session, e.id) is None
    assert session.exec(select(EventOverride)).all() == []


def test_preview_skips_exdates_and_cancelled(session, monkeypatch):
    monkeypatch.setattr(svc, "local_today", lambda: date(2026, 8, 1))
    e = make(session, rrule="FREQ=DAILY;COUNT=5", exdates=["2026-08-25"])
    svc.edit_occurrence(session, e, date(2026, 8, 26), OccurrenceEdit(cancel=True))
    assert days_of(svc.preview(session, e)) == ["2026-08-24", "2026-08-27", "2026-08-28"]


def test_conflicts_ignore_all_day_and_adjacent(session):
    make(session, title="CS 101", rrule="FREQ=WEEKLY;BYDAY=MO,WE,FR")
    make(session, title="Holiday", all_day=True, start_at="2026-08-26", end_at=None)
    hits = svc.conflicts(session, dt("2026-08-26T10:30"), dt("2026-08-26T11:30"))
    assert [h.title for h in hits] == ["CS 101"]
    assert svc.conflicts(session, dt("2026-08-26T10:50"), dt("2026-08-26T12:00")) == []


def test_with_context_reports_upcoming_conflicts(session, monkeypatch):
    monkeypatch.setattr(svc, "local_today", lambda: date(2026, 8, 20))
    make(session, title="CS 101", rrule="FREQ=WEEKLY;BYDAY=MO,WE,FR")
    gym = make(session, title="Gym", start_at="2026-08-26T10:30", end_at="2026-08-26T11:30")
    ctx = svc.with_context(session, gym)
    assert [c.title for c in ctx.conflicts] == ["CS 101"]
    assert [o.title for o in ctx.next_occurrences] == ["Gym"]


def test_search_events(session):
    make(session, title="Football vs Michigan", category="sports", location="Stadium")
    make(session, title="CS 101", category="class")
    assert [e.title for e in svc.search_events(session, "STADIUM")] == ["Football vs Michigan"]
    assert [e.title for e in svc.search_events(session, "class")] == ["CS 101"]
    assert svc.search_events(session, "%") == []
    assert svc.search_events(session, "  ") == []
```

- [ ] **Step 2: Run, expect FAIL** — `ImportError: cannot import name 'events' from 'app.services'`.

- [ ] **Step 3: Implement**

<!-- file: backend/app/services/events.py -->
```python
"""Events and recurring series.

A series stores one RFC 5545 RRULE; occurrences are computed on read with
python-dateutil and never stored. Single dates are skipped via `exdates`
or changed/cancelled via `EventOverride` rows. Shared by the REST router
and the MCP server, like `app.services.tasks`.
"""

import re
from datetime import date, datetime, time, timedelta
from typing import Dict, Iterable, List, Optional, Tuple

from dateutil.rrule import HOURLY, MINUTELY, SECONDLY, rrule as RRule, rrulestr
from sqlalchemy import or_
from sqlmodel import Session, col, select

from app.models.events import Event, EventOverride
from app.schemas import (
    EventCreate,
    EventRead,
    EventUpdate,
    EventWithContext,
    Occurrence,
    OccurrenceEdit,
)
from app.utils import local_today, utcnow

MAX_RANGE_DAYS = 366
MAX_OCCURRENCES = 2000
CONFLICT_WINDOW_DAYS = 60
MAX_CONFLICTS = 20
_PREVIEW_SCAN_LIMIT = 1000
_NOT_CLEARABLE = ("title", "start_at", "end_at", "all_day", "category")


# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------


def normalize_rrule(raw: Optional[str]) -> Optional[str]:
    """Tidy a client-supplied rule: strip an `RRULE:` prefix, upper-case
    it, treat a date-only UNTIL as the end of that day (clients mean
    "through Dec 12"; RFC 5545 would stop at its midnight) and drop a UTC
    `Z` so UNTIL is local like every other time here. Empty -> None."""
    if raw is None:
        return None
    rule = raw.strip()
    if rule.upper().startswith("RRULE:"):
        rule = rule[len("RRULE:"):]
    rule = rule.strip().strip(";").upper()
    if not rule:
        return None
    if "\n" in rule or "DTSTART" in rule:
        raise ValueError(
            "rrule must be a single RRULE line without DTSTART; the start comes from start_at."
        )
    if re.search(r"(^|;)BY(HOUR|MINUTE|SECOND)=", rule):
        raise ValueError(
            "rrule can repeat at most once per day; set the time with start_at "
            "instead of BYHOUR/BYMINUTE/BYSECOND."
        )
    rule = re.sub(r"(UNTIL=\d{8})(?=;|$)", r"\1T235959", rule)
    rule = re.sub(r"(UNTIL=\d{8}T\d{6})Z", r"\1", rule)
    return rule


def build_rule(rule: str, dtstart: datetime) -> RRule:
    try:
        parsed = rrulestr(rule, dtstart=dtstart)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"Invalid rrule {rule!r}: {exc}") from None
    if not isinstance(parsed, RRule):
        raise ValueError(f"Invalid rrule {rule!r}: expected a single RRULE.")
    # dateutil exposes the frequency only as a private attribute.
    if parsed._freq in (HOURLY, MINUTELY, SECONDLY):
        raise ValueError("rrule FREQ must be DAILY, WEEKLY, MONTHLY or YEARLY.")
    return parsed


def _validate(start_at: datetime, end_at: datetime, all_day: bool, rule: Optional[str]) -> None:
    if end_at <= start_at:
        raise ValueError("end_at must be after start_at.")
    if all_day and (start_at.time() != time.min or end_at.time() != time.min):
        raise ValueError(
            "All-day events take whole dates: start_at and end_at at midnight, "
            "end_at being the day after the last day."
        )
    if rule and build_rule(rule, start_at).after(start_at, inc=True) is None:
        raise ValueError("rrule produces no dates on or after start_at; check UNTIL/COUNT.")


def _occurrence_start(rule: RRule, day: date) -> Optional[datetime]:
    hits = rule.between(datetime.combine(day, time.min), datetime.combine(day, time.max), inc=True)
    return hits[0] if hits else None


def _occ(
    event: Event, start: datetime, original: date, override: Optional[EventOverride] = None
) -> Occurrence:
    duration = event.end_at - event.start_at
    start_at, end_at = start, start + duration
    if override is not None and override.start_at is not None:
        start_at = override.start_at
        end_at = override.end_at or override.start_at + duration

    def pick(field: str):
        value = getattr(override, field) if override is not None else None
        return value if value is not None else getattr(event, field)

    return Occurrence(
        event_id=event.id,
        occurrence_date=original,
        start_at=start_at,
        end_at=end_at,
        all_day=event.all_day,
        title=pick("title"),
        location=pick("location"),
        category=event.category,
        notes=pick("notes"),
        recurring=bool(event.rrule),
        rrule=event.rrule,
        overridden=override is not None,
        cancelled=bool(override is not None and override.cancelled),
    )


def _overrides(session: Session, event_ids: Iterable[str]) -> Dict[str, Dict[date, EventOverride]]:
    ids = list(event_ids)
    if not ids:
        return {}
    rows = session.exec(select(EventOverride).where(col(EventOverride.event_id).in_(ids))).all()
    out: Dict[str, Dict[date, EventOverride]] = {}
    for ov in rows:
        out.setdefault(ov.event_id, {})[ov.original_date] = ov
    return out


def _override_for(session: Session, event: Event, day: date) -> Optional[EventOverride]:
    return session.exec(
        select(EventOverride).where(
            EventOverride.event_id == event.id, EventOverride.original_date == day
        )
    ).first()


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------


def draft_event(payload: EventCreate, source: str = "manual") -> Event:
    """Validate a create payload and build the (unsaved) Event."""
    rule = normalize_rrule(payload.rrule)
    end_at = payload.end_at
    if end_at is None:
        if not payload.all_day:
            raise ValueError("end_at is required for timed events.")
        end_at = payload.start_at + timedelta(days=1)
    _validate(payload.start_at, end_at, payload.all_day, rule)
    return Event(
        title=payload.title,
        location=(payload.location or "").strip() or None,
        notes=(payload.notes or "").strip() or None,
        category=payload.category.strip() or "other",
        all_day=payload.all_day,
        start_at=payload.start_at,
        end_at=end_at,
        rrule=rule,
        exdates=sorted({d.isoformat() for d in payload.exdates}),
        source=source,
    )


def create_event(session: Session, payload: EventCreate, source: str = "manual") -> Event:
    event = draft_event(payload, source)
    session.add(event)
    session.commit()
    session.refresh(event)
    return event


def get_event(session: Session, event_id: str) -> Optional[Event]:
    return session.get(Event, event_id)


def search_events(session: Session, query: str, limit: int = 20) -> List[Event]:
    """Case-insensitive match on title, location or category, newest first.
    `%` and `_` in the query are matched literally."""
    query = query.strip()
    if not query:
        return []
    limit = max(1, min(limit, 100))
    stmt = (
        select(Event)
        .where(
            or_(
                col(Event.title).icontains(query, autoescape=True),
                col(Event.location).icontains(query, autoescape=True),
                col(Event.category).icontains(query, autoescape=True),
            )
        )
        .order_by(col(Event.start_at).desc())
        .limit(limit)
    )
    return list(session.exec(stmt))


def update_event(session: Session, event: Event, changes: EventUpdate) -> Tuple[Event, List[date]]:
    """Change a one-off event or a whole series. An empty string clears
    location, notes or rrule. Returns the event and the dates of any
    single-date overrides dropped because they no longer fit the series."""
    data = changes.model_dump(exclude_unset=True)
    for field_name in _NOT_CLEARABLE:
        if field_name in data and data[field_name] is None:
            raise ValueError(f"{field_name} can't be cleared; give it a value instead.")
    for field_name in ("location", "notes"):
        if field_name in data and data[field_name] is not None and not data[field_name].strip():
            data[field_name] = None
    if "rrule" in data:
        data["rrule"] = normalize_rrule(data["rrule"])
    if "exdates" in data:
        data["exdates"] = sorted({d.isoformat() for d in data["exdates"] or []})
    if "start_at" in data and "end_at" not in data:
        data["end_at"] = data["start_at"] + (event.end_at - event.start_at)

    merged = {f: data.get(f, getattr(event, f)) for f in ("start_at", "end_at", "all_day", "rrule")}
    _validate(merged["start_at"], merged["end_at"], merged["all_day"], merged["rrule"])

    for field_name, value in data.items():
        setattr(event, field_name, value)
    event.updated_at = utcnow()
    session.add(event)
    dropped = _prune_overrides(session, event) if {"start_at", "rrule", "exdates"} & data.keys() else []
    session.commit()
    session.refresh(event)
    return event, dropped


def _prune_overrides(session: Session, event: Event) -> List[date]:
    rows = session.exec(select(EventOverride).where(EventOverride.event_id == event.id)).all()
    rule = build_rule(event.rrule, event.start_at) if event.rrule else None
    dropped: List[date] = []
    for ov in rows:
        keep = (
            rule is not None
            and ov.original_date.isoformat() not in event.exdates
            and _occurrence_start(rule, ov.original_date) is not None
        )
        if not keep:
            dropped.append(ov.original_date)
            session.delete(ov)
    return sorted(dropped)


def delete_event(session: Session, event: Event) -> None:
    for ov in session.exec(select(EventOverride).where(EventOverride.event_id == event.id)).all():
        session.delete(ov)
    # Flush the overrides first so Postgres never sees them orphaned.
    session.flush()
    session.delete(event)
    session.commit()


# ---------------------------------------------------------------------------
# Single occurrences
# ---------------------------------------------------------------------------


def _series_start(event: Event, day: date) -> datetime:
    if not event.rrule:
        raise ValueError("This is a one-off event; change it with update_event instead.")
    start = _occurrence_start(build_rule(event.rrule, event.start_at), day)
    if start is None or day.isoformat() in event.exdates:
        raise ValueError(f"{day.isoformat()} isn't a date of this series.")
    return start


def edit_occurrence(session: Session, event: Event, day: date, changes: OccurrenceEdit) -> Occurrence:
    start = _series_start(event, day)
    ov = _override_for(session, event, day) or EventOverride(event_id=event.id, original_date=day)
    if changes.cancel:
        ov.cancelled = True
    else:
        ov.cancelled = False
        fields = changes.model_fields_set
        if "start_at" in fields or "end_at" in fields:
            duration = event.end_at - event.start_at
            new_start = changes.start_at or ov.start_at or start
            new_end = changes.end_at or (new_start + duration)
            if new_end <= new_start:
                raise ValueError("end_at must be after start_at.")
            ov.start_at, ov.end_at = new_start, new_end
        for field_name in ("title", "location", "notes"):
            if field_name in fields:
                setattr(ov, field_name, getattr(changes, field_name))
    ov.updated_at = utcnow()
    session.add(ov)
    session.commit()
    session.refresh(ov)
    return _occ(event, start, day, ov)


def restore_occurrence(session: Session, event: Event, day: date) -> Occurrence:
    start = _series_start(event, day)
    ov = _override_for(session, event, day)
    if ov is not None:
        session.delete(ov)
        session.commit()
    return _occ(event, start, day)


# ---------------------------------------------------------------------------
# Expansion
# ---------------------------------------------------------------------------


def _bounds(start: date, end: date) -> Tuple[datetime, datetime]:
    if end < start:
        raise ValueError("end_date must be on or after start_date.")
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise ValueError(
            f"A schedule request can cover at most {MAX_RANGE_DAYS} days; split it into smaller ranges."
        )
    return datetime.combine(start, time.min), datetime.combine(end + timedelta(days=1), time.min)


def occurrences(
    session: Session, start: date, end: date, include_cancelled: bool = False
) -> List[Occurrence]:
    """Every occurrence overlapping the inclusive local-date range, sorted."""
    lo, hi = _bounds(start, end)
    events = session.exec(
        select(Event).where(Event.start_at < hi, or_(col(Event.rrule).is_not(None), Event.end_at > lo))
    ).all()
    overrides = _overrides(session, [e.id for e in events if e.rrule])
    out: List[Occurrence] = []

    def add(occ: Occurrence) -> None:
        if occ.start_at < hi and occ.end_at > lo and (include_cancelled or not occ.cancelled):
            out.append(occ)
            if len(out) > MAX_OCCURRENCES:
                raise ValueError(
                    f"More than {MAX_OCCURRENCES} occurrences in this range; ask for a smaller range."
                )

    for event in events:
        if not event.rrule:
            add(_occ(event, event.start_at, event.start_at.date()))
            continue
        rule = build_rule(event.rrule, event.start_at)
        duration = event.end_at - event.start_at
        skipped = set(event.exdates)
        event_overrides = overrides.get(event.id, {})
        seen = set()
        # Start one duration early so occurrences already underway at the
        # range start are included.
        for occ_start in rule.between(lo - duration, hi, inc=True):
            day = occ_start.date()
            seen.add(day)
            if day.isoformat() in skipped:
                continue
            add(_occ(event, occ_start, day, event_overrides.get(day)))
        # Occurrences moved into the range from a date outside it.
        for day, ov in event_overrides.items():
            if day in seen or ov.start_at is None or day.isoformat() in skipped:
                continue
            occ_start = _occurrence_start(rule, day)
            if occ_start is not None:
                add(_occ(event, occ_start, day, ov))

    out.sort(key=lambda o: (o.start_at, o.title))
    return out


def preview(session: Session, event: Event, count: int = 5) -> List[Occurrence]:
    """The next `count` occurrences from the later of today and the series
    start, after skips and cancellations. Works on unsaved events too."""
    if not event.rrule:
        return [_occ(event, event.start_at, event.start_at.date())]
    rule = build_rule(event.rrule, event.start_at)
    event_overrides = _overrides(session, [event.id]).get(event.id, {})
    frm = max(event.start_at, datetime.combine(local_today(), time.min))
    out: List[Occurrence] = []
    for scanned, occ_start in enumerate(rule.xafter(frm, inc=True)):
        if scanned >= _PREVIEW_SCAN_LIMIT or len(out) >= count:
            break
        day = occ_start.date()
        if day.isoformat() in event.exdates:
            continue
        ov = event_overrides.get(day)
        if ov is not None and ov.cancelled:
            continue
        out.append(_occ(event, occ_start, day, ov))
    return out


# ---------------------------------------------------------------------------
# Conflicts
# ---------------------------------------------------------------------------


def conflicts(
    session: Session, start_at: datetime, end_at: datetime, exclude_event_id: Optional[str] = None
) -> List[Occurrence]:
    """Timed (not all-day) occurrences overlapping [start_at, end_at)."""
    if end_at <= start_at:
        raise ValueError("end_at must be after start_at.")
    last = (end_at - timedelta(microseconds=1)).date()
    return [
        o
        for o in occurrences(session, start_at.date(), last)
        if not o.all_day
        and o.event_id != exclude_event_id
        and o.start_at < end_at
        and o.end_at > start_at
    ]


def upcoming_conflicts(session: Session, event: Event) -> List[Occurrence]:
    """Other events overlapping this event's occurrences in the next
    CONFLICT_WINDOW_DAYS days. Informational; never blocks a save."""
    if event.all_day:
        return []
    first = max(local_today(), event.start_at.date())
    occs = occurrences(session, first, first + timedelta(days=CONFLICT_WINDOW_DAYS))
    mine = [o for o in occs if o.event_id == event.id]
    found: List[Occurrence] = []
    for other in occs:
        if other.event_id == event.id or other.all_day:
            continue
        if any(m.start_at < other.end_at and m.end_at > other.start_at for m in mine):
            found.append(other)
            if len(found) >= MAX_CONFLICTS:
                break
    return found


def with_context(
    session: Session, event: Event, dropped: Optional[List[date]] = None
) -> EventWithContext:
    return EventWithContext(
        event=EventRead.model_validate(event),
        next_occurrences=preview(session, event),
        conflicts=upcoming_conflicts(session, event),
        dropped_overrides=dropped or [],
    )
```

- [ ] **Step 4: Run** — `cd backend && .venv/bin/pytest tests/test_events_service.py -q && .venv/bin/pytest -q` → all PASS.

- [ ] **Step 5: Commit** — `git add backend/app/services/events.py backend/tests/test_events_service.py && git commit -m "Add events service: RRULE series, overrides, expansion, conflicts"`

---

### Task 3: REST router

**Files:** create `backend/app/routers/events.py`; modify `backend/app/main.py` (import `events` router module and `app.include_router(events.router)` after nutrition); test `backend/tests/test_events_api.py`

**Interfaces — Produces:** `/api/events` endpoints per the spec: `GET /schedule`, `GET /search`, `GET /preview`, `GET /conflicts`, `POST ""` (201, `EventWithContext`), `GET /{id}` (`EventRead`), `PATCH /{id}` (`EventWithContext`), `DELETE /{id}` (`{"deleted_id"}`), `PUT /{id}/occurrences/{day}` and `DELETE /{id}/occurrences/{day}` (`Occurrence`).

- [ ] **Step 1: Failing tests**

<!-- file: backend/tests/test_events_api.py -->
```python
BASE = "/api/events"

CS101 = {
    "title": "CS 101",
    "start_at": "2026-08-24T10:00",
    "end_at": "2026-08-24T10:50",
    "rrule": "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6",
    "category": "class",
}


def test_requires_auth(client):
    assert client.get(f"{BASE}/schedule", params={"start_date": "2026-08-24"}).status_code == 401


def test_create_get_patch_delete(client, auth_headers):
    r = client.post(BASE, json=CS101, headers=auth_headers)
    assert r.status_code == 201
    body = r.json()
    eid = body["event"]["id"]
    assert body["event"]["source"] == "manual" and body["event"]["rrule"].endswith("COUNT=6")
    assert client.get(f"{BASE}/{eid}", headers=auth_headers).json()["title"] == "CS 101"
    p = client.patch(f"{BASE}/{eid}", json={"location": "Hall A"}, headers=auth_headers)
    assert p.status_code == 200 and p.json()["event"]["location"] == "Hall A"
    week = {"start_date": "2026-08-24", "end_date": "2026-08-30"}
    assert client.get(f"{BASE}/schedule", params=week, headers=auth_headers).json()["count"] == 3
    assert client.delete(f"{BASE}/{eid}", headers=auth_headers).json() == {"deleted_id": eid}
    assert client.get(f"{BASE}/{eid}", headers=auth_headers).status_code == 404


def test_invalid_rule_is_422(client, auth_headers):
    bad = {**CS101, "rrule": "FREQ=SOMETIMES"}
    r = client.post(BASE, json=bad, headers=auth_headers)
    assert r.status_code == 422 and "rrule" in r.json()["detail"]


def test_occurrence_edit_and_restore(client, auth_headers):
    eid = client.post(BASE, json=CS101, headers=auth_headers).json()["event"]["id"]
    r = client.put(f"{BASE}/{eid}/occurrences/2026-08-26", json={"cancel": True}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["cancelled"] is True
    week = {"start_date": "2026-08-24", "end_date": "2026-08-30"}
    assert client.get(f"{BASE}/schedule", params=week, headers=auth_headers).json()["count"] == 2
    with_cancelled = {**week, "include_cancelled": "true"}
    assert client.get(f"{BASE}/schedule", params=with_cancelled, headers=auth_headers).json()["count"] == 3
    restored = client.delete(f"{BASE}/{eid}/occurrences/2026-08-26", headers=auth_headers)
    assert restored.status_code == 200 and restored.json()["overridden"] is False
    bad = client.put(f"{BASE}/{eid}/occurrences/2026-08-25", json={"cancel": True}, headers=auth_headers)
    assert bad.status_code == 422
    assert client.put(f"{BASE}/nope/occurrences/2026-08-26", json={"cancel": True}, headers=auth_headers).status_code == 404


def test_schedule_range_error(client, auth_headers):
    r = client.get(f"{BASE}/schedule", params={"start_date": "2026-01-01", "end_date": "2027-06-01"}, headers=auth_headers)
    assert r.status_code == 422


def test_preview_conflicts_search(client, auth_headers):
    params = {"start_at": "2030-01-01T09:00", "end_at": "2030-01-01T10:00", "rrule": "FREQ=WEEKLY;BYDAY=TU"}
    pv = client.get(f"{BASE}/preview", params=params, headers=auth_headers)
    assert pv.status_code == 200 and len(pv.json()) == 5
    assert client.get(f"{BASE}/preview", params={**params, "rrule": "nope"}, headers=auth_headers).status_code == 422
    game = {"title": "Football", "start_at": "2026-10-03T15:30", "end_at": "2026-10-03T19:00", "category": "sports"}
    client.post(BASE, json=game, headers=auth_headers)
    c = client.get(f"{BASE}/conflicts", params={"start_at": "2026-10-03T18:00", "end_at": "2026-10-03T20:00"},
                   headers=auth_headers).json()
    assert [o["title"] for o in c] == ["Football"]
    assert client.get(f"{BASE}/search", params={"q": "foot"}, headers=auth_headers).json()["count"] == 1
```

- [ ] **Step 2: Run, expect FAIL** — 404s / 405s (router not mounted).

- [ ] **Step 3: Implement**

<!-- file: backend/app/routers/events.py -->
```python
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from app.deps import get_db, require_auth
from app.schemas import (
    EventCreate,
    EventList,
    EventRead,
    EventUpdate,
    EventWithContext,
    Occurrence,
    OccurrenceEdit,
    ScheduleResponse,
)
from app.services import events as events_service

router = APIRouter(prefix="/api/events", tags=["events"], dependencies=[Depends(require_auth)])


def _event_or_404(session: Session, event_id: str):
    event = events_service.get_event(session, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No event with id '{event_id}'")
    return event


def _unprocessable(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))


@router.get("/schedule", response_model=ScheduleResponse)
def get_schedule(
    start_date: date,
    end_date: Optional[date] = None,
    include_cancelled: bool = False,
    session: Session = Depends(get_db),
):
    end = end_date or start_date
    try:
        occs = events_service.occurrences(session, start_date, end, include_cancelled)
    except ValueError as exc:
        raise _unprocessable(exc)
    return ScheduleResponse(start_date=start_date, end_date=end, occurrences=occs, count=len(occs))


@router.get("/search", response_model=EventList)
def search_events(q: str, limit: int = Query(default=20, ge=1, le=100), session: Session = Depends(get_db)):
    events = [EventRead.model_validate(e) for e in events_service.search_events(session, q, limit)]
    return EventList(events=events, count=len(events))


@router.get("/preview", response_model=List[Occurrence])
def preview(
    start_at: datetime,
    end_at: Optional[datetime] = None,
    all_day: bool = False,
    rrule: Optional[str] = None,
    exdates: List[date] = Query(default=[]),
    session: Session = Depends(get_db),
):
    """Next occurrences for an unsaved event; powers the form preview."""
    try:
        payload = EventCreate(
            title="preview", start_at=start_at, end_at=end_at, all_day=all_day, rrule=rrule, exdates=exdates
        )
        return events_service.preview(session, events_service.draft_event(payload))
    except ValueError as exc:  # pydantic's ValidationError is a ValueError
        raise _unprocessable(exc)


@router.get("/conflicts", response_model=List[Occurrence])
def get_conflicts(
    start_at: datetime,
    end_at: datetime,
    exclude_event_id: Optional[str] = None,
    session: Session = Depends(get_db),
):
    try:
        return events_service.conflicts(session, start_at, end_at, exclude_event_id)
    except ValueError as exc:
        raise _unprocessable(exc)


@router.post("", response_model=EventWithContext, status_code=status.HTTP_201_CREATED)
def create_event(payload: EventCreate, session: Session = Depends(get_db)):
    try:
        event = events_service.create_event(session, payload, source="manual")
    except ValueError as exc:
        raise _unprocessable(exc)
    return events_service.with_context(session, event)


@router.get("/{event_id}", response_model=EventRead)
def get_event(event_id: str, session: Session = Depends(get_db)):
    return _event_or_404(session, event_id)


@router.patch("/{event_id}", response_model=EventWithContext)
def update_event(event_id: str, payload: EventUpdate, session: Session = Depends(get_db)):
    event = _event_or_404(session, event_id)
    try:
        event, dropped = events_service.update_event(session, event, payload)
    except ValueError as exc:
        raise _unprocessable(exc)
    return events_service.with_context(session, event, dropped)


@router.delete("/{event_id}")
def delete_event(event_id: str, session: Session = Depends(get_db)) -> dict:
    events_service.delete_event(session, _event_or_404(session, event_id))
    return {"deleted_id": event_id}


@router.put("/{event_id}/occurrences/{day}", response_model=Occurrence)
def edit_occurrence(event_id: str, day: date, payload: OccurrenceEdit, session: Session = Depends(get_db)):
    event = _event_or_404(session, event_id)
    try:
        return events_service.edit_occurrence(session, event, day, payload)
    except ValueError as exc:
        raise _unprocessable(exc)


@router.delete("/{event_id}/occurrences/{day}", response_model=Occurrence)
def restore_occurrence(event_id: str, day: date, session: Session = Depends(get_db)):
    event = _event_or_404(session, event_id)
    try:
        return events_service.restore_occurrence(session, event, day)
    except ValueError as exc:
        raise _unprocessable(exc)
```

`backend/app/main.py`: `from app.routers import auth, events, nutrition, recurring, tasks, today` and `app.include_router(events.router)` after `app.include_router(nutrition.router)`.

- [ ] **Step 4: Run** — `cd backend && .venv/bin/pytest tests/test_events_api.py -q && .venv/bin/pytest -q` → all PASS.

- [ ] **Step 5: Commit** — `git add backend/app/routers/events.py backend/app/main.py backend/tests/test_events_api.py && git commit -m "Add /api/events REST endpoints"`

---

### Task 4: MCP tools and docs

**Files:** modify `backend/mcp_server/server.py` (imports, an instructions sentence, tools before the Resources banner; resource after `nutrition://today`); modify `docs/MCP.md`; test `backend/tests/test_events_mcp.py`

**Interfaces — Produces MCP tools:** `create_event`, `get_schedule`, `find_events`, `update_event`, `edit_occurrence`, `restore_occurrence`, `delete_event`, `check_conflicts`; resource function `resource_events_today` at `events://today`. Date args named `day` (matches nutrition tools). Errors return `{"error": str}` via the existing `_error` helper.

- [ ] **Step 1: Failing tests**

<!-- file: backend/tests/test_events_mcp.py -->
```python
from datetime import date

import pytest

import mcp_server.server as mcp_server
from app.services import events as events_service


@pytest.fixture()
def mcp_env(use_test_db):
    return use_test_db


def _cs101(**kw):
    args = {"title": "CS 101", "start_at": "2026-08-24T10:00", "end_at": "2026-08-24T10:50",
            "rrule": "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6", **kw}
    return mcp_server.create_event(**args)


def test_create_event_tool_with_preview_and_conflicts(mcp_env, monkeypatch):
    monkeypatch.setattr(events_service, "local_today", lambda: date(2026, 8, 20))
    r = _cs101(rrule="RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261212", exdates=["2026-11-27"], category="class")
    assert "error" not in r
    assert r["event"]["source"] == "mcp" and r["event"]["rrule"].endswith("UNTIL=20261212T235959")
    assert [o["occurrence_date"] for o in r["next_occurrences"]][:3] == ["2026-08-24", "2026-08-26", "2026-08-28"]
    gym = mcp_server.create_event(title="Gym", start_at="2026-08-26T10:30", end_at="2026-08-26T11:30")
    assert [c["title"] for c in gym["conflicts"]] == ["CS 101"]


def test_create_event_errors(mcp_env):
    assert "error" in _cs101(rrule="FREQ=WEEKLY;BYDAY=XX")
    assert "error" in mcp_server.create_event(title="x", start_at="tomorrow", end_at="2026-08-24T11:00")
    assert "error" in mcp_server.create_event(title="x", start_at="2026-08-24T10:00")


def test_all_day_event_tool(mcp_env):
    r = mcp_server.create_event(title="Game day", start_at="2026-10-03", all_day=True, category="sports")
    assert r["event"]["end_at"] == "2026-10-04T00:00:00"


def test_schedule_edit_restore_delete_tools(mcp_env):
    eid = _cs101()["event"]["id"]
    assert mcp_server.get_schedule("2026-08-24", "2026-08-30")["count"] == 3
    moved = mcp_server.edit_occurrence(eid, "2026-08-26", start_at="2026-08-26T14:00")
    assert moved["start_at"] == "2026-08-26T14:00:00" and moved["end_at"] == "2026-08-26T14:50:00"
    assert mcp_server.edit_occurrence(eid, "2026-08-28", cancel=True)["cancelled"] is True
    assert mcp_server.get_schedule("2026-08-24", "2026-08-30")["count"] == 2
    assert mcp_server.restore_occurrence(eid, "2026-08-28")["overridden"] is False
    assert "error" in mcp_server.edit_occurrence(eid, "2026-08-25", cancel=True)
    assert "error" in mcp_server.get_schedule("2026-08-30", "2026-08-24")
    assert mcp_server.delete_event(eid) == {"deleted_id": eid}
    assert "error" in mcp_server.delete_event(eid)


def test_update_find_conflict_tools(mcp_env):
    eid = mcp_server.create_event(title="Football vs Michigan", start_at="2026-10-03T15:30",
                                  end_at="2026-10-03T19:00", category="sports", location="Stadium")["event"]["id"]
    u = mcp_server.update_event(eid, location="", start_at="2026-10-03T12:00")
    assert u["event"]["location"] is None and u["event"]["end_at"] == "2026-10-03T15:30:00"
    assert mcp_server.find_events("michigan")["count"] == 1
    hits = mcp_server.check_conflicts("2026-10-03T15:00", "2026-10-03T16:00")
    assert [o["title"] for o in hits["occurrences"]] == ["Football vs Michigan"]
    assert "error" in mcp_server.update_event("missing", title="x")
    assert "error" in mcp_server.check_conflicts("2026-10-03T16:00", "2026-10-03T15:00")


def test_events_resource(mcp_env):
    assert mcp_server.resource_events_today()["occurrences"] == []
```

- [ ] **Step 2: Run, expect FAIL** — `AttributeError: module 'mcp_server.server' has no attribute 'create_event'`.

- [ ] **Step 3: Implement**

`backend/mcp_server/server.py`:
- Add `datetime` to the `from datetime import ...` line.
- Extend the `app.schemas` import with `EventCreate, EventRead, EventUpdate, OccurrenceEdit`.
- Add `from app.services import events as events_service` beside the other service imports.
- In the `instructions=` string, before `"Dates are ISO 'YYYY-MM-DD'..."` add: `"And a schedule of events (classes, games, parties) with standard RRULE recurrence: create_event, get_schedule, edit_occurrence for single dates. "`

<!-- insert-before: backend/mcp_server/server.py :: # Resources (read-only) -->
```python
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
        events_service.delete_event(session, event)
        return {"deleted_id": event_id}


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


```

After the `nutrition://today` resource, add:

```python
@mcp.resource("events://today")
def resource_events_today() -> dict:
    """Today's schedule."""
    return get_schedule(local_today().isoformat())
```

`docs/MCP.md`: add `### Events and schedule` before `## Resources (read-only)` with a one-line intro (RRULE series expanded on read, single-date edits, deletes only on request) and a table of the 8 tools; add `events://today` to the resources table; add example prompts "Add CS 101, Mon/Wed/Fri 10 to 10:50 through Dec 12, skipping Thanksgiving week" and "No class this Friday".

- [ ] **Step 4: Run** — `cd backend && .venv/bin/pytest tests/test_events_mcp.py -q && .venv/bin/pytest -q` → all PASS.

- [ ] **Step 5: Schema smoke check** — list tools via `asyncio.run(mcp_server.mcp.list_tools())` (with the env vars the nutrition smoke check used): 35 tools total, all 8 event tools present.

- [ ] **Step 6: Commit** — `git add backend/mcp_server/server.py backend/tests/test_events_mcp.py docs/MCP.md && git commit -m "Add schedule and recurring event MCP tools"`

---

### Task 5: Frontend data layer

**Files:** `frontend/src/lib/types.ts` (append), `frontend/src/lib/api.ts` (methods + type imports), `frontend/src/lib/events.ts` (append), `frontend/src/lib/calendarEvents.ts` (create), `frontend/src/components/Dialog.tsx` (hint prop, wrapping footer)

**Interfaces — Produces:** types `CalendarEvent`, `Occurrence`, `EventWithContext`, `ScheduleResponse`, `EventPayload`, `OccurrenceEditPayload`; api `getSchedule(start, end?, includeCancelled?)`, `previewEvent({start_at,end_at?,all_day?,rrule})`, `getEvent(id)`, `createEvent(p)`, `updateEvent(id,p)`, `deleteEvent(id)`, `editOccurrence(id, day, p)`, `restoreOccurrence(id, day)`; `onEventsChanged`, `notifyEventsChanged`; calendarEvents: `EVENT_CATEGORIES`, `eventHue`, `timeLabel`, `compactTime`, `splitLocal`, `WEEKDAYS`, `Weekday`, `RepeatKind`, `EndKind`, `Repeat`, `weekdayOf`, `defaultRepeat`, `buildRrule`, `parseRrule`; Dialog prop `hint?: boolean` (default true).

<!-- append: frontend/src/lib/types.ts -->
```ts

// ---- Events ---------------------------------------------------------------

export interface CalendarEvent {
  id: string;
  title: string;
  location: string | null;
  notes: string | null;
  category: string;
  all_day: boolean;
  start_at: string; // local "YYYY-MM-DDTHH:MM:SS"
  end_at: string;
  rrule: string | null;
  exdates: string[];
  source: string;
  created_at: string;
  updated_at: string;
}

export interface Occurrence {
  event_id: string;
  occurrence_date: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  title: string;
  location: string | null;
  category: string;
  notes: string | null;
  recurring: boolean;
  rrule: string | null;
  overridden: boolean;
  cancelled: boolean;
}

export interface EventWithContext {
  event: CalendarEvent;
  next_occurrences: Occurrence[];
  conflicts: Occurrence[];
  dropped_overrides: string[];
}

export interface ScheduleResponse {
  start_date: string;
  end_date: string;
  occurrences: Occurrence[];
  count: number;
}

export interface EventPayload {
  title?: string;
  start_at?: string;
  end_at?: string | null;
  all_day?: boolean;
  location?: string | null;
  category?: string;
  notes?: string | null;
  rrule?: string | null;
  exdates?: string[];
}

export interface OccurrenceEditPayload {
  cancel?: boolean;
  start_at?: string;
  end_at?: string;
  title?: string;
  location?: string | null;
  notes?: string | null;
}
```

`frontend/src/lib/api.ts`: add `CalendarEvent, EventPayload, EventWithContext, Occurrence, OccurrenceEditPayload, ScheduleResponse` to the type import, and before the final `};` add:

```ts

  getSchedule: (start_date: string, end_date?: string, include_cancelled?: boolean) =>
    request<ScheduleResponse>(`/api/events/schedule${qs({ start_date, end_date, include_cancelled })}`),
  previewEvent: (p: { start_at: string; end_at?: string; all_day?: boolean; rrule: string }) =>
    request<Occurrence[]>(`/api/events/preview${qs(p)}`),
  getEvent: (id: string) => request<CalendarEvent>(`/api/events/${id}`),
  createEvent: (payload: EventPayload) =>
    request<EventWithContext>("/api/events", { method: "POST", body: JSON.stringify(payload) }),
  updateEvent: (id: string, payload: EventPayload) =>
    request<EventWithContext>(`/api/events/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteEvent: (id: string) => request<{ deleted_id: string }>(`/api/events/${id}`, { method: "DELETE" }),
  editOccurrence: (id: string, day: string, payload: OccurrenceEditPayload) =>
    request<Occurrence>(`/api/events/${id}/occurrences/${day}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  restoreOccurrence: (id: string, day: string) =>
    request<Occurrence>(`/api/events/${id}/occurrences/${day}`, { method: "DELETE" }),
```

<!-- append: frontend/src/lib/events.ts -->
```ts

// Same pattern for calendar events, so the Calendar and Today pages refresh
// after an event is added or edited from anywhere.
const eventListeners = new Set<Listener>();

export function onEventsChanged(listener: Listener): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

export function notifyEventsChanged(): void {
  eventListeners.forEach((l) => l());
}
```

<!-- file: frontend/src/lib/calendarEvents.ts -->
```ts
// Helpers for calendar events: category markers, time labels, and the
// repeat presets shown in the event form, which map to and from RRULEs.

export const EVENT_CATEGORIES = ["class", "social", "sports", "work", "appointment", "other"] as const;

// A colored marker beside the category name (never color alone). Classes
// are spelled out in full for Tailwind's static scanner.
const HUES: Record<string, string> = {
  class: "text-amber-500",
  social: "text-pink-500",
  sports: "text-emerald-500",
  work: "text-violet-500",
  appointment: "text-orange-600 dark:text-orange-400",
  other: "text-fg-faint",
};

export function eventHue(category: string): string {
  return HUES[category] ?? "text-fg-faint";
}

/** "10:00 AM" from a local ISO datetime (no timezone suffix = local). */
export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "10a", "2:30p": for tight month-grid cells. */
export function compactTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h < 12 ? "a" : "p";
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
}

/** Split "2026-08-24T10:00:00" into the values date/time inputs use. */
export function splitLocal(iso: string): { date: string; time: string } {
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) || "00:00" };
}

export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export const WEEKDAYS: { code: Weekday; short: string; name: string }[] = [
  { code: "MO", short: "Mo", name: "Monday" },
  { code: "TU", short: "Tu", name: "Tuesday" },
  { code: "WE", short: "We", name: "Wednesday" },
  { code: "TH", short: "Th", name: "Thursday" },
  { code: "FR", short: "Fr", name: "Friday" },
  { code: "SA", short: "Sa", name: "Saturday" },
  { code: "SU", short: "Su", name: "Sunday" },
];

const ORDER = WEEKDAYS.map((w) => w.code);
const WEEKDAY_SET = "MO,TU,WE,TH,FR";

export type RepeatKind = "none" | "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "custom";
export type EndKind = "never" | "until" | "count";

export interface Repeat {
  kind: RepeatKind;
  days: Weekday[];
  end: EndKind;
  until: string; // YYYY-MM-DD
  count: number;
  custom: string; // raw RRULE when kind === "custom"
}

export function weekdayOf(dateIso: string): Weekday {
  const [y, m, d] = dateIso.split("-").map(Number);
  return (["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as Weekday[])[new Date(y, m - 1, d).getDay()];
}

export function defaultRepeat(dateIso: string): Repeat {
  return { kind: "none", days: [weekdayOf(dateIso)], end: "never", until: "", count: 10, custom: "" };
}

function sortDays(days: Weekday[]): Weekday[] {
  return [...new Set(days)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
}

export function buildRrule(r: Repeat, dateIso: string): string | null {
  if (r.kind === "none") return null;
  if (r.kind === "custom") return r.custom.trim() || null;
  const days = sortDays(r.days.length ? r.days : [weekdayOf(dateIso)]).join(",");
  const base = {
    daily: "FREQ=DAILY",
    weekdays: `FREQ=WEEKLY;BYDAY=${WEEKDAY_SET}`,
    weekly: `FREQ=WEEKLY;BYDAY=${days}`,
    biweekly: `FREQ=WEEKLY;INTERVAL=2;BYDAY=${days}`,
    monthly: "FREQ=MONTHLY",
  }[r.kind];
  if (r.end === "until" && r.until) return `${base};UNTIL=${r.until.replaceAll("-", "")}`;
  if (r.end === "count" && r.count > 0) return `${base};COUNT=${r.count}`;
  return base;
}

/** Map a stored RRULE back onto a preset; anything else is "custom". */
export function parseRrule(rule: string | null, dateIso: string): Repeat {
  const r = defaultRepeat(dateIso);
  if (!rule) return r;
  const parts: Record<string, string> = {};
  for (const piece of rule.split(";")) {
    const [k, v] = piece.split("=");
    if (k && v !== undefined) parts[k.toUpperCase()] = v.toUpperCase();
  }
  const { UNTIL, COUNT, ...rest } = parts;
  const days = (rest.BYDAY ?? "").split(",").filter(Boolean);
  const plain = days.every((d) => (ORDER as string[]).includes(d));
  const keys = Object.keys(rest).sort().join(",");

  let kind: RepeatKind | null = null;
  if (keys === "FREQ" && rest.FREQ === "DAILY") kind = "daily";
  else if (keys === "FREQ" && rest.FREQ === "MONTHLY") kind = "monthly";
  else if (keys === "FREQ" && rest.FREQ === "WEEKLY") kind = "weekly";
  else if (keys === "BYDAY,FREQ" && rest.FREQ === "WEEKLY" && plain)
    kind = sortDays(days as Weekday[]).join(",") === WEEKDAY_SET ? "weekdays" : "weekly";
  else if (keys === "BYDAY,FREQ,INTERVAL" && rest.FREQ === "WEEKLY" && rest.INTERVAL === "2" && plain)
    kind = "biweekly";

  if (!kind) return { ...r, kind: "custom", custom: rule };
  return {
    ...r,
    kind,
    days: days.length && plain ? sortDays(days as Weekday[]) : r.days,
    end: UNTIL ? "until" : COUNT ? "count" : "never",
    until: UNTIL ? `${UNTIL.slice(0, 4)}-${UNTIL.slice(4, 6)}-${UNTIL.slice(6, 8)}` : "",
    count: COUNT ? Number(COUNT) : r.count,
  };
}
```

`frontend/src/components/Dialog.tsx`:
- Props: add `hint?: boolean;` and destructure `hint = true`.
- Wrap the "⌘ ↵ to save" `<span>` in `{hint && (...)}`.
- Change `<div className="ml-auto flex gap-2">{footer}</div>` to `<div className="ml-auto flex flex-wrap justify-end gap-2">{footer}</div>`.

- [ ] **Verify** — `cd frontend && npx tsc --noEmit && npx eslint src` → no output. Then a one-off round-trip check of the preset mapping (scratch script, not committed, run with `npx tsx`): for each preset (`daily`, `weekdays`, `weekly` MO+WE, `biweekly` TH, `monthly`) with each end kind, `parseRrule(buildRrule(r))` returns the same `kind`, `days`, `end`, `until`, `count`; and `parseRrule("FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1")` is `custom`.

- [ ] **Commit** — `git add frontend/src/lib frontend/src/components/Dialog.tsx && git commit -m "Add event types, API client, repeat presets; Dialog hint prop"`

---

### Task 6: Event components

**Files (create):** `frontend/src/components/events/AgendaList.tsx`, `EventModal.tsx`, `OccurrenceModal.tsx`, `EventEditor.tsx`

**Interfaces — Produces:** `<AgendaList occurrences onOpen />` (a `<ul>`); `<EventModal event: CalendarEvent | null, defaultDate, onClose, onDone />`; `<OccurrenceModal occ, onClose, onDone />`; `EventEditor` default export `<EventEditor target: EditorTarget, onClose />` and `type EditorTarget = { kind: "new"; date: string } | { kind: "occurrence"; occ: Occurrence }`. `EventEditor` calls `notifyEventsChanged()` after any successful change.

<!-- file: frontend/src/components/events/AgendaList.tsx -->
```tsx
"use client";

import { ArrowsClockwiseIcon, MapPinIcon } from "@phosphor-icons/react";
import { eventHue, timeLabel } from "@/lib/calendarEvents";
import type { Occurrence } from "@/lib/types";
import { CARD_LIST } from "@/lib/ui";

/** Time-ordered events for a day. Each row opens the event. */
export default function AgendaList({
  occurrences,
  onOpen,
}: {
  occurrences: Occurrence[];
  onOpen: (occ: Occurrence) => void;
}) {
  return (
    <ul className={`anim-stagger ${CARD_LIST}`}>
      {occurrences.map((o, i) => (
        <li key={`${o.event_id}-${o.occurrence_date}`} style={{ "--i": i } as React.CSSProperties}>
          <button
            type="button"
            onClick={() => onOpen(o)}
            className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface-2/70"
          >
            <span className="w-[4.5rem] shrink-0 font-mono text-xs leading-5 tabular-nums text-fg-muted">
              {o.all_day ? (
                "All day"
              ) : (
                <>
                  {timeLabel(o.start_at)}
                  <span className="block text-fg-faint">{timeLabel(o.end_at)}</span>
                </>
              )}
            </span>
            <span className={`mt-0.5 w-0.5 shrink-0 self-stretch rounded-full bg-current ${eventHue(o.category)}`} aria-hidden />
            <span className="min-w-0 flex-1">
              <span
                className={`block text-sm leading-5 [overflow-wrap:anywhere] ${
                  o.cancelled ? "text-fg-faint line-through" : "text-fg"
                }`}
              >
                {o.title}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-muted">
                <span className="capitalize">{o.category}</span>
                {o.location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPinIcon className="h-3.5 w-3.5" aria-hidden />
                    {o.location}
                  </span>
                )}
                {o.recurring && (
                  <span className="inline-flex items-center" title="Repeats">
                    <ArrowsClockwiseIcon className="h-3.5 w-3.5" aria-hidden />
                    <span className="sr-only">Repeats</span>
                  </span>
                )}
                {o.cancelled ? (
                  <span className="font-medium text-danger">Cancelled</span>
                ) : o.overridden ? (
                  <span className="text-fg-faint">Changed for this date</span>
                ) : null}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
```

<!-- file: frontend/src/components/events/EventModal.tsx -->
```tsx
"use client";

import { useEffect, useState } from "react";
import { CircleNotchIcon, TrashIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import {
  buildRrule,
  EVENT_CATEGORIES,
  parseRrule,
  splitLocal,
  WEEKDAYS,
  type EndKind,
  type Repeat,
  type RepeatKind,
  type Weekday,
} from "@/lib/calendarEvents";
import { addDaysIso, formatDate } from "@/lib/format";
import { toast, toastError } from "@/lib/toast";
import type { CalendarEvent, EventPayload, Occurrence } from "@/lib/types";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD as FIELD_BASE, LABEL } from "@/lib/ui";
import Dialog from "../Dialog";

const FIELD = `mt-1.5 h-10 w-full ${FIELD_BASE}`;

const REPEAT_LABEL: Record<RepeatKind, string> = {
  none: "Does not repeat",
  daily: "Every day",
  weekdays: "Every weekday (Mon to Fri)",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly, same date",
  custom: "Custom rule",
};

/** Create or edit a one-off event or a whole series. */
export default function EventModal({
  event,
  defaultDate,
  onClose,
  onDone,
}: {
  event: CalendarEvent | null;
  defaultDate: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const start = event ? splitLocal(event.start_at) : { date: defaultDate, time: "09:00" };
  const end = event ? splitLocal(event.end_at) : { date: defaultDate, time: "10:00" };

  const [title, setTitle] = useState(event?.title ?? "");
  const [category, setCategory] = useState(event?.category ?? "other");
  const [location, setLocation] = useState(event?.location ?? "");
  const [notes, setNotes] = useState(event?.notes ?? "");
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [date, setDate] = useState(start.date);
  const [startTime, setStartTime] = useState(event && !event.all_day ? start.time : "09:00");
  const [endTime, setEndTime] = useState(event && !event.all_day ? end.time : "10:00");
  const [lastDay, setLastDay] = useState(event?.all_day ? addDaysIso(end.date, -1) : start.date);
  const [repeat, setRepeat] = useState<Repeat>(() => parseRrule(event?.rrule ?? null, start.date));
  const [showRule, setShowRule] = useState(() => parseRrule(event?.rrule ?? null, start.date).kind === "custom");
  const [preview, setPreview] = useState<Occurrence[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const crossesMidnight = !allDay && endTime <= startTime;
  const startAt = allDay ? date : `${date}T${startTime}`;
  const endAt = allDay
    ? addDaysIso(lastDay < date ? date : lastDay, 1)
    : `${crossesMidnight ? addDaysIso(date, 1) : date}T${endTime}`;
  const rrule = buildRrule(repeat, date);

  // Live preview of the next dates whenever the rule or times change.
  useEffect(() => {
    if (!rrule) return;
    const id = setTimeout(() => {
      api
        .previewEvent({ start_at: startAt, end_at: endAt, all_day: allDay, rrule })
        .then((occ) => {
          setPreview(occ);
          setPreviewError(null);
        })
        .catch((e) => {
          setPreview(null);
          setPreviewError(e instanceof Error ? e.message : "That repeat rule isn't valid");
        });
    }, 300);
    return () => clearTimeout(id);
  }, [rrule, startAt, endAt, allDay]);

  useEffect(() => {
    if (!confirmDelete) return;
    const id = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(id);
  }, [confirmDelete]);

  function patchRepeat(p: Partial<Repeat>) {
    setRepeat((r) => ({ ...r, ...p }));
  }

  function toggleDay(d: Weekday) {
    setRepeat((r) => {
      const days = r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d];
      return { ...r, days: days.length ? days : r.days };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Give the event a title.");
    if (rrule && previewError) return setError(previewError);
    setSaving(true);
    setError(null);
    const payload: EventPayload = {
      title: title.trim(),
      category: category.trim() || "other",
      all_day: allDay,
      start_at: startAt,
      end_at: endAt,
      location: location.trim() || null,
      notes: notes.trim() || null,
      rrule,
    };
    try {
      const ctx = event ? await api.updateEvent(event.id, payload) : await api.createEvent(payload);
      const n = ctx.conflicts.length;
      if (n) {
        toast(`Saved. Overlaps ${ctx.conflicts[0].title}${n > 1 ? ` and ${n - 1} more` : ""}`, "info");
      } else {
        toast(event ? "Event updated" : `Added "${ctx.event.title}"`);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the event");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!event) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    try {
      await api.deleteEvent(event.id);
      toast(`Deleted "${event.title}"`, "info");
      onDone();
    } catch (err) {
      toastError(err, "Couldn't delete the event");
      setSaving(false);
    }
  }

  const weekly = repeat.kind === "weekly" || repeat.kind === "biweekly";

  return (
    <Dialog
      title={event ? (event.rrule ? "Edit all dates in series" : "Edit event") : "New event"}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <>
          {event && (
            <button
              type="button"
              onClick={remove}
              disabled={saving}
              className={
                confirmDelete
                  ? "inline-flex h-9 items-center gap-1.5 rounded-lg bg-danger px-3 text-sm font-medium text-surface"
                  : `${BUTTON_SECONDARY} text-danger hover:bg-danger-soft`
              }
            >
              <TrashIcon className="h-4 w-4" aria-hidden />
              {confirmDelete ? (event.rrule ? "Delete all dates?" : "Delete?") : "Delete"}
            </button>
          )}
          <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BUTTON_PRIMARY}>
            {saving && <CircleNotchIcon className="h-4 w-4 animate-spin" aria-hidden />}
            {saving ? "Saving" : event ? "Save" : "Add event"}
          </button>
        </>
      }
    >
      <label className={`block ${LABEL}`}>
        Title
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="CS 101 lecture" className={FIELD} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className={`block ${LABEL}`}>
          Category
          <input list="event-categories" value={category} onChange={(e) => setCategory(e.target.value)} className={FIELD} />
          <datalist id="event-categories">
            {EVENT_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className={`block ${LABEL}`}>
          Location
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" className={FIELD} />
        </label>
      </div>

      <div className="flex items-center justify-between">
        <span className={LABEL} id="all-day-label">
          All day
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={allDay}
          aria-labelledby="all-day-label"
          onClick={() => setAllDay((v) => !v)}
          className={`relative h-6 w-10 shrink-0 rounded-full transition-colors duration-150 ${allDay ? "bg-accent" : "bg-line-strong"}`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-surface shadow-sm transition-transform duration-150 ${
              allDay ? "translate-x-4" : ""
            }`}
          />
        </button>
      </div>

      {allDay ? (
        <div className="grid grid-cols-2 gap-3">
          <label className={`block ${LABEL}`}>
            Starts
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} />
          </label>
          <label className={`block ${LABEL}`}>
            Last day
            <input type="date" value={lastDay} min={date} onChange={(e) => setLastDay(e.target.value)} className={FIELD} />
          </label>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
            <label className={`block ${LABEL}`}>
              Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} />
            </label>
            <label className={`block ${LABEL}`}>
              Starts
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={FIELD} />
            </label>
            <label className={`block ${LABEL}`}>
              Ends
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={FIELD} />
            </label>
          </div>
          {crossesMidnight && <p className="mt-1.5 text-xs text-fg-muted">Ends the next day.</p>}
        </div>
      )}

      <fieldset className="space-y-3">
        <legend className={LABEL}>Repeat</legend>
        <select
          aria-label="Repeat"
          value={repeat.kind}
          onChange={(e) => {
            const kind = e.target.value as RepeatKind;
            patchRepeat({ kind, custom: kind === "custom" ? repeat.custom || rrule || "FREQ=WEEKLY" : repeat.custom });
            if (kind === "custom") setShowRule(true);
          }}
          className={FIELD}
        >
          {(Object.keys(REPEAT_LABEL) as RepeatKind[]).map((k) => (
            <option key={k} value={k}>
              {REPEAT_LABEL[k]}
            </option>
          ))}
        </select>

        {weekly && (
          <div className="flex gap-1" role="group" aria-label="Days of the week">
            {WEEKDAYS.map((d) => {
              const on = repeat.days.includes(d.code);
              return (
                <button
                  key={d.code}
                  type="button"
                  aria-pressed={on}
                  aria-label={d.name}
                  onClick={() => toggleDay(d.code)}
                  className={`h-9 flex-1 rounded-lg text-xs font-medium transition-colors duration-150 ${
                    on ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-muted hover:text-fg"
                  }`}
                >
                  {d.short}
                </button>
              );
            })}
          </div>
        )}

        {repeat.kind !== "none" && repeat.kind !== "custom" && (
          <div className="grid grid-cols-2 gap-3">
            <label className={`block ${LABEL}`}>
              Ends
              <select value={repeat.end} onChange={(e) => patchRepeat({ end: e.target.value as EndKind })} className={FIELD}>
                <option value="never">Never</option>
                <option value="until">On a date</option>
                <option value="count">After a number of times</option>
              </select>
            </label>
            {repeat.end === "until" && (
              <label className={`block ${LABEL}`}>
                Last date
                <input type="date" value={repeat.until} min={date} onChange={(e) => patchRepeat({ until: e.target.value })} className={FIELD} />
              </label>
            )}
            {repeat.end === "count" && (
              <label className={`block ${LABEL}`}>
                Times
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={repeat.count}
                  onChange={(e) => patchRepeat({ count: Math.max(1, parseInt(e.target.value || "1", 10)) })}
                  className={FIELD}
                />
              </label>
            )}
          </div>
        )}

        {repeat.kind !== "none" && (
          <div>
            <button
              type="button"
              onClick={() => setShowRule((v) => !v)}
              aria-expanded={showRule}
              className="text-xs font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
            >
              {showRule ? "Hide rule" : "Show rule"}
            </button>
            {showRule && (
              <input
                aria-label="Repeat rule (RRULE)"
                value={rrule ?? ""}
                onChange={(e) => patchRepeat({ kind: "custom", custom: e.target.value })}
                spellCheck={false}
                className={`mt-1.5 h-10 w-full font-mono text-xs ${FIELD_BASE}`}
              />
            )}
          </div>
        )}

        {rrule &&
          (previewError ? (
            <p className="text-xs text-danger">{previewError}</p>
          ) : (
            preview && (
              <p className="text-xs leading-relaxed text-fg-muted">
                Next:{" "}
                {preview.length ? preview.map((o) => formatDate(o.occurrence_date)).join(", ") : "no upcoming dates"}
              </p>
            )
          ))}
      </fieldset>

      <label className={`block ${LABEL}`}>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`mt-1.5 w-full py-2 leading-relaxed ${FIELD_BASE}`} />
      </label>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <WarningCircleIcon weight="fill" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </Dialog>
  );
}
```

<!-- file: frontend/src/components/events/OccurrenceModal.tsx -->
```tsx
"use client";

import { useEffect, useState } from "react";
import { CircleNotchIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { splitLocal } from "@/lib/calendarEvents";
import { addDaysIso, formatDateLong } from "@/lib/format";
import { toast } from "@/lib/toast";
import type { Occurrence, OccurrenceEditPayload } from "@/lib/types";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD as FIELD_BASE, LABEL } from "@/lib/ui";
import Dialog from "../Dialog";

const FIELD = `mt-1.5 h-10 w-full ${FIELD_BASE}`;

/** Edit, move, cancel or restore one date of a recurring series. */
export default function OccurrenceModal({
  occ,
  onClose,
  onDone,
}: {
  occ: Occurrence;
  onClose: () => void;
  onDone: () => void;
}) {
  const s = splitLocal(occ.start_at);
  const e = splitLocal(occ.end_at);
  const [date, setDate] = useState(s.date);
  const [startTime, setStartTime] = useState(s.time);
  const [endTime, setEndTime] = useState(e.time);
  const [title, setTitle] = useState(occ.title);
  const [location, setLocation] = useState(occ.location ?? "");
  const [notes, setNotes] = useState(occ.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    if (!confirmCancel) return;
    const id = setTimeout(() => setConfirmCancel(false), 3000);
    return () => clearTimeout(id);
  }, [confirmCancel]);

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      toast(message);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change this date");
      setBusy(false);
    }
  }

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!title.trim()) return setError("Give it a title.");
    const payload: OccurrenceEditPayload = {};
    if (!occ.all_day) {
      const startAt = `${date}T${startTime}`;
      const endAt = `${endTime <= startTime ? addDaysIso(date, 1) : date}T${endTime}`;
      if (startAt !== occ.start_at.slice(0, 16) || endAt !== occ.end_at.slice(0, 16)) {
        payload.start_at = startAt;
        payload.end_at = endAt;
      }
    }
    if (title.trim() !== occ.title) payload.title = title.trim();
    if ((location.trim() || null) !== occ.location) payload.location = location.trim() || null;
    if ((notes.trim() || null) !== occ.notes) payload.notes = notes.trim() || null;
    if (Object.keys(payload).length === 0 && !occ.cancelled) return onClose();
    run(() => api.editOccurrence(occ.event_id, occ.occurrence_date, payload), "Changed for this date");
  }

  function cancelDate() {
    if (!confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    run(() => api.editOccurrence(occ.event_id, occ.occurrence_date, { cancel: true }), "Cancelled for this date");
  }

  return (
    <Dialog
      title={`Just ${formatDateLong(occ.occurrence_date)}`}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <>
          {occ.overridden && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => api.restoreOccurrence(occ.event_id, occ.occurrence_date), "Restored to the series")}
              className={BUTTON_SECONDARY}
            >
              Restore to series
            </button>
          )}
          {!occ.cancelled && (
            <button
              type="button"
              disabled={busy}
              onClick={cancelDate}
              className={
                confirmCancel
                  ? "inline-flex h-9 items-center rounded-lg bg-danger px-3 text-sm font-medium text-surface"
                  : `${BUTTON_SECONDARY} text-danger hover:bg-danger-soft`
              }
            >
              {confirmCancel ? "Cancel this date?" : "Cancel this date"}
            </button>
          )}
          <button type="submit" disabled={busy} className={BUTTON_PRIMARY}>
            {busy && <CircleNotchIcon className="h-4 w-4 animate-spin" aria-hidden />}
            {occ.cancelled ? "Un-cancel and save" : "Save"}
          </button>
        </>
      }
    >
      {occ.cancelled && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">This date is cancelled.</p>
      )}
      <label className={`block ${LABEL}`}>
        Title
        <input autoFocus value={title} onChange={(ev) => setTitle(ev.target.value)} className={FIELD} />
      </label>
      {!occ.all_day && (
        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
          <label className={`block ${LABEL}`}>
            Date
            <input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} className={FIELD} />
          </label>
          <label className={`block ${LABEL}`}>
            Starts
            <input type="time" value={startTime} onChange={(ev) => setStartTime(ev.target.value)} className={FIELD} />
          </label>
          <label className={`block ${LABEL}`}>
            Ends
            <input type="time" value={endTime} onChange={(ev) => setEndTime(ev.target.value)} className={FIELD} />
          </label>
        </div>
      )}
      <label className={`block ${LABEL}`}>
        Location
        <input value={location} onChange={(ev) => setLocation(ev.target.value)} className={FIELD} />
      </label>
      <label className={`block ${LABEL}`}>
        Notes
        <textarea value={notes} onChange={(ev) => setNotes(ev.target.value)} rows={2} className={`mt-1.5 w-full py-2 leading-relaxed ${FIELD_BASE}`} />
      </label>
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <WarningCircleIcon weight="fill" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </Dialog>
  );
}
```

<!-- file: frontend/src/components/events/EventEditor.tsx -->
```tsx
"use client";

import { useEffect, useState } from "react";
import { CalendarBlankIcon, StackIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { notifyEventsChanged } from "@/lib/events";
import { formatDateLong } from "@/lib/format";
import { toastError } from "@/lib/toast";
import type { CalendarEvent, Occurrence } from "@/lib/types";
import { BUTTON_SECONDARY } from "@/lib/ui";
import Dialog from "../Dialog";
import EventModal from "./EventModal";
import OccurrenceModal from "./OccurrenceModal";

export type EditorTarget = { kind: "new"; date: string } | { kind: "occurrence"; occ: Occurrence };

const CHOICE =
  "flex w-full items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left transition-colors duration-150 hover:border-line-strong hover:bg-surface-2";

/** Opens the right form for a target: new event, one date of a series
 * (after asking "just this date or all dates"), or a whole event. */
export default function EventEditor({ target, onClose }: { target: EditorTarget; onClose: () => void }) {
  const [step, setStep] = useState<"scope" | "this" | "load" | "series">(
    target.kind === "new" ? "series" : target.occ.recurring ? "scope" : "load"
  );
  const [event, setEvent] = useState<CalendarEvent | null>(null);

  useEffect(() => {
    if (step !== "load" || target.kind !== "occurrence") return;
    let cancelled = false;
    api
      .getEvent(target.occ.event_id)
      .then((e) => {
        if (cancelled) return;
        setEvent(e);
        setStep("series");
      })
      .catch((err) => {
        if (cancelled) return;
        toastError(err, "Couldn't load the event");
        onClose();
      });
    return () => {
      cancelled = true;
    };
  }, [step, target, onClose]);

  function done() {
    notifyEventsChanged();
    onClose();
  }

  if (step === "scope" && target.kind === "occurrence") {
    return (
      <Dialog
        title="Edit recurring event"
        size="sm"
        hint={false}
        onClose={onClose}
        onSubmit={(e) => e.preventDefault()}
        footer={
          <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
            Cancel
          </button>
        }
      >
        <p className="text-sm text-fg-muted">&ldquo;{target.occ.title}&rdquo; repeats. What should change?</p>
        <div className="space-y-2">
          <button type="button" autoFocus onClick={() => setStep("this")} className={CHOICE}>
            <CalendarBlankIcon className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
            <span>
              <span className="block text-sm font-medium text-fg">Just this date</span>
              <span className="block text-xs text-fg-muted">{formatDateLong(target.occ.occurrence_date)}</span>
            </span>
          </button>
          <button type="button" onClick={() => setStep("load")} className={CHOICE}>
            <StackIcon className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
            <span>
              <span className="block text-sm font-medium text-fg">All dates in the series</span>
              <span className="block text-xs text-fg-muted">Time, repeat pattern, title, location</span>
            </span>
          </button>
        </div>
      </Dialog>
    );
  }

  if (step === "this" && target.kind === "occurrence") {
    return <OccurrenceModal occ={target.occ} onClose={onClose} onDone={done} />;
  }

  if (step === "series") {
    return (
      <EventModal
        event={event}
        defaultDate={target.kind === "new" ? target.date : target.occ.occurrence_date}
        onClose={onClose}
        onDone={done}
      />
    );
  }

  return null;
}
```

- [ ] **Verify** — `cd frontend && npx tsc --noEmit && npx eslint src` → no output.
- [ ] **Commit** — `git add frontend/src/components/events && git commit -m "Add agenda list, event form, single-date form and editor"`

---

### Task 7: Calendar and Today pages

**Files:** replace `frontend/src/app/calendar/page.tsx`; modify `frontend/src/app/today/page.tsx`

<!-- file: frontend/src/app/calendar/page.tsx -->
```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarBlankIcon, CaretLeftIcon, CaretRightIcon, CheckIcon, PlusIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { compactTime, eventHue } from "@/lib/calendarEvents";
import { onEventsChanged, onTasksChanged } from "@/lib/events";
import { addDaysIso, categoryHue, formatDateLong, todayIso } from "@/lib/format";
import { isTaskDone, type Occurrence, type Task } from "@/lib/types";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, ICON_BUTTON } from "@/lib/ui";
import { PageHeader, TaskList } from "@/components/PageParts";
import AgendaList from "@/components/events/AgendaList";
import EventEditor, { type EditorTarget } from "@/components/events/EventEditor";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local dates an occurrence covers (exclusive end, so an all-day event
 * ending at midnight doesn't spill into the next day). */
function coveredDays(o: Occurrence): string[] {
  const first = o.start_at.slice(0, 10);
  const last = isoOf(new Date(new Date(o.end_at).getTime() - 60_000));
  const out: string[] = [];
  for (let d = first; d <= last && out.length < 62; d = addDaysIso(d, 1)) out.push(d);
  return out.length ? out : [first];
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() }; // month is 0-indexed
  });
  const [selected, setSelected] = useState<string>(() => todayIso());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [occs, setOccs] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<EditorTarget | null>(null);

  const rangeStart = `${cursor.year}-${pad(cursor.month + 1)}-01`;
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const rangeEnd = `${cursor.year}-${pad(cursor.month + 1)}-${pad(daysInMonth)}`;

  useEffect(() => {
    let cancelled = false;
    function load() {
      Promise.all([
        api.listTasks({ due_after: rangeStart, due_before: rangeEnd }),
        api.getSchedule(rangeStart, rangeEnd, true),
      ])
        .then(([t, s]) => {
          if (cancelled) return;
          setTasks(t.tasks);
          setOccs(s.occurrences);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    load();
    const offTasks = onTasksChanged(load);
    const offEvents = onEventsChanged(load);
    return () => {
      cancelled = true;
      offTasks();
      offEvents();
    };
  }, [rangeStart, rangeEnd]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.due_date) continue;
      if (!map.has(t.due_date)) map.set(t.due_date, []);
      map.get(t.due_date)!.push(t);
    }
    return map;
  }, [tasks]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const o of occs) {
      for (const d of coveredDays(o)) {
        if (!map.has(d)) map.set(d, []);
        map.get(d)!.push(o);
      }
    }
    return map;
  }, [occs]);

  const firstWeekday = new Date(cursor.year, cursor.month, 1).getDay(); // 0=Sun
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const today = todayIso();
  const viewingCurrentMonth = today.startsWith(`${cursor.year}-${pad(cursor.month + 1)}`);

  function goTo(year: number, month: number) {
    const d = new Date(year, month, 1);
    const next = { year: d.getFullYear(), month: d.getMonth() };
    setCursor(next);
    const prefix = `${next.year}-${pad(next.month + 1)}`;
    setSelected(today.startsWith(prefix) ? today : `${prefix}-01`);
  }

  const dayEvents = eventsByDay.get(selected) ?? [];
  const dayTasks = tasksByDay.get(selected) ?? [];

  function onUpdated(updated: Task) {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }
  function onDeleted(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div>
      <PageHeader
        title={monthLabel}
        actions={
          <>
            {!viewingCurrentMonth && (
              <button
                onClick={() => {
                  const now = new Date();
                  goTo(now.getFullYear(), now.getMonth());
                }}
                className={`h-8 py-0 text-[13px] ${BUTTON_SECONDARY}`}
              >
                Today
              </button>
            )}
            <div className="flex items-center rounded-lg border border-line">
              <button onClick={() => goTo(cursor.year, cursor.month - 1)} aria-label="Previous month" className={ICON_BUTTON}>
                <CaretLeftIcon className="h-4 w-4" aria-hidden />
              </button>
              <button onClick={() => goTo(cursor.year, cursor.month + 1)} aria-label="Next month" className={ICON_BUTTON}>
                <CaretRightIcon className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <button onClick={() => setEditor({ kind: "new", date: selected })} className={`h-8 py-0 text-[13px] ${BUTTON_PRIMARY}`}>
              <PlusIcon weight="bold" className="h-4 w-4" aria-hidden />
              Add event
            </button>
          </>
        }
      />

      <div className={`overflow-hidden ${CARD} ${loading ? "opacity-60" : ""} transition-opacity`}>
        <div className="grid grid-cols-7 border-b border-line">
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} className="py-2 text-center text-xs font-medium text-fg-faint">
              <span className="sm:hidden">{d[0]}</span>
              <span className="hidden sm:inline">{d}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 [&>*:nth-child(7n)]:border-r-0">
          {cells.map((day, idx) => {
            const iso = day ? `${cursor.year}-${pad(cursor.month + 1)}-${pad(day)}` : null;
            const lastRow = idx >= cells.length - 7;

            if (!day || !iso) {
              return (
                <div key={idx} className={`min-h-16 border-r border-line bg-surface-2/40 sm:min-h-24 ${lastRow ? "" : "border-b"}`} />
              );
            }

            const cellEvents = (eventsByDay.get(iso) ?? []).filter((o) => !o.cancelled);
            const cellTasks = tasksByDay.get(iso) ?? [];
            const isToday = iso === today;
            const isSelected = iso === selected;
            const total = cellEvents.length + cellTasks.length;
            const openTasks = cellTasks.filter((t) => !isTaskDone(t)).length;
            const shownEvents = cellEvents.slice(0, 3);
            const shownTasks = cellTasks.slice(0, Math.max(0, 3 - shownEvents.length));

            return (
              <button
                key={idx}
                onClick={() => setSelected(iso)}
                aria-pressed={isSelected}
                aria-label={`${formatDateLong(iso)}, ${cellEvents.length} event${cellEvents.length === 1 ? "" : "s"}, ${cellTasks.length} task${cellTasks.length === 1 ? "" : "s"}`}
                className={`group relative flex min-h-16 flex-col items-stretch gap-1 border-r border-line p-1.5 text-left transition-colors duration-150 sm:min-h-24 ${
                  lastRow ? "" : "border-b"
                } ${isSelected ? "bg-accent-soft" : "hover:bg-surface-2/70"}`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center self-start rounded-full font-mono text-xs tabular-nums ${
                    isToday ? "bg-accent font-semibold text-accent-fg" : isSelected ? "font-semibold text-accent-text" : "text-fg-muted"
                  }`}
                >
                  {day}
                </span>

                {/* Small screens: one count per day. */}
                {total > 0 && (
                  <span className="mx-auto font-mono text-[11px] tabular-nums text-fg-muted sm:hidden">
                    {cellEvents.length + openTasks > 0 ? (
                      cellEvents.length + openTasks
                    ) : (
                      <CheckIcon weight="bold" className="mx-auto h-3 w-3 text-accent" aria-hidden />
                    )}
                  </span>
                )}

                {/* Larger screens: events (with times) then tasks. */}
                <span className="hidden space-y-0.5 sm:block">
                  {shownEvents.map((o) => (
                    <span key={`${o.event_id}-${o.occurrence_date}`} className="flex items-center gap-1 truncate rounded bg-surface-2 px-1 py-px text-[11px] leading-4 text-fg">
                      <span className={`h-3 w-0.5 shrink-0 rounded-full bg-current ${eventHue(o.category)}`} aria-hidden />
                      {!o.all_day && <span className="shrink-0 font-mono text-fg-muted">{compactTime(o.start_at)}</span>}
                      <span className="truncate">{o.title}</span>
                    </span>
                  ))}
                  {shownTasks.map((t) => (
                    <span
                      key={t.id}
                      className={`flex items-center gap-1 truncate rounded px-1 py-px text-[11px] leading-4 ${
                        isTaskDone(t) ? "text-fg-faint line-through" : "text-fg-muted"
                      }`}
                    >
                      <span className={`shrink-0 font-semibold ${categoryHue(t.category)}`} aria-hidden>
                        #
                      </span>
                      <span className="truncate">{t.title}</span>
                    </span>
                  ))}
                  {total > 3 && <span className="block px-1 text-[11px] text-fg-faint">+{total - 3} more</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section className="mt-8 space-y-5" aria-live="polite">
        <h2 className="flex items-center gap-2 px-1 text-[13px] font-medium text-fg-muted">
          <CalendarBlankIcon weight="bold" className="h-4 w-4 text-fg-faint" aria-hidden />
          {formatDateLong(selected)}
        </h2>
        {dayEvents.length > 0 && (
          <AgendaList occurrences={dayEvents} onOpen={(occ) => setEditor({ kind: "occurrence", occ })} />
        )}
        {dayTasks.length > 0 && (
          <div>
            <h3 className="px-1 pb-1.5 text-[13px] font-medium text-fg-muted">Due this day</h3>
            <TaskList key={selected} tasks={dayTasks} onUpdated={onUpdated} onDeleted={onDeleted} />
          </div>
        )}
        {dayEvents.length === 0 && dayTasks.length === 0 && (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-fg-faint">
            Nothing scheduled or due this day.
          </p>
        )}
      </section>

      {editor && <EventEditor target={editor} onClose={() => setEditor(null)} />}
    </div>
  );
}
```

`frontend/src/app/today/page.tsx` (edits):
- Imports: add `CalendarBlankIcon` to the phosphor import; change the events import to `import { notifyTasksChanged, onEventsChanged, onTasksChanged } from "@/lib/events";`; change the format import to `import { formatDateLong, todayIso } from "@/lib/format";`; change the types import to `import { isTaskDone, type Occurrence, type Task, type TodayView } from "@/lib/types";`; add `import AgendaList from "@/components/events/AgendaList";` and `import EventEditor, { type EditorTarget } from "@/components/events/EventEditor";`.
- After the existing `const [error, setError] = ...` line add:

```tsx
  const [schedule, setSchedule] = useState<Occurrence[]>([]);
  const [editor, setEditor] = useState<EditorTarget | null>(null);

  useEffect(() => {
    function loadSchedule() {
      const day = todayIso();
      api
        .getSchedule(day, day)
        .then((s) => setSchedule(s.occurrences))
        .catch(() => {});
    }
    loadSchedule();
    return onEventsChanged(loadSchedule);
  }, []);
```

- Change `{nothingToShow ? (` to `{nothingToShow && schedule.length === 0 ? (`.
- Immediately inside `<div className="space-y-8">` insert:

```tsx
          {schedule.length > 0 && (
            <section className="anim-fade-up">
              <h2 className={SECTION_HEADING}>
                <CalendarBlankIcon weight="bold" className="h-4 w-4 text-accent" aria-hidden />
                Schedule
                <span className="font-mono text-xs font-normal tabular-nums text-fg-faint">{schedule.length}</span>
              </h2>
              <AgendaList occurrences={schedule} onOpen={(occ) => setEditor({ kind: "occurrence", occ })} />
            </section>
          )}
```

  and add `SECTION_HEADING` via `import { SECTION_HEADING } from "@/lib/ui";`.
- Before the final closing `</div>` of the returned JSX add `{editor && <EventEditor target={editor} onClose={() => setEditor(null)} />}`.

- [ ] **Verify** — `cd frontend && npx tsc --noEmit && npx eslint src` → no output. Browser (dev server on :3001, backend rebuilt per Task 8 step 1): Calendar shows "Add event"; create a weekly MWF series with an end date and a skipped date via the form (preview updates live); events show in cells with times; clicking an occurrence asks "Just this date / All dates"; move one date, cancel another, restore it; Today shows the Schedule section when today has events; light and dark; phone width without horizontal scroll.
- [ ] **Commit** — `git add frontend/src/app/calendar frontend/src/app/today && git commit -m "Show events on Calendar and Today with add/edit flows"`

---

### Task 8: End-to-end verification

- [ ] **Step 1:** `docker compose up -d --build backend mcp` (installs `python-dateutil` in the image and creates `events`/`event_overrides` on startup). Confirm healthy and both tables exist; existing table counts unchanged.
- [ ] **Step 2:** full backend suite → all pass (99 + new).
- [ ] **Step 3:** production frontend build in a scratch copy (`cp -cR` node_modules) → success.
- [ ] **Step 4:** real MCP client against `http://localhost:8001/mcp`: list tools (35), `create_event` a test series with `RRULE:` prefix and a date-only UNTIL, `get_schedule`, `edit_occurrence` cancel; confirm it renders on `/calendar`.
- [ ] **Step 5:** delete every test event created during verification (by id), confirm `events` and `event_overrides` are empty again and other tables untouched.
