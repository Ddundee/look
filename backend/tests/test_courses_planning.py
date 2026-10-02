"""Courses, categories and the combined to-do list."""

from datetime import date, datetime, timedelta

import pytest
from sqlmodel import select

import mcp_server.server as mcp_server
from app.models import Category, Task
from app.schemas import (
    CalendarSubscriptionCreate,
    CategoryCreate,
    CategoryUpdate,
    CourseCreate,
    CourseUpdate,
    EventCreate,
    TaskCreate,
)
from app.services import calendar_sync as sync
from app.services import categories as categories_svc
from app.services import courses as courses_svc
from app.services import events as events_svc
from app.services import planning
from app.services import tasks as tasks_svc
from tests.test_calendar_sync import calendar, live

HOST = "https://canvas.vt.edu/calendar"


def canvas_item(aid, title, due, course_ctx="course_123", code="CS-3214", kind="assignment"):
    """A Canvas feed item as Canvas writes it (see test_ics_deadlines)."""
    ctx = f"include_contexts={course_ctx}&month=10&year=2026"
    suffix = f" [{code}]" if code else ""
    return "\r\n".join([
        "BEGIN:VEVENT", f"DTSTART;VALUE=DATE:{due}", f"SUMMARY:{title}{suffix}",
        f"UID:event-{kind}-{aid}", f"URL:{HOST}?{ctx}#{kind.replace('-', '_')}_{aid}", "END:VEVENT",
    ])


def subscribe_static(session, body_ref, name="Canvas"):
    sub = sync.create_subscription(session, CalendarSubscriptionCreate(name=name, url="https://canvas.example.test/f.ics"))
    fetch = lambda url, etag=None, last_modified=None: sync.FetchResult(200, body_ref["v"], None, None)  # noqa: E731
    return sub, fetch


# ---- categories ------------------------------------------------------------


def test_category_crud(session):
    created = categories_svc.create_category(session, CategoryCreate(name="VT Hacks", color="violet", style="striped"))
    assert (created.key, created.color, created.style, created.is_system) == ("VT Hacks", "violet", "striped", False)
    with pytest.raises(ValueError, match="already exists"):
        categories_svc.create_category(session, CategoryCreate(name="vt hacks"))

    renamed = categories_svc.update_category(session, created, CategoryUpdate(name="VT Hacks 2026", style="glass"))
    assert renamed.key == "VT Hacks" and renamed.name == "VT Hacks 2026"  # key stable: items keep pointing at it

    task = tasks_svc.create_task(session, TaskCreate(title="Judge sign-up", category="VT Hacks"))
    with pytest.raises(ValueError, match="used by 1"):
        categories_svc.delete_category(session, created)
    categories_svc.update_category(session, created, CategoryUpdate(archived=True))
    assert "VT Hacks" not in [c.key for c in categories_svc.list_categories(session)]
    session.refresh(task)
    assert task.category == "VT Hacks"

    spare = categories_svc.create_category(session, CategoryCreate(name="Spare"))
    categories_svc.delete_category(session, spare)
    with pytest.raises(ValueError, match="built in"):
        categories_svc.delete_category(session, categories_svc.get_by_key(session, "personal"))


def test_new_category_names_get_a_category_automatically(session):
    tasks_svc.create_task(session, TaskCreate(title="Interview prep", category="Recruiting"))
    events_svc.create_event(session, EventCreate(title="Mixer", category="SOU", start_at="2026-10-09T19:00", end_at="2026-10-09T21:00"))
    keys = {c.key: c for c in session.exec(select(Category)).all()}
    assert {"Recruiting", "SOU"} <= keys.keys()
    assert keys["Recruiting"].color in courses_svc.COLORS


