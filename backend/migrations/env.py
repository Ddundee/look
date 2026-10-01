"""Alembic environment wired to Look's own settings and models.

* Database URL: app.config.Settings.database_url, the same env vars the app
  uses, unless a caller passes an open connection in
  config.attributes["connection"] (app.migrate and the tests do this).
* Target metadata: SQLModel.metadata with every model registered by
  importing app.models.
* include_object keeps autogenerate (and `alembic check`) away from
  database objects the models don't know about, so nothing is ever dropped
  just because it isn't in the models. Removing a table or column must be a
  deliberate, hand-written migration.
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool
from sqlmodel import SQLModel

import app.models  # noqa: F401  (registers every table on SQLModel.metadata)
from app.config import get_settings

config = context.config

if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = SQLModel.metadata


def include_object(obj, name, type_, reflected, compare_to):
    # A reflected object with nothing to compare against exists only in the
    # database. Example: `recruiting_details` (and its index/enum), left
    # behind with real rows when recruiting tracking was removed. Leave it.
    if reflected and compare_to is None:
        return False
    return True


def _configure(**kwargs) -> None:
    context.configure(
        target_metadata=target_metadata,
        include_object=include_object,
        compare_type=True,
        **kwargs,
    )


def run_migrations_offline() -> None:
    _configure(
        url=get_settings().database_url,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def _run_with(connection) -> None:
    # SQLite can't ALTER most things in place; batch mode copies the table.
    _configure(connection=connection, render_as_batch=connection.dialect.name == "sqlite")
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        _run_with(connection)
        return
    engine = create_engine(get_settings().database_url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        _run_with(connection)
        connection.commit()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
