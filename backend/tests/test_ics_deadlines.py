"""Imported deadlines: Canvas-style date-only assignments become 11:59 PM
deadlines, and they can be checked off without a sync ever erasing it.

Fixtures follow what Canvas actually emits (canvas-lms
CalendarEvent::IcalEvent#to_ics): an assignment due at 11:59 PM is a
date-only DTSTART with no DTEND, other due times are DTSTART == DTEND in
UTC; UIDs are "event-assignment-<id>" / "event-calendar-event-<id>"; URLs
end in "#assignment_<id>"; SUMMARY gets " [COURSE]". No completion or
submission fields are present."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

import mcp_server.server as mcp_server
from app.schemas import CalendarSubscriptionCreate, EventUpdate
from app.services import calendar_sync as sync
from app.services import events as events_svc
from app.services import ics
from tests.test_calendar_sync import Feed, calendar, live

NY = ZoneInfo("America/New_York")
CANVAS = "https://canvas.vt.edu/calendar?include_contexts=course_123&month=10&year=2026"


def canvas_assignment(aid, title, due_date, course="CS-3214"):
    return "\r\n".join([
        "BEGIN:VEVENT", "CLASS:PUBLIC", f"DTSTART;VALUE=DATE:{due_date}", "DTSTAMP:20261001T120000Z",
        f"SUMMARY:{title} [{course}]", f"UID:event-assignment-{aid}", f"URL:{CANVAS}#assignment_{aid}",
        "SEQUENCE:0", "END:VEVENT",
    ])


def canvas_timed_assignment(aid, title, due_utc):
    return "\r\n".join([
        "BEGIN:VEVENT", f"DTSTART:{due_utc}", f"DTEND:{due_utc}", f"SUMMARY:{title} [CS-3214]",
        f"UID:event-assignment-{aid}", f"URL:{CANVAS}#assignment_{aid}", "END:VEVENT",
    ])


def canvas_calendar_event(cid, title, start, end=None):
    lines = ["BEGIN:VEVENT", f"DTSTART;VALUE=DATE:{start}"]
    if end:
        lines.append(f"DTEND;VALUE=DATE:{end}")
    lines += [f"SUMMARY:{title}", f"UID:event-calendar-event-{cid}", f"URL:{CANVAS}#calendar_event_{cid}", "END:VEVENT"]
    return "\r\n".join(lines)


def vtodo(uid, title, due, extra=""):
    return "\r\n".join(["BEGIN:VTODO", f"UID:{uid}", f"SUMMARY:{title}", f"DUE:{due}"] + extra.split("\r\n") + ["END:VTODO"]).replace("\r\n\r\n", "\r\n")


HW5 = canvas_assignment(501, "Homework 5", "20261008")


@pytest.fixture()
def feed():
    f = Feed()
    yield f
    f.close()


def subscribe(session, url, name="Canvas"):
    return sync.create_subscription(session, CalendarSubscriptionCreate(name=name, url=url))


# ---- classification and 11:59 PM -------------------------------------------


def test_date_only_canvas_assignment_is_due_at_1159_pm():
    [p] = ics.parse(calendar(HW5), NY)
    assert p.deadline and not p.all_day
    assert p.start_at == datetime(2026, 10, 8, 23, 59)  # wall clock in the app timezone
    assert p.end_at - p.start_at == timedelta(minutes=1)  # an instant, not a 24-hour block


def test_1159_pm_is_wall_clock_across_dst():
    # Nov 2 is after DST ends (EST, UTC-5); Oct 8 is EDT (UTC-4). Both are
    # 23:59 local: no fixed offset is ever applied.
    a, b = ics.parse(calendar(HW5, canvas_assignment(502, "Homework 6", "20261102")), NY)
    assert (a.start_at.time(), b.start_at.time()) == (datetime(1, 1, 1, 23, 59).time(),) * 2
    assert b.start_at.replace(tzinfo=NY).utcoffset() == timedelta(hours=-5)
    assert a.start_at.replace(tzinfo=NY).utcoffset() == timedelta(hours=-4)


def test_genuine_all_day_events_stay_all_day():
    parsed = {p.title: p for p in ics.parse(calendar(
        canvas_calendar_event(9, "Fall Break", "20261008", "20261010"),
        canvas_calendar_event(10, "Homecoming", "20261017"),
        # Not Canvas, no LMS evidence: a title alone never converts.
        "BEGIN:VEVENT\r\nUID:x1@school\r\nDTSTART;VALUE=DATE:20261020\r\nSUMMARY:Project day\r\nEND:VEVENT",
    ), NY, source_name="School calendar")}
    brk = parsed["Fall Break"]
    assert brk.all_day and not brk.deadline
    assert (brk.start_at, brk.end_at) == (datetime(2026, 10, 8), datetime(2026, 10, 10))
    assert parsed["Homecoming"].all_day and not parsed["Homecoming"].deadline
    assert parsed["Project day"].all_day and not parsed["Project day"].deadline


def test_classifier_evidence():
    import icalendar

    def comp(text):
        return next(iter(icalendar.Calendar.from_ical(calendar(text)).walk("VEVENT")))

    plain = "BEGIN:VEVENT\r\nUID:{uid}\r\nDTSTART;VALUE=DATE:20261008\r\nSUMMARY:{s}\r\n{extra}END:VEVENT"
    assert ics.classify_deadline(comp(plain.format(uid="event-assignment-override-7", s="Lab 3", extra="")))
    assert ics.classify_deadline(comp(plain.format(uid="event-sub-assignment-8", s="Discussion", extra="")))
    assert not ics.classify_deadline(comp(plain.format(uid="event-calendar-event-3", s="Quiz review session", extra="")))
    # An LMS assignment link is enough; a title word alone is not.
    assert ics.classify_deadline(comp(plain.format(uid="a@x", s="Essay", extra="URL:https://lms.example.edu/courses/1/assignments/9\r\n")))
    assert not ics.classify_deadline(comp(plain.format(uid="a@x", s="Homework 5", extra="")))
    # Title words plus an LMS source (the subscription's name) count.
    assert ics.classify_deadline(comp(plain.format(uid="a@x", s="Homework 5 due", extra="")), "Canvas")
    assert not ics.classify_deadline(comp(plain.format(uid="a@x", s="Fall Break", extra="")), "Canvas")


def test_timed_canvas_assignment_is_a_deadline_but_keeps_its_time():
    [p] = ics.parse(calendar(canvas_timed_assignment(600, "Quiz 3", "20261009T210000Z")), NY)
    assert p.deadline and p.start_at == datetime(2026, 10, 9, 17, 0)


def test_recurring_and_multi_day_items_are_never_deadlines():
    series = "BEGIN:VEVENT\r\nUID:event-assignment-77\r\nDTSTART;VALUE=DATE:20261005\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nSUMMARY:Weekly reading\r\nEND:VEVENT"
    [p] = ics.parse(calendar(series), NY)
    assert not p.deadline and p.all_day


# ---- completion through sync -----------------------------------------------


def test_local_completion_survives_identical_and_changed_syncs(session, feed):
    feed.body = calendar(HW5)
    sub = subscribe(session, feed.url)
    sync.sync_subscription(session, sub)
    hw = live(session, sub)["event-assignment-501"]
    assert hw.is_deadline and hw.completed_at is None

    events_svc.set_completed(session, hw, True)
    assert hw.completion_source == "local"

    again = sync.sync_subscription(session, sub)  # identical feed (304 here)
    assert again.status in ("ok", "not_modified")
    feed.body = calendar(HW5) + b"\r\n"  # same content, new bytes: a real re-parse
    assert sync.sync_subscription(session, sub).unchanged == 1
    session.refresh(hw)
    assert hw.completed_at is not None and hw.completion_source == "local"

    feed.body = calendar(canvas_assignment(501, "Homework 5", "20261012"))  # Canvas moves the deadline
    moved = sync.sync_subscription(session, sub)
    assert moved.updated == 1
    session.refresh(hw)
    assert hw.start_at == datetime(2026, 10, 12, 23, 59)  # feed fields updated
    assert hw.completed_at is not None and hw.completion_source == "local"  # checkmark kept


def test_feed_without_completion_data_never_unchecks(session):
    sub = subscribe(session, "https://canvas.example.test/feed.ics")
    fetch = lambda url, etag=None, last_modified=None: sync.FetchResult(200, calendar(HW5), None, None)  # noqa: E731
    sync.sync_subscription(session, sub, fetch=fetch)
    hw = live(session, sub)["event-assignment-501"]
    events_svc.set_completed(session, hw, True)
    for _ in range(3):
        sync.sync_subscription(session, sub, fetch=fetch)
    session.refresh(hw)
    assert hw.completed_at is not None and hw.external_completed is None


def test_explicit_external_completion_from_vtodo(session):
    sub = subscribe(session, "https://tasks.example.test/todo.ics", name="School tasks")
    body = {"v": calendar(vtodo("todo-1", "Problem set 4", "20261009T035900Z", "STATUS:NEEDS-ACTION"))}
    fetch = lambda url, etag=None, last_modified=None: sync.FetchResult(200, body["v"], None, None)  # noqa: E731
    sync.sync_subscription(session, sub, fetch=fetch)
    todo = live(session, sub)["todo-1"]
    assert todo.is_deadline and todo.completed_at is None and todo.external_completed is False

    body["v"] = calendar(vtodo("todo-1", "Problem set 4", "20261009T035900Z", "STATUS:COMPLETED\r\nCOMPLETED:20261008T150000Z"))
    assert sync.sync_subscription(session, sub, fetch=fetch).updated == 1
    session.refresh(todo)
    assert todo.completion_source == "external" and todo.completed_at == datetime(2026, 10, 8, 15, 0)  # UTC app tz

    # The source flips back: an externally-set checkmark follows it...
    body["v"] = calendar(vtodo("todo-1", "Problem set 4", "20261009T035900Z", "STATUS:NEEDS-ACTION"))
    sync.sync_subscription(session, sub, fetch=fetch)
    session.refresh(todo)
    assert todo.completed_at is None

    # ...but a local checkmark is never removed by an explicit "not done".
    events_svc.set_completed(session, todo, True)
    sync.sync_subscription(session, sub, fetch=fetch)
    body["v"] = calendar(vtodo("todo-1", "Problem set 4", "20261009T035900Z", "PERCENT-COMPLETE:40"))
    sync.sync_subscription(session, sub, fetch=fetch)
    session.refresh(todo)
    assert todo.completed_at is not None and todo.completion_source == "local"


def test_unchecking_an_externally_completed_item_sticks_until_the_source_changes(session):
    sub = subscribe(session, "https://tasks.example.test/todo.ics", name="School tasks")
    done = calendar(vtodo("todo-2", "Reading", "20261009T035900Z", "STATUS:COMPLETED"))
    fetch = lambda url, etag=None, last_modified=None: sync.FetchResult(200, done, None, None)  # noqa: E731
    sync.sync_subscription(session, sub, fetch=fetch)
    item = live(session, sub)["todo-2"]
    assert item.completion_source == "external"
    events_svc.set_completed(session, item, False)
    sync.sync_subscription(session, sub, fetch=fetch)  # same statement as before: not re-applied
    session.refresh(item)
    assert item.completed_at is None


def test_cancellation_is_not_completion(session):
    cancelled = canvas_assignment(700, "Lab 9", "20261015").replace("SEQUENCE:0", "STATUS:CANCELLED")
    sub = subscribe(session, "https://canvas.example.test/c.ics")
    fetch = lambda url, etag=None, last_modified=None: sync.FetchResult(200, calendar(cancelled), None, None)  # noqa: E731
    sync.sync_subscription(session, sub, fetch=fetch)
    lab = live(session, sub)["event-assignment-700"]
    assert lab.external_status == "cancelled" and lab.completed_at is None and lab.external_completed is None
    [occ] = events_svc.occurrences(session, date(2026, 10, 15), date(2026, 10, 15), include_cancelled=True)
    assert occ.cancelled and not occ.completed and occ.deadline


# ---- completion rules ------------------------------------------------------


def test_only_deadlines_can_be_completed_and_nothing_else_changes(session, feed):
    feed.body = calendar(HW5, canvas_calendar_event(9, "Fall Break", "20261008", "20261010"))
    sub = subscribe(session, feed.url)
    sync.sync_subscription(session, sub)
    events = live(session, sub)
    with pytest.raises(ValueError, match="not a deadline"):
        events_svc.set_completed(session, events["event-calendar-event-9"], True)
    hw = events["event-assignment-501"]
    events_svc.set_completed(session, hw, True)
    with pytest.raises(ValueError, match="read-only"):
        events_svc.update_event(session, hw, EventUpdate(title="mine"))
    [occ] = [o for o in events_svc.occurrences(session, date(2026, 10, 8), date(2026, 10, 8)) if o.deadline]
    assert occ.completed and occ.read_only and occ.subscription_name == "Canvas" and occ.title == "Homework 5 [CS-3214]"


def test_rest_and_mcp_share_completion(client, auth_headers, feed):
    feed.body = calendar(HW5, canvas_calendar_event(9, "Fall Break", "20261008", "20261010"))
    sid = client.post("/api/calendar-subscriptions", headers=auth_headers, json={"name": "Canvas", "url": feed.url}).json()["subscription"]["id"]
    occs = client.get("/api/events/schedule?start_date=2026-10-08&end_date=2026-10-08", headers=auth_headers).json()["occurrences"]
    hw = next(o for o in occs if o["deadline"])
    brk = next(o for o in occs if not o["deadline"])
    assert hw["start_at"] == "2026-10-08T23:59:00" and not hw["all_day"] and brk["all_day"]

    r = client.post(f"/api/events/{hw['event_id']}/complete", headers=auth_headers)
    assert r.status_code == 200 and r.json()["completed"] and r.json()["completion_source"] == "local"
    assert client.post(f"/api/events/{brk['event_id']}/complete", headers=auth_headers).status_code == 422
    assert client.patch(f"/api/events/{hw['event_id']}", headers=auth_headers, json={"title": "x"}).status_code == 422

    found = mcp_server.get_deadlines("2026-10-01", "2026-10-31")
    assert [d["completed"] for d in found["deadlines"]] == [True]
    assert mcp_server.get_deadlines("2026-10-01", "2026-10-31", include_completed=False)["count"] == 0
    assert mcp_server.set_deadline_completed(hw["event_id"], completed=False)["completed"] is False
    assert "not a deadline" in mcp_server.set_deadline_completed(brk["event_id"])["error"]
    mcp_server.set_deadline_completed(hw["event_id"])

    client.post(f"/api/calendar-subscriptions/{sid}/sync", headers=auth_headers)  # sync keeps it
    ev = client.get(f"/api/events/{hw['event_id']}", headers=auth_headers).json()
    assert ev["completed"] and ev["is_deadline"]
