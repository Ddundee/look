from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from app.deps import get_db, require_auth
from app.schemas import (
    DaySummary,
    FoodDeleteResult,
    FoodEntryCreate,
    FoodEntryList,
    FoodEntryRead,
    FoodEntryUpdate,
    FoodEntryWithDay,
    HistorySummary,
    NutritionTargetsSet,
    TargetsResponse,
)
from app.services import nutrition as nutrition_service

router = APIRouter(
    prefix="/api/nutrition", tags=["nutrition"], dependencies=[Depends(require_auth)]
)


def _entry_or_404(session: Session, entry_id: str):
    entry = nutrition_service.get_entry(session, entry_id)
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"No food entry with id '{entry_id}'"
        )
    return entry


def _unprocessable(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))


@router.get("/day", response_model=DaySummary)
def get_day(day: Optional[date] = Query(default=None, alias="date"), session: Session = Depends(get_db)):
    return nutrition_service.day_summary(session, day)


@router.get("/history", response_model=HistorySummary)
def get_history(start_date: date, end_date: Optional[date] = None, session: Session = Depends(get_db)):
    try:
        return nutrition_service.history(session, start_date, end_date)
    except ValueError as exc:
        raise _unprocessable(exc)


@router.post("/entries", response_model=FoodEntryWithDay, status_code=status.HTTP_201_CREATED)
def create_entry(payload: FoodEntryCreate, session: Session = Depends(get_db)):
    [entry] = nutrition_service.log_entries(session, [payload], source="manual")
    return FoodEntryWithDay(
        entry=FoodEntryRead.model_validate(entry),
        day=nutrition_service.day_summary(session, entry.eaten_on),
    )


@router.get("/entries/search", response_model=FoodEntryList)
def search_entries(
    q: str, limit: int = Query(default=20, ge=1, le=100), session: Session = Depends(get_db)
):
    entries = [
        FoodEntryRead.model_validate(e) for e in nutrition_service.search_entries(session, q, limit)
    ]
    return FoodEntryList(entries=entries, count=len(entries))


@router.patch("/entries/{entry_id}", response_model=FoodEntryWithDay)
def update_entry(entry_id: str, payload: FoodEntryUpdate, session: Session = Depends(get_db)):
    entry = _entry_or_404(session, entry_id)
    try:
        entry = nutrition_service.update_entry(session, entry, payload)
    except ValueError as exc:
        raise _unprocessable(exc)
    return FoodEntryWithDay(
        entry=FoodEntryRead.model_validate(entry),
        day=nutrition_service.day_summary(session, entry.eaten_on),
    )


@router.delete("/entries/{entry_id}", response_model=FoodDeleteResult)
def delete_entry(entry_id: str, session: Session = Depends(get_db)):
    entry = _entry_or_404(session, entry_id)
    day = entry.eaten_on
    nutrition_service.delete_entry(session, entry)
    return FoodDeleteResult(deleted_id=entry_id, day=nutrition_service.day_summary(session, day))


@router.get("/targets", response_model=TargetsResponse)
def get_targets(
    day: Optional[date] = Query(default=None, alias="date"), session: Session = Depends(get_db)
):
    return nutrition_service.targets_response(session, day)


@router.put("/targets", response_model=TargetsResponse)
def put_targets(payload: NutritionTargetsSet, session: Session = Depends(get_db)):
    nutrition_service.set_targets(session, payload)
    return nutrition_service.targets_response(session)
