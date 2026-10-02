from typing import Iterator, Optional

from fastapi import Cookie, Header, HTTPException, Response, status
from sqlmodel import Session

from app.config import get_settings
from app.db import get_session
from app.security import SESSION_COOKIE_NAME, constant_time_equals, decode_session_token


def _clear_cookie_header(name: str) -> str:
    response = Response()
    response.delete_cookie(name)  # same attributes as /api/auth/logout
    return response.headers["set-cookie"]


_CLEAR_SESSION_COOKIE = _clear_cookie_header(SESSION_COOKIE_NAME)


def get_db() -> Iterator[Session]:
    yield from get_session()


def require_auth(
    authorization: Optional[str] = Header(default=None),
    todo_session: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> str:
    """
    Accepts EITHER:
      - `Authorization: Bearer <API_TOKEN>` — used by MCP clients and
        programmatic API access.
      - a signed session cookie — used by the web UI after logging in.

    Returns an identifier string for the authenticated principal.
    """
    settings = get_settings()

    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        if constant_time_equals(token, settings.api_token):
            return "api-token"

    if todo_session:
        username = decode_session_token(todo_session)
        if username:
            return username

    headers = {"WWW-Authenticate": "Bearer"}
    if todo_session:
        # The cookie was sent but is invalid (expired, or signed with an old
        # SESSION_SECRET). Tell the browser to drop it: the frontend's proxy
        # only checks that a session cookie exists, so a stale one would
        # otherwise bounce the user between /login and the app forever.
        headers["Set-Cookie"] = _CLEAR_SESSION_COOKIE
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers=headers,
    )
