"""category life areas

Revision ID: 0007_category_life_areas
Revises: 0006_leetcode_import_metadata
Create Date: 2026-10-02

Data only. Organizes the built-in categories around life areas:

  Personal, School, Career, Projects, Organizations, Health, Errands,
  Social, Other (+ LeetCode, kept as its own category)

Only built-in categories nobody has edited (is_system and
created_at = updated_at) are changed, and user categories never are:

- renamed by display name only, keeping the key tasks/events store:
  work -> "Career", project -> "Projects";
- restyled with a coherent default set (see _LOOKS);
- new built-ins "organizations" and "health" (skipped if the key exists);
- class -> school: events, tasks and recurring tasks with category
  "class" move to "school" (a class is school; its course already
  identifies it), then "class" is archived;
- sports and appointment are archived only if nothing uses them (they're
  ambiguous, so used ones are left alone).

Archived categories keep their look on any item and can be restored in
Settings. Downgrade restores the previous names, looks and archive state
of rows this migration changed and still look as it left them; items
moved from "class" to "school" stay in School.
"""

from typing import Sequence, Union
from datetime import datetime, timezone
import uuid

import sqlalchemy as sa
from alembic import op

revision: str = '0007_category_life_areas'
down_revision: Union[str, Sequence[str], None] = '0006_leetcode_import_metadata'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# key: (name, color, style) after this migration; and what 0005 seeded.
_LOOKS = {
    "personal": ("Personal", "blue", "soft"),
    "school": ("School", "amber", "striped"),
    "work": ("Career", "violet", "soft"),
    "project": ("Projects", "teal", "outline"),
    "errands": ("Errands", "orange", "outline"),
    "social": ("Social", "pink", "glass"),
    "other": ("Other", "slate", "soft"),
    "LeetCode": ("LeetCode", "violet", "striped"),
}
_SEEDED = {
    "personal": ("Personal", "green", "solid"),
    "school": ("School", "red", "solid"),
    "work": ("Work", "violet", "solid"),
    "project": ("Project", "violet", "solid"),
    "errands": ("Errands", "lime", "solid"),
    "social": ("Social", "pink", "solid"),
    "other": ("Other", "slate", "solid"),
    "LeetCode": ("LeetCode", "amber", "solid"),
    "class": ("Class", "amber", "solid"),
    "sports": ("Sports", "green", "solid"),
    "appointment": ("Appointment", "orange", "solid"),
}
_NEW = {"organizations": ("Organizations", "indigo", "outline"), "health": ("Health", "green", "soft")}
_ARCHIVE_IF_UNUSED = ("sports", "appointment")
_USERS = ("tasks", "recurrence_rules", "events")


def _untouched(bind, key: str):
    """The row for a built-in category nobody has edited, or None."""
    return bind.execute(sa.text(
        "SELECT id FROM categories WHERE key = :k AND is_system = true AND created_at = updated_at"
    ), {"k": key}).first()


def _set(bind, key: str, name: str, color: str, style: str, archived: bool = False) -> None:
    # Leaves created_at = updated_at, so these still count as untouched defaults.
    bind.execute(sa.text(
        "UPDATE categories SET name = :n, color = :c, style = :s, archived = :a WHERE key = :k"
    ), {"k": key, "n": name, "c": color, "s": style, "a": archived})


def _used(bind, key: str) -> bool:
    return any(
        bind.execute(sa.text(f"SELECT 1 FROM {table} WHERE category = :k LIMIT 1"), {"k": key}).first()
        for table in _USERS
    )


def upgrade() -> None:
    bind = op.get_bind()
    for key, look in _LOOKS.items():
        if _untouched(bind, key):
            _set(bind, key, *look)

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for key, (name, color, style) in _NEW.items():
        if not bind.execute(sa.text("SELECT 1 FROM categories WHERE lower(key) = :k"), {"k": key}).first():
            bind.execute(sa.text(
                "INSERT INTO categories (id, key, name, color, style, is_system, archived, created_at, updated_at) "
                "VALUES (:id, :k, :n, :c, :s, true, false, :t, :t)"
            ), {"id": str(uuid.uuid4()), "k": key, "n": name, "c": color, "s": style, "t": now})

    if _untouched(bind, "class") and _untouched(bind, "school"):
        for table in _USERS:
            bind.execute(sa.text(f"UPDATE {table} SET category = 'school' WHERE category = 'class'"))
        _set(bind, "class", *_SEEDED["class"], archived=True)

    for key in _ARCHIVE_IF_UNUSED:
        if _untouched(bind, key) and not _used(bind, key):
            _set(bind, key, *_SEEDED[key], archived=True)


def downgrade() -> None:
    bind = op.get_bind()
    for key, look in _LOOKS.items():
        row = bind.execute(sa.text(
            "SELECT 1 FROM categories WHERE key = :k AND is_system = true AND created_at = updated_at "
            "AND name = :n AND color = :c AND style = :s"
        ), {"k": key, "n": look[0], "c": look[1], "s": look[2]}).first()
        if row:
            _set(bind, key, *_SEEDED[key])
    for key in ("class", *_ARCHIVE_IF_UNUSED):
        if _untouched(bind, key):
            _set(bind, key, *_SEEDED[key], archived=False)
    for key in _NEW:
        if _untouched(bind, key) and not _used(bind, key):
            bind.execute(sa.text("DELETE FROM categories WHERE key = :k"), {"k": key})
