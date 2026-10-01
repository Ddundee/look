from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from app.deps import get_db, require_auth
from app.schemas import (
    EventCreate,
    EventList,
    EventRead,
    EventUpdate,
    EventWithContext,
    Occurrence,
    OccurrenceEdit,
    ScheduleResponse,
)
from app.services import events as events_service

router = APIRouter(prefix="/api/events", tags=["events"], dependencies=[Depends(require_auth)])


def _event_or_404(session: Session, event_id: str):
    event = events_service.get_event(session, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No event with id '{event_id}'")
    return event


def _unprocessable(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))


@router.get("/schedule", response_model=ScheduleResponse)
def get_schedule(
    start_date: date,
    end_date: Optional[date] = None,
    include_cancelled: bool = False,
    session: Session = Depends(get_db),
):
    end = end_date or start_date
    try:
        occs = events_service.occurrences(session, start_date, end, include_cancelled)
    except ValueError as exc:
        raise _unprocessable(exc)
    return ScheduleResponse(start_date=start_date, end_date=end, occurrences=occs, count=len(occs))


@router.get("/search", response_model=EventList)
def search_events(q: str, limit: int = Query(default=20, ge=1, le=100), session: Session = Depends(get_db)):
    events = [EventRead.model_validate(e) for e in events_service.search_events(session, q, limit)]
    return EventList(events=events, count=len(events))


@router.get("/preview", response_model=List[Occurrence])
def preview(
    start_at: datetime,
    end_at: Optional[datetime] = None,
    all_day: bool = False,
    rrule: Optional[str] = None,
    exdates: List[date] = Query(default=[]),
    session: Session = Depends(get_db),
):
    """Next occurrences for an unsaved event; powers the form preview."""
    try:
        payload = EventCreate(
            title="preview", start_at=start_at, end_at=end_at, all_day=all_day, rrule=rrule, exdates=exdates
        )
        return events_service.preview(session, events_service.draft_event(payload))
    except ValueError as exc:  # pydantic's ValidationError is a ValueError
        raise _unprocessable(exc)


@router.get("/conflicts", response_model=List[Occurrence])
def get_conflicts(
    start_at: datetime,
    end_at: datetime,
    exclude_event_id: Optional[str] = None,
    session: Session = Depends(get_db),
):
    try:
        return events_service.conflicts(session, start_at, end_at, exclude_event_id)
    except ValueError as exc:
        raise _unprocessable(exc)


@router.post("", response_model=EventWithContext, status_code=status.HTTP_201_CREATED)
def create_event(payload: EventCreate, session: Session = Depends(get_db)):
    try:
        event = events_service.create_event(session, payload, source="manual")
    except ValueError as exc:
        raise _unprocessable(exc)
    return events_service.with_context(session, event)


@router.get("/{event_id}", response_model=EventRead)
def get_event(event_id: str, session: Session = Depends(get_db)):
    return _event_or_404(session, event_id)


@router.patch("/{event_id}", response_model=EventWithContext)
def update_event(event_id: str, payload: EventUpdate, session: Session = Depends(get_db)):
    event = _event_or_404(session, event_id)
    try:
        event, dropped = events_service.update_event(session, event, payload)
    except ValueError as exc:
        raise _unprocessable(exc)
    return events_service.with_context(session, event, dropped)


@router.delete("/{event_id}")
def delete_event(event_id: str, session: Session = Depends(get_db)) -> dict:
    events_service.delete_event(session, _event_or_404(session, event_id))
    return {"deleted_id": event_id}


@router.put("/{event_id}/occurrences/{day}", response_model=Occurrence)
def edit_occurrence(event_id: str, day: date, payload: OccurrenceEdit, session: Session = Depends(get_db)):
    event = _event_or_404(session, event_id)
    try:
        return events_service.edit_occurrence(session, event, day, payload)
    except ValueError as exc:
        raise _unprocessable(exc)


@router.delete("/{event_id}/occurrences/{day}", response_model=Occurrence)
def restore_occurrence(event_id: str, day: date, session: Session = Depends(get_db)):
    event = _event_or_404(session, event_id)
    try:
        return events_service.restore_occurrence(session, event, day)
    except ValueError as exc:
        raise _unprocessable(exc)
