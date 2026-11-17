from datetime import date, datetime
from typing import List, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from app.utils import utcnow


class DailyChallenge(SQLModel, table=True):
    """The day's optional "Break the default" challenge
    (app.services.daily). One row per local day, so refreshing or opening
    Look on another device shows the same challenge. `challenge_key` names
    an entry in the curated pool in code; `shown` is every key offered that
    day, so "Give me another" doesn't come back to one already skipped.
    Not doing it never counts against the day."""

    __tablename__ = "daily_challenges"

    day: date = Field(primary_key=True)
    challenge_key: str
    shown: List[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    completed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
