/* FloatChat — authentication gate. Login and Sign up are one screen with a mode
   toggle. Built from the design-system component classes (.card, .field, .input,
   .btn, .btn-primary, .btn-ghost) with the accent rebound to the app's ocean
   tokens, so the gate and the product read as one. Mock auth only. */

const NAME_FROM = (email) => {
  const local = (email.split('@')[0] || 'analyst').replace(/[._-]+/g, ' ');
  return local.split(' ').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || 'Analyst';
};

function AuthScene() {
  const cv = React.useRef(null);
  const pointerRef = React.useRef({ x: 0, y: 0, vx: 0, vy: 0, speed: 0, active: false });
  React.useEffect(() => {
    const el = cv.current?.parentElement;
    if (!el) return;
    let lx = 0, ly = 0, lt = performance.now();
    const move = (e) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const now = performance.now(), dt = Math.max(now - lt, 8);
      const p = pointerRef.current;
      p.vx = (x - lx) * (16 / dt); p.vy = (y - ly) * (16 / dt);
      p.speed = Math.hypot(p.vx, p.vy);
      p.x = x; p.y = y; p.active = true;
      lx = x; ly = y; lt = now;
    };
    const leave = () => { pointerRef.current.active = false; pointerRef.current.speed = 0; };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
  }, []);
  return <OceanScene depth={0.34} motion={true} pointerRef={pointerRef} />;
}

function AuthCard() {
  const [mode, setMode] = React.useState('login');
  const [email, setEmail] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [pw2, setPw2] = React.useState('');
  const [remember, setRemember] = React.useState(true);
  const [terms, setTerms] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const signup = mode === 'signup';

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const pwOk = pw.length >= 8;
  const matchOk = !signup || (pw2.length > 0 && pw === pw2);
  const termsOk = !signup || terms;
  const ready = emailOk && pwOk && matchOk && termsOk && !busy;

  const submit = (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    setTimeout(() => {
      FCSession.write({ signedIn: true, guest: false, accountType: 'scientist', detail: 'detailed', email: email.trim(), name: NAME_FROM(email.trim()), remember, at: new Date().toISOString() });
      if (window.FCAuthDone) FCAuthDone(); else window.location.href = 'FloatChat.html';
    }, 900);
  };

  const guest = () => {
    FCSession.write({ signedIn: false, guest: true, accountType: 'scientist', detail: 'detailed', email: null, name: 'Guest', remember: false, at: new Date().toISOString() });
    if (window.FCAuthDone) FCAuthDone(); else window.location.href = 'FloatChat.html';
  };

  const switchMode = () => {
    setMode(signup ? 'login' : 'signup');
    setError(null); setPw2(''); setTerms(false);
  };

  return (
    <div className="auth-card card elev-lg">
      <header className="auth-head">
        <span className="auth-brand"><span className="auth-mark" aria-hidden="true"><span></span><span></span><span></span></span>FloatChat</span>
        <h1 className="auth-title">{signup ? 'Create your account' : 'Sign in to FloatChat'}</h1>
        <p className="auth-lede">{signup ? 'Ask questions of the Argo array and keep your query history across sessions.' : 'Explore the Argo observations that are loaded, and ask the assistant about them.'}</p>
      </header>

      <div className="auth-modes" role="tablist" aria-label="Authentication mode">
        <button role="tab" aria-selected={!signup} className={'auth-mode' + (!signup ? ' is-on' : '')} onClick={() => setMode('login')}>Log in</button>
        <button role="tab" aria-selected={signup} className={'auth-mode' + (signup ? ' is-on' : '')} onClick={() => setMode('signup')}>Sign up</button>
      </div>

      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="auth-email">Email</label>
          <input id="auth-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@institute.org" aria-describedby="auth-email-hint" />
          <p id="auth-email-hint" className="auth-hint">{email && !emailOk ? 'Enter a complete email address.' : '\u00a0'}</p>
        </div>

        <div className="field">
          <label htmlFor="auth-pw">Password</label>
          <input id="auth-pw" className="input" type="password" autoComplete={signup ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} aria-describedby="auth-pw-hint" />
          <p id="auth-pw-hint" className="auth-hint">{pw && !pwOk ? 'At least 8 characters.' : '\u00a0'}</p>
        </div>

        {signup && (
          <div className="field">
            <label htmlFor="auth-pw2">Confirm password</label>
            <input id="auth-pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-describedby="auth-pw2-hint" />
            <p id="auth-pw2-hint" className="auth-hint">{pw2 && pw !== pw2 ? 'Passwords do not match.' : '\u00a0'}</p>
          </div>
        )}

        <div className="auth-row">
          {signup ? (
            <label className="auth-check">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
              <span>I accept the <a href="#terms">terms</a> and <a href="#privacy">privacy policy</a></span>
            </label>
          ) : (
            <>
              <label className="auth-check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>Remember me</span>
              </label>
              <a className="auth-forgot" href="#reset">Forgot password?</a>
            </>
          )}
        </div>

        {error && <p className="auth-error" role="alert">{error}</p>}

        <button type="submit" className="btn btn-primary btn-block" disabled={!ready}>
          {busy ? <span className="auth-busy"><span className="auth-spinner" aria-hidden="true"></span>{signup ? 'Creating account…' : 'Signing in…'}</span> : (signup ? 'Create account' : 'Log in')}
        </button>

        <p className="auth-switch">
          {signup ? 'Already have an account?' : 'New to FloatChat?'}
          <button type="button" className="btn btn-ghost" onClick={switchMode}>{signup ? 'Log in' : 'Create an account'}</button>
        </p>
      </form>

      <footer className="auth-foot">
        <button type="button" className="btn btn-ghost" onClick={guest}>Continue as guest</button>
        <span className="auth-note">Guests can explore and read profiles. The assistant needs an account.</span>
      </footer>
    </div>
  );
}

function AuthPage() {
  return (
    <div className="auth-stage">
      <AuthScene />
      <div className="auth-centre">
        <AuthCard />
        <p className="auth-attrib">Argo data are collected and made freely available by the International Argo Program.</p>
      </div>
    </div>
  );
}

Object.assign(window, { AuthPage, AuthCard, AuthScene });
window.FCAuthMount = () => ReactDOM.createRoot(document.getElementById('root')).render(<AuthPage />);
