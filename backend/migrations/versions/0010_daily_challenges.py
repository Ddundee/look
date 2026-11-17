"""daily challenges

Revision ID: 0010_daily_challenges
Revises: 0009_blocks
Create Date: 2026-11-17

Additive: a daily_challenges table holding each day's optional "Break the
default" challenge (which one, which were offered, whether it was done),
so it stays the same across refreshes and devices. Nothing existing
changes. Daily Floor, Today's 3 and While AI Runs need no schema: they are
ordinary tasks (tags and planned_for_date).

Downgrade drops the table. If any row exists it refuses unless run with
`-x allow-data-loss=true` (only challenge history is lost; tasks are never
involved).
"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa
import sqlmodel  # noqa: F401  (autogenerate renders sqlmodel.sql.sqltypes.AutoString)


# revision identifiers, used by Alembic.
revision: str = '0010_daily_challenges'
down_revision: Union[str, Sequence[str], None] = '0009_blocks'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('daily_challenges',
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('challenge_key', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('shown', sa.JSON(), nullable=False),
    sa.Column('completed_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('day')
    )


def downgrade() -> None:
    allow = context.get_x_argument(as_dictionary=True).get("allow-data-loss", "").lower() == "true"
    count = op.get_bind().execute(sa.text("SELECT COUNT(*) FROM daily_challenges")).scalar()
    if count and not allow:
        raise RuntimeError(
            f"Downgrading 0010 deletes {count} day(s) of Break-the-default history. Then: "
            "alembic -x allow-data-loss=true downgrade 0009_blocks"
        )
    op.drop_table('daily_challenges')
