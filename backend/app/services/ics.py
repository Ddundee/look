"""Parse iCalendar (.ics) data into plain records Look can store as events.

Parsing is done by the `icalendar` package; this module only maps its
components onto Look's event model:

- times become naive wall-clock times in the app's timezone, like every
  other event (UTC and TZID times are converted; floating times are kept);
- all-day events (DATE values) become midnight-to-midnight ranges;
- RRULE/EXDATE carry over when Look's recurrence engine supports the rule
  (at most once a day), otherwise the event is imported as its first
  occurrence with a warning;
- instances with RECURRENCE-ID become per-date overrides of their series;
- VTODOs with a DUE (task feeds) become a short event at the due time.

Nothing here touches the database; see app.services.calendar_sync.
"""

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo

import icalendar

from app.services.events import build_rule, normalize_rrule

# A deadline with no length (Canvas assignments have DTSTART == DTEND) is
# shown as a one-minute event, since Look events need end after start.
INSTANT = timedelta(minutes=1)
MAX_TITLE = 200
MAX_TEXT = 5000


class IcsError(ValueError):
    """The data isn't a usable iCalendar file."""


@dataclass
class ParsedOverride:
    original_date: date
    cancelled: bool = False
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    title: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None


@dataclass
class ParsedEvent:
    uid: str
    title: str
    start_at: datetime
    end_at: datetime
    all_day: bool
    notes: Optional[str] = None
    location: Optional[str] = None
    url: Optional[str] = None
    status: Optional[str] = None  # "cancelled" or None
    rrule: Optional[str] = None
    exdates: List[str] = field(default_factory=list)
    overrides: List[ParsedOverride] = field(default_factory=list)
    sequence: int = 0
    warnings: List[str] = field(default_factory=list)

    def content_hash(self) -> str:
        """Stable digest of everything that ends up in Look, so a re-sync
        can tell an unchanged event from a changed one."""
        data = asdict(self)
        data.pop("warnings")
        data.pop("sequence")
        return hashlib.sha256(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()


def _text(component, name: str, limit: int = MAX_TEXT) -> Optional[str]:
    value = component.get(name)
    if value is None:
        return None
    text = str(value).strip()
    return text[:limit] or None


def _local(value, tz: ZoneInfo) -> datetime:
    """A DATE-TIME as naive local time in `tz`. Floating times (no zone)
    are taken as already local."""
    if value.tzinfo is None:
        return value.replace(microsecond=0)
    return value.astimezone(tz).replace(tzinfo=None, microsecond=0)


def _decoded(component, name: str):
    if name not in component:
        return None
    try:
        return component.decoded(name)
    except Exception:  # noqa: BLE001 - one bad property shouldn't sink the event
        return None


def _times(component, tz: ZoneInfo):
    """(start, end, all_day) for a VEVENT or VTODO, or None if it has no
    usable start."""
    start = _decoded(component, "DTSTART")
    end = _decoded(component, "DTEND")
    due = _decoded(component, "DUE")
    duration = _decoded(component, "DURATION")
    if start is None and due is not None:  # a VTODO with only a due time
        start, end = due, None
        duration = None
    if start is None:
        return None
    if end is None and due is not None and component.name == "VTODO":
        end = due

    if not isinstance(start, datetime):  # a DATE: all-day
        if isinstance(end, datetime):
            end = end.date()
        if not isinstance(end, date) or end <= start:
            days = duration.days if isinstance(duration, timedelta) and duration.days > 0 else 1
            end = start + timedelta(days=days)
        return datetime.combine(start, datetime.min.time()), datetime.combine(end, datetime.min.time()), True

    start_at = _local(start, tz)
    if isinstance(end, datetime):
        end_at = _local(end, tz)
    elif isinstance(duration, timedelta):
        end_at = start_at + duration
    else:
        end_at = start_at
    if end_at <= start_at:
        end_at = start_at + INSTANT
    return start_at, end_at, False


def _exdates(component, tz: ZoneInfo) -> List[str]:
    raw = component.get("EXDATE")
    if raw is None:
        return []
    out = set()
    for prop in raw if isinstance(raw, list) else [raw]:
        for item in getattr(prop, "dts", []):
            value = item.dt
            out.add((_local(value, tz).date() if isinstance(value, datetime) else value).isoformat())
    return sorted(out)


def _rrule(component, tz: ZoneInfo) -> Optional[str]:
    """The RRULE as Look stores it: UNTIL in local time, no Z."""
    raw = component.get("RRULE")
    if raw is None:
        return None
    if isinstance(raw, list):  # multiple RRULEs are deprecated; use the first
        raw = raw[0]
    parts = []
    for key, values in raw.items():
        if key == "UNTIL":
            until = values[0]
            text = (
                _local(until, tz).strftime("%Y%m%dT%H%M%S")
                if isinstance(until, datetime)
                else until.strftime("%Y%m%d")
            )
            parts.append(f"UNTIL={text}")
        else:
            parts.append(icalendar.vRecur({key: values}).to_ical().decode())
    return ";".join(parts)


def _recurrence_date(component, tz: ZoneInfo) -> Optional[date]:
    value = _decoded(component, "RECURRENCE-ID")
    if value is None:
        return None
    return _local(value, tz).date() if isinstance(value, datetime) else value


def _status(component) -> Optional[str]:
    return "cancelled" if str(component.get("STATUS", "")).upper() == "CANCELLED" else None


def _sequence(component) -> int:
    try:
        return int(component.get("SEQUENCE", 0))
    except (TypeError, ValueError):
        return 0


def _uid(component, start_at: datetime, title: str) -> str:
    uid = _text(component, "UID", 500)
    if uid:
        return uid
    # No UID (rare, but some exporters omit it): derive a stable one so
    # re-syncs still match it.
    return "look-generated-" + hashlib.sha256(f"{title}|{start_at.isoformat()}".encode()).hexdigest()[:32]


def _validate_bytes(data: bytes) -> str:
    if not data or not data.strip():
        raise IcsError("The file is empty.")
    text = data.decode("utf-8-sig", errors="replace").strip()
    if not text.upper().startswith("BEGIN:VCALENDAR"):
        hint = " (it looks like a web page; check the link)" if text[:200].lstrip().startswith("<") else ""
        raise IcsError(f"This isn't an iCalendar (.ics) calendar{hint}.")
    if not text.upper().rstrip().endswith("END:VCALENDAR"):
        raise IcsError("The calendar data is incomplete (no END:VCALENDAR); the download may have been cut off.")
    return text


def parse(data: bytes, tz: ZoneInfo) -> List[ParsedEvent]:
    """Every event in the calendar, one ParsedEvent per UID. Raises
    IcsError if the data as a whole can't be read; individual events that
    can't be used (no start time) are skipped."""
    text = _validate_bytes(data)
    try:
        cal = icalendar.Calendar.from_ical(text)
    except Exception as exc:  # noqa: BLE001 - icalendar raises plain ValueErrors and others
        raise IcsError(f"This isn't a valid iCalendar (.ics) calendar: {exc}") from None

    masters: Dict[str, ParsedEvent] = {}
    instances: Dict[str, List[tuple]] = {}
    for component in cal.walk():
        if component.name not in ("VEVENT", "VTODO"):
            continue
        times = _times(component, tz)
        if times is None:
            continue
        start_at, end_at, all_day = times
        title = (_text(component, "SUMMARY", MAX_TITLE) or "(untitled)").replace("\n", " ")
        uid = _uid(component, start_at, title)

        recurrence = _recurrence_date(component, tz)
        if recurrence is not None:
            instances.setdefault(uid, []).append((recurrence, component, start_at, end_at, all_day, title))
            continue

        event = ParsedEvent(
            uid=uid,
            title=title,
            start_at=start_at,
            end_at=end_at,
            all_day=all_day,
            notes=_text(component, "DESCRIPTION"),
            location=_text(component, "LOCATION", 200),
            url=_text(component, "URL", 2000),
            status=_status(component),
            sequence=_sequence(component),
        )
        raw_rule = _rrule(component, tz)
        if raw_rule:
            try:
                rule = normalize_rrule(raw_rule)
                if rule and build_rule(rule, start_at).after(start_at, inc=True) is None:
                    raise ValueError("it produces no dates")
                event.rrule = rule
                event.exdates = _exdates(component, tz)
            except ValueError as exc:
                event.warnings.append(
                    f"'{title}': repeat rule {raw_rule} isn't supported ({exc}); imported only its first date."
                )
        current = masters.get(uid)
        if current is None or event.sequence >= current.sequence:
            masters[uid] = event

    for uid, items in instances.items():
        master = masters.get(uid)
        for original, component, start_at, end_at, all_day, title in sorted(items, key=lambda i: i[0]):
            if master is None or not master.rrule:
                # An instance without its series in the feed: keep it as its
                # own event so it isn't lost.
                key = f"{uid}#{original.isoformat()}"
                masters[key] = ParsedEvent(
                    uid=key,
                    title=title,
                    start_at=start_at,
                    end_at=end_at,
                    all_day=all_day,
                    notes=_text(component, "DESCRIPTION"),
                    location=_text(component, "LOCATION", 200),
                    url=_text(component, "URL", 2000),
                    status=_status(component),
                )
                continue
            if _status(component):
                master.overrides.append(ParsedOverride(original_date=original, cancelled=True))
                continue
            moved = start_at != datetime.combine(original, master.start_at.time()) or (
                end_at - start_at != master.end_at - master.start_at
            )
            master.overrides.append(
                ParsedOverride(
                    original_date=original,
                    start_at=start_at if moved else None,
                    end_at=end_at if moved else None,
                    title=title if title != master.title else None,
                    location=_text(component, "LOCATION", 200),
                    notes=_text(component, "DESCRIPTION"),
                )
            )

    return list(masters.values())
