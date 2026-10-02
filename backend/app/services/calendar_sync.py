"""Calendar subscriptions: mirror external ICS calendars into Look's events.

A `url` subscription is a live link. Every sync makes a fresh HTTP request
to the URL (ETag/Last-Modified only let the server answer "304 Not
Modified"), parses the WHOLE feed, and reconciles it with the events
already imported from it:

- a UID Look hasn't seen -> new event (this is how an assignment published
  weeks later shows up on its own);
- a known UID whose content changed -> that same event is updated;
- a known UID with identical content -> left alone;
- a known UID missing from the feed -> marked external_status="removed"
  (hidden, not deleted; restored if it comes back).

Deadlines (assignments) can be checked off in Look. Completion is never
part of the feed-owned fields: a sync only touches it when the feed
explicitly states completion and that statement changed since the last
sync (see _reconcile_completion). A feed that says nothing, like every
Canvas feed, leaves your checkmarks alone.

Reconciling happens only after the download AND the parse succeeded, in a
single transaction. A network error, an HTTP error or a malformed feed
records last_error and changes no events.

A `file` subscription holds the events of an uploaded .ics. It's a
snapshot: nothing re-fetches it; uploading a file with the same name again
reconciles against it the same way.

Events are identified by (subscription_id, external_uid), a unique
constraint, so repeated syncs can never duplicate them. Used by the REST
router, the MCP server and the background scheduler alike.
"""

import logging
import threading
import zlib
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable, Dict, Iterator, List, Optional
from urllib.parse import urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import func, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.config import get_settings
from app.models.calendars import CalendarSubscription
from app.models.enums import CalendarSourceType
from app.models.events import Event, EventOverride
from app.schemas import (
    CalendarSubscriptionCreate,
    CalendarSubscriptionRead,
    CalendarSubscriptionUpdate,
    CalendarSyncResult,
)
from app.services import courses as courses_service
from app.services import ics
from app.utils import utcnow

logger = logging.getLogger("todo_app.calendar_sync")

FETCH_TIMEOUT_SECONDS = 20
MAX_FEED_BYTES = 10 * 1024 * 1024
USER_AGENT = "Look calendar sync (+https://github.com/Ddundee/look)"
SOURCE = "subscription"  # Event.source for imported events


class DuplicateSubscription(ValueError):
    def __init__(self, existing: CalendarSubscription):
        self.existing = existing
        super().__init__(f"You're already subscribed to this calendar as '{existing.name}'.")


class FetchError(Exception):
    """The feed couldn't be downloaded (network, timeout, HTTP error)."""


@dataclass
class FetchResult:
    status: int  # 200 or 304
    body: Optional[bytes]
    etag: Optional[str]
    last_modified: Optional[str]


Fetcher = Callable[..., FetchResult]


@dataclass
class _Counts:
    created: int = 0
    updated: int = 0
    unchanged: int = 0
    removed: int = 0
    warnings: List[str] = field(default_factory=list)

    def as_dict(self) -> Dict[str, int]:
        return {"created": self.created, "updated": self.updated, "unchanged": self.unchanged, "removed": self.removed}


# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------


def normalize_url(raw: str) -> str:
    """webcal:// is just http(s) for calendars; accept it and store https."""
    url = raw.strip()
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    if scheme in ("webcal", "webcals"):
        scheme = "https"
    if scheme not in ("http", "https") or not parts.netloc:
        raise ValueError("The calendar URL must start with https://, http:// or webcal://.")
    return urlunsplit((scheme, parts.netloc, parts.path, parts.query, ""))


