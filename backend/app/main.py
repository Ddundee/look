import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlmodel import Session

from app import db
from app import migrate as migrations
from app.config import get_settings
from app.logging_config import configure_logging
from app.routers import auth, events, leetcode, nutrition, recurring, system, tasks, today
from app.seed import seed_demo_data
from app.services.auth import ensure_admin_user

configure_logging()
logger = logging.getLogger("todo_app")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    logger.info("Starting up (db_engine=%s)", settings.db_engine)
    # Migrations run before the app starts (python -m app.migrate); refuse
    # to serve against a schema this code version wasn't built for.
    revision = migrations.assert_at_head(db.engine)
    logger.info("Database schema at revision %s", revision)
    with Session(db.engine) as session:
        ensure_admin_user(session)
        if settings.seed_demo_data:
            seed_demo_data(session)
    logger.info("Startup complete")
    yield


app = FastAPI(
    title="Personal Task Manager API",
    description=(
        "Self-hosted personal task management API. Backs both the web UI "
        "and the MCP server from a single PostgreSQL/SQLite database."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# No CORS middleware: the bundled Next.js frontend proxies /api/* to this
# service same-origin (see frontend/next.config.ts), so the browser never
# makes a cross-origin request. MCP clients and scripts use the bearer
# token and aren't subject to CORS at all.

app.include_router(auth.router)
app.include_router(tasks.router)
app.include_router(today.router)
app.include_router(recurring.router)
app.include_router(nutrition.router)
app.include_router(events.router)
app.include_router(leetcode.router)
app.include_router(system.router)


@app.get("/health")
def health():
    try:
        db_revision = migrations.database_revision(db.engine)
    except Exception:
        return JSONResponse(status_code=503, content={"status": "error", "detail": "Database unavailable"})
    return {
        "status": "ok",
        "version": get_settings().app_revision or None,
        "db_revision": db_revision,
    }
