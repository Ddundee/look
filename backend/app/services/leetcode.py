"""LeetCode progress tracking: problems, attempts, goals and derived stats.

Shared by the REST router and the MCP server, like the other services.

Definitions (also in docs/LEETCODE.md):

* A problem is identified by its LeetCode number. Logging an attempt for a
  number that's already tracked adds the attempt to that problem; a new
  number creates the problem (title and difficulty required then).
* "Solved today/this week" counts solved attempts, re-solves included, on
  the attempt's local date. The week starts on Monday.
* "Total solved" counts distinct problems with at least one solved attempt.
* Streak: consecutive calendar days with at least one solved attempt. Today
  without a solve doesn't break it until the day is over.
* Topic weakness: over each topic's most recent attempts, the mean of
  (1 - solve rate), (1 - independent rate), hint rate and
  (5 - avg confidence) / 4. Simple and explainable, not a science.
"""

import re
from collections import defaultdict
from datetime import date, timedelta
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

from sqlmodel import Session, col, select

from app.models.enums import LeetCodeDifficulty
from app.models.leetcode import LeetCodeAttempt, LeetCodeGoals, LeetCodeProblem
from app.schemas import (
    DifficultyCounts,
    LeetCodeAttemptCreate,
    LeetCodeAttemptRead,
    LeetCodeGoalsRead,
    LeetCodeGoalsSet,
    LeetCodeProblemCreate,
    LeetCodeProblemRead,
    LeetCodeProblemSummary,
    LeetCodeProblemUpdate,
    LeetCodeStats,
    LeetCodeTopicStat,
    LeetCodeTopicStats,
)
from app.utils import local_now, local_today, utcnow, week_start

DEFAULT_DAILY_TARGET = 2
DEFAULT_WEEKLY_TARGET = 10
TOPIC_RECENT_WINDOW = 10  # each topic's most recent attempts used for weakness
TOPIC_MIN_ATTEMPTS = 2  # fewer recent attempts than this: not rated
WEAK_THRESHOLD = 0.4  # weakness above this is flagged "needs work" (top 3 at most)
MAX_WEAKEST = 3


class DuplicateProblem(ValueError):
    pass


# ---- normalization ---------------------------------------------------------


def normalize_topic(raw: str) -> Optional[str]:
    """'sliding  window' -> 'Sliding Window'; short all-letter words like
    'dp', 'bfs' become acronyms ('DP', 'BFS')."""
    words = raw.strip().split()
    if not words:
        return None
    if len(words) == 1 and words[0].isalpha() and len(words[0]) <= 3:
        return words[0].upper()
    return " ".join("-".join(part[:1].upper() + part[1:].lower() for part in w.split("-")) for w in words)


def normalize_topics(raw: Iterable[str]) -> List[str]:
    seen: Dict[str, str] = {}
    for item in raw:
        topic = normalize_topic(item)
        if topic and topic.lower() not in seen:
            seen[topic.lower()] = topic
    return list(seen.values())


