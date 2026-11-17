"""What a good day looks like: Daily Floor, Today's 3, While AI Runs and
Break the default.

Everything except the challenge is ordinary tasks, read in a particular
way, so completing, editing and MCP all work as they do for any task:

- Daily Floor: tasks tagged `daily-floor` for the day (planned_for_date,
  else due_date). A daily recurring task with the tag makes one per day,
  which is also the history: a day is won when every floor item for it is
  completed. Days with no floor items are neither won nor lost.
- Today's 3: tasks with planned_for_date == the day (never due_date), the
  three most important shown. Choosing one sets only planned_for_date.
- While AI Runs: open tasks tagged `ai-wait`, short ones (<= 30 min) first.
- Break the default: one optional challenge a day from a curated pool,
  stored (DailyChallenge) so it holds across refreshes and devices. Not
  doing it never counts against the day.
"""

import random
from datetime import date, datetime, time, timedelta
from typing import Dict, List, Optional

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, or_, select

from app.models.daily import DailyChallenge
from app.models.enums import TaskPriority, TaskStatus
from app.models.leetcode import LeetCodeAttempt
from app.models.task import Task
from app.schemas import (
    AiWaitQueue,
    ConsistencyDay,
    DailyChallengeRead,
    DailyFloor,
    DailyPlan,
    TodaysThree,
    WeekConsistency,
)
from app.services import recurrence as recurrence_service
from app.services import tasks as tasks_service
from app.services.tasks import AI_WAIT_TAG, FLOOR_TAG, has_tag
from app.utils import local_today, utcnow, week_start

THREE = 3
AI_WAIT_SHORT_MINUTES = 30
AI_WAIT_LIMIT = 8
STREAK_LOOKBACK_DAYS = 120
CHALLENGE_REPEAT_DAYS = 7  # a chosen challenge isn't offered again within this many days

_RANK = {TaskPriority.critical: 0, TaskPriority.high: 1, TaskPriority.medium: 2, TaskPriority.low: 3}


# ---- Daily Floor ----------------------------------------------------------------


def _floor_day(task: Task) -> Optional[date]:
    return task.planned_for_date or task.due_date


def floor_tasks_by_day(session: Session, start: date, end: date) -> Dict[date, List[Task]]:
    """Daily Floor tasks (not cancelled) for each day in [start, end]."""
    rows = session.exec(
        select(Task).where(
            Task.status != TaskStatus.cancelled,
            or_(Task.due_date.between(start, end), Task.planned_for_date.between(start, end)),
        )
    ).all()
    out: Dict[date, List[Task]] = {}
    for task in rows:
        day = _floor_day(task)
        if day is not None and start <= day <= end and has_tag(task, FLOOR_TAG):
            out.setdefault(day, []).append(task)
    for items in out.values():
        items.sort(key=lambda t: (_RANK.get(t.priority, 2), t.created_at, t.title.lower()))
    return out


def is_won(items: List[Task]) -> bool:
    return bool(items) and all(t.status == TaskStatus.completed for t in items)


def floor_streak(by_day: Dict[date, List[Task]], today: date) -> int:
    """Won days in a row, ending today if today is won, else yesterday
    (today isn't over). Days with no floor items are skipped."""
    day = today if is_won(by_day.get(today, [])) else today - timedelta(days=1)
    streak = 0
    for _ in range(STREAK_LOOKBACK_DAYS):
        items = by_day.get(day, [])
        if items:
            if not is_won(items):
                break
            streak += 1
        day -= timedelta(days=1)
    return streak


def floor(session: Session, day: Optional[date] = None) -> DailyFloor:
    day = day or local_today()
    recurrence_service.ensure_occurrences_for_date(session, day)
    # One read covers the streak lookback and the rest of this week.
    by_day = floor_tasks_by_day(session, day - timedelta(days=STREAK_LOOKBACK_DAYS), week_start(day) + timedelta(days=6))
    items = by_day.get(day, [])
    return DailyFloor(
        date=day,
        items=[tasks_service.serialize_task(t, day) for t in items],
        done=sum(1 for t in items if t.status == TaskStatus.completed),
        total=len(items),
        won=is_won(items),
        streak=floor_streak(by_day, day),
        week=week_consistency(session, day, by_day=by_day).days,
    )


# ---- Today's 3 --------------------------------------------------------------------


