"""Blocks: things you build and place on views (app.services.views).

- A block is a smart list (tasks, assignments and events matching
  filters) or a note. Blocks live in one shared library; a view places a
  block with a `block` widget that holds only the block's id, so editing a
  block changes it on every view at once.
- Configs are validated against the kind's model (SmartListConfig,
  NoteConfig) before saving: known fields only, bounded sizes.
- Deleting a block removes its placements from every view. Blocks only
  read tasks and events; nothing a block shows is ever changed or deleted
  by changing the block.
"""

from datetime import date, time, timedelta
from typing import Any, Dict, Iterable, List, Optional, Tuple

from pydantic import BaseModel, ValidationError
from sqlmodel import Session, select

from app.models.blocks import Block
from app.models.enums import TaskPriority, TaskStatus
from app.models.planning import COLORS
from app.models.task import Task
from app.models.views import View
from app.schemas import (
    BlockCreate,
    BlockItems,
    BlockPlacement,
    BlockRead,
    BlockUpdate,
    NoteConfig,
    Occurrence,
    SmartListConfig,
    WorkItem,
)
from app.services import events as events_service
from app.services import tasks as tasks_service
from app.services.planning import OVERDUE_LOOKBACK_DAYS, _assignment_item, _task_item
from app.utils import local_today, utcnow

MAX_BLOCKS = 100
KINDS: Dict[str, type[BaseModel]] = {"smart_list": SmartListConfig, "note": NoteConfig}
DEFAULT_ICON = {"smart_list": "list", "note": "book"}
# How far "any" looks for assignments and events, which (unlike tasks) need a range.
ANY_PAST_DAYS = OVERDUE_LOOKBACK_DAYS
ANY_FUTURE_DAYS = 60
_RANK = {TaskPriority.critical: 0, TaskPriority.high: 1, TaskPriority.medium: 2, TaskPriority.low: 3}


# ---- validation ------------------------------------------------------------------


def validate_config(kind: str, raw: Dict[str, Any]) -> Dict[str, Any]:
    model = KINDS.get(kind)
    if model is None:
        raise ValueError(f"Unknown block kind '{kind}'.")
    try:
        return model.model_validate(raw).model_dump(mode="json")
    except ValidationError as exc:
        err = exc.errors()[0]
        where = ".".join(map(str, err["loc"]))
        raise ValueError(f"{where}: {err['msg']}" if where else err["msg"]) from None


def _icon(icon: str) -> str:
    from app.services.views import ICONS  # views imports this module

    if icon not in ICONS:
        raise ValueError(f"Unknown icon '{icon}'.")
    return icon


def _color(color: str) -> str:
    if color not in COLORS:
        raise ValueError(f"Unknown color '{color}'.")
    return color


# ---- reading ---------------------------------------------------------------------


def block_ids_in(layout: Optional[Iterable[Any]]) -> List[str]:
    out = []
    for w in layout or []:
        if isinstance(w, dict) and w.get("type") == "block":
            block_id = (w.get("config") or {}).get("block_id")
            if block_id:
                out.append(block_id)
    return out


def _placements(session: Session) -> Dict[str, List[BlockPlacement]]:
    from app.services.views import SYSTEM_VIEWS

    used: Dict[str, List[BlockPlacement]] = {}
    for view in session.exec(select(View)).all():
        name = SYSTEM_VIEWS[view.key].name if view.key in SYSTEM_VIEWS else view.name
        for block_id in dict.fromkeys(block_ids_in(view.layout)):
            used.setdefault(block_id, []).append(BlockPlacement(key=view.key, name=name))
    return used


def _read(block: Block, used: Dict[str, List[BlockPlacement]]) -> BlockRead:
    try:
        config = validate_config(block.kind, block.config)
    except ValueError:  # stored before a field changed: fall back to defaults
        config = KINDS[block.kind]().model_dump(mode="json")
    return BlockRead(id=block.id, name=block.name, icon=block.icon, color=block.color, kind=block.kind,
                     config=config, used_in=used.get(block.id, []), updated_at=block.updated_at)


def list_blocks(session: Session) -> List[BlockRead]:
    used = _placements(session)
    blocks = session.exec(select(Block).order_by(Block.created_at)).all()
    return [_read(b, used) for b in blocks]


def get_block(session: Session, block_id: str) -> Optional[BlockRead]:
    block = session.get(Block, block_id)
    return _read(block, _placements(session)) if block else None


def existing_ids(session: Session, ids: Iterable[str]) -> set:
    ids = set(ids)
    if not ids:
        return set()
    return set(session.exec(select(Block.id).where(Block.id.in_(ids))).all())


# ---- writing ---------------------------------------------------------------------


def create_block(session: Session, payload: BlockCreate) -> BlockRead:
    if len(session.exec(select(Block.id)).all()) >= MAX_BLOCKS:
        raise ValueError(f"You can have at most {MAX_BLOCKS} blocks.")
    block = Block(
        name=payload.name.strip(),
        icon=_icon(payload.icon or DEFAULT_ICON[payload.kind]),
        color=_color(payload.color or "blue"),
        kind=payload.kind,
        config=validate_config(payload.kind, payload.config),
    )
    session.add(block)
    session.commit()
    session.refresh(block)
    return _read(block, {})


def update_block(session: Session, block_id: str, changes: BlockUpdate) -> Optional[BlockRead]:
    block = session.get(Block, block_id)
    if block is None:
        return None
    if changes.name is not None:
        block.name = changes.name.strip()
    if changes.icon is not None:
        block.icon = _icon(changes.icon)
    if changes.color is not None:
        block.color = _color(changes.color)
    if changes.config is not None:
        block.config = validate_config(block.kind, changes.config)
    block.updated_at = utcnow()
    session.add(block)
    session.commit()
    session.refresh(block)
    return _read(block, _placements(session))


