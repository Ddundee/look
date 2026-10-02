# Look

Look is a self-hosted personal dashboard for keeping track of the things I use every day: tasks, schedule, nutrition, and LeetCode practice.

It runs on my own hardware and can be used from the web or through MCP clients like ChatGPT, Claude, and Cursor.

## What it does

- **Tasks** — create, edit, complete, prioritize, and schedule tasks
- **Today** — see what is planned, due, or overdue in one place
- **Calendar** — manage one-time and recurring events
- **Nutrition** — log food and track daily calorie and macro targets
- **LeetCode** — log attempts, track streaks, goals, difficulty, topics, and confidence
- **MCP** — let compatible AI clients read and update the same data
- **Self-hosted** — runs locally with Docker and PostgreSQL

Look is meant to be a simple personal system rather than a general-purpose productivity platform.

## Quick start

The easiest way to run Look is with Docker Compose.

```bash
git clone https://github.com/Ddundee/look.git
cd look
cp .env.example .env
```

Edit `.env` and set the required secrets and login information, then start the app:

```bash
docker compose up -d --build
```

Once it is running:

- Web app: `http://localhost:3000`
- API docs: `http://localhost:8000/docs`
- MCP server: `http://localhost:8001/mcp`

For Raspberry Pi and remote-access setup, see [Deployment](docs/DEPLOYMENT.md) and [Tailscale](docs/TAILSCALE.md).

## Local development

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt

export DB_ENGINE=sqlite
export SQLITE_PATH=./data/dev.db
export API_TOKEN=dev-token
export SESSION_SECRET=dev-secret-change-me
export ADMIN_USERNAME=admin
export ADMIN_PASSWORD=admin

python -m app.migrate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Run backend tests with:

```bash
pytest -q
```

### Frontend

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Then open `http://localhost:3000`.

## MCP

Look exposes an MCP server so supported AI clients can work with the same tasks, events, nutrition logs, and LeetCode data as the web app.

The MCP endpoint is:

```text
http://<host>:8001/mcp
```

It uses the `API_TOKEN` from `.env` for authentication.

See [MCP setup](docs/MCP.md) for connection examples and the available tools.

## Updates and backups

Look uses database migrations so updates can change the schema without recreating the database.

To update a deployment:

```bash
./scripts/upgrade.sh
```

This backs up the database, applies migrations, restarts the app, and checks that the backend comes back healthy.

To make a backup manually:

```bash
./scripts/backup.sh
```

Database migration and restore details are in [Database and upgrades](docs/DATABASE.md).

## Project structure

```text
backend/        FastAPI backend, models, services, migrations, and MCP server
frontend/       Next.js web app
scripts/        backup, restore, and upgrade helpers
docs/           setup and feature documentation
docker-compose.yml
```

The web app and MCP server use the same backend logic and PostgreSQL database, so changes made through either interface stay in sync.

## Docs

- [Deployment](docs/DEPLOYMENT.md)
- [Database and upgrades](docs/DATABASE.md)
- [MCP setup](docs/MCP.md)
- [LeetCode tracking](docs/LEETCODE.md)
- [Task model](docs/TASK_MODEL.md)
- [Tailscale](docs/TAILSCALE.md)

## Stack

Look is built with:

- Next.js
- FastAPI
- SQLModel / SQLAlchemy
- PostgreSQL
- Alembic
- Docker Compose
- MCP
