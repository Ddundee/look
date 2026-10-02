import uuid
from datetime import date, datetime
from typing import List, Optional

from sqlalchemy import Column, JSON, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.utils import utcnow


def _uuid() -> str:
    return str(uuid.uuid4())


class Event(SQLModel, table=True):
    """A one-off event, or a recurring series when `rrule` is set.
    Occurrences of a series are computed on read (app.services.events),
    never stored as rows."""

    __tablename__ = "events"
    __table_args__ = (UniqueConstraint("subscription_id", "external_uid", name="uq_events_subscription_uid"),)

    id: str = Field(default_factory=_uuid, primary_key=True)
    title: str
    location: Optional[str] = None
    notes: Optional[str] = None
    category: str = Field(default="other", index=True)
    all_day: bool = False
    # Local wall-clock times in APP_TIMEZONE. For all-day events both are
    # midnight and end_at is exclusive (the day after the last day).
    start_at: datetime = Field(index=True)
    end_at: datetime
    # RFC 5545 RRULE body without DTSTART; None for one-off events.
    rrule: Optional[str] = None
    # Skipped occurrence dates as ISO strings (JSON can't hold date objects).
    exdates: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    source: str = Field(default="manual")
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    # Set only for events mirrored from a calendar subscription; manual
    # events leave all of these empty. The feed owns such events (they're
    # read-only in Look), identified by subscription + ICS UID.
    subscription_id: Optional[str] = Field(default=None, foreign_key="calendar_subscriptions.id", index=True)
    external_uid: Optional[str] = None
    external_url: Optional[str] = None
    # "cancelled" (STATUS:CANCELLED in the feed) or "removed" (no longer in
    # the feed); null while it's live. Removed events are kept, not deleted.
    external_status: Optional[str] = None
    # Hash of the imported fields: same hash on the next sync = unchanged.
    external_hash: Optional[str] = None
    last_synced_at: Optional[datetime] = None


class EventOverride(SQLModel, table=True):
    """One changed or cancelled date of a recurring series. Null fields
    inherit from the series."""

    __tablename__ = "event_overrides"
    __table_args__ = (UniqueConstraint("event_id", "original_date"),)

    id: str = Field(default_factory=_uuid, primary_key=True)
    event_id: str = Field(foreign_key="events.id", index=True)
    original_date: date
    cancelled: bool = False
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    title: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
