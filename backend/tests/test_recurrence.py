from datetime import date, timedelta

from app.models.enums import RecurrencePattern, TaskPriority
from app.schemas import RecurringTaskCreate
from app.services import recurrence as recurrence_service
from app.utils import local_today


def make_rule(session, **overrides):
    defaults = dict(
        title="Recurring test",
        category="personal",
        priority=TaskPriority.medium,
        start_date=date(2026, 1, 1),  # a Thursday
    )
    defaults.update(overrides)
    return recurrence_service.create_recurring_task(session, RecurringTaskCreate(**defaults))


def test_daily_occurs_every_day(session):
    rule = make_rule(session, pattern=RecurrencePattern.daily)
    for offset in range(0, 10):
        d = rule.start_date + timedelta(days=offset)
        assert recurrence_service.occurs_on(rule, d)


def test_daily_does_not_occur_before_start_date(session):
    rule = make_rule(session, pattern=RecurrencePattern.daily)
    assert not recurrence_service.occurs_on(rule, rule.start_date - timedelta(days=1))


def test_weekdays_excludes_weekend(session):
    rule = make_rule(session, pattern=RecurrencePattern.weekdays)
    monday = date(2026, 1, 5)
    saturday = date(2026, 1, 10)
    sunday = date(2026, 1, 11)
    assert recurrence_service.occurs_on(rule, monday)
    assert not recurrence_service.occurs_on(rule, saturday)
    assert not recurrence_service.occurs_on(rule, sunday)


def test_weekly_occurs_every_seven_days_from_start(session):
    rule = make_rule(session, pattern=RecurrencePattern.weekly, start_date=date(2026, 1, 1))
    assert recurrence_service.occurs_on(rule, date(2026, 1, 1))
    assert recurrence_service.occurs_on(rule, date(2026, 1, 8))
    assert not recurrence_service.occurs_on(rule, date(2026, 1, 5))


def test_specific_days_matches_configured_weekdays(session):
    # Tuesday=1, Thursday=3
    rule = make_rule(
        session, pattern=RecurrencePattern.specific_days, days_of_week=[1, 3]
    )
    tuesday = date(2026, 1, 6)
    wednesday = date(2026, 1, 7)
    thursday = date(2026, 1, 8)
    assert recurrence_service.occurs_on(rule, tuesday)
    assert not recurrence_service.occurs_on(rule, wednesday)
    assert recurrence_service.occurs_on(rule, thursday)


def test_monthly_matches_day_of_month(session):
    rule = make_rule(session, pattern=RecurrencePattern.monthly, day_of_month=15)
    assert recurrence_service.occurs_on(rule, date(2026, 2, 15))
    assert not recurrence_service.occurs_on(rule, date(2026, 2, 14))


def test_custom_interval_every_three_days(session):
    rule = make_rule(
        session,
        pattern=RecurrencePattern.custom_interval,
        interval_days=3,
        start_date=date(2026, 1, 1),
    )
    assert recurrence_service.occurs_on(rule, date(2026, 1, 1))
    assert not recurrence_service.occurs_on(rule, date(2026, 1, 2))
    assert recurrence_service.occurs_on(rule, date(2026, 1, 4))


def test_rule_respects_end_date(session):
    rule = make_rule(
        session,
        pattern=RecurrencePattern.daily,
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 5),
    )
    assert recurrence_service.occurs_on(rule, date(2026, 1, 5))
    assert not recurrence_service.occurs_on(rule, date(2026, 1, 6))


def test_ensure_occurrences_is_idempotent(session):
    make_rule(session, pattern=RecurrencePattern.daily, start_date=local_today())

    first = recurrence_service.ensure_occurrences_for_date(session, local_today())
    second = recurrence_service.ensure_occurrences_for_date(session, local_today())

    assert len(first) == 1
    assert len(second) == 0  # already materialized, no duplicate


def test_completing_one_occurrence_does_not_affect_others(session):
    from app.services import tasks as tasks_service

    make_rule(session, pattern=RecurrencePattern.daily, start_date=local_today())

    today = local_today()
    tomorrow = today + timedelta(days=1)
    occ_today = recurrence_service.ensure_occurrences_for_date(session, today)[0]
    occ_tomorrow = recurrence_service.ensure_occurrences_for_date(session, tomorrow)[0]

    tasks_service.complete_task(session, occ_today)

    refreshed_tomorrow = tasks_service.get_task(session, occ_tomorrow.id)
    assert refreshed_tomorrow.status.value != "completed"


def test_racing_requests_make_one_occurrence(engine, monkeypatch):
    # Today's widgets load at once and each materializes today's
    # occurrences. One that checks, then loses the race to another
    # request, must not add a second row (this made Daily Floor items
    # show up 2-4 times).
    from sqlmodel import Session, select

    from app.models.task import Task

    real = recurrence_service._materialized_rule_ids
    raced = []

    def check_then_lose(session, d):
        seen = real(session, d)
        if not raced:  # the other request runs and commits right after our check
            raced.append(None)
            with Session(engine) as other:
                raced.append(recurrence_service.ensure_occurrences_for_date(other, d))
        return seen

    with Session(engine) as s:
        make_rule(s, pattern=RecurrencePattern.daily, start_date=local_today())
        make_rule(s, title="Second", pattern=RecurrencePattern.daily, start_date=local_today())
        monkeypatch.setattr(recurrence_service, "_materialized_rule_ids", check_then_lose)
        mine = recurrence_service.ensure_occurrences_for_date(s, local_today())

    assert len(raced[1]) == 2 and mine == []  # the other request's rows stand
    with Session(engine) as s:
        assert sorted(t.title for t in s.exec(select(Task)).all()) == ["Recurring test", "Second"]


def test_the_database_refuses_a_second_occurrence(session):
    import pytest
    from sqlalchemy.exc import IntegrityError

    from app.models.task import Task

    rule = make_rule(session, pattern=RecurrencePattern.daily, start_date=local_today())
    recurrence_service.ensure_occurrences_for_date(session, local_today())
    session.add(Task(title="dup", recurrence_rule_id=rule.id, occurrence_date=local_today()))
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()
    # Tasks without a rule are unaffected.
    session.add(Task(title="one"))
    session.add(Task(title="two"))
    session.commit()
