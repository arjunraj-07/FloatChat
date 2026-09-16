"""Persistent local accounts and server-side sessions for FloatChat.

Storage only: this module owns the SQLite schema, password hashing and
session lifetime. It contains no HTTP concepts and no scientific logic, and
it never touches the Argo tables or the reference caches - the account
database is a separate file in its own configurable location.

Security properties this module is responsible for:

- Passwords are hashed with **Argon2id** (`argon2-cffi`), never stored or
  logged in the clear. A login against an unknown email still performs one
  verification against a dummy hash, so a missing account and a wrong
  password take similar time.
- Session tokens are generated with :mod:`secrets` and only their SHA-256
  hash is stored. A copy of this database therefore does not hand an attacker
  live sessions.
- Every statement is parameterized; no SQL is built by string formatting.
- Sessions carry an absolute expiry, are rotated after an interval, and can
  be revoked server-side (one session, or every session of a user).
- Failed logins are counted per email within a window and refused past a
  bound.

Nothing here writes a password, a session token or a CSRF token to a log.
"""

from __future__ import annotations

import hashlib
import os
import re
import secrets
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from argon2.low_level import Type

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: Where the account database lives. Configurable, and git-ignored by default
#: so accounts are never committed. It is deliberately NOT inside the
#: processed-data directories: Argo files and scientific caches are untouched.
DEFAULT_DB_PATH = os.path.join(REPO_ROOT, "data", "accounts", "accounts.sqlite3")

ROLES = ("student", "scientist")

#: Self-selected at registration. "scientist" selects a default presentation
#: and nothing more: it is not professional verification, not administrator
#: access, and grants no additional data or endpoints.
DEFAULT_ROLE = "student"

SESSION_TTL = timedelta(hours=12)
#: A session older than this is re-issued under a new token on the next
#: authenticated request; the previous token stops working immediately.
SESSION_ROTATE_AFTER = timedelta(minutes=30)

MAX_FAILED_LOGINS = 5
LOCKOUT_WINDOW = timedelta(minutes=15)

EMAIL_MAX_CHARS = 254
PASSWORD_MIN_CHARS = 10
PASSWORD_MAX_CHARS = 256
DISPLAY_NAME_MAX_CHARS = 80

# Deliberately permissive: this is a length and shape bound, not an attempt to
# decide which addresses exist. No mail is ever sent (see AUTHENTICATION.md).
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")

_hasher = PasswordHasher(
    type=Type.ID,
    time_cost=3,
    memory_cost=64 * 1024,
    parallelism=2,
    hash_len=32,
    salt_len=16,
)

#: Verified against when an email is unknown, so the failure path does work
#: comparable to the success path.
_DUMMY_HASH = _hasher.hash("floatchat-dummy-password-for-timing")


class AuthError(Exception):
    """Base class for expected, reportable account failures."""


class EmailAlreadyRegistered(AuthError):
    pass


class InvalidRegistration(AuthError):
    pass


class TooManyAttempts(AuthError):
    pass


@dataclass(frozen=True)
class User:
    id: int
    email: str
    role: str
    display_name: str
    created_at: str


@dataclass(frozen=True)
class SessionInfo:
    user: User
    csrf_token: str
    expires_at: datetime
    #: Set when this request rotated the session onto a new token.
    new_token: str | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat()


