from datetime import timedelta

from app.migrate import head_revision
from app.utils import local_today


def test_health_check_requires_no_auth(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["db_revision"] == head_revision()
    assert "version" in body


def test_tasks_endpoint_requires_auth(client):
    resp = client.get("/api/tasks")
    assert resp.status_code == 401


def test_create_and_fetch_task(client, auth_headers):
    resp = client.post("/api/tasks", json={"title": "Buy groceries"}, headers=auth_headers)
    assert resp.status_code == 201
    task = resp.json()
    assert task["status"] == "inbox"

    resp = client.get(f"/api/tasks/{task['id']}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["title"] == "Buy groceries"


def test_patch_task_updates_fields(client, auth_headers):
    created = client.post("/api/tasks", json={"title": "Old"}, headers=auth_headers).json()
    resp = client.patch(
        f"/api/tasks/{created['id']}", json={"title": "New", "priority": "critical"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["title"] == "New"
    assert resp.json()["priority"] == "critical"


def test_complete_task_endpoint(client, auth_headers):
    created = client.post("/api/tasks", json={"title": "Finish me"}, headers=auth_headers).json()
    resp = client.post(f"/api/tasks/{created['id']}/complete", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "completed"


def test_get_today_endpoint_shape(client, auth_headers):
    resp = client.get("/api/today", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    for key in ["scheduled", "due_today", "overdue", "recurring_today", "suggested_high_priority"]:
        assert key in body


def test_overdue_endpoint(client, auth_headers):
    due = (local_today() - timedelta(days=1)).isoformat()
    client.post("/api/tasks", json={"title": "Late task", "due_date": due}, headers=auth_headers)
    resp = client.get("/api/overdue", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["count"] == 1


def test_login_sets_session_cookie_and_grants_access(client):
    resp = client.post(
        "/api/auth/login", json={"username": "admin", "password": "admin-password"}
    )
    assert resp.status_code == 200
    assert "todo_session" in resp.cookies

    resp = client.get("/api/tasks")  # cookie sent automatically by TestClient
    assert resp.status_code == 200


def test_login_with_wrong_password_fails(client):
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert resp.status_code == 401


def test_ranked_endpoint_orders_by_score(client, auth_headers):
    client.post(
        "/api/tasks", json={"title": "low", "priority": "low"}, headers=auth_headers
    )
    overdue = (local_today() - timedelta(days=2)).isoformat()
    client.post(
        "/api/tasks",
        json={"title": "urgent", "priority": "critical", "due_date": overdue},
        headers=auth_headers,
    )
    resp = client.get("/api/tasks/ranked", headers=auth_headers)
    titles = [t["title"] for t in resp.json()["tasks"]]
    assert titles[0] == "urgent"
