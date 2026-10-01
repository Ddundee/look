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
