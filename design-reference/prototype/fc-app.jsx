/* FloatChat — app shell: nav, routing, session, shared selection state. */
const NAV = [
  { id: 'explore', label: 'Explore' },
  { id: 'assistant', label: 'AI Assistant' },
  { id: 'compare', label: 'Compare' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'about', label: 'About' },
];

function AccountMenu() {
  const app = useApp();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, []);
  const s = app.session;
  if (!s.signedIn) {
    return (
      <div className="fc-row fc-gap-2" ref={ref}>
        {s.expired && <Tag tone="coral">Session expired</Tag>}
        {s.guest && <Tag tone="neutral">Guest</Tag>}
        <Btn size="sm" onClick={() => { FCSession.clear(); if (window.FCGate) FCGate(); else window.location.href = 'Auth.html'; }}>Sign in</Btn>
      </div>
    );
  }
  return (
    <div ref={ref} className="fc-acct">
      <button className="fc-acct-btn" onClick={() => setOpen(!open)} aria-expanded={open}><span className="fc-acct-dot" aria-hidden="true"></span>{s.name || 'A. Harish'}</button>
      {open && (
        <div className="fc-menu" role="menu">
          <div className="fc-menu-id"><strong>{s.name || 'A. Harish'}</strong><Mono className="fc-sm fc-muted">{s.email || 'a.harish@ocean.example'}</Mono></div>
          <DataRow k="Account type" v={s.accountType === 'student' ? 'Student' : 'Scientist'} />
          <div className="fc-mt-3"><Field label="Display preference" hint="Applies to profile and analysis panels."><Seg ariaLabel="Display preference" value={s.detail} onChange={(v) => app.setSession({ ...s, detail: v })} options={[{ value: 'simple', label: 'Simple' }, { value: 'detailed', label: 'Detailed' }]} /></Field></div>
          <div className="fc-row fc-gap-2 fc-mt-3">
            <Btn size="sm" onClick={() => { FCSession.clear(); if (window.FCGate) FCGate(); else window.location.href = 'Auth.html'; }}>Sign out</Btn>
            <Btn variant="ghost" size="sm" onClick={() => { app.setSession({ ...s, signedIn: false, expired: true }); setOpen(false); }}>Expire session</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function Nav() {
  const app = useApp();
  const active = { explore: ['explore', 'globe', 'depth', 'time', 'profile'], assistant: ['assistant'], compare: ['compare'], analysis: ['analysis'], about: ['about'] };
  return (
    <header className="fc-nav">
      <button className="fc-brand" onClick={() => app.go('home')} aria-label="FloatChat home">
        <span className="fc-brand-mark" aria-hidden="true"><span></span><span></span><span></span></span>
        FloatChat
      </button>
      <nav className="fc-navlinks" aria-label="Main">
        {NAV.map((n) => (
          <button key={n.id} className={'fc-navlink' + (active[n.id].includes(app.screen) ? ' is-on' : '')} aria-current={active[n.id].includes(app.screen) ? 'page' : undefined} onClick={() => app.go(n.id === 'explore' ? 'explore' : n.id)}>{n.label}</button>
        ))}
      </nav>
      <div className="fc-row fc-gap-3">
        <Mono className="fc-sm fc-muted fc-hide-narrow">{FC.floats.length} floats · {FC.profiles.length} profiles</Mono>
        <AccountMenu />
      </div>
    </header>
  );
}

function ScreenHead({ kicker, title, sub, states, state, setState, actions }) {
  return (
    <div className="fc-screenhead">
      <div className="fc-screenhead-main">
        <Kicker>{kicker}</Kicker>
        <h2 className="fc-screen-title">{title}</h2>
        {sub && <p className="fc-muted fc-sm fc-screen-sub">{sub}</p>}
      </div>
      <div className="fc-screenhead-side">
        {actions && <div className="fc-row fc-gap-2 fc-wrap">{actions}</div>}
        {states && <StateChips states={states} value={state} onChange={setState} />}
      </div>
    </div>
  );
}

function App() {
  const [screen, setScreen] = React.useState('home');
  const [params, setParams] = React.useState({});
  const [history, setHistory] = React.useState([]);
  const [filters, setFilters] = React.useState(FC.defaultFilters);
  const [session, setSession] = React.useState(() => {
    const saved = window.FCSession ? FCSession.read() : null;
    return saved
      ? { signedIn: !!saved.signedIn, guest: !!saved.guest, accountType: saved.accountType || 'scientist', detail: saved.detail || 'detailed', expired: false, authError: false, name: saved.name, email: saved.email }
      : { signedIn: false, guest: false, accountType: 'scientist', detail: 'detailed', expired: false, authError: false };
  });
  const [sel, setSel] = React.useState(() => {
    const first = FC.profiles[Math.floor(FC.profiles.length * 0.31)];
    const second = FC.profiles[Math.floor(FC.profiles.length * 0.62)];
    return { profileId: first.profile_id, compareA: first.profile_id, compareB: second.profile_id, timeIndex: 6, variable: 'temp' };
  });
  const go = React.useCallback((next, p = {}) => {
    setScreen((cur) => { setHistory((h) => [...h.slice(-8), cur]); return next; });
    setParams(p);
    window.scrollTo({ top: 0, behavior: prefersReduced() ? 'auto' : 'smooth' });
  }, []);
  const back = React.useCallback(() => {
    setHistory((h) => { if (!h.length) return h; setScreen(h[h.length - 1]); return h.slice(0, -1); });
  }, []);
  const results = React.useMemo(() => FC.filter(filters), [filters]);
  React.useEffect(() => { window.FCGo = go; }, [go]);
  const ctx = { screen, go, back, params, filters, setFilters, session, setSession, sel, setSel, results };
  const Screen = (window.FCScreens || {})[screen] || (() => <div className="fc-shell"><EmptyState title="Screen not built" body={'No screen registered for "' + screen + '".'} /></div>);
  return (
    <AppCtx.Provider value={ctx}>
      <a className="fc-skip" href="#fc-main">Skip to content</a>
      {screen !== 'home' && <Nav />}
      <main id="fc-main" className={screen === 'home' ? '' : 'fc-main'}>
        <Screen />
      </main>
      {window.FCWidget ? <FCWidget /> : null}
    </AppCtx.Provider>
  );
}

Object.assign(window, { Nav, ScreenHead, App, NAV });
window.FCMount = () => ReactDOM.createRoot(document.getElementById('root')).render(<App />);