def slugify(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def _url(slug: Optional[str]) -> Optional[str]:
    return f"https://leetcode.com/problems/{slug}/" if slug else None


# ---- problems --------------------------------------------------------------


def get_problem(session: Session, problem_id: str) -> Optional[LeetCodeProblem]:
    return session.get(LeetCodeProblem, problem_id)


def get_problem_by_number(session: Session, number: int) -> Optional[LeetCodeProblem]:
    return session.exec(select(LeetCodeProblem).where(LeetCodeProblem.number == number)).first()


def create_problem(session: Session, payload: LeetCodeProblemCreate) -> LeetCodeProblem:
    if get_problem_by_number(session, payload.number) is not None:
        raise DuplicateProblem(f"Problem {payload.number} is already tracked.")
    slug = payload.slug or slugify(payload.title)
    problem = LeetCodeProblem(
        number=payload.number,
        title=payload.title,
        difficulty=payload.difficulty,
        topics=normalize_topics(payload.topics),
        slug=slug,
        url=payload.url or _url(slug),
    )
    session.add(problem)
    session.commit()
    session.refresh(problem)
    return problem


def update_problem(session: Session, problem: LeetCodeProblem, changes: LeetCodeProblemUpdate) -> LeetCodeProblem:
    data = changes.model_dump(exclude_unset=True)
    for required in ("title", "difficulty"):
        if required in data and data[required] is None:
            raise ValueError(f"{required} can't be cleared; give it a value instead.")
    if "topics" in data:
        data["topics"] = normalize_topics(data["topics"] or [])
    for field_name, value in data.items():
        setattr(problem, field_name, value)
    if "title" in data and "slug" not in data:
        problem.slug = slugify(problem.title)
        problem.url = _url(problem.slug)
    problem.updated_at = utcnow()
    session.add(problem)
    session.commit()
    session.refresh(problem)
    return problem


# ---- attempts --------------------------------------------------------------


def log_attempt(
    session: Session, payload: LeetCodeAttemptCreate, source: str = "manual"
) -> Tuple[LeetCodeAttempt, LeetCodeProblem, bool]:
    """Record an attempt; returns (attempt, problem, problem_was_created)."""
    problem = get_problem_by_number(session, payload.problem_number)
    created = problem is None
    topics = normalize_topics(payload.topics)
    if problem is None:
        if not payload.title or payload.difficulty is None:
            raise ValueError(
                f"Problem {payload.problem_number} isn't tracked yet: give its title and difficulty "
                "the first time you log it."
            )
        slug = slugify(payload.title)
        problem = LeetCodeProblem(
            number=payload.problem_number, title=payload.title, difficulty=payload.difficulty,
            topics=topics, slug=slug, url=_url(slug),
        )
    else:
        # Later details win for title/difficulty; topics accumulate.
        changed = False
        if payload.title and payload.title != problem.title:
            problem.title, problem.slug = payload.title, slugify(payload.title)
            problem.url = _url(problem.slug)
            changed = True
        if payload.difficulty is not None and payload.difficulty != problem.difficulty:
            problem.difficulty, changed = payload.difficulty, True
        merged = normalize_topics([*(problem.topics or []), *topics])
        if merged != (problem.topics or []):
            problem.topics, changed = merged, True
        if changed:
            problem.updated_at = utcnow()
    session.add(problem)
    session.flush()

    independent = (
        payload.solved_independently
        if payload.solved_independently is not None
        else payload.solved and not payload.hint_used
    )
    attempt = LeetCodeAttempt(
        problem_id=problem.id,
        attempted_at=payload.attempted_at or local_now(),
        solved=payload.solved,
        solved_independently=independent,
        hint_used=payload.hint_used,
        duration_minutes=payload.duration_minutes,
        language=(payload.language or "").strip() or None,
        confidence=payload.confidence,
        notes=(payload.notes or "").strip() or None,
        source=source,
    )
    session.add(attempt)
    session.commit()
    session.refresh(attempt)
    session.refresh(problem)
    return attempt, problem, created


def get_attempt(session: Session, attempt_id: str) -> Optional[LeetCodeAttempt]:
    return session.get(LeetCodeAttempt, attempt_id)


def delete_attempt(session: Session, attempt: LeetCodeAttempt) -> None:
    """Deletes the attempt only; the problem stays tracked."""
    session.delete(attempt)
    session.commit()


def attempt_read(attempt: LeetCodeAttempt, problem: LeetCodeProblem) -> LeetCodeAttemptRead:
    return LeetCodeAttemptRead(
        **{k: getattr(attempt, k) for k in LeetCodeAttemptRead.model_fields if k != "problem"},
        problem=LeetCodeProblemRead.model_validate(problem),
    )


def _all(session: Session) -> Tuple[List[LeetCodeAttempt], Dict[str, LeetCodeProblem]]:
    problems = {p.id: p for p in session.exec(select(LeetCodeProblem)).all()}
    attempts = list(
        session.exec(
            select(LeetCodeAttempt).order_by(col(LeetCodeAttempt.attempted_at).desc(), col(LeetCodeAttempt.created_at).desc())
        )
    )
    return attempts, problems


def _has_topic(problem: LeetCodeProblem, topic: Optional[str]) -> bool:
    if not topic:
        return True
    wanted = (normalize_topic(topic) or "").lower()
    return any(t.lower() == wanted for t in problem.topics or [])


def list_attempts(
    session: Session,
    limit: int = 50,
    difficulty: Optional[str] = None,
    topic: Optional[str] = None,
    solved: Optional[bool] = None,
    problem_id: Optional[str] = None,
) -> List[LeetCodeAttemptRead]:
    attempts, problems = _all(session)
    out: List[LeetCodeAttemptRead] = []
    for attempt in attempts:
        problem = problems[attempt.problem_id]
        if problem_id and attempt.problem_id != problem_id:
            continue
        if difficulty and problem.difficulty != difficulty:
            continue
        if solved is not None and attempt.solved != solved:
            continue
        if not _has_topic(problem, topic):
            continue
        out.append(attempt_read(attempt, problem))
        if len(out) >= max(1, min(limit, 500)):
            break
    return out


def _summaries(attempts: Sequence[LeetCodeAttempt], problems: Dict[str, LeetCodeProblem]) -> Dict[str, LeetCodeProblemSummary]:
    out = {pid: LeetCodeProblemSummary.model_validate(p) for pid, p in problems.items()}
    for attempt in attempts:  # newest first
        summary = out[attempt.problem_id]
        summary.attempts += 1
        summary.solved = summary.solved or attempt.solved
        if summary.last_attempted_at is None:
            summary.last_attempted_at = attempt.attempted_at
            summary.last_confidence = attempt.confidence
    return out


def problem_summary(session: Session, problem: LeetCodeProblem) -> LeetCodeProblemSummary:
    attempts = session.exec(
        select(LeetCodeAttempt)
        .where(LeetCodeAttempt.problem_id == problem.id)
        .order_by(col(LeetCodeAttempt.attempted_at).desc())
    ).all()
    return _summaries(attempts, {problem.id: problem})[problem.id]


def list_problems(
    session: Session, difficulty: Optional[str] = None, topic: Optional[str] = None, q: Optional[str] = None
) -> List[LeetCodeProblemSummary]:
    attempts, problems = _all(session)
    query = (q or "").strip().lower()
    result = []
    for summary in _summaries(attempts, problems).values():
        if difficulty and summary.difficulty != difficulty:
            continue
        if not _has_topic(problems[summary.id], topic):
            continue
        if query and query not in summary.title.lower() and query != str(summary.number):
            continue
        result.append(summary)
    return sorted(result, key=lambda s: (s.last_attempted_at is None, -(s.last_attempted_at.timestamp() if s.last_attempted_at else 0), s.number))


# ---- goals -----------------------------------------------------------------


def get_goals(session: Session) -> LeetCodeGoalsRead:
    row = session.get(LeetCodeGoals, 1)
    if row is None:
        return LeetCodeGoalsRead(daily_target=DEFAULT_DAILY_TARGET, weekly_target=DEFAULT_WEEKLY_TARGET, customized=False)
    return LeetCodeGoalsRead(daily_target=row.daily_target, weekly_target=row.weekly_target, customized=True)


def set_goals(session: Session, payload: LeetCodeGoalsSet) -> LeetCodeGoalsRead:
    row = session.get(LeetCodeGoals, 1) or LeetCodeGoals(id=1)
    row.daily_target = payload.daily_target
    row.weekly_target = payload.weekly_target
    row.updated_at = utcnow()
    session.add(row)
    session.commit()
    return get_goals(session)


# ---- stats -----------------------------------------------------------------


def streaks(solved_days: Set[date], today: date) -> Tuple[int, int]:
    """(current, best). The current streak may end yesterday: today isn't
    over, so not having solved anything yet doesn't break it."""
    best = run = 0
    previous: Optional[date] = None
    for day in sorted(solved_days):
        run = run + 1 if previous is not None and day - previous == timedelta(days=1) else 1
        best = max(best, run)
        previous = day
    end = today if today in solved_days else today - timedelta(days=1)
    current = 0
    while end in solved_days:
        current += 1
        end -= timedelta(days=1)
    return current, best


def _rate(part: int, whole: int) -> Optional[float]:
    return round(part / whole, 2) if whole else None


def _pct(value: float) -> str:
    return f"{round(value * 100)}%"


def _join(names: List[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def _topic_rows(attempts: Sequence[LeetCodeAttempt], problems: Dict[str, LeetCodeProblem]) -> List[LeetCodeTopicStat]:
    by_topic: Dict[str, List[LeetCodeAttempt]] = defaultdict(list)  # newest first, like `attempts`
    topic_problems: Dict[str, Set[str]] = defaultdict(set)
    for problem in problems.values():
        for topic in problem.topics or []:
            topic_problems[topic].add(problem.id)
    for attempt in attempts:
        for topic in problems[attempt.problem_id].topics or []:
            by_topic[topic].append(attempt)

    rows = []
    for topic, problem_ids in topic_problems.items():
        history = by_topic.get(topic, [])
        recent = history[:TOPIC_RECENT_WINDOW]
        n = len(recent)
        solved = sum(a.solved for a in recent)
        independent = sum(a.solved_independently for a in recent)
        hints = sum(a.hint_used for a in recent)
        confidences = [a.confidence for a in recent if a.confidence is not None]
        avg_conf = round(sum(confidences) / len(confidences), 1) if confidences else None
        solve_rate = solved / n if n else 0.0
        independent_rate = independent / n if n else 0.0
        hint_rate = hints / n if n else 0.0

        weakness = None
        reasons: List[str] = []
        if n >= TOPIC_MIN_ATTEMPTS:
            factors = [1 - solve_rate, 1 - independent_rate, hint_rate]
            if avg_conf is not None:
                factors.append((5 - avg_conf) / 4)
            weakness = round(sum(factors) / len(factors), 2)
            reasons.append(f"solved {solved} of {n} recent attempts")
            if hints:
                reasons.append(f"used hints on {hints} of {n}")
            reasons.append(f"solved on your own {independent} of {n}")
            if avg_conf is not None:
                reasons.append(f"average confidence {avg_conf}/5")
        else:
            reasons.append(f"only {n} attempt{'s' if n != 1 else ''} so far; needs {TOPIC_MIN_ATTEMPTS} to judge")

        solved_problem_ids = {a.problem_id for a in history if a.solved}
        rows.append(
            LeetCodeTopicStat(
                topic=topic,
                problems=len(problem_ids),
                solved_problems=len(solved_problem_ids & problem_ids),
                attempts=len(history),
                recent_attempts=n,
                recent_solve_rate=round(solve_rate, 2),
                recent_independent_rate=round(independent_rate, 2),
                recent_hint_rate=round(hint_rate, 2),
                recent_avg_confidence=avg_conf,
                weakness=weakness,
                reasons=reasons,
            )
        )
    rows.sort(key=lambda r: (r.weakness is None, -(r.weakness or 0), -r.attempts, r.topic))
    return rows


def topic_stats(session: Session) -> LeetCodeTopicStats:
    attempts, problems = _all(session)
    rows = _topic_rows(attempts, problems)
    weakest = [r.topic for r in rows if r.weakness is not None and r.weakness > WEAK_THRESHOLD][:MAX_WEAKEST]
    return LeetCodeTopicStats(
        topics=rows, weakest=weakest, recent_window=TOPIC_RECENT_WINDOW, min_attempts=TOPIC_MIN_ATTEMPTS
    )


def _insights(rows: List[LeetCodeTopicStat], overall_hint_rate: Optional[float]) -> List[str]:
    rated = [r for r in rows if r.weakness is not None]
    lines: List[str] = []
    baseline = overall_hint_rate or 0.0
    hinty = [r for r in rated if r.recent_hint_rate >= 0.5 and r.recent_hint_rate >= baseline + 0.15]
    if hinty:
        hinty.sort(key=lambda r: -r.recent_hint_rate)
        names = [r.topic for r in hinty[:3]]
        rate = sum(r.recent_hint_rate for r in hinty[:3]) / len(names)
        lines.append(
            f"You rely on hints more often on {_join(names)} ({_pct(rate)} of recent attempts vs "
            f"{_pct(baseline)} overall)."
        )
    unsolved = [r for r in rated if r.recent_solve_rate < 0.5]
    if unsolved:
        worst = min(unsolved, key=lambda r: r.recent_solve_rate)
        lines.append(f"{worst.topic} is where attempts most often end unsolved ({_pct(worst.recent_solve_rate)} solved recently).")
    low = [r for r in rated if r.recent_avg_confidence is not None and r.recent_avg_confidence <= 2.5]
    if low:
        worst = min(low, key=lambda r: r.recent_avg_confidence)
        lines.append(f"Confidence is lowest on {worst.topic} ({worst.recent_avg_confidence}/5).")
    return lines


def stats(session: Session) -> LeetCodeStats:
    attempts, problems = _all(session)
    today = local_today()
    this_week = week_start(today)

    solved_attempts = [a for a in attempts if a.solved]
    solved_problem_ids = {a.problem_id for a in solved_attempts}
    by_difficulty = DifficultyCounts()
    for pid in solved_problem_ids:
        difficulty = LeetCodeDifficulty(problems[pid].difficulty).value
        setattr(by_difficulty, difficulty, getattr(by_difficulty, difficulty) + 1)

    durations = [a.duration_minutes for a in solved_attempts if a.duration_minutes is not None]
    solved_days = {a.attempted_at.date() for a in solved_attempts}
    current, best = streaks(solved_days, today)
    hint_rate = _rate(sum(a.hint_used for a in attempts), len(attempts))

    return LeetCodeStats(
        total_solved=len(solved_problem_ids),
        solved_by_difficulty=by_difficulty,
        total_attempts=len(attempts),
        solved_attempts=len(solved_attempts),
        avg_solve_minutes=round(sum(durations) / len(durations), 1) if durations else None,
        hint_usage_rate=hint_rate,
        independent_solve_rate=_rate(sum(a.solved_independently for a in attempts), len(attempts)),
        current_streak=current,
        best_streak=best,
        solved_today=sum(1 for a in solved_attempts if a.attempted_at.date() == today),
        solved_this_week=sum(1 for a in solved_attempts if this_week <= a.attempted_at.date() <= today),
        week_start=this_week,
        goals=get_goals(session),
        insights=_insights(_topic_rows(attempts, problems), hint_rate),
    )
