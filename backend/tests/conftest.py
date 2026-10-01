import os
import shutil

os.environ.setdefault("DB_ENGINE", "sqlite")
os.environ.setdefault("SQLITE_PATH", "/tmp/todo_app_test_unused.db")
os.environ.setdefault("API_TOKEN", "test-token")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-value-needs-32-bytes")
os.environ.setdefault("ADMIN_USERNAME", "admin")
os.environ.setdefault("ADMIN_PASSWORD", "admin-password")
# Fixed explicitly (rather than relying on the config default) so tests
# using `local_today()` are deterministic regardless of the machine's
# system timezone.
os.environ.setdefault("APP_TIMEZONE", "UTC")

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, create_engine

import app.models  # noqa: F401  (register table metadata)
from app import db as db_module
from app.migrate import migrate


@pytest.fixture(scope="session")
def migrated_template(tmp_path_factory):
    """One SQLite database built through the real migrations (exactly how a
    fresh install gets its schema), copied for every test."""
    path = tmp_path_factory.mktemp("schema") / "template.db"
    eng = create_engine(f"sqlite:///{path}")
    migrate(eng)
    eng.dispose()
    return path


@pytest.fixture()
def engine(migrated_template, tmp_path):
    path = tmp_path / "test.db"
    shutil.copyfile(migrated_template, path)
    eng = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    yield eng
    eng.dispose()


@pytest.fixture()
def session(engine):
    with Session(engine) as s:
        yield s


@pytest.fixture()
def use_test_db(engine, monkeypatch):
    """Point the shared app.db.engine at an isolated in-memory database for
    the duration of one test. Anything that looks up `db.engine` at call
    time (routers, MCP tools) picks this up automatically."""
    monkeypatch.setattr(db_module, "engine", engine)
    return engine


@pytest.fixture()
def client(use_test_db):
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def auth_headers():
    return {"Authorization": "Bearer test-token"}
