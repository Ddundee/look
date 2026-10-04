"""Views: pages made of widgets (Dashboard, Today, and views you create).

- Widgets come from a fixed registry (WIDGETS): a view stores only each
  widget's key, size, height, visibility and a small config, all validated
  here before saving. No component names, code or CSS are ever stored.
- System views (Dashboard, Today) have their default layouts in code
  (SYSTEM_VIEWS), so app updates can improve them. A row for a system
  view exists only once it's customized; reset clears the customization.
- Custom views are rows with a stable key (their URL), a name, an icon
  from ICONS, a nav order and visibility. Deleting one deletes only the
  layout, never tasks, events or anything the widgets show.
"""

import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Sequence, Type

from pydantic import BaseModel, ConfigDict, ValidationError
from sqlalchemy import func
from sqlmodel import Session, select

from app.models.views import View
from app.schemas import ViewCreate, ViewRead, ViewUpdate, WidgetInstance, WidgetTypeRead
from app.utils import utcnow

ALL_SIZES = ("quarter", "third", "half", "two_thirds", "full")
ALL_HEIGHTS = ("short", "medium", "tall", "full")
MAX_WIDGETS = 24
MAX_CUSTOM_VIEWS = 50

# Icons a view can use (the frontend maps each to an icon component).
ICONS = (
    "squares", "sun", "graduation-cap", "briefcase", "code", "calendar", "heart",
    "star", "list", "book", "rocket", "coffee", "users", "flag",
)


# ---- widget registry ----------------------------------------------------------


class _NoConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ThingsToDoConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    show_done: bool = True  # keep items checked off today visible
    undated_limit: Literal[0, 3, 6] = 6  # open tasks with no due date


class ScheduleConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    include_assignments: bool = False  # assignments are in Things to do already


class UpcomingConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    days: Literal[3, 7, 14] = 7


@dataclass(frozen=True)
class WidgetSpec:
    title: str
    description: str
    default_size: str
    default_height: str
    sizes: Sequence[str] = ALL_SIZES
    heights: Sequence[str] = ALL_HEIGHTS
    multiple: bool = False
    config: Type[BaseModel] = _NoConfig


# Keys must match the frontend registry (src/lib/views/widgets.ts).
WIDGETS: Dict[str, WidgetSpec] = {
    "quick_add": WidgetSpec("Quick add", "Add a task in plain words: \"Problem set 3 due Fri high priority\".",
                            "half", "short", sizes=("half", "two_thirds", "full"), heights=("short", "medium")),
    "things_to_do": WidgetSpec("Things to do", "Overdue, due today and undated tasks, with imported assignments.",
                               "half", "tall", config=ThingsToDoConfig),
    "schedule": WidgetSpec("Schedule", "Today's events in order, with a line at the current time.",
                           "third", "tall", config=ScheduleConfig),
    "upcoming_assignments": WidgetSpec("Upcoming assignments", "Assignments due in the next few days, not yet done.",
                                       "third", "medium", config=UpcomingConfig),
    "week_preview": WidgetSpec("Next 7 days", "Events and tasks for each of the next seven days.",
                               "half", "medium", sizes=("half", "two_thirds", "full")),
    "nutrition_summary": WidgetSpec("Calories today", "Today's calories and macros against your targets.",
                                    "quarter", "medium", sizes=("quarter", "third", "half")),
    "week_stats": WidgetSpec("This week", "Tasks done, events ahead and average calories this week.",
                             "quarter", "medium", sizes=("quarter", "third", "half")),
    "leetcode_summary": WidgetSpec("LeetCode", "Solved today and this week against your goals, and your streak.",
                                   "third", "short", sizes=("quarter", "third", "half", "full"), heights=("short", "medium")),
}


def widget_types() -> List[WidgetTypeRead]:
    return [
        WidgetTypeRead(type=key, title=s.title, description=s.description, sizes=list(s.sizes),
                       default_size=s.default_size, heights=list(s.heights), default_height=s.default_height,
                       multiple=s.multiple, config_defaults=s.config().model_dump())
        for key, s in WIDGETS.items()
    ]


def _w(type_: str, size: Optional[str] = None, height: Optional[str] = None, **config: Any) -> Dict[str, Any]:
    spec = WIDGETS[type_]
    return {"id": type_.replace("_", "-"), "type": type_, "size": size or spec.default_size,
            "height": height or spec.default_height, "visible": True, "config": config}


# ---- system views and presets (defaults live here, not in migrations) ----------


@dataclass(frozen=True)
class SystemView:
    key: str
    name: str
    icon: str
    layout: List[Dict[str, Any]] = field(default_factory=list)


