"""Blocks: the library (smart lists, notes), placing them on views, and
smart-list filtering."""

from datetime import date, datetime, timedelta

import pytest
from sqlmodel import select

import mcp_server.server as mcp_server
from app.models import Task, View
from app.schemas import BlockCreate, BlockUpdate, CourseCreate, EventCreate, TaskCreate
from app.services import blocks as blocks_svc
from app.services import courses as courses_svc
from app.services import events as events_svc
from app.services import tasks as tasks_svc
from app.services import views as views_svc
from app.utils import local_today
from tests.test_views import w


def block_widget(block_id, id_="b1", size="third", height="medium"):
    return w("block", size, height, id_=id_, block_id=block_id)


def note(session, name="Pinned", text="hello"):
    return blocks_svc.create_block(session, BlockCreate(name=name, kind="note", config={"text": text}))


def smart(session, name="List", **config):
    return blocks_svc.create_block(session, BlockCreate(name=name, kind="smart_list", config=config))


def event(session, title, day, *, deadline=False, course=None, category="other", all_day=False):
    start = datetime.combine(day, datetime.min.time()) + timedelta(hours=23, minutes=59 if deadline else 0)
    created = events_svc.create_event(session, EventCreate(
        title=title, start_at=start, end_at=start + timedelta(minutes=1 if deadline else 60), category=category,
        all_day=all_day,
    ))
    if deadline:
        created.is_deadline = True
        session.add(created)
        session.commit()
    if course is not None:
        courses_svc.set_event_course(session, created, course)
    return created


def titles(items):
    return [i.title for i in items.items]


# ---- library -----------------------------------------------------------------------


def test_create_defaults_and_validation(session):
    b = smart(session)
    assert (b.kind, b.icon, b.color) == ("smart_list", "list", "blue")
    assert b.config["show"] == ["tasks", "assignments"] and b.config["limit"] == 20  # defaults filled in
    assert b.used_in == []
    with pytest.raises(ValueError, match="limit"):
        smart(session, limit=500)
    with pytest.raises(ValueError, match="Extra inputs"):
        smart(session, html="<script>")
    with pytest.raises(ValueError, match="icon"):
        blocks_svc.create_block(session, BlockCreate(name="x", kind="note", icon="skull"))
    with pytest.raises(ValueError, match="color"):
        blocks_svc.create_block(session, BlockCreate(name="x", kind="note", color="#ff0000"))
    with pytest.raises(ValueError, match="10000"):
        note(session, text="x" * 10_001)


def test_placed_once_edited_everywhere(session):
    b = note(session, text="v1")
    views_svc.save_layout(session, "today", [w("things_to_do"), block_widget(b.id)])
    school = views_svc.create_view(session, views_svc.ViewCreate(name="School"))
    views_svc.save_layout(session, school.key, [block_widget(b.id, id_="pinned")])
    assert {p.key for p in blocks_svc.get_block(session, b.id).used_in} == {"today", school.key}

    blocks_svc.update_block(session, b.id, BlockUpdate(config={"text": "v2"}))
    # Views hold only the id, so both now show v2.
    assert blocks_svc.get_block(session, b.id).config == {"text": "v2"}
    assert views_svc.get_view(session, school.key).widgets[0].config == {"block_id": b.id}


def test_block_widget_rules(session):
    b = note(session)
    with pytest.raises(ValueError, match="choose which block"):
        views_svc.save_layout(session, "today", [w("block")])
    with pytest.raises(ValueError, match="once per view"):
        views_svc.save_layout(session, "today", [block_widget(b.id, "a"), block_widget(b.id, "b")])
    with pytest.raises(ValueError, match="no longer exists"):
        views_svc.save_layout(session, "today", [block_widget("missing")])
    other = note(session, name="Other")
    saved = views_svc.save_layout(session, "today", [block_widget(b.id, "a"), block_widget(other.id, "b")])
    assert len(saved.widgets) == 2  # many blocks per view


def test_delete_removes_placements_never_data(session):
    tasks_svc.create_task(session, TaskCreate(title="Keep me"))
    b = smart(session)
    views_svc.save_layout(session, "dashboard", [w("quick_add"), block_widget(b.id)])
    assert blocks_svc.delete_block(session, b.id)
    assert [x.type for x in views_svc.get_view(session, "dashboard").widgets] == ["quick_add"]
    assert [t.title for t in session.exec(select(Task)).all()] == ["Keep me"]
    assert not blocks_svc.delete_block(session, b.id)


# ---- smart lists ----------------------------------------------------------------------


