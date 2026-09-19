'use client';

/**
 * Create an account, sign in, or carry on without one.
 *
 * An ordinary registration form: email, password, and the account type as a
 * choice inside the form rather than a separate page to read first. The
 * account type sets which detail level opens by default and nothing else - it
 * is self-selected, grants no extra access, and changes no measurement.
 *
 * Continuing as a guest is a first-class path, not a fallback: everything
 * except the AI Assistant works without an account.
 *
 * No credential is stored here. The password lives in component state only
 * until the request is sent; the session arrives as an HttpOnly cookie this
 * code cannot read.
 */

import { useEffect, useRef, useState } from 'react';

import {
  type AccountRole,
  type SessionState,
  type UnavailableFeatures,
  registerAccount,
  registrationProblem,
  signIn,
  signInProblem,
} from '@/lib/auth.ts';

type Mode = 'register' | 'signin';

interface Props {
  onAuthenticated: (session: SessionState) => void;
  onContinuePublic: () => void;
  /** What this deployment cannot do, as reported by the server. */
  unavailable: UnavailableFeatures | null;
}

const ROLE_NOTE: Record<AccountRole, string> = {
  student: 'Plain-language explanations first.',
  scientist: 'QC, provenance and exact values first.',
};

function Mark() {
  return (
    <svg width="30" height="30" viewBox="0 0 36 36" role="img" aria-label="FloatChat">
      <path d="M7 22.5c3.5-2.2 6.3-2.2 9.3 0 3.1 2.2 6 2.2 9.7 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M10.5 18.5h15V9.2c-4.5-2.5-10.5-2.5-15 0v9.3Z" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M13.2 9.8V7.2M22.8 9.8V7.2M18 6.9v-2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="18" cy="13.2" r="1.25" fill="currentColor" />
    </svg>
  );
}

export default function AuthScreen({ onAuthenticated, onContinuePublic, unavailable }: Props) {
  const [mode, setMode] = useState<Mode>('register');
  const [role, setRole] = useState<AccountRole>('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, [mode]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const problem =
      mode === 'register' ? registrationProblem(email, password) : signInProblem(email, password);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const result =
      mode === 'register'
        ? await registerAccount({ email: email.trim(), password, role })
        : await signIn({ email: email.trim(), password });
    setBusy(false);
    if (result.ok) {
      setPassword('');
      onAuthenticated(result.session);
    } else {
      setError(result.message);
    }
  };

  return (
    <main data-testid="auth-screen" className="min-h-screen bg-[var(--page)] px-5 py-10 text-[var(--ink)]">
      <div className="mx-auto w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-2.5 text-[var(--marine)]">
          <Mark />
          <span className="brand-word text-[var(--ink)]">
            Float<span className="text-[var(--teal)]">Chat</span>
          </span>
        </div>

        <section className="card p-6">
          <div role="group" aria-label="Create account or sign in" className="segmented mb-5 w-full">
            {(['register', 'signin'] as const).map((value) => (
              <button
                key={value}
                type="button"
                data-testid={`auth-tab-${value}`}
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);
                  setError(null);
                }}
                className={`flex-1 ${mode === value ? 'is-selected' : ''}`}
              >
                {value === 'register' ? 'Create account' : 'Sign in'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4" aria-label={mode === 'register' ? 'Create account' : 'Sign in'}>
            <div>
              <label htmlFor="auth-email" className="field-label">Email</label>
              <input
                id="auth-email"
                data-testid="auth-email"
                ref={emailRef}
                type="email"
                autoComplete="email"
                value={email}
                disabled={busy}
                onChange={(event) => setEmail(event.target.value)}
                className="field-input"
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="field-label">Password</label>
              <input
                id="auth-password"
                data-testid="auth-password"
                type="password"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
                className="field-input"
              />
              {mode === 'register' && <p className="tiny mt-1">At least 10 characters.</p>}
            </div>

            {mode === 'register' && (
              <fieldset className="space-y-2">
                <legend className="field-label">Account type</legend>
                {(['student', 'scientist'] as const).map((value) => (
                  <label
                    key={value}
                    data-testid={`role-${value}`}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition ${
                      role === value
                        ? 'border-[var(--teal)] bg-[var(--mineral)]'
                        : 'border-[var(--divider)] hover:border-[var(--outline)]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="account-role"
                      value={value}
                      checked={role === value}
                      disabled={busy}
                      onChange={() => setRole(value)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-[var(--ink)]">
                        {value === 'student' ? 'Student' : 'Scientist'}
                      </span>
                      <span className="tiny">{ROLE_NOTE[value]}</span>
                    </span>
                  </label>
                ))}
                <p data-testid="auth-role-note" className="tiny">
                  Self-selected. It sets your starting detail level — not professional verification,
                  and not extra access. Both types see identical measurements.
                </p>
              </fieldset>
            )}

            {error && (
              <p data-testid="auth-error" role="alert" className="rounded-md bg-[#f6e6e0] px-3 py-2 text-sm text-[#7d3418]">
                {error}
              </p>
            )}

            <button type="submit" data-testid="auth-submit" disabled={busy} className="button button-primary w-full">
              {busy
                ? mode === 'register' ? 'Creating account…' : 'Signing in…'
                : mode === 'register' ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <div className="mt-5 border-t border-[var(--divider)] pt-4">
            <button type="button" data-testid="auth-public" onClick={onContinuePublic} className="button button-outline w-full">
              Continue as guest
            </button>
            <p className="tiny mt-2 text-center">
              Maps, profiles, charts and comparisons all work without an account.
            </p>
          </div>
        </section>

        {unavailable && (
          <details data-testid="auth-unavailable" className="mt-4">
            <summary className="tiny cursor-pointer select-none">What this deployment cannot do</summary>
            <ul className="tiny mt-1.5 space-y-1">
              <li>{unavailable.email_verification}</li>
              <li>{unavailable.password_recovery}</li>
              <li>{unavailable.oauth_providers}</li>
            </ul>
          </details>
        )}
      </div>
    </main>
  );
}
