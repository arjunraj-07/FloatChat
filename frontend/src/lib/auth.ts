/**
 * Account client for the FloatChat API.
 *
 * The session itself lives in an HttpOnly cookie the browser sends
 * automatically; this module never sees it and never stores it. The CSRF
 * token returned alongside it is kept **in memory only** - never in
 * `localStorage`, never in a URL - and is echoed back as a header on
 * state-changing requests.
 *
 * The account role is separate from the Student/Scientific viewing toggle.
 * The role decides which presentation opens by default and nothing else:
 * changing the toggle never changes identity or permissions, and the server
 * never returns different scientific values for one role or the other.
 */

import { API_BASE } from './planContract.ts';
import { csrfHeader, currentCsrfToken, setCsrfToken } from './csrf.ts';

export { currentCsrfToken, setCsrfToken };

export const ACCOUNT_ROLES = ['student', 'scientist'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export interface Account {
  id: number;
  email: string;
  role: AccountRole;
  display_name: string;
  created_at: string;
}

/** Capabilities this deployment does not have. Stated, never implied. */
export interface UnavailableFeatures {
  email_verification: string;
  password_recovery: string;
  oauth_providers: string;
}

export interface SessionState {
  authenticated: boolean;
  user: Account | null;
  csrf_token: string | null;
  expires_at: string | null;
  unavailable: UnavailableFeatures;
}

export type AuthResult =
  | { ok: true; session: SessionState }
  | { ok: false; code: string; message: string };

// ---------------------------------------------------------------------------
// Requests that change state
// ---------------------------------------------------------------------------

/** Headers for a state-changing request that must carry the session. */
export function mutationHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', ...csrfHeader() };
}

// ---------------------------------------------------------------------------
// Presentation defaults
// ---------------------------------------------------------------------------

/**
 * Which presentation a role opens with. A *default*, not a restriction: the
 * viewer can switch freely afterwards, and switching changes nothing about
 * who they are or what they may do.
 */
export function defaultViewForRole(role: AccountRole): 'student' | 'scientific' {
  return role === 'scientist' ? 'scientific' : 'student';
}

export function roleLabel(role: AccountRole): string {
  return role === 'scientist' ? 'Scientist' : 'Student';
}

// ---------------------------------------------------------------------------
// Client-side bounds, mirroring the server
// ---------------------------------------------------------------------------

export const PASSWORD_MIN_CHARS = 10;
export const PASSWORD_MAX_CHARS = 256;
export const EMAIL_MAX_CHARS = 254;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;

/**
 * Why a registration form cannot be submitted yet, or null when it can.
 * The server validates independently; this only avoids a pointless request.
 */
export function registrationProblem(email: string, password: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return 'Enter your email address.';
  if (trimmed.length > EMAIL_MAX_CHARS || !EMAIL_PATTERN.test(trimmed)) {
    return 'Enter a valid email address.';
  }
  if (password.length < PASSWORD_MIN_CHARS) {
    return `Use a password of at least ${PASSWORD_MIN_CHARS} characters.`;
  }
  if (password.length > PASSWORD_MAX_CHARS) {
    return `Passwords are limited to ${PASSWORD_MAX_CHARS} characters.`;
  }
  return null;
}

export function signInProblem(email: string, password: string): string | null {
  if (!email.trim()) return 'Enter your email address.';
  if (!password) return 'Enter your password.';
  return null;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

async function readResult(response: Response): Promise<AuthResult> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: 'unreadable_response', message: 'The server sent an unreadable reply.' };
  }
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } })?.error;
    return {
      ok: false,
      code: error?.code ?? `http_${response.status}`,
      message: error?.message ?? 'Something went wrong. Try again.',
    };
  }
  const session = body as SessionState;
  setCsrfToken(session.csrf_token ?? null);
  return { ok: true, session };
}

function transportFailure(error: unknown): AuthResult {
  return {
    ok: false,
    code: 'unreachable',
    message:
      error instanceof TypeError
        ? 'Could not reach the FloatChat server. Check that it is running.'
        : 'Could not reach the FloatChat server.',
  };
}

/** Restore a session on page load. Signed out is a normal answer, not an error. */
export async function fetchSession(apiBase: string = API_BASE): Promise<AuthResult> {
  try {
    const response = await fetch(`${apiBase}/auth/session`, { credentials: 'include' });
    return await readResult(response);
  } catch (error) {
    return transportFailure(error);
  }
}

export async function registerAccount(
  input: { email: string; password: string; role: AccountRole; displayName?: string },
  apiBase: string = API_BASE,
): Promise<AuthResult> {
  try {
    const response = await fetch(`${apiBase}/auth/register`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        role: input.role,
        display_name: input.displayName ?? '',
      }),
    });
    return await readResult(response);
  } catch (error) {
    return transportFailure(error);
  }
}

export async function signIn(
  input: { email: string; password: string },
  apiBase: string = API_BASE,
): Promise<AuthResult> {
  try {
    const response = await fetch(`${apiBase}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: input.email, password: input.password }),
    });
    return await readResult(response);
  } catch (error) {
    return transportFailure(error);
  }
}

/** Revoke the session server-side. The cookie is cleared by the response. */
export async function signOut(apiBase: string = API_BASE): Promise<AuthResult> {
  try {
    const response = await fetch(`${apiBase}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: mutationHeaders(),
    });
    const result = await readResult(response);
    setCsrfToken(null);
    return result;
  } catch (error) {
    setCsrfToken(null);
    return transportFailure(error);
  }
}