def test_category_values_are_validated_over_rest(client, auth_headers):
    bad = client.post("/api/categories", headers=auth_headers, json={"name": "Research", "color": "#ff0000"})
    assert bad.status_code == 422  # palette keys only, never CSS
    bad = client.post("/api/categories", headers=auth_headers, json={"name": "Research", "style": "background:red"})
    assert bad.status_code == 422
    ok = client.post("/api/categories", headers=auth_headers, json={"name": "Research", "color": "teal", "style": "outline"})
    assert ok.status_code == 201 and ok.json()["key"] == "Research"
    listed = client.get("/api/categories", headers=auth_headers).json()
    assert {"school", "class", "Research"} <= {c["key"] for c in listed}


# ---- courses ---------------------------------------------------------------


def test_course_crud(session):
    cs = courses_svc.create_course(session, CourseCreate(code="cs-3214", name="Computer Systems", aliases=["CS3214", "CSE 3214"]))
    assert (cs.code, cs.code_key, cs.aliases) == ("CS 3214", "CS3214", ["CSE3214"])  # alias equal to the code is dropped
    other = courses_svc.create_course(session, CourseCreate(code="CS 3304"))
    assert other.color != cs.color  # distinct colors by default
    with pytest.raises(ValueError, match="already belongs"):
        courses_svc.create_course(session, CourseCreate(code="CS 3214"))
    with pytest.raises(ValueError, match="already belongs"):
        courses_svc.update_course(session, other, CourseUpdate(aliases=["cse-3214"]))
    updated = courses_svc.update_course(session, cs, CourseUpdate(color="teal", style="striped", archived=True))
    assert (updated.color, updated.style, updated.archived) == ("teal", "striped", True)
    assert [c.code for c in courses_svc.list_courses(session)] == ["CS 3304"]


# ---- Canvas matching ---------------------------------------------------------


def test_canvas_assignment_maps_from_course_context_and_code(session):
    body = {"v": calendar(canvas_item(501, "Project 2", "20261008"))}
    sub, fetch = subscribe_static(session, body)
    sync.sync_subscription(session, sub, fetch=fetch)
    project = live(session, sub)["event-assignment-501"]
    course = courses_svc.get_course(session, project.course_id)
    assert (course.code, project.course_source, project.external_context) == ("CS 3214", "auto", "canvas.vt.edu/course_123")
    assert [lk.external_id for lk in courses_svc.links_for(session, course)] == ["canvas.vt.edu/course_123"]

    # Same Canvas course, code spelled differently: the remembered context wins.
    body["v"] = calendar(canvas_item(501, "Project 2", "20261008"), canvas_item(502, "Homework 6", "20261015", code="CS3214-F26"))
    sync.sync_subscription(session, sub, fetch=fetch)
    assert live(session, sub)["event-assignment-502"].course_id == course.id
    assert len(courses_svc.list_courses(session)) == 1


def test_ambiguous_items_stay_unmapped(session):
    body = {"v": calendar(
        # Not Canvas (no course context): a bracket alone never creates a course.
        "BEGIN:VEVENT\r\nUID:x1@school\r\nDTSTART;VALUE=DATE:20261009\r\nSUMMARY:Club fair [ENGE-1215]\r\nEND:VEVENT",
        # Canvas, but a personal (user) context and no code.
        canvas_item(600, "Reminder", "20261010", course_ctx="user_9", code=None),
    )}
    sub, fetch = subscribe_static(session, body, name="Campus")
    sync.sync_subscription(session, sub, fetch=fetch)
    assert all(e.course_id is None for e in live(session, sub).values())
    assert courses_svc.list_courses(session) == []


