"""What there is to do: tasks and imported assignments together.

Assignments stay Events (one source of truth); this only reads both and
groups them for Today and the Dashboard:

- overdue: open tasks due before the day, and assignments due in the last
  OVERDUE_LOOKBACK_DAYS that aren't checked off;
- today: tasks due or planned for the day, and assignments due that day
  (checked-off ones included, so they stay visible);
- undated: open tasks with no due date, by priority. Not overdue, just not
  scheduled; only the top UNDATED_LIMIT are listed (undated_total says how
  many there are).
"""

from datetime import date, datetime, time, timedelta
from typing import List, Optional

from sqlalchemy import case
from sqlmodel import Session, func, select

from app.models.enums import TaskPriority
from app.models.task import Task
from app.schemas import Occurrence, WorkItem, WorkPlan
from app.services import events as events_service
from app.services import tasks as tasks_service
from app.utils import local_today

OVERDUE_LOOKBACK_DAYS = 14
UNDATED_LIMIT = 6
_RANK = {TaskPriority.critical: 0, TaskPriority.high: 1, TaskPriority.medium: 2, TaskPriority.low: 3}


def _task_item(task: Task, day: date) -> WorkItem:
    read = tasks_service.serialize_task(task, day)
    due_at = datetime.combine(task.due_date, task.due_time) if task.due_date and task.due_time else None
    return WorkItem(
        kind="task", id=task.id, title=task.title, done=task.completed_at is not None or task.status == "completed",
        due_date=task.due_date, due_at=due_at, priority=task.priority, category=task.category, task=read,
    )


def _assignment_item(occ: Occurrence) -> WorkItem:
    return WorkItem(
        kind="assignment", id=occ.event_id, title=occ.title, done=occ.completed, due_date=occ.start_at.date(),
        due_at=occ.start_at, category=occ.category, course=occ.course, occurrence=occ,
    )


def _today_key(item: WorkItem):
    # Open before done; then things with a time, in time order; then by priority.
    untimed = item.due_at is None
    when = item.due_at.time() if item.due_at else time.max
    return (item.done, untimed, when, _RANK.get(item.priority, 2), item.title.lower())


def work_plan(session: Session, day: Optional[date] = None) -> WorkPlan:
    day = day or local_today()
    bundle = tasks_service.get_today_bundle(session, day)

    seen = set()
    today_tasks: List[Task] = []
    for task in [*bundle["scheduled"], *bundle["due_today"]]:
        if task.id not in seen:
            seen.add(task.id)
            today_tasks.append(task)
    overdue_tasks = [t for t in bundle["overdue"] if t.id not in seen]
    seen |= {t.id for t in overdue_tasks}

    deadlines = [
        o for o in events_service.occurrences(session, day - timedelta(days=OVERDUE_LOOKBACK_DAYS), day)
        if o.deadline and not o.cancelled
    ]
    due_today = [o for o in deadlines if o.start_at.date() == day]
    late = [o for o in deadlines if o.start_at.date() < day and not o.completed]

    overdue = sorted(
        [*(_task_item(t, day) for t in overdue_tasks), *(_assignment_item(o) for o in late)],
        key=lambda i: (i.due_date or day, i.due_at.time() if i.due_at else time.max, _RANK.get(i.priority, 2)),
    )
    today = sorted([*(_task_item(t, day) for t in today_tasks), *(_assignment_item(o) for o in due_today)], key=_today_key)

    undated_query = select(Task).where(
        Task.status.in_(tasks_service.ACTIVE_STATUSES), Task.due_date.is_(None),
        (Task.planned_for_date.is_(None)) | (Task.planned_for_date != day),
    )
    undated_total = session.exec(select(func.count()).select_from(undated_query.subquery())).one()
    rank = case(*((Task.priority == p, r) for p, r in _RANK.items()), else_=2)
    undated = session.exec(undated_query.order_by(rank, Task.created_at).limit(UNDATED_LIMIT)).all()

    return WorkPlan(
        date=day,
        overdue=overdue,
        today=today,
        undated=[_task_item(t, day) for t in undated],
        undated_total=undated_total,
        remaining=sum(1 for i in [*overdue, *today] if not i.done),
    )
