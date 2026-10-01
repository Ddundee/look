import json
import subprocess
import threading
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

import updater as up

LATEST = "b" * 40
CURRENT = "a" * 40
RUNS_URL = "https://api.github.com/repos/Ddundee/look/actions/workflows/docker-publish.yml/runs?branch=main&status=success&per_page=1"


class FakeDocker:
    """Answers `docker compose ps -q <svc>` and `docker inspect` from a map
    of service -> revision label; records every other command."""

    def __init__(self, revisions, fail_on=None):
        self.revisions = revisions
        self.fail_on = fail_on
        self.calls = []

    def __call__(self, args):
        self.calls.append(args)
        if args[:4] == ["docker", "compose", "ps", "-q"]:
            svc = args[4]
            cid = f"cid-{svc}" if svc in self.revisions else ""
            return subprocess.CompletedProcess(args, 0, cid + "\n", "")
        if args[:2] == ["docker", "inspect"]:
            svc = args[-1].removeprefix("cid-")
            rev = self.revisions.get(svc)
            return subprocess.CompletedProcess(args, 0, (rev or "<no value>") + "\n", "")
        if self.fail_on and args[:3] == ["docker", "compose", self.fail_on]:
            return subprocess.CompletedProcess(args, 1, "", "line1\nError: pull access denied\n")
        return subprocess.CompletedProcess(args, 0, "ok", "")


class FakeGitHub:
    def __init__(self, sha=LATEST, error=None):
        self.sha = sha
        self.error = error
        self.urls = []

    def __call__(self, url):
        self.urls.append(url)
        if self.error:
            raise self.error
        if "/compare/" in url:
            return {"commits": [
                {"sha": "1" * 40, "commit": {"message": "Older change\n\nbody"}},
                {"sha": "2" * 40, "commit": {"message": "Newest change"}},
            ]}
        return {"workflow_runs": [{"head_sha": self.sha, "updated_at": "2026-10-02T10:00:00Z"}]}


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def make(revisions=None, github=None, clock=None, docker=None, spawn=None):
    docker = docker or FakeDocker(revisions if revisions is not None else {"backend": CURRENT, "frontend": CURRENT})
    return up.Updater(
        repo="Ddundee/look",
        workflow="docker-publish.yml",
        services=["backend", "mcp", "frontend"],
        run=docker,
        fetch=github or FakeGitHub(),
        clock=clock or Clock(),
        spawn=spawn or (lambda fn: fn()),
    ), docker


def test_status_outdated_lists_changes_newest_first():
    u, _ = make()
    s = u.status()
    assert s["current"] == {"backend": CURRENT, "frontend": CURRENT}
    assert s["latest"] == {"sha": LATEST, "published_at": "2026-10-02T10:00:00Z"}
    assert s["update_available"] is True
    assert s["changes"] == [
        {"sha": "2222222", "message": "Newest change"},
        {"sha": "1111111", "message": "Older change"},
    ]
    assert s["job"]["state"] == "idle" and s["check_error"] is None


def test_status_up_to_date():
    u, _ = make(revisions={"backend": LATEST, "frontend": LATEST})
    s = u.status()
    assert s["update_available"] is False and s["changes"] == []


def test_local_build_without_label_counts_as_outdated():
    u, _ = make(revisions={"backend": None, "frontend": None})
    s = u.status()
    assert s["current"] == {"backend": None, "frontend": None}
    assert s["update_available"] is True and s["changes"] == []


def test_github_error_sets_check_error_and_no_update():
    u, _ = make(github=FakeGitHub(error=OSError("network down")))
    s = u.status()
    assert s["latest"] is None and s["update_available"] is False
    assert "network down" in s["check_error"]


def test_github_cached_and_refresh_throttled():
    gh, clock = FakeGitHub(), Clock()
    u, _ = make(github=gh, clock=clock)
    u.status()
    u.status()
    runs_calls = lambda: sum(1 for x in gh.urls if "/runs?" in x)  # noqa: E731
    assert runs_calls() == 1
    u.status(refresh=True)
    assert runs_calls() == 2
    clock.t += 10
    u.status(refresh=True)  # throttled: within 30 s of the last forced refresh
    assert runs_calls() == 2
    clock.t += 600
    u.status()
    assert runs_calls() == 3
    assert gh.urls[0] == RUNS_URL


def test_update_runs_fixed_commands_and_finishes():
    u, docker = make()
    code, body = u.start_update()
    assert code == 202
    compose_cmds = [c for c in docker.calls if c[:2] == ["docker", "compose"] and c[2] in ("pull", "up")]
    assert compose_cmds == [
        ["docker", "compose", "pull", "backend", "mcp", "frontend"],
        ["docker", "compose", "up", "-d", "--no-deps", "--no-build", "backend", "mcp", "frontend"],
    ]
    job = u.status()["job"]
    assert job["state"] == "done" and job["target"] == LATEST and job["finished_at"]


def test_update_failure_reports_stderr_and_skips_restart():
    u, docker = make(docker=FakeDocker({"backend": CURRENT, "frontend": CURRENT}, fail_on="pull"))
    u.start_update()
    job = u.status()["job"]
    assert job["state"] == "failed" and "pull access denied" in job["error"]
    assert not any(c[:3] == ["docker", "compose", "up"] for c in docker.calls)


def test_no_update_available_is_409_unless_forced():
    u, _ = make(revisions={"backend": LATEST, "frontend": LATEST})
    code, body = u.start_update()
    assert code == 409 and "up to date" in body["error"]
    code, _ = u.start_update(force=True)
    assert code == 202


def test_concurrent_update_is_409():
    started = threading.Event()
    release = threading.Event()

    class SlowDocker(FakeDocker):
        def __call__(self, args):
            if args[:3] == ["docker", "compose", "pull"]:
                started.set()
                release.wait(5)
            return super().__call__(args)

    docker = SlowDocker({"backend": CURRENT, "frontend": CURRENT})
    u, _ = make(docker=docker, spawn=lambda fn: threading.Thread(target=fn, daemon=True).start())
    assert u.start_update()[0] == 202
    assert started.wait(5)
    code, body = u.start_update()
    assert code == 409 and "already running" in body["error"]
    release.set()


@pytest.mark.parametrize("services", [["backend", "db"], ["updater"], ["backend; rm -rf /"]])
def test_rejects_protected_services(services):
    with pytest.raises(ValueError):
        up.Updater(repo="x/y", workflow="w.yml", services=services)


@pytest.fixture()
def server():
    u, _ = make()
    srv = ThreadingHTTPServer(("127.0.0.1", 0), up.make_handler(u, "secret-token"))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def call(url, method="GET", token=None):
    req = Request(url, method=method, headers={"Authorization": f"Bearer {token}"} if token else {})
    try:
        with urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read())
    except HTTPError as err:
        return err.code, json.loads(err.read())


def test_http_auth_and_routes(server):
    assert call(f"{server}/health") == (200, {"ok": True})
    assert call(f"{server}/status")[0] == 401
    assert call(f"{server}/status", token="wrong")[0] == 401
    code, body = call(f"{server}/status?refresh=1", token="secret-token")
    assert code == 200 and body["update_available"] is True
    code, body = call(f"{server}/update", method="POST", token="secret-token")
    assert code == 202 and body["job"]["state"] in ("pulling", "restarting", "done")
    assert call(f"{server}/nope", token="secret-token")[0] == 404
