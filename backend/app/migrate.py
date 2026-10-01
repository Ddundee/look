"""Bring the database schema to the latest Alembic revision.

Run before the app serves traffic: `python -m app.migrate`. The Docker setup
runs it ahead of both the REST API and the MCP server; it exits non-zero on
any problem so a container never starts against a half-migrated or
unrecognized schema. See docs/DATABASE.md.

Three kinds of database are handled:

* Managed (has an `alembic_version` table): `upgrade head`.
* Empty: `upgrade head` builds everything from the baseline.
* Pre-Alembic Look database (tables created by the old create_all() at
  startup): each existing table is checked against the baseline's columns
  first. If anything doesn't match, nothing is touched and the error lists
  what's wrong. Otherwise `upgrade head` runs; the baseline only creates
  tables that are missing, so existing tables and their rows stay as-is.

On PostgreSQL the whole upgrade runs in one transaction (a failure leaves
the schema as it was) under an advisory lock, so the API and MCP containers
starting together don't both try to migrate.
"""

import logging
import sys
from argparse import Namespace
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Set

import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.engine import Connection, Engine

BACKEND_DIR = Path(__file__).resolve().parent.parent
BASELINE_REVISION = "0001_baseline"
# Arbitrary but fixed: identifies "Look is migrating" among advisory locks.
ADVISORY_LOCK_KEY = 4_250_172_043

logger = logging.getLogger("todo_app.migrate")


class MigrationError(RuntimeError):
    pass


def alembic_config(connection: Optional[Connection] = None, x_args: Optional[Dict[str, str]] = None) -> Config:
    cfg = Config(
        str(BACKEND_DIR / "alembic.ini"),
        cmd_opts=Namespace(x=[f"{key}={value}" for key, value in (x_args or {}).items()]),
    )
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.attributes["configure_logger"] = False
    if connection is not None:
        cfg.attributes["connection"] = connection
    return cfg


def head_revision() -> str:
    return ScriptDirectory.from_config(alembic_config()).get_current_head()


def current_revision(connection: Connection) -> Optional[str]:
    return MigrationContext.configure(connection).get_current_revision()


def database_revision(engine: Engine) -> Optional[str]:
    with engine.connect() as conn:
        return current_revision(conn)


@lru_cache(maxsize=1)
def baseline_schema() -> Dict[str, Set[str]]:
    """Tables and columns the baseline revision creates, read back from a
    scratch in-memory database, so the migration itself is the source of
    truth rather than a hand-kept list."""
    scratch = sa.create_engine("sqlite://")
    with scratch.begin() as conn:
        command.upgrade(alembic_config(conn), BASELINE_REVISION)
        insp = sa.inspect(conn)
        return {
            table: {col["name"] for col in insp.get_columns(table)}
            for table in insp.get_table_names()
            if table != "alembic_version"
        }


def _legacy_problems(conn: Connection) -> List[str]:
    insp = sa.inspect(conn)
    problems = []
    for table, expected in sorted(baseline_schema().items()):
        if not insp.has_table(table):
            continue  # an older install; the baseline will create it
        found = {col["name"]: col for col in insp.get_columns(table)}
        missing = sorted(expected - found.keys())
        if missing:
            problems.append(f"{table}: missing column(s) {', '.join(missing)}")
        blocking = sorted(
            name
            for name, col in found.items()
            if name not in expected and not col["nullable"] and col.get("default") is None
        )
        if blocking:
            problems.append(f"{table}: extra required column(s) {', '.join(blocking)} that the app never fills in")
    return problems


def _upgrade(conn: Connection) -> None:
    if current_revision(conn) is None:
        existing = set(sa.inspect(conn).get_table_names()) & baseline_schema().keys()
        if existing:
            problems = _legacy_problems(conn)
            if problems:
                raise MigrationError(
                    "This database was created before Look used migrations and doesn't match the "
                    "baseline schema, so nothing was changed:\n  - "
                    + "\n  - ".join(problems)
                    + "\nBack it up, then see docs/DATABASE.md (Troubleshooting)."
                )
            logger.info("Adopting a pre-migration database; its %d existing table(s) are kept as-is", len(existing))
        else:
            logger.info("Empty database: creating the schema")
    command.upgrade(alembic_config(conn), "head")


def migrate(engine: Engine) -> str:
    """Upgrade the database behind `engine` to head and return its revision."""
    use_lock = engine.dialect.name == "postgresql"
    with engine.connect() as lock_conn:
        if use_lock:
            lock_conn.execute(sa.text("SELECT pg_advisory_lock(:key)"), {"key": ADVISORY_LOCK_KEY})
            lock_conn.commit()
        try:
            with engine.begin() as conn:
                _upgrade(conn)
                return current_revision(conn)
        finally:
            if use_lock:
                lock_conn.execute(sa.text("SELECT pg_advisory_unlock(:key)"), {"key": ADVISORY_LOCK_KEY})
                lock_conn.commit()


def assert_at_head(engine: Engine) -> str:
    """Refuse to run against a database this code version wasn't built for."""
    current = database_revision(engine)
    head = head_revision()
    if current != head:
        raise MigrationError(
            f"Database schema is at {current or 'no migration revision'}, but this version of Look "
            f"needs {head}. Run `python -m app.migrate` first (the Docker setup does this automatically "
            "before starting)."
        )
    return current


def check_drift(engine: Engine) -> None:
    """Raise if the models and the migrations disagree (`alembic check`)."""
    with engine.connect() as conn:
        command.check(alembic_config(conn))


def downgrade(engine: Engine, revision: str, allow_data_loss: bool = False) -> None:
    with engine.begin() as conn:
        command.downgrade(alembic_config(conn, {"allow-data-loss": "true"} if allow_data_loss else None), revision)


def main() -> int:
    from app.db import engine
    from app.logging_config import configure_logging

    configure_logging()
    try:
        revision = migrate(engine)
    except Exception as exc:  # any failure must stop the container from starting
        logger.error("Database migration failed; not starting. %s", exc)
        return 1
    logger.info("Database schema is at revision %s", revision)
    return 0


if __name__ == "__main__":
    sys.exit(main())
