# Self-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish images to GHCR and let the web app offer, via a Sonner toast, a one-click update that pulls new images and restarts the app containers.

**Architecture:** A small stdlib-Python `updater` container (Docker socket + read-only project mount) answers `/status` and `/update` on the internal Compose network. The backend proxies it behind `require_auth` at `/api/system/*` and reports its own `APP_REVISION`. The frontend swaps its homemade toasts for Sonner and mounts an `UpdateChecker` that polls status and drives the update. CI publishes three images to GHCR with `GITHUB_TOKEN`.

**Tech Stack:** Python 3.12 stdlib (`http.server`, `subprocess`, `urllib`) + Docker CLI/Compose in `python:3.12-alpine`; FastAPI + httpx 0.28; Next.js 16 + `sonner@2`; GitHub Actions (`docker/*` actions).

**Spec:** `docs/superpowers/specs/2026-10-02-self-update-design.md`

Code blocks preceded by `<!-- file: PATH -->` are complete file contents; `<!-- append: PATH -->` blocks are appended verbatim.

## Global Constraints

- Registry `ghcr.io`, images `ghcr.io/<owner-lowercase>/look-{backend,frontend,updater}`, tags `latest` + `sha-<short>`; login with `GITHUB_TOKEN`, `permissions: packages: write`.
- Compose top-level `name: todo-app` (keeps `todo-app_postgres_data`).
- Updater never touches `db`, `updater`, or `openai-tunnel`; commands are fixed argument lists, no shell.
- Updater has no published port; every endpoint except `/health` needs `Authorization: Bearer <API_TOKEN>`.
- GitHub status cached 10 min; forced refresh at most once per 30 s.
- Updater unreachable or not configured → UI hides the feature, no errors.
- `toast()` / `toastError()` keep their signatures.
- No em-dashes in visible copy; Phosphor icons; app tokens; both themes.
- Existing backend tests keep passing.

## Review Focus

1. **Database volume survives an update** (project name drift would start an empty DB). Pinned by Task 3's `docker compose config` check that `name: todo-app` and volume `todo-app_postgres_data` resolve from inside `/project`, and by Task 5's before/after task count.
2. **A second Update click while one is running** must not start a parallel `docker compose`. Pinned in Task 1 (`test_concurrent_update_is_409`).
3. **GitHub down or rate-limited** must not crash the updater or show a false "update available". Pinned in Task 1 (`test_github_error_sets_check_error_and_no_update`).
4. **A configured service list containing `db` or `updater`** must be refused at startup. Pinned in Task 1 (`test_rejects_protected_services`).
5. **Backend restarting mid-update** (fetches fail, Next proxy 500s) must not show an error toast. Covered by Task 4's poll loop swallowing errors; verified in Task 5's real update.

---

### Task 1: Updater service

**Files:**
- Create: `updater/updater.py`, `updater/Dockerfile`, `updater/tests/__init__.py`, `updater/tests/test_updater.py`

**Interfaces:**
- Produces `Updater(repo, workflow, services, run=..., fetch=..., clock=..., spawn=...)` with `.status(refresh=False) -> dict`, `.start_update(force=False) -> (int, dict)`; `make_handler(updater, token)`; HTTP API per spec §3.

- [ ] **Step 1: Write the failing tests**

<!-- file: updater/tests/__init__.py -->
```python
```

<!-- file: updater/tests/test_updater.py -->
```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd updater && ../backend/.venv/bin/pytest -q`
Expected: collection error, `ModuleNotFoundError: No module named 'updater'`.

- [ ] **Step 3: Implement**

