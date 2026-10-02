from datetime import date, datetime, time
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.enums import LeetCodeDifficulty, MealType, RecurrencePattern, TaskPriority, TaskStatus


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


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------


def _clean_title(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    if not value:
        raise ValueError("title can't be blank")
    return value


class EventCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    start_at: datetime
    end_at: Optional[datetime] = None  # all-day events default to one day
    all_day: bool = False
    location: Optional[str] = Field(default=None, max_length=200)
    category: str = Field(default="other", min_length=1, max_length=50)
    notes: Optional[str] = None
    rrule: Optional[str] = None
    exdates: List[date] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def _title(cls, v: Optional[str]) -> Optional[str]:
        return _clean_title(v)


class EventUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    all_day: Optional[bool] = None
    location: Optional[str] = Field(default=None, max_length=200)
    category: Optional[str] = Field(default=None, min_length=1, max_length=50)
    notes: Optional[str] = None
    rrule: Optional[str] = None
    exdates: Optional[List[date]] = None

    @field_validator("title")
    @classmethod
    def _title(cls, v: Optional[str]) -> Optional[str]:
        return _clean_title(v)


class OccurrenceEdit(BaseModel):
    cancel: bool = False
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    location: Optional[str] = Field(default=None, max_length=200)
    notes: Optional[str] = None

    @field_validator("title")
    @classmethod
    def _title(cls, v: Optional[str]) -> Optional[str]:
        return _clean_title(v)


class EventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    location: Optional[str]
    notes: Optional[str]
    category: str
    all_day: bool
    start_at: datetime
    end_at: datetime
    rrule: Optional[str]
    exdates: List[date]
    source: str
    created_at: datetime
    updated_at: datetime


class Occurrence(BaseModel):
    event_id: str
    occurrence_date: date  # original series date; the start date for one-offs
    start_at: datetime
    end_at: datetime
    all_day: bool
    title: str
    location: Optional[str]
    category: str
    notes: Optional[str]
    recurring: bool
    rrule: Optional[str]
    overridden: bool = False
    cancelled: bool = False


class EventWithContext(BaseModel):
    event: EventRead
    next_occurrences: List[Occurrence]
    conflicts: List[Occurrence]
    dropped_overrides: List[date] = Field(default_factory=list)


class ScheduleResponse(BaseModel):
    start_date: date
    end_date: date
    occurrences: List[Occurrence]
    count: int


class EventList(BaseModel):
    events: List[EventRead]
    count: int


# ---------------------------------------------------------------------------
# LeetCode tracking
# ---------------------------------------------------------------------------


def _clean_title(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    if not value:
        raise ValueError("title can't be blank")
    return value


class LeetCodeProblemCreate(BaseModel):
    number: int = Field(ge=1, le=100000)
    title: str = Field(min_length=1, max_length=200)
    difficulty: LeetCodeDifficulty
    topics: List[str] = Field(default_factory=list)
    slug: Optional[str] = Field(default=None, max_length=200)
    url: Optional[str] = Field(default=None, max_length=500)

    @field_validator("title")
    @classmethod
    def _strip_title(cls, v: Optional[str]) -> Optional[str]:
        return _clean_title(v)


class LeetCodeProblemUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    difficulty: Optional[LeetCodeDifficulty] = None
    topics: Optional[List[str]] = None
    slug: Optional[str] = Field(default=None, max_length=200)
    url: Optional[str] = Field(default=None, max_length=500)

    @field_validator("title")
    @classmethod
    def _strip_title(cls, v: Optional[str]) -> Optional[str]:
        return _clean_title(v)


class LeetCodeAttemptCreate(BaseModel):
    """One attempt, identified by problem number. title/difficulty are
    required only the first time a problem is logged; topics are merged
    into the problem's list."""

    problem_number: int = Field(ge=1, le=100000)
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    difficulty: Optional[LeetCodeDifficulty] = None
    topics: List[str] = Field(default_factory=list)
    solved: bool = True
    # None = derive it: solved without a hint.
    solved_independently: Optional[bool] = None
    hint_used: bool = False
    duration_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    language: Optional[str] = Field(default=None, max_length=40)
    confidence: Optional[int] = Field(default=None, ge=1, le=5)
    notes: Optional[str] = None
    attempted_at: Optional[datetime] = None  # local time; defaults to now

    @field_validator("title")
    @classmethod
    def _strip_title(cls, v: Optional[str]) -> Optional[str]:
        return _clean_title(v)

    @model_validator(mode="after")
    def _consistent(self):
        if self.solved_independently and not self.solved:
            raise ValueError("solved_independently needs solved=true")
        if self.solved_independently and self.hint_used:
            raise ValueError("an attempt that used a hint isn't solved independently")
        return self


class LeetCodeProblemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    number: int
    title: str
    slug: Optional[str]
    url: Optional[str]
    difficulty: LeetCodeDifficulty
    topics: List[str]
    created_at: datetime
    updated_at: datetime


class LeetCodeProblemSummary(LeetCodeProblemRead):
    attempts: int = 0
    solved: bool = False
    last_attempted_at: Optional[datetime] = None
    last_confidence: Optional[int] = None


class LeetCodeAttemptRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    problem_id: str
    attempted_at: datetime
    solved: bool
    solved_independently: bool
    hint_used: bool
    duration_minutes: Optional[int]
    language: Optional[str]
    confidence: Optional[int]
    notes: Optional[str]
    source: str
    created_at: datetime
    problem: LeetCodeProblemRead


class LeetCodeGoalsRead(BaseModel):
    daily_target: int
    weekly_target: int
    customized: bool  # false = built-in defaults, never changed


class LeetCodeGoalsSet(BaseModel):
    daily_target: int = Field(ge=0, le=50)
    weekly_target: int = Field(ge=0, le=300)


class DifficultyCounts(BaseModel):
    easy: int = 0
    medium: int = 0
    hard: int = 0


class LeetCodeStats(BaseModel):
    total_solved: int  # distinct problems with at least one solved attempt
    solved_by_difficulty: DifficultyCounts
    total_attempts: int
    solved_attempts: int
    avg_solve_minutes: Optional[float]  # solved attempts that recorded a duration
    hint_usage_rate: Optional[float]  # share of all attempts that used a hint
    independent_solve_rate: Optional[float]  # share of all attempts solved without help
    current_streak: int
    best_streak: int
    solved_today: int  # solved attempts today, re-solves included
    solved_this_week: int  # same, Monday to today
    week_start: date
    goals: LeetCodeGoalsRead
    insights: List[str]


class LeetCodeTopicStat(BaseModel):
    topic: str
    problems: int
    solved_problems: int
    attempts: int
    # Over this topic's most recent attempts (window in LeetCodeTopicStats).
    recent_attempts: int
    recent_solve_rate: float
    recent_independent_rate: float
    recent_hint_rate: float
    recent_avg_confidence: Optional[float]
    # 0 (strong) .. 1 (weak): mean of the factors above; None when there are
    # too few recent attempts to judge.
    weakness: Optional[float]
    reasons: List[str]


class LeetCodeTopicStats(BaseModel):
    topics: List[LeetCodeTopicStat]  # weakest first, unrated last
    weakest: List[str]
    recent_window: int
    min_attempts: int


class LeetCodeAttemptLogged(BaseModel):
    attempt: LeetCodeAttemptRead
    problem_created: bool
    progress: LeetCodeStats


class LeetCodeAttemptList(BaseModel):
    attempts: List[LeetCodeAttemptRead]
    count: int


class LeetCodeProblemList(BaseModel):
    problems: List[LeetCodeProblemSummary]
    count: int


class LeetCodeProblemDetail(BaseModel):
    problem: LeetCodeProblemSummary
    attempts: List[LeetCodeAttemptRead]
