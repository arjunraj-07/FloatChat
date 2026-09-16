"""HTTP surface for FloatChat accounts.

Registration, login, session restoration and logout over the storage in
:mod:`auth_store`. This module owns cookies, CSRF and status codes only.

Design notes that matter for security:

- The session token travels in an **HttpOnly** cookie, so page scripts cannot
  read it. It is never placed in ``localStorage``, in a URL or in a log.
- The CSRF token is *not* HttpOnly (it must be sent back as a header) and is
  bound server-side to the session row. Every authenticated state-changing
  request must present it; a mismatch is refused before the route runs.
- ``SameSite=Lax`` is set explicitly. The browser treats ``localhost:3000``
  and ``localhost:8000`` as the same site (cookies ignore the port), so the
  cookie is sent, while cross-*site* form posts are not.
- ``Secure`` is off for plain-HTTP local development and is switched on with
  ``FLOATCHAT_COOKIE_SECURE=1`` for any HTTPS deployment.

The role on an account is **self-selected** and decides only which
presentation opens by default. It is not professional verification, grants no
administrator access, and no endpoint returns different scientific values
because of it.
"""

from __future__ import annotations

import json
import os
import secrets

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse

import auth_store
from auth_store import (
    EmailAlreadyRegistered,
    InvalidRegistration,
    SessionInfo,
    TooManyAttempts,
    User,
)

SESSION_COOKIE = "floatchat_session"
CSRF_COOKIE = "floatchat_csrf"
CSRF_HEADER = "X-CSRF-Token"

#: Auth bodies are tiny; anything larger is refused before parsing.
MAX_AUTH_BODY_BYTES = 8 * 1024

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

#: Stated plainly to the client so the interface never implies these work.
UNAVAILABLE_FEATURES = {
    "email_verification": "No mail service is configured, so addresses are "
                          "never verified and no mail is ever sent.",
    "password_recovery": "No password reset exists. A forgotten password "
                         "cannot be recovered on this deployment.",
    "oauth_providers": "No third-party sign-in is configured.",
}


def cookies_secure() -> bool:
    """HTTPS-only cookies. Off for local HTTP, on for any deployment."""
    return os.environ.get("FLOATCHAT_COOKIE_SECURE", "0") == "1"


def _cookie_kwargs() -> dict:
    return {
        "httponly": True,
        "samesite": "lax",
        "secure": cookies_secure(),
        "path": "/",
    }


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE, token,
        max_age=int(auth_store.SESSION_TTL.total_seconds()),
        **_cookie_kwargs(),
    )


def set_csrf_cookie(response: Response, csrf_token: str) -> None:
    # Readable by the page on purpose: it must be echoed back as a header.
    kwargs = _cookie_kwargs()
    kwargs["httponly"] = False
    response.set_cookie(
        CSRF_COOKIE, csrf_token,
        max_age=int(auth_store.SESSION_TTL.total_seconds()),
        **kwargs,
    )


def clear_auth_cookies(response: Response) -> None:
    for name in (SESSION_COOKIE, CSRF_COOKIE):
        response.delete_cookie(name, path="/")


def public_user(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "display_name": user.display_name,
        "created_at": user.created_at,
    }


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status,
                        content={"error": {"code": code, "message": message}})


async def _read_json(request: Request) -> dict:
    body = await request.body()
    if len(body) > MAX_AUTH_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Request body too large.")
    try:
        payload = json.loads(body) if body else {}
    except ValueError:
        raise HTTPException(status_code=400,
                            detail="The request body must be JSON.")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400,
                            detail="The request body must be a JSON object.")
    return payload


def session_for_request(request: Request, *, rotate: bool = True) -> SessionInfo | None:
    """Resolve the caller's session, recording a rotation for the middleware."""
    token = request.cookies.get(SESSION_COOKIE)
    info = auth_store.lookup_session(token or "", rotate=rotate)
    if info is not None and info.new_token:
        # Applied to whatever response the route produces; see
        # `apply_rotated_session` below.
        request.state.rotated_session_token = info.new_token
    return info


def check_csrf(request: Request, info: SessionInfo) -> None:
    """Refuse an authenticated state-changing request without a valid token."""
    if request.method not in UNSAFE_METHODS:
        return
    presented = request.headers.get(CSRF_HEADER, "")
    if not presented or not secrets.compare_digest(presented, info.csrf_token):
        raise HTTPException(
            status_code=403,
            detail="Missing or invalid CSRF token for this session.",
        )


