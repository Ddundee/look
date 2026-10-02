"""Categories: what kind of thing a task or event is, with a color and a
visual style. Tasks and events store the category's `key` (a plain string,
as they always have), so renaming or restyling never touches them."""

import re
import zlib
from typing import List, Optional

from sqlalchemy import func
from sqlmodel import Session, select

from app.models.events import Event
from app.models.planning import COLORS, STYLES, Category
from app.models.task import RecurrenceRule, Task
from app.schemas import CategoryCreate, CategoryUpdate
from app.utils import utcnow


def default_color(key: str) -> str:
    """A stable color for a category nobody has styled yet."""
    return COLORS[zlib.crc32(key.lower().encode()) % len(COLORS)]


def list_categories(session: Session, include_archived: bool = False) -> List[Category]:
    stmt = select(Category)
    if not include_archived:
        stmt = stmt.where(Category.archived == False)  # noqa: E712
    return list(session.exec(stmt.order_by(Category.is_system.desc(), func.lower(Category.name))).all())


def get_by_key(session: Session, key: str) -> Optional[Category]:
    return session.exec(select(Category).where(Category.key == key)).first()


def ensure(session: Session, key: str) -> Category:
    """The category for `key`, created with a default look if it's new (a
    task or event used a category name nothing has defined yet). Doesn't
    commit; the caller's commit saves it."""
    key = key.strip()
    existing = get_by_key(session, key)
    if existing is not None:
        return existing
    category = Category(key=key, name=key[:1].upper() + key[1:], color=default_color(key))
    session.add(category)
    session.flush()
    return category


def _key_for(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip())


def create_category(session: Session, payload: CategoryCreate) -> Category:
    key = _key_for(payload.name)
    clash = session.exec(select(Category).where(func.lower(Category.key) == key.lower())).first()
    if clash is not None:
        raise ValueError(f"A category called '{clash.name}' already exists.")
    category = Category(key=key, name=payload.name.strip(), color=payload.color or default_color(key),
                        style=payload.style or "solid")
    session.add(category)
    session.commit()
    session.refresh(category)
    return category


def update_category(session: Session, category: Category, changes: CategoryUpdate) -> Category:
    data = changes.model_dump(exclude_unset=True, exclude_none=True)
    for field, value in data.items():
        setattr(category, field, value.strip() if isinstance(value, str) and field == "name" else value)
    category.updated_at = utcnow()
    session.add(category)
    session.commit()
    session.refresh(category)
    return category


def usage(session: Session, key: str) -> int:
    count = 0
    for model in (Task, RecurrenceRule, Event):
        count += session.exec(select(func.count()).select_from(model).where(model.category == key)).one()
    return count


def delete_category(session: Session, category: Category) -> None:
    """Only unused, non-system categories can be deleted; archive the rest
    (archived ones keep their look on existing items but aren't offered)."""
    if category.is_system:
        raise ValueError(f"'{category.name}' is built in; archive it instead.")
    used = usage(session, category.key)
    if used:
        raise ValueError(f"'{category.name}' is used by {used} item(s); archive it instead.")
    session.delete(category)
    session.commit()


__all__ = ["COLORS", "STYLES"]
