import uuid
from datetime import datetime
from typing import Any, Dict

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from app.utils import utcnow


def _uuid() -> str:
    return str(uuid.uuid4())


class Block(SQLModel, table=True):
    """A block you made: a smart list (tasks and events matching filters)
    or a note. Blocks live in a shared library; views place them by id
    (a `block` widget), so editing a block updates every view showing it.
    See app.services.blocks. `config` is always validated against the
    kind's model before it's saved."""

    __tablename__ = "blocks"

    id: str = Field(default_factory=_uuid, primary_key=True)
    name: str
    icon: str = "list"  # from app.services.views.ICONS
    color: str = "blue"  # from app.models.planning.COLORS
    kind: str  # "smart_list" | "note"
    config: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