<!-- file: updater/updater.py -->
```python
"""Self-update helper for the Look stack.

Runs as its own container with the Docker socket and the project folder
(read-only) mounted. It does exactly two things, both reachable only from
the internal Compose network and only with the app's API token:

* GET /status   compare the commit the running backend/frontend images were
                built from (OCI revision label) with the head commit of the
                latest successful publish workflow run on GitHub.
* POST /update  `docker compose pull` then `up -d` for a fixed list of app
                services. Never db, the tunnel, or this container.

Stdlib only, so the image is just Python plus the Docker CLI.
"""

import hmac
import json
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Dict, List, Optional, Tuple
from urllib.request import Request, urlopen

REVISION_LABEL = "org.opencontainers.image.revision"
CACHE_SECONDS = 600
REFRESH_MIN_SECONDS = 30
MAX_CHANGES = 20
VERSIONED_SERVICES = ("backend", "frontend")
PROTECTED_SERVICES = {"db", "updater", "openai-tunnel"}
_SERVICE_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def run_command(args: List[str]) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, timeout=900)


def fetch_json(url: str) -> dict:
    req = Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "look-updater"})
    with urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def _tail(text: str, lines: int = 20) -> str:
    return "\n".join((text or "").strip().splitlines()[-lines:]) or "Command failed with no output."


class Updater:
    def __init__(
        self,
        repo: str,
        workflow: str,
        services: List[str],
        run: Callable[[List[str]], subprocess.CompletedProcess] = run_command,
        fetch: Callable[[str], dict] = fetch_json,
        clock: Callable[[], float] = time.monotonic,
        spawn: Optional[Callable[[Callable[[], None]], None]] = None,
    ):
        for name in services:
            if not _SERVICE_NAME.match(name) or name in PROTECTED_SERVICES:
                raise ValueError(f"Refusing to manage service {name!r}.")
        if not services:
            raise ValueError("No services to update.")
        self.repo = repo
        self.workflow = workflow
        self.services = list(services)
        self.run = run
        self.fetch = fetch
        self.clock = clock
        self.spawn = spawn or (lambda fn: threading.Thread(target=fn, daemon=True).start())
        self.lock = threading.Lock()
        self.job: Dict = {"state": "idle", "error": None, "started_at": None, "finished_at": None, "target": None}
        self._latest: Optional[Dict] = None
        self._fetched_at: Optional[float] = None
        self._last_refresh: Optional[float] = None
        self._changes_cache: Dict[Tuple[str, str], List[Dict]] = {}
        self.checked_at: Optional[str] = None
        self.check_error: Optional[str] = None

    # ---- versions ---------------------------------------------------------

    def current_revision(self, service: str) -> Optional[str]:
        ps = self.run(["docker", "compose", "ps", "-q", service])
        ids = ps.stdout.split() if ps.returncode == 0 else []
        if not ids:
            return None
        fmt = '{{ index .Config.Labels "%s" }}' % REVISION_LABEL
        out = self.run(["docker", "inspect", "--format", fmt, ids[0]])
        value = out.stdout.strip() if out.returncode == 0 else ""
        return value if value and value != "<no value>" else None

    def latest(self, refresh: bool = False) -> Optional[Dict]:
        now = self.clock()
        force = False
        if refresh and (self._last_refresh is None or now - self._last_refresh >= REFRESH_MIN_SECONDS):
            force = True
            self._last_refresh = now
        if force or self._fetched_at is None or now - self._fetched_at >= CACHE_SECONDS:
            url = (
                f"https://api.github.com/repos/{self.repo}/actions/workflows/{self.workflow}/runs"
                "?branch=main&status=success&per_page=1"
            )
            try:
                runs = self.fetch(url).get("workflow_runs") or []
                self._latest = (
                    {"sha": runs[0]["head_sha"], "published_at": runs[0]["updated_at"]} if runs else None
                )
                self.check_error = None
            except Exception as exc:  # network, rate limit, bad JSON
                self.check_error = f"Couldn't check GitHub for updates: {exc}"
            self._fetched_at = now
            self.checked_at = now_iso()
        return self._latest if self.check_error is None else None

    def changes(self, current: Optional[str], latest_sha: str) -> List[Dict]:
        if not current or current == latest_sha:
            return []
        key = (current, latest_sha)
        if key not in self._changes_cache:
            try:
                commits = self.fetch(
                    f"https://api.github.com/repos/{self.repo}/compare/{current}...{latest_sha}"
                ).get("commits") or []
            except Exception:
                return []
            self._changes_cache[key] = [
                {"sha": c["sha"][:7], "message": (c["commit"]["message"].splitlines() or [""])[0]}
                for c in reversed(commits)
            ][:MAX_CHANGES]
        return self._changes_cache[key]

    def status(self, refresh: bool = False) -> Dict:
        current = {svc: self.current_revision(svc) for svc in VERSIONED_SERVICES}
        latest = self.latest(refresh)
        available = latest is not None and any(rev != latest["sha"] for rev in current.values())
        reference = current["backend"] or current["frontend"]
        with self.lock:
            job = dict(self.job)
        return {
            "current": current,
            "latest": latest,
            "update_available": available,
            "changes": self.changes(reference, latest["sha"]) if available else [],
            "checked_at": self.checked_at,
            "check_error": self.check_error,
            "job": job,
        }

    # ---- update job -------------------------------------------------------

    def _running(self) -> bool:
        return self.job["state"] in ("pulling", "restarting")

    def start_update(self, force: bool = False) -> Tuple[int, Dict]:
        with self.lock:
            if self._running():
                return 409, {"error": "An update is already running.", "job": dict(self.job)}
        snapshot = self.status()
        if not snapshot["update_available"] and not force:
            return 409, {"error": "Already up to date.", "job": snapshot["job"]}
        with self.lock:
            if self._running():
                return 409, {"error": "An update is already running.", "job": dict(self.job)}
            self.job = {
                "state": "pulling",
                "error": None,
                "started_at": now_iso(),
                "finished_at": None,
                "target": snapshot["latest"]["sha"] if snapshot["latest"] else None,
            }
            job = dict(self.job)
        self.spawn(self._run_job)
        return 202, {"job": job}

    def _set(self, **fields) -> None:
        with self.lock:
            self.job.update(fields)

    def _run_job(self) -> None:
        steps = [
            ("pulling", ["docker", "compose", "pull", *self.services]),
            ("restarting", ["docker", "compose", "up", "-d", "--no-deps", "--no-build", *self.services]),
        ]
        for state, args in steps:
            self._set(state=state)
            try:
                result = self.run(args)
            except Exception as exc:
                self._set(state="failed", error=str(exc), finished_at=now_iso())
                return
            if result.returncode != 0:
                self._set(state="failed", error=_tail(result.stderr or result.stdout), finished_at=now_iso())
                return
        self._set(state="done", finished_at=now_iso())


# ---- HTTP -----------------------------------------------------------------


def make_handler(updater: Updater, token: str):
    expected = f"Bearer {token}".encode()

    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, body: Dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _route(self) -> Tuple[str, List[str]]:
            path, _, query = self.path.partition("?")
            return path, query.split("&") if query else []

        def _authorized(self) -> bool:
            given = self.headers.get("Authorization", "").encode()
            return bool(token) and hmac.compare_digest(given, expected)

        def do_GET(self) -> None:
            path, params = self._route()
            if path == "/health":
                return self._send(200, {"ok": True})
            if not self._authorized():
                return self._send(401, {"error": "Unauthorized."})
            if path == "/status":
                return self._send(200, updater.status(refresh="refresh=1" in params))
            self._send(404, {"error": "Not found."})

        def do_POST(self) -> None:
            path, params = self._route()
            if not self._authorized():
                return self._send(401, {"error": "Unauthorized."})
            if path == "/update":
                code, body = updater.start_update(force="force=1" in params)
                return self._send(code, body)
            self._send(404, {"error": "Not found."})

        def log_message(self, fmt, *args) -> None:
            sys.stderr.write("updater: " + (fmt % args) + "\n")

    return Handler


def main() -> None:
    token = os.environ.get("API_TOKEN", "")
    if not token:
        raise SystemExit("API_TOKEN is required.")
    updater = Updater(
        repo=os.environ.get("UPDATER_GITHUB_REPO", "Ddundee/look"),
        workflow=os.environ.get("UPDATER_WORKFLOW", "docker-publish.yml"),
        services=os.environ.get("UPDATER_SERVICES", "backend mcp frontend").split(),
    )
    server = ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("UPDATER_PORT", "8080"))), make_handler(updater, token))
    print("updater: listening on", server.server_address, flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
```

