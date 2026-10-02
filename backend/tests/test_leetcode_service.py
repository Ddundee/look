from datetime import date, datetime, timedelta

import pytest
from pydantic import ValidationError
from sqlmodel import select

from app.models import LeetCodeAttempt, LeetCodeProblem
from app.schemas import LeetCodeAttemptCreate, LeetCodeGoalsSet, LeetCodeProblemCreate
from app.services import leetcode as svc

TODAY = date(2026, 10, 7)  # a Wednesday


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr(svc, "local_today", lambda: TODAY)
    monkeypatch.setattr(svc, "local_now", lambda: datetime(2026, 10, 7, 20, 0))


def at(day: date, hour: int = 12) -> datetime:
    return datetime.combine(day, datetime.min.time()).replace(hour=hour)


def log(session, number=560, *, title="Subarray Sum Equals K", difficulty="medium", topics=("Prefix Sum", "Hash Table"),
        when=None, **kw):
    payload = LeetCodeAttemptCreate(
        problem_number=number, title=title, difficulty=difficulty, topics=list(topics),
        attempted_at=when, **kw,
    )
    return svc.log_attempt(session, payload)


# ---- problems and duplicates ----------------------------------------------


def test_create_problem_derives_slug_and_url(session):
    p = svc.create_problem(session, LeetCodeProblemCreate(number=1, title="Two Sum", difficulty="easy",
                                                          topics=["array", " hash  table "]))
    assert p.slug == "two-sum" and p.url == "https://leetcode.com/problems/two-sum/"
    assert p.topics == ["Array", "Hash Table"]


def test_create_duplicate_problem_number_is_refused(session):
    svc.create_problem(session, LeetCodeProblemCreate(number=1, title="Two Sum", difficulty="easy"))
    with pytest.raises(svc.DuplicateProblem, match="already"):
        svc.create_problem(session, LeetCodeProblemCreate(number=1, title="Two Sum again", difficulty="easy"))


def test_logging_the_same_problem_reuses_one_record(session):
    _, first, created = log(session, solved=False)
    _, second, created_again = log(session, title=None, difficulty=None, topics=("prefix sum", "Arrays"))
    assert created and not created_again
    assert first.id == second.id
    assert session.exec(select(LeetCodeProblem)).all() == [second]
    assert len(session.exec(select(LeetCodeAttempt).where(LeetCodeAttempt.problem_id == first.id)).all()) == 2
    assert second.topics == ["Prefix Sum", "Hash Table", "Arrays"]  # merged, normalized, deduped


def test_new_problem_needs_title_and_difficulty(session):
    with pytest.raises(ValueError, match="title and difficulty"):
        log(session, number=42, title=None, difficulty=None)


def test_topic_normalization_keeps_acronyms():
    assert svc.normalize_topics(["dp", "BFS", "sliding  window", "Sliding Window", "", "two-pointers"]) == [
        "DP", "BFS", "Sliding Window", "Two-Pointers",
    ]


# ---- attempt semantics ----------------------------------------------------


def test_independent_defaults_from_solved_and_hint(session):
    clean, _, _ = log(session)
    hinted, _, _ = log(session, hint_used=True)
    failed, _, _ = log(session, solved=False)
    assert (clean.solved, clean.solved_independently) == (True, True)
    assert (hinted.solved, hinted.solved_independently) == (True, False)
    assert (failed.solved, failed.solved_independently) == (False, False)
    assert clean.attempted_at == datetime(2026, 10, 7, 20, 0) and clean.source == "manual"


@pytest.mark.parametrize("bad", [
    {"solved": False, "solved_independently": True},
    {"hint_used": True, "solved_independently": True},
    {"confidence": 6},
    {"confidence": 0},
    {"duration_minutes": -5},
    {"problem_number": 0},
])
def test_attempt_validation(bad):
    data = {"problem_number": 560, "title": "x", "difficulty": "medium", **bad}
    with pytest.raises(ValidationError):
        LeetCodeAttemptCreate(**data)


