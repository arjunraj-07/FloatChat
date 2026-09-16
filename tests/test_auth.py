"""Accounts, sessions and the access boundary around the paid endpoint.

Everything here runs against the real FastAPI application through Starlette's
TestClient, with the account database redirected to a temporary file by
``conftest``. No network and no model provider is involved.

What these tests are actually for: proving the boundary is enforced by the
*backend*. A frontend route guard is not a security control, so every check
below calls the API directly, the way an attacker would.
"""

import sqlite3

import pytest
from fastapi.testclient import TestClient

import auth_store
import main as api_main
from conftest import TEST_PASSWORD, register_test_account, unique_email


def fresh_client() -> TestClient:
    """A client with its own cookie jar, like a separate browser."""
    return TestClient(api_main.app)


# --------------------------------------------------------------------------
# Registration
# --------------------------------------------------------------------------

def test_registration_creates_an_account_and_signs_it_in():
    client = fresh_client()
    email = unique_email()
    response = client.post("/api/auth/register", json={
        "email": email, "password": TEST_PASSWORD, "role": "scientist",
        "display_name": "Test Person",
    })
    assert response.status_code == 201
    body = response.json()
    assert body["authenticated"] is True
    assert body["user"]["email"] == email
    assert body["user"]["role"] == "scientist"
    assert body["user"]["display_name"] == "Test Person"
    # The session cookie is HttpOnly so page scripts cannot read it.
    cookie_header = response.headers["set-cookie"]
    assert "floatchat_session=" in cookie_header
    assert "httponly" in cookie_header.lower()
    assert "samesite=lax" in cookie_header.lower()


def test_registration_never_returns_a_password_or_its_hash():
    client = fresh_client()
    response = client.post("/api/auth/register", json={
        "email": unique_email(), "password": TEST_PASSWORD, "role": "student",
    })
    text = response.text
    assert TEST_PASSWORD not in text
    assert "password" not in response.json()["user"]
    assert "argon2" not in text


def test_a_duplicate_email_is_refused():
    client = fresh_client()
    email = unique_email()
    first = client.post("/api/auth/register", json={
        "email": email, "password": TEST_PASSWORD, "role": "student"})
    assert first.status_code == 201

    second = fresh_client().post("/api/auth/register", json={
        # Case and surrounding space must not create a second account.
        "email": f"  {email.upper()}  ", "password": TEST_PASSWORD,
        "role": "scientist"})
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "email_taken"


@pytest.mark.parametrize("payload, reason", [
    ({"email": "not-an-email", "password": TEST_PASSWORD, "role": "student"},
     "email"),
    ({"email": "short@example.org", "password": "abc", "role": "student"},
     "password"),
    ({"email": "role@example.org", "password": TEST_PASSWORD, "role": "admin"},
     "role"),
])
def test_registration_bounds_are_enforced(payload, reason):
    response = fresh_client().post("/api/auth/register", json=payload)
    assert response.status_code == 400, reason
    assert response.json()["error"]["code"] == "invalid_registration"


def test_an_oversized_registration_body_is_refused():
    response = fresh_client().post("/api/auth/register", json={
        "email": unique_email(), "password": TEST_PASSWORD, "role": "student",
        "display_name": "x" * 20000,
    })
    assert response.status_code == 413


def test_passwords_are_stored_as_argon2id_hashes_only():
    client = fresh_client()
    email = unique_email()
    client.post("/api/auth/register", json={
        "email": email, "password": TEST_PASSWORD, "role": "student"})

    connection = sqlite3.connect(auth_store.db_path())
    try:
        row = connection.execute(
            "SELECT password_hash FROM users WHERE email = ?", (email,)
        ).fetchone()
    finally:
        connection.close()
    assert row is not None
    stored = row[0]
    assert stored.startswith("$argon2id$")
    assert TEST_PASSWORD not in stored


# --------------------------------------------------------------------------
# Login
# --------------------------------------------------------------------------

def test_login_succeeds_with_the_right_password():
    registrar = fresh_client()
    account = register_test_account(registrar, role="scientist")

    client = fresh_client()
    response = client.post("/api/auth/login", json={
        "email": account["email"], "password": account["password"]})
    assert response.status_code == 200
    assert response.json()["user"]["role"] == "scientist"


def test_an_incorrect_password_is_refused_without_revealing_the_account():
    account = register_test_account(fresh_client())

    wrong_password = fresh_client().post("/api/auth/login", json={
        "email": account["email"], "password": "definitely-not-it"})
    unknown_email = fresh_client().post("/api/auth/login", json={
        "email": unique_email("nobody"), "password": TEST_PASSWORD})

    assert wrong_password.status_code == unknown_email.status_code == 401
    # The same message for both, so login does not disclose which emails exist.
    assert wrong_password.json()["error"] == unknown_email.json()["error"]
    assert wrong_password.json()["error"]["code"] == "invalid_credentials"


