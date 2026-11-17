from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session

from app.deps import get_db, require_auth
from app.models.enums import TaskPriority
from app.schemas import (
    AiWaitQueue,
    DailyChallengeRead,
    DailyFloor,
    TaskListResponse,
    TodayView,
    TodaysThree,
    WeekSummary,
    WorkPlan,
)
from app.services import daily as daily_service
from app.services import planning as planning_service
from app.services import tasks as tasks_service
from app.utils import local_today

router = APIRouter(prefix="/api", tags=["planning"], dependencies=[Depends(require_auth)])


@router.get("/today", response_model=TodayView)
def get_today(session: Session = Depends(get_db)):
    today = local_today()
    bundle = tasks_service.get_today_bundle(session, today)
    return TodayView(
        date=bundle["date"],
        scheduled=[tasks_service.serialize_task(t, today) for t in bundle["scheduled"]],
        due_today=[tasks_service.serialize_task(t, today) for t in bundle["due_today"]],
        overdue=[tasks_service.serialize_task(t, today) for t in bundle["overdue"]],
        recurring_today=[
            tasks_service.serialize_task(t, today) for t in bundle["recurring_today"]
        ],
        suggested_high_priority=[
            tasks_service.serialize_task(t, today) for t in bundle["suggested_high_priority"]
        ],
    )


@router.get("/today/work", response_model=WorkPlan)
def get_work(day: Optional[date] = Query(default=None, alias="date"), session: Session = Depends(get_db)):
    """Tasks and imported assignments to do: overdue, today, and open tasks
    with no due date (top few by priority)."""
    return planning_service.work_plan(session, day)


@router.get("/today/floor", response_model=DailyFloor)
def get_floor(session: Session = Depends(get_db)):
    """Today's Daily Floor: tasks tagged daily-floor, progress, streak and
    this week. Complete items with the normal task endpoints."""
    return daily_service.floor(session)


@router.get("/today/three", response_model=TodaysThree)
def get_todays_three(session: Session = Depends(get_db)):
    """Up to three tasks planned for today. Choose with plan-today /
    unplan-today, which never change a due date."""
    return daily_service.todays_three(session)


@router.get("/today/ai-wait", response_model=AiWaitQueue)
def get_ai_wait(limit: int = Query(default=daily_service.AI_WAIT_LIMIT, ge=1, le=50), session: Session = Depends(get_db)):
    return daily_service.ai_wait(session, limit=limit)


@router.get("/today/challenge", response_model=DailyChallengeRead)
def get_challenge(session: Session = Depends(get_db)):
    return daily_service.challenge(session)


@router.post("/today/challenge/another", response_model=DailyChallengeRead)
def another_challenge(session: Session = Depends(get_db)):
    try:
        return daily_service.another_challenge(session)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@router.post("/today/challenge/done", response_model=DailyChallengeRead)
def challenge_done(session: Session = Depends(get_db)):
    return daily_service.set_challenge_done(session, True)


@router.post("/today/challenge/undo", response_model=DailyChallengeRead)
def challenge_undo(session: Session = Depends(get_db)):
    return daily_service.set_challenge_done(session, False)


@router.get("/overdue", response_model=TaskListResponse)
def get_overdue(session: Session = Depends(get_db)):
    tasks = tasks_service.get_overdue(session)
    read = [tasks_service.serialize_task(t) for t in tasks]
    return TaskListResponse(tasks=read, count=len(read))


@router.get("/upcoming", response_model=TaskListResponse)
def get_upcoming(days: int = Query(default=7, ge=1, le=90), session: Session = Depends(get_db)):
    tasks = tasks_service.get_upcoming(session, days=days)
    read = [tasks_service.serialize_task(t) for t in tasks]
    return TaskListResponse(tasks=read, count=len(read))


@router.get("/week-summary", response_model=WeekSummary)
def week_summary(start_date: Optional[date] = None, session: Session = Depends(get_db)):
    bundle = tasks_service.get_week_summary(session, start_date)
    return WeekSummary(
        start_date=bundle["start_date"],
        end_date=bundle["end_date"],
        completed_count=bundle["completed_count"],
        completed_by_category=bundle["completed_by_category"],
        created_count=bundle["created_count"],
        overdue_count=bundle["overdue_count"],
        completed_tasks=[tasks_service.serialize_task(t) for t in bundle["completed_tasks"]],
        consistency=daily_service.week_consistency(session, bundle["start_date"]),
    )


@router.post("/today/carry-forward", response_model=TaskListResponse)
def carry_forward(
    from_date: date,
    to_date: date,
    priorities: Optional[List[TaskPriority]] = Query(default=None),
    session: Session = Depends(get_db),
):
    tasks = tasks_service.carry_unfinished_forward(session, from_date, to_date, priorities)
    read = [tasks_service.serialize_task(t) for t in tasks]
    return TaskListResponse(tasks=read, count=len(read))