def fetch_feed(url: str, etag: Optional[str] = None, last_modified: Optional[str] = None) -> FetchResult:
    """Download the feed. Always a real request; the validators only allow
    a 304 reply. Raises FetchError on anything but 200/304."""
    headers = {"User-Agent": USER_AGENT, "Accept": "text/calendar, */*;q=0.5"}
    if etag:
        headers["If-None-Match"] = etag
    if last_modified:
        headers["If-Modified-Since"] = last_modified
    try:
        with httpx.Client(timeout=FETCH_TIMEOUT_SECONDS, follow_redirects=True, headers=headers) as client:
            with client.stream("GET", url) as resp:
                if resp.status_code == 304:
                    return FetchResult(304, None, etag, last_modified)
                if resp.status_code != 200:
                    hint = " (the link may have expired or been reset)" if resp.status_code in (401, 403, 404) else ""
                    raise FetchError(f"The calendar server answered HTTP {resp.status_code}{hint}.")
                chunks, size = [], 0
                for chunk in resp.iter_bytes():
                    size += len(chunk)
                    if size > MAX_FEED_BYTES:
                        raise FetchError(f"The calendar is larger than {MAX_FEED_BYTES // (1024 * 1024)} MB.")
                    chunks.append(chunk)
                return FetchResult(200, b"".join(chunks), resp.headers.get("etag"), resp.headers.get("last-modified"))
    except httpx.TimeoutException:
        raise FetchError(f"The calendar server didn't answer within {FETCH_TIMEOUT_SECONDS}s.") from None
    except httpx.HTTPError as exc:
        raise FetchError(f"Couldn't reach the calendar: {exc}") from None


# ---------------------------------------------------------------------------
# Subscriptions
# ---------------------------------------------------------------------------


def get_subscription(session: Session, subscription_id: str) -> Optional[CalendarSubscription]:
    return session.get(CalendarSubscription, subscription_id)


def create_subscription(session: Session, payload: CalendarSubscriptionCreate) -> CalendarSubscription:
    """Save a URL as a persistent subscription. Doesn't sync; callers do
    that right after so the user sees the events immediately."""
    url = normalize_url(payload.url)
    existing = session.exec(select(CalendarSubscription).where(CalendarSubscription.source_url == url)).first()
    if existing is not None:
        raise DuplicateSubscription(existing)
    sub = CalendarSubscription(
        name=payload.name,
        source_type=CalendarSourceType.url,
        source_url=url,
        sync_interval_minutes=payload.sync_interval_minutes,
    )
    session.add(sub)
    try:
        session.commit()
    except IntegrityError:  # created concurrently
        session.rollback()
        existing = session.exec(select(CalendarSubscription).where(CalendarSubscription.source_url == url)).one()
        raise DuplicateSubscription(existing) from None
    session.refresh(sub)
    return sub


def update_subscription(
    session: Session, sub: CalendarSubscription, changes: CalendarSubscriptionUpdate
) -> CalendarSubscription:
    data = changes.model_dump(exclude_unset=True, exclude_none=True)
    if sub.source_type == CalendarSourceType.file and data.keys() - {"name"}:
        raise ValueError("Uploaded files don't sync, so only their name can be changed.")
    for key, value in data.items():
        setattr(sub, key, value)
    sub.updated_at = utcnow()
    session.add(sub)
    session.commit()
    session.refresh(sub)
    return sub


def delete_subscription(session: Session, sub: CalendarSubscription, keep_events: bool) -> Dict[str, int]:
    """Remove a subscription. keep_events=True turns its current events
    into ordinary, editable Look events (ones already removed from the feed
    are deleted either way); False deletes them all."""
    kept = deleted = 0
    for event in session.exec(select(Event).where(Event.subscription_id == sub.id)).all():
        if keep_events and event.external_status != "removed":
            event.subscription_id = None
            event.external_uid = None
            event.external_hash = None
            event.external_status = None
            event.last_synced_at = None
            event.source = "manual"
            event.updated_at = utcnow()
            session.add(event)
            kept += 1
        else:
            for ov in session.exec(select(EventOverride).where(EventOverride.event_id == event.id)).all():
                session.delete(ov)
            session.flush()
            session.delete(event)
            deleted += 1
    session.flush()
    session.delete(sub)
    session.commit()
    return {"events_kept": kept, "events_deleted": deleted}