<!-- file: updater/Dockerfile -->
```dockerfile
# Self-update helper: Python (stdlib only) plus the Docker CLI and Compose
# plugin, so it can `docker compose pull/up` the app services through the
# mounted Docker socket. Multi-arch via python:3.12-alpine.
FROM python:3.12-alpine

RUN apk add --no-cache docker-cli docker-cli-compose

WORKDIR /srv
COPY updater.py .

ENV PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["python", "/srv/updater.py"]
```

- [ ] **Step 4: Run tests**

Run: `cd updater && ../backend/.venv/bin/pytest -q`
Expected: all pass.

- [ ] **Step 5: Build the image**

Run: `docker build -t look-updater:dev updater && docker run --rm look-updater:dev sh -c "docker --version && docker compose version"`
Expected: build succeeds; both versions print.

- [ ] **Step 6: Commit** (`updater/`) — "Add updater service: version check and compose pull/up job".

---

### Task 2: Backend system endpoints

**Files:**
- Modify: `backend/app/config.py` (add `updater_url: str = ""`, `app_revision: str = ""`)
- Create: `backend/app/routers/system.py`, `backend/tests/test_system_api.py`
- Modify: `backend/app/main.py` (include router), `backend/Dockerfile` (ARG/ENV `APP_REVISION`)

