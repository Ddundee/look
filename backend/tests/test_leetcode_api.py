BASE = "/api/leetcode"


def log(client, headers, **kw):
    body = {"problem_number": 560, "title": "Subarray Sum Equals K", "difficulty": "medium",
            "topics": ["Prefix Sum"], **kw}
    return client.post(f"{BASE}/attempts", json=body, headers=headers)


def test_requires_auth(client):
    assert client.get(f"{BASE}/stats").status_code == 401
    assert client.post(f"{BASE}/attempts", json={}).status_code == 401


def test_log_solve_and_failed_attempt_against_one_problem(client, auth_headers):
    first = log(client, auth_headers, solved=False, duration_minutes=40)
    assert first.status_code == 201
    body = first.json()
    assert body["problem_created"] is True and body["attempt"]["source"] == "manual"
    assert body["attempt"]["problem"]["url"] == "https://leetcode.com/problems/subarray-sum-equals-k/"

    second = log(client, auth_headers, title=None, difficulty=None, hint_used=True, duration_minutes=23, confidence=3)
    assert second.status_code == 201
    assert second.json()["problem_created"] is False
    assert second.json()["attempt"]["problem_id"] == body["attempt"]["problem_id"]
    assert second.json()["progress"]["total_solved"] == 1

    problems = client.get(f"{BASE}/problems", headers=auth_headers).json()
    assert problems["count"] == 1 and problems["problems"][0]["attempts"] == 2


def test_new_problem_without_details_is_422(client, auth_headers):
    resp = client.post(f"{BASE}/attempts", json={"problem_number": 42}, headers=auth_headers)
    assert resp.status_code == 422 and "title and difficulty" in resp.json()["detail"]


def test_problem_create_duplicate_get_patch(client, auth_headers):
    created = client.post(f"{BASE}/problems", json={"number": 1, "title": "Two Sum", "difficulty": "easy",
                                                    "topics": ["array"]}, headers=auth_headers)
    assert created.status_code == 201
    pid = created.json()["id"]
    dup = client.post(f"{BASE}/problems", json={"number": 1, "title": "Two Sum", "difficulty": "easy"},
                      headers=auth_headers)
    assert dup.status_code == 409
    patched = client.patch(f"{BASE}/problems/{pid}", json={"topics": ["Array", "hash table"]}, headers=auth_headers)
    assert patched.json()["topics"] == ["Array", "Hash Table"]
    detail = client.get(f"{BASE}/problems/{pid}", headers=auth_headers).json()
    assert detail["problem"]["number"] == 1 and detail["attempts"] == []
    assert client.get(f"{BASE}/problems/nope", headers=auth_headers).status_code == 404


def test_attempt_list_filters_and_delete(client, auth_headers):
    log(client, auth_headers)
    log(client, auth_headers, problem_number=124, title="Max Path Sum", difficulty="hard", topics=["Trees"],
        solved=False)
    hard = client.get(f"{BASE}/attempts", params={"difficulty": "hard"}, headers=auth_headers).json()
    assert [a["problem"]["number"] for a in hard["attempts"]] == [124]
    trees = client.get(f"{BASE}/attempts", params={"topic": "trees"}, headers=auth_headers).json()
    assert trees["count"] == 1
    unsolved = client.get(f"{BASE}/attempts", params={"solved": "false"}, headers=auth_headers).json()
    assert unsolved["count"] == 1
    attempt_id = hard["attempts"][0]["id"]
    assert client.delete(f"{BASE}/attempts/{attempt_id}", headers=auth_headers).json() == {"deleted_id": attempt_id}
    assert client.delete(f"{BASE}/attempts/{attempt_id}", headers=auth_headers).status_code == 404


def test_stats_topics_and_goals(client, auth_headers):
    log(client, auth_headers, hint_used=True)
    log(client, auth_headers, title=None, difficulty=None)
    stats = client.get(f"{BASE}/stats", headers=auth_headers).json()
    assert stats["solved_today"] == 2 and stats["current_streak"] == 1
    assert stats["goals"] == {"daily_target": 2, "weekly_target": 10, "customized": False}
    topics = client.get(f"{BASE}/topics", headers=auth_headers).json()
    assert topics["topics"][0]["topic"] == "Prefix Sum" and topics["topics"][0]["recent_hint_rate"] == 0.5
    goals = client.put(f"{BASE}/goals", json={"daily_target": 3, "weekly_target": 12}, headers=auth_headers)
    assert goals.json()["customized"] is True
    assert client.get(f"{BASE}/goals", headers=auth_headers).json()["weekly_target"] == 12
    assert client.put(f"{BASE}/goals", json={"daily_target": -1, "weekly_target": 1}, headers=auth_headers).status_code == 422
