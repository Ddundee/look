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


from app.services import nutrition as svc  # noqa: E402
from app.utils import local_today  # noqa: E402


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
