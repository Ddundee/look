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
