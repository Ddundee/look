"""ICS calendar subscriptions: parsing, sync/reconcile, the scheduler, and
file imports. Feeds are served by a real local HTTP server whose content the
tests change between syncs, so "the same URL now has a new event" is
exercised exactly as it happens with Canvas."""

import threading
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from zoneinfo import ZoneInfo

import pytest
from sqlmodel import select

from app.models import CalendarSubscription, Event, EventOverride
from app.schemas import CalendarSubscriptionCreate, CalendarSubscriptionUpdate, EventUpdate
from app.services import calendar_sync as sync
from app.services import events as events_svc
from app.services import ics

NY = ZoneInfo("America/New_York")  # tests pin APP_TIMEZONE to UTC; parse() takes the zone explicitly


def vevent(uid, summary, start, end=None, extra=""):
    lines = ["BEGIN:VEVENT", f"UID:{uid}", "DTSTAMP:20260901T000000Z", f"SUMMARY:{summary}", f"DTSTART{start}"]
    if end:
        lines.append(f"DTEND{end}")
    if extra:
        lines.extend(extra.strip().splitlines())
    lines.append("END:VEVENT")
    return "\r\n".join(lines)


def calendar(*events):
    return ("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Look tests//EN\r\n" + "\r\n".join(events) + "\r\nEND:VCALENDAR\r\n").encode()


A = vevent("assignment-a@canvas", "Assignment A", ":20261005T035900Z", ":20261005T035900Z", "URL:https://canvas.example.edu/a")
B = vevent("assignment-b@canvas", "Assignment B", ":20261010T035900Z", ":20261010T035900Z")
B_MOVED = vevent("assignment-b@canvas", "Assignment B", ":20261017T035900Z", ":20261017T035900Z")
C = vevent("assignment-c@canvas", "Assignment C (published later)", ":20261103T045900Z", ":20261103T045900Z")


class Feed:
    """A real HTTP server serving whatever `body` is set to, with ETag
    support, and a switch to fail. Records every request it gets."""

    def __init__(self):
        self.body = calendar(A, B)
        self.status = 200
        self.requests = []
        feed = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                feed.requests.append(dict(self.headers))
                etag = f'"{hash(feed.body)}"'
                if feed.status != 200:
                    self.send_response(feed.status)
                    self.end_headers()
                    return
                if self.headers.get("If-None-Match") == etag:
                    self.send_response(304)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/calendar")
                self.send_header("ETag", etag)
                self.send_header("Content-Length", str(len(feed.body)))
                self.end_headers()
                self.wfile.write(feed.body)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/feeds/calendars/user_test.ics"

    def close(self):
        self.server.shutdown()


@pytest.fixture()
def feed():
    f = Feed()
    yield f
    f.close()


def subscribe(session, url, **kw):
    return sync.create_subscription(session, CalendarSubscriptionCreate(name="Canvas", url=url, **kw))


def live(session, sub):
    rows = session.exec(select(Event).where(Event.subscription_id == sub.id)).all()
    return {e.external_uid: e for e in rows if e.external_status != "removed"}


def all_imported(session, sub):
    return session.exec(select(Event).where(Event.subscription_id == sub.id)).all()


# ---- the scenario that has to work ----------------------------------------