def event_counts(session: Session) -> Dict[str, int]:
    rows = session.exec(
        select(Event.subscription_id, func.count())
        .where(col(Event.subscription_id).is_not(None), col(Event.external_status).is_(None))
        .group_by(Event.subscription_id)
    ).all()
    return dict(rows)


def read(session: Session, sub: CalendarSubscription, counts: Optional[Dict[str, int]] = None) -> CalendarSubscriptionRead:
    counts = event_counts(session) if counts is None else counts
    out = CalendarSubscriptionRead.model_validate(sub)
    out.event_count = counts.get(sub.id, 0)
    if sub.source_type == CalendarSourceType.url and sub.enabled:
        out.next_sync_at = (
            sub.last_sync_at + timedelta(minutes=sub.sync_interval_minutes) if sub.last_sync_at else utcnow()
        )
        out = CalendarSubscriptionRead.model_validate(out.model_dump())  # re-apply UTC tagging
    return out


def list_subscriptions(session: Session) -> List[CalendarSubscriptionRead]:
    subs = session.exec(select(CalendarSubscription).order_by(CalendarSubscription.created_at)).all()
    counts = event_counts(session)
    return [read(session, s, counts) for s in subs]


# ---------------------------------------------------------------------------
# Reconcile
# ---------------------------------------------------------------------------


def _apply(event: Event, parsed: ics.ParsedEvent, now: datetime) -> None:
    event.title = parsed.title
    event.start_at = parsed.start_at
    event.end_at = parsed.end_at
    event.all_day = parsed.all_day
    event.notes = parsed.notes
    event.location = parsed.location
    event.rrule = parsed.rrule
    event.exdates = parsed.exdates
    event.external_url = parsed.url
    event.external_status = parsed.status
    event.is_deadline = parsed.deadline
    event.external_context = parsed.external_context
    event.external_hash = parsed.content_hash()
    event.last_synced_at = now
    event.updated_at = now


def _replace_overrides(session: Session, event: Event, parsed: ics.ParsedEvent) -> None:
    for ov in session.exec(select(EventOverride).where(EventOverride.event_id == event.id)).all():
        session.delete(ov)
    session.flush()
    for ov in parsed.overrides:
        session.add(
            EventOverride(
                event_id=event.id,
                original_date=ov.original_date,
                cancelled=ov.cancelled,
                start_at=ov.start_at,
                end_at=ov.end_at,
                title=ov.title,
                location=ov.location,
                notes=ov.notes,
            )
        )


def _reconcile_completion(event: Event, item: ics.ParsedEvent, now: datetime) -> bool:
    """Apply completion the feed states explicitly. Precedence:

    - the feed says nothing (None): leave completion exactly as it is;
    - the feed says the same thing as last sync: leave it (so unchecking
      something the feed calls done sticks until the feed changes);
    - the feed now says completed: check it off (source "external") unless
      it's already checked;
    - the feed now says not completed: uncheck it only if the feed was what
      checked it; a local checkmark is never removed by a sync.

    Returns whether anything changed."""
    stated = item.external_completed
    if stated is None or not event.is_deadline or stated == event.external_completed:
        return False
    event.external_completed = stated
    if stated and event.completed_at is None:
        event.completed_at = item.external_completed_at or now
        event.completion_source = "external"
    elif not stated and event.completion_source == "external":
        event.completed_at = None
        event.completion_source = None
    return True


