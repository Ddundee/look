from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlmodel import Session

from app.deps import get_db, require_auth
from app.schemas import (
    CalendarSubscriptionCreate,
    CalendarSubscriptionDeleted,
    CalendarSubscriptionList,
    CalendarSubscriptionRead,
    CalendarSubscriptionUpdate,
    CalendarSyncResult,
)
from app.services import calendar_sync

router = APIRouter(tags=["calendars"], dependencies=[Depends(require_auth)])

MAX_UPLOAD_BYTES = calendar_sync.MAX_FEED_BYTES


def _subscription_or_404(session: Session, subscription_id: str):
    sub = calendar_sync.get_subscription(session, subscription_id)
    if sub is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No calendar subscription with id '{subscription_id}'")
    return sub


def _unprocessable(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))


@router.get("/api/calendar-subscriptions", response_model=CalendarSubscriptionList)
def list_subscriptions(session: Session = Depends(get_db)):
    subs = calendar_sync.list_subscriptions(session)
    return CalendarSubscriptionList(subscriptions=subs, count=len(subs))


@router.post("/api/calendar-subscriptions", response_model=CalendarSyncResult, status_code=status.HTTP_201_CREATED)
def create_subscription(payload: CalendarSubscriptionCreate, session: Session = Depends(get_db)):
    """Subscribe to an ICS URL and sync it right away. The subscription is
    kept even if this first sync fails (the error is in the result); it
    retries on its interval."""
    try:
        sub = calendar_sync.create_subscription(session, payload)
    except calendar_sync.DuplicateSubscription as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except ValueError as exc:
        raise _unprocessable(exc)
    return calendar_sync.sync_subscription(session, sub)


@router.get("/api/calendar-subscriptions/{subscription_id}", response_model=CalendarSubscriptionRead)
def get_subscription(subscription_id: str, session: Session = Depends(get_db)):
    return calendar_sync.read(session, _subscription_or_404(session, subscription_id))


@router.patch("/api/calendar-subscriptions/{subscription_id}", response_model=CalendarSubscriptionRead)
def update_subscription(subscription_id: str, payload: CalendarSubscriptionUpdate, session: Session = Depends(get_db)):
    sub = _subscription_or_404(session, subscription_id)
    try:
        sub = calendar_sync.update_subscription(session, sub, payload)
    except ValueError as exc:
        raise _unprocessable(exc)
    return calendar_sync.read(session, sub)


@router.delete("/api/calendar-subscriptions/{subscription_id}", response_model=CalendarSubscriptionDeleted)
def delete_subscription(subscription_id: str, keep_events: bool = False, session: Session = Depends(get_db)):
    """keep_events=true turns the imported events into normal Look events;
    otherwise they're deleted with the subscription."""
    sub = _subscription_or_404(session, subscription_id)
    return calendar_sync.delete_subscription(session, sub, keep_events=keep_events)


@router.post("/api/calendar-subscriptions/{subscription_id}/sync", response_model=CalendarSyncResult)
def sync_subscription(subscription_id: str, session: Session = Depends(get_db)):
    sub = _subscription_or_404(session, subscription_id)
    try:
        return calendar_sync.sync_subscription(session, sub)
    except ValueError as exc:
        raise _unprocessable(exc)


@router.post("/api/calendar-import", response_model=CalendarSyncResult)
async def import_ics_file(
    file: UploadFile = File(...),
    name: str = Form(default=""),
    session: Session = Depends(get_db),
):
    """Import an .ics file once (a snapshot; it never updates by itself).
    Uploading a file with the same name again updates that import."""
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="The file is larger than 10 MB.")
    try:
        return calendar_sync.import_file(session, content, name or file.filename or "Imported calendar")
    except ValueError as exc:
        raise _unprocessable(exc)
