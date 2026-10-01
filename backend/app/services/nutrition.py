"""Food log and daily nutrition targets.

Shared by the REST router and the MCP server, like `app.services.tasks`.
Nutrition numbers are stored exactly as the client sent them; nothing here
looks them up, and nothing here ever deletes data on its own.
"""

from bisect import bisect_right
from datetime import date, time, timedelta
from typing import Dict, List, Optional, Sequence

from sqlmodel import Session, col, select

from app.models.enums import MealType
from app.models.nutrition import FoodEntry, NutritionTarget
from app.schemas import (
    DaySummary,
    FoodEntryCreate,
    FoodEntryRead,
    FoodEntryUpdate,
    HistoryDay,
    HistorySummary,
    MacroRemaining,
    MacroTotals,
    NutritionTargetsRead,
    NutritionTargetsSet,
    TargetsResponse,
)
from app.utils import local_today, utcnow

MAX_HISTORY_DAYS = 366
MACROS = ("calories", "protein_g", "carbs_g", "fat_g")

_MEAL_ORDER = {"breakfast": 0, "lunch": 1, "dinner": 2, "snack": 3}
_REQUIRED_FIELDS = ("name", "calories", "protein_g", "carbs_g", "fat_g", "eaten_on")


# ---------------------------------------------------------------------------
# Entries
# ---------------------------------------------------------------------------


def log_entries(
    session: Session, items: Sequence[FoodEntryCreate], source: str = "manual"
) -> List[FoodEntry]:
    """Insert all items in one commit. Items are already validated by
    their schema, so either every item is stored or (on a DB error) none."""
    if not items:
        raise ValueError("Give at least one food item to log.")
    today = local_today()
    entries = [
        FoodEntry(
            **item.model_dump(exclude={"eaten_on"}),
            eaten_on=item.eaten_on or today,
            source=source,
        )
        for item in items
    ]
    session.add_all(entries)
    session.commit()
    for entry in entries:
        session.refresh(entry)
    return entries


def get_entry(session: Session, entry_id: str) -> Optional[FoodEntry]:
    return session.get(FoodEntry, entry_id)


def update_entry(session: Session, entry: FoodEntry, changes: FoodEntryUpdate) -> FoodEntry:
    data = changes.model_dump(exclude_unset=True)
    for field_name in _REQUIRED_FIELDS:
        if field_name in data and data[field_name] is None:
            raise ValueError(f"{field_name} can't be cleared; give it a value instead.")
    for field_name, value in data.items():
        setattr(entry, field_name, value)
    entry.updated_at = utcnow()
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


def delete_entry(session: Session, entry: FoodEntry) -> None:
    session.delete(entry)
    session.commit()


def _meal_key(entry: FoodEntry) -> int:
    meal = entry.meal.value if isinstance(entry.meal, MealType) else entry.meal
    return _MEAL_ORDER.get(meal, len(_MEAL_ORDER))


def _sort_key(entry: FoodEntry):
    return (_meal_key(entry), entry.eaten_at is None, entry.eaten_at or time.min, entry.created_at)


def entries_on(session: Session, day: date) -> List[FoodEntry]:
    rows = session.exec(select(FoodEntry).where(FoodEntry.eaten_on == day)).all()
    return sorted(rows, key=_sort_key)


def search_entries(session: Session, query: str, limit: int = 20) -> List[FoodEntry]:
    """Case-insensitive substring match on name, newest first. `%` and `_`
    in the query are matched literally."""
    query = query.strip()
    if not query:
        return []
    limit = max(1, min(limit, 100))
    stmt = (
        select(FoodEntry)
        .where(col(FoodEntry.name).icontains(query, autoescape=True))
        .order_by(col(FoodEntry.eaten_on).desc(), col(FoodEntry.created_at).desc())
        .limit(limit)
    )
    return list(session.exec(stmt))


# ---------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------


def _targets_ascending(session: Session) -> List[NutritionTarget]:
    return list(session.exec(select(NutritionTarget).order_by(NutritionTarget.effective_from)))


