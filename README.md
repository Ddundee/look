# Look

A self-hosted personal task manager, schedule and food log.

A self-hosted task manager that is the single source of truth for your
tasks — LeetCode/DSA practice, school, projects, errands, and recurring
goals — with a web UI and an MCP server so Claude, ChatGPT, Cursor, or any
other MCP-compatible client can read and manage your tasks directly.

Runs entirely on your own hardware (a Raspberry Pi or any Linux box) via
Docker Compose. No external SaaS dependency, no required internet access
after setup, works over localhost, your LAN, or Tailscale.

## Architecture

```
todo-app/
  backend/            FastAPI + SQLModel REST API and shared service layer
    app/
      models/         Task, RecurrenceRule, User
      services/       business logic (CRUD, recurrence, priority, today view)
      routers/        REST endpoints (auth/tasks/today/recurring)
    mcp_server/       MCP server (19 tools + 3 resources) — same DB, same service layer
    tests/            pytest suite (58 tests)
  frontend/           Next.js (App Router) web UI, proxies /api/* to the backend
  docker-compose.yml  db + backend + mcp + frontend
  scripts/            backup.sh / restore.sh
  docs/               deployment, Tailscale, MCP client setup
```

One Postgres database backs both the REST API (used by the web UI) and the
MCP server — they're two processes sharing the same codebase and the same
data, not two separate systems to keep in sync.