def test_url_subscription_discovers_new_and_changed_events_on_later_syncs(session, feed):
    sub = subscribe(session, feed.url)

    first = sync.sync_subscription(session, sub)  # sync 1: feed has A, B
    assert (first.status, first.created, first.updated) == ("ok", 2, 0)
    assert set(live(session, sub)) == {"assignment-a@canvas", "assignment-b@canvas"}

    feed.body = calendar(A, B, C)  # Canvas publishes C later
    second = sync.sync_subscription(session, sub)  # sync 2: same URL, re-fetched
    assert (second.created, second.updated, second.unchanged) == (1, 0, 2)
    assert set(live(session, sub)) == {"assignment-a@canvas", "assignment-b@canvas", "assignment-c@canvas"}
    assert len(all_imported(session, sub)) == 3  # A and B not duplicated

    b_id = live(session, sub)["assignment-b@canvas"].id
    feed.body = calendar(A, B_MOVED, C)  # B's due date changes
    third = sync.sync_subscription(session, sub)
    assert (third.created, third.updated, third.unchanged) == (0, 1, 2)
    b = live(session, sub)["assignment-b@canvas"]
    assert b.id == b_id and b.start_at == datetime(2026, 10, 17, 3, 59)  # same row, moved (APP_TIMEZONE=UTC)
    assert len(all_imported(session, sub)) == 3

    before = {e.id: (e.title, e.start_at, e.external_status) for e in all_imported(session, sub)}
    feed.status = 500  # the server errors
    failed = sync.sync_subscription(session, sub)
    assert failed.status == "error" and "500" in failed.error
    assert {e.id: (e.title, e.start_at, e.external_status) for e in all_imported(session, sub)} == before
    session.refresh(sub)
    assert sub.last_error and sub.last_success_at is not None

    assert len(feed.requests) == 4  # every sync made a fresh request to the URL


def test_scheduler_refetches_due_subscriptions_without_re_adding_the_url(session, engine, feed, monkeypatch):
    sub = subscribe(session, feed.url, sync_interval_minutes=30)
    t0 = datetime(2026, 10, 2, 12, 0)
    monkeypatch.setattr(sync, "utcnow", lambda: t0)
    assert sync.run_due_syncs(engine) == {sub.id: "ok"}  # never synced: due now
    assert sync.run_due_syncs(engine) == {}  # just synced: not due

    feed.body = calendar(A, B, C)
    monkeypatch.setattr(sync, "utcnow", lambda: t0 + timedelta(minutes=31))
    assert sync.run_due_syncs(engine) == {sub.id: "ok"}  # interval passed: re-fetched on its own
    session.expire_all()
    assert set(live(session, sub)) == {"assignment-a@canvas", "assignment-b@canvas", "assignment-c@canvas"}


# ---- reconcile details -----------------------------------------------------


def test_identical_sync_is_a_noop_and_uses_conditional_request(session, feed):
    sub = subscribe(session, feed.url)
    sync.sync_subscription(session, sub)
    again = sync.sync_subscription(session, sub)
    assert again.status == "not_modified" and (again.created, again.updated) == (0, 0)
    assert feed.requests[-1].get("If-None-Match")  # still asked the server
    assert len(all_imported(session, sub)) == 2


def test_identical_content_without_etag_is_unchanged(session):
    sub = subscribe(session, "https://example.test/cal.ics")
    body = calendar(A, B)
    fetch = lambda url, etag=None, last_modified=None: sync.FetchResult(200, body, None, None)  # noqa: E731
    sync.sync_subscription(session, sub, fetch=fetch)
    again = sync.sync_subscription(session, sub, fetch=fetch)
    assert (again.status, again.created, again.updated, again.unchanged) == ("ok", 0, 0, 2)


def test_removed_uid_is_marked_not_deleted_and_comes_back(session, feed):
    sub = subscribe(session, feed.url)
    sync.sync_subscription(session, sub)
    feed.body = calendar(A)
    gone = sync.sync_subscription(session, sub)
    assert gone.removed == 1
    b = next(e for e in all_imported(session, sub) if e.external_uid == "assignment-b@canvas")
    assert b.external_status == "removed"
    occs = events_svc.occurrences(session, date(2026, 10, 9), date(2026, 10, 11), include_cancelled=True)
    assert [o.external_status for o in occs if o.title == "Assignment B"] == ["removed"]
    assert not [o for o in events_svc.occurrences(session, date(2026, 10, 9), date(2026, 10, 11)) if o.title == "Assignment B"]

    feed.body = calendar(A, B)
    back = sync.sync_subscription(session, sub)
    assert back.updated == 1
    session.refresh(b)
    assert b.external_status is None