def test_task_filters(session):
    today = local_today()
    mk = lambda **kw: tasks_svc.create_task(session, TaskCreate(**kw))  # noqa: E731
    mk(title="Resume", category="career", priority="high", tags=["jobs"], due_date=today)
    mk(title="Groceries", category="errands", priority="low")
    mk(title="Old essay", category="school", priority="medium", due_date=today - timedelta(days=3))
    mk(title="Cover letter", category="career", priority="critical", due_date=today + timedelta(days=5))
    done = mk(title="Done thing", category="career")
    tasks_svc.complete_task(session, done)

    ev = lambda **cfg: blocks_svc.evaluate(session, {"show": ["tasks"], **cfg}, today)  # noqa: E731
    assert titles(ev(categories=["career"], sort="priority")) == ["Cover letter", "Resume"]  # done hidden
    assert "Done thing" in titles(ev(categories=["career"], status="done"))
    assert titles(ev(due="overdue")) == ["Old essay"]
    assert titles(ev(due="today")) == ["Resume"]
    assert titles(ev(due="no_date", categories=["errands"])) == ["Groceries"]
    assert titles(ev(tags=["JOBS"])) == ["Resume"]  # case-insensitive
    assert titles(ev(search="letter")) == ["Cover letter"]
    assert set(titles(ev(priorities=["high", "critical"]))) == {"Resume", "Cover letter"}
    limited = ev(limit=2)
    assert len(limited.items) == 2 and limited.total >= 4


def test_assignments_events_and_courses(session):
    today = local_today()
    cs = courses_svc.create_course(session, CourseCreate(code="CS 3214", name="Systems"))
    event(session, "Project 2", today + timedelta(days=2), deadline=True, course=cs)
    event(session, "Essay", today + timedelta(days=3), deadline=True)
    event(session, "CS lecture", today + timedelta(days=1), course=cs)
    tasks_svc.create_task(session, TaskCreate(title="A task", due_date=today + timedelta(days=1)))

    ev = lambda **cfg: blocks_svc.evaluate(session, cfg, today)  # noqa: E731
    both = ev(show=["tasks", "assignments", "events"], due="next_7")
    # By due date; on a day, timed items first (as on Today).
    assert titles(both) == ["CS lecture", "A task", "Project 2", "Essay"]
    assert {i.kind for i in both.items} == {"task", "event", "assignment"}
    # Courses narrow to assignments and events (tasks have no course).
    assert titles(ev(show=["tasks", "assignments", "events"], courses=[cs.id])) == ["CS lecture", "Project 2"]
    # Priorities narrow to tasks.
    assert titles(ev(show=["tasks", "assignments"], priorities=["medium"], due="next_7")) == ["A task"]
    # Completed assignments only with status done.
    proj = next(e for e in events_svc.search_events(session, "Project 2"))
    events_svc.set_completed(session, proj, True)
    assert titles(ev(show=["assignments"], due="next_7")) == ["Essay"]
    assert titles(ev(show=["assignments"], due="next_7", status="done")) == ["Project 2"]


def test_rest_and_mcp(client, auth_headers):
    created = client.post("/api/blocks", headers=auth_headers,
                          json={"name": "Career", "kind": "smart_list", "icon": "briefcase", "color": "violet",
                                "config": {"categories": ["career"], "show": ["tasks"]}})
    assert created.status_code == 201
    bid = created.json()["id"]
    client.post("/api/tasks", headers=auth_headers, json={"title": "Apply", "category": "career"})
    items = client.get(f"/api/blocks/{bid}/items", headers=auth_headers).json()
    assert [i["title"] for i in items["items"]] == ["Apply"] and items["total"] == 1
    preview = client.post("/api/blocks/preview", headers=auth_headers, json={"show": ["tasks"], "search": "nope"})
    assert preview.json()["total"] == 0
    assert client.post("/api/blocks", headers=auth_headers,
                       json={"name": "x", "kind": "smart_list", "config": {"limit": 0}}).status_code == 422
    patched = client.patch(f"/api/blocks/{bid}", headers=auth_headers, json={"name": "Jobs"})
    assert patched.json()["name"] == "Jobs"

    n = client.post("/api/blocks", headers=auth_headers, json={"name": "Note", "kind": "note",
                                                                "config": {"text": "- [ ] call"}}).json()
    assert client.get(f"/api/blocks/{n['id']}/items", headers=auth_headers).status_code == 422

    assert [b["name"] for b in mcp_server.list_blocks()["blocks"]] == ["Jobs", "Note"]
    assert mcp_server.get_block_items(bid)["items"][0]["title"] == "Apply"
    assert mcp_server.get_block_items(n["id"])["text"] == "- [ ] call"
    assert "error" in mcp_server.get_block_items("nope")

    assert client.delete(f"/api/blocks/{bid}", headers=auth_headers).status_code == 204
    assert client.get(f"/api/blocks/{bid}", headers=auth_headers).status_code == 404
