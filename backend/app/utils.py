from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.config import get_settings


def utcnow() -> datetime:
    """Naive UTC timestamp for storage in timezone-less DB columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def local_today() -> date:
    """Today's date in APP_TIMEZONE, not the container/server's system
    timezone. Docker containers typically run in UTC regardless of where
    the user actually is, so a late-evening due date could otherwise land
    on the wrong day."""
    settings = get_settings()
    return datetime.now(ZoneInfo(settings.app_timezone)).date()


def week_start(day: date) -> date:
    """The Monday of the calendar week (Mon-Sun) containing `day`. Weeks
    are Monday-to-Sunday throughout Look (frontend: lib/week.ts)."""
    return day - timedelta(days=day.weekday())


def local_now() -> datetime:
    """Current wall-clock time in APP_TIMEZONE, naive (like the other local
    timestamps the app stores), so its .date() matches local_today()."""
    settings = get_settings()
    return datetime.now(ZoneInfo(settings.app_timezone)).replace(tzinfo=None, microsecond=0)
