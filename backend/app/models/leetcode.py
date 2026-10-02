import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import Column, JSON, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.enums import LeetCodeDifficulty
from app.utils import utcnow


def _uuid() -> str:
    return str(uuid.uuid4())


class LeetCodeProblem(SQLModel, table=True):
    """One LeetCode problem, identified by its number. Logging the same
    problem again adds an attempt to this row instead of a new problem."""

    __tablename__ = "leetcode_problems"

    id: str = Field(default_factory=_uuid, primary_key=True)
    number: int = Field(unique=True, index=True)
    title: str
    slug: Optional[str] = None
    url: Optional[str] = None
    difficulty: LeetCodeDifficulty
    # Normalized names ("Sliding Window", "DP"), stored like Task.tags.
    topics: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class LeetCodeAttempt(SQLModel, table=True):
    """What actually happened when working a problem (solved or not). Plans
    like "do 2 LeetCodes" stay ordinary tasks; this is the record."""

    __tablename__ = "leetcode_attempts"
    # An imported submission is recorded once per source.
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_leetcode_attempts_source_external"),)

    id: str = Field(default_factory=_uuid, primary_key=True)
    problem_id: str = Field(foreign_key="leetcode_problems.id", index=True)
    # Local wall-clock time in APP_TIMEZONE (like events), so its date is
    # the calendar day it counts toward for streaks and goals.
    attempted_at: datetime = Field(index=True)
    solved: bool = True
    # None = unknown (e.g. imported from submission history, which doesn't
    # say), never a guessed False. Rates only count known values.
    solved_independently: Optional[bool] = None
    hint_used: Optional[bool] = None
    duration_minutes: Optional[int] = None
    language: Optional[str] = None
    confidence: Optional[int] = None  # 1 very weak .. 5 very strong
    notes: Optional[str] = None  # the user's own words only, never import bookkeeping
    # "manual" from the web UI, "mcp" when logged through an AI client,
    # "leetcode" when imported from LeetCode submission history.
    source: str = Field(default="manual")
    # For imports: the LeetCode submission id (its URL is derived from it).
    external_id: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)


class LeetCodeGoals(SQLModel, table=True):
    """Single-row settings for the daily/weekly targets. Absent until the
    user changes them; the service falls back to defaults."""

    __tablename__ = "leetcode_goals"

    id: int = Field(default=1, primary_key=True)
    daily_target: int = 2
    weekly_target: int = 10
    updated_at: datetime = Field(default_factory=utcnow)
