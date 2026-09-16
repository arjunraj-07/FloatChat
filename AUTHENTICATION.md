# Authentication in FloatChat

**Status: accounts are implemented and enforced by the backend.** FloatChat has
persistent local accounts, Argon2id password hashing and server-side sessions,
all inside the existing FastAPI service. There is no second authentication
authority and no Express server.

Two things this document is careful about, because both are easy to overstate:

1. **Signing in is optional.** Every map, globe, depth scene, profile, chart,
   time step and comparison works with no account at all. Exactly one feature
   requires one - the AI Assistant's drafting - because it is the only request
   that spends money.
2. **The Scientist role is self-selected.** It chooses which presentation opens
   by default. It is not professional verification, not administrator access,
   and it does not unlock data, endpoints or precision. Both roles receive
   byte-identical scientific responses, and a test asserts it.

## The account model

| | |
|---|---|
| Storage | SQLite, one file, separate from all scientific data |
| Location | `FLOATCHAT_AUTH_DB`, default `data/accounts/accounts.sqlite3` |
| Committed? | **No** - `data/accounts/` is git-ignored |
| Passwords | Argon2id via `argon2-cffi` (t=3, m=64 MiB, p=2) |
| Sessions | Server-side rows; the cookie holds an opaque token |
| Roles | `student` or `scientist`, self-selected at registration |

The Argo tables, the processed parquet files and the WOA reference caches are
never read or written by the account code.

### Passwords

Hashed with **Argon2id** and never stored, logged or returned in the clear. A
login for an unknown email still performs one verification against a dummy
hash, so a missing account and a wrong password take comparable time.
`check_needs_rehash` upgrades a hash when the parameters change.

### Sessions

- The token is generated with `secrets.token_urlsafe(32)`.
- **Only its SHA-256 digest is stored.** A copy of the database does not hand
  anyone a live session.
- Absolute expiry of 12 hours. An expired row is deleted on next use.
- **Rotation:** after 30 minutes the next authenticated request re-issues the
  session under a fresh token and the previous token stops working at once.
- **Revocation is server-side.** Logout deletes the row, so a captured cookie
  is useless afterwards - this is not a client-side cookie clear.

### Cookies and CSRF

| Cookie | Flags | Purpose |
|---|---|---|
| `floatchat_session` | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when configured | The session. Page scripts cannot read it. |
| `floatchat_csrf` | `SameSite=Lax`, readable | Double-submit companion, bound to the session row |

Every authenticated state-changing request (`POST`/`PUT`/`PATCH`/`DELETE`) must
present `X-CSRF-Token` matching the value bound to that session, compared with
`secrets.compare_digest`. A missing or wrong token is **403** before the route
runs, and one session's token never authorises another's.

The frontend keeps the CSRF value **in memory only**. Nothing - password,
session token or CSRF token - is written to `localStorage`, `sessionStorage`, a
URL or a log. (The only `localStorage` key the app uses remains
`floatchat.intro.seen`, which records that the opening animation has played.)

### Bounds and safe errors

- At most **5** failed logins per email in a 15-minute window, then `429`.
- Login failure is always `Email or password is incorrect.`, identical for an
  unknown address and a wrong password, so login does not disclose which
  emails exist. (Registration necessarily does - it must refuse a duplicate.)
- Body limits: 8 KiB for auth requests, 254 characters for an email, 10-256 for
  a password, 80 for a display name.

## The actual localhost arrangement

This matters more than it looks, because cookies and CORS disagree about what
"same" means.

| Piece | Address |
|---|---|
| Frontend dev server | `http://localhost:3000` |
| API (uvicorn bind) | `127.0.0.1:8000`, reached as `http://localhost:8000` |
| Frontend's API base | `http://localhost:8000/api` |
| CORS allow-list | `http://localhost:3000`, `http://127.0.0.1:3000` |

- The two are **cross-origin** (different ports), so the API sends explicit
  CORS headers with `allow_credentials=True`. The previous wildcard
  `allow_origins=["*"]` was replaced: browsers refuse a wildcard together with
  credentials, so cookie auth cannot work with it.
- The two are **same-site**, because cookies ignore the port. `SameSite=Lax` is
  therefore compatible with this split while still refusing genuine cross-site
  posts.
- **Open the app at `http://localhost:3000`, not `http://127.0.0.1:3000`.**
  `localhost` and `127.0.0.1` are different hosts to the cookie layer: a page
  served from `127.0.0.1:3000` calling `localhost:8000` is cross-*site*, and
  `SameSite=Lax` will withhold the session cookie. Sign-in appears to succeed
  and the next request is anonymous. Use one hostname consistently.

## Which endpoints require an account

**Public** - manual exploration is complete without signing in:

| Method | Path |
|---|---|
| GET | `/api/health`, `/api/coverage`, `/api/floats` |
| GET | `/api/profiles/{profile_id}`, `/api/woa_match/{profile_id}` |
| GET | `/api/plan/capabilities`, `/api/plan/nl_status` |
| POST | `/api/plan/validate`, `/api/plan/execute` |
| GET/POST | `/api/auth/session`, `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` |

**Requires an account and a CSRF token:**

| Method | Path | Why |
|---|---|---|
| POST | `/api/plan/draft` | The only route that calls the paid language model |

Enforcement is a FastAPI dependency applied in `api/main.py`, so a request made
straight to the API - curl, a script, another origin - is refused identically
to one from the UI. **The frontend gate is a courtesy, not the control.** The
dependency is passed into `build_plan_router`, which leaves the route open when
no dependency is supplied; that is how the isolated router tests exercise
drafting without an account store, and it is never how the application runs.

Gemini credentials remain backend-only and are never sent to the browser.

## Not available on this deployment

These are absent, and the interface says so rather than implying otherwise. The
server reports them in every `/api/auth/session` response under `unavailable`,
and the sign-in screen renders that list.

- **Email verification.** No mail service is configured. Addresses are never
  verified and **no mail is ever sent**. An address is only an identifier here.
- **Password recovery.** There is no reset flow. A forgotten password cannot be
  recovered on this deployment; the account would have to be recreated.
- **Third-party sign-in (OAuth).** Not configured.

No endpoint exists for any of them, and a request to a plausible path (for
example `/api/auth/reset-password`) is a 404 - tested, so a future change
cannot quietly add a non-functional stub.

## Deploying this beyond localhost

1. Set `FLOATCHAT_COOKIE_SECURE=1` so cookies are HTTPS-only, and terminate TLS.
2. Set `FLOATCHAT_ALLOWED_ORIGINS` to the real frontend origin. Do not restore
   a wildcard: it cannot work with credentials.
3. Put `FLOATCHAT_AUTH_DB` on persistent storage, and back it up separately
   from the scientific data. It holds password hashes.
4. Re-examine the attempt bound. It is per email, not per IP, so it limits
   credential stuffing against one account but not a spread across many.

## Known limitations

- The login bound is **per email**, not per IP or per network.
- There is no password change, account deletion or admin interface. Operators
  act on the SQLite file directly.
- Sessions do not surface a "sign out everywhere" control, though
  `revoke_all_sessions` exists in the store.
- SQLite is single-file. It suits one instance; concurrent writers across
  processes would need a different store.
- The role is chosen at registration and cannot be changed afterwards in the
  UI. Re-registering the same email is refused, so a role cannot be escalated
  that way (tested).