def _target_on(targets: List[NutritionTarget], day: date) -> Optional[NutritionTarget]:
    idx = bisect_right([t.effective_from for t in targets], day)
    return targets[idx - 1] if idx else None


def targets_for(session: Session, day: date) -> Optional[NutritionTarget]:
    return _target_on(_targets_ascending(session), day)


def set_targets(session: Session, payload: NutritionTargetsSet) -> NutritionTarget:
    """Targets apply from `effective_from` (default today). Setting them
    twice for the same date replaces that date's row."""
    effective_from = payload.effective_from or local_today()
    target = session.exec(
        select(NutritionTarget).where(NutritionTarget.effective_from == effective_from)
    ).first()
    if target is None:
        target = NutritionTarget(calories=payload.calories, effective_from=effective_from)
    target.calories = payload.calories
    target.protein_g = payload.protein_g
    target.carbs_g = payload.carbs_g
    target.fat_g = payload.fat_g
    session.add(target)
    session.commit()
    session.refresh(target)
    return target


def _targets_read(target: Optional[NutritionTarget]) -> Optional[NutritionTargetsRead]:
    return NutritionTargetsRead.model_validate(target) if target else None


def targets_response(session: Session, day: Optional[date] = None) -> TargetsResponse:
    targets = _targets_ascending(session)
    return TargetsResponse(
        current=_targets_read(_target_on(targets, day or local_today())),
        history=[NutritionTargetsRead.model_validate(t) for t in reversed(targets)],
    )


# ---------------------------------------------------------------------------
# Summaries
# ---------------------------------------------------------------------------


def _totals(entries: Sequence[FoodEntry]) -> MacroTotals:
    return MacroTotals(**{m: round(sum(getattr(e, m) for e in entries), 1) for m in MACROS})


def day_summary(session: Session, day: Optional[date] = None) -> DaySummary:
    day = day or local_today()
    entries = entries_on(session, day)
    totals = _totals(entries)
    target = targets_for(session, day)

    remaining: Optional[MacroRemaining] = None
    over: List[str] = []
    if target is not None:
        values: Dict[str, Optional[float]] = {}
        for macro in MACROS:
            goal = getattr(target, macro)
            if goal is None:
                values[macro] = None
                continue
            eaten = getattr(totals, macro)
            values[macro] = round(goal - eaten, 1)
            if eaten > goal:
                over.append(macro)
        remaining = MacroRemaining(**values)

    return DaySummary(
        day=day,
        entries=[FoodEntryRead.model_validate(e) for e in entries],
        totals=totals,
        targets=_targets_read(target),
        remaining=remaining,
        over=over,
    )


def history(session: Session, start: date, end: Optional[date] = None) -> HistorySummary:
    end = end or local_today()
    if end < start:
        raise ValueError("end_date must be on or after start_date.")
    span = (end - start).days + 1
    if span > MAX_HISTORY_DAYS:
        raise ValueError(
            f"A history request can cover at most {MAX_HISTORY_DAYS} days; "
            "split it into smaller ranges."
        )

    rows = session.exec(
        select(FoodEntry).where(FoodEntry.eaten_on >= start, FoodEntry.eaten_on <= end)
    ).all()
    by_day: Dict[date, List[FoodEntry]] = {}
    for entry in rows:
        by_day.setdefault(entry.eaten_on, []).append(entry)

    targets = _targets_ascending(session)
    days: List[HistoryDay] = []
    for offset in range(span):
        day = start + timedelta(days=offset)
        day_entries = by_day.get(day, [])
        days.append(
            HistoryDay(
                day=day,
                entry_count=len(day_entries),
                totals=_totals(day_entries),
                targets=_targets_read(_target_on(targets, day)),
            )
        )

    logged = [d for d in days if d.entry_count]
    averages = (
        MacroTotals(
            **{m: round(sum(getattr(d.totals, m) for d in logged) / len(logged), 1) for m in MACROS}
        )
        if logged
        else None
    )
    return HistorySummary(
        start_date=start, end_date=end, days=days, logged_days=len(logged), averages=averages
    )
