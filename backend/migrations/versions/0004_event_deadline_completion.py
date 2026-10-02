"""event deadline completion

Revision ID: 0004_event_deadline_completion
Revises: 0003_calendar_subscriptions
Create Date: 2026-10-02

Additive: events.is_deadline (not null, default false), completed_at,
completion_source and external_completed (nullable). Every existing event
is a non-deadline and incomplete; imported assignments are classified on
their next sync.

Downgrade drops only these four columns. If any event has been checked
off it refuses unless run with `-x allow-data-loss=true`, since those
checkmarks would be lost.
"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa
import sqlmodel  # noqa: F401  (autogenerate renders sqlmodel.sql.sqltypes.AutoString)


# revision identifiers, used by Alembic.
revision: str = '0004_event_deadline_completion'
down_revision: Union[str, Sequence[str], None] = '0003_calendar_subscriptions'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('events', schema=None) as batch_op:
        batch_op.add_column(sa.Column('is_deadline', sa.Boolean(), server_default=sa.false(), nullable=False))
        batch_op.add_column(sa.Column('completed_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('completion_source', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
        batch_op.add_column(sa.Column('external_completed', sa.Boolean(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    allow = context.get_x_argument(as_dictionary=True).get("allow-data-loss", "").lower() == "true"
    done = bind.execute(sa.text("SELECT COUNT(*) FROM events WHERE completed_at IS NOT NULL")).scalar()
    if done and not allow:
        raise RuntimeError(
            f"Downgrading 0004 drops the completion of {done} checked-off event(s). Back up first, then: "
            "alembic -x allow-data-loss=true downgrade 0003_calendar_subscriptions"
        )
    with op.batch_alter_table('events', schema=None) as batch_op:
        batch_op.drop_column('external_completed')
        batch_op.drop_column('completion_source')
        batch_op.drop_column('completed_at')
        batch_op.drop_column('is_deadline')
