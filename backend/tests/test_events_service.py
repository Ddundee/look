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
