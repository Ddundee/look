# Food Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log food and macros through ChatGPT (MCP) or the web UI, with effective-dated daily targets, day/week views, and full history readable by MCP clients.

**Architecture:** Two new SQLModel tables (`food_entries`, `nutrition_targets`) created by the existing `create_all`. One service module (`app/services/nutrition.py`) holds all logic and is called by both a new REST router (`/api/nutrition`) and new MCP tools in `mcp_server/server.py`, exactly like tasks. The Next.js frontend gets a `/nutrition` page built from small components, plus a shared `Dialog` extracted from `TaskEditModal`.

**Tech Stack:** FastAPI, SQLModel 0.0.39 / SQLAlchemy 2.0, Pydantic 2.13, `mcp` 2.x (`MCPServer`), pytest; Next.js 16 (App Router, client components), Tailwind v4 tokens, `@phosphor-icons/react`.

**Spec:** `docs/superpowers/specs/2026-10-01-food-tracking-design.md`

## Global Constraints

- Deletes are real (hard delete); nothing is ever deleted or expired automatically.
- Edits update in place; no version history.
- Targets are effective-dated: setting targets inserts a row for `effective_from` (default today) or replaces the row for that same date. Target for a day = greatest `effective_from <= day`.
- Days are computed with `app.utils.local_today()` (`APP_TIMEZONE`).
- The app never looks up nutrition itself; it stores what the client sends.
- `source` is `"mcp"` for MCP-logged entries and `"manual"` for web/REST.
- History requests cover at most 366 days per call.
- No new runtime dependencies (backend or frontend). The week chart is hand-built (no chart library).
- Frontend: semantic tokens from `globals.css` only (no raw palette colors except category-style hues), Phosphor icons only, no em-dashes in visible copy, both themes, phone width.
- Existing backend tests (58 at plan time) keep passing.

## Review Focus

1. **A meal logged with one bad item** (e.g. negative calories in item 3 of 3) must log nothing and say which item is wrong. Pinned in Task 4 (`test_log_food_rejects_whole_batch_and_names_item`).
2. **Logging before any targets exist** must still return totals, with `targets`, `remaining` = null and `over` empty, not crash. Pinned in Task 2 (`test_day_summary_without_targets`).
3. **Changing targets mid-history** must not change how earlier days are judged. Pinned in Task 2 (`test_history_uses_target_in_effect_each_day`).
4. **Clearing a required field through PATCH** (`{"calories": null}`) must be a 422 with a clear message, not a 500 or a null in the DB. Pinned in Task 3 (`test_patch_entry_rejects_clearing_required_field`).
5. **A search string containing `%` or `_`** must match literally, not as a wildcard. Pinned in Task 2 (`test_search_escapes_wildcards`).

---

## File Structure

Backend (all paths under `backend/`):
- `app/models/enums.py` (modify): add `MealType`.
- `app/models/nutrition.py` (create): `FoodEntry`, `NutritionTarget` tables.
- `app/models/__init__.py` (modify): register the new models.
- `app/schemas.py` (modify): nutrition request/response schemas.
- `app/services/nutrition.py` (create): all nutrition logic.
- `app/routers/nutrition.py` (create): REST endpoints.
- `app/main.py` (modify): include router.
- `mcp_server/server.py` (modify): nutrition tools + resource + instructions.
- `tests/test_nutrition_service.py`, `tests/test_nutrition_api.py`, `tests/test_nutrition_mcp.py` (create).

Docs: `docs/MCP.md` (modify): document the new tools.

Frontend (all paths under `frontend/src/`):
- `lib/types.ts`, `lib/api.ts` (modify): nutrition types and client.
- `lib/nutrition.ts` (create): labels, ordering, number formatting.
- `components/Dialog.tsx` (create): shared modal shell (portal, Escape, focus trap, scroll lock, Cmd+Enter).
- `components/TaskEditModal.tsx` (modify): use `Dialog`.
- `components/nutrition/MacroSummary.tsx`, `FoodRow.tsx`, `FoodEntryModal.tsx`, `TargetsModal.tsx`, `WeekChart.tsx` (create).
- `app/nutrition/page.tsx` (create).
- `components/AppShell.tsx` (modify): nav item.

---

### Task 1: Models and schemas

**Files:**
- Modify: `backend/app/models/enums.py`
- Create: `backend/app/models/nutrition.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/schemas.py`
- Test: `backend/tests/test_nutrition_service.py`

**Interfaces:**
- Produces: `MealType` enum; tables `FoodEntry`, `NutritionTarget`; schemas `FoodEntryCreate`, `FoodEntryUpdate`, `FoodEntryRead`, `MacroTotals`, `MacroRemaining`, `NutritionTargetsRead`, `NutritionTargetsSet`, `DaySummary` (field `day`), `HistoryDay`, `HistorySummary`, `TargetsResponse`, `FoodEntryWithDay`, `FoodDeleteResult`, `FoodEntryList`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_nutrition_service.py
from datetime import date, timedelta

import pytest
from pydantic import ValidationError

from app.models.nutrition import FoodEntry, NutritionTarget
from app.schemas import FoodEntryCreate, FoodEntryUpdate, NutritionTargetsSet


def test_food_entry_create_validates_and_strips_name():
    item = FoodEntryCreate(name="  Greek yogurt ", calories=150)
    assert item.name == "Greek yogurt"
    assert item.protein_g == 0 and item.meal is None and item.eaten_on is None


@pytest.mark.parametrize(
    "bad",
    [
        {"name": "", "calories": 100},
        {"name": "   ", "calories": 100},
        {"name": "x", "calories": -1},
        {"name": "x", "calories": 10, "protein_g": -2},
        {"name": "x", "calories": 10, "meal": "brunch"},
    ],
)
def test_food_entry_create_rejects_bad_input(bad):
    with pytest.raises(ValidationError):
        FoodEntryCreate(**bad)


def test_targets_require_positive_calories():
    with pytest.raises(ValidationError):
        NutritionTargetsSet(calories=0)



def test_tables_persist(session):
    from sqlmodel import select

    session.add(FoodEntry(name="Egg", calories=78, eaten_on=date(2026, 10, 1)))
    session.add(NutritionTarget(calories=2400, effective_from=date(2026, 10, 1)))
    session.commit()
    egg = session.exec(select(FoodEntry)).one()
    assert egg.source == "manual" and egg.protein_g == 0
    assert session.exec(select(NutritionTarget)).one().calories == 2400
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_nutrition_service.py -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'app.models.nutrition'`.

- [ ] **Step 3: Implement**

`app/models/enums.py`, append:

```python
class MealType(str, Enum):
    breakfast = "breakfast"
    lunch = "lunch"
    dinner = "dinner"
    snack = "snack"
```

`app/models/nutrition.py`:

```python
import uuid
from datetime import date, datetime, time
from typing import Optional

from sqlmodel import Field, SQLModel

from app.models.enums import MealType
from app.utils import utcnow


def _uuid() -> str:
    return str(uuid.uuid4())


class FoodEntry(SQLModel, table=True):
    """One food item eaten on a given day. The nutrition numbers are
    whatever the client supplied (usually an AI client's estimate); the
    app never looks them up itself."""

    __tablename__ = "food_entries"

    id: str = Field(default_factory=_uuid, primary_key=True)
    name: str
    quantity: Optional[str] = None
    calories: float
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0
    meal: Optional[MealType] = None
    eaten_on: date = Field(index=True)
    eaten_at: Optional[time] = None
    notes: Optional[str] = None
    # "mcp" when logged through an AI client, "manual" from the web UI.
    source: str = Field(default="manual")
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class NutritionTarget(SQLModel, table=True):
    """Daily targets, in effect from `effective_from` until the next row's
    date. Changing targets adds a row rather than editing one, so earlier
    days keep being judged against the targets that applied then."""

    __tablename__ = "nutrition_targets"

    id: str = Field(default_factory=_uuid, primary_key=True)
    calories: float
    protein_g: Optional[float] = None
    carbs_g: Optional[float] = None
    fat_g: Optional[float] = None
    effective_from: date = Field(unique=True, index=True)
    created_at: datetime = Field(default_factory=utcnow)
```

`app/models/__init__.py`: add `MealType` to the enums import, `from app.models.nutrition import FoodEntry, NutritionTarget`, and all three names to `__all__`.

`app/schemas.py`: change the pydantic import to `from pydantic import BaseModel, ConfigDict, Field, field_validator`, add `MealType` to the enums import, and append:

```python
# ---------------------------------------------------------------------------
# Nutrition
# ---------------------------------------------------------------------------


def _clean_name(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    if not value:
        raise ValueError("name can't be blank")
    return value


class FoodEntryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    calories: float = Field(ge=0)
    quantity: Optional[str] = Field(default=None, max_length=100)
    protein_g: float = Field(default=0, ge=0)
    carbs_g: float = Field(default=0, ge=0)
    fat_g: float = Field(default=0, ge=0)
    meal: Optional[MealType] = None
    eaten_on: Optional[date] = None  # defaults to today in APP_TIMEZONE
    eaten_at: Optional[time] = None
    notes: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: Optional[str]) -> Optional[str]:
        return _clean_name(v)


class FoodEntryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    calories: Optional[float] = Field(default=None, ge=0)
    quantity: Optional[str] = Field(default=None, max_length=100)
    protein_g: Optional[float] = Field(default=None, ge=0)
    carbs_g: Optional[float] = Field(default=None, ge=0)
    fat_g: Optional[float] = Field(default=None, ge=0)
    meal: Optional[MealType] = None
    eaten_on: Optional[date] = None
    eaten_at: Optional[time] = None
    notes: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: Optional[str]) -> Optional[str]:
        return _clean_name(v)


class FoodEntryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    quantity: Optional[str]
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    meal: Optional[MealType]
    eaten_on: date
    eaten_at: Optional[time]
    notes: Optional[str]
    source: str
    created_at: datetime
    updated_at: datetime


class MacroTotals(BaseModel):
    calories: float = 0
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0


class MacroRemaining(BaseModel):
    """Target minus eaten; negative means over. None when that macro has
    no target."""

    calories: float
    protein_g: Optional[float] = None
    carbs_g: Optional[float] = None
    fat_g: Optional[float] = None


class NutritionTargetsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    calories: float
    protein_g: Optional[float]
    carbs_g: Optional[float]
    fat_g: Optional[float]
    effective_from: date


class NutritionTargetsSet(BaseModel):
    calories: float = Field(gt=0)
    protein_g: Optional[float] = Field(default=None, ge=0)
    carbs_g: Optional[float] = Field(default=None, ge=0)
    fat_g: Optional[float] = Field(default=None, ge=0)
    effective_from: Optional[date] = None  # defaults to today


class DaySummary(BaseModel):
    day: date
    entries: List[FoodEntryRead]
    totals: MacroTotals
    targets: Optional[NutritionTargetsRead]
    remaining: Optional[MacroRemaining]
    over: List[str]  # macro keys eaten past their target


class HistoryDay(BaseModel):
    day: date
    entry_count: int
    totals: MacroTotals
    targets: Optional[NutritionTargetsRead]


class HistorySummary(BaseModel):
    start_date: date
    end_date: date
    days: List[HistoryDay]
    logged_days: int
    averages: Optional[MacroTotals]  # over days with at least one entry


class TargetsResponse(BaseModel):
    current: Optional[NutritionTargetsRead]
    history: List[NutritionTargetsRead]  # newest first


class FoodEntryWithDay(BaseModel):
    entry: FoodEntryRead
    day: DaySummary


class FoodDeleteResult(BaseModel):
    deleted_id: str
    day: DaySummary


class FoodEntryList(BaseModel):
    entries: List[FoodEntryRead]
    count: int
```

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/bin/pytest tests/test_nutrition_service.py -q && .venv/bin/pytest -q`
Expected: new tests PASS; full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models backend/app/schemas.py backend/tests/test_nutrition_service.py
git commit -m "Add food entry and nutrition target models and schemas"
```

---

### Task 2: Nutrition service

**Files:**
- Create: `backend/app/services/nutrition.py`
- Test: `backend/tests/test_nutrition_service.py` (append)

**Interfaces:**
- Consumes: Task 1 models and schemas.
- Produces (module `app.services.nutrition`):
  - `MAX_HISTORY_DAYS = 366`, `MACROS = ("calories", "protein_g", "carbs_g", "fat_g")`
  - `log_entries(session, items: Sequence[FoodEntryCreate], source: str = "manual") -> List[FoodEntry]` (raises `ValueError` on empty list)
  - `get_entry(session, entry_id: str) -> Optional[FoodEntry]`
  - `update_entry(session, entry: FoodEntry, changes: FoodEntryUpdate) -> FoodEntry` (raises `ValueError` when clearing a required field)
  - `delete_entry(session, entry: FoodEntry) -> None`
  - `entries_on(session, day: date) -> List[FoodEntry]` (meal order, then time, then created)
  - `targets_for(session, day: date) -> Optional[NutritionTarget]`
  - `set_targets(session, payload: NutritionTargetsSet) -> NutritionTarget`
  - `targets_response(session, day: Optional[date] = None) -> TargetsResponse`
  - `day_summary(session, day: Optional[date] = None) -> DaySummary`
  - `history(session, start: date, end: Optional[date] = None) -> HistorySummary` (raises `ValueError`)
  - `search_entries(session, query: str, limit: int = 20) -> List[FoodEntry]`

- [ ] **Step 1: Write the failing tests** (append to `tests/test_nutrition_service.py`)

```python
from app.services import nutrition as svc
from app.utils import local_today


def _log(session, day, **kw):
    item = FoodEntryCreate(**{"name": "food", "calories": 100, "eaten_on": day, **kw})
    return svc.log_entries(session, [item])[0]


def test_log_entries_defaults_to_today_and_source(session):
    entries = svc.log_entries(
        session,
        [FoodEntryCreate(name="Egg", calories=78, protein_g=6), FoodEntryCreate(name="Toast", calories=90)],
        source="mcp",
    )
    assert [e.name for e in entries] == ["Egg", "Toast"]
    assert all(e.eaten_on == local_today() and e.source == "mcp" for e in entries)


def test_log_entries_rejects_empty_list(session):
    with pytest.raises(ValueError):
        svc.log_entries(session, [])


def test_day_summary_without_targets(session):
    d = date(2026, 9, 1)
    _log(session, d, calories=500, protein_g=30)
    s = svc.day_summary(session, d)
    assert s.totals.calories == 500 and s.totals.protein_g == 30
    assert s.targets is None and s.remaining is None and s.over == []


def test_day_summary_totals_remaining_and_over(session):
    d = date(2026, 9, 2)
    svc.set_targets(session, NutritionTargetsSet(calories=2000, protein_g=150, effective_from=d))
    _log(session, d, calories=1200.4, protein_g=160, carbs_g=10)
    _log(session, d, calories=300.2)
    s = svc.day_summary(session, d)
    assert s.totals.calories == 1500.6
    assert s.remaining.calories == 499.4
    assert s.remaining.protein_g == -10
    assert s.remaining.carbs_g is None  # no carb target
    assert s.over == ["protein_g"]


def test_entries_ordered_by_meal_then_time(session):
    from datetime import time

    d = date(2026, 9, 3)
    _log(session, d, name="late snack", meal="snack")
    _log(session, d, name="no meal")
    _log(session, d, name="dinner", meal="dinner")
    _log(session, d, name="breakfast 2", meal="breakfast", eaten_at=time(9, 0))
    _log(session, d, name="breakfast 1", meal="breakfast", eaten_at=time(7, 30))
    names = [e.name for e in svc.entries_on(session, d)]
    assert names == ["breakfast 1", "breakfast 2", "dinner", "late snack", "no meal"]


def test_target_in_effect_by_date_and_same_date_replaces(session):
    svc.set_targets(session, NutritionTargetsSet(calories=2000, effective_from=date(2026, 9, 1)))
    svc.set_targets(session, NutritionTargetsSet(calories=2500, effective_from=date(2026, 9, 10)))
    svc.set_targets(session, NutritionTargetsSet(calories=2600, effective_from=date(2026, 9, 10)))
    assert svc.targets_for(session, date(2026, 8, 31)) is None
    assert svc.targets_for(session, date(2026, 9, 9)).calories == 2000
    assert svc.targets_for(session, date(2026, 9, 10)).calories == 2600
    resp = svc.targets_response(session, date(2026, 9, 20))
    assert resp.current.calories == 2600
    assert [t.calories for t in resp.history] == [2600, 2000]


def test_set_targets_defaults_to_today(session):
    t = svc.set_targets(session, NutritionTargetsSet(calories=2200))
    assert t.effective_from == local_today()


def test_update_and_delete_entry(session):
    e = _log(session, date(2026, 9, 4), name="3 eggs", calories=234)
    updated = svc.update_entry(session, e, FoodEntryUpdate(name="2 eggs", calories=156))
    assert updated.name == "2 eggs" and updated.calories == 156
    assert updated.updated_at >= updated.created_at
    svc.delete_entry(session, updated)
    assert svc.get_entry(session, e.id) is None


def test_update_rejects_clearing_required_field(session):
    e = _log(session, date(2026, 9, 4))
    with pytest.raises(ValueError, match="calories"):
        svc.update_entry(session, e, FoodEntryUpdate.model_validate({"calories": None}))


def test_update_can_clear_optional_field(session):
    e = _log(session, date(2026, 9, 4), meal="lunch", quantity="1 bowl")
    out = svc.update_entry(session, e, FoodEntryUpdate.model_validate({"meal": None, "quantity": None}))
    assert out.meal is None and out.quantity is None


def test_history_zero_fills_and_averages_logged_days(session):
    start = date(2026, 9, 1)
    _log(session, start, calories=2000, protein_g=100)
    _log(session, start + timedelta(days=2), calories=1000, protein_g=50)
    h = svc.history(session, start, start + timedelta(days=3))
    assert [d.entry_count for d in h.days] == [1, 0, 1, 0]
    assert h.days[1].totals.calories == 0
    assert h.logged_days == 2
    assert h.averages.calories == 1500 and h.averages.protein_g == 75


def test_history_without_entries_has_no_averages(session):
    h = svc.history(session, date(2026, 9, 1), date(2026, 9, 2))
    assert h.logged_days == 0 and h.averages is None


def test_history_uses_target_in_effect_each_day(session):
    svc.set_targets(session, NutritionTargetsSet(calories=2000, effective_from=date(2026, 9, 1)))
    svc.set_targets(session, NutritionTargetsSet(calories=1800, effective_from=date(2026, 9, 3)))
    h = svc.history(session, date(2026, 8, 31), date(2026, 9, 3))
    assert [d.targets.calories if d.targets else None for d in h.days] == [None, 2000, 2000, 1800]


