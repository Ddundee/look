from datetime import date, datetime, time, timezone
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator

from app.models.enums import CalendarSourceType, LeetCodeDifficulty, MealType, RecurrencePattern, TaskPriority, TaskStatus


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
    # Set for events mirrored from a calendar subscription (read-only).
    subscription_id: Optional[str] = None
    external_url: Optional[str] = None
    external_status: Optional[str] = None  # "cancelled" | "removed" | None
    last_synced_at: Optional[datetime] = None
    # Deadlines (imported assignments) can be checked off.
    is_deadline: bool = False
    completed_at: Optional[datetime] = None
    completion_source: Optional[str] = None  # "local" | "external"
    course_id: Optional[str] = None
    course_source: Optional[str] = None  # "auto" | "manual"

    @computed_field
    @property
    def completed(self) -> bool:
        return self.completed_at is not None


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
    # Imported from a calendar subscription: the feed owns it, so Look
    # won't edit it (read_only). external_status is "cancelled" (cancelled
    # in the feed) or "removed" (gone from the feed); both also set
    # cancelled, so they're hidden unless include_cancelled.
    read_only: bool = False
    subscription_id: Optional[str] = None
    subscription_name: Optional[str] = None
    external_url: Optional[str] = None
    external_status: Optional[str] = None
    # Something due that can be checked off (completed is separate from
    # cancelled: a cancelled assignment isn't a finished one).
    deadline: bool = False
    completed: bool = False
    completed_at: Optional[datetime] = None
    completion_source: Optional[str] = None
    # The class it belongs to, if any (see app.services.courses).
    course_id: Optional[str] = None
    course: Optional["CourseSummary"] = None


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
    # None = derive it from hint_used (solved without a hint); unknown if
    # hint_used is unknown too.
    solved_independently: Optional[bool] = None
    # Defaults to "no hint" for attempts you log yourself; None = unknown.
    hint_used: Optional[bool] = False
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
    solved_independently: Optional[bool]  # None = unknown
    hint_used: Optional[bool]  # None = unknown
    duration_minutes: Optional[int]
    language: Optional[str]
    confidence: Optional[int]
    notes: Optional[str]
    source: str  # manual | mcp | leetcode (imported)
    external_id: Optional[str] = None  # LeetCode submission id, for imports
    created_at: datetime
    problem: LeetCodeProblemRead

    @computed_field
    @property
    def external_url(self) -> Optional[str]:
        if self.source == "leetcode" and self.external_id:
            return f"https://leetcode.com/submissions/detail/{self.external_id}/"
        return None


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
    # Shares of the attempts where it's known (imports often don't say);
    # None when no attempt records it.
    hint_usage_rate: Optional[float]
    independent_solve_rate: Optional[float]
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
    recent_independent_rate: Optional[float]  # over recent attempts where it's known
    recent_hint_rate: Optional[float]
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


# ---------------------------------------------------------------------------
# Calendar subscriptions (ICS feeds and file imports)
# ---------------------------------------------------------------------------


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    # Stored as naive UTC; say so on the way out so clients show local time.
    return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value


class CalendarSubscriptionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    url: str = Field(min_length=1, max_length=2000)
    sync_interval_minutes: int = Field(default=30, ge=5, le=1440)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name can't be blank")
        return v


class CalendarSubscriptionUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    enabled: Optional[bool] = None
    sync_interval_minutes: Optional[int] = Field(default=None, ge=5, le=1440)

    @field_validator("name")
    @classmethod
    def _name(cls, v: Optional[str]) -> Optional[str]:
        return _clean_title(v)


class CalendarSubscriptionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    source_type: CalendarSourceType
    source_url: Optional[str]
    enabled: bool
    sync_interval_minutes: int
    last_sync_at: Optional[datetime]
    last_success_at: Optional[datetime]
    last_error: Optional[str]
    last_result: Optional[Dict[str, int]]
    created_at: datetime
    updated_at: datetime
    event_count: int = 0  # imported events still in the feed
    next_sync_at: Optional[datetime] = None  # URL sources only, when enabled

    @field_validator("last_sync_at", "last_success_at", "created_at", "updated_at", "next_sync_at")
    @classmethod
    def _utc(cls, v: Optional[datetime]) -> Optional[datetime]:
        return _as_utc(v)