SYSTEM_VIEWS: Dict[str, SystemView] = {
    # The Dashboard as it has been: overview, calories, week, schedule, to-do, next 7 days.
    "dashboard": SystemView("dashboard", "Dashboard", "squares", [
        _w("quick_add", "half", "short"),
        _w("nutrition_summary", "quarter", "medium"),
        _w("week_stats", "quarter", "medium"),
        _w("schedule", "quarter", "tall"),
        _w("things_to_do", "quarter", "tall"),
        _w("week_preview", "half", "medium"),
    ]),
    # Today as it has been: things to do beside the schedule and LeetCode.
    "today": SystemView("today", "Today", "sun", [
        _w("things_to_do", "two_thirds", "full"),
        _w("schedule", "third", "tall"),
        _w("leetcode_summary", "third", "short"),
    ]),
}

PRESETS: Dict[str, List[Dict[str, Any]]] = {
    "blank": [],
    "planning": [_w("things_to_do", "half", "full"), _w("schedule", "half", "full")],
    "school": [_w("upcoming_assignments", "third", "full", days=14), _w("things_to_do", "third", "full"),
               _w("schedule", "third", "full")],
    "overview": SYSTEM_VIEWS["dashboard"].layout,
}

RESERVED_KEYS = set(SYSTEM_VIEWS) | {"new", "settings", "edit", "views"}


# ---- validation -------------------------------------------------------------


def validate_layout(raw: Sequence[Any]) -> List[Dict[str, Any]]:
    """A layout as stored: every widget a registered type with an allowed
    size and height, its config filled with defaults and checked field by
    field, ids unique, single-instance widgets not repeated. Raises
    ValueError with a readable message."""
    if len(raw) > MAX_WIDGETS:
        raise ValueError(f"A view can have at most {MAX_WIDGETS} widgets.")
    out: List[Dict[str, Any]] = []
    ids, singles = set(), set()
    for index, item in enumerate(raw, start=1):
        try:
            widget = item if isinstance(item, WidgetInstance) else WidgetInstance.model_validate(item)
        except ValidationError as exc:
            raise ValueError(f"Widget {index}: {exc.errors()[0]['msg']}") from None
        spec = WIDGETS.get(widget.type)
        if spec is None:
            raise ValueError(f"Widget {index}: unknown widget type '{widget.type}'.")
        if widget.size not in spec.sizes:
            raise ValueError(f"{spec.title} can't be {widget.size.replace('_', ' ')} width (allowed: {', '.join(spec.sizes)}).")
        if widget.height not in spec.heights:
            raise ValueError(f"{spec.title} can't be {widget.height} (allowed: {', '.join(spec.heights)}).")
        if widget.id in ids:
            raise ValueError(f"Widget id '{widget.id}' is used twice.")
        if not spec.multiple:
            if widget.type in singles:
                raise ValueError(f"{spec.title} can only be added once per view.")
            singles.add(widget.type)
        try:
            config = spec.config.model_validate(widget.config).model_dump()
        except ValidationError as exc:
            err = exc.errors()[0]
            raise ValueError(f"{spec.title}: {'.'.join(map(str, err['loc']))}: {err['msg']}") from None
        ids.add(widget.id)
        out.append({"id": widget.id, "type": widget.type, "size": widget.size, "height": widget.height,
                    "visible": widget.visible, "config": config})
    return out


def _check_icon(icon: str) -> str:
    if icon not in ICONS:
        raise ValueError(f"Unknown icon '{icon}'.")
    return icon


# ---- reading ------------------------------------------------------------------


def _system_read(sv: SystemView, row: Optional[View]) -> ViewRead:
    customized = row is not None and row.layout is not None
    return ViewRead(key=sv.key, name=sv.name, icon=sv.icon, kind="system", show_in_nav=True, sort_order=0,
                    archived=False, customized=customized,
                    widgets=_safe_layout(row.layout) if customized else validate_layout(sv.layout))


def _custom_read(row: View) -> ViewRead:
    return ViewRead(key=row.key, name=row.name, icon=row.icon, kind="custom", show_in_nav=row.show_in_nav,
                    sort_order=row.sort_order, archived=row.archived, customized=False,
                    widgets=_safe_layout(row.layout))


def _safe_layout(layout: Optional[List[Any]]) -> List[Dict[str, Any]]:
    """Stored layouts were validated on save, but a widget removed from the
    registry in a later version shouldn't break the whole view: skip what no
    longer validates."""
    out: List[Dict[str, Any]] = []
    for item in layout or []:
        try:
            out.extend(validate_layout([item]))
        except ValueError:
            continue
    return out


def _row(session: Session, key: str) -> Optional[View]:
    return session.exec(select(View).where(View.key == key)).first()


