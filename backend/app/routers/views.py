from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.deps import get_db, require_auth
from app.schemas import ViewCreate, ViewLayoutUpdate, ViewList, ViewOrder, ViewRead, ViewUpdate, WidgetTypeRead
from app.services import views as views_service

router = APIRouter(prefix="/api/views", tags=["views"], dependencies=[Depends(require_auth)])


def _unprocessable(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))


def _not_found(key: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No view '{key}'")


@router.get("", response_model=ViewList)
def list_views(include_archived: bool = False, session: Session = Depends(get_db)):
    return ViewList(views=views_service.list_views(session, include_archived))


@router.get("/widgets", response_model=List[WidgetTypeRead])
def widget_types():
    """The widgets a view can contain, with their sizes and config defaults."""
    return views_service.widget_types()


@router.post("", response_model=ViewRead, status_code=status.HTTP_201_CREATED)
def create_view(payload: ViewCreate, session: Session = Depends(get_db)):
    try:
        return views_service.create_view(session, payload)
    except ValueError as exc:
        raise _unprocessable(exc)


@router.put("/order", response_model=ViewList)
def reorder_views(payload: ViewOrder, session: Session = Depends(get_db)):
    try:
        return ViewList(views=views_service.reorder_views(session, payload.keys))
    except ValueError as exc:
        raise _unprocessable(exc)


@router.get("/{key}", response_model=ViewRead)
def get_view(key: str, session: Session = Depends(get_db)):
    view = views_service.get_view(session, key)
    if view is None:
        raise _not_found(key)
    return view


@router.patch("/{key}", response_model=ViewRead)
def update_view(key: str, payload: ViewUpdate, session: Session = Depends(get_db)):
    try:
        return views_service.update_view(session, key, payload)
    except LookupError:
        raise _not_found(key)
    except ValueError as exc:
        raise _unprocessable(exc)


@router.put("/{key}/layout", response_model=ViewRead)
def save_layout(key: str, payload: ViewLayoutUpdate, session: Session = Depends(get_db)):
    try:
        return views_service.save_layout(session, key, payload.widgets)
    except LookupError:
        raise _not_found(key)
    except ValueError as exc:
        raise _unprocessable(exc)


@router.post("/{key}/reset", response_model=ViewRead)
def reset_view(key: str, session: Session = Depends(get_db)):
    try:
        return views_service.reset_view(session, key)
    except ValueError as exc:
        raise _unprocessable(exc)


@router.delete("/{key}")
def delete_view(key: str, session: Session = Depends(get_db)) -> dict:
    try:
        views_service.delete_view(session, key)
    except LookupError:
        raise _not_found(key)
    except ValueError as exc:
        raise _unprocessable(exc)
    return {"deleted": key}
