"""Version info and the self-update proxy.

The updater container is only reachable on the internal Compose network;
the browser talks to it through these endpoints, behind the normal login.
If no updater is configured or it doesn't answer, the feature reports
itself as disabled instead of erroring, so the UI just hides it.
"""

from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.deps import require_auth

router = APIRouter(prefix="/api/system", tags=["system"], dependencies=[Depends(require_auth)])

TIMEOUT_SECONDS = 5.0
# Tests swap in httpx.MockTransport.
transport: Optional[httpx.BaseTransport] = None


def _client() -> httpx.Client:
    settings = get_settings()
    return httpx.Client(
        base_url=settings.updater_url.rstrip("/"),
        headers={"Authorization": f"Bearer {settings.api_token}"},
        timeout=TIMEOUT_SECONDS,
        transport=transport,
    )


@router.get("/version")
def version() -> dict:
    return {"revision": get_settings().app_revision or None}


@router.get("/update")
def update_status(refresh: bool = False) -> dict:
    if not get_settings().updater_url:
        return {"enabled": False}
    try:
        with _client() as client:
            resp = client.get("/status", params={"refresh": "1"} if refresh else None)
        resp.raise_for_status()
        return {"enabled": True, **resp.json()}
    except (httpx.HTTPError, ValueError):
        return {"enabled": False}


@router.post("/update")
def start_update(force: bool = False):
    if not get_settings().updater_url:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Updates aren't set up on this server.")
    try:
        with _client() as client:
            resp = client.post("/update", params={"force": "1"} if force else None)
        body = resp.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Couldn't reach the updater.")
    if resp.status_code >= 400:
        raise HTTPException(resp.status_code, body.get("error") or "Update failed to start.")
    return JSONResponse(status_code=resp.status_code, content=body)
