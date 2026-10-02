"""leetcode import metadata

Revision ID: 0006_leetcode_import_metadata
Revises: 0005_courses_and_categories
Create Date: 2026-10-02

Schema (additive): leetcode_attempts.external_id (the LeetCode submission
id of an imported attempt) with UNIQUE(source, external_id), and
hint_used / solved_independently become nullable (null = unknown).

Data: attempts imported from lc-solutions' submission_history.json got
generated notes ("Imported from Ddundee/lc-solutions submission_history
.json. Accepted LeetCode submission N: https://leetcode.com/submissions/
detail/N/. Original timestamp: ... Hint usage and independent solving are
UNKNOWN (false fields are placeholders, not assessments); solve duration
and confidence not recorded.") and placeholder false values. For notes that
START with that exact importer prefix only:
- the recognized sentences are removed; anything else in the note is kept
  (null if nothing is left);
- source becomes "leetcode" and external_id the submission id (the first
  attempt per submission id, if one was imported twice);
- if the note said hint use / independence were unknown placeholders,
  hint_used and solved_independently become null.
Every other note is untouched.

Downgrade: unknown values go back to false and the column/constraint are
dropped (removed notes aren't restored). Refuses if imported attempts exist
unless run with `-x allow-data-loss=true`, since their submission ids would
be lost.
"""
from typing import Sequence, Union

import re

from alembic import context, op
import sqlalchemy as sa
import sqlmodel  # noqa: F401  (autogenerate renders sqlmodel.sql.sqltypes.AutoString)


# revision identifiers, used by Alembic.
revision: str = '0006_leetcode_import_metadata'
down_revision: Union[str, Sequence[str], None] = '0005_courses_and_categories'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The old importer's sentences, exactly (frozen here; the app keeps its own
# copy in app.services.leetcode for incoming notes). Anchored at the start of
# the note; each later sentence is optional.
IMPORT_NOTE = re.compile(
    r"^\s*Imported from \S+ submission_history\.json\.\s*"
    r"(?:(?P<status>[A-Za-z][A-Za-z ]*?) LeetCode submission (?P<id>\d+)"
    r"(?::\s*https://leetcode\.com/submissions/detail/(?P=id)/?)?\.\s*)?"
    r"(?:Original timestamp:\s*(?P<ts>\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\.\s*)?"
    r"(?P<unknown>Hint usage and independent solving are UNKNOWN \(false fields are placeholders, not assessments\)"
    r"(?:;[^.]*)?\.\s*)?"
)


def upgrade() -> None:
    with op.batch_alter_table('leetcode_attempts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('external_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
        batch_op.alter_column('solved_independently', existing_type=sa.BOOLEAN(), nullable=True)
        batch_op.alter_column('hint_used', existing_type=sa.BOOLEAN(), nullable=True)
        batch_op.create_unique_constraint('uq_leetcode_attempts_source_external', ['source', 'external_id'])
    _clean_import_notes()


def _clean_import_notes() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT id, notes FROM leetcode_attempts WHERE notes LIKE '%Imported from %submission_history.json%' "
        "ORDER BY created_at, id"
    )).all()
    taken = set()
    for attempt_id, notes in rows:
        m = IMPORT_NOTE.match(notes or "")
        if not m:
            continue
        rest = notes[m.end():].strip() or None
        values = {"id": attempt_id, "notes": rest}
        sets = ["notes = :notes"]
        submission = m.group("id")
        if submission and submission not in taken:
            taken.add(submission)
            values.update(source="leetcode", external_id=submission)
            sets += ["source = :source", "external_id = :external_id"]
        if m.group("unknown"):
            sets += ["hint_used = NULL", "solved_independently = NULL"]
        bind.execute(sa.text(f"UPDATE leetcode_attempts SET {', '.join(sets)} WHERE id = :id"), values)


def downgrade() -> None:
    bind = op.get_bind()
    allow = context.get_x_argument(as_dictionary=True).get("allow-data-loss", "").lower() == "true"
    imported = bind.execute(sa.text("SELECT COUNT(*) FROM leetcode_attempts WHERE external_id IS NOT NULL")).scalar()
    if imported and not allow:
        raise RuntimeError(
            f"Downgrading 0006 drops the submission ids of {imported} imported attempt(s). Back up first, then: "
            "alembic -x allow-data-loss=true downgrade 0005_courses_and_categories"
        )
    bind.execute(sa.text("UPDATE leetcode_attempts SET hint_used = false WHERE hint_used IS NULL"))
    bind.execute(sa.text("UPDATE leetcode_attempts SET solved_independently = false WHERE solved_independently IS NULL"))
    with op.batch_alter_table('leetcode_attempts', schema=None) as batch_op:
        batch_op.drop_constraint('uq_leetcode_attempts_source_external', type_='unique')
        batch_op.alter_column('hint_used', existing_type=sa.BOOLEAN(), nullable=False)
        batch_op.alter_column('solved_independently', existing_type=sa.BOOLEAN(), nullable=False)
        batch_op.drop_column('external_id')
