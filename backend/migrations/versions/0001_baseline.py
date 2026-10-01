"""baseline: the schema as it was when Look adopted Alembic

Revision ID: 0001_baseline
Revises:
Create Date: 2026-10-01

Every table here was previously created by SQLModel.metadata.create_all()
at startup. To adopt such a database safely, each table is created ONLY if
it doesn't exist yet: existing tables (and their rows) are never dropped or
recreated, while an older install that predates newer tables (events,
nutrition) gets them added. app.migrate verifies an existing database's
columns match this baseline before running it; see docs/DATABASE.md.

Downgrading drops every table and all data in them, so it refuses unless
run with `-x allow-data-loss=true`.
"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import sqlmodel  # noqa: F401  (autogenerate renders sqlmodel.sql.sqltypes.AutoString)


# revision identifiers, used by Alembic.
revision: str = '0001_baseline'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# PostgreSQL enum types are created up front, only if missing, and the
# columns below reuse them (create_type=False). A type can exist without
# its table (create_all made every type at once), and must not make
# creating that table fail.
ENUMS = {
    'mealtype': ('breakfast', 'lunch', 'dinner', 'snack',),
    'recurrencepattern': ('daily', 'weekdays', 'weekly', 'specific_days', 'monthly', 'custom_interval',),
    'taskpriority': ('critical', 'high', 'medium', 'low',),
    'taskstatus': ('inbox', 'todo', 'in_progress', 'blocked', 'completed', 'cancelled',),
}


def _enum(name: str) -> sa.Enum:
    values = ENUMS[name]
    return sa.Enum(*values, name=name).with_variant(
        postgresql.ENUM(*values, name=name, create_type=False), "postgresql"
    )


def _missing(table: str) -> bool:
    return not sa.inspect(op.get_bind()).has_table(table)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for name, values in ENUMS.items():
            postgresql.ENUM(*values, name=name).create(bind, checkfirst=True)

    if _missing('events'):
        op.create_table('events',
        sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('title', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('location', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('notes', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('category', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('all_day', sa.Boolean(), nullable=False),
        sa.Column('start_at', sa.DateTime(), nullable=False),
        sa.Column('end_at', sa.DateTime(), nullable=False),
        sa.Column('rrule', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('exdates', sa.JSON(), nullable=True),
        sa.Column('source', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('events', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_events_category'), ['category'], unique=False)
            batch_op.create_index(batch_op.f('ix_events_start_at'), ['start_at'], unique=False)

    if _missing('food_entries'):
        op.create_table('food_entries',
        sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('quantity', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('calories', sa.Float(), nullable=False),
        sa.Column('protein_g', sa.Float(), nullable=False),
        sa.Column('carbs_g', sa.Float(), nullable=False),
        sa.Column('fat_g', sa.Float(), nullable=False),
        sa.Column('meal', _enum('mealtype'), nullable=True),
        sa.Column('eaten_on', sa.Date(), nullable=False),
        sa.Column('eaten_at', sa.Time(), nullable=True),
        sa.Column('notes', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('source', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('food_entries', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_food_entries_eaten_on'), ['eaten_on'], unique=False)

    if _missing('nutrition_targets'):
        op.create_table('nutrition_targets',
        sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('calories', sa.Float(), nullable=False),
        sa.Column('protein_g', sa.Float(), nullable=True),
        sa.Column('carbs_g', sa.Float(), nullable=True),
        sa.Column('fat_g', sa.Float(), nullable=True),
        sa.Column('effective_from', sa.Date(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('nutrition_targets', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_nutrition_targets_effective_from'), ['effective_from'], unique=True)

    if _missing('recurrence_rules'):
        op.create_table('recurrence_rules',
        sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('title', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('description', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('category', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('priority', _enum('taskpriority'), nullable=False),
        sa.Column('estimated_duration', sa.Integer(), nullable=True),
        sa.Column('tags', sa.JSON(), nullable=True),
        sa.Column('pattern', _enum('recurrencepattern'), nullable=False),
        sa.Column('days_of_week', sa.JSON(), nullable=True),
        sa.Column('interval_days', sa.Integer(), nullable=True),
        sa.Column('day_of_month', sa.Integer(), nullable=True),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )

    if _missing('users'):
        op.create_table('users',
        sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('username', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('password_hash', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('users', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_users_username'), ['username'], unique=True)

    if _missing('event_overrides'):
        op.create_table('event_overrides',
        sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('event_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('original_date', sa.Date(), nullable=False),
        sa.Column('cancelled', sa.Boolean(), nullable=False),
        sa.Column('start_at', sa.DateTime(), nullable=True),
        sa.Column('end_at', sa.DateTime(), nullable=True),
        sa.Column('title', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('location', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('notes', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['event_id'], ['events.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('event_id', 'original_date')
        )
        with op.batch_alter_table('event_overrides', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_event_overrides_event_id'), ['event_id'], unique=False)

    if _missing('tasks'):
        op.create_table('tasks',
        sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('title', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('description', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('status', _enum('taskstatus'), nullable=False),
        sa.Column('priority', _enum('taskpriority'), nullable=False),
        sa.Column('category', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('tags', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('due_date', sa.Date(), nullable=True),
        sa.Column('due_time', sa.Time(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('estimated_duration', sa.Integer(), nullable=True),
        sa.Column('source', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('external_reference', sa.String(), nullable=True),
        sa.Column('notes', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('planned_for_date', sa.Date(), nullable=True),
        sa.Column('recurrence_rule_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('occurrence_date', sa.Date(), nullable=True),
        sa.ForeignKeyConstraint(['recurrence_rule_id'], ['recurrence_rules.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('tasks', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_tasks_category'), ['category'], unique=False)
            batch_op.create_index(batch_op.f('ix_tasks_due_date'), ['due_date'], unique=False)
            batch_op.create_index(batch_op.f('ix_tasks_occurrence_date'), ['occurrence_date'], unique=False)
            batch_op.create_index(batch_op.f('ix_tasks_planned_for_date'), ['planned_for_date'], unique=False)
            batch_op.create_index(batch_op.f('ix_tasks_priority'), ['priority'], unique=False)
            batch_op.create_index(batch_op.f('ix_tasks_recurrence_rule_id'), ['recurrence_rule_id'], unique=False)
            batch_op.create_index(batch_op.f('ix_tasks_status'), ['status'], unique=False)


def downgrade() -> None:
    allow = context.get_x_argument(as_dictionary=True).get("allow-data-loss", "").lower() == "true"
    if not allow:
        raise RuntimeError(
            "Downgrading the baseline drops every Look table and ALL data in them. "
            "Only do this on a throwaway database or with a backup: "
            "alembic -x allow-data-loss=true downgrade base"
        )
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_tasks_status'))
        batch_op.drop_index(batch_op.f('ix_tasks_recurrence_rule_id'))
        batch_op.drop_index(batch_op.f('ix_tasks_priority'))
        batch_op.drop_index(batch_op.f('ix_tasks_planned_for_date'))
        batch_op.drop_index(batch_op.f('ix_tasks_occurrence_date'))
        batch_op.drop_index(batch_op.f('ix_tasks_due_date'))
        batch_op.drop_index(batch_op.f('ix_tasks_category'))

    op.drop_table('tasks')
    with op.batch_alter_table('event_overrides', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_event_overrides_event_id'))

    op.drop_table('event_overrides')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_username'))

    op.drop_table('users')
    op.drop_table('recurrence_rules')
    with op.batch_alter_table('nutrition_targets', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_nutrition_targets_effective_from'))

    op.drop_table('nutrition_targets')
    with op.batch_alter_table('food_entries', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_food_entries_eaten_on'))

    op.drop_table('food_entries')
    with op.batch_alter_table('events', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_events_start_at'))
        batch_op.drop_index(batch_op.f('ix_events_category'))

    op.drop_table('events')

    # Enum types outlive their tables on PostgreSQL; drop them too so a
    # following upgrade starts clean. (No-op on SQLite.)
    bind = op.get_bind()
    for name in ENUMS:
        sa.Enum(name=name).drop(bind, checkfirst=True)
