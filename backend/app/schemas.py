from datetime import date, datetime, time
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import MealType, RecurrencePattern, TaskPriority, TaskStatus


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    status: TaskStatus = TaskStatus.inbox
    priority: TaskPriority = TaskPriority.medium
    category: str = "personal"
    tags: List[str] = Field(default_factory=list)
    due_date: Optional[date] = None
    due_time: Optional[time] = None
    estimated_duration: Optional[int] = None
    source: str = "manual"
    external_reference: Optional[str] = None
    notes: Optional[str] = None
    planned_for_date: Optional[date] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TaskStatus] = None
    priority: Optional[TaskPriority] = None
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    due_date: Optional[date] = None
    due_time: Optional[time] = None
    estimated_duration: Optional[int] = None
    external_reference: Optional[str] = None
    notes: Optional[str] = None
    planned_for_date: Optional[date] = None


class TaskRead(BaseModel):
    id: str
    title: str
    description: Optional[str]
    status: TaskStatus
    priority: TaskPriority
    category: str
    tags: List[str]
    created_at: datetime
    updated_at: datetime
    due_date: Optional[date]
    due_time: Optional[time]
    completed_at: Optional[datetime]
    estimated_duration: Optional[int]
    source: str
    external_reference: Optional[str]
    notes: Optional[str]
    planned_for_date: Optional[date]
    recurrence_rule_id: Optional[str]
    occurrence_date: Optional[date]

    is_overdue: bool = False
    priority_score: float = 0.0
    priority_reasons: List[str] = Field(default_factory=list)


class TaskListResponse(BaseModel):
    tasks: List[TaskRead]
    count: int


# ---------------------------------------------------------------------------
# Recurrence
# ---------------------------------------------------------------------------


class RecurringTaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    category: str = "personal"
    priority: TaskPriority = TaskPriority.medium
    estimated_duration: Optional[int] = None
    tags: List[str] = Field(default_factory=list)

    pattern: RecurrencePattern
    days_of_week: Optional[List[int]] = None
    interval_days: Optional[int] = None
    day_of_month: Optional[int] = None

    start_date: date
    end_date: Optional[date] = None


class RecurrenceRuleRead(BaseModel):
    id: str
    title: str
    description: Optional[str]
    category: str
    priority: TaskPriority
    estimated_duration: Optional[int]
    tags: List[str]
    pattern: RecurrencePattern
    days_of_week: Optional[List[int]]
    interval_days: Optional[int]
    day_of_month: Optional[int]
    start_date: date
    end_date: Optional[date]
    active: bool
    created_at: datetime


# ---------------------------------------------------------------------------
# Composite views
# ---------------------------------------------------------------------------


class TodayView(BaseModel):
    date: date
    scheduled: List[TaskRead]
    due_today: List[TaskRead]
    overdue: List[TaskRead]
    recurring_today: List[TaskRead]
    suggested_high_priority: List[TaskRead]


class WeekSummary(BaseModel):
    start_date: date
    end_date: date
    completed_count: int
    completed_by_category: dict
    created_count: int
    overdue_count: int
    completed_tasks: List[TaskRead]


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


class LoginRequest(BaseModel):
    username: str
    password: str


# ---------------------------------------------------------------------------
# Nutrition
# ---------------------------------------------------------------------------


def _clean_name(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    if not value:
        raise ValueError("name can't be blank")
    return value


class FoodEntryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    calories: float = Field(ge=0)
    quantity: Optional[str] = Field(default=None, max_length=100)
    protein_g: float = Field(default=0, ge=0)
    carbs_g: float = Field(default=0, ge=0)
    fat_g: float = Field(default=0, ge=0)
    meal: Optional[MealType] = None
    eaten_on: Optional[date] = None  # defaults to today in APP_TIMEZONE
    eaten_at: Optional[time] = None
    notes: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: Optional[str]) -> Optional[str]:
        return _clean_name(v)


class FoodEntryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    calories: Optional[float] = Field(default=None, ge=0)
    quantity: Optional[str] = Field(default=None, max_length=100)
    protein_g: Optional[float] = Field(default=None, ge=0)
    carbs_g: Optional[float] = Field(default=None, ge=0)
    fat_g: Optional[float] = Field(default=None, ge=0)
    meal: Optional[MealType] = None
    eaten_on: Optional[date] = None
    eaten_at: Optional[time] = None
    notes: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: Optional[str]) -> Optional[str]:
        return _clean_name(v)


class FoodEntryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    quantity: Optional[str]
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    meal: Optional[MealType]
    eaten_on: date
    eaten_at: Optional[time]
    notes: Optional[str]
    source: str
    created_at: datetime
    updated_at: datetime


class MacroTotals(BaseModel):
    calories: float = 0
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0


class MacroRemaining(BaseModel):
    """Target minus eaten; negative means over. None when that macro has
    no target."""

    calories: float
    protein_g: Optional[float] = None
    carbs_g: Optional[float] = None
    fat_g: Optional[float] = None


class NutritionTargetsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    calories: float
    protein_g: Optional[float]
    carbs_g: Optional[float]
    fat_g: Optional[float]
    effective_from: date


class NutritionTargetsSet(BaseModel):
    calories: float = Field(gt=0)
    protein_g: Optional[float] = Field(default=None, ge=0)
    carbs_g: Optional[float] = Field(default=None, ge=0)
    fat_g: Optional[float] = Field(default=None, ge=0)
    effective_from: Optional[date] = None  # defaults to today


class DaySummary(BaseModel):
    day: date
    entries: List[FoodEntryRead]
    totals: MacroTotals
    targets: Optional[NutritionTargetsRead]
    remaining: Optional[MacroRemaining]
    over: List[str]  # macro keys eaten past their target


class HistoryDay(BaseModel):
    day: date
    entry_count: int
    totals: MacroTotals
    targets: Optional[NutritionTargetsRead]


class HistorySummary(BaseModel):
    start_date: date
    end_date: date
    days: List[HistoryDay]
    logged_days: int
    averages: Optional[MacroTotals]  # over days with at least one entry


class TargetsResponse(BaseModel):
    current: Optional[NutritionTargetsRead]
    history: List[NutritionTargetsRead]  # newest first


class FoodEntryWithDay(BaseModel):
    entry: FoodEntryRead
    day: DaySummary


class FoodDeleteResult(BaseModel):
    deleted_id: str
    day: DaySummary


class FoodEntryList(BaseModel):
    entries: List[FoodEntryRead]
    count: int