def test_delete_attempt_keeps_problem(session):
    attempt, problem, _ = log(session)
    svc.delete_attempt(session, attempt)
    assert svc.get_attempt(session, attempt.id) is None
    assert svc.get_problem(session, problem.id) is not None


# ---- stats ----------------------------------------------------------------


def test_stats_by_difficulty_rates_and_durations(session):
    log(session, 1, title="Two Sum", difficulty="easy", topics=["Array"], duration_minutes=10)
    log(session, 560, duration_minutes=23, hint_used=True, confidence=3)
    log(session, 560, solved=False, duration_minutes=40)
    log(session, 124, title="Binary Tree Maximum Path Sum", difficulty="hard", topics=["Trees", "DP"],
        solved=False, hint_used=True)
    s = svc.stats(session)
    assert s.total_solved == 2  # distinct problems: 1 and 560
    assert s.solved_by_difficulty.model_dump() == {"easy": 1, "medium": 1, "hard": 0}
    assert s.total_attempts == 4 and s.solved_attempts == 2
    assert s.avg_solve_minutes == 16.5  # solved attempts with a duration: 10 and 23
    assert s.hint_usage_rate == 0.5  # 2 of 4 attempts
    assert s.independent_solve_rate == 0.25  # 1 of 4 attempts


def test_stats_empty(session):
    s = svc.stats(session)
    assert s.total_solved == 0 and s.current_streak == 0 and s.avg_solve_minutes is None
    assert s.hint_usage_rate is None and s.insights == []
    assert (s.goals.daily_target, s.goals.weekly_target, s.goals.customized) == (2, 10, False)


def test_today_and_week_counts_include_resolves(session):
    monday = TODAY - timedelta(days=2)
    log(session, 1, title="Two Sum", difficulty="easy", when=at(TODAY))
    log(session, 1, title=None, difficulty=None, when=at(TODAY, 21))  # a re-solve counts too
    log(session, 2, title="Add Two Numbers", difficulty="medium", when=at(monday))
    log(session, 3, title="x", difficulty="easy", when=at(monday - timedelta(days=1)))  # last week (Sunday)
    log(session, 4, title="y", difficulty="easy", solved=False, when=at(TODAY))  # unsolved: not counted
    s = svc.stats(session)
    assert s.solved_today == 2
    assert s.solved_this_week == 3
    assert s.week_start == monday


def test_streak_counts_consecutive_solved_days():
    days = {TODAY, TODAY - timedelta(days=1), TODAY - timedelta(days=2), TODAY - timedelta(days=5),
            TODAY - timedelta(days=6), TODAY - timedelta(days=7), TODAY - timedelta(days=8)}
    assert svc.streaks(days, TODAY) == (3, 4)


def test_streak_survives_until_today_is_over():
    yesterday_run = {TODAY - timedelta(days=1), TODAY - timedelta(days=2)}
    assert svc.streaks(yesterday_run, TODAY) == (2, 2)  # nothing yet today: still alive
    gap = {TODAY - timedelta(days=2), TODAY - timedelta(days=3)}
    assert svc.streaks(gap, TODAY) == (0, 2)  # yesterday was empty: broken
    assert svc.streaks(set(), TODAY) == (0, 0)


def test_streak_ignores_unsolved_days(session):
    log(session, when=at(TODAY))
    log(session, solved=False, when=at(TODAY - timedelta(days=1)))
    log(session, when=at(TODAY - timedelta(days=2)))
    assert svc.stats(session).current_streak == 1


# ---- topics and weakness ---------------------------------------------------


