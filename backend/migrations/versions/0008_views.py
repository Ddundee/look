"""views

Revision ID: 0008_views
Revises: 0007_category_life_areas
Create Date: 2026-10-03

Additive: a views table for custom views and customized layouts of the
built-in Dashboard and Today. Default layouts are not stored here; they
live in app code (app.services.views), so a fresh install has no rows.

Downgrade drops the table. If any view or customized layout exists it
refuses unless run with `-x allow-data-loss=true` (no tasks, events or
other data are involved, only layouts).
"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa
import sqlmodel  # noqa: F401  (autogenerate renders sqlmodel.sql.sqltypes.AutoString)


# revision identifiers, used by Alembic.
revision: str = '0008_views'
down_revision: Union[str, Sequence[str], None] = '0007_category_life_areas'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('views',
    sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('key', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('icon', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('kind', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('show_in_nav', sa.Boolean(), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('archived', sa.Boolean(), nullable=False),
    sa.Column('layout', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('key')
    )


def downgrade() -> None:
    allow = context.get_x_argument(as_dictionary=True).get("allow-data-loss", "").lower() == "true"
    count = op.get_bind().execute(sa.text("SELECT COUNT(*) FROM views")).scalar()
    if count and not allow:
        raise RuntimeError(
            f"Downgrading 0008 deletes {count} view(s)/layout(s). Then: "
            "alembic -x allow-data-loss=true downgrade 0007_category_life_areas"
        )
    op.drop_table('views')