def _importance(task: Task):
    return (_RANK.get(task.priority, 2), task.due_date is None, task.due_date or date.max,
            task.due_time or time.max, task.created_at)


def todays_three(session: Session, day: Optional[date] = None) -> TodaysThree:
    """Tasks planned for the day, most important first. The order doesn't
    depend on done/not done, so checking one off never pulls in a fourth."""
    day = day or local_today()
    planned = [
        t for t in session.exec(
            select(Task).where(Task.planned_for_date == day, Task.status != TaskStatus.cancelled)
        ).all()
        if not has_tag(t, FLOOR_TAG)
    ]
    planned.sort(key=_importance)
    return TodaysThree(
        date=day,
        items=[tasks_service.serialize_task(t, day) for t in planned[:THREE]],
        planned_total=len(planned),
        more=max(0, len(planned) - THREE),
    )


# ---- While AI Runs ---------------------------------------------------------------


def _wait_key(task: Task):
    minutes = task.estimated_duration
    bucket = 0 if minutes is not None and minutes <= AI_WAIT_SHORT_MINUTES else (1 if minutes is None else 2)
    return (bucket, _RANK.get(task.priority, 2), minutes if minutes is not None else 10_000, task.created_at)


def ai_wait(session: Session, day: Optional[date] = None, limit: int = AI_WAIT_LIMIT) -> AiWaitQueue:
    """Small useful things for while an agent runs: open (not blocked) tasks
    tagged ai-wait. A recurring one only shows today's occurrence."""
    day = day or local_today()
    recurrence_service.ensure_occurrences_for_date(session, day)
    open_statuses = [s for s in tasks_service.ACTIVE_STATUSES if s != TaskStatus.blocked]
    tasks = [
        t for t in session.exec(select(Task).where(Task.status.in_(open_statuses))).all()
        if has_tag(t, AI_WAIT_TAG) and (t.occurrence_date is None or t.occurrence_date == day)
    ]
    tasks.sort(key=_wait_key)
    return AiWaitQueue(items=[tasks_service.serialize_task(t, day) for t in tasks[:limit]], total=len(tasks))


# ---- Break the default -------------------------------------------------------------

# Curated pool. Keys are stored; text can be reworded freely. Only add to
# the end or reword: a removed key just reads as the first challenge.
CHALLENGES: Dict[str, str] = {
    "new-work-spot": "Work somewhere you haven't worked this week.",
    "walk-new-place": "Take a walk somewhere you don't usually go.",
    "reconnect": "Talk to someone you haven't seen in a while.",
    "campus-event": "Go to a campus event, even a small one.",
    "eat-somewhere-new": "Eat somewhere different today.",
    "hour-out": "Spend an hour outside your room, not at a friend's place.",
    "different-route": "Take a different route to where you're going.",
    "explore-building": "Explore a building you normally walk past.",
    "library-floor": "Work from a library floor you've never sat on.",
    "invite-someone": "Invite someone new to grab food or coffee.",
    "outside-break": "Take a break outside instead of on your phone.",
    "office-hours": "Go to office hours or a study session in person.",
    "new-cafe": "Try a café or study spot you haven't been to.",
    "sunset": "Go somewhere you can watch the sunset.",
    "club-meeting": "Drop in on a club or group you've been curious about.",
    "phone-free-walk": "Walk for 20 minutes without your phone out.",
    "ask-a-question": "Start a conversation with someone in your class.",
    "gym-new-time": "Move somewhere other than your usual spot: a park, a court, a trail.",
    "people-watch": "Sit somewhere busy for 15 minutes and just look around.",
    "errand-on-foot": "Do one errand on foot or by bike.",
}


def _challenge_read(row: DailyChallenge) -> DailyChallengeRead:
    key = row.challenge_key if row.challenge_key in CHALLENGES else next(iter(CHALLENGES))
    return DailyChallengeRead(date=row.day, key=key, text=CHALLENGES[key],
                              done=row.completed_at is not None, completed_at=row.completed_at)


def _pick(session: Session, day: date, shown: List[str], rng: random.Random) -> str:
    """A challenge not offered today and not chosen in the last week; with
    fewer left, relax those rules rather than repeat the current one."""
    recent = set(session.exec(
        select(DailyChallenge.challenge_key).where(
            DailyChallenge.day >= day - timedelta(days=CHALLENGE_REPEAT_DAYS), DailyChallenge.day < day)
    ).all())
    keys = list(CHALLENGES)
    for pool in (
        [k for k in keys if k not in shown and k not in recent],
        [k for k in keys if k not in shown],
        [k for k in keys if not shown or k != shown[-1]],
    ):
        if pool:
            return rng.choice(pool)
    return keys[0]


