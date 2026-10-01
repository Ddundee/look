#!/usr/bin/env bash
# Safely upgrade a running Look stack to the latest images:
#
#   validate config -> back up Postgres -> pull images -> apply migrations
#   (in a one-off container, before anything restarts) -> restart -> health check
#
# Stops at the first failure. Nothing is restarted unless the backup and the
# migrations both succeeded. Run from anywhere; it works in the repo root.
#
# Usage:
#   ./scripts/upgrade.sh            # pull published images from ghcr.io
#   ./scripts/upgrade.sh --build    # build images from this checkout instead
#
# See docs/DATABASE.md for restore steps and troubleshooting.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MODE="pull"
case "${1:-}" in
  "") ;;
  --build) MODE="build" ;;
  *) echo "usage: $0 [--build]" >&2; exit 2 ;;
esac

step() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# ---- 1. Validate config ----------------------------------------------------
step "1/6 Checking configuration"
[ -f .env ] || die ".env not found in $REPO_ROOT (copy .env.example and fill it in)"
docker compose config --quiet || die "docker-compose.yml or .env is invalid (see the error above)"

set -a
# shellcheck disable=SC1091
source .env
set +a
for var in API_TOKEN SESSION_SECRET POSTGRES_PASSWORD; do
  [ -n "${!var:-}" ] || die "$var is empty in .env"
done

PROJECT="$(docker compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')"
VOLUME="${PROJECT}_postgres_data"
if docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  echo "Database volume: $VOLUME"
else
  # A missing volume usually means the compose project name changed and
  # Docker would start an empty database. Don't guess.
  others="$(docker volume ls --format '{{.Name}}' | grep '_postgres_data$' || true)"
  if [ -n "$others" ]; then
    die "volume $VOLUME doesn't exist, but these do: $others
Your data is probably in one of them. Set COMPOSE_PROJECT_NAME in .env to its prefix and re-run."
  fi
  echo "No existing database volume: treating this as a fresh install."
fi

# ---- 2. Make sure the database is up, then back it up -----------------------
step "2/6 Backing up the database"
docker compose up -d --wait db
./scripts/backup.sh

# ---- 3. Get the new images --------------------------------------------------
if [ "$MODE" = "build" ]; then
  step "3/6 Building images from this checkout"
  docker compose build backend mcp frontend updater
else
  step "3/6 Pulling images"
  docker compose pull backend mcp frontend updater
fi

# ---- 4. Migrate before anything restarts ------------------------------------
step "4/6 Applying database migrations"
docker compose run --rm --no-deps backend python -m app.migrate \
  || die "migrations failed; nothing was restarted. Your backup is in backups/ (see docs/DATABASE.md to restore)."

# ---- 5. Restart -------------------------------------------------------------
step "5/6 Restarting the app"
docker compose up -d
if docker ps --format '{{.Names}}' | grep -q "^${PROJECT}-openai-tunnel-"; then
  docker compose --profile openai-tunnel up -d
fi

# ---- 6. Health check --------------------------------------------------------
step "6/6 Waiting for the backend to report healthy"
PORT="${BACKEND_PORT:-8000}"
for _ in $(seq 1 60); do
  if body="$(curl -fsS "http://localhost:${PORT}/health" 2>/dev/null)"; then
    echo "Backend healthy: $body"
    docker compose ps
    echo
    echo "Upgrade complete."
    exit 0
  fi
  sleep 2
done
docker compose ps
die "backend didn't become healthy within 2 minutes; check: docker compose logs backend"