def test_manual_mapping_persists_and_teaches_the_context(session):
    body = {"v": calendar(canvas_item(701, "Lab 1", "20261008", course_ctx="course_77", code="2026FA-13123"))}
    sub, fetch = subscribe_static(session, body)
    sync.sync_subscription(session, sub, fetch=fetch)
    lab = live(session, sub)["event-assignment-701"]
    assert lab.course_id is None  # "2026FA-13123" isn't a recognizable course code: left unmapped
    assert courses_svc.list_courses(session) == []

    real = courses_svc.create_course(session, CourseCreate(code="ECE 2524"))
    courses_svc.set_event_course(session, lab, real)
    assert (lab.course_id, lab.course_source) == (real.id, "manual")

    # A later assignment from the same Canvas course maps to the corrected course.
    body["v"] = calendar(canvas_item(701, "Lab 1", "20261008", course_ctx="course_77", code="2026FA-13123"),
                         canvas_item(702, "Lab 2", "20261015", course_ctx="course_77", code="2026FA-13123"))
    sync.sync_subscription(session, sub, fetch=fetch)
    items = live(session, sub)
    assert items["event-assignment-702"].course_id == real.id
    assert items["event-assignment-701"].course_source == "manual"

    # "No course" by hand also sticks across syncs.
    courses_svc.set_event_course(session, items["event-assignment-702"], None)
    sync.sync_subscription(session, sub, fetch=fetch)
    session.refresh(items["event-assignment-702"])
    assert items["event-assignment-702"].course_id is None


def test_resync_keeps_mapping_and_completion(session):
    body = {"v": calendar(canvas_item(801, "Homework 4", "20261008"))}
    sub, fetch = subscribe_static(session, body)
    sync.sync_subscription(session, sub, fetch=fetch)
    hw = live(session, sub)["event-assignment-801"]
    course_id = hw.course_id
    events_svc.set_completed(session, hw, True)

    body["v"] = calendar(canvas_item(801, "Homework 4", "20261012"))  # moved
    assert sync.sync_subscription(session, sub, fetch=fetch).updated == 1
    session.refresh(hw)
    assert hw.course_id == course_id and hw.completed_at is not None and hw.start_at == datetime(2026, 10, 12, 23, 59)


# ---- class meetings ----------------------------------------------------------


def test_class_meetings_link_to_the_same_course(session):
    lecture = events_svc.create_event(session, EventCreate(
        title="CS 3214 Lecture", category="class", start_at="2026-10-05T09:05", end_at="2026-10-05T09:55",
        rrule="FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261211",
    ))
    gym = events_svc.create_event(session, EventCreate(title="Gym", start_at="2026-10-05T07:00", end_at="2026-10-05T08:00"))
    assert lecture.course_id is None  # no such course yet

    cs = courses_svc.create_course(session, CourseCreate(code="CS 3214"))
    session.refresh(lecture)
    session.refresh(gym)
    assert lecture.course_id == cs.id and lecture.course_source == "auto"  # existing meetings picked up
    assert gym.course_id is None  # personal events untouched

    later = events_svc.create_event(session, EventCreate(title="cs3214 recitation", start_at="2026-10-06T16:00", end_at="2026-10-06T17:00"))
    assert later.course_id == cs.id
    [occ] = [o for o in events_svc.occurrences(session, date(2026, 10, 5), date(2026, 10, 5)) if o.title.startswith("CS 3214")]
    assert occ.course.code == "CS 3214" and occ.course.color == cs.color

    # Unlinking by hand sticks even though the title still matches.
    courses_svc.set_event_course(session, lecture, None)
    courses_svc.update_course(session, cs, CourseUpdate(name="Computer Systems"))
    session.refresh(lecture)
    assert lecture.course_id is None


# ---- the combined to-do list ---------------------------------------------------


