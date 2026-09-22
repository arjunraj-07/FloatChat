'use client';

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
import dynamic from 'next/dynamic';

const OceanScenery = dynamic(() => import('./IntroScene').then(m => m.OceanScene), { ssr: false });

type Mode = 'register' | 'signin';

interface Props {
  onAuthenticated: (session: SessionState) => void;
  onContinuePublic: () => void;
  unavailable: UnavailableFeatures | null;
}

const ROLE_NOTE: Record<AccountRole, string> = {
  student: 'Plain-language explanations first.',
  scientist: 'QC, provenance and exact values first.',
};

export default function AuthScreen({ onAuthenticated, onContinuePublic, unavailable }: Props) {
  const [mode, setMode] = useState<Mode>('register');
  const [role, setRole] = useState<AccountRole>('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terms, setTerms] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const pointerRef = useRef({ x: 0, y: 0, vx: 0, vy: 0, speed: 0, active: false });
  const signup = mode === 'register';

  // Two media queries drive the decorative scenery. Reduced motion suspends the
  // animation; the 900px query mirrors the `.auth-scenery` breakpoint in
  // globals.css, because `display: none` does not stop a requestAnimationFrame
  // loop - the
  // panel is hidden on mobile but its canvas would otherwise keep animating
  // off-screen.
  const [reduced, setReduced] = useState(false);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const wideQuery = window.matchMedia('(min-width: 900px)');
    const update = () => {
      setReduced(motionQuery.matches);
      setWide(wideQuery.matches);
    };
    update();
    motionQuery.addEventListener('change', update);
    wideQuery.addEventListener('change', update);
    return () => {
      motionQuery.removeEventListener('change', update);
      wideQuery.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    emailRef.current?.focus();
  }, [mode]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (mode === 'register' && !terms) {
      setError('You must agree to the Terms of Service and Privacy Policy.');
      return;
    }
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
    <div className="auth-stage" data-testid="auth-screen">
      <div className="auth-scenery" aria-hidden="true">
        {wide && <OceanScenery depth={0.1} motion={!reduced} pointerRef={pointerRef} />}
      </div>
      <div className="auth-centre">
        <div className="auth-card">
          <header className="auth-head">
            <button
              type="button"
              className="auth-back"
              onClick={onContinuePublic}
              data-testid="auth-public"
            >
              ← Back to home
            </button>
            <h1 className="auth-title">{signup ? 'Create your account' : 'Sign in to FloatChat'}</h1>
            <p className="auth-lede">{signup ? 'Ask questions of the Argo array and explore the ocean.' : 'Explore the Argo observations that are loaded, and ask the assistant about them.'}</p>
          </header>

          <div className="auth-modes" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              role="tab"
              aria-selected={!signup}
              className={`auth-mode ${!signup ? 'is-on' : ''}`}
              onClick={() => { setMode('signin'); setError(null); }}
              data-testid="auth-tab-signin"
            >
              Log in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={signup}
              className={`auth-mode ${signup ? 'is-on' : ''}`}
              onClick={() => { setMode('register'); setError(null); }}
              data-testid="auth-tab-register"
            >
              Sign up
            </button>
          </div>

          <form onSubmit={submit} noValidate aria-label={signup ? 'Create account' : 'Sign in'}>
            <div className="fc-field mb-4">
              <label htmlFor="auth-email">Email</label>
              <input
                id="auth-email"
                data-testid="auth-email"
                ref={emailRef}
                className="fc-input"
                type="email"
                autoComplete="email"
                value={email}
                disabled={busy}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@institute.org"
              />
            </div>

            <div className="fc-field mb-4">
              <label htmlFor="auth-pw">Password</label>
              <input
                id="auth-pw"
                data-testid="auth-password"
                className="fc-input"
                type="password"
                autoComplete={signup ? 'new-password' : 'current-password'}
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
              />
              {signup && <p className="auth-hint">At least 10 characters.</p>}
            </div>

            {/* The rule used to be drawn on the fieldset's own top edge, so it
                ran straight through the word "Account type". It is a separate
                divider now, leaving the legend legible. */}
            {signup && (
              <>
              <div className="mt-4 border-t border-[var(--fc-line-2)]" />
              <fieldset className="fc-field mb-4 mt-4">
                <legend className="fc-mono text-[var(--fc-text)] text-sm mb-3 font-semibold">Account type</legend>
                <div className="flex flex-col gap-3">
                  {(['student', 'scientist'] as const).map((v) => (
                    <label
                      key={v}
                      data-testid={`role-${v}`}
                      className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition ${
                        role === v
                          ? 'border-[var(--fc-teal-bright)] bg-[rgba(139,203,196,0.1)]'
                          : 'border-[var(--fc-line-2)] hover:border-[rgba(139,203,196,0.3)]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="account-role"
                        value={v}
                        checked={role === v}
                        disabled={busy}
                        onChange={() => setRole(v)}
                        className="mt-1 accent-[var(--fc-teal-bright)] w-4 h-4"
                      />
                      <span className="flex flex-col">
                        <span className="text-sm font-semibold text-[var(--fc-text)]">
                          {v === 'student' ? 'Student' : 'Scientist'}
                        </span>
                        <span className="text-xs text-[var(--fc-muted)] mt-0.5">{ROLE_NOTE[v]}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p data-testid="auth-role-note" className="auth-hint mt-3">
                  Self-selected. It sets your starting detail level — not professional verification,
                  and not extra access. Both types see identical measurements.
                </p>
                <div className="mt-4 flex items-start gap-2">
                  <input
                    type="checkbox"
                    id="terms-checkbox"
                    checked={terms}
                    onChange={(e) => setTerms(e.target.checked)}
                    className="mt-1 accent-[var(--fc-teal-bright)] w-4 h-4 cursor-pointer"
                  />
                  <label htmlFor="terms-checkbox" className="text-xs text-[var(--fc-muted)] cursor-pointer">
                    I agree to the <a href="/terms" className="text-[var(--fc-teal-bright)] hover:underline" target="_blank" rel="noreferrer">Terms of Service</a> and <a href="/privacy" className="text-[var(--fc-teal-bright)] hover:underline" target="_blank" rel="noreferrer">Privacy Policy</a>.
                  </label>
                </div>
              </fieldset>
              </>
            )}

            {error && (
              <p data-testid="auth-error" role="alert" className="auth-error">
                {error}
              </p>
            )}

            <button type="submit" data-testid="auth-submit" disabled={busy} className="fc-btn fc-btn-primary w-full mt-2">
              {busy ? (
                <span className="auth-busy">
                  <span className="auth-spinner"></span>
                  {signup ? 'Creating account…' : 'Signing in…'}
                </span>
              ) : (
                signup ? 'Create account' : 'Sign in'
              )}
            </button>
          </form>

          <div className="auth-foot">
            <p className="auth-note">
              Maps, profiles, charts and comparisons all work without an account.
            </p>
          </div>
        </div>

        {unavailable && (
          <details data-testid="auth-unavailable" className="mt-4 w-full max-w-[420px] mx-auto text-[var(--fc-muted)] border-t border-[var(--fc-line-2)] pt-4">
            <summary className="text-xs cursor-pointer select-none outline-none font-mono hover:text-[var(--fc-text)]">What this deployment cannot do</summary>
            <ul className="text-xs mt-2 space-y-1 ml-4 list-disc marker:text-[var(--fc-line-2)]">
              <li>{unavailable.email_verification}</li>
              <li>{unavailable.password_recovery}</li>
              <li>{unavailable.oauth_providers}</li>
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