def reconcile(session: Session, sub: CalendarSubscription, parsed: List[ics.ParsedEvent]) -> _Counts:
    """Make the subscription's events match `parsed`, the complete current
    feed. Doesn't commit; the caller commits everything at once."""
    now = utcnow()
    counts = _Counts()
    existing = {e.external_uid: e for e in session.exec(select(Event).where(Event.subscription_id == sub.id)).all()}
    seen = set()
    for item in parsed:
        if item.uid in seen:
            continue
        seen.add(item.uid)
        counts.warnings.extend(item.warnings)
        digest = item.content_hash()
        event = existing.get(item.uid)
        if event is None:
            event = Event(subscription_id=sub.id, external_uid=item.uid, source=SOURCE, category="other",
                          title=item.title, start_at=item.start_at, end_at=item.end_at)
            _apply(event, item, now)
            courses_service.apply(session, event, create=True)
            _reconcile_completion(event, item, now)
            session.add(event)
            session.flush()  # the overrides reference it
            _replace_overrides(session, event, item)
            counts.created += 1
        elif event.external_hash != digest or event.external_status != item.status:
            _apply(event, item, now)
            courses_service.apply(session, event, create=True)
            _reconcile_completion(event, item, now)
            session.add(event)
            _replace_overrides(session, event, item)
            counts.updated += 1
        else:
            event.last_synced_at = now
            # Courses aren't feed content: re-checked every sync, so links
            # learned since (or a new course) apply to existing items too.
            courses_service.apply(session, event, create=True)
            changed = _reconcile_completion(event, item, now)
            session.add(event)
            if changed:
                counts.updated += 1
            else:
                counts.unchanged += 1
    for uid, event in existing.items():
        if uid not in seen and event.external_status != "removed":
            event.external_status = "removed"
            event.last_synced_at = now
            event.updated_at = now
            session.add(event)
            counts.removed += 1
    return counts


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------

_local_locks: Dict[str, threading.Lock] = {}
_local_locks_guard = threading.Lock()


@contextmanager
def _sync_lock(session: Session, subscription_id: str) -> Iterator[bool]:
    """Yields False if this subscription is already being synced, here or
    in another process (the MCP server shares the database). Uses a
    PostgreSQL advisory lock on its own connection; SQLite deployments are
    single-process, so an in-process lock covers them."""
    with _local_locks_guard:
        lock = _local_locks.setdefault(subscription_id, threading.Lock())
    if not lock.acquire(blocking=False):
        yield False
        return
    try:
        bind = session.get_bind()
        if bind.dialect.name != "postgresql":
            yield True
            return
        key = zlib.crc32(f"look-calendar-sync:{subscription_id}".encode())
        with bind.connect() as conn:
            got = conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": key}).scalar()
            conn.commit()
            try:
                yield bool(got)
            finally:
                if got:
                    conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})
                    conn.commit()
    finally:
        lock.release()


def _tz() -> ZoneInfo:
    return ZoneInfo(get_settings().app_timezone)


def _record_error(session: Session, sub: CalendarSubscription, message: str) -> CalendarSyncResult:
    session.rollback()
    sub = session.get(CalendarSubscription, sub.id)
    sub.last_sync_at = utcnow()
    message = message.strip()
    if message and message[-1] not in ".!?)":
        message += "."
    sub.last_error = message[:1000]
    sub.updated_at = utcnow()
    session.add(sub)
    session.commit()
    session.refresh(sub)
    logger.warning("Calendar '%s' sync failed: %s", sub.name, message)
    return CalendarSyncResult(status="error", error=sub.last_error, subscription=read(session, sub))