**Interfaces:**
- Produces `GET /api/system/version` → `{"revision": str|null}`; `GET /api/system/update?refresh=` → `{"enabled": false}` or `{"enabled": true, ...updater status}`; `POST /api/system/update` → pass-through status/body (`detail` = updater `error`), 503 when unavailable.
- Module attribute `app.routers.system.transport: Optional[httpx.BaseTransport]` for tests.

- [ ] **Step 1: Write the failing tests**

<!-- file: backend/tests/test_system_api.py -->
```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_system_api.py -q`
Expected: FAIL, `ImportError: cannot import name 'system'`.

- [ ] **Step 3: Implement**

`app/config.py`: add under `seed_demo_data`:

```python
    # Self-update: internal URL of the updater container (empty = feature
    # off) and the git commit this image was built from (set by CI).
    updater_url: str = ""
    app_revision: str = ""
```

<!-- file: backend/app/routers/system.py -->
```python
"""Version info and the self-update proxy.

The updater container is only reachable on the internal Compose network;
the browser talks to it through these endpoints, behind the normal login.
If no updater is configured or it doesn't answer, the feature reports
itself as disabled instead of erroring, so the UI just hides it.
"""

from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.deps import require_auth

router = APIRouter(prefix="/api/system", tags=["system"], dependencies=[Depends(require_auth)])

TIMEOUT_SECONDS = 5.0
# Tests swap in httpx.MockTransport.
transport: Optional[httpx.BaseTransport] = None


def _client() -> httpx.Client:
    settings = get_settings()
    return httpx.Client(
        base_url=settings.updater_url.rstrip("/"),
        headers={"Authorization": f"Bearer {settings.api_token}"},
        timeout=TIMEOUT_SECONDS,
        transport=transport,
    )


@router.get("/version")
def version() -> dict:
    return {"revision": get_settings().app_revision or None}


@router.get("/update")
def update_status(refresh: bool = False) -> dict:
    if not get_settings().updater_url:
        return {"enabled": False}
    try:
        with _client() as client:
            resp = client.get("/status", params={"refresh": "1"} if refresh else None)
        resp.raise_for_status()
        return {"enabled": True, **resp.json()}
    except (httpx.HTTPError, ValueError):
        return {"enabled": False}


@router.post("/update")
def start_update(force: bool = False):
    if not get_settings().updater_url:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Updates aren't set up on this server.")
    try:
        with _client() as client:
            resp = client.post("/update", params={"force": "1"} if force else None)
        body = resp.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Couldn't reach the updater.")
    if resp.status_code >= 400:
        raise HTTPException(resp.status_code, body.get("error") or "Update failed to start.")
    return JSONResponse(status_code=resp.status_code, content=body)
```

`app/main.py`: `from app.routers import auth, events, nutrition, recurring, system, tasks, today` (keep whatever else is imported) and `app.include_router(system.router)`.

`backend/Dockerfile`: before `COPY requirements.txt .` add:

