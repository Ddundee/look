from pathlib import Path
from typing import Iterator

from sqlmodel import Session, create_engine

from app.config import get_settings

settings = get_settings()

_connect_args = {}
if settings.db_engine == "sqlite":
    Path(settings.sqlite_path).parent.mkdir(parents=True, exist_ok=True)
    _connect_args = {"check_same_thread": False}

engine = create_engine(settings.database_url, echo=False, connect_args=_connect_args)

# The schema is managed by Alembic migrations (backend/migrations), applied
# by `python -m app.migrate` before the app starts. Nothing here creates or
# alters tables. See docs/DATABASE.md.


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