def sync_subscription(
    session: Session, sub: CalendarSubscription, fetch: Fetcher = fetch_feed
) -> CalendarSyncResult:
    """Fetch the subscription's URL now and reconcile. Never raises for
    remote problems: they come back as status="error" with nothing changed."""
    if sub.source_type != CalendarSourceType.url:
        raise ValueError("Uploaded files are snapshots and can't sync; re-upload the file to update it.")
    if not sub.enabled:
        return CalendarSyncResult(status="skipped", error="This subscription is disabled.", subscription=read(session, sub))
    with _sync_lock(session, sub.id) as acquired:
        if not acquired:
            return CalendarSyncResult(
                status="skipped", error="A sync of this calendar is already running.", subscription=read(session, sub)
            )
        try:
            result = fetch(sub.source_url, etag=sub.etag, last_modified=sub.last_modified)
        except FetchError as exc:
            return _record_error(session, sub, str(exc))
        except Exception as exc:  # noqa: BLE001 - a fetch bug mustn't take down the scheduler
            logger.exception("Unexpected error fetching calendar '%s'", sub.name)
            return _record_error(session, sub, f"Unexpected error while fetching: {exc}")

        now = utcnow()
        if result.status == 304:
            sub.last_sync_at = sub.last_success_at = now
            sub.last_error = None
            unchanged = len(session.exec(select(Event.id).where(Event.subscription_id == sub.id)).all())
            sub.last_result = {"created": 0, "updated": 0, "unchanged": unchanged, "removed": 0}
            session.add(sub)
            session.commit()
            session.refresh(sub)
            return CalendarSyncResult(status="not_modified", unchanged=unchanged, subscription=read(session, sub))

        try:
            parsed = ics.parse(result.body or b"", _tz(), sub.name)
        except ics.IcsError as exc:
            return _record_error(session, sub, str(exc))

        try:
            counts = reconcile(session, sub, parsed)
            sub.last_sync_at = sub.last_success_at = now
            sub.last_error = None
            sub.etag, sub.last_modified = result.etag, result.last_modified
            sub.last_result = counts.as_dict()
            sub.updated_at = now
            session.add(sub)
            session.commit()
        except Exception as exc:  # noqa: BLE001 - roll back the whole reconcile
            logger.exception("Couldn't save calendar '%s'", sub.name)
            return _record_error(session, sub, f"Couldn't save the calendar's events: {exc}")
        session.refresh(sub)
        logger.info("Calendar '%s' synced: %s", sub.name, counts.as_dict())
        return CalendarSyncResult(status="ok", warnings=counts.warnings[:20], subscription=read(session, sub), **counts.as_dict())


def import_file(session: Session, content: bytes, name: str) -> CalendarSyncResult:
    """Import an uploaded .ics as a snapshot. Uploading again under the same
    name updates that import instead of duplicating it. Raises ValueError
    (with nothing created) if the file isn't a valid calendar."""
    display = name.strip()
    if display.lower().endswith(".ics"):
        display = display[:-4].strip()
    display = (display or "Imported calendar")[:100]
    parsed = ics.parse(content, _tz(), display)  # IcsError is a ValueError

    sub = session.exec(
        select(CalendarSubscription).where(
            CalendarSubscription.source_type == CalendarSourceType.file, CalendarSubscription.name == display
        )
    ).first()
    if sub is None:
        sub = CalendarSubscription(name=display, source_type=CalendarSourceType.file, enabled=False)
        session.add(sub)
        session.flush()
    counts = reconcile(session, sub, parsed)
    now = utcnow()
    sub.last_sync_at = sub.last_success_at = now
    sub.last_error = None
    sub.last_result = counts.as_dict()
    sub.updated_at = now
    session.add(sub)
    session.commit()
    session.refresh(sub)
    return CalendarSyncResult(status="ok", warnings=counts.warnings[:20], subscription=read(session, sub), **counts.as_dict())


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------


def due_subscription_ids(session: Session, startup: bool = False) -> List[str]:
    now = utcnow()
    subs = session.exec(
        select(CalendarSubscription).where(
            CalendarSubscription.source_type == CalendarSourceType.url, col(CalendarSubscription.enabled).is_(True)
        )
    ).all()
    return [
        s.id
        for s in subs
        if startup or s.last_sync_at is None or s.last_sync_at + timedelta(minutes=s.sync_interval_minutes) <= now
    ]


def run_due_syncs(engine: Engine, startup: bool = False) -> Dict[str, str]:
    """Sync every enabled URL subscription whose interval has passed (all
    of them when startup=True), each in its own session so one failure
    can't affect the rest. Returns {subscription_id: status}."""
    with Session(engine) as session:
        ids = due_subscription_ids(session, startup)
    results: Dict[str, str] = {}
    for sub_id in ids:
        try:
            with Session(engine) as session:
                sub = session.get(CalendarSubscription, sub_id)
                if sub is None or not sub.enabled:
                    continue
                results[sub_id] = sync_subscription(session, sub).status
        except Exception:  # noqa: BLE001 - keep going with the others
            logger.exception("Calendar subscription %s failed to sync", sub_id)
            results[sub_id] = "error"
    return results
