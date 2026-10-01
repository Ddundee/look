# Self-Update: Design

**Date:** 2026-10-02
**Status:** Approved in conversation, pending spec review

## Goal

When a push to `main` has produced new published images, the web app shows
a Sonner toast offering to update. Pressing **Update** pulls the new images
and restarts the app's containers, then the page reloads on the new
version. Along the way, fix image publishing, which has never worked.

## Findings that shaped this

- Every `Publish Docker images` run has failed at `docker/login-action`
  ("Username and password required"): the repo has no `DOCKERHUB_*`
  secrets and `ddundee/todo-app-*` does not exist on Docker Hub. Running
  images were built locally.
- The repo is now `Ddundee/look` (public).
- `docker-compose.yml` uses only named volumes (no host-path bind mounts),
  so Compose can be driven from inside a container with the project
  mounted at any path, as long as the project name is fixed.
- Named volumes are prefixed with the Compose project name (currently
  `todo-app`, from the folder name). Changing the project name would
  orphan the database volume.

## Decisions

- **Registry: GHCR**, authenticated with the workflow's built-in
  `GITHUB_TOKEN` (`permissions: packages: write`). No secrets.
  Images: `ghcr.io/ddundee/look-backend`, `look-frontend`, `look-updater`,
  tagged `latest` and `sha-<short>`. Packages are made public once, by
  the user, after the first publish.
- **Version identity = git commit.** Images carry
  `org.opencontainers.image.revision` (set by `docker/metadata-action`).
  Backend and frontend images also get `APP_REVISION=<sha>` via build
  arg so the running app can report itself.
- **"New version available"** = the head commit of the latest *successful*
  `docker-publish.yml` run on `main` differs from the revision label of
  the running `backend` or `frontend` container. A container with no
  revision label (local build) counts as outdated.
- **Updater = separate container** with the Docker socket and the project
  directory (read-only). Only fixed actions; reachable only on the
  internal Compose network; authenticated with the existing `API_TOKEN`.
- **The updater never updates or restarts itself, `db`, or the tunnel.**
- **Compose project name pinned** to `todo-app` (top-level `name:`) so
  the updater and the user's shell address the same project and volumes.
- **Sonner replaces the homemade toast system**; the `toast()` /
  `toastError()` API stays the same for callers.

Out of scope: rolling back to an older version from the UI, updating the
updater itself from the UI, scheduled/automatic updates without a click,
Docker Hub.

## 1. Publishing (`.github/workflows/docker-publish.yml`)

- `permissions: contents: read, packages: write`.
- Login: `registry: ghcr.io`, `username: ${{ github.actor }}`,
  `password: ${{ secrets.GITHUB_TOKEN }}`.
- Three jobs (backend, frontend, updater), each with
  `docker/metadata-action` images `ghcr.io/${{ github.repository_owner }}/look-<name>`
  (lower-cased owner), tags `type=raw,value=latest` and
  `type=sha,format=short`, labels passed to build-push.
- Backend and frontend builds pass `build-args: APP_REVISION=${{ github.sha }}`
  (frontend keeps `INTERNAL_API_BASE_URL=http://backend:8000`).
- Platforms stay `linux/amd64,linux/arm64`.

Dockerfiles: `ARG APP_REVISION=` and `ENV APP_REVISION=$APP_REVISION` in
the final stage of backend and frontend.

## 2. Compose

- Top-level `name: todo-app`.
- `image:` for backend/mcp → `${IMAGE_PREFIX:-ghcr.io/ddundee/look}-backend:latest`,
  frontend → `...-frontend:latest`, updater → `...-updater:latest`;
  `build:` contexts kept for local builds.
- New `updater` service:
  - volumes: `/var/run/docker.sock:/var/run/docker.sock`, `.:/project:ro`
  - `working_dir: /project`
  - env: `API_TOKEN`, `UPDATER_GITHUB_REPO` (default `Ddundee/look`),
    `UPDATER_WORKFLOW` (default `docker-publish.yml`),
    `UPDATER_SERVICES` (default `backend mcp frontend`)
  - no `ports:`; `restart: unless-stopped`; healthcheck on `/health`.
- Backend gets `UPDATER_URL=http://updater:8080` (empty/absent = feature off).
- `.env.example` documents `IMAGE_PREFIX`, `UPDATER_GITHUB_REPO`.

## 3. Updater (`updater/`)

Python 3.12 stdlib HTTP server (`http.server` + `threading`), no web
framework. Image: `python:3.12-alpine` + `apk add docker-cli docker-cli-compose`.

Endpoints (all but `/health` require `Authorization: Bearer <API_TOKEN>`,
compared in constant time):