def _parse(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def db_path() -> str:
    """The configured database file. Read per call so tests can redirect it."""
    return os.environ.get("FLOATCHAT_AUTH_DB", DEFAULT_DB_PATH)


def _token_hash(token: str) -> str:
    """Sessions are looked up by digest; the raw token is never stored."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


#: Database files whose schema this process has already ensured. Schema
#: creation is lazy rather than tied to an application startup event, because
#: the test suites build a TestClient without entering its context manager and
#: startup handlers therefore never run there.
_ensured_paths: set[str] = set()


@contextmanager
def _connect():
    path = db_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        if path not in _ensured_paths:
            connection.executescript(SCHEMA)
            _ensured_paths.add(path)
        yield connection
        connection.commit()
    finally:
        connection.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('student', 'scientist')),
    display_name  TEXT NOT NULL,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    created_at TEXT NOT NULL,
    rotated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
    email        TEXT NOT NULL,
    attempted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS login_attempts_email ON login_attempts(email);
"""


def init_db() -> None:
    """Create the schema if it is absent. Safe to call repeatedly.

    Opening a connection already ensures the schema, so this exists to make
    the intent explicit at application start and for tests that want the file
    to exist before any request.
    """
    with _connect() as connection:
        connection.executescript(SCHEMA)


def reset_for_tests() -> None:
    """Forget which paths were initialised. Used when redirecting the DB."""
    _ensured_paths.clear()


def _row_to_user(row: sqlite3.Row) -> User:
    return User(
        id=int(row["id"]),
        email=row["email"],
        role=row["role"],
        display_name=row["display_name"],
        created_at=row["created_at"],
    )


# --------------------------------------------------------------------------
# Registration
# --------------------------------------------------------------------------

def normalize_email(email: str) -> str:
    return email.strip().lower()


def validate_registration(email: str, password: str, role: str,
                          display_name: str) -> tuple[str, str, str]:
    """Bounds-check a registration. Returns the normalized values."""
    email = normalize_email(email or "")
    display_name = (display_name or "").strip()
    role = (role or "").strip().lower()

    if not email or len(email) > EMAIL_MAX_CHARS or not EMAIL_PATTERN.match(email):
        raise InvalidRegistration("Enter a valid email address.")
    if role not in ROLES:
        raise InvalidRegistration("Choose either the student or scientist account type.")
    if not isinstance(password, str) or len(password) < PASSWORD_MIN_CHARS:
        raise InvalidRegistration(
            f"Use a password of at least {PASSWORD_MIN_CHARS} characters."
        )
    if len(password) > PASSWORD_MAX_CHARS:
        raise InvalidRegistration(
            f"Passwords are limited to {PASSWORD_MAX_CHARS} characters."
        )
    if len(display_name) > DISPLAY_NAME_MAX_CHARS:
        raise InvalidRegistration(
            f"Names are limited to {DISPLAY_NAME_MAX_CHARS} characters."
        )
    return email, role, display_name or email.split("@")[0]


def create_user(email: str, password: str, role: str,
                display_name: str = "") -> User:
    """Register an account. Raises :class:`EmailAlreadyRegistered` on reuse."""
    email, role, display_name = validate_registration(
        email, password, role, display_name)
    password_hash = _hasher.hash(password)
    with _connect() as connection:
        existing = connection.execute(
            "SELECT id FROM users WHERE email = ?", (email,)
        ).fetchone()
        if existing is not None:
            raise EmailAlreadyRegistered(
                "An account with this email already exists."
            )
        cursor = connection.execute(
            "INSERT INTO users (email, password_hash, role, display_name, "
            "created_at) VALUES (?, ?, ?, ?, ?)",
            (email, password_hash, role, display_name, _iso(_now())),
        )
        row = connection.execute(
            "SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    return _row_to_user(row)


def get_user(user_id: int) -> User | None:
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM users WHERE id = ?", (user_id,)
        ).fetchone()
    return _row_to_user(row) if row else None


# --------------------------------------------------------------------------
# Login attempts
# --------------------------------------------------------------------------

def _recent_failures(connection: sqlite3.Connection, email: str) -> int:
    cutoff = _iso(_now() - LOCKOUT_WINDOW)
    row = connection.execute(
        "SELECT COUNT(*) AS n FROM login_attempts "
        "WHERE email = ? AND attempted_at > ?",
        (email, cutoff),
    ).fetchone()
    return int(row["n"])


def _record_failure(connection: sqlite3.Connection, email: str) -> None:
    connection.execute(
        "INSERT INTO login_attempts (email, attempted_at) VALUES (?, ?)",
        (email, _iso(_now())),
    )


def _clear_failures(connection: sqlite3.Connection, email: str) -> None:
    connection.execute("DELETE FROM login_attempts WHERE email = ?", (email,))


def verify_login(email: str, password: str) -> User | None:
    """Return the user for correct credentials, ``None`` otherwise.

    Raises :class:`TooManyAttempts` once the bound is reached, so the caller
    can refuse without revealing whether the account exists.
    """
    email = normalize_email(email or "")
    password = password if isinstance(password, str) else ""
    with _connect() as connection:
        if _recent_failures(connection, email) >= MAX_FAILED_LOGINS:
            raise TooManyAttempts(
                "Too many sign-in attempts. Wait a few minutes and try again."
            )
        row = connection.execute(
            "SELECT * FROM users WHERE email = ?", (email,)
        ).fetchone()

        if row is None:
            # Unknown email: still verify, so the timing is comparable.
            try:
                _hasher.verify(_DUMMY_HASH, password)
            except (VerifyMismatchError, InvalidHashError, Exception):
                pass
            _record_failure(connection, email)
            return None

        try:
            _hasher.verify(row["password_hash"], password)
        except Exception:
            _record_failure(connection, email)
            return None

        if _hasher.check_needs_rehash(row["password_hash"]):
            connection.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (_hasher.hash(password), int(row["id"])),
            )
        _clear_failures(connection, email)
        return _row_to_user(row)