```dockerfile
# Git commit this image was built from (CI passes --build-arg); reported
# at /api/system/version so the web app can tell when it's been updated.
ARG APP_REVISION=
ENV APP_REVISION=$APP_REVISION
```

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/bin/pytest tests/test_system_api.py -q && .venv/bin/pytest -q`
Expected: all pass.

- [ ] **Step 5: Commit** — "Add /api/system version and update proxy endpoints".

---

### Task 3: Publishing to GHCR and Compose wiring

**Files:**
- Modify: `.github/workflows/docker-publish.yml` (full rewrite below)
- Modify: `docker-compose.yml` (`name:`, image names, `UPDATER_URL`, `updater` service)
- Modify: `frontend/Dockerfile` (ARG/ENV `APP_REVISION` in the runner stage)
- Modify: `.env.example`, `docs/DEPLOYMENT.md` ("Updating" + registry sections)

- [ ] **Step 1: Workflow**

<!-- file: .github/workflows/docker-publish.yml -->
```yaml
name: Publish Docker images

# Builds multi-arch (amd64 + arm64) images and pushes them to GitHub
# Container Registry (ghcr.io) with the workflow's own GITHUB_TOKEN, so no
# registry secrets are needed. A Raspberry Pi (or any machine) can then
# `docker compose pull` instead of building on-device, and the in-app
# updater compares the running images' revision label with the head
# commit of the latest successful run of this workflow.

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

jobs:
  publish:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - name: backend
            context: ./backend
          - name: frontend
            context: ./frontend
          - name: updater
            context: ./updater
    steps:
      - uses: actions/checkout@v4

      - name: Lower-case image owner
        run: echo "OWNER=${GITHUB_REPOSITORY_OWNER,,}" >> "$GITHUB_ENV"

      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ghcr.io/${{ env.OWNER }}/look-${{ matrix.name }}
          tags: |
            type=raw,value=latest
            type=sha,format=short

      - uses: docker/build-push-action@v6
        with:
          context: ${{ matrix.context }}
          platforms: linux/amd64,linux/arm64
          push: true
          build-args: |
            APP_REVISION=${{ github.sha }}
            INTERNAL_API_BASE_URL=http://backend:8000
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha,scope=${{ matrix.name }}
          cache-to: type=gha,mode=max,scope=${{ matrix.name }}