def test_history_rejects_reversed_and_oversized_ranges(session):
    with pytest.raises(ValueError):
        svc.history(session, date(2026, 9, 5), date(2026, 9, 1))
    with pytest.raises(ValueError, match="366"):
        svc.history(session, date(2025, 1, 1), date(2026, 1, 2))
    assert len(svc.history(session, date(2025, 1, 1), date(2026, 1, 1)).days) == 366


def test_search_is_case_insensitive_newest_first(session):
    _log(session, date(2026, 9, 1), name="Protein Shake")
    _log(session, date(2026, 9, 5), name="protein shake (big)")
    _log(session, date(2026, 9, 3), name="Banana")
    found = svc.search_entries(session, "SHAKE")
    assert [e.name for e in found] == ["protein shake (big)", "Protein Shake"]
    assert svc.search_entries(session, "   ") == []


def test_search_escapes_wildcards(session):
    _log(session, date(2026, 9, 1), name="100% juice")
    _log(session, date(2026, 9, 1), name="1000 calorie bar")
    assert [e.name for e in svc.search_entries(session, "100%")] == ["100% juice"]
    assert svc.search_entries(session, "_") == []
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_nutrition_service.py -q`
Expected: FAIL, `ImportError: cannot import name 'nutrition' from 'app.services'`.

- [ ] **Step 3: Implement** `app/services/nutrition.py`

```python
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
```

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/bin/pytest tests/test_nutrition_service.py -q && .venv/bin/pytest -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/nutrition.py backend/tests/test_nutrition_service.py
git commit -m "Add nutrition service: food log, effective-dated targets, summaries"
```

---

### Task 3: REST router

**Files:**
- Create: `backend/app/routers/nutrition.py`
- Modify: `backend/app/main.py` (import + `app.include_router(nutrition.router)`)
- Test: `backend/tests/test_nutrition_api.py`

**Interfaces:**
- Consumes: Task 2 service.
- Produces HTTP API under `/api/nutrition` (auth required): `GET /day?date=`, `GET /history?start_date=&end_date=`, `POST /entries` (201, `FoodEntryWithDay`), `GET /entries/search?q=&limit=` (`FoodEntryList`), `PATCH /entries/{id}` (`FoodEntryWithDay`), `DELETE /entries/{id}` (`FoodDeleteResult`), `GET /targets?date=` and `PUT /targets` (`TargetsResponse`).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_nutrition_api.py
from app.utils import local_today

BASE = "/api/nutrition"


def test_requires_auth(client):
    assert client.get(f"{BASE}/day").status_code == 401


