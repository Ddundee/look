"""Daily Floor, Today's 3, While AI Runs, Break the default, and weekly
consistency (app.services.daily)."""

import random
from datetime import datetime, time, timedelta

from sqlmodel import select

import mcp_server.server as mcp_server
from app.models import DailyChallenge, LeetCodeAttempt, LeetCodeDifficulty, LeetCodeProblem, Task
from app.models.enums import RecurrencePattern, TaskStatus
from app.schemas import RecurringTaskCreate, TaskCreate, TaskUpdate
from app.services import daily
from app.services import planning as planning_svc
from app.services import recurrence as recurrence_svc
from app.services import tasks as tasks_svc
from app.utils import local_today, week_start

TODAY = local_today()
YESTERDAY = TODAY - timedelta(days=1)


def task(session, title, **kw):
    kw.setdefault("status", "todo")
    return tasks_svc.create_task(session, TaskCreate(title=title, **kw))


def done(session, t):
    return tasks_svc.complete_task(session, t)


# ---- Daily Floor ------------------------------------------------------------------


def test_floor_selects_todays_daily_floor_tasks_only(session):
    a = task(session, "30 pushups", tags=["daily-floor"], due_date=TODAY)
    b = task(session, "1 LeetCode", tags=["Daily-Floor"], planned_for_date=TODAY)  # tag case ignored
    task(session, "Yesterday's pushups", tags=["daily-floor"], due_date=YESTERDAY)
    task(session, "Not floor", due_date=TODAY)
    task(session, "Cancelled", tags=["daily-floor"], due_date=TODAY, status="cancelled")
    # planned_for_date decides the day over due_date
    task(session, "Planned tomorrow", tags=["daily-floor"], due_date=TODAY, planned_for_date=TODAY + timedelta(days=1))

    f = daily.floor(session, TODAY)
    assert {i.id for i in f.items} == {a.id, b.id}
    assert (f.done, f.total, f.won) == (0, 2, False)


def test_floor_progress_and_day_won(session):
    items = [task(session, f"habit {n}", tags=["daily-floor"], due_date=TODAY) for n in range(4)]
    for t in items[:3]:
        done(session, t)
    f = daily.floor(session, TODAY)
    assert (f.done, f.total, f.won) == (3, 4, False)

    done(session, items[3])
    f = daily.floor(session, TODAY)
    assert (f.done, f.total, f.won) == (4, 4, True)
    assert f.streak == 1

    # Un-completing takes the win back, and clears completed_at.
    reopened = tasks_svc.update_task(session, items[3], TaskUpdate(status="todo"))
    assert reopened.completed_at is None
    f = daily.floor(session, TODAY)
    assert (f.done, f.won) == (3, False)


def test_no_floor_is_never_won(session):
    f = daily.floor(session, TODAY)
    assert (f.total, f.won, f.streak) == (0, False, 0)


def test_floor_from_daily_recurring_tasks_and_streak(session):
    start = TODAY - timedelta(days=5)
    recurrence_svc.create_recurring_task(session, RecurringTaskCreate(
        title="Leave the room", pattern=RecurrencePattern.daily, start_date=start, tags=["daily-floor"]))
    for offset in range(5, -1, -1):  # materialize the last 6 days
        recurrence_svc.ensure_occurrences_for_date(session, TODAY - timedelta(days=offset))
    by_day = {t.occurrence_date: t for t in session.exec(select(Task)).all()}
    # Won 3 days ago, 2 days ago and yesterday; missed 4 days ago.
    for offset in (5, 3, 2, 1):
        done(session, by_day[TODAY - timedelta(days=offset)])

    f = daily.floor(session, TODAY)
    assert f.total == 1 and not f.won
    assert f.streak == 3  # today isn't over, so it doesn't break the streak

    done(session, by_day[TODAY])
    assert daily.floor(session, TODAY).streak == 4


def test_days_without_a_floor_dont_break_the_streak(session):
    for offset in (1, 3):  # nothing at all 2 days ago
        done(session, task(session, f"floor {offset}", tags=["daily-floor"], due_date=TODAY - timedelta(days=offset)))
    assert daily.floor(session, TODAY).streak == 2