```

(`build-args` the image doesn't declare are ignored by BuildKit with a warning; `INTERNAL_API_BASE_URL` only matters for the frontend, `APP_REVISION` for backend/frontend.)

- [ ] **Step 2: Compose**

Edits to `docker-compose.yml`:
1. First line: `name: todo-app` followed by a comment: project name is pinned because named volumes (`todo-app_postgres_data`) are prefixed with it and the updater runs Compose from `/project`.
2. backend and mcp `image:` → `${IMAGE_PREFIX:-ghcr.io/ddundee/look}-backend:latest`; frontend → `${IMAGE_PREFIX:-ghcr.io/ddundee/look}-frontend:latest`.
3. backend `environment:` add `UPDATER_URL: ${UPDATER_URL:-http://updater:8080}`.
4. New service before `openai-tunnel`:

<!-- snippet: docker-compose.yml updater service -->
```yaml
  # Self-update helper (see updater/updater.py). Pulls and restarts
  # backend, mcp and frontend when you press Update in the web app. Never
  # touches db, the tunnel or itself. No ports: only the backend reaches
  # it, on this compose network, with API_TOKEN. Mounting the Docker
  # socket gives it control of Docker, which is what updating requires.
  updater:
    build: ./updater
    image: ${IMAGE_PREFIX:-ghcr.io/ddundee/look}-updater:latest
    restart: unless-stopped
    working_dir: /project
    environment:
      API_TOKEN: ${API_TOKEN}
      UPDATER_GITHUB_REPO: ${UPDATER_GITHUB_REPO:-Ddundee/look}
      UPDATER_WORKFLOW: ${UPDATER_WORKFLOW:-docker-publish.yml}
      UPDATER_SERVICES: ${UPDATER_SERVICES:-backend mcp frontend}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - .:/project:ro
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8080/health', timeout=3)"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 5s
```

- [ ] **Step 3: Frontend Dockerfile** — in the `runner` stage after `ENV NODE_ENV=production`:

```dockerfile
ARG APP_REVISION=
ENV APP_REVISION=$APP_REVISION
```

- [ ] **Step 4: `.env.example`** — add a "Self-update" block documenting `IMAGE_PREFIX` (default `ghcr.io/ddundee/look`), `UPDATER_GITHUB_REPO` (default `Ddundee/look`), `UPDATER_URL` (set empty to turn the feature off).

- [ ] **Step 5: Docs** — `docs/DEPLOYMENT.md`: replace "Docker Hub images and multi-arch builds" with a GHCR section (packages published by CI with `GITHUB_TOKEN`; make the three packages public once); rewrite "Updating" to describe the in-app Update button plus the manual `docker compose pull && docker compose up -d` fallback and that the updater updates itself only via that manual command.

- [ ] **Step 6: Verify config resolves from the updater's point of view**

Run: `docker compose config --format json | python3 -c "import sys,json; c=json.load(sys.stdin); print(c['name'], sorted(c['volumes']), c['services']['updater']['working_dir'])"`
Expected: `todo-app ['backend_data', 'postgres_data'] /project`.

Run (simulates the updater's view: project mounted elsewhere): `docker run --rm -v "$PWD":/project:ro -w /project -v /var/run/docker.sock:/var/run/docker.sock look-updater:dev docker compose config --volumes && docker run --rm -v "$PWD":/project:ro -w /project -v /var/run/docker.sock:/var/run/docker.sock look-updater:dev docker compose ps --format '{{.Name}}'`
Expected: volumes `backend_data`, `postgres_data`; `ps` lists the running `todo-app-*` containers (proving the project name matches the live stack).

Run: `actionlint .github/workflows/docker-publish.yml` if available, otherwise `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/docker-publish.yml'))"`.
Expected: no errors.

- [ ] **Step 7: Commit** — "Publish to GHCR with GITHUB_TOKEN; add updater to compose".

---

### Task 4: Frontend: Sonner, update checker, version settings

**Files:**
- Modify: `frontend/package.json` (`npm install sonner@^2`)
- Modify: `frontend/src/lib/toast.ts` (full rewrite), `frontend/src/components/Toaster.tsx` (full rewrite)
- Modify: `frontend/src/lib/types.ts` (append), `frontend/src/lib/api.ts` (3 methods)
- Create: `frontend/src/components/UpdateChecker.tsx`
- Modify: `frontend/src/components/AppShell.tsx` (mount `<UpdateChecker />` next to the non-login `<Toaster />`)
- Modify: `frontend/src/app/settings/page.tsx` (Version section)

- [ ] **Step 1: Install** — `cd frontend && npm install sonner@^2`.

- [ ] **Step 2: Toasts on Sonner**

<!-- file: frontend/src/lib/toast.ts -->
```ts
"use client";

// Thin wrapper over Sonner so call sites keep the old `toast(message,
// kind)` / `toastError(err)` API. <Toaster /> renders the Sonner host.
import { toast as sonner } from "sonner";

export type ToastKind = "success" | "error" | "info";

export function toast(message: string, kind: ToastKind = "success"): void {
  if (kind === "error") sonner.error(message, { duration: 6000 });
  else if (kind === "info") sonner.info(message);
  else sonner.success(message);
}

export function toastError(err: unknown, fallback = "Something went wrong"): void {
  toast(err instanceof Error && err.message ? err.message : fallback, "error");
}
```

<!-- file: frontend/src/components/Toaster.tsx -->
```tsx
"use client";

import { useSyncExternalStore } from "react";
import { Toaster as Sonner } from "sonner";
import { CheckCircleIcon, CircleNotchIcon, InfoIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { getServerThemeSnapshot, getThemeSnapshot, subscribeTheme } from "@/lib/theme";

/** Sonner host, themed with the app's tokens and following the manual
 * light/dark toggle rather than only the OS preference. */
export default function Toaster() {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);

  return (
    <Sonner
      theme={theme}
      position="bottom-center"
      visibleToasts={3}
      gap={8}
      closeButton
      icons={{
        success: <CheckCircleIcon weight="fill" className="h-4 w-4 text-accent" aria-hidden />,
        error: <WarningCircleIcon weight="fill" className="h-4 w-4 text-danger" aria-hidden />,
        info: <InfoIcon weight="fill" className="h-4 w-4 text-fg-faint" aria-hidden />,
        loading: <CircleNotchIcon className="h-4 w-4 animate-spin text-accent" aria-hidden />,
      }}
      style={
        {
          "--normal-bg": "var(--surface)",
          "--normal-border": "var(--line)",
          "--normal-text": "var(--fg)",
          "--border-radius": "12px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "font-sans elev-3",
          description: "text-fg-muted!",
          actionButton: "bg-accent! text-accent-fg! font-medium!",
          cancelButton: "bg-surface-2! text-fg!",
        },
      }}
    />
  );
}
```

- [ ] **Step 3: Types and API**

<!-- append: frontend/src/lib/types.ts -->
```ts

// ---- Self-update ------------------------------------------------------------

export type UpdateJobState = "idle" | "pulling" | "restarting" | "done" | "failed";

export interface UpdateJob {
  state: UpdateJobState;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  target: string | null;
}

export interface UpdateStatus {
  enabled: boolean;
  current?: { backend: string | null; frontend: string | null };
  latest?: { sha: string; published_at: string } | null;
  update_available?: boolean;
  changes?: { sha: string; message: string }[];
  checked_at?: string | null;
  check_error?: string | null;
  job?: UpdateJob;
}
```

`lib/api.ts`: import `UpdateJob, UpdateStatus`; add to `api`:

```ts
  getVersion: () => request<{ revision: string | null }>("/api/system/version"),
  getUpdateStatus: (refresh = false) =>
    request<UpdateStatus>(`/api/system/update${qs({ refresh: refresh || undefined })}`),
  startUpdate: () => request<{ job: UpdateJob }>("/api/system/update", { method: "POST" }),
```

- [ ] **Step 4: UpdateChecker**

<!-- file: frontend/src/components/UpdateChecker.tsx -->
```tsx
"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast as sonner } from "sonner";
import { api } from "@/lib/api";
import type { UpdateStatus } from "@/lib/types";

const TOAST_ID = "look-update";
const CHECK_EVERY_MS = 15 * 60 * 1000;
const POLL_MS = 2000;
const GIVE_UP_MS = 5 * 60 * 1000;
const DISMISSED_KEY = "look-update-dismissed";
/** Fired by Settings' "Check for updates" to show the toast right away. */
export const CHECK_UPDATE_EVENT = "look:check-update";

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(sha: string | null): void {
  try {
    if (sha) localStorage.setItem(DISMISSED_KEY, sha);
    else localStorage.removeItem(DISMISSED_KEY);
  } catch {
    // storage blocked: "Later" just won't be remembered
  }
}

function summary(status: UpdateStatus): string {
  const changes = status.changes ?? [];
  if (changes.length === 0) return "A newer version of Look is ready to install.";
  const shown = changes.slice(0, 3).map((c) => c.message);
  return changes.length > 3 ? `${shown.join("; ")}; and ${changes.length - 3} more` : shown.join("; ");
}

/** Polls the self-update status and drives the one-click update through a
 * single persistent Sonner toast. Renders nothing; hidden entirely when the
 * server has no updater. */
export default function UpdateChecker() {
  const updating = useRef(false);

  const runUpdate = useCallback(async (target: string | null) => {
    updating.current = true;
    sonner.loading("Downloading update", { id: TOAST_ID, duration: Infinity, description: "This takes a minute." });

    const failed = (reason: string) => {
      updating.current = false;
      sonner.error("Update failed", {
        id: TOAST_ID,
        duration: Infinity,
        description: reason,
        action: {
          label: "Retry",
          onClick: (e) => {
            e.preventDefault();
            void runUpdate(target);
          },
        },
      });
    };

    try {
      await api.startUpdate();
    } catch (err) {
      failed(err instanceof Error ? err.message : "Couldn't start the update.");
      return;
    }

    const started = Date.now();
    const poll = async () => {
      if (Date.now() - started > GIVE_UP_MS) {
        updating.current = false;
        sonner.error("The update is taking longer than expected", {
          id: TOAST_ID,
          duration: Infinity,
          description: "Check the server, then reload this page.",
        });
        return;
      }
      try {
        const status = await api.getUpdateStatus();
        const job = status.job;
        if (job?.state === "failed") return failed(job.error ?? "The update failed.");
        if (job?.state === "restarting" || job?.state === "done") {
          sonner.loading("Restarting", { id: TOAST_ID, duration: Infinity, description: "Back in a few seconds." });
        }
        if (job?.state === "done") {
          const { revision } = await api.getVersion();
          if (!target || revision === target) {
            sonner.success("Updated. Reloading", { id: TOAST_ID, duration: Infinity, description: undefined });
            setTimeout(() => window.location.reload(), 800);
            return;
          }
        }
      } catch {
        // Expected while the app's containers restart.
        sonner.loading("Restarting", { id: TOAST_ID, duration: Infinity, description: "Back in a few seconds." });
      }
      setTimeout(poll, POLL_MS);
    };
    setTimeout(poll, POLL_MS);
  }, []);

  const check = useCallback(
    async (manual = false) => {
      if (updating.current) return;
      let status: UpdateStatus;
      try {
        status = await api.getUpdateStatus(manual);
      } catch {
        return;
      }
      if (!status.enabled || !status.update_available || !status.latest) return;
      const target = status.latest.sha;
      if (manual) writeDismissed(null);
      else if (readDismissed() === target) return;
      sonner.info("Update available", {
        id: TOAST_ID,
        duration: Infinity,
        description: summary(status),
        action: {
          label: "Update",
          onClick: (e) => {
            e.preventDefault();
            void runUpdate(target);
          },
        },
        cancel: { label: "Later", onClick: () => writeDismissed(target) },
      });
    },
    [runUpdate]
  );

  useEffect(() => {
    void check();
    const interval = setInterval(() => void check(), CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onManual = () => void check(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(CHECK_UPDATE_EVENT, onManual);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(CHECK_UPDATE_EVENT, onManual);
    };
  }, [check]);

  return null;
}
```

`AppShell.tsx`: `import UpdateChecker from "./UpdateChecker";` and render `<UpdateChecker />` immediately after the main (non-login) `<Toaster />`.

- [ ] **Step 5: Settings "Version" section** — add a client component `VersionSection` at the bottom of `app/settings/page.tsx` (same section/heading/card styles as the existing sections):
  - On mount: `api.getVersion()` and `api.getUpdateStatus()`.
  - Rows: "Running" → short revision (`slice(0, 7)`) or "Local build"; "Latest published" → short `latest.sha` + `formatDate(latest.published_at.slice(0, 10))`, or "Unknown"; status line: "Up to date" / "Update available" / `check_error` / "Updates aren't set up on this server" (when `enabled` is false).
  - **Check for updates** button (`BUTTON_SECONDARY`, spinner while checking): `api.getUpdateStatus(true)`; if `update_available`, `window.dispatchEvent(new Event(CHECK_UPDATE_EVENT))`; else `toast("You're on the latest version", "info")` (or `toast(check_error, "error")`).

- [ ] **Step 6: Verify** — `cd frontend && npx tsc --noEmit && npx eslint src`; browser: trigger a task add (Sonner success toast, themed, both modes).

- [ ] **Step 7: Commit** — "Switch toasts to Sonner; add update checker and version settings".

---

### Task 5: End-to-end verification and rollout

- [ ] **Step 1:** All suites: `backend` pytest, `updater` pytest, frontend `tsc`/`eslint`/`next build` (scratch copy).
- [ ] **Step 2:** Local stack with the updater built locally: `docker compose build updater && docker compose up -d updater backend`; `GET /api/system/update` through the backend returns `enabled: true`, `current` revisions `null` (local builds), and either `latest` from GitHub or a `check_error` if no successful run exists yet. Record task count from Postgres.
- [ ] **Step 3 (needs the user):** merge to `main` and push (publishes to GHCR for the first time); confirm the workflow run succeeds (`gh run watch`); user makes the three packages public.
- [ ] **Step 4:** Real update from the browser: toast appears, press Update, page reloads; `GET /api/system/version` returns the pushed commit; task count unchanged.
