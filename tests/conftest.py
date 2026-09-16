import os
import sys
import tempfile
import uuid

# The core suite must never depend on network access. Tests that genuinely
# need it are marked `network` and re-enable it themselves.
os.environ.setdefault("FLOATCHAT_WOA_ALLOW_NETWORK", "0")

# Accounts live in a throwaway database for the whole test session, so running
# the suite never reads, writes or deletes real local accounts. This must be
# set before `api.main` is imported, because the application prepares the
# account store on import.
_TEST_ACCOUNT_DIR = tempfile.mkdtemp(prefix="floatchat-test-accounts-")
os.environ["FLOATCHAT_AUTH_DB"] = os.path.join(
    _TEST_ACCOUNT_DIR, "accounts.sqlite3")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

# The API module is imported by path so the tests exercise the deployed module,
# not a copy.
API_DIR = os.path.join(REPO_ROOT, "api")
if API_DIR not in sys.path:
    sys.path.insert(0, API_DIR)


def unique_email(prefix: str = "tester") -> str:
    """A fresh address, so tests never collide on the unique email index."""
    return f"{prefix}-{uuid.uuid4().hex[:12]}@example.org"


#: Long enough for the server's minimum; used by every test account.
TEST_PASSWORD = "correct-horse-battery-staple"


def register_test_account(client, role: str = "student", email: str | None = None,
                          password: str = TEST_PASSWORD) -> dict:
    """Register and sign in a throwaway account on ``client``.

    Returns ``{"email", "password", "csrf", "user"}``. The session cookie is
    held by the client itself, exactly as a browser would hold it.
    """
    email = email or unique_email(role)
    response = client.post("/api/auth/register", json={
        "email": email, "password": password, "role": role,
    })
    assert response.status_code == 201, response.text
    body = response.json()
    return {
        "email": email,
        "password": password,
        "csrf": body["csrf_token"],
        "user": body["user"],
    }