Prebuilt multi-arch (amd64/arm64) images are published to Docker Hub as
[`ddundee/todo-app-backend`](https://hub.docker.com/r/ddundee/todo-app-backend)
and [`ddundee/todo-app-frontend`](https://hub.docker.com/r/ddundee/todo-app-frontend)
on every push to `main` (see `.github/workflows/docker-publish.yml`), so
`docker compose pull` works out of the box instead of building from source.

See [`docs/TASK_MODEL.md`](docs/TASK_MODEL.md) for the data model and
priority-scoring logic, [`docs/MCP.md`](docs/MCP.md) for the full list of
MCP tools/resources and client setup, [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
for Raspberry Pi deployment, and [`docs/TAILSCALE.md`](docs/TAILSCALE.md)
for secure remote access.

## Quickstart: Docker Compose (recommended)

```bash
git clone <your-fork-url> todo-app
cd todo-app
cp .env.example .env
# Edit .env: set API_TOKEN, SESSION_SECRET, POSTGRES_PASSWORD, ADMIN_PASSWORD
# to real random values. At minimum:
#   openssl rand -hex 32   (run twice, once for API_TOKEN, once for SESSION_SECRET)

docker compose up -d --build
```

Then open:

- Web UI: http://localhost:3000 (log in with `ADMIN_USERNAME`/`ADMIN_PASSWORD` from `.env`)
- REST API docs (Swagger UI): http://localhost:8000/docs
- MCP server: `http://localhost:8001/mcp` (see [`docs/MCP.md`](docs/MCP.md) to connect a client)

Because ports are published on `${BIND_HOST}` (`0.0.0.0` by default), the
same URLs work from your LAN (`http://<pi-ip>:3000`) and, once Tailscale is
installed on the host, from your tailnet — see
[`docs/TAILSCALE.md`](docs/TAILSCALE.md).

## Local development (without Docker)

**Backend:**

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt

export DB_ENGINE=sqlite SQLITE_PATH=./data/dev.db
export API_TOKEN=dev-token SESSION_SECRET=dev-secret-change-me
export ADMIN_USERNAME=admin ADMIN_PASSWORD=admin

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Run the test suite:

```bash
cd backend && .venv/bin/pytest
```

Run the MCP server standalone (against the same SQLite file, same env vars):

```bash
python -m mcp_server.server --transport http   # http://localhost:8001/mcp
# or, for a local stdio-spawned client (e.g. Claude Desktop):
python -m mcp_server.server --transport stdio
```

**Frontend:**

```bash
cd frontend
cp .env.local.example .env.local   # INTERNAL_API_BASE_URL=http://localhost:8000
npm install
npm run dev
```

Open http://localhost:3000.

## Raspberry Pi deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full walkthrough
(installing Docker on Raspberry Pi OS, cloning the repo, configuring
`.env`, and making sure the stack survives a reboot). Short version:

```bash
# On the Pi, with Docker + the Compose plugin installed:
git clone <your-fork-url> todo-app && cd todo-app
cp .env.example .env && nano .env   # fill in real secrets
docker compose up -d --build
```

`restart: unless-stopped` is set on every service, so as long as Docker
itself starts on boot (`sudo systemctl enable docker`, on by default on
most installs) the whole stack comes back up automatically after a power
cycle or reboot.

## Connecting an MCP client

The MCP server speaks the Streamable HTTP transport at
`http://<host>:8001/mcp`, authenticated with a `Authorization: Bearer
<API_TOKEN>` header (the same `API_TOKEN` from `.env`). Full setup for
Claude Code, Claude Desktop, Cursor, and ChatGPT-style clients — plus the
complete list of tools and resources — is in
[`docs/MCP.md`](docs/MCP.md). Quick example (Claude Code CLI):

```bash
claude mcp add --transport http personal-tasks http://<host>:8001/mcp \
  --header "Authorization: Bearer <your API_TOKEN>"
```

## Accessing the web UI through Tailscale

Install Tailscale on the host running Docker (not inside the containers);
because ports are published on `0.0.0.0`, they become reachable at your
Tailscale IP / MagicDNS name automatically, with no port forwarding and no
public exposure. Full instructions, including how to restrict access to
*only* the tailnet (never LAN), are in [`docs/TAILSCALE.md`](docs/TAILSCALE.md).

## Connecting ChatGPT via OpenAI Secure MCP Tunnel

To let ChatGPT/Codex/the Responses API reach this project's MCP server
with no inbound port opened on your network, an opt-in `openai-tunnel`
service (using [`openai/tunnel-client`](https://github.com/openai/tunnel-client))
is included in `docker-compose.yml`. See the
["Connecting ChatGPT via OpenAI Secure MCP Tunnel" section of `docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#connecting-chatgpt-via-openai-secure-mcp-tunnel-optional)
for setup.

## Backing up the database

```bash
./scripts/backup.sh                 # writes backups/todo-app-<timestamp>.sql.gz
RETAIN_DAYS=30 ./scripts/backup.sh  # keep 30 days instead of the default 14
```

Restore:

```bash
./scripts/restore.sh backups/todo-app-20260101-030000.sql.gz
```

Put `backup.sh` in cron for automatic daily backups:

```cron
0 3 * * * cd /path/to/todo-app && ./scripts/backup.sh >> backups/backup.log 2>&1
```

## Updating the application later

```bash
cd todo-app
git pull
docker compose pull            # grab the latest prebuilt images from Docker Hub
docker compose up -d           # restarts only the services that changed
```

(`docker compose up -d --build` also still works if you're running a fork
without CI publishing images, or have local changes to build.)

Your data isn't touched — it lives in the `postgres_data` named volume,
independent of the containers/images. Back up first if you're doing a
major version jump (`./scripts/backup.sh`).

### Why this doesn't lose data or log you out

- **Database**: Postgres data lives in the `postgres_data` named volume.
  `up -d` / `up -d --build` only replace images and recreate containers —
  volumes are untouched. (Don't run `docker compose down -v`; the `-v`
  flag deletes volumes.)
- **Schema changes are additive-only**: startup runs
  `SQLModel.metadata.create_all()`, which adds new tables/columns and
  never drops or rewrites existing ones (see "V1 scope" above).
- **Your login survives**: the admin account is only seeded if no user
  exists yet (`app/services/auth.py`), so an existing account is never
  reset or overwritten by a restart. `SESSION_SECRET` stays in `.env`
  across updates too, so your browser session isn't invalidated.
- **Downtime is brief and scoped**: `docker compose up -d` only recreates
  the containers whose image/config actually changed — e.g. an update
  that only touches the frontend won't restart `backend`, `mcp`, or `db`.
  Expect a few seconds of downtime per affected service, not a full outage.

## Authentication model

- **`API_TOKEN`** (long random string): a single Bearer token for the MCP
  server and any programmatic REST API access. Not tied to a specific
  user — this is a personal, single-user system.
- **Username/password** (`ADMIN_USERNAME`/`ADMIN_PASSWORD` in `.env`, only
  used to seed the one web-UI account on first boot): the web UI logs in
  with these and gets a signed, `HttpOnly` session cookie. Passwords are
  bcrypt-hashed in the database; the plaintext from `.env` is never stored.
- No public auth provider, no external dependency — this is designed to
  sit behind Tailscale for remote access rather than expose an internet
  login page.

## Testing

```bash
cd backend && .venv/bin/pytest -q
```

58 tests cover task CRUD, every recurrence pattern, priority-score
ordering (including that manual priority is never overwritten),
today-view assembly (including recurring-task materialization and dedup
across sections), and MCP tool execution end-to-end against an in-memory
database.

## V1 scope

Implemented: persistent tasks, recurring tasks, Today view, deadlines,
computed (never-overwriting) priority scoring, web UI, REST API, 19 MCP
tools + 3 MCP resources, Docker deployment, token + session auth, backups.

Deliberately deferred to keep V1 focused (see `integrations/` note below):
Gmail/Calendar/GitHub/Slack/Discord connectors, natural-language parsing
via an LLM (the quick-add bar uses a small local regex parser instead —
no AI API required for the app to work), and a full migration framework
(schema changes currently use SQLModel's `create_all`, additive-only).

## Future integrations

The service layer (`backend/app/services/`) is the seam for future
connectors: an integration would call the same `services.tasks.*`
functions the MCP tools and REST routes already use, rather than writing
to the database directly. No integration code exists yet in V1 — this is
left as a clean extension point.
