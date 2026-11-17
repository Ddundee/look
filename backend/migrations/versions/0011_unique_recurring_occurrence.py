"""one occurrence per recurring task per day

Revision ID: 0011_unique_recurring_occurrence
Revises: 0010_daily_challenges
Create Date: 2026-11-17

Several requests materialize today's recurring occurrences at once (the
Today widgets load together), and nothing stopped two of them both
adding a row for the same rule and day, so items showed up 2-4 times.

Upgrade removes those duplicates, then adds a unique index on
(recurrence_rule_id, occurrence_date). For each rule and day it keeps one
row: a completed one if any (so ticks aren't lost), else the oldest.
Tasks without a rule are untouched (NULLs never conflict).

Downgrade only drops the index; removed duplicates aren't recreated.
"""
from collections import defaultdict
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0011_unique_recurring_occurrence'
down_revision: Union[str, Sequence[str], None] = '0010_daily_challenges'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT id, recurrence_rule_id, occurrence_date, status, created_at FROM tasks "
        "WHERE recurrence_rule_id IS NOT NULL AND occurrence_date IS NOT NULL"
    )).all()
    groups = defaultdict(list)
    for row in rows:
        groups[(row.recurrence_rule_id, str(row.occurrence_date))].append(row)
    extra = []
    for group in groups.values():
        if len(group) > 1:
            group.sort(key=lambda r: (r.status != "completed", str(r.created_at), r.id))
            extra += [r.id for r in group[1:]]
    for i in range(0, len(extra), 500):
        bind.execute(sa.text("DELETE FROM tasks WHERE id IN :ids").bindparams(sa.bindparam("ids", expanding=True)),
                     {"ids": extra[i:i + 500]})
    op.create_index('uq_tasks_rule_occurrence', 'tasks', ['recurrence_rule_id', 'occurrence_date'], unique=True)


def downgrade() -> None:
    op.drop_index('uq_tasks_rule_occurrence', table_name='tasks')