def test_missed_floor_items_are_not_overdue(session):
    missed = task(session, "Pushups", tags=["daily-floor"], due_date=YESTERDAY)
    late = task(session, "Essay", due_date=YESTERDAY)
    assert [t.id for t in tasks_svc.get_overdue(session, TODAY)] == [late.id]
    assert not tasks_svc.serialize_task(missed, TODAY).is_overdue
    assert [i.id for i in planning_svc.work_plan(session, TODAY).overdue] == [late.id]


# ---- Today's 3 ----------------------------------------------------------------------


def test_todays_three_limit_and_ordering(session):
    low = task(session, "low", priority="low", planned_for_date=TODAY)
    crit = task(session, "critical", priority="critical", planned_for_date=TODAY)
    task(session, "high later", priority="high", planned_for_date=TODAY, due_date=TODAY + timedelta(days=5))
    task(session, "high soon", priority="high", planned_for_date=TODAY, due_date=TODAY + timedelta(days=1))
    task(session, "floor", priority="critical", planned_for_date=TODAY, tags=["daily-floor"])  # shown by the floor instead
    task(session, "due today, not planned", priority="critical", due_date=TODAY)  # due_date alone isn't a choice
    task(session, "planned tomorrow", priority="critical", planned_for_date=TODAY + timedelta(days=1))

    three = daily.todays_three(session, TODAY)
    assert [t.title for t in three.items] == ["critical", "high soon", "high later"]
    assert (three.planned_total, three.more) == (4, 1)

    # Checking one off keeps it in place rather than pulling in a fourth.
    done(session, crit)
    assert [t.title for t in daily.todays_three(session, TODAY).items] == ["critical", "high soon", "high later"]
    assert low.id not in {t.id for t in daily.todays_three(session, TODAY).items}


def test_choosing_todays_three_never_touches_the_due_date(client, auth_headers):
    due = (TODAY + timedelta(days=4)).isoformat()
    t = client.post("/api/tasks", headers=auth_headers, json={"title": "Report", "status": "todo", "due_date": due}).json()
    planned = client.post(f"/api/tasks/{t['id']}/plan-today", headers=auth_headers).json()
    assert planned["planned_for_date"] == TODAY.isoformat() and planned["due_date"] == due
    three = client.get("/api/today/three", headers=auth_headers).json()
    assert [i["id"] for i in three["items"]] == [t["id"]]
    removed = client.post(f"/api/tasks/{t['id']}/unplan-today", headers=auth_headers).json()
    assert removed["planned_for_date"] is None and removed["due_date"] == due
    assert client.get("/api/today/three", headers=auth_headers).json()["items"] == []


# ---- While AI Runs --------------------------------------------------------------------


def test_ai_wait_filtering_and_order(session):
    long_ = task(session, "Write architecture notes", tags=["ai-wait"], estimated_duration=60, priority="critical")
    unknown = task(session, "Clean desk", tags=["ai-wait"])
    short_low = task(session, "Pushups", tags=["ai-wait"], estimated_duration=5, priority="low")
    short_high = task(session, "Apply to one internship", tags=["ai-wait"], estimated_duration=20, priority="high")
    task(session, "Not tagged", estimated_duration=5)
    done(session, task(session, "Done already", tags=["ai-wait"], estimated_duration=5))
    task(session, "Blocked", tags=["ai-wait"], estimated_duration=5, status="blocked")

    q = daily.ai_wait(session, TODAY)
    assert [t.id for t in q.items] == [short_high.id, short_low.id, unknown.id, long_.id]
    assert q.total == 4
    assert [t.id for t in daily.ai_wait(session, TODAY, limit=2).items] == [short_high.id, short_low.id]


def test_ai_wait_shows_only_todays_occurrence_of_a_recurring_task(session):
    recurrence_svc.create_recurring_task(session, RecurringTaskCreate(
        title="Review an old LeetCode problem", pattern=RecurrencePattern.daily,
        start_date=YESTERDAY, tags=["ai-wait"], estimated_duration=15))
    recurrence_svc.ensure_occurrences_for_date(session, YESTERDAY)
    q = daily.ai_wait(session, TODAY)
    assert [t.occurrence_date for t in q.items] == [TODAY]


# ---- Break the default ----------------------------------------------------------------


def test_challenge_persists_for_the_day(session):
    first = daily.challenge(session, TODAY)
    assert first.text and not first.done
    for _ in range(5):  # refreshing never changes it
        assert daily.challenge(session, TODAY).key == first.key
    assert session.get(DailyChallenge, TODAY).shown == [first.key]


