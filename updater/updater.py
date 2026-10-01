"""Self-update helper for the Look stack.

Runs as its own container with the Docker socket and the project folder
(read-only) mounted. It does exactly two things, both reachable only from
the internal Compose network and only with the app's API token:

* GET /status   compare the commit the running backend/frontend images were
                built from (OCI revision label) with the head commit of the
                latest successful publish workflow run on GitHub.
* POST /update  `docker compose pull`, back up the database with pg_dump
                (migrations run when the app restarts), then `up -d` for a
                fixed list of app services. Never restarts db, the tunnel,
                or this container. No backup, no restart.

Stdlib only, so the image is just Python plus the Docker CLI.
"""

import gzip
import hmac
import json
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
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
# Runs pg_dump inside the db container with its own credentials.
BACKUP_COMMAND = ["docker", "compose", "exec", "-T", "db", "sh", "-c", 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"']


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
        backup_dir: str = "/backups",
    ):
        for name in services:
            if not _SERVICE_NAME.match(name) or name in PROTECTED_SERVICES:
                raise ValueError(f"Refusing to manage service {name!r}.")
        if not services:
            raise ValueError("No services to update.")
        self.repo = repo
        self.workflow = workflow
        self.services = list(services)
        self.backup_dir = Path(backup_dir)
        self.run = run
        self.fetch = fetch
        self.clock = clock
        self.spawn = spawn or (lambda fn: threading.Thread(target=fn, daemon=True).start())
        self.lock = threading.Lock()
        self.job: Dict = {
            "state": "idle", "error": None, "started_at": None, "finished_at": None, "target": None, "backup": None,
        }
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
        return self.job["state"] in ("pulling", "backing_up", "restarting")

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
                "backup": None,
            }
            job = dict(self.job)
        self.spawn(self._run_job)
        return 202, {"job": job}

    def _set(self, **fields) -> None:
        with self.lock:
            self.job.update(fields)

    def _backup(self) -> str:
        """pg_dump the database to <backup_dir>/todo-app-<time>-pre-update.sql.gz
        (same naming as scripts/backup.sh, so its pruning applies too)."""
        result = self.run(BACKUP_COMMAND)
        if result.returncode != 0:
            raise RuntimeError(_tail(result.stderr or result.stdout))
        if not result.stdout.strip():
            raise RuntimeError("pg_dump produced no output.")
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        path = self.backup_dir / f"todo-app-{stamp}-pre-update.sql.gz"
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        with gzip.open(path, "wt", encoding="utf-8") as out:
            out.write(result.stdout)
        return str(path)

    def _run_job(self) -> None:
        def step(state: str, args: List[str]) -> bool:
            self._set(state=state)
            try:
                result = self.run(args)
            except Exception as exc:
                self._set(state="failed", error=str(exc), finished_at=now_iso())
                return False
            if result.returncode != 0:
                self._set(state="failed", error=_tail(result.stderr or result.stdout), finished_at=now_iso())
                return False
            return True

        if not step("pulling", ["docker", "compose", "pull", *self.services]):
            return
        # The new images apply database migrations when they start, so take a
        # backup first. If it fails, nothing is restarted.
        self._set(state="backing_up")
        try:
            self._set(backup=self._backup())
        except Exception as exc:
            self._set(state="failed", error=f"Backup failed, so nothing was restarted: {exc}", finished_at=now_iso())
            return
        if not step("restarting", ["docker", "compose", "up", "-d", "--no-deps", "--no-build", *self.services]):
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
        backup_dir=os.environ.get("UPDATER_BACKUP_DIR", "/backups"),
    )
    server = ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("UPDATER_PORT", "8080"))), make_handler(updater, token))
    print("updater: listening on", server.server_address, flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
