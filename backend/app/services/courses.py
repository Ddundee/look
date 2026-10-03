"""Courses (classes) and how events get linked to them.

Matching is conservative and uses stable evidence first:

1. A remembered external identity: the Canvas course context in the item's
   URL (`include_contexts=course_123` on canvas.vt.edu) linked to a course,
   learned automatically or from a manual correction.
2. The course code Canvas appends to every title (`Project 2 [CS-3214]`),
   when the item also carries a Canvas course context: that's Canvas
   itself saying which course, so the course is created if needed (only
   for a recognizable code like "CS-3214") and the context remembered.
3. A bracketed code from any other feed, or a title that starts with a
   course code ("CS 3214 lecture"), but only matched against courses that
   already exist (by code or alias). Never creates one.
4. Otherwise: no course.

A manual choice (including "no course") is never overwritten, and when it
has a Canvas context it is remembered for every item from that context.
"""

import re
from typing import Iterable, List, Optional
from urllib.parse import parse_qs, urlsplit

from sqlmodel import Session, func, select

from app.models.events import Event
from app.models.planning import COLORS, Course, CourseLink
from app.schemas import CourseCreate, CourseRead, CourseUpdate
from app.utils import utcnow

CANVAS = "canvas"
# "CS 3214", "CS-3214", "cs3214", "COMM 2014", "MATH 2114H"
_CODE = re.compile(r"^\s*([A-Za-z]{2,5})[\s_\-]*(\d{4}[A-Za-z]?)(?![\dA-Za-z])")
_BRACKET_SUFFIX = re.compile(r"\[([^\[\]]{2,40})\]\s*$")
_CANVAS_COURSE_CONTEXT = re.compile(r"^course_\d+$")
# Colors handed to new courses, in order, skipping ones other courses use.
# Spread around the hue wheel so the first several classes are easy to
# tell apart (no blue/sky/cyan/teal run); existing courses keep theirs.
_COURSE_COLORS = ("blue", "orange", "violet", "green", "pink", "teal", "amber", "indigo", "red", "cyan",
                  "lime", "sky", "yellow", "slate")


def normalize(raw: str) -> str:
    """Matching key: "CS-3214" == "cs 3214" == "CS3214"."""
    return re.sub(r"[^A-Z0-9]", "", raw.upper())


def display_code(raw: str) -> str:
    """"CS-3214" -> "CS 3214"; anything that isn't a course code stays as is."""
    m = _CODE.match(raw)
    return f"{m.group(1).upper()} {m.group(2).upper()}" if m else raw.strip()


def bracket_code(title: str) -> Optional[str]:
    """The trailing "[CS-3214]" Canvas appends to titles, if present."""
    m = _BRACKET_SUFFIX.search(title or "")
    return m.group(1).strip() if m else None


def canvas_context(url: Optional[str], uid: Optional[str] = None) -> Optional[str]:
    """The Canvas course an item belongs to, from its URL
    ("https://canvas.vt.edu/calendar?include_contexts=course_123&..."), as
    "canvas.vt.edu/course_123". User and group contexts aren't courses."""
    if not url:
        return None
    parts = urlsplit(url)
    contexts = parse_qs(parts.query).get("include_contexts", [])
    courses = [c for c in ",".join(contexts).split(",") if _CANVAS_COURSE_CONTEXT.match(c.strip())]
    if len(courses) != 1 or not parts.netloc:
        return None
    return f"{parts.netloc.lower()}/{courses[0].strip()}"


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


def list_courses(session: Session, include_archived: bool = False) -> List[Course]:
    stmt = select(Course)
    if not include_archived:
        stmt = stmt.where(Course.archived == False)  # noqa: E712
    return list(session.exec(stmt.order_by(Course.code)).all())


def get_course(session: Session, course_id: str) -> Optional[Course]:
    return session.get(Course, course_id)


def find_by_code(session: Session, raw: str) -> Optional[Course]:
    """By normalized code or alias, archived included."""
    key = normalize(raw)
    if not key:
        return None
    course = session.exec(select(Course).where(Course.code_key == key)).first()
    if course is not None:
        return course
    return next((c for c in session.exec(select(Course)).all() if key in (c.aliases or [])), None)


def _next_color(session: Session) -> str:
    used = {c.color for c in list_courses(session)}
    return next((c for c in _COURSE_COLORS if c not in used), COLORS[len(used) % len(COLORS)])


def _clean_aliases(aliases: Iterable[str], code_key: str) -> List[str]:
    out = []
    for alias in aliases:
        key = normalize(alias)
        if key and key != code_key and key not in out:
            out.append(key)
    return out


def _check_free(session: Session, keys: Iterable[str], exclude_id: Optional[str] = None) -> None:
    for key in keys:
        other = find_by_code(session, key)
        if other is not None and other.id != exclude_id:
            raise ValueError(f"'{key}' already belongs to {other.code}.")


def create_course(session: Session, payload: CourseCreate, commit: bool = True) -> Course:
    code = display_code(payload.code)
    code_key = normalize(code)
    if not code_key:
        raise ValueError("A course code needs letters or numbers, e.g. CS 3214.")
    aliases = _clean_aliases(payload.aliases, code_key)
    _check_free(session, [code_key, *aliases])
    course = Course(
        code=code, code_key=code_key, name=(payload.name or "").strip() or None,
        color=payload.color or _next_color(session), style=payload.style or "soft", aliases=aliases,
    )
    session.add(course)
    session.flush()
    if commit:
        rematch(session)
        session.commit()
        session.refresh(course)
    return course


