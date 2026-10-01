import httpx
import pytest

from app.config import get_settings
from app.routers import system


@pytest.fixture()
def updater_mock(monkeypatch):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        assert request.headers["Authorization"] == "Bearer test-token"
        if request.method == "GET" and request.url.path == "/status":
            return httpx.Response(200, json={"update_available": True, "job": {"state": "idle"}})
        if request.method == "POST" and request.url.path == "/update":
            return httpx.Response(409, json={"error": "Already up to date."})
        return httpx.Response(404, json={"error": "Not found."})

    monkeypatch.setattr(get_settings(), "updater_url", "http://updater:8080")
    monkeypatch.setattr(system, "transport", httpx.MockTransport(handler))
    return calls


def test_system_requires_auth(client):
    assert client.get("/api/system/version").status_code == 401
    assert client.get("/api/system/update").status_code == 401


def test_version_reports_revision(client, auth_headers, monkeypatch):
    monkeypatch.setattr(get_settings(), "app_revision", "abc123")
    assert client.get("/api/system/version", headers=auth_headers).json() == {"revision": "abc123"}
    monkeypatch.setattr(get_settings(), "app_revision", "")
    assert client.get("/api/system/version", headers=auth_headers).json() == {"revision": None}


def test_update_disabled_without_url(client, auth_headers, monkeypatch):
    monkeypatch.setattr(get_settings(), "updater_url", "")
    assert client.get("/api/system/update", headers=auth_headers).json() == {"enabled": False}
    assert client.post("/api/system/update", headers=auth_headers).status_code == 503


def test_update_status_proxied(client, auth_headers, updater_mock):
    body = client.get("/api/system/update?refresh=true", headers=auth_headers).json()
    assert body == {"enabled": True, "update_available": True, "job": {"state": "idle"}}
    assert updater_mock[0].url.params["refresh"] == "1"


def test_update_start_passes_status_through(client, auth_headers, updater_mock):
    resp = client.post("/api/system/update", headers=auth_headers)
    assert resp.status_code == 409 and resp.json()["detail"] == "Already up to date."


def test_unreachable_updater_hides_feature(client, auth_headers, monkeypatch):
    def boom(request):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(get_settings(), "updater_url", "http://updater:8080")
    monkeypatch.setattr(system, "transport", httpx.MockTransport(boom))
    assert client.get("/api/system/update", headers=auth_headers).json() == {"enabled": False}
    assert client.post("/api/system/update", headers=auth_headers).status_code == 503
