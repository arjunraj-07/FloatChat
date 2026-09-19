/**
 * The CSRF token for the current session, held in memory only.
 *
 * It lives here, apart from both `auth.ts` and `planContract.ts`, so the
 * request helpers can read it without those two modules importing each other.
 *
 * Deliberately **not** in `localStorage`, `sessionStorage`, a URL or a log:
 * it is a session credential. The session token itself is never visible to
 * this code at all - it travels in an HttpOnly cookie the browser manages.
 * Losing this value on reload is fine and expected: the app asks
 * `/api/auth/session` for a fresh one when it starts.
 */

let token: string | null = null;

export function currentCsrfToken(): string | null {
  return token;
}

export function setCsrfToken(next: string | null): void {
  token = next;
}

/** `{ 'X-CSRF-Token': ... }` when there is a session, otherwise empty. */
export function csrfHeader(): Record<string, string> {
  return token ? { 'X-CSRF-Token': token } : {};
}
