import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import Column, JSON, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.utils import utcnow

# Presentation is chosen from fixed sets, never stored as CSS. The frontend
# maps each key to theme-aware colors and treatments (lib/palette.ts).
COLORS = (
    "red", "orange", "amber", "yellow", "lime", "green", "teal",
    "cyan", "sky", "blue", "indigo", "violet", "pink", "slate",
)
STYLES = ("solid", "soft", "outline", "striped", "glass")


def _uuid() -> str:
    return str(uuid.uuid4())


class Category(SQLModel, table=True):
    """What kind of thing a task or event is (Personal, School, Research…).
    Tasks and events keep storing the category as a plain string; that
    string is this row's `key`, so categories can be renamed and restyled
    without touching them. System categories are the ones Look ships with."""

    __tablename__ = "categories"

    id: str = Field(default_factory=_uuid, primary_key=True)
    key: str = Field(unique=True)
    name: str
    color: str = "slate"
    style: str = "soft"  # the quiet, safe default
    is_system: bool = False
    archived: bool = False
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Course(SQLModel, table=True):
    """A class you take (CS 3214). Imported assignments and class meetings
    link to it, and share its color and style. Separate from categories:
    a course says which class, a category says what kind of thing."""

    __tablename__ = "courses"

    id: str = Field(default_factory=_uuid, primary_key=True)
    code: str  # as displayed: "CS 3214"
    # Normalized code ("CS3214") for matching; aliases are normalized too.
    code_key: str = Field(unique=True)
    name: Optional[str] = None  # "Computer Systems"
    color: str = "blue"
    style: str = "soft"
    aliases: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    archived: bool = False
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class CourseLink(SQLModel, table=True):
    """A remembered external identity of a course, e.g. the Canvas context
    "canvas.vt.edu/course_123". Learned automatically from Canvas feeds and
    from manual corrections, so later items from the same Canvas course map
    without asking again."""

    __tablename__ = "course_links"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_course_links_source_external"),)

    id: str = Field(default_factory=_uuid, primary_key=True)
    course_id: str = Field(foreign_key="courses.id", index=True)
    source: str  # "canvas"
    external_id: str
    created_at: datetime = Field(default_factory=utcnow)
