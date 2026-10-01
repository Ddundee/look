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
