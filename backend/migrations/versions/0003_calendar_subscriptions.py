"""add calendar subscriptions (ICS feeds and file imports)

Revision ID: 0003_calendar_subscriptions
Revises: 0002_add_leetcode_tracking
Create Date: 2026-10-02

Additive: a calendar_subscriptions table, and nullable sync columns on
events (subscription_id, external_uid, external_url, external_status,
external_hash, last_synced_at) with UNIQUE(subscription_id, external_uid).
Existing events keep null in all of them and are unchanged.

Downgrade drops the sync columns and the table. Imported events are kept
as plain events; if any subscriptions exist it refuses unless run with
`-x allow-data-loss=true`, since their configuration would be lost.
"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import sqlmodel  # noqa: F401  (autogenerate renders sqlmodel.sql.sqltypes.AutoString)


# revision identifiers, used by Alembic.
revision: str = '0003_calendar_subscriptions'
down_revision: Union[str, Sequence[str], None] = '0002_add_leetcode_tracking'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SOURCE_TYPES = ("url", "file")


def _source_type() -> sa.Enum:
    # As in earlier revisions: on PostgreSQL the type is created up front only
    # if missing and the column reuses it.
    return sa.Enum(*SOURCE_TYPES, name="calendarsourcetype").with_variant(
        postgresql.ENUM(*SOURCE_TYPES, name="calendarsourcetype", create_type=False), "postgresql"
    )


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        postgresql.ENUM(*SOURCE_TYPES, name="calendarsourcetype").create(bind, checkfirst=True)

    op.create_table('calendar_subscriptions',
    sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('source_type', _source_type(), nullable=False),
    sa.Column('source_url', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('enabled', sa.Boolean(), nullable=False),
    sa.Column('sync_interval_minutes', sa.Integer(), nullable=False),
    sa.Column('last_sync_at', sa.DateTime(), nullable=True),
    sa.Column('last_success_at', sa.DateTime(), nullable=True),
    sa.Column('last_error', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('etag', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('last_modified', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('last_result', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('source_url')
    )
    with op.batch_alter_table('events', schema=None) as batch_op:
        batch_op.add_column(sa.Column('subscription_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
        batch_op.add_column(sa.Column('external_uid', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
        batch_op.add_column(sa.Column('external_url', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
        batch_op.add_column(sa.Column('external_status', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
        batch_op.add_column(sa.Column('external_hash', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
        batch_op.add_column(sa.Column('last_synced_at', sa.DateTime(), nullable=True))
        batch_op.create_index(batch_op.f('ix_events_subscription_id'), ['subscription_id'], unique=False)
        batch_op.create_unique_constraint('uq_events_subscription_uid', ['subscription_id', 'external_uid'])
        batch_op.create_foreign_key(
            'fk_events_subscription_id', 'calendar_subscriptions', ['subscription_id'], ['id']
        )


def downgrade() -> None:
    bind = op.get_bind()
    allow = context.get_x_argument(as_dictionary=True).get("allow-data-loss", "").lower() == "true"
    count = bind.execute(sa.text("SELECT COUNT(*) FROM calendar_subscriptions")).scalar()
    if count and not allow:
        raise RuntimeError(
            f"Downgrading 0003 deletes {count} calendar subscription(s) (imported events are kept "
            "as plain events). Back up first, then: "
            "alembic -x allow-data-loss=true downgrade 0002_add_leetcode_tracking"
        )

    with op.batch_alter_table('events', schema=None) as batch_op:
        batch_op.drop_constraint('fk_events_subscription_id', type_='foreignkey')
        batch_op.drop_constraint('uq_events_subscription_uid', type_='unique')
        batch_op.drop_index(batch_op.f('ix_events_subscription_id'))
        batch_op.drop_column('last_synced_at')
        batch_op.drop_column('external_hash')
        batch_op.drop_column('external_status')
        batch_op.drop_column('external_url')
        batch_op.drop_column('external_uid')
        batch_op.drop_column('subscription_id')

    op.drop_table('calendar_subscriptions')
    sa.Enum(name="calendarsourcetype").drop(bind, checkfirst=True)