def test_malformed_feed_changes_nothing(session, feed):
    sub = subscribe(session, feed.url)
    sync.sync_subscription(session, sub)
    feed.body = b"<html><body>Canvas is down for maintenance</body></html>"
    bad = sync.sync_subscription(session, sub)
    assert bad.status == "error" and "calendar" in bad.error.lower()
    assert set(live(session, sub)) == {"assignment-a@canvas", "assignment-b@canvas"}


def test_network_failure_changes_nothing(session):
    sub = subscribe(session, "https://example.test/cal.ics")
    ok = lambda url, etag=None, last_modified=None: sync.FetchResult(200, calendar(A, B), None, None)  # noqa: E731
    sync.sync_subscription(session, sub, fetch=ok)

    def down(url, etag=None, last_modified=None):
        raise sync.FetchError("timed out after 20s")

    failed = sync.sync_subscription(session, sub, fetch=down)
    assert failed.status == "error" and "timed out" in failed.error
    assert set(live(session, sub)) == {"assignment-a@canvas", "assignment-b@canvas"}


def test_disabled_subscription_does_not_sync(session, engine, feed, monkeypatch):
    sub = subscribe(session, feed.url)
    sync.update_subscription(session, sub, CalendarSubscriptionUpdate(enabled=False))
    result = sync.sync_subscription(session, sub)
    assert result.status == "skipped" and "disabled" in result.error
    assert sync.run_due_syncs(engine) == {}
    assert feed.requests == []


def test_one_failing_subscription_does_not_stop_others(session, engine, feed):
    broken = subscribe(session, "http://127.0.0.1:1/never.ics")
    good = subscribe(session, feed.url)
    results = sync.run_due_syncs(engine)
    assert results == {broken.id: "error", good.id: "ok"}


def test_recurring_series_with_exdate_and_moved_instance(session):
    series = vevent(
        "lecture@school", "CS 101", ";TZID=America/New_York:20261012T090000", ";TZID=America/New_York:20261012T095000",
        "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130T140000Z\r\nEXDATE;TZID=America/New_York:20261019T090000",
    )
    moved = vevent(
        "lecture@school", "CS 101 (room change)", ";TZID=America/New_York:20261026T130000",
        ";TZID=America/New_York:20261026T135000", "RECURRENCE-ID;TZID=America/New_York:20261026T090000\r\nLOCATION:Hall B",
    )
    sub = subscribe(session, "https://example.test/school.ics")
    fetch = lambda url, etag=None, last_modified=None: sync.FetchResult(200, calendar(series, moved), None, None)  # noqa: E731
    result = sync.sync_subscription(session, sub, fetch=fetch)
    assert result.created == 1
    event = next(iter(live(session, sub).values()))
    assert event.rrule.startswith("FREQ=WEEKLY") and event.exdates == ["2026-10-19"]
    occs = events_svc.occurrences(session, date(2026, 10, 12), date(2026, 10, 31))
    assert [(o.occurrence_date.isoformat(), o.start_at.hour, o.location) for o in occs] == [
        ("2026-10-12", 13, None),  # 09:00 New York = 13:00 UTC (APP_TIMEZONE in tests)
        ("2026-10-26", 17, "Hall B"),  # moved instance from RECURRENCE-ID
    ]
    assert sync.sync_subscription(session, sub, fetch=fetch).unchanged == 1  # overrides stable across syncs
    assert len(session.exec(select(EventOverride).where(EventOverride.event_id == event.id)).all()) == 1


