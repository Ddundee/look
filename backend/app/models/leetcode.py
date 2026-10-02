import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import Column, JSON
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

    id: str = Field(default_factory=_uuid, primary_key=True)
    problem_id: str = Field(foreign_key="leetcode_problems.id", index=True)
    # Local wall-clock time in APP_TIMEZONE (like events), so its date is
    # the calendar day it counts toward for streaks and goals.
    attempted_at: datetime = Field(index=True)
    solved: bool = True
    solved_independently: bool = False
    hint_used: bool = False
    duration_minutes: Optional[int] = None
    language: Optional[str] = None
    confidence: Optional[int] = None  # 1 very weak .. 5 very strong
    notes: Optional[str] = None
    # "mcp" when logged through an AI client, "manual" from the web UI.
    source: str = Field(default="manual")
    created_at: datetime = Field(default_factory=utcnow)


class LeetCodeGoals(SQLModel, table=True):
    """Single-row settings for the daily/weekly targets. Absent until the
    user changes them; the service falls back to defaults."""

    __tablename__ = "leetcode_goals"

    id: int = Field(default=1, primary_key=True)
    daily_target: int = 2
    weekly_target: int = 10
    updated_at: datetime = Field(default_factory=utcnow)