def test_another_challenge_rotates_without_repeating_today(session):
    rng = random.Random(7)
    seen = [daily.challenge(session, TODAY, rng=rng).key]
    for _ in range(len(daily.CHALLENGES) - 1):
        nxt = daily.another_challenge(session, TODAY, rng=rng).key
        assert nxt not in seen
        seen.append(nxt)
    # Every one offered: it starts over rather than failing, never the same one twice in a row.
    again = daily.another_challenge(session, TODAY, rng=rng).key
    assert again != seen[-1]
    assert daily.challenge(session, TODAY).key == again


def test_recent_challenges_are_not_repeated(session):
    keys = list(daily.CHALLENGES)
    recent = keys[:daily.CHALLENGE_REPEAT_DAYS]
    for offset, key in enumerate(recent, start=1):  # one chosen on each of the last 7 days
        session.add(DailyChallenge(day=TODAY - timedelta(days=offset), challenge_key=key, shown=[key]))
    session.commit()
    for seed in range(20):
        assert daily.challenge(session, TODAY, rng=random.Random(seed)).key not in recent
        session.delete(session.get(DailyChallenge, TODAY))
        session.commit()


def test_challenge_done_and_undo(client, auth_headers):
    c = client.get("/api/today/challenge", headers=auth_headers).json()
    d = client.post("/api/today/challenge/done", headers=auth_headers).json()
    assert d["done"] and d["key"] == c["key"]
    # Done is done: no rerolling it away.
    assert client.post("/api/today/challenge/another", headers=auth_headers).status_code == 422
    u = client.post("/api/today/challenge/undo", headers=auth_headers).json()
    assert not u["done"]
    assert client.post("/api/today/challenge/another", headers=auth_headers).json()["key"] != c["key"]


# ---- Weekly consistency -----------------------------------------------------------------


def test_week_consistency(session):
    monday = week_start(TODAY)
    # Floor won today, LeetCode solved today, challenge done today.
    done(session, task(session, "Pushups", tags=["daily-floor"], due_date=TODAY))
    problem = LeetCodeProblem(number=1, title="Two Sum", difficulty=LeetCodeDifficulty.easy)
    session.add(problem)
    session.commit()
    session.add(LeetCodeAttempt(problem_id=problem.id, attempted_at=datetime.combine(TODAY, time(9, 0)), solved=True))
    session.add(DailyChallenge(day=TODAY, challenge_key="sunset", shown=["sunset"], completed_at=datetime(2026, 1, 1)))
    session.commit()

    wk = daily.week_consistency(session, TODAY)
    assert wk.start_date == monday and len(wk.days) == 7
    assert wk.elapsed_days == (TODAY - monday).days + 1
    assert (wk.floor_won_days, wk.floor_days, wk.leetcode_days, wk.challenge_days) == (1, 1, 1, 1)
    today_row = next(d for d in wk.days if d.date == TODAY)
    assert today_row.floor_won and today_row.leetcode and today_row.challenge


def test_daily_rest_and_mcp(client, auth_headers):
    client.post("/api/tasks", headers=auth_headers,
                json={"title": "Pushups", "status": "todo", "tags": ["daily-floor"], "due_date": TODAY.isoformat()})
    client.post("/api/tasks", headers=auth_headers,
                json={"title": "Read code", "status": "todo", "tags": ["ai-wait"], "estimated_duration": 15})
    floor = client.get("/api/today/floor", headers=auth_headers).json()
    assert (floor["done"], floor["total"], floor["won"]) == (0, 1, False) and len(floor["week"]) == 7
    assert client.get("/api/today/ai-wait", headers=auth_headers).json()["total"] == 1
    week = client.get("/api/week-summary", headers=auth_headers).json()
    assert week["consistency"]["floor_days"] == 1

    plan = mcp_server.get_daily_plan()
    assert plan["floor"]["total"] == 1
    assert plan["ai_wait"]["items"][0]["title"] == "Read code"
    assert plan["todays_three"]["items"] == [] and plan["challenge"]["text"]
    assert "error" in mcp_server.get_daily_plan("not-a-date")
    assert mcp_server.get_week_summary()["consistency"]["floor_days"] == 1


def test_completing_by_status_stamps_completed_at(session):
    t = tasks_svc.update_task(session, task(session, "x"), TaskUpdate(status=TaskStatus.completed))
    assert t.completed_at is not None