def test_imported_events_are_read_only(session, feed):
    sub = subscribe(session, feed.url)
    sync.sync_subscription(session, sub)
    event = next(iter(live(session, sub).values()))
    with pytest.raises(ValueError, match="Canvas"):
        events_svc.update_event(session, event, EventUpdate(title="mine now"))
    with pytest.raises(ValueError, match="read-only"):
        events_svc.delete_event(session, event)
    occ = events_svc.occurrences(session, date(2026, 10, 4), date(2026, 10, 5))[0]
    assert occ.read_only and occ.subscription_name == "Canvas" and occ.external_url == "https://canvas.example.edu/a"


def test_manual_events_unaffected(session, feed):
    from app.schemas import EventCreate

    manual = events_svc.create_event(session, EventCreate(title="Gym", start_at="2026-10-05T07:00", end_at="2026-10-05T08:00"))
    sub = subscribe(session, feed.url)
    sync.sync_subscription(session, sub)
    feed.body = calendar()
    sync.sync_subscription(session, sub)  # empty feed: imported ones removed, manual untouched
    session.refresh(manual)
    assert manual.subscription_id is None and manual.external_status is None
    events_svc.update_event(session, manual, EventUpdate(title="Gym (legs)"))


# ---- subscriptions ---------------------------------------------------------


def test_duplicate_url_refused_and_webcal_normalized(session):
    sub = subscribe(session, "webcal://canvas.example.edu/feeds/calendars/user_x.ics")
    assert sub.source_url == "https://canvas.example.edu/feeds/calendars/user_x.ics"
    with pytest.raises(sync.DuplicateSubscription):
        subscribe(session, "https://canvas.example.edu/feeds/calendars/user_x.ics")
    with pytest.raises(ValueError):
        subscribe(session, "ftp://example.test/cal.ics")


def test_delete_subscription_with_or_without_events(session, feed):
    sub = subscribe(session, feed.url)
    sync.sync_subscription(session, sub)
    feed.body = calendar(A)
    sync.sync_subscription(session, sub)  # B now "removed"
    kept = sync.delete_subscription(session, sub, keep_events=True)
    assert kept == {"events_kept": 1, "events_deleted": 1}  # the removed one isn't worth keeping
    a = session.exec(select(Event).where(Event.title == "Assignment A")).one()
    assert a.subscription_id is None and a.external_uid is None and a.source == "manual"
    events_svc.update_event(session, a, EventUpdate(title="Assignment A (mine)"))  # editable now

    sub2 = subscribe(session, feed.url)
    sync.sync_subscription(session, sub2)
    gone = sync.delete_subscription(session, sub2, keep_events=False)
    assert gone == {"events_kept": 0, "events_deleted": 1}
    assert session.exec(select(CalendarSubscription)).all() == []


# ---- parsing ---------------------------------------------------------------


def test_parse_timed_all_day_tz_utc_and_fields():
    body = calendar(
        vevent("t@x", "Timed (New York)", ";TZID=America/New_York:20261012T090000", ";TZID=America/New_York:20261012T103000",
               "DESCRIPTION:Bring a laptop\r\nLOCATION:Room 210\r\nURL:https://example.test/t"),
        vevent("u@x", "UTC", ":20261012T150000Z", ":20261012T160000Z"),
        vevent("d@x", "All day", ";VALUE=DATE:20261020", ";VALUE=DATE:20261022"),
        vevent("i@x", "Deadline", ":20261005T035900Z"),
        vevent("c@x", "Cancelled", ":20261013T150000Z", ":20261013T160000Z", "STATUS:CANCELLED"),
    )
    parsed = {p.uid: p for p in ics.parse(body, NY)}
    t = parsed["t@x"]
    assert (t.start_at, t.end_at, t.all_day) == (datetime(2026, 10, 12, 9, 0), datetime(2026, 10, 12, 10, 30), False)
    assert (t.notes, t.location, t.url) == ("Bring a laptop", "Room 210", "https://example.test/t")
    assert parsed["u@x"].start_at == datetime(2026, 10, 12, 11, 0)  # 15:00Z in New York (EDT)
    d = parsed["d@x"]
    assert (d.all_day, d.start_at, d.end_at) == (True, datetime(2026, 10, 20), datetime(2026, 10, 22))
    i = parsed["i@x"]
    assert i.end_at - i.start_at == timedelta(minutes=1)  # instant deadline gets a nominal minute
    assert parsed["c@x"].status == "cancelled" and t.status is None