def require_user(request: Request) -> User:
    """Dependency: an authenticated caller, or 401.

    Enforced in the backend, so a request that bypasses the frontend entirely
    is still refused.
    """
    info = session_for_request(request)
    if info is None:
        raise HTTPException(
            status_code=401,
            detail="Sign in to use this feature.",
        )
    check_csrf(request, info)
    return info.user


async def apply_rotated_session(request: Request, call_next):
    """Carry a rotated session token onto the outgoing response.

    Routes return their own ``JSONResponse`` objects, so the new cookie is
    attached here rather than through an injected ``Response``.
    """
    request.state.rotated_session_token = None
    response = await call_next(request)
    token = getattr(request.state, "rotated_session_token", None)
    if token:
        set_session_cookie(response, token)
    return response


def build_auth_router() -> APIRouter:
    router = APIRouter(prefix="/api/auth", tags=["auth"])

    def _session_payload(info: SessionInfo | None) -> dict:
        if info is None:
            return {
                "authenticated": False,
                "user": None,
                "csrf_token": None,
                "expires_at": None,
                "unavailable": UNAVAILABLE_FEATURES,
            }
        return {
            "authenticated": True,
            "user": public_user(info.user),
            # Held in memory by the client and echoed back as a header. It is
            # deliberately not a bearer credential: it authorises nothing on
            # its own.
            "csrf_token": info.csrf_token,
            "expires_at": info.expires_at.isoformat(),
            "unavailable": UNAVAILABLE_FEATURES,
        }

    def _start_session(user: User, status_code: int) -> JSONResponse:
        token, csrf_token, expires_at = auth_store.create_session(user.id)
        response = JSONResponse(status_code=status_code, content={
            "authenticated": True,
            "user": public_user(user),
            "csrf_token": csrf_token,
            "expires_at": expires_at.isoformat(),
            "unavailable": UNAVAILABLE_FEATURES,
        })
        set_session_cookie(response, token)
        set_csrf_cookie(response, csrf_token)
        return response

    @router.post("/register")
    async def register(request: Request):
        """Create an account and sign in.

        The role is taken from the body because it is self-selected. It only
        chooses a default presentation; it never widens access.
        """
        payload = await _read_json(request)
        try:
            user = auth_store.create_user(
                email=str(payload.get("email", "")),
                password=payload.get("password", ""),
                role=str(payload.get("role", auth_store.DEFAULT_ROLE)),
                display_name=str(payload.get("display_name", "")),
            )
        except EmailAlreadyRegistered:
            # Deliberate: registration cannot avoid revealing that an address
            # is taken. Login never reveals it.
            return _error(409, "email_taken",
                          "An account with this email already exists. "
                          "Sign in instead.")
        except InvalidRegistration as exc:
            return _error(400, "invalid_registration", str(exc))
        return _start_session(user, 201)

    @router.post("/login")
    async def login(request: Request):
        payload = await _read_json(request)
        try:
            user = auth_store.verify_login(
                str(payload.get("email", "")), payload.get("password", ""))
        except TooManyAttempts as exc:
            return _error(429, "too_many_attempts", str(exc))
        if user is None:
            # One message for both unknown email and wrong password.
            return _error(401, "invalid_credentials",
                          "Email or password is incorrect.")
        return _start_session(user, 200)

    @router.get("/session")
    def read_session(request: Request):
        """Restore a session on page load. Never an error when signed out."""
        info = session_for_request(request)
        return JSONResponse(status_code=200, content=_session_payload(info))

    @router.post("/logout")
    def logout(request: Request):
        """Revoke the session server-side and clear the cookies.

        The token is deleted from the database, so it cannot be replayed even
        if it was captured.
        """
        info = session_for_request(request, rotate=False)
        if info is not None:
            check_csrf(request, info)
            auth_store.revoke_session(request.cookies.get(SESSION_COOKIE) or "")
        response = JSONResponse(status_code=200, content={
            "authenticated": False,
            "user": None,
            "csrf_token": None,
            "expires_at": None,
            "unavailable": UNAVAILABLE_FEATURES,
        })
        clear_auth_cookies(response)
        return response

    return router
