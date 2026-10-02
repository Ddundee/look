"""courses and categories

Revision ID: 0005_courses_and_categories
Revises: 0004_event_deadline_completion
Create Date: 2026-10-02

Additive:
- categories: styled categories. Seeded with the categories Look ships
  with (task: LeetCode, school, project, personal, errands; event: class,
  social, sports, work, appointment, other) as system categories, plus
  every other category string already used by a task, recurring task or
  event. Keys are those exact strings, so no task or event is rewritten.
- courses and course_links (remembered external identities).
- events.course_id, course_source, external_context (nullable).

Downgrade drops all of it. If any course exists or a category was added
or changed by the user it refuses unless run with
`-x allow-data-loss=true`.
"""
from typing import Sequence, Union

import zlib
from datetime import datetime, timezone
import uuid

from alembic import context, op
import sqlalchemy as sa
import sqlmodel  # noqa: F401  (autogenerate renders sqlmodel.sql.sqltypes.AutoString)


# revision identifiers, used by Alembic.
revision: str = '0005_courses_and_categories'
down_revision: Union[str, Sequence[str], None] = '0004_event_deadline_completion'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('categories',
    sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('key', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('color', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('style', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('is_system', sa.Boolean(), nullable=False),
    sa.Column('archived', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('key')
    )
    op.create_table('courses',
    sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('code', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('code_key', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('color', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('style', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('aliases', sa.JSON(), nullable=True),
    sa.Column('archived', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('code_key')
    )
    op.create_table('course_links',
    sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('course_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('source', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('external_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('source', 'external_id', name='uq_course_links_source_external')
    )
    with op.batch_alter_table('course_links', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_course_links_course_id'), ['course_id'], unique=False)

    with op.batch_alter_table('events', schema=None) as batch_op:
        batch_op.add_column(sa.Column('course_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
        batch_op.add_column(sa.Column('course_source', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
        batch_op.add_column(sa.Column('external_context', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
        batch_op.create_index(batch_op.f('ix_events_course_id'), ['course_id'], unique=False)
        batch_op.create_foreign_key('fk_events_course_id', 'courses', ['course_id'], ['id'])

    _seed_categories()


def downgrade() -> None:
    bind = op.get_bind()
    allow = context.get_x_argument(as_dictionary=True).get("allow-data-loss", "").lower() == "true"
    courses = bind.execute(sa.text("SELECT COUNT(*) FROM courses")).scalar()
    customized = bind.execute(sa.text("SELECT COUNT(*) FROM categories WHERE created_at <> updated_at")).scalar()
    if (courses or customized) and not allow:
        raise RuntimeError(
            f"Downgrading 0005 deletes {courses} course(s) and category colors/styles "
            f"({customized} changed). Tasks and events keep their category names. Back up first, then: "
            "alembic -x allow-data-loss=true downgrade 0004_event_deadline_completion"
        )
    with op.batch_alter_table('events', schema=None) as batch_op:
        batch_op.drop_constraint('fk_events_course_id', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_events_course_id'))
        batch_op.drop_column('external_context')
        batch_op.drop_column('course_source')
        batch_op.drop_column('course_id')
    with op.batch_alter_table('course_links', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_course_links_course_id'))
    op.drop_table('course_links')
    op.drop_table('courses')
    op.drop_table('categories')


# Frozen copies (not imported from app code, so this migration never changes).
_PALETTE = ("red", "orange", "amber", "yellow", "lime", "green", "teal", "cyan", "sky", "blue", "indigo", "violet", "pink", "slate")
_SYSTEM = (
    # key, name, color (the colors Look used before categories were styled)
    ("personal", "Personal", "green"),
    ("school", "School", "red"),
    ("project", "Project", "violet"),
    ("errands", "Errands", "lime"),
    ("LeetCode", "LeetCode", "amber"),
    ("class", "Class", "amber"),
    ("social", "Social", "pink"),
    ("sports", "Sports", "green"),
    ("work", "Work", "violet"),
    ("appointment", "Appointment", "orange"),
    ("other", "Other", "slate"),
)


def _seed_categories() -> None:
    bind = op.get_bind()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    table = sa.table(
        "categories",
        sa.column("id", sa.String), sa.column("key", sa.String), sa.column("name", sa.String),
        sa.column("color", sa.String), sa.column("style", sa.String), sa.column("is_system", sa.Boolean),
        sa.column("archived", sa.Boolean), sa.column("created_at", sa.DateTime), sa.column("updated_at", sa.DateTime),
    )
    rows, seen = [], set()
    for key, name, color in _SYSTEM:
        rows.append(dict(key=key, name=name, color=color, is_system=True))
        seen.add(key)
    used = set()
    for sql in ("SELECT DISTINCT category FROM tasks", "SELECT DISTINCT category FROM recurrence_rules",
                "SELECT DISTINCT category FROM events"):
        used.update(r[0] for r in bind.execute(sa.text(sql)) if r[0])
    for key in sorted(used - seen):
        color = _PALETTE[zlib.crc32(key.lower().encode()) % len(_PALETTE)]
        rows.append(dict(key=key, name=key[:1].upper() + key[1:], color=color, is_system=False))
    op.bulk_insert(table, [
        dict(id=str(uuid.uuid4()), style="solid", archived=False, created_at=now, updated_at=now, **r) for r in rows
    ])
