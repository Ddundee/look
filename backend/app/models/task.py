import uuid
from datetime import date, datetime, time
from typing import List, Optional

from sqlalchemy import Column, Index, JSON, String
from sqlmodel import Field, Relationship, SQLModel

from app.models.enums import RecurrencePattern, TaskPriority, TaskStatus
from app.utils import utcnow


def _uuid() -> str:
    return str(uuid.uuid4())


class RecurrenceRule(SQLModel, table=True):
    """
    A template describing how to generate recurring task instances.

    Each concrete occurrence is materialized as its own `Task` row (linked
    back via `recurrence_rule_id` + `occurrence_date`) so completing or
    editing one occurrence never touches history for other days.
    """

    __tablename__ = "recurrence_rules"

    id: str = Field(default_factory=_uuid, primary_key=True)

    # Template fields copied onto every generated Task occurrence.
    title: str
    description: Optional[str] = None
    category: str = "personal"
    priority: TaskPriority = Field(default=TaskPriority.medium)
    estimated_duration: Optional[int] = None  # minutes
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))

    pattern: RecurrencePattern
    # For `specific_days` / `weekly`: ISO weekday ints, 0=Monday .. 6=Sunday
    days_of_week: Optional[List[int]] = Field(default=None, sa_column=Column(JSON))
    # For `custom_interval`: repeat every N days
    interval_days: Optional[int] = None
    # For `monthly`: day-of-month to generate on (1-28 recommended)
    day_of_month: Optional[int] = None

    start_date: date
    end_date: Optional[date] = None
    active: bool = True

    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    occurrences: List["Task"] = Relationship(back_populates="recurrence_rule")


class Task(SQLModel, table=True):
    __tablename__ = "tasks"
    # One occurrence per rule per day, enforced by the database: several
    # requests materialize today's occurrences at once (migration 0011).
    # Tasks without a rule (NULLs) are unaffected.
    __table_args__ = (
        Index("uq_tasks_rule_occurrence", "recurrence_rule_id", "occurrence_date", unique=True),
    )

    id: str = Field(default_factory=_uuid, primary_key=True)

    title: str
    description: Optional[str] = None

    status: TaskStatus = Field(default=TaskStatus.inbox, index=True)
    priority: TaskPriority = Field(default=TaskPriority.medium, index=True)

    # Free-form so new categories can be introduced without a migration.
    category: str = Field(default="personal", index=True)
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))

    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    due_date: Optional[date] = Field(default=None, index=True)
    due_time: Optional[time] = None
    completed_at: Optional[datetime] = None

    estimated_duration: Optional[int] = None  # minutes

    # Where the task came from: "manual", "quick_add", "recurring",
    # "mcp", "api", or a future integration name ("gmail", "github", ...).
    source: str = Field(default="manual")
    external_reference: Optional[str] = Field(default=None, sa_column=Column(String))

    notes: Optional[str] = None

    # Explicitly selected for today's plan, independent of due_date. Lets a
    # task with no deadline (or a deadline next week) show up on "Today"
    # because the user chose to work on it today, without mutating due_date.
    planned_for_date: Optional[date] = Field(default=None, index=True)

    # Recurrence linkage. `occurrence_date` is the calendar day this specific
    # instance was generated for; the pair (recurrence_rule_id, occurrence_date)
    # is unique so re-running generation is idempotent.
    recurrence_rule_id: Optional[str] = Field(
        default=None, foreign_key="recurrence_rules.id", index=True
    )
    occurrence_date: Optional[date] = Field(default=None, index=True)

    recurrence_rule: Optional[RecurrenceRule] = Relationship(back_populates="occurrences")