class CalendarSyncResult(BaseModel):
    # ok: fetched and reconciled; not_modified: the server said nothing
    # changed (HTTP 304); error: nothing was changed (see error);
    # skipped: disabled, or a sync of it was already running.
    status: str
    created: int = 0
    updated: int = 0
    unchanged: int = 0
    removed: int = 0
    error: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)
    subscription: Optional[CalendarSubscriptionRead] = None


class CalendarSubscriptionList(BaseModel):
    subscriptions: List[CalendarSubscriptionRead]
    count: int


class CalendarSubscriptionDeleted(BaseModel):
    events_kept: int
    events_deleted: int


# ---------------------------------------------------------------------------
# Courses and categories (presentation keys come from fixed sets: see
# app.models.planning COLORS/STYLES; no CSS is ever stored)
# ---------------------------------------------------------------------------

ColorKey = Literal["red", "orange", "amber", "yellow", "lime", "green", "teal", "cyan", "sky", "blue", "indigo", "violet", "pink", "slate"]
StyleKey = Literal["solid", "soft", "outline", "striped", "glass"]


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    color: Optional[ColorKey] = None
    style: Optional[StyleKey] = None


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=50)
    color: Optional[ColorKey] = None
    style: Optional[StyleKey] = None
    archived: Optional[bool] = None


class CategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    key: str  # what tasks/events store in their `category`
    name: str
    color: str
    style: str
    is_system: bool
    archived: bool
    item_count: int = 0  # tasks + events using it (lists only)