def test_work_plan_combines_tasks_and_assignments(session, monkeypatch):
    day = date(2026, 10, 8)
    monkeypatch.setattr(planning, "local_today", lambda: day)
    body = {"v": calendar(
        canvas_item(901, "Project 2", "20261008"),
        canvas_item(902, "Worksheet", "20261008", code="CS-2104", course_ctx="course_44"),
        canvas_item(903, "Reading", "20261005"),  # overdue, not done
        canvas_item(904, "Quiz prep", "20261004"),  # overdue but done: not listed
    )}
    sub, fetch = subscribe_static(session, body)
    sync.sync_subscription(session, sub, fetch=fetch)
    items = live(session, sub)
    events_svc.set_completed(session, items["event-assignment-902"], True)
    events_svc.set_completed(session, items["event-assignment-904"], True)

    fix = tasks_svc.create_task(session, TaskCreate(title="Fix shell parser", status="todo", due_date=day, priority="high"))
    tasks_svc.create_task(session, TaskCreate(title="Old bug", status="todo", due_date=day - timedelta(days=2)))
    for i, p in enumerate(["low", "critical", "medium", "high", "low", "medium", "low", "high"]):
        tasks_svc.create_task(session, TaskCreate(title=f"Backlog {i}", status="todo", priority=p))

    plan = planning.work_plan(session, day)
    assert [(i.kind, i.title) for i in plan.today] == [
        ("assignment", "Project 2 [CS-3214]"),  # open first, timed (11:59 PM)
        ("task", "Fix shell parser"),
        ("assignment", "Worksheet [CS-2104]"),  # done, still visible
    ]
    assert plan.today[0].course.code == "CS 3214" and plan.today[2].done
    assert [i.title for i in plan.overdue] == ["Reading [CS-3214]", "Old bug"]
    # Undated tasks: listed, never overdue, most important first, capped.
    assert plan.undated_total == 8 and len(plan.undated) == planning.UNDATED_LIMIT
    assert [i.priority.value for i in plan.undated][:3] == ["critical", "high", "high"]
    assert all(i.title.startswith("Backlog") for i in plan.undated)
    assert not any(i.task.is_overdue for i in plan.undated)
    assert plan.remaining == 4  # Project 2, Fix shell parser, Reading, Old bug
    assert session.exec(select(Task)).all()  # nothing copied: only the 10 tasks made here
    assert len(session.exec(select(Task)).all()) == 10 and fix.id in {i.id for i in plan.today}


def test_mcp_course_tools_share_the_service(use_test_db):
    created = mcp_server.create_course(code="CS 3304", name="Comparative Languages", color="indigo", style="striped")
    assert created["code"] == "CS 3304" and created["style"] == "striped"
    assert "error" in mcp_server.create_course(code="CS 3304")
    assert "error" in mcp_server.create_category(name="X", color="chartreuse")
    cat = mcp_server.create_category(name="Research", color="teal", style="glass")
    assert cat["key"] == "Research"
    assert mcp_server.update_category("Research", style="outline")["style"] == "outline"
    ev = mcp_server.create_event(title="CS 3304 lecture", start_at="2026-10-05T10:10", end_at="2026-10-05T11:00")
    assert ev["event"]["course_id"] == created["id"]
    unmapped = mcp_server.map_event_to_course(ev["event"]["id"], None)
    assert unmapped["course_id"] is None and unmapped["course_source"] == "manual"
    assert mcp_server.list_courses()["courses"][0]["event_count"] == 0
    plan = mcp_server.get_work_plan("2026-10-05")
    assert {"overdue", "today", "undated", "undated_total", "remaining"} <= plan.keys()


def test_rest_course_endpoints(client, auth_headers):
    r = client.post("/api/courses", headers=auth_headers, json={"code": "COMM 2014", "color": "pink"})
    assert r.status_code == 201
    cid = r.json()["id"]
    ev = client.post("/api/events", headers=auth_headers, json={"title": "Speech practice", "start_at": "2026-10-07T15:00", "end_at": "2026-10-07T16:00"}).json()["event"]
    assert ev["course_id"] is None
    mapped = client.put(f"/api/events/{ev['id']}/course", headers=auth_headers, json={"course_id": cid}).json()
    assert mapped["course_id"] == cid and mapped["course_source"] == "manual"
    occ = client.get("/api/events/schedule?start_date=2026-10-07", headers=auth_headers).json()["occurrences"][0]
    assert occ["course"]["code"] == "COMM 2014" and occ["course"]["color"] == "pink"
    assert client.patch(f"/api/courses/{cid}", headers=auth_headers, json={"style": "neon"}).status_code == 422
    work = client.get("/api/today/work?date=2026-10-07", headers=auth_headers)
    assert work.status_code == 200
