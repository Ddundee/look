"""LeetCode imports: structured provenance instead of generated notes,
unknown stays unknown, and rates only count what's known."""

from datetime import datetime

import mcp_server.server as mcp_server
from app.schemas import LeetCodeAttemptCreate, LeetCodeSubmissionImport
from app.services import leetcode as lc

OLD_NOTE = (
    "Imported from Ddundee/lc-solutions submission_history.json. Accepted LeetCode submission 2158855869: "
    "https://leetcode.com/submissions/detail/2158855869/. Original timestamp: 2026-10-01T05:41:09.000Z. "
    "Hint usage and independent solving are UNKNOWN (false fields are placeholders, not assessments); "
    "solve duration and confidence not recorded."
)


def submission(sid, number=560, status="Accepted", when="2026-10-01T05:41:09Z", **kw):
    return LeetCodeSubmissionImport(
        submission_id=sid, problem_number=number, title=kw.pop("title", "Subarray Sum Equals K"),
        difficulty=kw.pop("difficulty", "medium"), topics=kw.pop("topics", ["Prefix Sum"]), status=status,
        submitted_at=when, language=kw.pop("language", "java"),
    )


def test_imported_attempts_have_no_notes_and_unknown_hint_state(session):
    result = lc.import_submissions(session, [submission("2158855869"), submission("2158000001", status="Wrong Answer")])
    assert (result.created, result.duplicates, result.problems_created) == (2, 0, 1)
    attempts = lc.list_attempts(session)
    accepted = next(a for a in attempts if a.external_id == "2158855869")
    assert accepted.notes is None
    assert accepted.hint_used is None and accepted.solved_independently is None  # unknown, not False
    assert accepted.duration_minutes is None and accepted.confidence is None
    assert (accepted.source, accepted.solved, accepted.language) == ("leetcode", True, "java")
    assert accepted.attempted_at == datetime(2026, 10, 1, 5, 41, 9)  # tests run with APP_TIMEZONE=UTC
    wrong = next(a for a in attempts if a.external_id == "2158000001")
    assert wrong.solved is False
    read = lc.attempt_read(accepted, lc.get_problem_by_number(session, 560))
    assert read.external_url == "https://leetcode.com/submissions/detail/2158855869/"


def test_reimport_adds_nothing(session):
    items = [submission("1"), submission("2", number=1, title="Two Sum", difficulty="easy", topics=["Array"])]
    lc.import_submissions(session, items)
    again = lc.import_submissions(session, [*items, submission("2")])  # also a duplicate within the batch
    assert (again.created, again.duplicates) == (0, 3)
    assert len(lc.list_attempts(session)) == 2
    assert {a.external_id for a in lc.list_attempts(session)} == {"1", "2"}


def test_generated_notes_are_dropped_but_user_words_kept(session):
    base = dict(problem_number=560, title="Subarray Sum Equals K", difficulty="medium")
    a, _, _ = lc.log_attempt(session, LeetCodeAttemptCreate(**base, notes=OLD_NOTE), source="mcp")
    assert a.notes is None
    b, _, _ = lc.log_attempt(session, LeetCodeAttemptCreate(**base, notes=OLD_NOTE + " Forgot the empty-prefix case."), source="mcp")
    assert b.notes == "Forgot the empty-prefix case."
    mine = "Imported from memory, I think: used a hashmap of prefix sums."
    c, _, _ = lc.log_attempt(session, LeetCodeAttemptCreate(**base, notes=mine))
    assert c.notes == mine  # not the importer's sentences: untouched


def test_manual_attempts_still_derive_independence(session):
    base = dict(problem_number=1, title="Two Sum", difficulty="easy")
    plain, _, _ = lc.log_attempt(session, LeetCodeAttemptCreate(**base))
    assert (plain.hint_used, plain.solved_independently) == (False, True)
    hinted, _, _ = lc.log_attempt(session, LeetCodeAttemptCreate(**base, hint_used=True))
    assert (hinted.hint_used, hinted.solved_independently) == (True, False)
    unknown, _, _ = lc.log_attempt(session, LeetCodeAttemptCreate(**base, hint_used=None))
    assert (unknown.hint_used, unknown.solved_independently) == (None, None)


def test_rates_exclude_unknown(session):
    lc.import_submissions(session, [submission(str(i), when=f"2026-09-{1 + i % 28:02d}T12:00:00Z") for i in range(50)])
    base = dict(problem_number=560)
    for hint in (True, True, False, False, False):
        lc.log_attempt(session, LeetCodeAttemptCreate(**base, hint_used=hint))
    stats = lc.stats(session)
    assert stats.total_attempts == 55
    assert stats.hint_usage_rate == 0.4  # 2 of the 5 known, not 2 of 55
    assert stats.independent_solve_rate == 0.6  # 3 of the 5 known
    [topic] = lc.topic_stats(session).topics
    assert topic.recent_hint_rate is not None  # the recent window includes known attempts
    assert topic.recent_solve_rate == 1.0


def test_only_unknown_means_no_rate(session):
    lc.import_submissions(session, [submission(str(i), when=f"2026-09-{i + 1:02d}T12:00:00Z") for i in range(6)])
    stats = lc.stats(session)
    assert stats.hint_usage_rate is None and stats.independent_solve_rate is None
    [topic] = lc.topic_stats(session).topics
    assert topic.recent_hint_rate is None and topic.recent_independent_rate is None
    assert topic.weakness == 0.0  # judged on what's known (all solved), not on placeholder falses
    assert not any("hint" in r or "own" in r for r in topic.reasons)


def test_mcp_and_rest_import(client, auth_headers):
    payload = [{"submission_id": "77", "problem_number": 1, "title": "Two Sum", "difficulty": "easy",
                "status": "Accepted", "submitted_at": "2026-10-01T12:00:00Z", "language": "python3"}]
    first = client.post("/api/leetcode/import", headers=auth_headers, json=payload).json()
    assert first == {"created": 1, "duplicates": 0, "problems_created": 1}
    assert mcp_server.import_leetcode_submissions([LeetCodeSubmissionImport(**payload[0])])["duplicates"] == 1
    attempt = client.get("/api/leetcode/attempts", headers=auth_headers).json()["attempts"][0]
    assert attempt["notes"] is None and attempt["hint_used"] is None and attempt["source"] == "leetcode"
    assert attempt["external_url"].endswith("/77/")
    logged = mcp_server.log_leetcode_attempt(problem_number=1, notes=OLD_NOTE, hint_used=None)
    assert logged["attempt"]["notes"] is None and logged["attempt"]["solved_independently"] is None
