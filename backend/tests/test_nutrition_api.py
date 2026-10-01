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
    patched = client.patch(
        f"{BASE}/entries/{entry_id}", json={"name": "2 eggs", "calories": 156}, headers=auth_headers
    )
    assert patched.status_code == 200
    assert patched.json()["day"]["totals"]["calories"] == 156
    deleted = client.delete(f"{BASE}/entries/{entry_id}", headers=auth_headers)
    assert deleted.status_code == 200
    assert deleted.json()["deleted_id"] == entry_id
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