def _challenge_row(session: Session, day: date, rng: random.Random) -> DailyChallenge:
    row = session.get(DailyChallenge, day)
    if row is not None:
        return row
    key = _pick(session, day, [], rng)
    row = DailyChallenge(day=day, challenge_key=key, shown=[key])
    session.add(row)
    try:
        session.commit()
    except IntegrityError:  # another device made today's first
        session.rollback()
        return session.get(DailyChallenge, day)
    session.refresh(row)
    return row


def challenge(session: Session, day: Optional[date] = None, rng: Optional[random.Random] = None) -> DailyChallengeRead:
    return _challenge_read(_challenge_row(session, day or local_today(), rng or random.Random()))


def another_challenge(session: Session, day: Optional[date] = None, rng: Optional[random.Random] = None) -> DailyChallengeRead:
    day = day or local_today()
    rng = rng or random.Random()
    row = _challenge_row(session, day, rng)
    if row.completed_at is not None:
        raise ValueError("Today's challenge is already done.")
    shown = list(row.shown or [row.challenge_key])
    key = _pick(session, day, shown, rng)
    if len(shown) >= len(CHALLENGES):
        shown = []  # offered them all today; start over
    row.challenge_key = key
    row.shown = [*shown, key]
    row.updated_at = utcnow()
    session.add(row)
    session.commit()
    session.refresh(row)
    return _challenge_read(row)


def set_challenge_done(session: Session, done: bool, day: Optional[date] = None) -> DailyChallengeRead:
    row = _challenge_row(session, day or local_today(), random.Random())
    row.completed_at = (row.completed_at or utcnow()) if done else None
    row.updated_at = utcnow()
    session.add(row)
    session.commit()
    session.refresh(row)
    return _challenge_read(row)


# ---- Weekly consistency ------------------------------------------------------------


def week_consistency(session: Session, day: Optional[date] = None,
                     by_day: Optional[Dict[date, List[Task]]] = None) -> WeekConsistency:
    """The Mon-Sun week containing `day`: Daily Floor won, LeetCode solved
    and challenge done, per day. Only days up to today are counted.
    `by_day` (floor tasks already read for a range covering the week)
    saves a query."""
    today = local_today()
    start = week_start(day or today)
    end = start + timedelta(days=6)
    if by_day is None:
        by_day = floor_tasks_by_day(session, start, end)

    solved = {
        a.date() for a in session.exec(
            select(LeetCodeAttempt.attempted_at).where(
                LeetCodeAttempt.solved == True,  # noqa: E712
                LeetCodeAttempt.attempted_at >= datetime.combine(start, time.min),
                LeetCodeAttempt.attempted_at < datetime.combine(end + timedelta(days=1), time.min),
            )
        ).all()
    }
    challenged = set(session.exec(
        select(DailyChallenge.day).where(
            DailyChallenge.day.between(start, end), DailyChallenge.completed_at.is_not(None))
    ).all())

    days: List[ConsistencyDay] = []
    for i in range(7):
        d = start + timedelta(days=i)
        items = by_day.get(d, [])
        days.append(ConsistencyDay(
            date=d, floor_total=len(items), floor_done=sum(1 for t in items if t.status == TaskStatus.completed),
            floor_won=is_won(items), leetcode=d in solved, challenge=d in challenged,
        ))
    counted = [x for x in days if x.date <= today]
    return WeekConsistency(
        start_date=start,
        days=days,
        floor_won_days=sum(1 for x in counted if x.floor_won),
        floor_days=sum(1 for x in counted if x.floor_total),
        leetcode_days=sum(1 for x in counted if x.leetcode),
        challenge_days=sum(1 for x in counted if x.challenge),
        elapsed_days=len(counted),
    )


# ---- Everything, for MCP -----------------------------------------------------------


def daily_plan(session: Session, day: Optional[date] = None) -> DailyPlan:
    day = day or local_today()
    return DailyPlan(date=day, floor=floor(session, day), todays_three=todays_three(session, day),
                     ai_wait=ai_wait(session, day), challenge=challenge(session, day))
