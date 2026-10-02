from datetime import date
from typing import List

from sqlmodel import Session, select

from app.services import categories as categories_service
from app.models.enums import RecurrencePattern, TaskStatus
from app.models.task import RecurrenceRule, Task
from app.schemas import RecurringTaskCreate


def create_recurring_task(session: Session, data: RecurringTaskCreate) -> RecurrenceRule:
    rule = RecurrenceRule(
        title=data.title,
        description=data.description,
        category=categories_service.ensure(session, data.category).key,
        priority=data.priority,
        estimated_duration=data.estimated_duration,
        tags=data.tags,
        pattern=data.pattern,
        days_of_week=data.days_of_week,
        interval_days=data.interval_days,
        day_of_month=data.day_of_month,
        start_date=data.start_date,
        end_date=data.end_date,
    )
    session.add(rule)
    session.commit()
    session.refresh(rule)
    return rule


def occurs_on(rule: RecurrenceRule, d: date) -> bool:
    if d < rule.start_date:
        return False
    if rule.end_date is not None and d > rule.end_date:
        return False

    if rule.pattern == RecurrencePattern.daily:
        return True
    if rule.pattern == RecurrencePattern.weekdays:
        return d.weekday() < 5
    if rule.pattern == RecurrencePattern.weekly:
        return (d - rule.start_date).days % 7 == 0
    if rule.pattern == RecurrencePattern.specific_days:
        return d.weekday() in (rule.days_of_week or [])
    if rule.pattern == RecurrencePattern.monthly:
        target_day = rule.day_of_month or rule.start_date.day
        return d.day == target_day
    if rule.pattern == RecurrencePattern.custom_interval:
        interval = rule.interval_days or 1
        return (d - rule.start_date).days % interval == 0
    return False


def ensure_occurrences_for_date(session: Session, d: date) -> List[Task]:
    """
    Idempotently materialize a Task row for every active recurrence rule
    that fires on date `d`. Safe to call repeatedly (e.g. on every
    `get_today` request) — existing occurrences are never duplicated or
    modified, which keeps completion history intact.
    """
    rules = session.exec(select(RecurrenceRule).where(RecurrenceRule.active == True)).all()  # noqa: E712
    created: List[Task] = []

    for rule in rules:
        if not occurs_on(rule, d):
            continue

        existing = session.exec(
            select(Task).where(
                Task.recurrence_rule_id == rule.id, Task.occurrence_date == d
            )
        ).first()
        if existing is not None:
            continue

        task = Task(
            title=rule.title,
            description=rule.description,
            status=TaskStatus.todo,
            priority=rule.priority,
            category=rule.category,
            tags=list(rule.tags or []),
            due_date=d,
            estimated_duration=rule.estimated_duration,
            source="recurring",
            recurrence_rule_id=rule.id,
            occurrence_date=d,
        )
        session.add(task)
        created.append(task)

    if created:
        session.commit()
        for task in created:
            session.refresh(task)

    return created
