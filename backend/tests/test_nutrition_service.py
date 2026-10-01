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
