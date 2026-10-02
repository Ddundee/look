"""add leetcode tracking

Revision ID: 0002_add_leetcode_tracking
Revises: 0001_baseline
Create Date: 2026-10-01

Additive only: three new tables (leetcode_problems, leetcode_attempts,
leetcode_goals) and the leetcodedifficulty enum. Nothing existing changes.

Downgrade drops exactly those. If they hold any LeetCode data it refuses
unless run with `-x allow-data-loss=true`, since that history would be
gone; other Look data is never touched.
"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import sqlmodel  # noqa: F401  (autogenerate renders sqlmodel.sql.sqltypes.AutoString)


# revision identifiers, used by Alembic.
revision: str = '0002_add_leetcode_tracking'
down_revision: Union[str, Sequence[str], None] = '0001_baseline'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DIFFICULTY = ("easy", "medium", "hard")


def _difficulty() -> sa.Enum:
    # As in the baseline: on PostgreSQL the type is created up front only if
    # missing, and the column reuses it, so a leftover type can't break this.
    return sa.Enum(*DIFFICULTY, name="leetcodedifficulty").with_variant(
        postgresql.ENUM(*DIFFICULTY, name="leetcodedifficulty", create_type=False), "postgresql"
    )


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        postgresql.ENUM(*DIFFICULTY, name="leetcodedifficulty").create(bind, checkfirst=True)

    op.create_table('leetcode_goals',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('daily_target', sa.Integer(), nullable=False),
    sa.Column('weekly_target', sa.Integer(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('leetcode_problems',
    sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('number', sa.Integer(), nullable=False),
    sa.Column('title', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('slug', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('url', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('difficulty', _difficulty(), nullable=False),
    sa.Column('topics', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('leetcode_problems', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_leetcode_problems_number'), ['number'], unique=True)

    op.create_table('leetcode_attempts',
    sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('problem_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('attempted_at', sa.DateTime(), nullable=False),
    sa.Column('solved', sa.Boolean(), nullable=False),
    sa.Column('solved_independently', sa.Boolean(), nullable=False),
    sa.Column('hint_used', sa.Boolean(), nullable=False),
    sa.Column('duration_minutes', sa.Integer(), nullable=True),
    sa.Column('language', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('confidence', sa.Integer(), nullable=True),
    sa.Column('notes', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('source', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['problem_id'], ['leetcode_problems.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('leetcode_attempts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_leetcode_attempts_attempted_at'), ['attempted_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_leetcode_attempts_problem_id'), ['problem_id'], unique=False)



def downgrade() -> None:
    bind = op.get_bind()
    allow = context.get_x_argument(as_dictionary=True).get("allow-data-loss", "").lower() == "true"
    rows = sum(
        bind.execute(sa.text(f"SELECT COUNT(*) FROM {table}")).scalar()
        for table in ("leetcode_attempts", "leetcode_problems")
    )
    if rows and not allow:
        raise RuntimeError(
            f"Downgrading 0002 deletes all LeetCode tracking data ({rows} problem/attempt rows). "
            "Back up first, then: alembic -x allow-data-loss=true downgrade 0001_baseline"
        )

    with op.batch_alter_table('leetcode_attempts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_leetcode_attempts_problem_id'))
        batch_op.drop_index(batch_op.f('ix_leetcode_attempts_attempted_at'))

    op.drop_table('leetcode_attempts')
    with op.batch_alter_table('leetcode_problems', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_leetcode_problems_number'))

    op.drop_table('leetcode_problems')
    op.drop_table('leetcode_goals')

    # The enum type outlives its table on PostgreSQL. (No-op on SQLite.)
    sa.Enum(name="leetcodedifficulty").drop(bind, checkfirst=True)