def test_parse_rejects_non_calendars():
    for bad in (b"", b"<html>nope</html>", b"BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:x"):
        with pytest.raises(ics.IcsError):
            ics.parse(bad, NY)


def test_unsupported_rule_becomes_single_event_with_warning():
    body = calendar(vevent("h@x", "Hourly", ":20261012T150000Z", ":20261012T151000Z", "RRULE:FREQ=HOURLY;COUNT=3"))
    [p] = ics.parse(body, NY)
    assert p.rrule is None and p.warnings and "HOURLY" in p.warnings[0]


# ---- file imports ----------------------------------------------------------


def test_file_import_is_a_snapshot_and_reimport_updates_in_place(session):
    first = sync.import_file(session, calendar(A, B), name="spring.ics")
    assert (first.status, first.created) == ("ok", 2)
    sub = session.get(CalendarSubscription, first.subscription.id)
    assert sub.source_type == "file" and sub.source_url is None
    again = sync.import_file(session, calendar(A, B_MOVED, C), name="spring.ics")  # same name: same source
    assert again.subscription.id == sub.id and (again.created, again.updated, again.unchanged) == (1, 1, 1)
    assert len(all_imported(session, sub)) == 3
    with pytest.raises(ValueError, match="re-upload"):
        sync.sync_subscription(session, sub)


def test_file_import_rejects_invalid_ics_without_creating_a_source(session):
    with pytest.raises(ValueError, match="calendar"):
        sync.import_file(session, b"not a calendar", name="broken.ics")
    assert session.exec(select(CalendarSubscription)).all() == []


# ---- PostgreSQL: constraint and cross-process lock --------------------------


@pytest.mark.skipif(not __import__("os").environ.get("TEST_DATABASE_URL"), reason="needs TEST_DATABASE_URL (throwaway Postgres)")
def test_postgres_sync_and_cross_process_lock(feed):
    import os
    import zlib

    import sqlalchemy as sa
    from sqlmodel import Session as SqlSession

    from app import migrate as migrations

    pg = sa.create_engine(os.environ["TEST_DATABASE_URL"])
    with pg.begin() as conn:
        conn.execute(sa.text("DROP SCHEMA public CASCADE"))
        conn.execute(sa.text("CREATE SCHEMA public"))
    migrations.migrate(pg)
    try:
        with SqlSession(pg) as s:
            sub = subscribe(s, feed.url)
            assert sync.sync_subscription(s, sub).created == 2
            feed.body = calendar(A, B, C)
            assert sync.sync_subscription(s, sub).created == 1
            assert len(all_imported(s, sub)) == 3

            # Another process (the MCP server) holding this subscription's lock.
            key = zlib.crc32(f"look-calendar-sync:{sub.id}".encode())
            with pg.connect() as other:
                assert other.execute(sa.text("SELECT pg_try_advisory_lock(:k)"), {"k": key}).scalar()
                busy = sync.sync_subscription(s, sub)
                assert busy.status == "skipped" and "already running" in busy.error
                other.execute(sa.text("SELECT pg_advisory_unlock(:k)"), {"k": key})
            assert sync.sync_subscription(s, sub).status in ("ok", "not_modified")

            # The unique constraint backs the reconcile up.
            dup = Event(subscription_id=sub.id, external_uid="assignment-a@canvas", title="dup",
                        start_at=datetime(2026, 10, 1), end_at=datetime(2026, 10, 2))
            s.add(dup)
            with pytest.raises(sa.exc.IntegrityError):
                s.commit()
    finally:
        pg.dispose()