def test_topic_aggregation_and_weakness_with_reasons(session):
    for i in range(3):  # Graphs: hints every time, low confidence
        log(session, 200 + i, title=f"g{i}", difficulty="medium", topics=["Graphs"], hint_used=True, confidence=2,
            when=at(TODAY - timedelta(days=i)))
    log(session, 300, title="dp", difficulty="hard", topics=["DP"], solved=False, confidence=1)
    log(session, 301, title="dp2", difficulty="hard", topics=["DP"], hint_used=True, confidence=2)
    for i in range(3):  # Arrays: clean, confident
        log(session, 400 + i, title=f"a{i}", difficulty="easy", topics=["Array"], confidence=5)
    log(session, 500, title="w", difficulty="medium", topics=["Sliding Window"])  # 1 attempt: not rated

    result = svc.topic_stats(session)
    by_name = {t.topic: t for t in result.topics}
    graphs = by_name["Graphs"]
    assert (graphs.problems, graphs.solved_problems, graphs.attempts) == (3, 3, 3)
    assert graphs.recent_hint_rate == 1.0 and graphs.recent_independent_rate == 0.0
    assert graphs.recent_avg_confidence == 2.0
    assert any("hint" in r for r in graphs.reasons)
    assert by_name["Array"].weakness == 0.0
    assert by_name["Sliding Window"].weakness is None  # too few attempts to judge
    assert result.weakest == ["DP", "Graphs"]
    assert [t.topic for t in result.topics][:3] == ["DP", "Graphs", "Array"]


def test_insights_call_out_hint_reliance(session):
    for i in range(2):
        log(session, 300 + i, title=f"dp{i}", difficulty="hard", topics=["DP"], hint_used=True, confidence=2)
        log(session, 200 + i, title=f"g{i}", difficulty="medium", topics=["Graphs"], hint_used=True)
    for i in range(4):
        log(session, 400 + i, title=f"a{i}", difficulty="easy", topics=["Array"])
    insights = svc.stats(session).insights
    assert any("hints" in line and "DP" in line and "Graphs" in line for line in insights), insights


# ---- goals -----------------------------------------------------------------


def test_goals_default_then_persist(session):
    assert svc.get_goals(session).customized is False
    svc.set_goals(session, LeetCodeGoalsSet(daily_target=3, weekly_target=15))
    goals = svc.get_goals(session)
    assert (goals.daily_target, goals.weekly_target, goals.customized) == (3, 15, True)
    svc.set_goals(session, LeetCodeGoalsSet(daily_target=1, weekly_target=5))
    assert svc.get_goals(session).daily_target == 1  # single row, updated in place


def test_list_attempts_filters_and_order(session):
    log(session, 1, title="Two Sum", difficulty="easy", topics=["Array"], when=at(TODAY - timedelta(days=2)))
    log(session, 124, title="hard one", difficulty="hard", topics=["Trees"], solved=False, when=at(TODAY))
    log(session, 560, when=at(TODAY - timedelta(days=1)))
    assert [a.problem.number for a in svc.list_attempts(session)] == [124, 560, 1]
    assert [a.problem.number for a in svc.list_attempts(session, difficulty="hard")] == [124]
    assert [a.problem.number for a in svc.list_attempts(session, topic="prefix sum")] == [560]
    assert [a.problem.number for a in svc.list_attempts(session, solved=False)] == [124]
    assert len(svc.list_attempts(session, limit=2)) == 2


def test_list_problems_summaries(session):
    log(session, 560, solved=False, confidence=2, when=at(TODAY - timedelta(days=1)))
    log(session, 560, title=None, difficulty=None, confidence=4, when=at(TODAY))
    log(session, 1, title="Two Sum", difficulty="easy", topics=["Array"], solved=False)
    problems = {p.number: p for p in svc.list_problems(session)}
    assert (problems[560].attempts, problems[560].solved, problems[560].last_confidence) == (2, True, 4)
    assert problems[1].solved is False
    assert [p.number for p in svc.list_problems(session, difficulty="easy")] == [1]
    assert [p.number for p in svc.list_problems(session, q="subarray")] == [560]
    assert [p.number for p in svc.list_problems(session, q="560")] == [560]
