import uuid
from datetime import datetime
from typing import Any, List, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from app.utils import utcnow


def _uuid() -> str:
    return str(uuid.uuid4())


class View(SQLModel, table=True):
    """A page of widgets: a system view (Dashboard, Today) or one you made
    (School, Recruiting…). See app.services.views.

    For system views a row exists only once customized; its `layout` is the
    customization, and resetting clears it so the app's current default
    applies again (defaults live in code, so they can improve over time).
    `layout` is a list of widget instances, always validated against the
    widget registry before it's saved: fixed widget keys, sizes and config
    fields only, never component names or code."""

    __tablename__ = "views"

    id: str = Field(default_factory=_uuid, primary_key=True)
    key: str = Field(unique=True)  # "dashboard", "today", or a custom slug
    name: str
    icon: str = "squares"  # from app.services.views.ICONS
    kind: str = "custom"  # "system" | "custom"
    show_in_nav: bool = True
    sort_order: int = 0  # among custom views
    archived: bool = False
    layout: Optional[List[Any]] = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