def test_create_entry_returns_entry_and_day(client, auth_headers):
    resp = client.post(
        f"{BASE}/entries",
        json={"name": "Oats", "calories": 300, "protein_g": 10, "meal": "breakfast"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["entry"]["source"] == "manual"
    assert body["entry"]["eaten_on"] == local_today().isoformat()
    assert body["day"]["totals"]["calories"] == 300


def test_create_entry_validation_error(client, auth_headers):
    resp = client.post(f"{BASE}/entries", json={"name": "x", "calories": -5}, headers=auth_headers)
    assert resp.status_code == 422


def test_get_day_and_targets_flow(client, auth_headers):
    resp = client.put(f"{BASE}/targets", json={"calories": 2000, "protein_g": 150}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["current"]["calories"] == 2000
    client.post(f"{BASE}/entries", json={"name": "Steak", "calories": 700, "protein_g": 60}, headers=auth_headers)
    day = client.get(f"{BASE}/day", headers=auth_headers).json()
    assert day["remaining"]["calories"] == 1300
    assert day["remaining"]["protein_g"] == 90
    assert client.get(f"{BASE}/targets", headers=auth_headers).json()["history"][0]["calories"] == 2000


def test_patch_and_delete_entry(client, auth_headers):
    created = client.post(f"{BASE}/entries", json={"name": "3 eggs", "calories": 234}, headers=auth_headers).json()
    entry_id = created["entry"]["id"]
    patched = client.patch(f"{BASE}/entries/{entry_id}", json={"name": "2 eggs", "calories": 156}, headers=auth_headers)
    assert patched.status_code == 200
    assert patched.json()["day"]["totals"]["calories"] == 156
    deleted = client.delete(f"{BASE}/entries/{entry_id}", headers=auth_headers)
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted_id": entry_id, "day": deleted.json()["day"]}
    assert deleted.json()["day"]["entries"] == []


def test_patch_entry_rejects_clearing_required_field(client, auth_headers):
    created = client.post(f"{BASE}/entries", json={"name": "Rice", "calories": 200}, headers=auth_headers).json()
    resp = client.patch(f"{BASE}/entries/{created['entry']['id']}", json={"calories": None}, headers=auth_headers)
    assert resp.status_code == 422
    assert "calories" in resp.json()["detail"]


def test_unknown_entry_is_404(client, auth_headers):
    assert client.patch(f"{BASE}/entries/nope", json={"name": "x"}, headers=auth_headers).status_code == 404
    assert client.delete(f"{BASE}/entries/nope", headers=auth_headers).status_code == 404


def test_history_and_range_errors(client, auth_headers):
    today = local_today().isoformat()
    client.post(f"{BASE}/entries", json={"name": "Apple", "calories": 95}, headers=auth_headers)
    resp = client.get(f"{BASE}/history", params={"start_date": today, "end_date": today}, headers=auth_headers)
    assert resp.status_code == 200 and resp.json()["logged_days"] == 1
    bad = client.get(f"{BASE}/history", params={"start_date": "2020-01-01", "end_date": today}, headers=auth_headers)
    assert bad.status_code == 422


def test_search(client, auth_headers):
    client.post(f"{BASE}/entries", json={"name": "Protein shake", "calories": 280}, headers=auth_headers)
    resp = client.get(f"{BASE}/entries/search", params={"q": "shake"}, headers=auth_headers)
    assert resp.status_code == 200 and resp.json()["count"] == 1
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_nutrition_api.py -q`
Expected: FAIL with 404s (router not mounted).

- [ ] **Step 3: Implement** `app/routers/nutrition.py`

```python
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
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


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
def search_entries(q: str, limit: int = Query(default=20, ge=1, le=100), session: Session = Depends(get_db)):
    entries = [FoodEntryRead.model_validate(e) for e in nutrition_service.search_entries(session, q, limit)]
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
def get_targets(day: Optional[date] = Query(default=None, alias="date"), session: Session = Depends(get_db)):
    return nutrition_service.targets_response(session, day)


@router.put("/targets", response_model=TargetsResponse)
def put_targets(payload: NutritionTargetsSet, session: Session = Depends(get_db)):
    nutrition_service.set_targets(session, payload)
    return nutrition_service.targets_response(session)
```

`app/main.py`: `from app.routers import auth, nutrition, recurring, tasks, today` and `app.include_router(nutrition.router)` after `recurring`.

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/bin/pytest tests/test_nutrition_api.py -q && .venv/bin/pytest -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/nutrition.py backend/app/main.py backend/tests/test_nutrition_api.py
git commit -m "Add /api/nutrition REST endpoints"
```

---

### Task 4: MCP tools and docs

**Files:**
- Modify: `backend/mcp_server/server.py` (imports, instructions, tools before the Resources section, resource)
- Modify: `docs/MCP.md` (new "Food and nutrition" tool section + resource line + example prompts)
- Test: `backend/tests/test_nutrition_mcp.py`

**Interfaces:**
- Consumes: Task 2 service.
- Produces MCP tools: `log_food(items)`, `update_food_entry(entry_id, ...)`, `delete_food_entry(entry_id)`, `get_nutrition_day(day=None)`, `get_nutrition_history(start_date, end_date=None)`, `search_food_entries(query, limit=20)`, `get_nutrition_targets(day=None)`, `set_nutrition_targets(calories, protein_g=None, carbs_g=None, fat_g=None, effective_from=None)`; resource `nutrition://today`. Errors return `{"error": str}`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_nutrition_mcp.py
import pytest

import mcp_server.server as mcp_server
from app.utils import local_today


@pytest.fixture()
def mcp_env(use_test_db):
    return use_test_db


def test_log_food_multiple_items_returns_day(mcp_env):
    result = mcp_server.log_food(
        items=[
            {"name": "Eggs", "quantity": "2 large", "calories": 156, "protein_g": 12.6, "meal": "breakfast"},
            {"name": "Toast", "calories": 90, "carbs_g": 17, "meal": "breakfast"},
        ]
    )
    assert "error" not in result
    assert len(result["entries"]) == 2
    assert result["entries"][0]["source"] == "mcp"
    assert result["dates"] == [local_today().isoformat()]
    assert result["day"]["totals"]["calories"] == 246


def test_log_food_rejects_whole_batch_and_names_item(mcp_env):
    result = mcp_server.log_food(
        items=[{"name": "ok", "calories": 100}, {"name": "ok2", "calories": 50}, {"name": "bad", "calories": -1}]
    )
    assert "items[2]" in result["error"] and "calories" in result["error"]
    assert mcp_server.get_nutrition_day()["entries"] == []


def test_log_food_bad_date_and_empty(mcp_env):
    assert "error" in mcp_server.log_food(items=[{"name": "x", "calories": 1, "eaten_on": "yesterday"}])
    assert "error" in mcp_server.log_food(items=[])


def test_log_food_other_day(mcp_env):
    result = mcp_server.log_food(items=[{"name": "Pizza", "calories": 800, "eaten_on": "2026-09-01"}])
    assert result["day"]["day"] == "2026-09-01"


def test_update_and_delete_tools(mcp_env):
    entry = mcp_server.log_food(items=[{"name": "3 eggs", "calories": 234}])["entries"][0]
    updated = mcp_server.update_food_entry(entry["id"], name="2 eggs", calories=156)
    assert updated["entry"]["name"] == "2 eggs"
    assert updated["day"]["totals"]["calories"] == 156
    deleted = mcp_server.delete_food_entry(entry["id"])
    assert deleted["deleted_id"] == entry["id"] and deleted["day"]["entries"] == []
    assert "error" in mcp_server.delete_food_entry(entry["id"])
    assert "error" in mcp_server.update_food_entry("missing", name="x")


def test_targets_tools(mcp_env):
    out = mcp_server.set_nutrition_targets(calories=2400, protein_g=160)
    assert out["targets"]["current"]["calories"] == 2400
    assert out["today"]["remaining"]["protein_g"] == 160
    assert mcp_server.get_nutrition_targets()["current"]["protein_g"] == 160
    assert "error" in mcp_server.set_nutrition_targets(calories=0)


def test_history_and_search_tools(mcp_env):
    mcp_server.log_food(items=[{"name": "Chipotle bowl", "calories": 1100, "eaten_on": "2026-09-01"}])
    h = mcp_server.get_nutrition_history("2026-09-01", "2026-09-02")
    assert h["logged_days"] == 1 and len(h["days"]) == 2
    assert "error" in mcp_server.get_nutrition_history("2020-01-01", "2026-09-02")
    found = mcp_server.search_food_entries("chipotle")
    assert found["count"] == 1 and found["entries"][0]["calories"] == 1100


def test_nutrition_resource(mcp_env):
    assert mcp_server.resource_nutrition_today()["entries"] == []
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_nutrition_mcp.py -q`
Expected: FAIL, `AttributeError: module 'mcp_server.server' has no attribute 'log_food'`.

- [ ] **Step 3: Implement**

In `mcp_server/server.py`:

Imports: add `from pydantic import ValidationError`; extend the schemas import with `FoodEntryCreate, FoodEntryRead, FoodEntryUpdate, NutritionTargetsSet`; add `from app.services import nutrition as nutrition_service`.

Instructions string becomes:

```python
    instructions=(
        "Tools for managing the user's personal tasks: LeetCode/DSA "
        "practice, school assignments, projects, errands, and recurring "
        "daily goals. Also a food log: when the user says what they ate, "
        "estimate calories and macros yourself and record them with "
        "log_food, then tell them their totals and what's left from the "
        "returned day summary. Dates are ISO 'YYYY-MM-DD', times are "
        "'HH:MM' 24-hour."
    ),
```

Before the `# Resources (read-only)` banner, add:

```python
# ---------------------------------------------------------------------------
# Food log and nutrition targets
# ---------------------------------------------------------------------------


def _error(exc: Exception, prefix: str = "") -> dict:
    if isinstance(exc, ValidationError):
        parts = []
        for err in exc.errors():
            loc = ".".join(str(p) for p in err["loc"])
            parts.append(f"{loc}: {err['msg']}" if loc else err["msg"])
        message = "; ".join(parts)
    else:
        message = str(exc)
    return {"error": f"{prefix}{message}"}


def _food_not_found(entry_id: str) -> dict:
    return {"error": f"No food entry with id '{entry_id}'"}


def _entry_dict(entry) -> dict:
    return FoodEntryRead.model_validate(entry).model_dump(mode="json")


def _day_dict(session: Session, day: Optional[date] = None) -> dict:
    return nutrition_service.day_summary(session, day).model_dump(mode="json")


def _parse_day(value: Optional[str], field: str) -> Optional[date]:
    if value is None:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{field} must be an ISO date like 2026-10-01, got {value!r}.")


@mcp.tool()
def log_food(items: List[FoodEntryCreate]) -> dict:
    """Log what the user ate. Split a meal into one item per food
    ("2 eggs and toast" is two items). You supply the nutrition: estimate
    calories, protein_g, carbs_g and fat_g yourself, searching the web for
    restaurant or branded items, and put the basis of the estimate in
    `notes`. If the user refers to something they've had before ("my usual
    shake"), call search_food_entries first and reuse those numbers.
    `meal` is breakfast, lunch, dinner or snack. `eaten_on` defaults to
    today. If any item is invalid nothing is logged. Returns the new
    entries plus the day's totals, targets and what's left: use that to
    tell the user where they stand."""
    parsed: List[FoodEntryCreate] = []
    for index, item in enumerate(items):
        try:
            parsed.append(item if isinstance(item, FoodEntryCreate) else FoodEntryCreate.model_validate(item))
        except ValidationError as exc:
            return _error(exc, prefix=f"items[{index}] ")
    with _session() as session:
        try:
            entries = nutrition_service.log_entries(session, parsed, source="mcp")
        except ValueError as exc:
            return _error(exc)
        dates = sorted({e.eaten_on for e in entries})
        return {
            "entries": [_entry_dict(e) for e in entries],
            "dates": [d.isoformat() for d in dates],
            "day": _day_dict(session, entries[0].eaten_on),
        }


@mcp.tool()
def update_food_entry(
    entry_id: str,
    name: Optional[str] = None,
    calories: Optional[float] = None,
    quantity: Optional[str] = None,
    protein_g: Optional[float] = None,
    carbs_g: Optional[float] = None,
    fat_g: Optional[float] = None,
    meal: Optional[str] = None,
    eaten_on: Optional[str] = None,
    eaten_at: Optional[str] = None,
    notes: Optional[str] = None,
) -> dict:
    """Correct a logged food (e.g. "it was 2 eggs, not 3"). Pass only the
    fields to change. Returns the entry and that day's updated summary."""
    changes = {
        k: v
        for k, v in {
            "name": name, "calories": calories, "quantity": quantity,
            "protein_g": protein_g, "carbs_g": carbs_g, "fat_g": fat_g,
            "meal": meal, "eaten_on": eaten_on, "eaten_at": eaten_at, "notes": notes,
        }.items()
        if v is not None
    }
    try:
        payload = FoodEntryUpdate.model_validate(changes)
    except ValidationError as exc:
        return _error(exc)
    with _session() as session:
        entry = nutrition_service.get_entry(session, entry_id)
        if entry is None:
            return _food_not_found(entry_id)
        try:
            entry = nutrition_service.update_entry(session, entry, payload)
        except ValueError as exc:
            return _error(exc)
        return {"entry": _entry_dict(entry), "day": _day_dict(session, entry.eaten_on)}


@mcp.tool()
def delete_food_entry(entry_id: str) -> dict:
    """Permanently delete a logged food. Only do this when the user asks.
    Returns that day's updated summary."""
    with _session() as session:
        entry = nutrition_service.get_entry(session, entry_id)
        if entry is None:
            return _food_not_found(entry_id)
        day = entry.eaten_on
        nutrition_service.delete_entry(session, entry)
        return {"deleted_id": entry_id, "day": _day_dict(session, day)}


@mcp.tool()
def get_nutrition_day(day: Optional[str] = None) -> dict:
    """Everything eaten on one day (default today) in meal order, with
    totals, the targets in effect, what's left, and which macros are over."""
    try:
        parsed = _parse_day(day, "day")
    except ValueError as exc:
        return _error(exc)
    with _session() as session:
        return _day_dict(session, parsed)


@mcp.tool()
def get_nutrition_history(start_date: str, end_date: Optional[str] = None) -> dict:
    """Per-day totals vs targets for a date range (end defaults to today),
    plus averages over the days that have entries. Up to 366 days per call;
    make several calls for longer spans. The full history is kept forever."""
    try:
        start = _parse_day(start_date, "start_date")
        end = _parse_day(end_date, "end_date")
        with _session() as session:
            return nutrition_service.history(session, start, end).model_dump(mode="json")
    except ValueError as exc:
        return _error(exc)


@mcp.tool()
def search_food_entries(query: str, limit: int = 20) -> dict:
    """Find past food entries by name (case-insensitive), newest first.
    Use this to reuse earlier numbers for foods the user eats often."""
    with _session() as session:
        entries = [_entry_dict(e) for e in nutrition_service.search_entries(session, query, limit)]
        return {"entries": entries, "count": len(entries)}


@mcp.tool()
def get_nutrition_targets(day: Optional[str] = None) -> dict:
    """The daily calorie and macro targets in effect on a day (default
    today) and the full history of target changes, newest first."""
    try:
        parsed = _parse_day(day, "day")
    except ValueError as exc:
        return _error(exc)
    with _session() as session:
        return nutrition_service.targets_response(session, parsed).model_dump(mode="json")


@mcp.tool()
def set_nutrition_targets(
    calories: float,
    protein_g: Optional[float] = None,
    carbs_g: Optional[float] = None,
    fat_g: Optional[float] = None,
    effective_from: Optional[str] = None,
) -> dict:
    """Set daily targets. They apply from `effective_from` (default today)
    onward; earlier days keep the targets they had. A macro left out has
    no target. Returns the targets and today's summary against them."""
    try:
        payload = NutritionTargetsSet(
            calories=calories,
            protein_g=protein_g,
            carbs_g=carbs_g,
            fat_g=fat_g,
            effective_from=_parse_day(effective_from, "effective_from"),
        )
    except ValueError as exc:  # ValidationError is a ValueError
        return _error(exc)
    with _session() as session:
        nutrition_service.set_targets(session, payload)
        return {
            "targets": nutrition_service.targets_response(session).model_dump(mode="json"),
            "today": _day_dict(session),
        }
```

In the Resources section, add:

```python
@mcp.resource("nutrition://today")
def resource_nutrition_today() -> dict:
    """Today's food log, totals and targets."""
    return get_nutrition_day()
```

`docs/MCP.md`: add a `### Food and nutrition` subsection under `## Tools` listing each tool with one line (same style as the task tools), add `nutrition://today` under Resources, and two example prompts: "I had 2 eggs and a slice of toast for breakfast" and "How am I doing on protein this week?".

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/bin/pytest tests/test_nutrition_mcp.py -q && .venv/bin/pytest -q`
Expected: all PASS.

- [ ] **Step 5: Smoke-test the tool schema registers**

Run: `cd backend && .venv/bin/python -c "import asyncio, mcp_server.server as s; tools = asyncio.run(s.mcp.list_tools()); print(sorted(t.name for t in tools if 'food' in t.name or 'nutrition' in t.name))"`
Expected: the 8 nutrition tool names printed, no exception.

- [ ] **Step 6: Commit**

```bash
git add backend/mcp_server/server.py backend/tests/test_nutrition_mcp.py docs/MCP.md
git commit -m "Add food logging and nutrition target MCP tools"
```

---

### Task 5: Frontend data layer and shared Dialog

**Files:**
- Modify: `frontend/src/lib/types.ts`, `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/nutrition.ts`, `frontend/src/components/Dialog.tsx`
- Modify: `frontend/src/components/TaskEditModal.tsx` (use `Dialog`; behavior unchanged)

**Interfaces:**
- Produces types: `MealType`, `MacroKey`, `FoodEntry`, `MacroTotals`, `MacroRemaining`, `NutritionTargets`, `DaySummary`, `HistoryDay`, `HistorySummary`, `TargetsResponse`, `FoodEntryPayload`, `NutritionTargetsPayload`.
- Produces api methods: `getNutritionDay(date?)`, `getNutritionHistory(start, end?)`, `createFoodEntry(payload)`, `updateFoodEntry(id, payload)`, `deleteFoodEntry(id)`, `getNutritionTargets()`, `setNutritionTargets(payload)`.
- Produces `lib/nutrition.ts`: `MEALS`, `MEAL_LABEL`, `MACROS`, `MACRO_LABEL`, `fmtKcal(n)`, `fmtGrams(n)`, `guessMeal(date)`, `groupByMeal(entries)`.
- Produces `<Dialog title onClose onSubmit footer size? >children</Dialog>`.

- [ ] **Step 1: Types** (append to `lib/types.ts`)

```ts
// ---- Nutrition ------------------------------------------------------------

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type MacroKey = "calories" | "protein_g" | "carbs_g" | "fat_g";

export interface FoodEntry {
  id: string;
  name: string;
  quantity: string | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  meal: MealType | null;
  eaten_on: string;
  eaten_at: string | null;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export type MacroTotals = Record<MacroKey, number>;

export interface MacroRemaining {
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export interface NutritionTargets {
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  effective_from: string;
}

export interface DaySummary {
  day: string;
  entries: FoodEntry[];
  totals: MacroTotals;
  targets: NutritionTargets | null;
  remaining: MacroRemaining | null;
  over: MacroKey[];
}

export interface HistoryDay {
  day: string;
  entry_count: number;
  totals: MacroTotals;
  targets: NutritionTargets | null;
}

export interface HistorySummary {
  start_date: string;
  end_date: string;
  days: HistoryDay[];
  logged_days: number;
  averages: MacroTotals | null;
}

export interface TargetsResponse {
  current: NutritionTargets | null;
  history: NutritionTargets[];
}

export interface FoodEntryPayload {
  name?: string;
  calories?: number;
  quantity?: string | null;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  meal?: MealType | null;
  eaten_on?: string;
  eaten_at?: string | null;
  notes?: string | null;
}

export interface NutritionTargetsPayload {
  calories: number;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  effective_from?: string;
}
```

- [ ] **Step 2: API client** (add to the `api` object in `lib/api.ts`, extend the type import)

```ts
  getNutritionDay: (date?: string) => request<DaySummary>(`/api/nutrition/day${qs({ date })}`),
  getNutritionHistory: (start_date: string, end_date?: string) =>
    request<HistorySummary>(`/api/nutrition/history${qs({ start_date, end_date })}`),
  createFoodEntry: (payload: FoodEntryPayload) =>
    request<{ entry: FoodEntry; day: DaySummary }>("/api/nutrition/entries", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateFoodEntry: (id: string, payload: FoodEntryPayload) =>
    request<{ entry: FoodEntry; day: DaySummary }>(`/api/nutrition/entries/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteFoodEntry: (id: string) =>
    request<{ deleted_id: string; day: DaySummary }>(`/api/nutrition/entries/${id}`, {
      method: "DELETE",
    }),
  getNutritionTargets: () => request<TargetsResponse>("/api/nutrition/targets"),
  setNutritionTargets: (payload: NutritionTargetsPayload) =>
    request<TargetsResponse>("/api/nutrition/targets", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
```

`request` turns FastAPI's `detail` into the error message. For 422s from Pydantic, `detail` is an array; update the error branch in `request` so arrays become readable:

```ts
      const body = await res.json();
      if (Array.isArray(body.detail)) {
        detail = body.detail
          .map((d: { loc?: unknown[]; msg?: string }) =>
            [d.loc?.filter((p) => p !== "body").join("."), d.msg].filter(Boolean).join(": ")
          )
          .join("; ");
      } else {
        detail = body.detail || JSON.stringify(body);
      }
```

- [ ] **Step 3: `lib/nutrition.ts`**

```ts
import type { FoodEntry, MacroKey, MealType } from "./types";

export const MEALS: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

export const MEAL_LABEL: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export const MACROS: Exclude<MacroKey, "calories">[] = ["protein_g", "carbs_g", "fat_g"];

export const MACRO_LABEL: Record<MacroKey, string> = {
  calories: "Calories",
  protein_g: "Protein",
  carbs_g: "Carbs",
  fat_g: "Fat",
};

const INT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function fmtKcal(n: number): string {
  return INT.format(Math.round(n));
}

export function fmtGrams(n: number): string {
  return `${INT.format(Math.round(n))}g`;
}

/** Sensible default meal for a new entry logged now. */
export function guessMeal(now: Date = new Date()): MealType {
  const h = now.getHours();
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

export interface MealGroup {
  key: MealType | "other";
  label: string;
  entries: FoodEntry[];
  calories: number;
}

/** Entries arrive in meal order from the API; group them, dropping empty groups. */
export function groupByMeal(entries: FoodEntry[]): MealGroup[] {
  const groups: MealGroup[] = [...MEALS, "other" as const].map((key) => ({
    key,
    label: key === "other" ? "Other" : MEAL_LABEL[key],
    entries: [],
    calories: 0,
  }));
  for (const e of entries) {
    const g = groups.find((x) => x.key === (e.meal ?? "other"))!;
    g.entries.push(e);
    g.calories += e.calories;
  }
  return groups.filter((g) => g.entries.length > 0);
}
```

- [ ] **Step 4: `components/Dialog.tsx`** (moves the modal shell out of `TaskEditModal`)

```tsx
"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "@phosphor-icons/react";
import { ICON_BUTTON, KBD } from "@/lib/ui";

interface Props {
  title: string;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  footer: React.ReactNode;
  children: React.ReactNode;
  size?: "md" | "sm";
}

/** Modal form shell: portal, Escape to close, Tab trapped inside, focus
 * restored on close, background scroll locked, Cmd/Ctrl+Enter submits,
 * bottom sheet on phones. */
export default function Dialog({ title, onClose, onSubmit, footer, children, size = "md" }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  // Callers pass an inline arrow, so read it through a ref; otherwise the
  // effect below would re-run (and bounce focus) on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !formRef.current) return;
      const focusable = formRef.current.querySelectorAll<HTMLElement>(
        "input, select, textarea, button:not(:disabled), [href]"
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="anim-overlay absolute inset-0 bg-black/35 backdrop-blur-[2px] dark:bg-black/60"
        onClick={onClose}
      />
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={onSubmit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) formRef.current?.requestSubmit();
        }}
        className={`anim-pop relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-surface elev-3 sm:rounded-2xl ${
          size === "sm" ? "max-w-sm" : "max-w-lg"
        }`}
      >
        <div className="flex items-center justify-between px-5 pb-1 pt-4">
          <h2 id={titleId} className="text-sm font-semibold text-fg">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={ICON_BUTTON}>
            <XIcon className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="scroll-area space-y-4 overflow-y-auto px-5 pb-5 pt-2">{children}</div>
        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <span className="hidden items-center gap-1 text-xs text-fg-faint sm:inline-flex">
            <kbd className={KBD}>⌘</kbd>
            <kbd className={KBD}>↵</kbd>
            to save
          </span>
          <div className="ml-auto flex gap-2">{footer}</div>
        </div>
      </form>
    </div>,
    document.body
  );
}
```

`TaskEditModal.tsx`: delete its portal/form/header/footer markup, the `dialogRef`, `onCloseRef` and keyboard effect, and the `createPortal`, `XIcon`, `ICON_BUTTON`, `KBD` imports. Return:

```tsx
  return (
    <Dialog
      title={task ? "Edit task" : "New task"}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BUTTON_PRIMARY}>
            {saving && <CircleNotchIcon className="h-4 w-4 animate-spin" aria-hidden />}
            {saving ? "Saving" : task ? "Save changes" : "Create task"}
          </button>
        </>
      }
    >
      {/* the existing body content: title + description block, priority
          fieldset, field grid, notes, error alert, unchanged */}
    </Dialog>
  );
```

Keep `const titleId = useId();` (used for the title/description input ids) and `errorId`.

- [ ] **Step 5: Verify**

Run: `cd frontend && npx tsc --noEmit && npx eslint src`
Expected: no output. Then in the browser: open a task's edit modal, check Escape closes it, Tab cycles inside, Cmd+Enter saves.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib frontend/src/components/Dialog.tsx frontend/src/components/TaskEditModal.tsx
git commit -m "Add nutrition API client and types; extract shared Dialog"
```

---

### Task 6: Nutrition components

**Files:**
- Create: `frontend/src/components/nutrition/MacroSummary.tsx`, `FoodRow.tsx`, `FoodEntryModal.tsx`, `TargetsModal.tsx`, `WeekChart.tsx`

Load the `dataviz` skill before writing `WeekChart.tsx` and follow its mark and color rules.

**Interfaces:**
- Consumes: Task 5 types, api, `lib/nutrition.ts`, `Dialog`.
- Produces:
  - `<MacroSummary summary={DaySummary} onSetTargets={() => void} />`
  - `<FoodRow entry={FoodEntry} index={number} onEdit={(e: FoodEntry) => void} onDeleted={(day: DaySummary) => void} />` (an `<li>`)
  - `<FoodEntryModal entry={FoodEntry | null} defaultDate={string} onClose={() => void} onSaved={(day: DaySummary) => void} />`
  - `<TargetsModal current={NutritionTargets | null} onClose={() => void} onSaved={() => void} />`
  - `<WeekChart days={HistoryDay[]} selected={string} onSelect={(iso: string) => void} />`

- [ ] **Step 1: `MacroSummary.tsx`**

```tsx
"use client";

import { TargetIcon } from "@phosphor-icons/react";
import { fmtGrams, fmtKcal, MACRO_LABEL, MACROS } from "@/lib/nutrition";
import type { DaySummary, MacroKey } from "@/lib/types";
import { BUTTON_SECONDARY, CARD } from "@/lib/ui";

function Bar({ value, goal, over, thick }: { value: number; goal: number; over: boolean; thick?: boolean }) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
  return (
    <span className={`relative block overflow-hidden rounded-full bg-surface-2 ${thick ? "h-2.5" : "h-1.5"}`}>
      <span
        className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out ${
          over ? "bg-warn" : "bg-accent"
        }`}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

export default function MacroSummary({
  summary,
  onSetTargets,
}: {
  summary: DaySummary;
  onSetTargets: () => void;
}) {
  const { totals, targets, remaining, over } = summary;
  const isOver = (k: MacroKey) => over.includes(k);
  const calLeft = remaining?.calories ?? null;

  return (
    <div className={`p-5 sm:p-6 ${CARD}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-4xl font-medium tabular-nums tracking-tight text-fg">
              {fmtKcal(totals.calories)}
            </span>
            {targets && (
              <span className="font-mono text-base tabular-nums text-fg-faint">/ {fmtKcal(targets.calories)}</span>
            )}
            <span className="text-sm text-fg-muted">kcal</span>
          </div>
        </div>
        {calLeft !== null ? (
          <p className={`text-sm font-medium ${isOver("calories") ? "text-warn" : "text-fg-muted"}`}>
            <span className="font-mono tabular-nums">{fmtKcal(Math.abs(calLeft))}</span>{" "}
            {isOver("calories") ? "over" : "left"}
          </p>
        ) : (
          <button onClick={onSetTargets} className={`h-8 py-0 text-[13px] ${BUTTON_SECONDARY}`}>
            <TargetIcon className="h-4 w-4" aria-hidden />
            Set targets
          </button>
        )}
      </div>

      {targets && (
        <div className="mt-3">
          <Bar value={totals.calories} goal={targets.calories} over={isOver("calories")} thick />
        </div>
      )}

      <dl className="mt-6 grid grid-cols-3 gap-4 sm:gap-6">
        {MACROS.map((m) => {
          const goal = targets?.[m] ?? null;
          return (
            <div key={m} className="min-w-0">
              <dt className="text-[13px] text-fg-muted">{MACRO_LABEL[m]}</dt>
              <dd className="mt-1">
                <span className={`font-mono text-sm tabular-nums ${isOver(m) ? "text-warn" : "text-fg"}`}>
                  {fmtGrams(totals[m])}
                </span>
                {goal !== null && (
                  <span className="font-mono text-xs tabular-nums text-fg-faint"> / {fmtGrams(goal)}</span>
                )}
                {isOver(m) && <span className="ml-1 text-xs font-medium text-warn">over</span>}
                {goal !== null && (
                  <span className="mt-2 block">
                    <Bar value={totals[m]} goal={goal} over={isOver(m)} />
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
```

- [ ] **Step 2: `FoodRow.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { fmtGrams, fmtKcal } from "@/lib/nutrition";
import { toast, toastError } from "@/lib/toast";
import type { DaySummary, FoodEntry } from "@/lib/types";
import { ICON_BUTTON } from "@/lib/ui";

export default function FoodRow({
  entry,
  index,
  onEdit,
  onDeleted,
}: {
  entry: FoodEntry;
  index: number;
  onEdit: (entry: FoodEntry) => void;
  onDeleted: (day: DaySummary) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(id);
  }, [confirming]);

  async function remove() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      const res = await api.deleteFoodEntry(entry.id);
      toast(`Deleted "${entry.name}"`, "info");
      onDeleted(res.day);
    } catch (err) {
      toastError(err, "Couldn't delete the entry");
      setBusy(false);
    }
  }

  return (
    <li
      style={{ "--i": index } as React.CSSProperties}
      className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-surface-2/70 focus-within:bg-surface-2/70"
    >
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onEdit(entry)}
          className="block max-w-full text-left text-sm leading-5 text-fg [overflow-wrap:anywhere] hover:underline hover:decoration-line-strong hover:underline-offset-4"
        >
          {entry.name}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-fg-muted">
          {entry.quantity && <span>{entry.quantity}</span>}
          <span className="font-mono tabular-nums" aria-label={`Protein ${Math.round(entry.protein_g)} grams, carbs ${Math.round(entry.carbs_g)} grams, fat ${Math.round(entry.fat_g)} grams`}>
            P {fmtGrams(entry.protein_g)} <span className="text-fg-faint">/</span> C {fmtGrams(entry.carbs_g)}{" "}
            <span className="text-fg-faint">/</span> F {fmtGrams(entry.fat_g)}
          </span>
        </div>
      </div>
      <span className="shrink-0 font-mono text-sm tabular-nums text-fg">
        {fmtKcal(entry.calories)}
        <span className="ml-0.5 text-xs text-fg-faint">kcal</span>
      </span>
      <div className="-my-1 flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
        <button onClick={() => onEdit(entry)} aria-label={`Edit ${entry.name}`} title="Edit" className={ICON_BUTTON}>
          <PencilSimpleIcon className="h-4 w-4" aria-hidden />
        </button>
        <button
          onClick={remove}
          disabled={busy}
          aria-label={confirming ? `Confirm delete ${entry.name}` : `Delete ${entry.name}`}
          title={confirming ? "Click again to delete" : "Delete"}
          className={
            confirming
              ? "inline-flex h-8 items-center gap-1 rounded-lg bg-danger px-2 text-xs font-medium text-surface"
              : `${ICON_BUTTON} hover:bg-danger-soft hover:text-danger`
          }
        >
          <TrashIcon className="h-4 w-4" aria-hidden />
          {confirming && "Delete?"}
        </button>
      </div>
    </li>
  );
}
```

- [ ] **Step 3: `FoodEntryModal.tsx`**

```tsx
"use client";

import { useId, useState } from "react";
import { CircleNotchIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { todayIso } from "@/lib/format";
import { guessMeal, MEAL_LABEL, MEALS } from "@/lib/nutrition";
import { toast } from "@/lib/toast";
import type { DaySummary, FoodEntry, FoodEntryPayload, MealType } from "@/lib/types";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD as FIELD_BASE, LABEL } from "@/lib/ui";
import Dialog from "../Dialog";

const FIELD = `mt-1.5 h-10 w-full ${FIELD_BASE}`;

function num(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

export default function FoodEntryModal({
  entry,
  defaultDate,
  onClose,
  onSaved,
}: {
  entry: FoodEntry | null;
  defaultDate: string;
  onClose: () => void;
  onSaved: (day: DaySummary) => void;
}) {
  const [name, setName] = useState(entry?.name ?? "");
  const [quantity, setQuantity] = useState(entry?.quantity ?? "");
  const [meal, setMeal] = useState<MealType | null>(
    entry ? entry.meal : defaultDate === todayIso() ? guessMeal() : null
  );
  const [calories, setCalories] = useState(entry ? String(entry.calories) : "");
  const [protein, setProtein] = useState(entry ? String(entry.protein_g) : "");
  const [carbs, setCarbs] = useState(entry ? String(entry.carbs_g) : "");
  const [fat, setFat] = useState(entry ? String(entry.fat_g) : "");
  const [eatenOn, setEatenOn] = useState(entry?.eaten_on ?? defaultDate);
  const [eatenAt, setEatenAt] = useState(entry?.eaten_at?.slice(0, 5) ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the food a name.");
    if (calories.trim() === "" || num(calories) < 0) return setError("Enter calories (0 or more).");
    setSaving(true);
    setError(null);
    const payload: FoodEntryPayload = {
      name: name.trim(),
      quantity: quantity.trim() || null,
      meal,
      calories: num(calories),
      protein_g: num(protein),
      carbs_g: num(carbs),
      fat_g: num(fat),
      eaten_on: eatenOn || todayIso(),
      eaten_at: eatenAt || null,
      notes: notes.trim() || null,
    };
    try {
      const res = entry ? await api.updateFoodEntry(entry.id, payload) : await api.createFoodEntry(payload);
      toast(entry ? "Changes saved" : `Logged "${res.entry.name}"`);
      onSaved(res.day);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the entry");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={entry ? "Edit food" : "Add food"}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BUTTON_PRIMARY}>
            {saving && <CircleNotchIcon className="h-4 w-4 animate-spin" aria-hidden />}
            {saving ? "Saving" : entry ? "Save changes" : "Add food"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-[1fr_9rem]">
        <label className={`block ${LABEL}`}>
          Food
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Greek yogurt" className={FIELD} />
        </label>
        <label className={`block ${LABEL}`}>
          Amount
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="200 g" className={FIELD} />
        </label>
      </div>

      <fieldset>
        <legend className={LABEL}>Meal</legend>
        <div className="mt-1.5 grid grid-cols-4 gap-1 rounded-lg bg-surface-2 p-1">
          {MEALS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMeal(meal === m ? null : m)}
              aria-pressed={meal === m}
              className={`h-8 rounded-md text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 ${
                meal === m ? "bg-surface text-fg elev-1" : "text-fg-muted hover:text-fg"
              }`}
            >
              {MEAL_LABEL[m]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className={`block ${LABEL}`}>
          Calories
          <input type="number" inputMode="decimal" min={0} step="any" required value={calories} onChange={(e) => setCalories(e.target.value)} aria-invalid={!!error && calories === ""} aria-describedby={error ? errorId : undefined} className={FIELD} />
        </label>
        <label className={`block ${LABEL}`}>
          Protein (g)
          <input type="number" inputMode="decimal" min={0} step="any" value={protein} onChange={(e) => setProtein(e.target.value)} className={FIELD} />
        </label>
        <label className={`block ${LABEL}`}>
          Carbs (g)
          <input type="number" inputMode="decimal" min={0} step="any" value={carbs} onChange={(e) => setCarbs(e.target.value)} className={FIELD} />
        </label>
        <label className={`block ${LABEL}`}>
          Fat (g)
          <input type="number" inputMode="decimal" min={0} step="any" value={fat} onChange={(e) => setFat(e.target.value)} className={FIELD} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className={`block ${LABEL}`}>
          Date
          <input type="date" value={eatenOn} onChange={(e) => setEatenOn(e.target.value)} className={FIELD} />
        </label>
        <label className={`block ${LABEL}`}>
          Time
          <input type="time" value={eatenAt} onChange={(e) => setEatenAt(e.target.value)} className={FIELD} />
        </label>
      </div>

      <label className={`block ${LABEL}`}>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`mt-1.5 w-full py-2 leading-relaxed ${FIELD_BASE}`} />
      </label>

      {error && (
        <p id={errorId} role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <WarningCircleIcon weight="fill" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </Dialog>
  );
}
```

- [ ] **Step 4: `TargetsModal.tsx`**

```tsx
"use client";

import { useState } from "react";
import { CircleNotchIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { toast } from "@/lib/toast";
import type { NutritionTargets } from "@/lib/types";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD, LABEL } from "@/lib/ui";
import Dialog from "../Dialog";

const INPUT = `mt-1.5 h-10 w-full ${FIELD}`;

function optional(value: string): number | null {
  if (value.trim() === "") return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export default function TargetsModal({
  current,
  onClose,
  onSaved,
}: {
  current: NutritionTargets | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [calories, setCalories] = useState(current ? String(current.calories) : "");
  const [protein, setProtein] = useState(current?.protein_g?.toString() ?? "");
  const [carbs, setCarbs] = useState(current?.carbs_g?.toString() ?? "");
  const [fat, setFat] = useState(current?.fat_g?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cal = optional(calories);
    if (cal === null || cal <= 0) return setError("Enter a calorie target above 0.");
    setSaving(true);
    setError(null);
    try {
      await api.setNutritionTargets({
        calories: cal,
        protein_g: optional(protein),
        carbs_g: optional(carbs),
        fat_g: optional(fat),
      });
      toast("Targets updated");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save targets");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="Daily targets"
      size="sm"
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BUTTON_PRIMARY}>
            {saving && <CircleNotchIcon className="h-4 w-4 animate-spin" aria-hidden />}
            {saving ? "Saving" : "Save targets"}
          </button>
        </>
      }
    >
      <p className="text-sm text-fg-muted">
        Applies from today. Earlier days keep the targets they had.
        {current && <> Current targets started {formatDate(current.effective_from)}.</>}
      </p>
      <label className={`block ${LABEL}`}>
        Calories
        <input autoFocus type="number" inputMode="decimal" min={1} step="any" required value={calories} onChange={(e) => setCalories(e.target.value)} className={INPUT} />
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className={`block ${LABEL}`}>
          Protein (g)
          <input type="number" inputMode="decimal" min={0} step="any" value={protein} onChange={(e) => setProtein(e.target.value)} placeholder="None" className={INPUT} />
        </label>
        <label className={`block ${LABEL}`}>
          Carbs (g)
          <input type="number" inputMode="decimal" min={0} step="any" value={carbs} onChange={(e) => setCarbs(e.target.value)} placeholder="None" className={INPUT} />
        </label>
        <label className={`block ${LABEL}`}>
          Fat (g)
          <input type="number" inputMode="decimal" min={0} step="any" value={fat} onChange={(e) => setFat(e.target.value)} placeholder="None" className={INPUT} />
        </label>
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <WarningCircleIcon weight="fill" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </Dialog>
  );
}
```

- [ ] **Step 5: `WeekChart.tsx`** (load `dataviz` skill first; adjust styling to its rules if they conflict)

```tsx
"use client";

import { fmtKcal } from "@/lib/nutrition";
import type { HistoryDay } from "@/lib/types";

function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export default function WeekChart({
  days,
  selected,
  onSelect,
}: {
  days: HistoryDay[];
  selected: string;
  onSelect: (iso: string) => void;
}) {
  const target = days[days.length - 1]?.targets?.calories ?? null;
  const peak = Math.max(1, ...days.map((d) => d.totals.calories), target ? target * 1.15 : 0);

  return (
    <div>
      <div className="relative h-36">
        {target && (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-fg-faint/60"
            style={{ bottom: `${(target / peak) * 100}%` }}
          >
            <span className="absolute -top-5 right-0 font-mono text-[11px] tabular-nums text-fg-faint">
              {fmtKcal(target)} target
            </span>
          </div>
        )}
        <div className="grid h-full grid-cols-7 items-end gap-2 sm:gap-3">
          {days.map((d) => {
            const date = parse(d.day);
            const cal = d.totals.calories;
            const over = d.targets ? cal > d.targets.calories : false;
            const isSelected = d.day === selected;
            const label = `${date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}: ${
              d.entry_count ? `${fmtKcal(cal)} kcal` : "nothing logged"
            }${d.targets ? ` of ${fmtKcal(d.targets.calories)}` : ""}`;
            return (
              <button
                key={d.day}
                type="button"
                onClick={() => onSelect(d.day)}
                aria-label={label}
                aria-pressed={isSelected}
                title={label}
                className="group flex h-full flex-col justify-end rounded-md focus-visible:outline-offset-4"
              >
                <span
                  className={`block w-full rounded-t-md transition-[height,background-color] duration-300 ${
                    d.entry_count === 0
                      ? "bg-surface-2"
                      : over
                        ? "bg-warn"
                        : isSelected
                          ? "bg-accent"
                          : "bg-accent/45 group-hover:bg-accent/70"
                  }`}
                  style={{ height: d.entry_count ? `${Math.max(3, (cal / peak) * 100)}%` : "3px" }}
                />
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-2 sm:gap-3">
        {days.map((d) => {
          const date = parse(d.day);
          const isSelected = d.day === selected;
          return (
            <span
              key={d.day}
              aria-hidden
              className={`text-center text-[11px] ${isSelected ? "font-semibold text-fg" : "text-fg-faint"}`}
            >
              {date.toLocaleDateString(undefined, { weekday: "narrow" })}
              <span className="block font-mono tabular-nums">{date.getDate()}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verify**

Run: `cd frontend && npx tsc --noEmit && npx eslint src`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/nutrition
git commit -m "Add nutrition summary, food row, entry/targets modals, week chart"
```

---

### Task 7: Nutrition page and navigation

**Files:**
- Create: `frontend/src/app/nutrition/page.tsx`
- Modify: `frontend/src/components/AppShell.tsx` (add `{ href: "/nutrition", label: "Nutrition", icon: ForkKnifeIcon }` after Calendar; import `ForkKnifeIcon`)

**Interfaces:**
- Consumes: everything from Tasks 5 and 6; `PageHeader`, `EmptyState`, `ErrorState`, `TaskListSkeleton` from `components/PageParts`.

- [ ] **Step 1: Implement `app/nutrition/page.tsx`**

```tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CaretLeftIcon, CaretRightIcon, ForkKnifeIcon, PlusIcon, TargetIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { addDaysIso, formatDateLong, relativeDueLabel, todayIso, weekdayLabel } from "@/lib/format";
import { fmtKcal, fmtGrams, groupByMeal } from "@/lib/nutrition";
import type { DaySummary, FoodEntry, HistorySummary, TargetsResponse } from "@/lib/types";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, CARD_LIST, ICON_BUTTON } from "@/lib/ui";
import { EmptyState, ErrorState, PageHeader, TaskListSkeleton } from "@/components/PageParts";
import FoodEntryModal from "@/components/nutrition/FoodEntryModal";
import FoodRow from "@/components/nutrition/FoodRow";
import MacroSummary from "@/components/nutrition/MacroSummary";
import TargetsModal from "@/components/nutrition/TargetsModal";
import WeekChart from "@/components/nutrition/WeekChart";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function dayTitle(iso: string): string {
  const rel = relativeDueLabel(iso);
  return rel === "Today" || rel === "Yesterday" ? rel : weekdayLabel(iso);
}

function NutritionView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = todayIso();
  const raw = params.get("date");
  const day = raw && ISO.test(raw) && raw <= today ? raw : today;

  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [week, setWeek] = useState<HistorySummary | null>(null);
  const [targets, setTargets] = useState<TargetsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<FoodEntry | null | "new">(null);
  const [editingTargets, setEditingTargets] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getNutritionDay(day),
      api.getNutritionHistory(addDaysIso(day, -6), day),
      api.getNutritionTargets(),
    ])
      .then(([s, h, t]) => {
        if (cancelled) return;
        setSummary(s);
        setWeek(h);
        setTargets(t);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load nutrition");
      });
    return () => {
      cancelled = true;
    };
  }, [day, version]);

  function goTo(iso: string) {
    const target = iso >= today ? pathname : `${pathname}?date=${iso}`;
    router.replace(target, { scroll: false });
  }

  function refresh(next?: DaySummary) {
    if (next && next.day === day) setSummary(next);
    setVersion((v) => v + 1);
  }

  const groups = summary ? groupByMeal(summary.entries) : [];
  const stale = summary !== null && summary.day !== day;

  return (
    <div>
      <PageHeader
        title={dayTitle(day)}
        subtitle={formatDateLong(day)}
        actions={
          <>
            <button onClick={() => setEditingTargets(true)} className={`h-8 py-0 text-[13px] ${BUTTON_SECONDARY}`}>
              <TargetIcon className="h-4 w-4" aria-hidden />
              Targets
            </button>
            {day !== today && (
              <button onClick={() => goTo(today)} className={`h-8 py-0 text-[13px] ${BUTTON_SECONDARY}`}>
                Today
              </button>
            )}
            <div className="flex items-center rounded-lg border border-line">
              <button onClick={() => goTo(addDaysIso(day, -1))} aria-label="Previous day" className={ICON_BUTTON}>
                <CaretLeftIcon className="h-4 w-4" aria-hidden />
              </button>
              <button
                onClick={() => goTo(addDaysIso(day, 1))}
                disabled={day >= today}
                aria-label="Next day"
                className={ICON_BUTTON}
              >
                <CaretRightIcon className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={() => setVersion((v) => v + 1)} />}

      {!summary ? (
        !error && (
          <div className="space-y-8">
            <div className={`h-40 ${CARD} shimmer`} />
            <TaskListSkeleton rows={3} />
          </div>
        )
      ) : (
        <div className={`space-y-10 transition-opacity ${stale ? "opacity-60" : ""}`}>
          <section aria-label="Totals" className="anim-fade-up">
            <MacroSummary summary={summary} onSetTargets={() => setEditingTargets(true)} />
          </section>

          <section aria-labelledby="food-log-heading">
            <div className="flex items-center justify-between px-1 pb-2">
              <h2 id="food-log-heading" className="text-[13px] font-medium text-fg-muted">
                Food log
              </h2>
              {summary.entries.length > 0 && (
                <button onClick={() => setEditing("new")} className={`h-8 py-0 text-[13px] ${BUTTON_PRIMARY}`}>
                  <PlusIcon weight="bold" className="h-4 w-4" aria-hidden />
                  Add food
                </button>
              )}
            </div>
            {summary.entries.length === 0 ? (
              <EmptyState
                icon={ForkKnifeIcon}
                title={day === today ? "Nothing logged yet today" : "Nothing logged this day"}
                action={
                  <button onClick={() => setEditing("new")} className={BUTTON_PRIMARY}>
                    <PlusIcon weight="bold" className="h-4 w-4" aria-hidden />
                    Add food
                  </button>
                }
              >
                Tell ChatGPT what you ate, or add it here.
              </EmptyState>
            ) : (
              <div className="space-y-5">
                {groups.map((g) => (
                  <div key={g.key}>
                    <h3 className="flex items-baseline justify-between px-1 pb-1.5 text-[13px]">
                      <span className="font-medium text-fg">{g.label}</span>
                      <span className="font-mono text-xs tabular-nums text-fg-faint">{fmtKcal(g.calories)} kcal</span>
                    </h3>
                    <ul className={`anim-stagger ${CARD_LIST}`}>
                      {g.entries.map((e, i) => (
                        <FoodRow key={e.id} entry={e} index={i} onEdit={setEditing} onDeleted={refresh} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          {week && (
            <section aria-labelledby="week-heading" className="anim-fade-up">
              <h2 id="week-heading" className="px-1 pb-3 text-[13px] font-medium text-fg-muted">
                Last 7 days
              </h2>
              <div className={`p-5 ${CARD}`}>
                <WeekChart days={week.days} selected={day} onSelect={goTo} />
                <p className="mt-5 border-t border-line pt-4 text-sm text-fg-muted">
                  {week.averages ? (
                    <>
                      Averaging{" "}
                      <span className="font-mono tabular-nums text-fg">{fmtKcal(week.averages.calories)}</span> kcal and{" "}
                      <span className="font-mono tabular-nums text-fg">{fmtGrams(week.averages.protein_g)}</span> protein
                      over {week.logged_days} logged {week.logged_days === 1 ? "day" : "days"}.
                    </>
                  ) : (
                    "No entries in these 7 days."
                  )}
                </p>
              </div>
            </section>
          )}
        </div>
      )}

      {editing && (
        <FoodEntryModal
          entry={editing === "new" ? null : editing}
          defaultDate={day}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      {editingTargets && (
        <TargetsModal
          current={targets?.current ?? null}
          onClose={() => setEditingTargets(false)}
          onSaved={() => refresh()}
        />
      )}
    </div>
  );
}

export default function NutritionPage() {
  return (
    <Suspense fallback={<TaskListSkeleton rows={3} />}>
      <NutritionView />
    </Suspense>
  );
}
```

- [ ] **Step 2: Nav item** in `AppShell.tsx`: import `ForkKnifeIcon`; insert `{ href: "/nutrition", label: "Nutrition", icon: ForkKnifeIcon }` after the Calendar item in `NAV`.

- [ ] **Step 3: Static checks**

Run: `cd frontend && npx tsc --noEmit && npx eslint src`
Expected: no output.

- [ ] **Step 4: Browser check** (backend from Docker must include the new code: run the backend locally for this check, see Task 8)

Visit `http://localhost:3001/nutrition`: empty state shows; add a food via "Add food"; totals update; set targets; bars and "left" show; step to yesterday and back; click a week bar; edit and two-click delete an entry; toggle dark mode; resize to 390px wide.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/nutrition frontend/src/components/AppShell.tsx
git commit -m "Add Nutrition page with day log, totals, targets and weekly chart"
```

---

### Task 8: End-to-end verification

**Files:** none new (fixes only, if verification finds problems).

- [ ] **Step 1: Full backend suite**

Run: `cd backend && .venv/bin/pytest -q`
Expected: all pass (58 existing + new).

- [ ] **Step 2: Production frontend build** (in a scratch copy so the running dev server's `.next` isn't clobbered)

Run: copy `frontend/` (without `node_modules`, `.next`) to the scratchpad, `cp -cR` `node_modules` in, `npx next build`.
Expected: build succeeds; `/nutrition` listed among routes.

- [ ] **Step 3: Live end-to-end against the real stack**

Rebuild and restart the Docker `backend` and `mcp` services from local source (`docker compose up -d --build backend mcp`) so the running API has the new tables and endpoints. The tables are created on startup by `create_all`; existing data is untouched. Then:
- Call `log_food` through a real MCP client session (initialize, list_tools, call_tool) against `http://localhost:8001/mcp` with the bearer token, logging a test item.
- Confirm the item appears on `http://localhost:3001/nutrition`.
- Delete that test entry from the UI so no test data remains.

- [ ] **Step 4: Commit any fixes**, then report.
