"""blocks

Revision ID: 0009_blocks
Revises: 0008_views
Create Date: 2026-10-08

Additive: a blocks table for the blocks library (smart lists and notes)
that views place with a `block` widget. Nothing existing changes.

Downgrade drops the table. If any block exists it refuses unless run with
`-x allow-data-loss=true` (notes' text would be lost; tasks and events
are never involved). Block widgets left on views are skipped when read.
"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa
import sqlmodel  # noqa: F401  (autogenerate renders sqlmodel.sql.sqltypes.AutoString)


# revision identifiers, used by Alembic.
revision: str = '0009_blocks'
down_revision: Union[str, Sequence[str], None] = '0008_views'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('blocks',
    sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('icon', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('color', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('kind', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('config', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    allow = context.get_x_argument(as_dictionary=True).get("allow-data-loss", "").lower() == "true"
    count = op.get_bind().execute(sa.text("SELECT COUNT(*) FROM blocks")).scalar()
    if count and not allow:
        raise RuntimeError(
            f"Downgrading 0009 deletes {count} block(s), including notes' text. Then: "
            "alembic -x allow-data-loss=true downgrade 0008_views"
        )
    op.drop_table('blocks')
