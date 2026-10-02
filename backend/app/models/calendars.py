import uuid
from datetime import datetime
from typing import Dict, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from app.models.enums import CalendarSourceType
from app.utils import utcnow


def _uuid() -> str:
    return str(uuid.uuid4())


class CalendarSubscription(SQLModel, table=True):
    """An external ICS calendar whose events are mirrored into Look's own
    events (app.services.calendar_sync). A `url` source is re-fetched on its
    interval, so events published later show up on their own; a `file`
    source is a snapshot that only changes when re-uploaded."""

    __tablename__ = "calendar_subscriptions"

    id: str = Field(default_factory=_uuid, primary_key=True)
    name: str
    source_type: CalendarSourceType
    # The feed URL for `url` sources (one subscription per URL). For `file`
    # sources it's null.
    source_url: Optional[str] = Field(default=None, unique=True)
    enabled: bool = True
    sync_interval_minutes: int = 30
    last_sync_at: Optional[datetime] = None  # last attempt (UTC)
    last_success_at: Optional[datetime] = None  # last fetch+parse that worked (UTC)
    last_error: Optional[str] = None
    # HTTP validators from the last 200 response. They only let the server
    # answer 304 Not Modified; every sync still makes a request.
    etag: Optional[str] = None
    last_modified: Optional[str] = None
    # Counts from the last successful sync: created/updated/unchanged/removed.
    last_result: Optional[Dict[str, int]] = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