def update_course(session: Session, course: Course, changes: CourseUpdate) -> Course:
    data = changes.model_dump(exclude_unset=True)
    if data.get("code") is not None:
        code = display_code(data.pop("code"))
        key = normalize(code)
        _check_free(session, [key], exclude_id=course.id)
        course.code, course.code_key = code, key
    if data.get("aliases") is not None:
        aliases = _clean_aliases(data.pop("aliases"), course.code_key)
        _check_free(session, aliases, exclude_id=course.id)
        course.aliases = aliases
    if "name" in data:
        course.name = (data.pop("name") or "").strip() or None
    for field in ("color", "style", "archived"):
        if data.get(field) is not None:
            setattr(course, field, data[field])
    course.updated_at = utcnow()
    session.add(course)
    session.flush()
    rematch(session)
    session.commit()
    session.refresh(course)
    return course


def link(session: Session, course: Course, external_id: str, source: str = CANVAS) -> None:
    """Remember that `external_id` (a Canvas context) is this course."""
    existing = session.exec(
        select(CourseLink).where(CourseLink.source == source, CourseLink.external_id == external_id)
    ).first()
    if existing is None:
        session.add(CourseLink(course_id=course.id, source=source, external_id=external_id))
    elif existing.course_id != course.id:
        existing.course_id = course.id
        session.add(existing)
    session.flush()


def links_for(session: Session, course: Course) -> List[CourseLink]:
    return list(session.exec(select(CourseLink).where(CourseLink.course_id == course.id)).all())


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------


def _usable(course: Optional[Course]) -> Optional[Course]:
    return course if course is not None and not course.archived else None


def match_title(session: Session, title: str) -> Optional[Course]:
    """An existing course whose code (or alias) starts the title, as in
    "CS 3214 lecture". Never creates one; personal titles never match."""
    m = _CODE.match(title or "")
    return _usable(find_by_code(session, m.group(0))) if m else None


def resolve(session: Session, title: str, external_context: Optional[str], create: bool = False) -> Optional[Course]:
    """The course for an item, by the rules in the module docstring.
    `create` (only during a sync of a Canvas feed) allows creating a course
    from Canvas's own course code. Archived courses match nothing, and
    because their links stay, they aren't recreated either."""
    if external_context:
        known = session.exec(
            select(CourseLink).where(CourseLink.source == CANVAS, CourseLink.external_id == external_context)
        ).first()
        if known is not None:
            return _usable(session.get(Course, known.course_id))
    hint = bracket_code(title)
    if hint:
        course = find_by_code(session, hint) or find_by_code(session, display_code(hint))
        # Only a recognizable course code ("CS-3214") creates a course; an
        # opaque one ("2026FA-13123") stays unmapped until mapped by hand.
        if course is None and create and external_context and _CODE.match(hint):
            code = display_code(hint)
            course = create_course(session, CourseCreate(code=code, aliases=[hint]), commit=False)
        if course is not None:
            if external_context:
                link(session, course, external_context)
            return _usable(course)
    return match_title(session, title)


def apply(session: Session, event: Event, create: bool = False) -> None:
    """Set an event's course automatically, unless it was chosen by hand."""
    if event.course_source == "manual":
        return
    course = resolve(session, event.title, event.external_context, create=create)
    event.course_id = course.id if course else None
    event.course_source = "auto" if course else None


def rematch(session: Session) -> int:
    """Re-run automatic matching for every event not set by hand, after
    courses or remembered links change. Doesn't create courses. Doesn't
    commit. Returns how many events changed."""
    changed = 0
    for event in session.exec(select(Event).where((Event.course_source != "manual") | (Event.course_source.is_(None)))).all():
        before = event.course_id
        apply(session, event)
        if event.course_id != before:
            session.add(event)
            changed += 1
    return changed


def set_event_course(session: Session, event: Event, course: Optional[Course]) -> Event:
    """Choose an event's course by hand (None = it has no course). Learns
    from it: the event's Canvas context is linked to the course and its
    bracketed code becomes an alias, so the rest of that course's items
    (now and on later syncs) map the same way."""
    event.course_id = course.id if course else None
    event.course_source = "manual"
    session.add(event)
    if course is not None:
        if event.external_context:
            link(session, course, event.external_context)
        hint = bracket_code(event.title)
        if hint:
            key = normalize(hint)
            owner = find_by_code(session, hint)
            if owner is None and key != course.code_key and key not in (course.aliases or []):
                course.aliases = [*(course.aliases or []), key]
                course.updated_at = utcnow()
                session.add(course)
        session.flush()
        rematch(session)
    session.commit()
    session.refresh(event)
    return event


def read(session: Session, course: Course) -> CourseRead:
    out = CourseRead.model_validate(course)
    out.canvas_contexts = [lk.external_id for lk in links_for(session, course) if lk.source == CANVAS]
    out.event_count = session.exec(select(func.count()).select_from(Event).where(Event.course_id == course.id)).one()
    return out
