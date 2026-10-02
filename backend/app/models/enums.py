from enum import Enum


class TaskStatus(str, Enum):
    inbox = "inbox"
    todo = "todo"
    in_progress = "in_progress"
    blocked = "blocked"
    completed = "completed"
    cancelled = "cancelled"


class TaskPriority(str, Enum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"


# Seed categories. The `category` field on Task is a free-form string so new
# categories can be added later without a migration, but the app ships with
# these and the frontend treats them specially where useful.
class TaskCategory(str, Enum):
    leetcode = "LeetCode"
    school = "school"
    project = "project"
    personal = "personal"
    errands = "errands"


class RecurrencePattern(str, Enum):
    daily = "daily"
    weekdays = "weekdays"
    weekly = "weekly"
    specific_days = "specific_days"
    monthly = "monthly"
    custom_interval = "custom_interval"


class MealType(str, Enum):
    breakfast = "breakfast"
    lunch = "lunch"
    dinner = "dinner"
    snack = "snack"


class LeetCodeDifficulty(str, Enum):
    easy = "easy"
    medium = "medium"
    hard = "hard"


class CalendarSourceType(str, Enum):
    url = "url"  # a subscription: re-fetched on its interval
    file = "file"  # a one-time snapshot from an uploaded .ics
