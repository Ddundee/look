BASE = "/api/events"

CS101 = {
    "title": "CS 101",
    "start_at": "2026-08-24T10:00",
    "end_at": "2026-08-24T10:50",
    "rrule": "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6",
    "category": "class",
}


def test_requires_auth(client):
    assert client.get(f"{BASE}/schedule", params={"start_date": "2026-08-24"}).status_code == 401


def test_create_get_patch_delete(client, auth_headers):
    r = client.post(BASE, json=CS101, headers=auth_headers)
    assert r.status_code == 201
    body = r.json()
    eid = body["event"]["id"]
    assert body["event"]["source"] == "manual" and body["event"]["rrule"].endswith("COUNT=6")
    assert client.get(f"{BASE}/{eid}", headers=auth_headers).json()["title"] == "CS 101"
    p = client.patch(f"{BASE}/{eid}", json={"location": "Hall A"}, headers=auth_headers)
    assert p.status_code == 200 and p.json()["event"]["location"] == "Hall A"
    week = {"start_date": "2026-08-24", "end_date": "2026-08-30"}
    assert client.get(f"{BASE}/schedule", params=week, headers=auth_headers).json()["count"] == 3
    assert client.delete(f"{BASE}/{eid}", headers=auth_headers).json() == {"deleted_id": eid}
    assert client.get(f"{BASE}/{eid}", headers=auth_headers).status_code == 404


def test_invalid_rule_is_422(client, auth_headers):
    bad = {**CS101, "rrule": "FREQ=SOMETIMES"}
    r = client.post(BASE, json=bad, headers=auth_headers)
    assert r.status_code == 422 and "rrule" in r.json()["detail"]


def test_occurrence_edit_and_restore(client, auth_headers):
    eid = client.post(BASE, json=CS101, headers=auth_headers).json()["event"]["id"]
    r = client.put(f"{BASE}/{eid}/occurrences/2026-08-26", json={"cancel": True}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["cancelled"] is True
    week = {"start_date": "2026-08-24", "end_date": "2026-08-30"}
    assert client.get(f"{BASE}/schedule", params=week, headers=auth_headers).json()["count"] == 2
    with_cancelled = {**week, "include_cancelled": "true"}
    assert client.get(f"{BASE}/schedule", params=with_cancelled, headers=auth_headers).json()["count"] == 3
    restored = client.delete(f"{BASE}/{eid}/occurrences/2026-08-26", headers=auth_headers)
    assert restored.status_code == 200 and restored.json()["overridden"] is False
    bad = client.put(f"{BASE}/{eid}/occurrences/2026-08-25", json={"cancel": True}, headers=auth_headers)
    assert bad.status_code == 422
    assert client.put(f"{BASE}/nope/occurrences/2026-08-26", json={"cancel": True}, headers=auth_headers).status_code == 404


def test_schedule_range_error(client, auth_headers):
    r = client.get(f"{BASE}/schedule", params={"start_date": "2026-01-01", "end_date": "2027-06-01"}, headers=auth_headers)
    assert r.status_code == 422


def test_preview_conflicts_search(client, auth_headers):
    params = {"start_at": "2030-01-01T09:00", "end_at": "2030-01-01T10:00", "rrule": "FREQ=WEEKLY;BYDAY=TU"}
    pv = client.get(f"{BASE}/preview", params=params, headers=auth_headers)
    assert pv.status_code == 200 and len(pv.json()) == 5
    assert client.get(f"{BASE}/preview", params={**params, "rrule": "nope"}, headers=auth_headers).status_code == 422
    game = {"title": "Football", "start_at": "2026-10-03T15:30", "end_at": "2026-10-03T19:00", "category": "sports"}
    client.post(BASE, json=game, headers=auth_headers)
    c = client.get(f"{BASE}/conflicts", params={"start_at": "2026-10-03T18:00", "end_at": "2026-10-03T20:00"},
                   headers=auth_headers).json()
    assert [o["title"] for o in c] == ["Football"]
    assert client.get(f"{BASE}/search", params={"q": "foot"}, headers=auth_headers).json()["count"] == 1