class CourseCreate(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    name: Optional[str] = Field(default=None, max_length=120)
    color: Optional[ColorKey] = None
    style: Optional[StyleKey] = None
    aliases: List[str] = Field(default_factory=list)


class CourseUpdate(BaseModel):
    code: Optional[str] = Field(default=None, min_length=2, max_length=40)
    name: Optional[str] = Field(default=None, max_length=120)
    color: Optional[ColorKey] = None
    style: Optional[StyleKey] = None
    aliases: Optional[List[str]] = None
    archived: Optional[bool] = None


class CourseSummary(BaseModel):
    """What an event or assignment carries about its course."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    code: str
    name: Optional[str]
    color: str
    style: str


class CourseRead(CourseSummary):
    aliases: List[str]
    archived: bool
    canvas_contexts: List[str] = Field(default_factory=list)
    event_count: int = 0


class EventCourseSet(BaseModel):
    course_id: Optional[str] = None  # null = this event has no course


Occurrence.model_rebuild()


# ---------------------------------------------------------------------------
# Planning: tasks and imported assignments as one list of things to do
# ---------------------------------------------------------------------------


class WorkItem(BaseModel):
    """Something to do: a Task, or an imported assignment (an Event with
    deadline semantics). Exactly one of `task` / `occurrence` is set; they
    are the records themselves, not copies, so completing one goes to the
    Task API or the event's complete/uncomplete."""

    kind: Literal["task", "assignment", "event"]  # "event": a plain event (smart lists)
    id: str  # task id or event id
    title: str
    done: bool
    due_date: Optional[date] = None
    due_at: Optional[datetime] = None  # when a time is known (local)
    priority: Optional[TaskPriority] = None  # tasks only
    category: str
    course: Optional[CourseSummary] = None
    task: Optional[TaskRead] = None
    occurrence: Optional[Occurrence] = None


class WorkPlan(BaseModel):
    date: date
    overdue: List[WorkItem]
    today: List[WorkItem]  # due or planned today, done ones included
    undated: List[WorkItem]  # open tasks with no due date, most important first (top few)
    undated_total: int
    remaining: int  # not-done items in overdue + today
class LeetCodeSubmissionImport(BaseModel):
    """One LeetCode submission to import (from submission history). The
    problem's number, title and difficulty come from LeetCode; hint use and
    independence aren't in the history, so they're stored as unknown."""

    submission_id: str = Field(min_length=1, max_length=40)
    problem_number: int = Field(ge=1, le=100000)
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    difficulty: Optional[LeetCodeDifficulty] = None
    topics: List[str] = Field(default_factory=list)
    status: str = "Accepted"  # LeetCode's statusDisplay; only "Accepted" counts as solved
    submitted_at: datetime  # with timezone (or UTC), e.g. from the epoch-ms timestamp
    language: Optional[str] = Field(default=None, max_length=40)


class LeetCodeImportResult(BaseModel):
    created: int
    duplicates: int  # already imported (same submission id), skipped
    problems_created: int


# ---------------------------------------------------------------------------
# Views: Dashboard, Today and custom views made of widgets
# ---------------------------------------------------------------------------

# Width in a 12-column desktop grid (quarter = 3 columns … full = 12) and
# height in sixths of the screen. Semantic sizes only, never pixels.
WidgetSize = Literal["quarter", "third", "half", "two_thirds", "full"]
WidgetHeight = Literal["short", "medium", "tall", "full"]


class WidgetInstance(BaseModel):
    """One widget on a view. `type` must be a registered widget key
    (app.services.views.WIDGETS); `config` is checked against that
    widget's own fields."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,39}$")
    type: str = Field(max_length=40)
    size: WidgetSize
    height: WidgetHeight = "medium"
    visible: bool = True
    config: Dict[str, Any] = Field(default_factory=dict)


class ViewLayoutUpdate(BaseModel):
    widgets: List[WidgetInstance] = Field(max_length=24)


class ViewCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    icon: str = "squares"
    show_in_nav: bool = True
    # Starting widgets only; nothing about the user is inferred.
    preset: Literal["blank", "planning", "school", "overview"] = "blank"

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _clean_title(v)


class ViewUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=40)
    icon: Optional[str] = None
    show_in_nav: Optional[bool] = None
    archived: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: Optional[str]) -> Optional[str]:
        return _clean_title(v)


class ViewRead(BaseModel):
    key: str
    name: str
    icon: str
    kind: Literal["system", "custom"]
    show_in_nav: bool
    sort_order: int
    archived: bool
    customized: bool  # system views: differs from the app's default layout
    widgets: List[WidgetInstance]


class ViewList(BaseModel):
    views: List[ViewRead]


class ViewOrder(BaseModel):
    keys: List[str] = Field(max_length=200)  # custom view keys, in nav order


class WidgetTypeRead(BaseModel):
    type: str
    title: str
    description: str
    sizes: List[str]
    default_size: str
    heights: List[str]
    default_height: str
    multiple: bool
    config_defaults: Dict[str, Any]


# ---- blocks (app.services.blocks) ------------------------------------------------

BlockKind = Literal["smart_list", "note"]
DueWindow = Literal["any", "overdue", "today", "next_7", "next_14", "next_30", "this_week", "no_date"]


class SmartListConfig(BaseModel):
    """What a smart list shows. Filters apply where the field exists:
    courses narrow it to assignments and events (tasks have no course);
    priorities and tags narrow it to tasks."""

    model_config = ConfigDict(extra="forbid")
    show: List[Literal["tasks", "assignments", "events"]] = Field(
        default_factory=lambda: ["tasks", "assignments"], min_length=1, max_length=3
    )
    categories: List[str] = Field(default_factory=list, max_length=30)
    courses: List[str] = Field(default_factory=list, max_length=30)
    priorities: List[TaskPriority] = Field(default_factory=list, max_length=4)
    tags: List[str] = Field(default_factory=list, max_length=10)
    search: str = Field(default="", max_length=100)
    due: DueWindow = "any"
    status: Literal["open", "done", "all"] = "open"
    sort: Literal["due", "priority", "title"] = "due"
    limit: int = Field(default=20, ge=1, le=50)
    group_by_day: bool = False


class NoteConfig(BaseModel):
    """A note's text: a small Markdown subset (headings, lists, - [ ]
    checklists, **bold**, *italic*, `code`, links), rendered as text, never
    as HTML."""

    model_config = ConfigDict(extra="forbid")
    text: str = Field(default="", max_length=10_000)


class BlockCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    icon: Optional[str] = None
    color: Optional[str] = None
    kind: BlockKind
    config: Dict[str, Any] = Field(default_factory=dict)


class BlockUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=40)
    icon: Optional[str] = None
    color: Optional[str] = None
    config: Optional[Dict[str, Any]] = None


class BlockPlacement(BaseModel):
    key: str
    name: str


class BlockRead(BaseModel):
    id: str
    name: str
    icon: str
    color: str
    kind: BlockKind
    config: Dict[str, Any]
    used_in: List[BlockPlacement]  # views showing it
    updated_at: datetime


class BlockList(BaseModel):
    blocks: List[BlockRead]


class BlockItems(BaseModel):
    items: List[WorkItem]
    total: int  # matches before the limit
