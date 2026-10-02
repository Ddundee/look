from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.deps import get_db, require_auth
from app.models.planning import Category
from app.schemas import (
    CategoryCreate,
    CategoryRead,
    CategoryUpdate,
    CourseCreate,
    CourseRead,
    CourseUpdate,
    EventCourseSet,
    EventRead,
)
from app.services import categories as categories_service
from app.services import courses as courses_service
from app.services import events as events_service

router = APIRouter(tags=["planning"], dependencies=[Depends(require_auth)])


def _unprocessable(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))


def _not_found(what: str, ident: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No {what} with id '{ident}'")


# ---- categories -------------------------------------------------------------


@router.get("/api/categories", response_model=List[CategoryRead])
def list_categories(include_archived: bool = False, session: Session = Depends(get_db)):
    return categories_service.list_categories(session, include_archived)


@router.post("/api/categories", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryCreate, session: Session = Depends(get_db)):
    try:
        return categories_service.create_category(session, payload)
    except ValueError as exc:
        raise _unprocessable(exc)


def _category(session: Session, category_id: str) -> Category:
    category = session.get(Category, category_id)
    if category is None:
        raise _not_found("category", category_id)
    return category


@router.patch("/api/categories/{category_id}", response_model=CategoryRead)
def update_category(category_id: str, payload: CategoryUpdate, session: Session = Depends(get_db)):
    return categories_service.update_category(session, _category(session, category_id), payload)


@router.delete("/api/categories/{category_id}")
def delete_category(category_id: str, session: Session = Depends(get_db)) -> dict:
    try:
        categories_service.delete_category(session, _category(session, category_id))
    except ValueError as exc:
        raise _unprocessable(exc)
    return {"deleted_id": category_id}


# ---- courses ----------------------------------------------------------------


@router.get("/api/courses", response_model=List[CourseRead])
def list_courses(include_archived: bool = False, session: Session = Depends(get_db)):
    return [courses_service.read(session, c) for c in courses_service.list_courses(session, include_archived)]


@router.post("/api/courses", response_model=CourseRead, status_code=status.HTTP_201_CREATED)
def create_course(payload: CourseCreate, session: Session = Depends(get_db)):
    try:
        return courses_service.read(session, courses_service.create_course(session, payload))
    except ValueError as exc:
        raise _unprocessable(exc)


@router.patch("/api/courses/{course_id}", response_model=CourseRead)
def update_course(course_id: str, payload: CourseUpdate, session: Session = Depends(get_db)):
    course = courses_service.get_course(session, course_id)
    if course is None:
        raise _not_found("course", course_id)
    try:
        return courses_service.read(session, courses_service.update_course(session, course, payload))
    except ValueError as exc:
        raise _unprocessable(exc)


@router.put("/api/events/{event_id}/course", response_model=EventRead)
def set_event_course(event_id: str, payload: EventCourseSet, session: Session = Depends(get_db)):
    """Choose an event's course by hand (course_id null = no course). Works
    on imported events too (it's Look's own data, not the feed's), and is
    remembered for the rest of that Canvas course."""
    event = events_service.get_event(session, event_id)
    if event is None:
        raise _not_found("event", event_id)
    course = None
    if payload.course_id:
        course = courses_service.get_course(session, payload.course_id)
        if course is None:
            raise _not_found("course", payload.course_id)
    return courses_service.set_event_course(session, event, course)
