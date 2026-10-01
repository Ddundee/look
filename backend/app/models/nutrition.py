import uuid
from datetime import date, datetime, time
from typing import Optional

from sqlmodel import Field, SQLModel

from app.models.enums import MealType
from app.utils import utcnow


def _uuid() -> str:
    return str(uuid.uuid4())


class FoodEntry(SQLModel, table=True):
    """One food item eaten on a given day. The nutrition numbers are
    whatever the client supplied (usually an AI client's estimate); the
    app never looks them up itself."""

    __tablename__ = "food_entries"

    id: str = Field(default_factory=_uuid, primary_key=True)
    name: str
    quantity: Optional[str] = None
    calories: float
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0
    meal: Optional[MealType] = None
    eaten_on: date = Field(index=True)
    eaten_at: Optional[time] = None
    notes: Optional[str] = None
    # "mcp" when logged through an AI client, "manual" from the web UI.
    source: str = Field(default="manual")
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class NutritionTarget(SQLModel, table=True):
    """Daily targets, in effect from `effective_from` until the next row's
    date. Changing targets adds a row rather than editing one, so earlier
    days keep being judged against the targets that applied then."""

    __tablename__ = "nutrition_targets"

    id: str = Field(default_factory=_uuid, primary_key=True)
    calories: float
    protein_g: Optional[float] = None
    carbs_g: Optional[float] = None
    fat_g: Optional[float] = None
    effective_from: date = Field(unique=True, index=True)
    created_at: datetime = Field(default_factory=utcnow)
