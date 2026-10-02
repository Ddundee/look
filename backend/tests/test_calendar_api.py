"""Calendar subscriptions over REST and MCP: both go through
app.services.calendar_sync, so they see the same subscriptions and events."""

import asyncio

import pytest

import mcp_server.server as mcp_server
from tests.test_calendar_sync import A, B, C, Feed, calendar

SCHEDULE = "/api/events/schedule?start_date=2026-10-01&end_date=2026-11-30"


@pytest.fixture()
def feed():
    f = Feed()
    yield f
    f.close()


def titles(client, auth_headers, include_cancelled=False):
    url = SCHEDULE + ("&include_cancelled=true" if include_cancelled else "")
    return sorted(o["title"] for o in client.get(url, headers=auth_headers).json()["occurrences"])


def test_rest_subscription_lifecycle(client, auth_headers, feed):
    resp = client.post("/api/calendar-subscriptions", headers=auth_headers,
                       json={"name": "Canvas", "url": feed.url})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert (body["status"], body["created"]) == ("ok", 2)
    sub = body["subscription"]
    assert sub["source_type"] == "url" and sub["sync_interval_minutes"] == 30 and sub["event_count"] == 2
    assert sub["last_success_at"].endswith("Z") or sub["last_success_at"].endswith("+00:00")
    sid = sub["id"]

    dup = client.post("/api/calendar-subscriptions", headers=auth_headers, json={"name": "Again", "url": feed.url})
    assert dup.status_code == 409 and "Canvas" in dup.json()["detail"]

    occs = client.get(SCHEDULE, headers=auth_headers).json()["occurrences"]
    a = next(o for o in occs if o["title"] == "Assignment A")
    assert a["read_only"] and a["subscription_name"] == "Canvas" and a["external_url"] == "https://canvas.example.edu/a"
    assert client.patch(f"/api/events/{a['event_id']}", headers=auth_headers, json={"title": "x"}).status_code == 422
    assert client.delete(f"/api/events/{a['event_id']}", headers=auth_headers).status_code == 422

    feed.body = calendar(A, B, C)
    synced = client.post(f"/api/calendar-subscriptions/{sid}/sync", headers=auth_headers).json()
    assert (synced["created"], synced["unchanged"]) == (1, 2)
    assert titles(client, auth_headers) == ["Assignment A", "Assignment B", "Assignment C (published later)"]

    patched = client.patch(f"/api/calendar-subscriptions/{sid}", headers=auth_headers,
                           json={"name": "Virginia Tech Canvas", "enabled": False, "sync_interval_minutes": 60}).json()
    assert (patched["name"], patched["enabled"], patched["sync_interval_minutes"]) == ("Virginia Tech Canvas", False, 60)
    skipped = client.post(f"/api/calendar-subscriptions/{sid}/sync", headers=auth_headers).json()
    assert skipped["status"] == "skipped"

    listed = client.get("/api/calendar-subscriptions", headers=auth_headers).json()
    assert listed["count"] == 1 and listed["subscriptions"][0]["event_count"] == 3

    deleted = client.delete(f"/api/calendar-subscriptions/{sid}?keep_events=false", headers=auth_headers).json()
    assert deleted == {"events_kept": 0, "events_deleted": 3}
    assert titles(client, auth_headers) == []


def test_rest_rejects_bad_urls_and_requires_auth(client, auth_headers):
    assert client.get("/api/calendar-subscriptions").status_code == 401
    bad = client.post("/api/calendar-subscriptions", headers=auth_headers, json={"name": "x", "url": "not a url"})
    assert bad.status_code == 422


