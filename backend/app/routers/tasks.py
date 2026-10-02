from datetime import date, time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from app.deps import get_db, require_auth
from app.models.enums import TaskPriority, TaskStatus
from app.schemas import TaskCreate, TaskListResponse, TaskRead, TaskUpdate
from app.services import tasks as tasks_service
from app.services.priority import rank_tasks
from app.utils import local_today

router = APIRouter(prefix="/api/tasks", tags=["tasks"], dependencies=[Depends(require_auth)])


def _get_or_404(session: Session, task_id: str):
    task = tasks_service.get_task(session, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


@router.get("", response_model=TaskListResponse)
def list_tasks(
    status_: Optional[TaskStatus] = Query(default=None, alias="status"),
    category: Optional[str] = None,
    priority: Optional[TaskPriority] = None,
    tag: Optional[str] = None,
    due_before: Optional[date] = None,
    due_after: Optional[date] = None,
    planned_for_date: Optional[date] = None,
    include_completed: bool = True,
    undated: bool = False,
    q: Optional[str] = None,
    session: Session = Depends(get_db),
):
    if q:
        tasks = tasks_service.search_tasks(session, q)
    else:
        tasks = tasks_service.list_tasks(
            session,
            status=status_,
            category=category,
            priority=priority,
            tag=tag,
            due_before=due_before,
            due_after=due_after,
            planned_for_date=planned_for_date,
            include_completed=include_completed,
            undated=undated,
        )
    read = [tasks_service.serialize_task(t) for t in tasks]
    return TaskListResponse(tasks=read, count=len(read))


@router.get("/ranked", response_model=TaskListResponse)
def ranked_tasks(limit: int = 20, session: Session = Depends(get_db)):
    open_tasks = tasks_service.list_tasks(session, include_completed=False)
    ranked = rank_tasks(open_tasks, local_today())[:limit]
    read = [tasks_service.serialize_task(t) for t, _ in ranked]
    return TaskListResponse(tasks=read, count=len(read))


@router.post("", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
def create_task(payload: TaskCreate, session: Session = Depends(get_db)):
    task = tasks_service.create_task(session, payload)
    return tasks_service.serialize_task(task)


@router.get("/{task_id}", response_model=TaskRead)
def get_task(task_id: str, session: Session = Depends(get_db)):
    task = _get_or_404(session, task_id)
    return tasks_service.serialize_task(task)


@router.patch("/{task_id}", response_model=TaskRead)
def update_task(task_id: str, payload: TaskUpdate, session: Session = Depends(get_db)):
    task = _get_or_404(session, task_id)
    task = tasks_service.update_task(session, task, payload)
    return tasks_service.serialize_task(task)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: str, session: Session = Depends(get_db)):
    task = _get_or_404(session, task_id)
    session.delete(task)
    session.commit()


@router.post("/{task_id}/complete", response_model=TaskRead)
def complete_task(task_id: str, session: Session = Depends(get_db)):
    task = _get_or_404(session, task_id)
    task = tasks_service.complete_task(session, task)
    return tasks_service.serialize_task(task)


@router.post("/{task_id}/cancel", response_model=TaskRead)
def cancel_task(task_id: str, session: Session = Depends(get_db)):
    task = _get_or_404(session, task_id)
    task = tasks_service.cancel_task(session, task)
    return tasks_service.serialize_task(task)


@router.post("/{task_id}/reschedule", response_model=TaskRead)
def reschedule_task(
    task_id: str,
    due_date: Optional[date] = None,
    due_time: Optional[time] = None,
    session: Session = Depends(get_db),
):
    task = _get_or_404(session, task_id)
    task = tasks_service.reschedule_task(session, task, due_date, due_time)
    return tasks_service.serialize_task(task)


@router.post("/{task_id}/priority", response_model=TaskRead)
def set_priority(task_id: str, priority: TaskPriority, session: Session = Depends(get_db)):
    task = _get_or_404(session, task_id)
    task = tasks_service.set_priority(session, task, priority)
    return tasks_service.serialize_task(task)


@router.post("/{task_id}/notes", response_model=TaskRead)
def add_note(task_id: str, note: str, session: Session = Depends(get_db)):
    task = _get_or_404(session, task_id)
    task = tasks_service.add_note(session, task, note)
    return tasks_service.serialize_task(task)


@router.post("/{task_id}/plan-today", response_model=TaskRead)
def plan_today(task_id: str, for_date: Optional[date] = None, session: Session = Depends(get_db)):
    task = _get_or_404(session, task_id)
    task = tasks_service.plan_task_for_today(session, task, for_date)
    return tasks_service.serialize_task(task)


@router.post("/{task_id}/unplan-today", response_model=TaskRead)
def unplan_today(task_id: str, session: Session = Depends(get_db)):
    task = _get_or_404(session, task_id)
    task = tasks_service.remove_task_from_today(session, task)
    return tasks_service.serialize_task(task)
