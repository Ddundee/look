"""Views: system defaults, custom views, layout validation and safety."""

import pytest
from sqlmodel import select

import mcp_server.server as mcp_server
from app.models import Task, View
from app.schemas import TaskCreate, ViewCreate, ViewUpdate
from app.services import tasks as tasks_svc
from app.services import views as views_svc


def w(type_, size=None, height=None, id_=None, **config):
    spec = views_svc.WIDGETS[type_]
    return {"id": id_ or type_.replace("_", "-"), "type": type_, "size": size or spec.default_size,
            "height": height or spec.default_height, "visible": True, "config": config}


def test_system_views_come_from_app_defaults_without_rows(session):
    views = views_svc.list_views(session)
    assert [v.key for v in views] == ["dashboard", "today"]
    assert all(v.kind == "system" and not v.customized for v in views)
    assert [x.type for x in views[1].widgets] == ["things_to_do", "schedule", "leetcode_summary"]
    assert session.exec(select(View)).all() == []  # nothing stored until customized


def test_layout_persists_and_reset_restores_current_default(session):
    custom = [w("schedule", "half", "full"), w("things_to_do", "half", "full", show_done=False)]
    saved = views_svc.save_layout(session, "today", custom)
    assert saved.customized and [x.type for x in saved.widgets] == ["schedule", "things_to_do"]
    assert saved.widgets[1].config == {"show_done": False, "undated_limit": 6}  # defaults filled in
    assert views_svc.get_view(session, "today").widgets[0].size == "half"

    # The default comes from code at read time, so an improved default
    # reaches everyone who hasn't customized.
    reset = views_svc.reset_view(session, "today")
    assert not reset.customized
    assert [x.model_dump() for x in reset.widgets] == views_svc.validate_layout(views_svc.SYSTEM_VIEWS["today"].layout)


def test_invalid_layouts_are_rejected(session):
    bad = [
        ([w("things_to_do") | {"type": "iframe"}], "unknown widget type"),
        ([w("quick_add", "quarter")], "can't be quarter width"),
        ([w("quick_add", height="tall")], "can't be tall"),
        ([w("things_to_do"), w("things_to_do", id_="other")], "only be added once"),
        ([w("schedule"), w("things_to_do", id_="schedule")], "used twice"),
        ([w("upcoming_assignments", days=30)], "days"),
        ([w("schedule", script="alert(1)")], "script"),
        ([w("schedule") | {"component": "Evil"}], "Extra inputs"),
        ([w("schedule") | {"id": "Bad Id!"}], "Widget 1"),
        ([w("leetcode_summary", id_=f"x{i}") for i in range(30)], "at most 24"),
    ]
    for layout, message in bad:
        with pytest.raises(ValueError, match=message):
            views_svc.save_layout(session, "dashboard", layout)
    assert session.exec(select(View)).all() == []  # nothing half-saved


def test_custom_view_lifecycle(session):
    school = views_svc.create_view(session, ViewCreate(name="School", icon="graduation-cap", preset="school"))
    assert (school.key, school.kind, school.show_in_nav) == ("school", "custom", True)
    assert [x.type for x in school.widgets] == ["upcoming_assignments", "things_to_do", "schedule"]
    assert school.widgets[0].config["days"] == 14
    again = views_svc.create_view(session, ViewCreate(name="School"))
    assert again.key == "school-2" and again.widgets == []  # blank preset
    reserved = views_svc.create_view(session, ViewCreate(name="Today"))
    assert reserved.key == "today-2"

    renamed = views_svc.update_view(session, "school", ViewUpdate(name="Classes", show_in_nav=False))
    assert (renamed.key, renamed.name, renamed.show_in_nav) == ("school", "Classes", False)  # key = stable URL
    with pytest.raises(ValueError, match="icon"):
        views_svc.update_view(session, "school", ViewUpdate(icon="skull"))

    order = [v.key for v in views_svc.reorder_views(session, ["today-2", "school"]) if v.kind == "custom"]
    assert order == ["today-2", "school", "school-2"]
    with pytest.raises(ValueError, match="Not custom views"):
        views_svc.reorder_views(session, ["dashboard"])

    views_svc.update_view(session, "school-2", ViewUpdate(archived=True))
    assert "school-2" not in [v.key for v in views_svc.list_views(session)]
    assert "school-2" in [v.key for v in views_svc.list_views(session, include_archived=True)]
    views_svc.delete_view(session, "school-2")
    assert views_svc.get_view(session, "school-2") is None


def test_system_views_are_protected(session):
    with pytest.raises(ValueError, match="can't be deleted"):
        views_svc.delete_view(session, "dashboard")
    with pytest.raises(ValueError, match="built in"):
        views_svc.update_view(session, "today", ViewUpdate(name="Mine"))
    views_svc.create_view(session, ViewCreate(name="Weekend"))
    with pytest.raises(ValueError, match="Only built-in"):
        views_svc.reset_view(session, "weekend")


def test_removing_widgets_or_views_never_touches_data(session):
    tasks_svc.create_task(session, TaskCreate(title="Keep me", status="todo"))
    views_svc.create_view(session, ViewCreate(name="Daily", preset="planning"))
    views_svc.save_layout(session, "daily", [])
    views_svc.save_layout(session, "dashboard", [])
    views_svc.delete_view(session, "daily")
    assert [t.title for t in session.exec(select(Task)).all()] == ["Keep me"]


def test_rest_and_mcp(client, auth_headers):
    types = {t["type"] for t in client.get("/api/views/widgets", headers=auth_headers).json()}
    assert types == set(views_svc.WIDGETS)
    created = client.post("/api/views", headers=auth_headers, json={"name": "Recruiting", "icon": "briefcase"})
    assert created.status_code == 201
    key = created.json()["key"]
    put = client.put(f"/api/views/{key}/layout", headers=auth_headers, json={"widgets": [w("things_to_do")]})
    assert put.status_code == 200 and put.json()["widgets"][0]["type"] == "things_to_do"
    assert client.put(f"/api/views/{key}/layout", headers=auth_headers,
                      json={"widgets": [w("things_to_do", "huge")]}).status_code == 422
    assert client.delete("/api/views/today", headers=auth_headers).status_code == 422
    assert client.get("/api/views/nope", headers=auth_headers).status_code == 404
    listed = mcp_server.list_views()
    assert [v["key"] for v in listed["views"]] == ["dashboard", "today", key]
    assert mcp_server.get_view(key)["widgets"][0]["type"] == "things_to_do"
    assert "error" in mcp_server.get_view("nope")
    assert client.delete(f"/api/views/{key}", headers=auth_headers).json() == {"deleted": key}


def test_frontend_registry_matches(session):
    import pathlib
    import re

    src = (pathlib.Path(__file__).resolve().parents[2] / "frontend/src/lib/views/widgets.ts").read_text()
    union = src[src.index("export type WidgetType ="):src.index(";", src.index("export type WidgetType ="))]
    assert set(re.findall(r'"([a-z_]+)"', union)) == set(views_svc.WIDGETS)