def test_first_sync_failure_still_keeps_subscription(client, auth_headers):
    resp = client.post("/api/calendar-subscriptions", headers=auth_headers,
                       json={"name": "Down", "url": "http://127.0.0.1:1/cal.ics"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "error" and body["subscription"]["last_error"]
    assert client.get("/api/calendar-subscriptions", headers=auth_headers).json()["count"] == 1


def test_upload_ics_file(client, auth_headers):
    files = {"file": ("spring.ics", calendar(A, B), "text/calendar")}
    first = client.post("/api/calendar-import", headers=auth_headers, files=files).json()
    assert (first["status"], first["created"]) == ("ok", 2)
    assert first["subscription"]["source_type"] == "file" and first["subscription"]["name"] == "spring"
    assert first["subscription"]["next_sync_at"] is None

    again = client.post("/api/calendar-import", headers=auth_headers,
                        files={"file": ("spring.ics", calendar(A, B), "text/calendar")}).json()
    assert (again["created"], again["unchanged"]) == (0, 2)
    assert titles(client, auth_headers) == ["Assignment A", "Assignment B"]

    bad = client.post("/api/calendar-import", headers=auth_headers,
                      files={"file": ("notes.ics", b"hello", "text/calendar")})
    assert bad.status_code == 422 and "iCalendar" in bad.json()["detail"]
    sid = first["subscription"]["id"]
    nope = client.post(f"/api/calendar-subscriptions/{sid}/sync", headers=auth_headers)
    assert nope.status_code == 422 and "re-upload" in nope.json()["detail"]


def test_mcp_adds_persistent_subscription_seen_by_rest(client, auth_headers, feed):
    added = mcp_server.add_calendar_subscription(name="Canvas", url=feed.url)
    assert added["error"] is None and added["created"] == 2
    sid = added["subscription"]["id"]

    rest = client.get("/api/calendar-subscriptions", headers=auth_headers).json()["subscriptions"]
    assert [s["id"] for s in rest] == [sid] and rest[0]["source_url"] == feed.url
    assert mcp_server.list_calendar_subscriptions()["subscriptions"][0]["id"] == sid

    feed.body = calendar(A, B, C)
    synced = mcp_server.sync_calendar_subscription(sid)
    assert synced["created"] == 1
    # Events from the MCP-triggered sync are in the calendar APIs (REST and MCP).
    assert "Assignment C (published later)" in titles(client, auth_headers)
    schedule = mcp_server.get_schedule("2026-11-01", "2026-11-30")
    assert [o["subscription_name"] for o in schedule["occurrences"]] == ["Canvas"]

    dup = mcp_server.add_calendar_subscription(name="Canvas 2", url=feed.url)
    assert "already subscribed" in dup["error"] and dup["subscription"]["id"] == sid

    paused = mcp_server.update_calendar_subscription(sid, enabled=False)
    assert paused["enabled"] is False
    event_id = schedule["occurrences"][0]["event_id"]
    assert "read-only" in mcp_server.update_event(event_id, title="mine")["error"]
    assert "read-only" in mcp_server.delete_event(event_id)["error"]

    removed = mcp_server.remove_calendar_subscription(sid, keep_events=True)
    assert removed == {"removed": "Canvas", "events_kept": 3, "events_deleted": 0}
    assert "error" not in mcp_server.update_event(event_id, title="mine now")
    assert mcp_server.sync_calendar_subscription(sid)["error"].startswith("No calendar subscription")


def test_mcp_import_ics(use_test_db):
    ok = mcp_server.import_ics(calendar(A).decode(), "pasted")
    assert ok["created"] == 1 and ok["subscription"]["source_type"] == "file"
    assert "iCalendar" in mcp_server.import_ics("nope", "pasted")["error"]


def test_scheduler_loop_syncs_on_startup_then_on_interval(monkeypatch):
    from app import main

    calls = []
    sleeps = []

    def fake_run(engine, startup=False):
        calls.append(startup)
        return {}

    async def fake_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) > 3:
            raise asyncio.CancelledError

    monkeypatch.setattr(main.calendar_sync, "run_due_syncs", fake_run)
    monkeypatch.setattr(main.asyncio, "sleep", fake_sleep)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(main._calendar_sync_loop())
    assert calls == [True, False, False]  # first pass syncs everything, then only what's due
    assert sleeps == [15, 60, 60, 60]