def list_views(session: Session, include_archived: bool = False) -> List[ViewRead]:
    rows = {r.key: r for r in session.exec(select(View)).all()}
    out = [_system_read(sv, rows.get(key)) for key, sv in SYSTEM_VIEWS.items()]
    custom = sorted((r for r in rows.values() if r.kind == "custom"), key=lambda r: (r.sort_order, r.created_at))
    out += [_custom_read(r) for r in custom if include_archived or not r.archived]
    return out


def get_view(session: Session, key: str) -> Optional[ViewRead]:
    if key in SYSTEM_VIEWS:
        return _system_read(SYSTEM_VIEWS[key], _row(session, key))
    row = _row(session, key)
    return _custom_read(row) if row is not None and row.kind == "custom" else None


# ---- writing ------------------------------------------------------------------


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:32] or "view"


def _unique_key(session: Session, name: str) -> str:
    base = _slug(name)
    key, n = base, 2
    while key in RESERVED_KEYS or _row(session, key) is not None:
        key, n = f"{base}-{n}", n + 1
    return key


def create_view(session: Session, payload: ViewCreate) -> ViewRead:
    count = session.exec(select(func.count()).select_from(View).where(View.kind == "custom")).one()
    if count >= MAX_CUSTOM_VIEWS:
        raise ValueError(f"You can have at most {MAX_CUSTOM_VIEWS} views.")
    last = session.exec(select(func.max(View.sort_order)).where(View.kind == "custom")).one()
    layout = validate_layout([dict(w, id=f"{w['id']}-{uuid.uuid4().hex[:4]}") for w in PRESETS[payload.preset]])
    row = View(key=_unique_key(session, payload.name), name=payload.name, icon=_check_icon(payload.icon),
               kind="custom", show_in_nav=payload.show_in_nav, sort_order=(last or 0) + 1, layout=layout)
    session.add(row)
    session.commit()
    session.refresh(row)
    return _custom_read(row)


def update_view(session: Session, key: str, changes: ViewUpdate) -> ViewRead:
    if key in SYSTEM_VIEWS:
        raise ValueError(f"{SYSTEM_VIEWS[key].name} is built in: its name, icon and place in the sidebar are fixed.")
    row = _row(session, key)
    if row is None:
        raise LookupError(key)
    data = changes.model_dump(exclude_unset=True, exclude_none=True)
    if "icon" in data:
        _check_icon(data["icon"])
    for field_name, value in data.items():
        setattr(row, field_name, value)
    row.updated_at = utcnow()
    session.add(row)
    session.commit()
    session.refresh(row)
    return _custom_read(row)


def save_layout(session: Session, key: str, widgets: Sequence[Any]) -> ViewRead:
    layout = validate_layout(widgets)
    if key in SYSTEM_VIEWS:
        row = _row(session, key)
        if row is None:
            sv = SYSTEM_VIEWS[key]
            row = View(key=key, name=sv.name, icon=sv.icon, kind="system")
        row.layout = layout
    else:
        row = _row(session, key)
        if row is None or row.kind != "custom":
            raise LookupError(key)
        row.layout = layout
    row.updated_at = utcnow()
    session.add(row)
    session.commit()
    return get_view(session, key)


def reset_view(session: Session, key: str) -> ViewRead:
    """Back to the app's current default layout (system views only)."""
    if key not in SYSTEM_VIEWS:
        raise ValueError("Only built-in views have a default layout to reset to.")
    row = _row(session, key)
    if row is not None:
        session.delete(row)
        session.commit()
    return get_view(session, key)


def reorder_views(session: Session, keys: Sequence[str]) -> List[ViewRead]:
    """Set the order of custom views (system pages keep their places)."""
    rows = {r.key: r for r in session.exec(select(View).where(View.kind == "custom")).all()}
    unknown = [k for k in keys if k not in rows]
    if unknown:
        raise ValueError(f"Not custom views: {', '.join(unknown[:3])}.")
    order = list(dict.fromkeys(keys)) + [k for k in sorted(rows, key=lambda k: rows[k].sort_order) if k not in keys]
    for position, key in enumerate(order, start=1):
        rows[key].sort_order = position
        session.add(rows[key])
    session.commit()
    return list_views(session, include_archived=True)


def delete_view(session: Session, key: str) -> None:
    """Delete a custom view: its layout only, never the data widgets show."""
    if key in SYSTEM_VIEWS:
        raise ValueError(f"{SYSTEM_VIEWS[key].name} is built in and can't be deleted; reset its layout instead.")
    row = _row(session, key)
    if row is None or row.kind != "custom":
        raise LookupError(key)
    session.delete(row)
    session.commit()
