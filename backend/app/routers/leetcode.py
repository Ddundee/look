"""LeetCode progress tracking. All logic lives in app.services.leetcode,
shared with the MCP tools."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from app.deps import get_db, require_auth
from app.models.enums import LeetCodeDifficulty
from app.schemas import (
    LeetCodeAttemptCreate,
    LeetCodeAttemptList,
    LeetCodeAttemptLogged,
    LeetCodeGoalsRead,
    LeetCodeGoalsSet,
    LeetCodeProblemCreate,
    LeetCodeProblemDetail,
    LeetCodeProblemList,
    LeetCodeProblemRead,
    LeetCodeProblemUpdate,
    LeetCodeStats,
    LeetCodeTopicStats,
)
from app.services import leetcode as leetcode_service

router = APIRouter(prefix="/api/leetcode", tags=["leetcode"], dependencies=[Depends(require_auth)])


def _unprocessable(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))


def _problem_or_404(session: Session, problem_id: str):
    problem = leetcode_service.get_problem(session, problem_id)
    if problem is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No LeetCode problem with id '{problem_id}'")
    return problem


@router.get("/problems", response_model=LeetCodeProblemList)
def list_problems(
    difficulty: Optional[LeetCodeDifficulty] = None,
    topic: Optional[str] = None,
    q: Optional[str] = None,
    session: Session = Depends(get_db),
):
    problems = leetcode_service.list_problems(session, difficulty=difficulty, topic=topic, q=q)
    return LeetCodeProblemList(problems=problems, count=len(problems))


@router.post("/problems", response_model=LeetCodeProblemRead, status_code=status.HTTP_201_CREATED)
def create_problem(payload: LeetCodeProblemCreate, session: Session = Depends(get_db)):
    try:
        return leetcode_service.create_problem(session, payload)
    except leetcode_service.DuplicateProblem as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))


@router.get("/problems/{problem_id}", response_model=LeetCodeProblemDetail)
def get_problem(problem_id: str, session: Session = Depends(get_db)):
    problem = _problem_or_404(session, problem_id)
    return LeetCodeProblemDetail(
        problem=leetcode_service.problem_summary(session, problem),
        attempts=leetcode_service.list_attempts(session, limit=500, problem_id=problem.id),
    )


@router.patch("/problems/{problem_id}", response_model=LeetCodeProblemRead)
def update_problem(problem_id: str, payload: LeetCodeProblemUpdate, session: Session = Depends(get_db)):
    problem = _problem_or_404(session, problem_id)
    try:
        return leetcode_service.update_problem(session, problem, payload)
    except ValueError as exc:
        raise _unprocessable(exc)


@router.post("/attempts", response_model=LeetCodeAttemptLogged, status_code=status.HTTP_201_CREATED)
def log_attempt(payload: LeetCodeAttemptCreate, session: Session = Depends(get_db)):
    try:
        attempt, problem, created = leetcode_service.log_attempt(session, payload, source="manual")
    except ValueError as exc:
        raise _unprocessable(exc)
    return LeetCodeAttemptLogged(
        attempt=leetcode_service.attempt_read(attempt, problem),
        problem_created=created,
        progress=leetcode_service.stats(session),
    )


@router.get("/attempts", response_model=LeetCodeAttemptList)
def list_attempts(
    limit: int = Query(default=50, ge=1, le=500),
    difficulty: Optional[LeetCodeDifficulty] = None,
    topic: Optional[str] = None,
    solved: Optional[bool] = None,
    session: Session = Depends(get_db),
):
    attempts = leetcode_service.list_attempts(session, limit=limit, difficulty=difficulty, topic=topic, solved=solved)
    return LeetCodeAttemptList(attempts=attempts, count=len(attempts))


@router.delete("/attempts/{attempt_id}")
def delete_attempt(attempt_id: str, session: Session = Depends(get_db)):
    attempt = leetcode_service.get_attempt(session, attempt_id)
    if attempt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No LeetCode attempt with id '{attempt_id}'")
    leetcode_service.delete_attempt(session, attempt)
    return {"deleted_id": attempt_id}


@router.get("/stats", response_model=LeetCodeStats)
def get_stats(session: Session = Depends(get_db)):
    return leetcode_service.stats(session)


@router.get("/topics", response_model=LeetCodeTopicStats)
def get_topics(session: Session = Depends(get_db)):
    return leetcode_service.topic_stats(session)


@router.get("/goals", response_model=LeetCodeGoalsRead)
def get_goals(session: Session = Depends(get_db)):
    return leetcode_service.get_goals(session)


@router.put("/goals", response_model=LeetCodeGoalsRead)
def set_goals(payload: LeetCodeGoalsSet, session: Session = Depends(get_db)):
    return leetcode_service.set_goals(session, payload)