# --------------------------------------------------------------------------
# Sessions
# --------------------------------------------------------------------------

def create_session(user_id: int) -> tuple[str, str, datetime]:
    """Start a session. Returns ``(token, csrf_token, expires_at)``."""
    token = secrets.token_urlsafe(32)
    csrf_token = secrets.token_urlsafe(32)
    now = _now()
    expires_at = now + SESSION_TTL
    with _connect() as connection:
        connection.execute(
            "INSERT INTO sessions (token_hash, user_id, csrf_token, "
            "created_at, rotated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
            (_token_hash(token), int(user_id), csrf_token,
             _iso(now), _iso(now), _iso(expires_at)),
        )
    return token, csrf_token, expires_at


def lookup_session(token: str, *, rotate: bool = True) -> SessionInfo | None:
    """Resolve a session token to its user, or ``None``.

    An expired session is deleted rather than returned. When ``rotate`` is set
    and the session is older than :data:`SESSION_ROTATE_AFTER`, a fresh token
    replaces it and is reported as ``new_token``; the old token stops working
    at once.
    """
    if not token:
        return None
    digest = _token_hash(token)
    with _connect() as connection:
        row = connection.execute(
            "SELECT s.token_hash, s.csrf_token, s.created_at, s.rotated_at, "
            "s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE s.token_hash = ?",
            (digest,),
        ).fetchone()
        if row is None:
            return None

        now = _now()
        if _parse(row["expires_at"]) <= now:
            connection.execute(
                "DELETE FROM sessions WHERE token_hash = ?", (digest,))
            return None

        user = _row_to_user(row)
        expires_at = _parse(row["expires_at"])
        new_token = None
        if rotate and now - _parse(row["rotated_at"]) >= SESSION_ROTATE_AFTER:
            new_token = secrets.token_urlsafe(32)
            connection.execute(
                "UPDATE sessions SET token_hash = ?, rotated_at = ? "
                "WHERE token_hash = ?",
                (_token_hash(new_token), _iso(now), digest),
            )
        return SessionInfo(
            user=user,
            csrf_token=row["csrf_token"],
            expires_at=expires_at,
            new_token=new_token,
        )


def revoke_session(token: str) -> bool:
    """Delete one session server-side. Returns whether a row was removed."""
    if not token:
        return False
    with _connect() as connection:
        cursor = connection.execute(
            "DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))
        return cursor.rowcount > 0


def revoke_all_sessions(user_id: int) -> int:
    with _connect() as connection:
        cursor = connection.execute(
            "DELETE FROM sessions WHERE user_id = ?", (int(user_id),))
        return cursor.rowcount


def purge_expired() -> int:
    """Remove expired sessions and stale attempt records."""
    now = _now()
    with _connect() as connection:
        sessions = connection.execute(
            "DELETE FROM sessions WHERE expires_at <= ?", (_iso(now),)).rowcount
        connection.execute(
            "DELETE FROM login_attempts WHERE attempted_at <= ?",
            (_iso(now - LOCKOUT_WINDOW),))
    return sessions


def expire_session_now(token: str) -> None:
    """Force a session to be expired. Used by tests to exercise expiry."""
    with _connect() as connection:
        connection.execute(
            "UPDATE sessions SET expires_at = ? WHERE token_hash = ?",
            (_iso(_now() - timedelta(seconds=1)), _token_hash(token)),
        )


def age_session_for_rotation(token: str) -> None:
    """Backdate a session's rotation clock. Used by tests."""
    with _connect() as connection:
        connection.execute(
            "UPDATE sessions SET rotated_at = ? WHERE token_hash = ?",
            (_iso(_now() - SESSION_ROTATE_AFTER - timedelta(seconds=1)),
             _token_hash(token)),
        )