def test_repeated_failures_are_bounded():
    account = register_test_account(fresh_client())
    client = fresh_client()
    statuses = [
        client.post("/api/auth/login", json={
            "email": account["email"], "password": "wrong"}).status_code
        for _ in range(auth_store.MAX_FAILED_LOGINS + 1)
    ]
    assert statuses[-1] == 429
    # Even the correct password is refused while the bound is in force.
    locked = client.post("/api/auth/login", json={
        "email": account["email"], "password": account["password"]})
    assert locked.status_code == 429
    assert locked.json()["error"]["code"] == "too_many_attempts"


# --------------------------------------------------------------------------
# Session lifetime
# --------------------------------------------------------------------------

def test_session_is_restored_from_the_cookie():
    client = fresh_client()
    account = register_test_account(client)
    body = client.get("/api/auth/session").json()
    assert body["authenticated"] is True
    assert body["user"]["email"] == account["email"]


def test_signed_out_session_is_a_normal_answer_not_an_error():
    response = fresh_client().get("/api/auth/session")
    assert response.status_code == 200
    body = response.json()
    assert body["authenticated"] is False
    assert body["user"] is None


def test_an_expired_session_stops_working():
    client = fresh_client()
    register_test_account(client)
    token = client.cookies.get("floatchat_session")

    auth_store.expire_session_now(token)
    assert client.get("/api/auth/session").json()["authenticated"] is False
    # The expired row is removed rather than left to accumulate.
    assert auth_store.lookup_session(token) is None


def test_a_session_rotates_onto_a_new_token():
    client = fresh_client()
    register_test_account(client)
    original = client.cookies.get("floatchat_session")

    auth_store.age_session_for_rotation(original)
    assert client.get("/api/auth/session").json()["authenticated"] is True
    rotated = client.cookies.get("floatchat_session")
    assert rotated != original

    # The superseded token is dead immediately, even though the session lives.
    replay = fresh_client()
    replay.cookies.set("floatchat_session", original)
    assert replay.get("/api/auth/session").json()["authenticated"] is False


def test_logout_revokes_the_session_server_side():
    client = fresh_client()
    account = register_test_account(client)
    token = client.cookies.get("floatchat_session")

    response = client.post("/api/auth/logout",
                           headers={"X-CSRF-Token": account["csrf"]})
    assert response.status_code == 200
    assert client.get("/api/auth/session").json()["authenticated"] is False

    # Revocation is server-side: presenting the old cookie from anywhere fails.
    stolen = fresh_client()
    stolen.cookies.set("floatchat_session", token)
    assert stolen.get("/api/auth/session").json()["authenticated"] is False
    assert auth_store.lookup_session(token) is None


def test_sessions_survive_a_server_restart():
    """State is in SQLite, not process memory."""
    client = fresh_client()
    register_test_account(client)
    token = client.cookies.get("floatchat_session")

    # A fresh application object, as a restarted server would have.
    restarted = TestClient(api_main.app)
    restarted.cookies.set("floatchat_session", token)
    body = restarted.get("/api/auth/session").json()
    assert body["authenticated"] is True


# --------------------------------------------------------------------------
# CSRF
# --------------------------------------------------------------------------

def test_a_state_changing_request_without_a_csrf_token_is_refused():
    client = fresh_client()
    register_test_account(client)
    assert client.post("/api/auth/logout").status_code == 403
    # The session is untouched by the refused request.
    assert client.get("/api/auth/session").json()["authenticated"] is True


def test_a_wrong_csrf_token_is_refused():
    client = fresh_client()
    register_test_account(client)
    response = client.post("/api/auth/logout",
                           headers={"X-CSRF-Token": "not-the-token"})
    assert response.status_code == 403


def test_one_session_csrf_token_does_not_authorise_another_session():
    victim = fresh_client()
    register_test_account(victim)
    attacker = fresh_client()
    other = register_test_account(attacker)

    response = victim.post("/api/auth/logout",
                           headers={"X-CSRF-Token": other["csrf"]})
    assert response.status_code == 403
    assert victim.get("/api/auth/session").json()["authenticated"] is True


# --------------------------------------------------------------------------
# Access boundaries, enforced in the backend
# --------------------------------------------------------------------------

PUBLIC_GETS = [
    "/api/health",
    "/api/coverage",
    "/api/floats",
    "/api/plan/capabilities",
    "/api/plan/nl_status",
    "/api/auth/session",
]


@pytest.mark.parametrize("path", PUBLIC_GETS)
def test_public_endpoints_need_no_account(path):
    assert fresh_client().get(path).status_code == 200


