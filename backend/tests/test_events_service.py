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
