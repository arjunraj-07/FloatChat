# Authentication in FloatChat

**Status: there is no authentication.** FloatChat has no accounts, no sign-in, no
sessions and no per-user data. Every visitor to a running instance sees the same
cached Argo dataset and can run the same queries.

This document exists because the marine-atlas visual design export included
account screens (sign-in, sign-up, a profile menu). **Those screens were
deliberately not ported.** A login form that does not authenticate anything is
worse than no login form: it invites people to type credentials that go nowhere,
and it implies a security boundary and a privacy guarantee that do not exist.
Only the design language from that export was integrated - the palette,
typography, spacing and motion - not its account surfaces.

If authentication is added later, this is what the current code does and does
not give you.

## What exists today

- The backend (`api/main.py`, `api/plan_routes.py`) serves every endpoint
  unauthenticated. There is no session middleware, no token verification and no
  per-request identity.
- The frontend keeps all state in React memory. Nothing is persisted per user.
  The single exception is `localStorage["floatchat.intro.seen"]`, which records
  only that this browser has already watched the opening scene. It is a display
  convenience, not an identity, and the application works correctly when it is
  missing, unreadable or cleared.
- The Gemini drafting integration is backend-only: the API key lives on the
  server and is never sent to the browser. That property must be preserved by
  any future auth work.

## What adding authentication would require

Authentication is a backend change first. Adding UI alone would produce exactly
the misleading screens this project declined to ship.

1. **Server-enforced sessions.** Identity has to be established and verified on
   the backend, with sessions the server can invalidate. The frontend must never
   be the component that decides whether a request is authorised.
2. **Authorisation on every endpoint.** `/api/coverage`, `/api/floats`,
   `/api/plan/validate`, `/api/plan/execute`, `/api/plan/draft` and
   `/api/woa_match/{id}` are currently open. Each needs an explicit decision:
   public, or restricted to an authenticated caller.
3. **A real threat model for the drafting endpoint.** `/api/plan/draft` is the
   only route that spends money per call. It is the first endpoint that needs
   per-account rate limiting, and the reason most worth adding accounts at all.
4. **Then, and only then, the UI.** Sign-in screens should be added once they are
   connected to real, server-enforced sessions - not before.

## Rules for whoever does this

- Do not present an account screen that does not authenticate. If sign-in is
  unfinished, ship no sign-in.
- Do not move the Gemini key, or any provider credential, into the browser.
- Do not use `localStorage` as an identity or permission store. It is per-browser,
  clearable by the viewer, and readable by any script on the origin.
- Keep the scientific guarantees independent of identity: the QC policy, the
  provenance and the exact depth and pressure values must not vary by who is
  signed in.

Until all of that is in place, the honest statement - the one made in
**About Data → Current limitations** - is that there are no user accounts, and
nothing is signed in, saved to a profile or shared between browsers.