- `GET /health` → `{"ok": true}`
- `GET /status[?refresh=1]` →
  ```json
  {
    "current": {"backend": "<sha|null>", "frontend": "<sha|null>"},
    "latest": {"sha": "<sha>", "published_at": "<iso>"} | null,
    "update_available": true,
    "changes": [{"sha": "<short>", "message": "<first line>"}],
    "checked_at": "<iso>",
    "check_error": "<message|null>",
    "job": {"state": "idle|pulling|restarting|done|failed",
            "error": null, "started_at": null, "finished_at": null,
            "target": "<sha|null>"}
  }
  ```
- `POST /update` → 202 with `job`; 409 if a job is running; 409 if no
  update is available (unless `?force=1`).

Behavior:
- **Current revision:** `docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'`
  on the Compose containers for `backend` and `frontend`
  (`docker compose ps -q <svc>`). Missing label/container → `null`.
- **Latest:** GitHub REST
  `GET /repos/{repo}/actions/workflows/{workflow}/runs?branch=main&status=success&per_page=1`
  → `head_sha`, `updated_at`. Unauthenticated. Cached 10 minutes;
  `refresh=1` bypasses the cache but is itself limited to once per 30 s.
- **Changes:** when the current revision is known and differs,
  `GET /repos/{repo}/compare/{current}...{latest}` → up to 20 commits,
  first message line each, newest first. Unknown current → `[]`.
- **`update_available`** = latest known and (either service's revision
  is `null` or differs from latest).
- **Update job** (background thread, one at a time):
  1. `pulling`: `docker compose pull <services>`
  2. `restarting`: `docker compose up -d --no-deps --no-build <services>`
  3. `done` (or `failed` with the last ~20 lines of stderr)
  Commands are fixed argument lists (`subprocess.run`, no shell); the
  service list comes only from `UPDATER_SERVICES` at startup.
- Network/GitHub errors set `check_error` and leave `update_available`
  false; they never crash the server.

Tests (pytest, run in CI-less local venv): status assembly with a fake
command runner and fake GitHub responses (up to date, outdated, unknown
current, GitHub error, cache, refresh throttle); job state machine
(success, pull failure, concurrent request → 409, no-update → 409);
auth (missing/wrong token → 401, `/health` open); exact command argument
lists.

## 4. Backend

`app/routers/system.py` (auth via `require_auth`):
- `GET /api/system/version` → `{"revision": APP_REVISION or null}`
- `GET /api/system/update[?refresh=1]` → updater `/status` plus
  `"enabled": true`; if `UPDATER_URL` unset or unreachable →
  `{"enabled": false}` (200, so the UI simply hides).
- `POST /api/system/update` → proxies `POST /update`, passing status
  codes through (202/409/…); unreachable → 503.
Uses `httpx` (already a dependency) with a 5 s timeout.

Tests: version endpoint, disabled when no URL, proxy pass-through with a
mocked transport, auth required.

## 5. Frontend

- Add `sonner`. `components/Toaster.tsx` renders Sonner's `<Toaster>`
  themed with the app tokens (light/dark from the existing theme store),
  bottom-center. `lib/toast.ts` keeps `toast(message, kind)` and
  `toastError(err, fallback)` but calls Sonner.
- `components/UpdateChecker.tsx` (mounted once in `AppShell`, not on
  `/login`):
  - Fetches `/api/system/update` on mount, every 15 min, and on
    `visibilitychange` to visible. Hidden entirely when `enabled` is
    false or the request fails.
  - When `update_available` and `latest.sha` ≠ the "Later" sha stored in
    `localStorage`: one persistent Sonner toast (fixed id) "Update
    available" with the change summary (up to 3 messages + "and N
    more"), actions **Update** and **Later**.
  - **Update:** `POST`, then the same toast id shows "Downloading
    update…" / "Restarting…" from polling `/api/system/update` every 2 s.
    Fetch failures during restart are expected and ignored. When
    `/api/system/version` returns the target sha (or the job is `done`
    and the version endpoint answers), show "Updated, reloading…" and
    `location.reload()`. Give up after 5 min with an error toast.
  - **Failed:** error toast with the reason and **Retry**.
- Settings page: "Version" section with the running revision (short),
  latest published, and a **Check for updates** button (`refresh=1`).

## Error handling

- Updater unreachable → feature hidden (no errors shown).
- GitHub unreachable/rate-limited → no toast; Settings shows the
  `check_error`.
- Pull failure → job `failed`, nothing restarted, toast with reason.
- Restart takes longer than 5 min → toast "Update is taking longer than
  expected", page left as is.

## Rollout

1. Merge; CI publishes to GHCR for the first time.
2. User makes the three packages public (exact clicks in the final
   message).
3. One manual `docker compose pull && docker compose up -d` brings in the
   updater and GHCR images. From then on, updates are one click.

Verification: all test suites; workflow run succeeds on GitHub; real
end-to-end update on the running stack, confirming the database volume
and data survive (task count before = after).
