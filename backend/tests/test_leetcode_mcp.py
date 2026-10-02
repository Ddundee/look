import pytest

import mcp_server.server as mcp_server


@pytest.fixture()
def mcp_env(use_test_db):
    return use_test_db


def test_log_from_a_natural_sentence(mcp_env):
    # "I solved LeetCode 560 in 23 minutes in Java, needed one hint, confidence 3/5."
    result = mcp_server.log_leetcode_attempt(
        problem_number=560, title="Subarray Sum Equals K", difficulty="medium",
        topics=["prefix sum", "hash table"], solved=True, hint_used=True,
        duration_minutes=23, language="Java", confidence=3,
    )
    assert "error" not in result
    attempt = result["attempt"]
    assert attempt["solved"] is True and attempt["hint_used"] is True
    assert attempt["solved_independently"] is False and attempt["source"] == "mcp"
    assert attempt["problem"]["topics"] == ["Prefix Sum", "Hash Table"]
    assert result["problem_created"] is True
    assert result["progress"]["solved_today"] == 1


def test_repeat_problem_needs_only_the_number(mcp_env):
    mcp_server.log_leetcode_attempt(problem_number=1, title="Two Sum", difficulty="easy", solved=False)
    again = mcp_server.log_leetcode_attempt(problem_number=1, duration_minutes=8)
    assert again["problem_created"] is False
    history = mcp_server.get_leetcode_problem(1)
    assert history["problem"]["attempts"] == 2 and history["problem"]["solved"] is True
    assert "error" in mcp_server.get_leetcode_problem(999)


def test_errors_are_returned_not_raised(mcp_env):
    assert "title and difficulty" in mcp_server.log_leetcode_attempt(problem_number=42)["error"]
    assert "error" in mcp_server.log_leetcode_attempt(problem_number=1, title="x", difficulty="medium", confidence=9)
    assert "error" in mcp_server.log_leetcode_attempt(problem_number=1, title="x", difficulty="impossible")


def test_progress_recent_topics_and_goals(mcp_env):
    for n, topics in ((200, ["Graphs"]), (201, ["Graphs"]), (300, ["DP"])):
        mcp_server.log_leetcode_attempt(problem_number=n, title=f"p{n}", difficulty="medium", topics=topics,
                                        hint_used=True, confidence=2)
    progress = mcp_server.get_leetcode_progress()
    assert progress["total_solved"] == 3 and progress["hint_usage_rate"] == 1.0
    recent = mcp_server.get_recent_leetcode_attempts(limit=2)
    assert recent["count"] == 2 and recent["attempts"][0]["problem"]["number"] == 300
    assert mcp_server.get_recent_leetcode_attempts(topic="graphs")["count"] == 2
    topics = mcp_server.get_leetcode_topic_stats()
    assert topics["topics"][0]["topic"] == "Graphs" and topics["topics"][0]["reasons"]
    goals = mcp_server.set_leetcode_goals(daily_target=3, weekly_target=12)
    assert goals["customized"] is True and mcp_server.get_leetcode_progress()["goals"]["daily_target"] == 3
    assert mcp_server.resource_leetcode_progress()["total_solved"] == 3


def test_rest_and_mcp_share_the_same_data(mcp_env, client, auth_headers):
    mcp_server.log_leetcode_attempt(problem_number=560, title="Subarray Sum Equals K", difficulty="medium")
    client.post("/api/leetcode/attempts", json={"problem_number": 560, "solved": False}, headers=auth_headers)
    rest = client.get("/api/leetcode/attempts", headers=auth_headers).json()
    assert sorted(a["source"] for a in rest["attempts"]) == ["manual", "mcp"]
    assert len({a["problem_id"] for a in rest["attempts"]}) == 1
    assert mcp_server.get_leetcode_progress()["total_attempts"] == 2