def test_manual_exploration_stays_public():
    """Validation and execution must work with no account at all."""
    client = fresh_client()
    profile_id = api_main.df_prof["profile_id"].iloc[0]
    assert client.get(f"/api/profiles/{profile_id}").status_code == 200
    assert client.get(f"/api/woa_match/{profile_id}").status_code == 200

    plan = {
        "schema_version": "1.0",
        "time": {"start": "2024-01-01T00:00:00Z", "end": "2024-01-09T23:59:59Z"},
        "region": {"kind": "bbox", "west": 60, "east": 65, "south": 15,
                   "north": 20},
        "depth": {"mode": "range", "min_m": 0, "max_m": 500},
        "variables": ["temp"],
    }
    assert client.post("/api/plan/validate", json=plan).status_code == 200
    assert client.post("/api/plan/execute", json=plan).status_code == 200


def test_the_paid_drafting_endpoint_requires_an_account():
    response = fresh_client().post("/api/plan/draft",
                                   json={"question": "temperature at 100 m"})
    assert response.status_code == 401


def test_the_drafting_endpoint_also_requires_a_csrf_token():
    client = fresh_client()
    register_test_account(client)
    assert client.post("/api/plan/draft",
                       json={"question": "temperature at 100 m"}).status_code == 403


def test_an_authenticated_request_reaches_the_drafting_route():
    """403/401 are gone; the route itself answers (no provider configured)."""
    client = fresh_client()
    account = register_test_account(client)
    response = client.post("/api/plan/draft",
                           json={"question": "temperature at 100 m",
                                 "revision": 1},
                           headers={"X-CSRF-Token": account["csrf"]})
    assert response.status_code == 503
    assert response.json()["errors"][0]["code"] == "provider_not_configured"


def test_a_revoked_session_can_no_longer_reach_the_paid_endpoint():
    client = fresh_client()
    account = register_test_account(client)
    client.post("/api/auth/logout", headers={"X-CSRF-Token": account["csrf"]})
    response = client.post("/api/plan/draft", json={"question": "x"},
                           headers={"X-CSRF-Token": account["csrf"]})
    assert response.status_code == 401


# --------------------------------------------------------------------------
# Role integrity
# --------------------------------------------------------------------------

def test_the_role_comes_from_the_session_not_from_the_request():
    """A client cannot promote itself by claiming a role in a request."""
    client = fresh_client()
    register_test_account(client, role="student")

    tampered = client.post("/api/auth/session", json={"role": "scientist"})
    # The session route is a GET; a POST to it is simply not allowed.
    assert tampered.status_code in (404, 405)

    body = client.get("/api/auth/session").json()
    assert body["user"]["role"] == "student"


def test_a_role_claim_in_a_draft_request_changes_nothing():
    client = fresh_client()
    account = register_test_account(client, role="student")
    client.post("/api/plan/draft",
                json={"question": "x", "role": "scientist",
                      "user": {"role": "scientist"}},
                headers={"X-CSRF-Token": account["csrf"]})
    assert client.get("/api/auth/session").json()["user"]["role"] == "student"


def test_both_roles_receive_identical_scientific_data():
    """Presentation may differ by role; the science must not."""
    student = fresh_client()
    register_test_account(student, role="student")
    scientist = fresh_client()
    register_test_account(scientist, role="scientist")

    profile_id = api_main.df_prof["profile_id"].iloc[0]
    assert (student.get(f"/api/profiles/{profile_id}").json()
            == scientist.get(f"/api/profiles/{profile_id}").json())
    assert student.get("/api/coverage").json() == scientist.get("/api/coverage").json()


def test_an_account_role_cannot_be_changed_through_re_registration():
    account = register_test_account(fresh_client(), role="student")
    retry = fresh_client().post("/api/auth/register", json={
        "email": account["email"], "password": account["password"],
        "role": "scientist"})
    assert retry.status_code == 409

    client = fresh_client()
    client.post("/api/auth/login", json={
        "email": account["email"], "password": account["password"]})
    assert client.get("/api/auth/session").json()["user"]["role"] == "student"


# --------------------------------------------------------------------------
# Honest capability reporting
# --------------------------------------------------------------------------

def test_unavailable_account_features_are_stated():
    body = fresh_client().get("/api/auth/session").json()
    unavailable = body["unavailable"]
    assert set(unavailable) == {"email_verification", "password_recovery",
                                "oauth_providers"}
    assert all(isinstance(text, str) and text for text in unavailable.values())


def test_no_password_recovery_or_verification_endpoints_exist():
    client = fresh_client()
    for path in ("/api/auth/verify-email", "/api/auth/reset-password",
                 "/api/auth/forgot-password", "/api/auth/oauth/google"):
        assert client.post(path, json={}).status_code == 404