def delete_block(session: Session, block_id: str) -> bool:
    """Delete a block and take it off every view. Never touches tasks or
    events."""
    block = session.get(Block, block_id)
    if block is None:
        return False
    for view in session.exec(select(View)).all():
        if block_id in block_ids_in(view.layout):
            view.layout = [w for w in view.layout if not (
                isinstance(w, dict) and w.get("type") == "block" and (w.get("config") or {}).get("block_id") == block_id
            )]
            view.updated_at = utcnow()
            session.add(view)
    session.delete(block)
    session.commit()
    return True


# ---- smart lists -----------------------------------------------------------------


def _window(due: str, today: date) -> Optional[Tuple[date, date]]:
    """The date range a due window covers; None for "no date"."""
    if due == "overdue":
        return today - timedelta(days=OVERDUE_LOOKBACK_DAYS), today - timedelta(days=1)
    if due == "today":
        return today, today
    if due.startswith("next_"):
        return today, today + timedelta(days=int(due[5:]) - 1)
    if due == "this_week":  # Monday to Sunday
        start = today - timedelta(days=today.weekday())
        return start, start + timedelta(days=6)
    if due == "any":
        return today - timedelta(days=ANY_PAST_DAYS), today + timedelta(days=ANY_FUTURE_DAYS)
    return None


def _event_item(occ: Occurrence) -> WorkItem:
    return WorkItem(
        kind="event", id=occ.event_id, title=occ.title, done=False, due_date=occ.start_at.date(),
        due_at=None if occ.all_day else occ.start_at, category=occ.category, course=occ.course, occurrence=occ,
    )


def _matches_text(cfg: SmartListConfig, *texts: Optional[str]) -> bool:
    needle = cfg.search.strip().lower()
    return not needle or any(needle in (t or "").lower() for t in texts)


def _tasks(session: Session, cfg: SmartListConfig, today: date) -> List[WorkItem]:
    # Tasks have no course, so a course filter leaves them out.
    if "tasks" not in cfg.show or cfg.courses:
        return []
    query = select(Task)
    if cfg.status == "open":
        query = query.where(Task.status.in_(tasks_service.ACTIVE_STATUSES))
    elif cfg.status == "done":
        query = query.where(Task.status == TaskStatus.completed)
    if cfg.categories:
        query = query.where(Task.category.in_(cfg.categories))
    if cfg.priorities:
        query = query.where(Task.priority.in_(cfg.priorities))
    if cfg.due == "no_date":
        query = query.where(Task.due_date.is_(None))
    elif cfg.due == "overdue":
        query = query.where(Task.due_date < today)
    elif cfg.due == "today":
        query = query.where((Task.due_date == today) | (Task.planned_for_date == today))
    elif cfg.due != "any":
        lo, hi = _window(cfg.due, today)
        query = query.where(Task.due_date >= lo, Task.due_date <= hi)
    wanted_tags = {t.lower() for t in cfg.tags}
    out = []
    for task in session.exec(query).all():
        if wanted_tags and not wanted_tags & {t.lower() for t in task.tags or []}:
            continue
        if not _matches_text(cfg, task.title, task.description):
            continue
        out.append(_task_item(task, today))
    return out


def _occurrence_items(session: Session, cfg: SmartListConfig, today: date) -> List[WorkItem]:
    want_assignments = "assignments" in cfg.show
    want_events = "events" in cfg.show and cfg.due != "overdue" and cfg.status != "done"
    # Priorities and tags are task fields: they leave events out.
    if cfg.priorities or cfg.tags or not (want_assignments or want_events):
        return []
    window = _window(cfg.due, today)
    if window is None:
        return []
    lo, hi = window
    out = []
    for occ in events_service.occurrences(session, lo, hi):
        if occ.cancelled:
            continue
        if occ.deadline:
            if not want_assignments:
                continue
            if cfg.status == "open" and occ.completed or cfg.status == "done" and not occ.completed:
                continue
        else:
            if not want_events:
                continue
            if cfg.due == "any" and occ.end_at.date() < today:  # past events aren't useful in a list
                continue
        if cfg.categories and occ.category not in cfg.categories:
            continue
        if cfg.courses and occ.course_id not in cfg.courses:
            continue
        if not _matches_text(cfg, occ.title, occ.notes):
            continue
        out.append(_assignment_item(occ) if occ.deadline else _event_item(occ))
    return out


def _sort_key(sort: str):
    far = date.max

    def due(i: WorkItem):
        return (i.due_date or far, i.due_at.time() if i.due_at else time.max, _RANK.get(i.priority, 2), i.title.lower())

    if sort == "priority":
        return lambda i: (_RANK.get(i.priority, 2), *due(i))
    if sort == "title":
        return lambda i: (i.title.lower(), *due(i))
    return due


def evaluate(session: Session, config: Dict[str, Any], today: Optional[date] = None) -> BlockItems:
    """The items a smart list shows today, sorted, up to its limit."""
    cfg = SmartListConfig.model_validate(config)
    today = today or local_today()
    items = [*_tasks(session, cfg, today), *_occurrence_items(session, cfg, today)]
    items.sort(key=_sort_key(cfg.sort))
    return BlockItems(items=items[: cfg.limit], total=len(items))


def block_items(session: Session, block_id: str) -> Optional[BlockItems]:
    block = session.get(Block, block_id)
    if block is None:
        return None
    if block.kind != "smart_list":
        raise ValueError("Only smart lists have items.")
    return evaluate(session, validate_config(block.kind, block.config))
