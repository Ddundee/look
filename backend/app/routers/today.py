from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.deps import get_db, require_auth
from app.models.enums import TaskPriority
from app.schemas import TaskListResponse, TodayView, WeekSummary, WorkPlan
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
