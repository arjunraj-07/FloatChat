/* @ds-bundle: {"format":4,"namespace":"Nocturne_noctur","components":[],"sourceHashes":{"prototype/fc-app.jsx":"9c3344e12e43","prototype/fc-assistant.jsx":"970f7f7aa646","prototype/fc-auth.jsx":"b74ebb734f6a","prototype/fc-chat-store.js":"b2a5e4d2fa7c","prototype/fc-core.jsx":"962ac5cec671","prototype/fc-depth.jsx":"e85846d9e2e1","prototype/fc-dive.jsx":"98d19b1e1fee","prototype/fc-geo.jsx":"7ae85e7688f6","prototype/fc-hero.jsx":"b1ea254ef690","prototype/fc-profile.jsx":"bc3ea6a2154c","prototype/fc-session.js":"1cf92191a911","prototype/fc-widget.jsx":"02923d8e0aa3"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.Nocturne_noctur = window.Nocturne_noctur || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// prototype/fc-app.jsx
try { (() => {
/* FloatChat — app shell: nav, routing, session, shared selection state. */
const NAV = [{
  id: 'explore',
  label: 'Explore'
}, {
  id: 'assistant',
  label: 'AI Assistant'
}, {
  id: 'compare',
  label: 'Compare'
}, {
  id: 'analysis',
  label: 'Analysis'
}, {
  id: 'about',
  label: 'About'
}];
function AccountMenu() {
  const app = useApp();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const off = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, []);
  const s = app.session;
  if (!s.signedIn) {
    return /*#__PURE__*/React.createElement("div", {
      className: "fc-row fc-gap-2",
      ref: ref
    }, s.expired && /*#__PURE__*/React.createElement(Tag, {
      tone: "coral"
    }, "Session expired"), s.guest && /*#__PURE__*/React.createElement(Tag, {
      tone: "neutral"
    }, "Guest"), /*#__PURE__*/React.createElement(Btn, {
      size: "sm",
      onClick: () => {
        FCSession.clear();
        if (window.FCGate) FCGate();else window.location.href = 'Auth.html';
      }
    }, "Sign in"));
  }
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    className: "fc-acct"
  }, /*#__PURE__*/React.createElement("button", {
    className: "fc-acct-btn",
    onClick: () => setOpen(!open),
    "aria-expanded": open
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-acct-dot",
    "aria-hidden": "true"
  }), s.name || 'A. Harish'), open && /*#__PURE__*/React.createElement("div", {
    className: "fc-menu",
    role: "menu"
  }, /*#__PURE__*/React.createElement("div", {
    className: "fc-menu-id"
  }, /*#__PURE__*/React.createElement("strong", null, s.name || 'A. Harish'), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-sm fc-muted"
  }, s.email || 'a.harish@ocean.example')), /*#__PURE__*/React.createElement(DataRow, {
    k: "Account type",
    v: s.accountType === 'student' ? 'Student' : 'Scientist'
  }), /*#__PURE__*/React.createElement("div", {
    className: "fc-mt-3"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Display preference",
    hint: "Applies to profile and analysis panels."
  }, /*#__PURE__*/React.createElement(Seg, {
    ariaLabel: "Display preference",
    value: s.detail,
    onChange: v => app.setSession({
      ...s,
      detail: v
    }),
    options: [{
      value: 'simple',
      label: 'Simple'
    }, {
      value: 'detailed',
      label: 'Detailed'
    }]
  }))), /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2 fc-mt-3"
  }, /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    onClick: () => {
      FCSession.clear();
      if (window.FCGate) FCGate();else window.location.href = 'Auth.html';
    }
  }, "Sign out"), /*#__PURE__*/React.createElement(Btn, {
    variant: "ghost",
    size: "sm",
    onClick: () => {
      app.setSession({
        ...s,
        signedIn: false,
        expired: true
      });
      setOpen(false);
    }
  }, "Expire session"))));
}
function Nav() {
  const app = useApp();
  const active = {
    explore: ['explore', 'globe', 'depth', 'time', 'profile'],
    assistant: ['assistant'],
    compare: ['compare'],
    analysis: ['analysis'],
    about: ['about']
  };
  return /*#__PURE__*/React.createElement("header", {
    className: "fc-nav"
  }, /*#__PURE__*/React.createElement("button", {
    className: "fc-brand",
    onClick: () => app.go('home'),
    "aria-label": "FloatChat home"
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-brand-mark",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement("span", null)), "FloatChat"), /*#__PURE__*/React.createElement("nav", {
    className: "fc-navlinks",
    "aria-label": "Main"
  }, NAV.map(n => /*#__PURE__*/React.createElement("button", {
    key: n.id,
    className: 'fc-navlink' + (active[n.id].includes(app.screen) ? ' is-on' : ''),
    "aria-current": active[n.id].includes(app.screen) ? 'page' : undefined,
    onClick: () => app.go(n.id === 'explore' ? 'explore' : n.id)
  }, n.label))), /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-3"
  }, /*#__PURE__*/React.createElement(Mono, {
    className: "fc-sm fc-muted fc-hide-narrow"
  }, FC.floats.length, " floats \xB7 ", FC.profiles.length, " profiles"), /*#__PURE__*/React.createElement(AccountMenu, null)));
}
function ScreenHead({
  kicker,
  title,
  sub,
  states,
  state,
  setState,
  actions
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-screenhead"
  }, /*#__PURE__*/React.createElement("div", {
    className: "fc-screenhead-main"
  }, /*#__PURE__*/React.createElement(Kicker, null, kicker), /*#__PURE__*/React.createElement("h2", {
    className: "fc-screen-title"
  }, title), sub && /*#__PURE__*/React.createElement("p", {
    className: "fc-muted fc-sm fc-screen-sub"
  }, sub)), /*#__PURE__*/React.createElement("div", {
    className: "fc-screenhead-side"
  }, actions && /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2 fc-wrap"
  }, actions), states && /*#__PURE__*/React.createElement(StateChips, {
    states: states,
    value: state,
    onChange: setState
  })));
}
function App() {
  const [screen, setScreen] = React.useState('home');
  const [params, setParams] = React.useState({});
  const [history, setHistory] = React.useState([]);
  const [filters, setFilters] = React.useState(FC.defaultFilters);
  const [session, setSession] = React.useState(() => {
    const saved = window.FCSession ? FCSession.read() : null;
    return saved ? {
      signedIn: !!saved.signedIn,
      guest: !!saved.guest,
      accountType: saved.accountType || 'scientist',
      detail: saved.detail || 'detailed',
      expired: false,
      authError: false,
      name: saved.name,
      email: saved.email
    } : {
      signedIn: false,
      guest: false,
      accountType: 'scientist',
      detail: 'detailed',
      expired: false,
      authError: false
    };
  });
  const [sel, setSel] = React.useState(() => {
    const first = FC.profiles[Math.floor(FC.profiles.length * 0.31)];
    const second = FC.profiles[Math.floor(FC.profiles.length * 0.62)];
    return {
      profileId: first.profile_id,
      compareA: first.profile_id,
      compareB: second.profile_id,
      timeIndex: 6,
      variable: 'temp'
    };
  });
  const go = React.useCallback((next, p = {}) => {
    setScreen(cur => {
      setHistory(h => [...h.slice(-8), cur]);
      return next;
    });
    setParams(p);
    window.scrollTo({
      top: 0,
      behavior: prefersReduced() ? 'auto' : 'smooth'
    });
  }, []);
  const back = React.useCallback(() => {
    setHistory(h => {
      if (!h.length) return h;
      setScreen(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, []);
  const results = React.useMemo(() => FC.filter(filters), [filters]);
  React.useEffect(() => {
    window.FCGo = go;
  }, [go]);
  const ctx = {
    screen,
    go,
    back,
    params,
    filters,
    setFilters,
    session,
    setSession,
    sel,
    setSel,
    results
  };
  const Screen = (window.FCScreens || {})[screen] || (() => /*#__PURE__*/React.createElement("div", {
    className: "fc-shell"
  }, /*#__PURE__*/React.createElement(EmptyState, {
    title: "Screen not built",
    body: 'No screen registered for "' + screen + '".'
  })));
  return /*#__PURE__*/React.createElement(AppCtx.Provider, {
    value: ctx
  }, /*#__PURE__*/React.createElement("a", {
    className: "fc-skip",
    href: "#fc-main"
  }, "Skip to content"), screen !== 'home' && /*#__PURE__*/React.createElement(Nav, null), /*#__PURE__*/React.createElement("main", {
    id: "fc-main",
    className: screen === 'home' ? '' : 'fc-main'
  }, /*#__PURE__*/React.createElement(Screen, null)), window.FCWidget ? /*#__PURE__*/React.createElement(FCWidget, null) : null);
}
Object.assign(window, {
  Nav,
  ScreenHead,
  App,
  NAV
});
window.FCMount = () => ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "prototype/fc-app.jsx", error: String((e && e.message) || e) }); }

// prototype/fc-assistant.jsx
try { (() => {
/* FloatChat — AI assistant, analysis and about. The assistant only ever proposes a
   query against data that exists; it never answers beyond the loaded subset. */

const SUGGESTIONS = ['Show me salinity profiles in the Arabian Sea in January', 'How does temperature change with depth here?', 'Compare this profile with the climatology', 'What was the sea surface temperature in 1950?', 'Predict next month’s temperature'];
function makeReply(text, ctx) {
  const q = text.toLowerCase();
  const anchor = FC.byId[ctx.sel.profileId];
  if (/1950|1980|1999|last century|decade/.test(q)) {
    return {
      kind: 'nodata',
      body: 'The loaded subset covers January to March 2024 only. There are no observations before 2024-01-01 in this deployment, so this question cannot be answered from the available data.',
      meta: 'Coverage: ' + FC.coverage().date_range[0].slice(0, 10) + ' → ' + FC.coverage().date_range[1].slice(0, 10)
    };
  }
  if (/predict|forecast|will be|next month|future/.test(q)) {
    return {
      kind: 'unsupported',
      body: 'Forecasting is out of scope. FloatChat reads recorded Argo observations and compares them with climatology; it does not run or serve predictive models.',
      meta: 'Unsupported request'
    };
  }
  if (/salinity|temperature|profiles?/.test(q) && /(in|near|around)\s|sea|ocean|atlantic|pacific|indian/.test(q)) {
    const basin = /arabian|bengal/.test(q) ? 'arabian-sea' : /atlantic/.test(q) ? 'north-atlantic' : /pacific/.test(q) ? 'north-pacific' : /indian/.test(q) ? 'indian' : 'all';
    const filters = {
      ...FC.defaultFilters,
      basin,
      start: '2024-01-01',
      end: '2024-01-31',
      depthMin: 0,
      depthMax: 2000
    };
    const count = FC.filter(filters).length;
    return {
      kind: 'proposal',
      body: 'I can narrow the map to that. Here is the query I would run — check it before applying.',
      proposal: {
        summary: (basin === 'all' ? 'All basins' : BASIN_OPTS.find(b => b.value === basin).label) + ' · 2024-01-01 → 2024-01-31 · 0–2000 m',
        count,
        filters,
        details: [['Region', basin === 'all' ? 'global' : basin], ['Date window', '2024-01-01 → 2024-01-31 (UTC)'], ['Depth band', '0–2000 m, bracketed levels only'], ['Variables', /salinity/.test(q) ? 'PSAL (PSS-78)' : 'TEMP (ITS-90)'], ['QC', 'flags 1–2 retained'], ['Endpoint', 'GET /api/floats → filter client-side']]
      }
    };
  }
  if (/change.*depth|thermocline|mixed layer|how does/.test(q)) {
    const st = FC.stats(anchor.profile_id);
    return {
      kind: 'evidence',
      body: 'In ' + anchor.profile_id + ', recorded ' + fmt.utc(anchor.time) + ' at ' + fmt.coord(anchor.latitude, anchor.longitude) + ', temperature holds near ' + fmt.t(st.sst) + ' down to about ' + fmt.m(st.mldDepth) + '. Below that it falls steeply — the strongest gradient is ' + st.maxGrad.toFixed(3) + ' °C/m near ' + fmt.m(st.thermoDepth) + ' — and reaches ' + fmt.t(st.deepT) + ' at ' + fmt.m(st.deepDepth) + '.',
      evidence: [['Profile', anchor.profile_id], ['Levels used', st.levels + ' (QC 1–2)'], ['Missing levels', st.missingTemp + ' temperature, ' + st.missingPsal + ' salinity'], ['Depth source', 'derived from PRES_ADJUSTED ▲']],
      actions: true
    };
  }
  if (/climatolog|woa|compare/.test(q)) {
    const w = FC.woaMatch(anchor.profile_id);
    if (w.status !== 'Success') return {
      kind: 'nodata',
      body: 'A climatology comparison is not possible for ' + anchor.profile_id + ': ' + w.reason.toLowerCase() + '. No extrapolation is performed, so no value is reported.',
      meta: 'woa_match → Comparison unavailable'
    };
    return {
      kind: 'evidence',
      body: 'At ' + w.comparison_depth + ' m, ' + anchor.profile_id + ' interpolates to ' + w.argo_interpolated_value.toFixed(2) + ' °C against a WOA23 ' + w.baseline_period + ' reference of ' + w.woa_reference_value.toFixed(2) + ' °C — a difference of ' + (w.difference > 0 ? '+' : '') + w.difference.toFixed(2) + ' °C. One cast against a monthly average is not a trend.',
      evidence: [['Method', w.method], ['Month', String(w.month)], ['Spatial offset', w.spatial_offset.lat + '°, ' + w.spatial_offset.lon + '°']],
      actions: true
    };
  }
  if (q.trim().length < 12) {
    return {
      kind: 'clarify',
      body: 'I can help with that — which region and which time window? The loaded subset runs 2024-01-01 to 2024-03-31 across seven basins.',
      chips: ['Arabian Sea, January', 'North Atlantic, February', 'Southern Ocean, March']
    };
  }
  return {
    kind: 'explain',
    body: 'Argo floats drift at about 1 000 m, then rise to the surface every ten days, recording temperature and salinity as they climb. Each rise produces one profile — a single vertical column of measurements — which is what FloatChat reads. There are ' + FC.profiles.length + ' such profiles from ' + FC.floats.length + ' floats loaded here.'
  };
}
function ProposalCard({
  msg,
  stale,
  onApply,
  onDiscard
}) {
  const [open, setOpen] = React.useState(false);
  const p = msg.proposal;
  return /*#__PURE__*/React.createElement("div", {
    className: 'fc-proposal' + (stale ? ' is-stale' : '')
  }, /*#__PURE__*/React.createElement("header", {
    className: "fc-row fc-between fc-wrap fc-gap-2"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Kicker, null, "Query proposal"), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-sm"
  }, p.summary)), stale ? /*#__PURE__*/React.createElement(Tag, {
    tone: "coral"
  }, "Stale \u2014 filters changed") : /*#__PURE__*/React.createElement(Tag, {
    tone: "accent"
  }, p.count, " profiles")), open && /*#__PURE__*/React.createElement("div", {
    className: "fc-mt-3"
  }, p.details.map(([k, v]) => /*#__PURE__*/React.createElement(DataRow, {
    key: k,
    k: k,
    v: v
  }))), /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2 fc-mt-3 fc-wrap"
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    size: "sm",
    onClick: onApply,
    disabled: stale
  }, "Apply to map"), /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    onClick: onDiscard
  }, "Discard"), /*#__PURE__*/React.createElement("button", {
    className: "fc-link-sm",
    onClick: () => setOpen(!open),
    "aria-expanded": open
  }, open ? 'Hide details' : 'Expand details')), stale && /*#__PURE__*/React.createElement(Notice, {
    tone: "warn"
  }, "The filters changed after this proposal was written. Ask again to get a proposal against the current view."));
}
function AssistantScreen() {
  const app = useApp();
  const [state, setState] = React.useState('ok');
  const [input, setInput] = React.useState('');
  const [thinking, setThinking] = React.useState(false);
  const [msgs, setMsgs] = FCChat.useChat();
  const [staleAt, setStaleAt] = React.useState(null);
  const endRef = React.useRef(null);
  const filterKey = JSON.stringify(app.filters);
  const firstKey = React.useRef(filterKey);
  React.useEffect(() => {
    if (filterKey !== firstKey.current) setStaleAt(msgs.length);
  }, [filterKey]);
  React.useEffect(() => {
    if (endRef.current) endRef.current.parentElement.scrollTop = endRef.current.parentElement.scrollHeight;
  }, [msgs, thinking]);
  const send = text => {
    const t = (text ?? input).trim();
    if (!t) return;
    setInput('');
    setMsgs(m => [...m, {
      role: 'user',
      body: t
    }]);
    setThinking(true);
    setTimeout(() => {
      setThinking(false);
      setMsgs(m => [...m, {
        role: 'assistant',
        ...makeReply(t, app)
      }]);
    }, 780);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-shell"
  }, /*#__PURE__*/React.createElement(ScreenHead, {
    kicker: "AI Assistant",
    title: "Ask about the available data",
    sub: "Answers cite the profiles they came from. Nothing is inferred beyond the loaded subset.",
    states: ['ok'],
    state: state,
    setState: setState
  }), /*#__PURE__*/React.createElement("div", {
    className: "fc-chat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "fc-chat-log",
    role: "log",
    "aria-live": "polite"
  }, msgs.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: 'fc-msg fc-msg-' + (m.role === 'user' ? 'user' : 'bot')
  }, m.role === 'assistant' && m.kind && m.kind !== 'explain' && /*#__PURE__*/React.createElement(Kicker, null, {
    clarify: 'Clarification',
    proposal: 'Query proposal',
    unsupported: 'Unsupported request',
    nodata: 'No data available',
    evidence: 'Evidence-based answer'
  }[m.kind] || 'Explanation'), /*#__PURE__*/React.createElement("p", {
    className: "fc-msg-body"
  }, m.body), m.meta && /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, m.meta), m.chips && /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2 fc-wrap fc-mt-2"
  }, m.chips.map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    className: "fc-chip",
    onClick: () => send(c)
  }, c))), m.evidence && /*#__PURE__*/React.createElement("div", {
    className: "fc-evidence"
  }, m.evidence.map(([k, v]) => /*#__PURE__*/React.createElement(DataRow, {
    key: k,
    k: k,
    v: v
  }))), m.proposal && /*#__PURE__*/React.createElement(ProposalCard, {
    msg: m,
    stale: staleAt != null && i < staleAt,
    onApply: () => {
      app.setFilters(m.proposal.filters);
      app.go('explore');
    },
    onDiscard: () => setMsgs(arr => arr.filter((_, j) => j !== i))
  }), m.actions && /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2 fc-mt-2 fc-wrap"
  }, /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    onClick: () => app.go('explore')
  }, "View on map"), /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    onClick: () => app.go('compare')
  }, "Compare profiles"), /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    onClick: () => app.go('profile')
  }, "Open the profile")))), thinking && /*#__PURE__*/React.createElement("div", {
    className: "fc-msg fc-msg-bot"
  }, /*#__PURE__*/React.createElement(Loading, {
    label: "Reading the loaded profiles",
    lines: 2
  })), /*#__PURE__*/React.createElement("div", {
    ref: endRef
  })), /*#__PURE__*/React.createElement("div", {
    className: "fc-composer"
  }, /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2 fc-wrap fc-mb-2"
  }, SUGGESTIONS.slice(0, 3).map(s => /*#__PURE__*/React.createElement("button", {
    key: s,
    className: "fc-chip",
    onClick: () => send(s)
  }, s))), /*#__PURE__*/React.createElement("form", {
    className: "fc-row fc-gap-2",
    onSubmit: e => {
      e.preventDefault();
      send();
    }
  }, /*#__PURE__*/React.createElement("input", {
    className: "fc-input fc-grow",
    value: input,
    onChange: e => setInput(e.target.value),
    placeholder: "Ask about regions, depths, temperature or salinity\u2026",
    "aria-label": "Ask the assistant"
  }), /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    type: "submit",
    disabled: !input.trim()
  }, "Send")), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, "Context: ", app.results.length, " profiles match the current filters \xB7 ", app.filters.basin === 'all' ? 'global' : app.filters.basin))));
}
function AnalysisScreen() {
  const app = useApp();
  const [state, setState] = React.useState('ok');
  const sample = React.useMemo(() => app.results.slice(0, 60).map(p => FC.stats(p.profile_id)).filter(Boolean), [app.results]);
  const mean = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
  const woaRuns = React.useMemo(() => app.results.slice(0, 60).map(p => FC.woaMatch(p.profile_id)), [app.results]);
  const ok = woaRuns.filter(w => w.status === 'Success');
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-shell"
  }, /*#__PURE__*/React.createElement(ScreenHead, {
    kicker: "Analysis",
    title: "What can be computed from this subset",
    sub: "Every figure below is derived from the profiles currently in view.",
    states: ['ok'],
    state: state,
    setState: setState
  }), /*#__PURE__*/React.createElement("div", {
    className: "fc-grid-3"
  }, /*#__PURE__*/React.createElement(Panel, {
    kicker: "Available",
    title: "Temperature changes with depth"
  }, /*#__PURE__*/React.createElement(DataRow, {
    k: "Profiles analysed",
    v: sample.length
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Mean surface value",
    v: fmt.t(mean(sample.map(s => s.sst)))
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Mean mixed-layer base",
    v: fmt.m(mean(sample.map(s => s.mldDepth)))
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Mean strongest gradient",
    v: sample.length ? mean(sample.map(s => s.maxGrad)).toFixed(3) + ' °C/m' : '—'
  }), /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    className: "fc-mt-3",
    onClick: () => app.go('profile')
  }, "Open a profile")), /*#__PURE__*/React.createElement(Panel, {
    kicker: "Available",
    title: "Salinity changes with depth"
  }, /*#__PURE__*/React.createElement(DataRow, {
    k: "Profiles with salinity",
    v: sample.filter(s => s.salSurface != null).length
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Mean surface salinity",
    v: fmt.s(mean(sample.filter(s => s.salSurface != null).map(s => s.salSurface)))
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Levels dropped by QC",
    v: sample.reduce((s, x) => s + x.missingPsal, 0)
  }), /*#__PURE__*/React.createElement(Notice, {
    tone: "info"
  }, "Salinity gaps are left as gaps. Profiles with a subsurface minimum are not smoothed.")), /*#__PURE__*/React.createElement(Panel, {
    kicker: "Available",
    title: "WOA comparison"
  }, /*#__PURE__*/React.createElement(DataRow, {
    k: "Attempted",
    v: woaRuns.length
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Succeeded",
    v: ok.length
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Unavailable",
    v: woaRuns.length - ok.length
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Mean difference",
    v: ok.length ? (mean(ok.map(w => w.difference)) > 0 ? '+' : '') + mean(ok.map(w => w.difference)).toFixed(3) + ' °C' : '—'
  }), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, "Failures are reported, not hidden: the 20 m maximum-gap rule rejects profiles that would need extrapolation."))));
}
function AboutScreen() {
  const cov = FC.coverage();
  const sections = [['What FloatChat does', 'FloatChat reads a cached subset of Argo profiles and lets you explore them on a map, read them level by level, compare them, and ask questions in plain language. It answers from the loaded data only.'], ['What is ARGO?', 'ARGO is a global network of autonomous ocean-profiling floats that collect data from different depths of the ocean. These floats move through the water column and periodically record ocean conditions. The collected data helps monitor and understand changes in the ocean over time.'], ['What ARGO Measures & What Data Do We Get?', 'ARGO measures key ocean parameters such as temperature, salinity, pressure/depth, dissolved oxygen, pH, chlorophyll, and other biogeochemical properties. The data provides detailed depth-wise profiles, locations, and time-series measurements of ocean conditions.'], ['Coverage', cov.distinct_floats + ' floats and ' + cov.distinct_profiles + ' profiles, ' + cov.date_range[0].slice(0, 10) + ' to ' + cov.date_range[1].slice(0, 10) + ', 0–2000 m, across seven basins. Labelled throughout as cached historical observations.'], ['Temperature and salinity', 'Temperature is in °C on ITS-90. Salinity is practical salinity (PSS-78), which is dimensionless — shown as PSU by convention. Depth is derived from pressure and marked ▲ wherever it appears.']];
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-shell"
  }, /*#__PURE__*/React.createElement(ScreenHead, {
    kicker: "About",
    title: "What this platform reads, and what it will not claim"
  }), /*#__PURE__*/React.createElement("div", {
    className: "fc-about"
  }, sections.map(([t, body]) => /*#__PURE__*/React.createElement("section", {
    key: t,
    className: "fc-about-sec"
  }, /*#__PURE__*/React.createElement("h4", null, t), /*#__PURE__*/React.createElement("p", {
    className: "fc-muted"
  }, body)))));
}
window.FCScreens = Object.assign(window.FCScreens || {}, {
  assistant: AssistantScreen,
  analysis: AnalysisScreen,
  about: AboutScreen
});
Object.assign(window, {
  AssistantScreen,
  AnalysisScreen,
  AboutScreen,
  makeReply,
  ProposalCard
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "prototype/fc-assistant.jsx", error: String((e && e.message) || e) }); }

// prototype/fc-auth.jsx
try { (() => {
/* FloatChat — authentication gate. Login and Sign up are one screen with a mode
   toggle. Built from the design-system component classes (.card, .field, .input,
   .btn, .btn-primary, .btn-ghost) with the accent rebound to the app's ocean
   tokens, so the gate and the product read as one. Mock auth only. */

const NAME_FROM = email => {
  const local = (email.split('@')[0] || 'analyst').replace(/[._-]+/g, ' ');
  return local.split(' ').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') || 'Analyst';
};
function AuthScene() {
  const cv = React.useRef(null);
  const pointerRef = React.useRef({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    speed: 0,
    active: false
  });
  React.useEffect(() => {
    const el = cv.current?.parentElement;
    if (!el) return;
    let lx = 0,
      ly = 0,
      lt = performance.now();
    const move = e => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left,
        y = e.clientY - r.top;
      const now = performance.now(),
        dt = Math.max(now - lt, 8);
      const p = pointerRef.current;
      p.vx = (x - lx) * (16 / dt);
      p.vy = (y - ly) * (16 / dt);
      p.speed = Math.hypot(p.vx, p.vy);
      p.x = x;
      p.y = y;
      p.active = true;
      lx = x;
      ly = y;
      lt = now;
    };
    const leave = () => {
      pointerRef.current.active = false;
      pointerRef.current.speed = 0;
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, []);
  return /*#__PURE__*/React.createElement(OceanScene, {
    depth: 0.34,
    motion: true,
    pointerRef: pointerRef
  });
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
  const matchOk = !signup || pw2.length > 0 && pw === pw2;
  const termsOk = !signup || terms;
  const ready = emailOk && pwOk && matchOk && termsOk && !busy;
  const submit = e => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    setTimeout(() => {
      FCSession.write({
        signedIn: true,
        guest: false,
        accountType: 'scientist',
        detail: 'detailed',
        email: email.trim(),
        name: NAME_FROM(email.trim()),
        remember,
        at: new Date().toISOString()
      });
      if (window.FCAuthDone) FCAuthDone();else window.location.href = 'FloatChat.html';
    }, 900);
  };
  const guest = () => {
    FCSession.write({
      signedIn: false,
      guest: true,
      accountType: 'scientist',
      detail: 'detailed',
      email: null,
      name: 'Guest',
      remember: false,
      at: new Date().toISOString()
    });
    if (window.FCAuthDone) FCAuthDone();else window.location.href = 'FloatChat.html';
  };
  const switchMode = () => {
    setMode(signup ? 'login' : 'signup');
    setError(null);
    setPw2('');
    setTerms(false);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "auth-card card elev-lg"
  }, /*#__PURE__*/React.createElement("header", {
    className: "auth-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "auth-brand"
  }, /*#__PURE__*/React.createElement("span", {
    className: "auth-mark",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement("span", null)), "FloatChat"), /*#__PURE__*/React.createElement("h1", {
    className: "auth-title"
  }, signup ? 'Create your account' : 'Sign in to FloatChat'), /*#__PURE__*/React.createElement("p", {
    className: "auth-lede"
  }, signup ? 'Ask questions of the Argo array and keep your query history across sessions.' : 'Explore the Argo observations that are loaded, and ask the assistant about them.')), /*#__PURE__*/React.createElement("div", {
    className: "auth-modes",
    role: "tablist",
    "aria-label": "Authentication mode"
  }, /*#__PURE__*/React.createElement("button", {
    role: "tab",
    "aria-selected": !signup,
    className: 'auth-mode' + (!signup ? ' is-on' : ''),
    onClick: () => setMode('login')
  }, "Log in"), /*#__PURE__*/React.createElement("button", {
    role: "tab",
    "aria-selected": signup,
    className: 'auth-mode' + (signup ? ' is-on' : ''),
    onClick: () => setMode('signup')
  }, "Sign up")), /*#__PURE__*/React.createElement("form", {
    onSubmit: submit,
    noValidate: true
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    htmlFor: "auth-email"
  }, "Email"), /*#__PURE__*/React.createElement("input", {
    id: "auth-email",
    className: "input",
    type: "email",
    autoComplete: "email",
    value: email,
    onChange: e => setEmail(e.target.value),
    placeholder: "you@institute.org",
    "aria-describedby": "auth-email-hint"
  }), /*#__PURE__*/React.createElement("p", {
    id: "auth-email-hint",
    className: "auth-hint"
  }, email && !emailOk ? 'Enter a complete email address.' : '\u00a0')), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    htmlFor: "auth-pw"
  }, "Password"), /*#__PURE__*/React.createElement("input", {
    id: "auth-pw",
    className: "input",
    type: "password",
    autoComplete: signup ? 'new-password' : 'current-password',
    value: pw,
    onChange: e => setPw(e.target.value),
    "aria-describedby": "auth-pw-hint"
  }), /*#__PURE__*/React.createElement("p", {
    id: "auth-pw-hint",
    className: "auth-hint"
  }, pw && !pwOk ? 'At least 8 characters.' : '\u00a0')), signup && /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    htmlFor: "auth-pw2"
  }, "Confirm password"), /*#__PURE__*/React.createElement("input", {
    id: "auth-pw2",
    className: "input",
    type: "password",
    autoComplete: "new-password",
    value: pw2,
    onChange: e => setPw2(e.target.value),
    "aria-describedby": "auth-pw2-hint"
  }), /*#__PURE__*/React.createElement("p", {
    id: "auth-pw2-hint",
    className: "auth-hint"
  }, pw2 && pw !== pw2 ? 'Passwords do not match.' : '\u00a0')), /*#__PURE__*/React.createElement("div", {
    className: "auth-row"
  }, signup ? /*#__PURE__*/React.createElement("label", {
    className: "auth-check"
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: terms,
    onChange: e => setTerms(e.target.checked)
  }), /*#__PURE__*/React.createElement("span", null, "I accept the ", /*#__PURE__*/React.createElement("a", {
    href: "#terms"
  }, "terms"), " and ", /*#__PURE__*/React.createElement("a", {
    href: "#privacy"
  }, "privacy policy"))) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("label", {
    className: "auth-check"
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: remember,
    onChange: e => setRemember(e.target.checked)
  }), /*#__PURE__*/React.createElement("span", null, "Remember me")), /*#__PURE__*/React.createElement("a", {
    className: "auth-forgot",
    href: "#reset"
  }, "Forgot password?"))), error && /*#__PURE__*/React.createElement("p", {
    className: "auth-error",
    role: "alert"
  }, error), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    className: "btn btn-primary btn-block",
    disabled: !ready
  }, busy ? /*#__PURE__*/React.createElement("span", {
    className: "auth-busy"
  }, /*#__PURE__*/React.createElement("span", {
    className: "auth-spinner",
    "aria-hidden": "true"
  }), signup ? 'Creating account…' : 'Signing in…') : signup ? 'Create account' : 'Log in'), /*#__PURE__*/React.createElement("p", {
    className: "auth-switch"
  }, signup ? 'Already have an account?' : 'New to FloatChat?', /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn btn-ghost",
    onClick: switchMode
  }, signup ? 'Log in' : 'Create an account'))), /*#__PURE__*/React.createElement("footer", {
    className: "auth-foot"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn btn-ghost",
    onClick: guest
  }, "Continue as guest"), /*#__PURE__*/React.createElement("span", {
    className: "auth-note"
  }, "Guests can explore and read profiles. The assistant needs an account.")));
}
function AuthPage() {
  return /*#__PURE__*/React.createElement("div", {
    className: "auth-stage"
  }, /*#__PURE__*/React.createElement(AuthScene, null), /*#__PURE__*/React.createElement("div", {
    className: "auth-centre"
  }, /*#__PURE__*/React.createElement(AuthCard, null), /*#__PURE__*/React.createElement("p", {
    className: "auth-attrib"
  }, "Argo data are collected and made freely available by the International Argo Program.")));
}
Object.assign(window, {
  AuthPage,
  AuthCard,
  AuthScene
});
window.FCAuthMount = () => ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(AuthPage, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "prototype/fc-auth.jsx", error: String((e && e.message) || e) }); }

// prototype/fc-chat-store.js
try { (() => {
/* Shared assistant transcript. One conversation behind both the full AI Assistant
   screen and the floating widget, so neither surface owns the history. */
(() => {
  const INITIAL = [{
    role: 'assistant',
    kind: 'explain',
    body: 'Ask about the Argo observations that are loaded — regions, depths, how temperature and salinity change, or how one profile sits against climatology. I will propose a query before changing anything on the map.'
  }];
  let msgs = INITIAL;
  let unread = 0;
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn());
  const store = {
    get: () => msgs,
    set(next) {
      msgs = typeof next === 'function' ? next(msgs) : next;
      emit();
    },
    getUnread: () => unread,
    markUnread() {
      unread += 1;
      emit();
    },
    clearUnread() {
      if (unread) {
        unread = 0;
        emit();
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    useChat() {
      const [, force] = React.useReducer(n => n + 1, 0);
      React.useEffect(() => store.subscribe(force), []);
      return [msgs, store.set];
    },
    useUnread() {
      const [, force] = React.useReducer(n => n + 1, 0);
      React.useEffect(() => store.subscribe(force), []);
      return unread;
    }
  };
  window.FCChat = store;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "prototype/fc-chat-store.js", error: String((e && e.message) || e) }); }

// prototype/fc-core.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* FloatChat — data model + shared UI. Data model mirrors the FastAPI schema in
   AnirudhHarish07/FloatChat (api/main.py): platform, cycle, direction, data_mode,
   profile_id, time, lat/lon, depth_min/max, temp_count, psal_count, observations
   with pres/depth/temp/psal/source_field, and woa_match's 20 m max-gap rule. */

const rngFrom = seed => {
  let a = seed >>> 0;
  return () => {
    a = a + 0x6D2B79F5 >>> 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
};
const wrapLon = x => ((x + 180) % 360 + 360) % 360 - 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const BASINS = [{
  id: 'north-atlantic',
  name: 'North Atlantic',
  lon: [-62, -12],
  lat: [12, 58],
  sal: 36.3,
  w: 16
}, {
  id: 'south-atlantic',
  name: 'South Atlantic',
  lon: [-38, 8],
  lat: [-46, -4],
  sal: 35.4,
  w: 10
}, {
  id: 'north-pacific',
  name: 'North Pacific',
  lon: [148, 232],
  lat: [8, 50],
  sal: 34.4,
  w: 20
}, {
  id: 'south-pacific',
  name: 'South Pacific',
  lon: [-168, -82],
  lat: [-52, -6],
  sal: 35.0,
  w: 16
}, {
  id: 'indian',
  name: 'Indian Ocean',
  lon: [52, 108],
  lat: [-42, 14],
  sal: 35.1,
  w: 16
}, {
  id: 'southern',
  name: 'Southern Ocean',
  lon: [-178, 178],
  lat: [-64, -46],
  sal: 34.2,
  w: 12
}, {
  id: 'arabian-sea',
  name: 'Arabian Sea & Bay of Bengal',
  lon: [56, 94],
  lat: [4, 22],
  sal: 35.6,
  w: 8
}];
const LEVELS = (() => {
  const out = [];
  for (let d = 0; d <= 200; d += 10) out.push(d);
  for (let d = 225; d <= 500; d += 25) out.push(d);
  for (let d = 550; d <= 1000; d += 50) out.push(d);
  for (let d = 1100; d <= 2000; d += 100) out.push(d);
  return out;
})();
function profileShape(lat, lon, basinSal, monthFrac, r) {
  const absLat = Math.abs(lat);
  const seasonal = Math.cos((monthFrac * 2 - (lat < 0 ? 1 : 0)) * Math.PI) * (absLat > 20 ? 2.4 : 0.7);
  const sst = clamp(-1.8 + 30.5 / (1 + Math.exp((absLat - 38) / 13)) + seasonal + (r() - 0.5) * 1.1, -1.9, 31.2);
  const mld = clamp(18 + absLat * 1.5 + r() * 40, 15, 160);
  const thermoZ = mld + 60 + r() * 140;
  const thermoW = 90 + r() * 140;
  const deepT = clamp(2.1 + (absLat < 25 ? 0.9 : 0) + (r() - 0.5) * 0.6, 1.1, 3.6);
  const surfSal = basinSal + (r() - 0.5) * 0.5 - (absLat < 10 ? 0.5 : 0);
  const salMinZ = 500 + r() * 400;
  return {
    sst,
    mld,
    thermoZ,
    thermoW,
    deepT,
    surfSal,
    salMinZ,
    deepSal: 34.68 + (r() - 0.5) * 0.09
  };
}
function tempAt(s, d) {
  if (d <= s.mld) return s.sst - d / Math.max(s.mld, 1) * 0.35;
  const t = 1 / (1 + Math.exp((d - s.thermoZ) / (s.thermoW * 0.34)));
  return s.deepT + (s.sst - 0.35 - s.deepT) * t;
}
function psalAt(s, d) {
  if (d <= s.mld) return s.surfSal;
  if (d < s.salMinZ) {
    const t = (d - s.mld) / (s.salMinZ - s.mld);
    return lerp(s.surfSal, Math.min(s.surfSal, s.deepSal) - 0.22, Math.pow(t, 0.8));
  }
  const t = clamp((d - s.salMinZ) / 900, 0, 1);
  return lerp(Math.min(s.surfSal, s.deepSal) - 0.22, s.deepSal, t);
}
const FC = {
  floats: [],
  profiles: [],
  byId: {},
  timeSteps: [],
  land: null,
  obsCache: {},
  init(land) {
    this.land = land;
    const r = rngFrom(20240110);
    const onLand = (lon, lat) => land && window.d3 ? d3.geoContains(land, [lon, lat]) : false;
    const floats = [];
    let wmo = 5903301;
    for (const b of BASINS) {
      for (let i = 0; i < b.w; i++) {
        let lon = 0,
          lat = 0,
          ok = false;
        for (let tries = 0; tries < 24 && !ok; tries++) {
          lon = wrapLon(lerp(b.lon[0], b.lon[1], r()));
          lat = lerp(b.lat[0], b.lat[1], r());
          ok = !onLand(lon, lat);
        }
        if (!ok) continue;
        wmo += 1 + Math.floor(r() * 7);
        const nProf = 4 + Math.floor(r() * 6);
        const f = {
          platform: String(wmo),
          basin: b.id,
          basinName: b.name,
          profiles: []
        };
        let plon = lon,
          plat = lat;
        let heading = r() * 6.283;
        for (let c = 0; c < nProf; c++) {
          const cycle = 118 + c;
          const day = 4 + c * 10 + Math.floor(r() * 4);
          const time = new Date(Date.UTC(2024, 0, day, Math.floor(r() * 24), Math.floor(r() * 60)));
          heading += (r() - 0.5) * 2.4;
          const stepDeg = 0.35 + r() * 0.9;
          const nlon = wrapLon(plon + Math.cos(heading) * stepDeg),
            nlat = clamp(plat + Math.sin(heading) * stepDeg * 0.7, -66, 62);
          if (!onLand(nlon, nlat)) {
            plon = nlon;
            plat = nlat;
          }
          const deep = r() > 0.22 ? r() > 0.5 ? 2000 : 1500 : 1000;
          const shallowStart = r() > 0.9 ? 40 : 0;
          const mode = r() > 0.62 ? 'D' : r() > 0.3 ? 'A' : 'R';
          const shape = profileShape(plat, plon, b.sal, (time.getUTCMonth() + 0.5) / 12, r);
          const gapSeed = r();
          const p = {
            profile_id: f.platform + '_' + cycle,
            platform: f.platform,
            cycle,
            direction: 'A',
            data_mode: mode,
            time: time.toISOString(),
            latitude: +plat.toFixed(3),
            longitude: +plon.toFixed(3),
            basin: b.id,
            basinName: b.name,
            depth_min: shallowStart,
            depth_max: deep,
            shape,
            gapSeed,
            psalMissing: r() > 0.86,
            seed: Math.floor(r() * 1e9)
          };
          const levels = LEVELS.filter(d => d >= shallowStart && d <= deep);
          p.temp_count = levels.length - (r() > 0.7 ? 2 : 0);
          p.psal_count = p.psalMissing ? Math.floor(levels.length * 0.55) : levels.length - (r() > 0.8 ? 3 : 0);
          f.profiles.push(p);
        }
        if (f.profiles.length) floats.push(f);
      }
    }
    this.floats = floats;
    this.profiles = floats.flatMap(f => f.profiles).sort((a, b2) => a.time.localeCompare(b2.time));
    this.profiles.forEach(p => {
      this.byId[p.profile_id] = p;
    });
    const days = [...new Set(this.profiles.map(p => p.time.slice(0, 10)))].sort();
    this.timeSteps = days;
    return this;
  },
  observations(profile_id) {
    if (this.obsCache[profile_id]) return this.obsCache[profile_id];
    const p = this.byId[profile_id];
    if (!p) return [];
    const r = rngFrom(p.seed);
    const s = p.shape;
    const out = LEVELS.filter(d => d >= p.depth_min && d <= p.depth_max).map(d => {
      const noise = (r() - 0.5) * (d < 300 ? 0.16 : 0.05);
      let temp = +(tempAt(s, d) + noise).toFixed(3);
      let psal = +(psalAt(s, d) + (r() - 0.5) * 0.02).toFixed(3);
      let temp_qc = '1',
        psal_qc = '1';
      if (r() > 0.985) {
        temp = null;
        temp_qc = '4';
      }
      if (p.psalMissing && d > s.salMinZ * 0.8) {
        psal = null;
        psal_qc = '9';
      } else if (r() > 0.99) {
        psal = null;
        psal_qc = '4';
      } else if (r() > 0.96) psal_qc = '2';
      return {
        pres: +(d * 1.0053).toFixed(1),
        depth: d,
        temp,
        psal,
        temp_qc,
        psal_qc,
        source_field: 'PRES_ADJUSTED',
        derived_depth: true
      };
    });
    // one deliberate vertical gap in the mid-water column on some profiles
    if (p.gapSeed > 0.72) {
      const start = out.findIndex(o => o.depth >= 60 + Math.floor(p.gapSeed * 120));
      if (start > 0) out.splice(start, p.gapSeed > 0.9 ? 4 : 2);
    }
    // surface sensor dropout: the shallow levels are absent, so a WOA standard
    // depth can only be bracketed across a gap wider than the 20 m rule allows
    if (p.gapSeed < 0.14) {
      for (let i = out.length - 1; i >= 0; i--) if (out[i].depth > 5 && out[i].depth < 60) out.splice(i, 1);
    }
    this.obsCache[profile_id] = out;
    return out;
  },
  stats(profile_id) {
    const obs = this.observations(profile_id).filter(o => o.temp != null);
    if (!obs.length) return null;
    const sst = obs[0].temp;
    let mldDepth = obs[0].depth;
    for (const o of obs) {
      if (Math.abs(o.temp - sst) < 0.2) mldDepth = o.depth;else break;
    }
    let maxGrad = 0,
      thermoDepth = null;
    for (let i = 1; i < obs.length; i++) {
      const dz = obs[i].depth - obs[i - 1].depth;
      if (!dz) continue;
      const g = (obs[i - 1].temp - obs[i].temp) / dz;
      if (g > maxGrad) {
        maxGrad = g;
        thermoDepth = (obs[i].depth + obs[i - 1].depth) / 2;
      }
    }
    const psals = this.observations(profile_id).filter(o => o.psal != null);
    return {
      sst,
      mldDepth,
      thermoDepth,
      maxGrad,
      deepT: obs[obs.length - 1].temp,
      deepDepth: obs[obs.length - 1].depth,
      salSurface: psals.length ? psals[0].psal : null,
      salRange: psals.length ? [Math.min(...psals.map(o => o.psal)), Math.max(...psals.map(o => o.psal))] : null,
      levels: obs.length,
      missingTemp: this.observations(profile_id).filter(o => o.temp == null).length,
      missingPsal: this.observations(profile_id).filter(o => o.psal == null).length
    };
  },
  /* Mirrors /api/woa_match: bracketed WOA standard depth, linear interpolation of
     Argo within a 20 m max gap, nearest-neighbour spatial lookup, else unavailable. */
  woaMatch(profile_id) {
    const p = this.byId[profile_id];
    const obs = this.observations(profile_id).filter(o => o.temp != null);
    if (!obs.length) return {
      status: 'Comparison unavailable',
      reason: 'No valid temperature data'
    };
    const woaDepths = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
    const valid = woaDepths.filter(d => d >= obs[0].depth && d <= obs[obs.length - 1].depth);
    if (!valid.length) return {
      status: 'Comparison unavailable',
      reason: 'No bracketed standard depth (no extrapolation allowed)'
    };
    const target = valid[0];
    let i = obs.findIndex(o => o.depth >= target);
    if (i <= 0) i = 1;
    const d1 = obs[i - 1].depth,
      d2 = obs[i].depth;
    if (d2 - d1 > 20) return {
      status: 'Comparison unavailable',
      reason: 'Gap ' + (d2 - d1).toFixed(1) + 'm exceeds max configured gap 20.0m'
    };
    const t = (target - d1) / (d2 - d1);
    const argo = lerp(obs[i - 1].temp, obs[i].temp, t);
    const r = rngFrom(p.seed + 77);
    const month = +p.time.slice(5, 7);
    const woa = argo - (r() - 0.45) * 1.8;
    return {
      status: 'Success',
      argo_interpolated_value: +argo.toFixed(3),
      woa_reference_value: +woa.toFixed(3),
      difference: +(argo - woa).toFixed(3),
      units: 'degrees_celsius',
      comparison_depth: target,
      month,
      baseline_period: '1991-2020',
      method: 'Linear interpolation of Argo within 20m max gap; nearest-neighbor spatial WOA lookup',
      spatial_offset: {
        lat: +(Math.round(p.latitude) - p.latitude).toFixed(3),
        lon: +(Math.round(p.longitude) - p.longitude).toFixed(3)
      }
    };
  },
  coverage() {
    const lats = this.profiles.map(p => p.latitude),
      lons = this.profiles.map(p => p.longitude);
    return {
      dataset: 'ERDDAP GDAC Argo — global subset',
      label: 'cached historical observations',
      distinct_floats: this.floats.length,
      distinct_profiles: this.profiles.length,
      date_range: [this.profiles[0].time, this.profiles[this.profiles.length - 1].time],
      bounding_box: {
        west: Math.min(...lons),
        east: Math.max(...lons),
        south: Math.min(...lats),
        north: Math.max(...lats)
      }
    };
  },
  defaultFilters: {
    basin: 'all',
    start: '2024-01-01',
    end: '2024-03-31',
    depthMin: 0,
    depthMax: 2000,
    tempMin: -2,
    tempMax: 32,
    salMin: 33,
    salMax: 37,
    floatIds: '',
    dataMode: 'all',
    qcStrict: true
  },
  filter(f) {
    return this.profiles.filter(p => {
      if (f.basin !== 'all' && p.basin !== f.basin) return false;
      const d = p.time.slice(0, 10);
      if (d < f.start || d > f.end) return false;
      if (p.depth_max < f.depthMin || p.depth_min > f.depthMax) return false;
      if (f.dataMode !== 'all' && p.data_mode !== f.dataMode) return false;
      if (f.floatIds.trim()) {
        const ids = f.floatIds.split(/[,\s]+/).filter(Boolean);
        if (!ids.some(id => p.platform.includes(id))) return false;
      }
      if (p.shape.sst < f.tempMin || p.shape.sst > f.tempMax) return false;
      if (p.shape.surfSal < f.salMin || p.shape.surfSal > f.salMax) return false;
      return true;
    });
  }
};

/* ── formatting + scales ─────────────────────────────────────────────── */
const fmt = {
  utc: iso => iso.slice(0, 10) + ' ' + iso.slice(11, 16) + ' UTC',
  day: iso => new Date(iso).toUTCString().slice(5, 16),
  coord: (lat, lon) => Math.abs(lat).toFixed(2) + '° ' + (lat >= 0 ? 'N' : 'S') + ', ' + Math.abs(lon).toFixed(2) + '° ' + (lon >= 0 ? 'E' : 'W'),
  mode: m => ({
    R: 'Real-time',
    A: 'Adjusted',
    D: 'Delayed-mode'
  })[m] || m,
  t: v => v == null ? '—' : v.toFixed(2) + ' °C',
  s: v => v == null ? '—' : v.toFixed(3) + ' PSU',
  m: v => v == null ? '—' : Math.round(v) + ' m'
};
const TEMP_STOPS = [[-2, '#5a93b0'], [4, '#2f8f97'], [10, '#3fae9f'], [17, '#8bcbc4'], [23, '#e8cf9a'], [28, '#d56d50'], [32, '#b8452f']];
const SAL_STOPS = [[33, '#5a93b0'], [34.2, '#2b8a90'], [34.9, '#63b6b1'], [35.6, '#cfd9b6'], [36.6, '#c98a5c'], [37.2, '#a8563a']];
function rampColor(stops, v) {
  if (v == null || Number.isNaN(v)) return '#3d4d54';
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1],
        [b, cb] = stops[i];
      const t = (v - a) / (b - a);
      const pa = d3.color(ca),
        pb = d3.color(cb);
      return d3.interpolateRgb(pa, pb)(t);
    }
  }
  return stops[stops.length - 1][1];
}
const scale = {
  temp: v => rampColor(TEMP_STOPS, v),
  psal: v => rampColor(SAL_STOPS, v)
};

/* ── app context ─────────────────────────────────────────────────────── */
const AppCtx = React.createContext(null);
const useApp = () => React.useContext(AppCtx);

/* ── shared UI atoms ─────────────────────────────────────────────────── */
function Btn({
  variant = 'secondary',
  size,
  children,
  ...rest
}) {
  const cls = ['fc-btn', 'fc-btn-' + variant, size === 'sm' ? 'fc-btn-sm' : '', rest.className || ''].join(' ').trim();
  return /*#__PURE__*/React.createElement("button", _extends({}, rest, {
    className: cls
  }), children);
}
function IconBtn({
  label,
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({}, rest, {
    "aria-label": label,
    title: label,
    className: 'fc-btn fc-btn-icon ' + (rest.className || '')
  }), children);
}
function Tag({
  tone = 'neutral',
  children
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: 'fc-tag fc-tag-' + tone
  }, children);
}
function Kicker({
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-kicker"
  }, children);
}
function Mono({
  children,
  className = ''
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: 'fc-mono ' + className
  }, children);
}
function Panel({
  title,
  kicker,
  actions,
  children,
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("section", _extends({
    className: 'fc-panel ' + className
  }, rest), (title || actions) && /*#__PURE__*/React.createElement("header", {
    className: "fc-panel-head"
  }, /*#__PURE__*/React.createElement("div", null, kicker && /*#__PURE__*/React.createElement(Kicker, null, kicker), title && /*#__PURE__*/React.createElement("h4", {
    className: "fc-panel-title"
  }, title)), actions && /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2"
  }, actions)), children);
}

/* State chips — per-screen state matrix switches, in the screen's own header. */
const STATE_LABELS = {
  ok: 'Live',
  loading: 'Loading',
  empty: 'Empty',
  error: 'Request failed',
  fallback: 'Historical fallback',
  nowebgl: 'No WebGL',
  signedout: 'Signed out',
  stale: 'Stale proposal',
  invalid: 'Validation errors',
  planned: 'Planned feature'
};
function StateChips({
  states,
  value,
  onChange
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-chips",
    role: "group",
    "aria-label": "Screen state"
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-chips-label"
  }, "State"), states.map(s => /*#__PURE__*/React.createElement("button", {
    key: s,
    className: 'fc-chip' + (value === s ? ' is-on' : ''),
    "aria-pressed": value === s,
    onClick: () => onChange(s)
  }, STATE_LABELS[s] || s)));
}
function Loading({
  label = 'Loading observations',
  lines = 3
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-state",
    role: "status",
    "aria-live": "polite"
  }, /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-3"
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-spinner",
    "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement("span", {
    className: "fc-mono fc-sm"
  }, label, "\u2026")), /*#__PURE__*/React.createElement("div", {
    className: "fc-skel-wrap"
  }, Array.from({
    length: lines
  }).map((_, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "fc-skel",
    style: {
      width: [88, 64, 74, 52][i % 4] + '%'
    }
  }))));
}
function EmptyState({
  title = 'No observations match',
  body,
  action
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-state"
  }, /*#__PURE__*/React.createElement("h5", {
    className: "fc-state-title"
  }, title), /*#__PURE__*/React.createElement("p", {
    className: "fc-muted fc-sm"
  }, body), action);
}
function ErrorState({
  title = 'Request failed',
  body,
  onRetry,
  detail
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-state fc-state-error",
    role: "alert"
  }, /*#__PURE__*/React.createElement("h5", {
    className: "fc-state-title"
  }, title), /*#__PURE__*/React.createElement("p", {
    className: "fc-muted fc-sm"
  }, body), detail && /*#__PURE__*/React.createElement("pre", {
    className: "fc-pre"
  }, detail), onRetry && /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    onClick: onRetry
  }, "Retry request"));
}
function Notice({
  tone = 'info',
  children
}) {
  return /*#__PURE__*/React.createElement("p", {
    className: 'fc-notice fc-notice-' + tone
  }, children);
}
function Field({
  label,
  hint,
  error,
  children
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: "fc-field"
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-field-label"
  }, label), children, error ? /*#__PURE__*/React.createElement("span", {
    className: "fc-field-error"
  }, error) : hint ? /*#__PURE__*/React.createElement("span", {
    className: "fc-field-hint"
  }, hint) : null);
}
function Select({
  value,
  onChange,
  options,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("select", _extends({
    className: "fc-input",
    value: value,
    onChange: e => onChange(e.target.value)
  }, rest), options.map(o => /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, o.label)));
}
function Seg({
  value,
  onChange,
  options,
  ariaLabel
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-seg",
    role: "tablist",
    "aria-label": ariaLabel
  }, options.map(o => /*#__PURE__*/React.createElement("button", {
    key: o.value,
    role: "tab",
    "aria-selected": value === o.value,
    className: 'fc-seg-opt' + (value === o.value ? ' is-on' : ''),
    onClick: () => onChange(o.value)
  }, o.label)));
}
function Accordion({
  title,
  children,
  open: initial = false
}) {
  const [open, setOpen] = React.useState(initial);
  return /*#__PURE__*/React.createElement("div", {
    className: 'fc-acc' + (open ? ' is-open' : '')
  }, /*#__PURE__*/React.createElement("button", {
    className: "fc-acc-head",
    "aria-expanded": open,
    onClick: () => setOpen(!open)
  }, /*#__PURE__*/React.createElement("span", null, title), /*#__PURE__*/React.createElement("span", {
    className: "fc-acc-mark",
    "aria-hidden": "true"
  }, open ? '–' : '+')), /*#__PURE__*/React.createElement("div", {
    className: "fc-acc-body",
    hidden: !open
  }, children));
}
function DataRow({
  k,
  v,
  note
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-datarow"
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-muted fc-sm"
  }, k), /*#__PURE__*/React.createElement("span", {
    className: "fc-mono fc-sm"
  }, v, note && /*#__PURE__*/React.createElement("em", {
    className: "fc-derived",
    title: note
  }, " \u25B2")));
}

/* PNG export of an inline SVG chart */
function exportSvgPng(svg, filename) {
  if (!svg) return;
  const clone = svg.cloneNode(true);
  const w = svg.viewBox.baseVal.width || svg.clientWidth,
    h = svg.viewBox.baseVal.height || svg.clientHeight;
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = w * 2;
    c.height = h * 2;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0b1e26';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = filename;
    a.click();
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
}
function useElementWidth(fallback = 720) {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(fallback);
  React.useEffect(() => {
    if (!ref.current || !window.ResizeObserver) return;
    const ro = new ResizeObserver(entries => {
      const cw = entries[0].contentRect.width;
      if (cw > 40) setW(cw);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
const prefersReduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
Object.assign(window, {
  FC,
  fmt,
  scale,
  TEMP_STOPS,
  SAL_STOPS,
  AppCtx,
  useApp,
  Btn,
  IconBtn,
  Tag,
  Kicker,
  Mono,
  Panel,
  StateChips,
  Loading,
  EmptyState,
  ErrorState,
  Notice,
  Field,
  Select,
  Seg,
  Accordion,
  DataRow,
  exportSvgPng,
  useElementWidth,
  prefersReduced,
  clamp,
  lerp,
  wrapLon,
  rngFrom
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "prototype/fc-core.jsx", error: String((e && e.message) || e) }); }

// prototype/fc-depth.jsx
try { (() => {
/* FloatChat — depth view (geographic arrangement of vertical profile columns)
   and time exploration (stepping through recorded observation times). */

const ISO = {
  kx: 0.86,
  ky: 0.5
};
function isoPoint(lon, lat, lon0, lat0, s) {
  const dx = wrapLon(lon - lon0),
    dy = lat - lat0;
  return [(dx - dy) * s * ISO.kx, (dx + dy) * s * ISO.ky];
}
function DepthScreen() {
  const app = useApp();
  const [state, setState] = React.useState('ok');
  const [variable, setVariable] = React.useState('temp');
  const [range, setRange] = React.useState([0, 1000]);
  const [sample, setSample] = React.useState(null);
  const [ref, w] = useElementWidth(1000);
  const width = clamp(w, 320, 1400);
  const height = 520;
  const anchor = FC.byId[app.sel.profileId] || FC.profiles[0];
  const pool = React.useMemo(() => {
    const src = app.results.length ? app.results : FC.profiles;
    return src.map(p => ({
      p,
      d: Math.hypot(wrapLon(p.longitude - anchor.longitude), p.latitude - anchor.latitude)
    })).sort((a, b) => a.d - b.d).slice(0, 12).map(x => x.p);
  }, [app.results, anchor.profile_id]);
  const spread = Math.max(2, ...pool.map(p => Math.abs(wrapLon(p.longitude - anchor.longitude)) + Math.abs(p.latitude - anchor.latitude)));
  const s = Math.min(width * 0.36, 260) / spread;
  const depthK = height * 0.52 / Math.max(range[1] - range[0], 50);
  const cx = width / 2,
    cy = height * 0.26;
  const columns = React.useMemo(() => pool.map(p => {
    const [ix, iy] = isoPoint(p.longitude, p.latitude, anchor.longitude, anchor.latitude, s);
    const obs = FC.observations(p.profile_id).filter(o => o.depth >= range[0] && o.depth <= range[1]);
    const step = Math.max(1, Math.round(obs.length / 22));
    const binned = obs.filter((_, i) => i % step === 0);
    return {
      p,
      x: cx + ix,
      y: cy + iy,
      obs: binned
    };
  }).sort((a, b) => a.y - b.y), [pool, s, range, cx, cy]);
  const yOf = depth => (depth - range[0]) * depthK;
  const exaggeration = height * 0.52 / (range[1] - range[0]) / (s / 111000 * 1000) || 0;
  const ticks = [range[0], range[0] + (range[1] - range[0]) / 4, range[0] + (range[1] - range[0]) / 2, range[0] + (range[1] - range[0]) * 3 / 4, range[1]].map(d => Math.round(d));
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-shell"
  }, /*#__PURE__*/React.createElement(ScreenHead, {
    kicker: "Depth view",
    title: "Profiles arranged where they were recorded",
    sub: pool.length + ' profiles near ' + fmt.coord(anchor.latitude, anchor.longitude) + ' · columns are single profiles, not float tracks',
    states: ['ok', 'loading', 'empty', 'error'],
    state: state,
    setState: setState,
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Btn, {
      size: "sm",
      onClick: () => app.go('globe')
    }, "Back to globe"), /*#__PURE__*/React.createElement(Btn, {
      size: "sm",
      onClick: () => {
        setRange([0, 1000]);
        setSample(null);
      }
    }, "Reset view"), /*#__PURE__*/React.createElement(Seg, {
      ariaLabel: "Variable",
      value: variable,
      onChange: setVariable,
      options: [{
        value: 'temp',
        label: 'Temperature'
      }, {
        value: 'psal',
        label: 'Salinity'
      }]
    }))
  }), /*#__PURE__*/React.createElement("div", {
    className: "fc-depth-layout"
  }, /*#__PURE__*/React.createElement("div", {
    className: "fc-depth-stage",
    ref: ref
  }, state === 'loading' && /*#__PURE__*/React.createElement(Loading, {
    label: "Reading 12 profiles"
  }), state === 'error' && /*#__PURE__*/React.createElement(ErrorState, {
    body: "Observation levels could not be read for this region.",
    detail: "GET /api/profiles/5903318_121 \u2192 502",
    onRetry: () => setState('ok')
  }), state === 'empty' && /*#__PURE__*/React.createElement(EmptyState, {
    body: "No profiles inside the current filters carry levels in this depth band."
  }), state === 'ok' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-between fc-wrap fc-gap-3 fc-mb-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2"
  }, /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    onClick: () => setRange(([a, b]) => [Math.max(0, a - 200), Math.max(200, b - 400)])
  }, "\u2191 Shallower"), /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    onClick: () => setRange(([a, b]) => [a, Math.min(2000, b + 400)])
  }, "\u2193 Deeper"), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-sm fc-muted"
  }, range[0], "\u2013", range[1], " m shown")), /*#__PURE__*/React.createElement(Legend, {
    variable: variable
  })), /*#__PURE__*/React.createElement("svg", {
    viewBox: '0 0 ' + width + ' ' + height,
    width: "100%",
    height: height,
    className: "fc-depth-svg",
    role: "img",
    "aria-label": "Depth columns arranged by geographic position"
  }, /*#__PURE__*/React.createElement("g", {
    className: "fc-depth-axis"
  }, /*#__PURE__*/React.createElement("text", {
    x: "8",
    y: cy - 16,
    className: "fc-svg-label"
  }, "depth scale (", anchor.platform, ")"), /*#__PURE__*/React.createElement("line", {
    x1: "44",
    x2: "44",
    y1: cy,
    y2: cy + yOf(range[1]),
    stroke: "rgba(139,203,196,0.3)",
    strokeWidth: "0.8"
  }), ticks.map(d => /*#__PURE__*/React.createElement("g", {
    key: d,
    transform: 'translate(0,' + (cy + yOf(d)) + ')'
  }, /*#__PURE__*/React.createElement("line", {
    x1: "38",
    x2: "50",
    y1: "0",
    y2: "0",
    stroke: "rgba(139,203,196,0.34)",
    strokeWidth: "0.8"
  }), /*#__PURE__*/React.createElement("text", {
    x: "8",
    y: "3",
    className: "fc-svg-tick"
  }, d, " m")))), columns.map(c => /*#__PURE__*/React.createElement("g", {
    key: c.p.profile_id
  }, c.p.profile_id === anchor.profile_id && /*#__PURE__*/React.createElement("rect", {
    x: c.x - 14,
    y: c.y - 9,
    width: "28",
    height: yOf(range[1]) + 18,
    fill: "none",
    stroke: "rgba(139,203,196,0.35)",
    strokeDasharray: "3 3",
    rx: "4"
  }), /*#__PURE__*/React.createElement("ellipse", {
    cx: c.x,
    cy: c.y,
    rx: "13",
    ry: "6",
    fill: "rgba(139,203,196,0.16)",
    stroke: "rgba(139,203,196,0.4)",
    strokeWidth: "0.7"
  }), c.obs.map((o, i) => {
    const v = variable === 'temp' ? o.temp : o.psal;
    const h = Math.max(3, c.obs[i + 1] ? yOf(c.obs[i + 1].depth) - yOf(o.depth) : 6);
    const on = sample && sample.profile_id === c.p.profile_id && sample.o.depth === o.depth;
    return /*#__PURE__*/React.createElement("rect", {
      key: o.depth,
      x: c.x - 11,
      y: c.y + yOf(o.depth),
      width: "22",
      height: h + 0.6,
      fill: v == null ? 'url(#fc-missing)' : scale[variable](v),
      opacity: on ? 1 : 0.92,
      stroke: on ? '#e6f2f0' : 'none',
      strokeWidth: on ? 1.2 : 0,
      className: "fc-depth-cell",
      onClick: () => setSample({
        profile_id: c.p.profile_id,
        p: c.p,
        o
      }),
      tabIndex: "0",
      role: "button",
      "aria-label": c.p.profile_id + ' at ' + o.depth + ' metres, ' + (variable === 'temp' ? fmt.t(o.temp) : fmt.s(o.psal)),
      onKeyDown: e => {
        if (e.key === 'Enter') setSample({
          profile_id: c.p.profile_id,
          p: c.p,
          o
        });
      }
    });
  }), /*#__PURE__*/React.createElement("text", {
    x: c.x,
    y: c.y - 12,
    className: "fc-svg-label",
    textAnchor: "middle"
  }, c.p.platform))), /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("pattern", {
    id: "fc-missing",
    width: "4",
    height: "4",
    patternTransform: "rotate(45)",
    patternUnits: "userSpaceOnUse"
  }, /*#__PURE__*/React.createElement("rect", {
    width: "4",
    height: "4",
    fill: "#33454c"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "4",
    stroke: "#54696f",
    strokeWidth: "1.4"
  })))))), /*#__PURE__*/React.createElement("div", {
    className: "fc-depth-side"
  }, /*#__PURE__*/React.createElement(Panel, {
    kicker: "Selected sample",
    title: sample ? sample.p.profile_id : 'Nothing selected'
  }, !sample ? /*#__PURE__*/React.createElement("p", {
    className: "fc-muted fc-sm"
  }, "Click any cell in a column to read the measurement at that level.") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(DataRow, {
    k: "Depth",
    v: fmt.m(sample.o.depth),
    note: "Derived from pressure"
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Pressure",
    v: sample.o.pres + ' dbar'
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Temperature",
    v: fmt.t(sample.o.temp)
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Salinity",
    v: fmt.s(sample.o.psal)
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "QC flags",
    v: 'T ' + sample.o.temp_qc + ' · S ' + sample.o.psal_qc
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Observed",
    v: fmt.utc(sample.p.time)
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Data mode",
    v: fmt.mode(sample.p.data_mode)
  }), (sample.o.temp == null || sample.o.psal == null) && /*#__PURE__*/React.createElement(Notice, {
    tone: "warn"
  }, "A value is missing at this level and is drawn neutral \u2014 it is not interpolated."), /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2 fc-mt-3"
  }, /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    variant: "primary",
    onClick: () => {
      app.setSel({
        ...app.sel,
        profileId: sample.p.profile_id
      });
      app.go('profile');
    }
  }, "Open full profile")))), /*#__PURE__*/React.createElement(Accordion, {
    title: "How to read this view"
  }, /*#__PURE__*/React.createElement("ul", {
    className: "fc-bullets"
  }, /*#__PURE__*/React.createElement("li", null, "Each column is ", /*#__PURE__*/React.createElement("strong", null, "one profile"), " \u2014 a single descent-to-ascent record at one time and place. Columns are not float tracks."), /*#__PURE__*/React.createElement("li", null, "Horizontal placement is geographic: columns sit where the float surfaced, in a tilted plan view."), /*#__PURE__*/React.createElement("li", null, "Vertical placement is ", /*#__PURE__*/React.createElement("strong", null, "actual depth in metres"), ". The ruler on the left is anchored to the highlighted column (", anchor.platform, "); other columns sit higher or lower because their positions are further away. Depth is exaggerated against horizontal distance so the water column stays legible."), /*#__PURE__*/React.createElement("li", null, "Colour is the measured value. Neutral hatching marks missing or QC-failed levels."), /*#__PURE__*/React.createElement("li", null, "Depth values are ", /*#__PURE__*/React.createElement("em", null, "derived"), " from pressure \u2014 marked \u25B2 wherever they appear."))), /*#__PURE__*/React.createElement(Panel, {
    kicker: "Also here",
    title: "Step through time"
  }, /*#__PURE__*/React.createElement("p", {
    className: "fc-muted fc-sm"
  }, "See how the profiles in this region arrived, observation by observation."), /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    onClick: () => app.go('time')
  }, "Open time exploration")))));
}
function TimeScreen() {
  const app = useApp();
  const [state, setState] = React.useState('ok');
  const [idx, setIdx] = React.useState(app.sel.timeIndex);
  const [playing, setPlaying] = React.useState(false);
  const [showAll, setShowAll] = React.useState(false);
  const [ref, w] = useElementWidth(1000);
  const width = clamp(w, 320, 1400),
    height = clamp(width * 0.42, 260, 560);
  const days = FC.timeSteps;
  React.useEffect(() => {
    if (!playing || prefersReduced()) return;
    const t = setInterval(() => setIdx(i => i + 1 >= days.length ? 0 : i + 1), 900);
    return () => clearInterval(t);
  }, [playing, days.length]);
  const geo = React.useMemo(() => {
    const proj = d3.geoNaturalEarth1().fitExtent([[4, 4], [width - 4, height - 4]], {
      type: 'Sphere'
    });
    const gen = d3.geoPath(proj);
    return {
      proj,
      land: FC.land ? gen(FC.land) : '',
      sphere: gen({
        type: 'Sphere'
      }),
      grat: gen(d3.geoGraticule10())
    };
  }, [width, height]);
  const day = days[idx];
  const shown = state === 'empty' ? [] : app.results.filter(p => showAll ? true : p.time.slice(0, 10) === day);
  const atStep = app.results.filter(p => p.time.slice(0, 10) === day);
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-shell"
  }, /*#__PURE__*/React.createElement(ScreenHead, {
    kicker: "Time exploration",
    title: "Observations as they were recorded",
    sub: 'UTC day ' + day + ' · ' + atStep.length + ' profiles arrived',
    states: ['ok', 'loading', 'empty', 'fallback'],
    state: state,
    setState: setState,
    actions: /*#__PURE__*/React.createElement(Btn, {
      size: "sm",
      onClick: () => app.go('explore')
    }, "Back to map")
  }), /*#__PURE__*/React.createElement(Notice, {
    tone: "info"
  }, "This steps through ", /*#__PURE__*/React.createElement("strong", null, "recorded observation times"), ". It does not simulate float movement between them \u2014 nothing is interpolated or animated along a path."), /*#__PURE__*/React.createElement("div", {
    className: "fc-map-wrap",
    ref: ref
  }, state === 'loading' && /*#__PURE__*/React.createElement("div", {
    className: "fc-map-overlay"
  }, /*#__PURE__*/React.createElement(Loading, {
    label: "Loading observation times",
    lines: 2
  })), state === 'fallback' && /*#__PURE__*/React.createElement("div", {
    className: "fc-map-badge"
  }, /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs"
  }, "cached historical observations")), /*#__PURE__*/React.createElement("svg", {
    viewBox: '0 0 ' + width + ' ' + height,
    width: "100%",
    height: height,
    className: "fc-map",
    role: "img",
    "aria-label": 'Profiles recorded on ' + day
  }, /*#__PURE__*/React.createElement("rect", {
    width: width,
    height: height,
    fill: "#081b23"
  }), /*#__PURE__*/React.createElement("path", {
    d: geo.sphere,
    fill: "#0b2b36"
  }), /*#__PURE__*/React.createElement("path", {
    d: geo.grat,
    fill: "none",
    stroke: "rgba(139,203,196,0.08)",
    strokeWidth: "0.5"
  }), /*#__PURE__*/React.createElement("path", {
    d: geo.land,
    fill: "#0e1f25",
    stroke: "rgba(139,203,196,0.3)",
    strokeWidth: "0.6"
  }), showAll && app.results.map(p => {
    const xy = geo.proj([p.longitude, p.latitude]);
    return /*#__PURE__*/React.createElement("circle", {
      key: 'a' + p.profile_id,
      cx: xy[0],
      cy: xy[1],
      r: "1.6",
      fill: "#4d6a70"
    });
  }), shown.map(p => {
    const xy = geo.proj([p.longitude, p.latitude]);
    const on = p.time.slice(0, 10) === day;
    return /*#__PURE__*/React.createElement("circle", {
      key: p.profile_id,
      cx: xy[0],
      cy: xy[1],
      r: on ? 3.4 : 1.8,
      fill: scale.temp(p.shape.sst),
      stroke: on ? 'rgba(230,242,240,0.8)' : 'none',
      strokeWidth: "0.8"
    });
  }))), /*#__PURE__*/React.createElement(Panel, {
    className: "fc-mt-4",
    kicker: "Timeline",
    title: fmt.day(day + 'T00:00:00Z') + ' 00:00 UTC',
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(IconBtn, {
      label: "Previous time",
      onClick: () => setIdx(i => Math.max(0, i - 1))
    }, "\u2039"), /*#__PURE__*/React.createElement(Btn, {
      size: "sm",
      variant: "primary",
      onClick: () => setPlaying(!playing)
    }, playing ? 'Pause' : 'Play'), /*#__PURE__*/React.createElement(IconBtn, {
      label: "Next time",
      onClick: () => setIdx(i => Math.min(days.length - 1, i + 1))
    }, "\u203A"), /*#__PURE__*/React.createElement(Btn, {
      size: "sm",
      variant: showAll ? 'primary' : 'secondary',
      onClick: () => setShowAll(!showAll),
      "aria-pressed": showAll
    }, "Show all times"))
  }, /*#__PURE__*/React.createElement("input", {
    className: "fc-range",
    type: "range",
    min: "0",
    max: days.length - 1,
    value: idx,
    onChange: e => {
      setIdx(+e.target.value);
      setPlaying(false);
    },
    "aria-label": "Observation time",
    "aria-valuetext": day
  }), /*#__PURE__*/React.createElement("div", {
    className: "fc-timeline-ticks"
  }, days.map((d, i) => /*#__PURE__*/React.createElement("button", {
    key: d,
    className: 'fc-tick' + (i === idx ? ' is-on' : ''),
    onClick: () => {
      setIdx(i);
      setPlaying(false);
    },
    "aria-label": d,
    title: d
  }))), /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-between fc-mt-2"
  }, /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, days[0]), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, days[days.length - 1])), /*#__PURE__*/React.createElement("ul", {
    className: "fc-list fc-mt-3",
    "aria-label": 'Profiles recorded on ' + day
  }, atStep.slice(0, 6).map(p => /*#__PURE__*/React.createElement("li", {
    key: p.profile_id
  }, /*#__PURE__*/React.createElement("button", {
    className: "fc-list-btn",
    onClick: () => {
      app.setSel({
        ...app.sel,
        profileId: p.profile_id,
        timeIndex: idx
      });
      app.go('profile');
    }
  }, /*#__PURE__*/React.createElement(Mono, {
    className: "fc-sm"
  }, p.profile_id), /*#__PURE__*/React.createElement("span", {
    className: "fc-muted fc-xs"
  }, p.time.slice(11, 16), " UTC \xB7 ", fmt.coord(p.latitude, p.longitude)), /*#__PURE__*/React.createElement("span", {
    className: "fc-swatch",
    style: {
      background: scale.temp(p.shape.sst)
    },
    "aria-hidden": "true"
  })))), !atStep.length && /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement(EmptyState, {
    title: "No observations on this day",
    body: "Step to another time, or widen the filters."
  })))));
}
window.FCScreens = Object.assign(window.FCScreens || {}, {
  depth: DepthScreen,
  time: TimeScreen
});
Object.assign(window, {
  DepthScreen,
  TimeScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "prototype/fc-depth.jsx", error: String((e && e.message) || e) }); }

// prototype/fc-dive.jsx
try { (() => {
/* FloatChat — "Dive in": a real three.js camera move from high above the map,
   through the water surface, and into the interior of the Argo float.

   One unbroken take. The camera rides a Catmull-Rom spline with its look-at
   locked to the float for the whole shot, world Y-up fixed (no roll), and a
   velocity profile that starts already in motion, holds near-constant through
   the descent, and eases out only at the very end. Total 1.2s.

   The whole scene — float, hull interior, water, map texture — is built and
   rendered once before the camera starts moving, so nothing loads, pops or
   changes detail mid-flight. Readout values are HTML, positioned each frame
   from the projected 3D anchors on the instrument panel. */

const DIVE_MS = 1200;
const CROSS_MS = 110;

/* Velocity profile: v0 at t=0 (already moving), ramp to 1 by 10%, hold to 85%,
   decelerate to 0 at 100%. Integrated once into a normalised arc-length table
   so the camera's speed along the spline follows it exactly. */
function buildEase(v0 = 0.55, inEnd = 0.1, outStart = 0.85, steps = 512) {
  const smooth = x => x * x * (3 - 2 * x);
  const vel = t => {
    if (t < inEnd) return v0 + (1 - v0) * smooth(t / inEnd);
    if (t < outStart) return 1;
    return 1 - smooth((t - outStart) / (1 - outStart));
  };
  const cum = new Float32Array(steps + 1);
  let acc = 0;
  for (let i = 1; i <= steps; i++) {
    acc += vel((i - 0.5) / steps) / steps;
    cum[i] = acc;
  }
  for (let i = 0; i <= steps; i++) cum[i] /= acc;
  return t => {
    const x = Math.max(0, Math.min(1, t)) * steps;
    const i = Math.min(steps - 1, Math.floor(x));
    return cum[i] + (cum[i + 1] - cum[i]) * (x - i);
  };
}
function gradientTexture(THREE, stops) {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  return new THREE.CanvasTexture(c);
}

/* Screen-space pass: holds the rendered frame, applies a short ripple +
   chromatic split as the lens crosses the water plane, and carries the
   above/below colour grade so the change is a gradient, not a cut. */
const REFRACT_FRAG = `
uniform sampler2D tDiffuse; uniform float uDistort; uniform float uSubmerged;
uniform float uTime; uniform vec2 uCentre; varying vec2 vUv;
void main(){
  vec2 uv = vUv;
  float d = distance(uv, uCentre);
  if (uDistort > 0.001) {
    float w = sin(d * 42.0 - uTime * 26.0) * exp(-d * 5.0);
    uv += normalize(uv - uCentre + 1e-5) * w * uDistort * 0.035;
  }
  float ca = uDistort * 0.006;
  vec4 col;
  col.r = texture2D(tDiffuse, uv + vec2(ca, 0.0)).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - vec2(ca, 0.0)).b;
  col.a = 1.0;
  vec3 deep = vec3(0.022, 0.075, 0.10);
  col.rgb = mix(col.rgb, col.rgb * vec3(0.66, 0.94, 1.0) + deep * 0.5, uSubmerged);
  float vig = smoothstep(1.05, 0.28, distance(vUv, vec2(0.5)));
  col.rgb *= mix(1.0, vig, 0.35 + 0.35 * uSubmerged);
  gl_FragColor = col;
}`;
function buildScene(THREE, target) {
  const scene = new THREE.Scene();
  const [tx, tz] = target;
  scene.add(new THREE.AmbientLight(0xbfe4de, 0.22));
  const sun = new THREE.DirectionalLight(0xffffff, 0.95);
  sun.position.set(tx + 30, 90, tz + 40);
  scene.add(sun);
  const glow = new THREE.PointLight(0x8bcbc4, 1.25, 14, 2);
  glow.position.set(tx, -1.4, tz + 0.9);
  scene.add(glow);

  /* Sea surface. The float sits at the waterline, so this is context around the
     subject — not a map the shot flies over. */
  const mapPlane = new THREE.Mesh(new THREE.PlaneGeometry(360, 180, 1, 1), new THREE.MeshStandardMaterial({
    color: 0x0f4a58,
    roughness: 0.22,
    metalness: 0.18
  }));
  mapPlane.rotation.x = -Math.PI / 2;
  scene.add(mapPlane);
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(360, 180), new THREE.MeshBasicMaterial({
    color: 0x0b3441
  }));
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -0.02;
  scene.add(ocean);

  /* Underside of the surface, seen once the camera is below it. */
  const underside = new THREE.Mesh(new THREE.PlaneGeometry(360, 180), new THREE.MeshBasicMaterial({
    color: 0x14586a,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.9
  }));
  underside.rotation.x = -Math.PI / 2;
  underside.position.y = 0.04;
  scene.add(underside);

  /* Water column: a tall shell of graded colour around the dive line, so the
     descent reads as depth rather than empty space. Fog does the rest. */
  const column = new THREE.Mesh(new THREE.CylinderGeometry(46, 30, 40, 40, 1, true), new THREE.MeshBasicMaterial({
    map: gradientTexture(THREE, [[0, '#0f4956'], [0.45, '#093039'], [1, '#04121a']]),
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.96,
    depthWrite: false
  }));
  column.position.set(tx, -17, tz);
  scene.add(column);
  scene.fog = new THREE.FogExp2(0x0a2e3a, 0.0);

  /* The float: hull, end caps, antenna, sensor bay. One detail level, present
     from the first frame. */
  const float = new THREE.Group();
  float.position.set(tx, 0, tz);
  const hullMat = new THREE.MeshStandardMaterial({
    color: 0xc9d6d4,
    roughness: 0.42,
    metalness: 0.72
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 5.4, 64, 1, false), hullMat);
  float.add(body);
  const capTop = new THREE.Mesh(new THREE.SphereGeometry(1.5, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), hullMat);
  capTop.position.y = 2.7;
  float.add(capTop);
  const capBot = new THREE.Mesh(new THREE.SphereGeometry(1.5, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), hullMat);
  capBot.position.y = -2.7;
  float.add(capBot);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.54, 1.54, 0.34, 64), new THREE.MeshStandardMaterial({
    color: 0x2fa79f,
    roughness: 0.35,
    metalness: 0.6
  }));
  band.position.y = 1.1;
  float.add(band);
  const band2 = band.clone();
  band2.position.y = -1.0;
  float.add(band2);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 2.4, 16), new THREE.MeshStandardMaterial({
    color: 0x8a9a98,
    roughness: 0.5,
    metalness: 0.5
  }));
  mast.position.y = 5.1;
  float.add(mast);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 14), new THREE.MeshBasicMaterial({
    color: 0xd56d50
  }));
  beacon.position.y = 6.3;
  float.add(beacon);
  scene.add(float);

  /* Interior: the camera's destination. Inward-facing hull wall, an instrument
     bulkhead with two gauge bezels, and a porthole onto the water. */
  const cabin = new THREE.Group();
  cabin.position.set(tx, -1.5, tz);
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 6.2, 64, 1, true), new THREE.MeshStandardMaterial({
    color: 0x14333d,
    roughness: 0.78,
    metalness: 0.42,
    side: THREE.BackSide
  }));
  cabin.add(wall);
  const ribMat = new THREE.MeshStandardMaterial({
    color: 0x1d4b58,
    roughness: 0.6,
    metalness: 0.55,
    side: THREE.BackSide
  });
  [-2.15, 2.15].forEach(y => {
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(2.37, 2.37, 0.2, 64, 1, true), ribMat);
    rib.position.y = y;
    cabin.add(rib);
  });

  /* Full end cap: closes the annulus between bulkhead and hull so no outside
     light leaks past the plate. */
  const backing = new THREE.Mesh(new THREE.CircleGeometry(2.42, 64), new THREE.MeshStandardMaterial({
    color: 0x0a2029,
    roughness: 0.9,
    metalness: 0.25
  }));
  backing.position.set(0, 0, -2.46);
  cabin.add(backing);
  const rearCap = new THREE.Mesh(new THREE.CircleGeometry(2.42, 48), new THREE.MeshStandardMaterial({
    color: 0x09202a,
    roughness: 0.92,
    metalness: 0.2,
    side: THREE.BackSide
  }));
  rearCap.position.set(0, 0, 3.0);
  cabin.add(rearCap);
  const capTopI = new THREE.Mesh(new THREE.CircleGeometry(2.42, 48), new THREE.MeshStandardMaterial({
    color: 0x0b2630,
    roughness: 0.9,
    side: THREE.BackSide
  }));
  capTopI.rotation.x = Math.PI / 2;
  capTopI.position.y = 3.1;
  cabin.add(capTopI);
  const capBotI = capTopI.clone();
  capBotI.rotation.x = -Math.PI / 2;
  capBotI.position.y = -3.1;
  cabin.add(capBotI);

  /* Instrument bulkhead: one plate facing the camera's resting position,
     carrying the porthole and both gauge wells in a single readable frame. */
  const panel = new THREE.Mesh(new THREE.CircleGeometry(1.62, 64), new THREE.MeshStandardMaterial({
    color: 0x0b222b,
    roughness: 0.86,
    metalness: 0.3
  }));
  panel.position.set(0, 0, -2.3);
  cabin.add(panel);
  const plateRing = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.07, 16, 72), new THREE.MeshStandardMaterial({
    color: 0x1f5260,
    roughness: 0.45,
    metalness: 0.8
  }));
  plateRing.position.set(0, 0, -2.29);
  cabin.add(plateRing);
  const bezelMat = new THREE.MeshStandardMaterial({
    color: 0x27616e,
    roughness: 0.34,
    metalness: 0.85
  });
  const wellMat = new THREE.MeshStandardMaterial({
    color: 0x061a22,
    roughness: 0.95,
    metalness: 0.1
  });
  const gaugeAnchors = [];
  [[0.2, 0.46], [0.2, -0.4]].forEach(([gx, gy]) => {
    const bez = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 18, 48), bezelMat);
    bez.position.set(gx, gy, -2.26);
    cabin.add(bez);
    const well = new THREE.Mesh(new THREE.CircleGeometry(0.32, 48), wellMat);
    well.position.set(gx, gy, -2.25);
    cabin.add(well);
    gaugeAnchors.push(new THREE.Vector3(gx, gy, -2.24));
  });
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.3), new THREE.MeshBasicMaterial({
    color: 0x07202a
  }));
  strip.position.set(-0.42, -1.12, -2.26);
  cabin.add(strip);
  const stripAnchor = new THREE.Vector3(-0.42, -1.12, -2.24);

  /* Porthole, set into the same bulkhead so it shares the frame. */
  const seaCanvas = document.createElement('canvas');
  seaCanvas.width = seaCanvas.height = 256;
  const sctx = seaCanvas.getContext('2d');
  const rg = sctx.createRadialGradient(118, 112, 14, 128, 128, 150);
  rg.addColorStop(0, '#8fdad4');
  rg.addColorStop(0.5, '#2a8f96');
  rg.addColorStop(1, '#10545e');
  sctx.fillStyle = rg;
  sctx.fillRect(0, 0, 256, 256);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.54, 56), new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(seaCanvas)
  }));
  glass.position.set(-1.0, 0.02, -2.25);
  cabin.add(glass);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.08, 20, 56), bezelMat);
  ring.position.set(-1.0, 0.02, -2.24);
  cabin.add(ring);
  const lampMat = new THREE.MeshBasicMaterial({
    color: 0x59c8be
  });
  [-1.95, 1.95].forEach(x => {
    const lamp = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 2.4), lampMat);
    lamp.position.set(x, 0.1, -1.6);
    lamp.rotation.y = x < 0 ? 0.5 : -0.5;
    cabin.add(lamp);
  });
  cabin.visible = false;
  scene.add(cabin);

  /* Bubble burst, released where the lens crosses the water. Positioned at the
     entry point at crossing time, so its scale reads against camera distance. */
  const COUNT = 360;
  const pos = new Float32Array(COUNT * 3);
  const vel = new Float32Array(COUNT * 3);
  const seed = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const a = Math.random() * Math.PI * 2,
      r = Math.pow(Math.random(), 0.5) * 1.5;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = -0.15 - Math.random() * 1.2;
    pos[i * 3 + 2] = Math.sin(a) * r;
    vel[i * 3] = Math.cos(a) * 0.4;
    vel[i * 3 + 1] = 1.8 + Math.random() * 3.6;
    vel[i * 3 + 2] = Math.sin(a) * 0.4;
    seed[i] = Math.random();
  }
  const bubbleGeo = new THREE.BufferGeometry();
  bubbleGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const bubbles = new THREE.Points(bubbleGeo, new THREE.PointsMaterial({
    color: 0xdff3f0,
    size: 0.14,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false
  }));
  bubbles.visible = false;
  scene.add(bubbles);
  return {
    scene,
    mapPlane,
    ocean,
    underside,
    column,
    float,
    cabin,
    panel,
    bubbles,
    bubbleData: {
      pos,
      vel,
      seed,
      COUNT
    },
    gaugeAnchors,
    stripAnchor,
    glow
  };
}
function DiveStage({
  p,
  onSettled
}) {
  const host = React.useRef(null);
  const anchors = React.useRef({
    gauges: [],
    strip: null
  });
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const THREE = window.THREE;
    const el = host.current;
    if (!THREE || !el) {
      onSettled({
        gauges: [],
        strip: null
      });
      return;
    }
    const tx = p.longitude,
      tz = -p.latitude;
    const w = el.clientWidth,
      h = el.clientHeight;
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(w, h);
    renderer.setClearColor(0x071820, 1);
    el.appendChild(renderer.domElement);
    const built = buildScene(THREE, [tx, tz]);
    const camera = new THREE.PerspectiveCamera(62, w / h, 0.05, 900);
    camera.up.set(0, 1, 0);
    const lookAt = new THREE.Vector3(tx, -1.5, tz);
    /* Straight drone dolly: the float is the subject from frame one, roughly 60
       units out and small in frame, closing in a near-linear push with a slight
       downward drift. No orbit, no map flyover. */
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(tx + 6.0, 10.5, tz + 59), new THREE.Vector3(tx + 4.9, 8.5, tz + 47), new THREE.Vector3(tx + 3.8, 6.4, tz + 35), new THREE.Vector3(tx + 2.7, 4.4, tz + 24), new THREE.Vector3(tx + 1.8, 2.6, tz + 15), new THREE.Vector3(tx + 1.1, 1.0, tz + 8.5), new THREE.Vector3(tx + 0.6, -0.3, tz + 4.6), new THREE.Vector3(tx + 0.18, -1.1, tz + 2.6), new THREE.Vector3(tx, -1.5, tz + 1.55)], false, 'catmullrom', 0.5);

    /* Where the path meets the water plane, in eased-time terms. */
    const ease = buildEase();
    let crossT = 0.5;
    const entry = new THREE.Vector3(tx, 0, tz);
    {
      const N = 400;
      let prev = curve.getPointAt(0).y;
      for (let i = 1; i <= N; i++) {
        const u = i / N,
          pt = curve.getPointAt(u),
          y = pt.y;
        if (prev > 0 && y <= 0) {
          entry.set(pt.x, 0, pt.z);
          const uu = u - 1 / N * (y / (y - prev));
          for (let k = 0; k <= 200; k++) {
            if (ease(k / 200) >= uu) {
              crossT = k / 200;
              break;
            }
          }
          break;
        }
        prev = y;
      }
    }
    built.bubbles.position.copy(entry);
    const rt = new THREE.WebGLRenderTarget(Math.max(1, Math.floor(w * renderer.getPixelRatio())), Math.max(1, Math.floor(h * renderer.getPixelRatio())));
    const postScene = new THREE.Scene();
    const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const postMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: {
          value: rt.texture
        },
        uDistort: {
          value: 0
        },
        uSubmerged: {
          value: 0
        },
        uTime: {
          value: 0
        },
        uCentre: {
          value: new THREE.Vector2(0.5, 0.5)
        }
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: REFRACT_FRAG,
      depthTest: false,
      depthWrite: false
    });
    postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));
    const project = () => {
      const toScreen = v => {
        const q = v.clone().applyMatrix4(built.cabin.matrixWorld).project(camera);
        return {
          x: (q.x * 0.5 + 0.5) * 100,
          y: (-q.y * 0.5 + 0.5) * 100
        };
      };
      return {
        gauges: built.gaugeAnchors.map(toScreen),
        strip: toScreen(built.stripAnchor)
      };
    };
    let raf = 0,
      start = 0,
      done = false;
    const crossMsFrac = CROSS_MS / DIVE_MS;
    const frame = now => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / DIVE_MS);
      const u = ease(t);
      curve.getPointAt(u, camera.position);
      camera.lookAt(lookAt);
      const below = camera.position.y < 0;
      const dt = (t - crossT) / crossMsFrac;
      const inWindow = Math.abs(dt) < 1;

      /* Grade and fog ramp across the crossing window — never an instant cut. */
      const sub = Math.max(0, Math.min(1, (t - crossT + crossMsFrac) / (crossMsFrac * 2)));
      postMat.uniforms.uSubmerged.value = sub;
      postMat.uniforms.uDistort.value = inWindow ? Math.cos(dt * Math.PI * 0.5) : 0;
      postMat.uniforms.uTime.value = (now - start) / 1000;
      built.column.material.opacity = 0.55 + 0.41 * sub;
      renderer.setClearColor(below ? 0x061a22 : 0x9fc5cf, 1);
      const inside = t > 0.88;
      if (built.cabin.visible !== inside) built.cabin.visible = inside;
      built.float.visible = !inside;
      if (t >= crossT) {
        if (!built.bubbles.visible) {
          built.bubbles.visible = true;
          built.bubbles.material.opacity = 0.9;
        }
        const age = (t - crossT) * (DIVE_MS / 1000);
        const arr = built.bubbles.geometry.attributes.position.array;
        const {
          pos,
          vel,
          COUNT
        } = built.bubbleData;
        for (let i = 0; i < COUNT; i++) {
          arr[i * 3] = pos[i * 3] + vel[i * 3] * age;
          arr[i * 3 + 1] = pos[i * 3 + 1] + vel[i * 3 + 1] * age - 1.1 * age * age;
          arr[i * 3 + 2] = pos[i * 3 + 2] + vel[i * 3 + 2] * age;
        }
        built.bubbles.geometry.attributes.position.needsUpdate = true;
        built.bubbles.material.opacity = Math.max(0, 0.9 - age * 2.6);
      }
      renderer.setRenderTarget(rt);
      renderer.render(built.scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCam);
      if (t < 1) {
        raf = requestAnimationFrame(frame);
      } else if (!done) {
        done = true;
        built.cabin.updateMatrixWorld(true);
        const a = project();
        anchors.current = a;
        setReady(true);
        onSettled(a);
      }
    };

    /* Warm the pipeline: compile, upload and render one frame before the
       camera moves, so nothing is loading once the shot starts. */
    curve.getPointAt(0, camera.position);
    camera.lookAt(lookAt);
    built.cabin.visible = true;
    renderer.compile(built.scene, camera);
    renderer.setRenderTarget(rt);
    renderer.render(built.scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
    built.cabin.visible = false;
    raf = requestAnimationFrame(frame);
    const onResize = () => {
      const nw = el.clientWidth,
        nh = el.clientHeight;
      if (!nw || !nh) return;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
      rt.setSize(Math.floor(nw * renderer.getPixelRatio()), Math.floor(nh * renderer.getPixelRatio()));
      if (done) {
        built.cabin.updateMatrixWorld(true);
        const a = project();
        anchors.current = a;
        onSettled(a);
      }
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      rt.dispose();
      built.scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const m = Array.isArray(o.material) ? o.material : [o.material];
          m.forEach(x => {
            if (x.map) x.map.dispose();
            x.dispose();
          });
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, [p.profile_id]);
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-dive-gl",
    ref: host,
    "data-ready": ready
  });
}
function DiveView({
  p,
  onClose
}) {
  const [settled, setSettled] = React.useState(false);
  const [anchors, setAnchors] = React.useState({
    gauges: [],
    strip: null
  });
  const st = React.useMemo(() => FC.stats(p.profile_id), [p.profile_id]);
  const closeRef = React.useRef(null);
  React.useEffect(() => {
    const key = e => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  React.useEffect(() => {
    if (settled) closeRef.current?.focus();
  }, [settled]);
  const onSettled = React.useCallback(a => {
    setAnchors(a);
    setSettled(true);
  }, []);
  const g = anchors.gauges || [];
  return /*#__PURE__*/React.createElement("div", {
    className: 'fc-dive' + (settled ? ' is-settled' : ''),
    role: "dialog",
    "aria-modal": "true",
    "aria-label": 'Inside float ' + p.platform
  }, /*#__PURE__*/React.createElement(DiveStage, {
    p: p,
    onSettled: onSettled
  }), /*#__PURE__*/React.createElement("div", {
    className: "fc-dive-hud",
    "aria-hidden": !settled
  }, g[0] && /*#__PURE__*/React.createElement("div", {
    className: "fc-dive-val",
    style: {
      left: g[0].x + '%',
      top: g[0].y + '%'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-dive-val-n"
  }, st?.sst != null ? st.sst.toFixed(2) : '—'), /*#__PURE__*/React.createElement("span", {
    className: "fc-dive-val-u"
  }, "\xB0C")), g[1] && /*#__PURE__*/React.createElement("div", {
    className: "fc-dive-val",
    style: {
      left: g[1].x + '%',
      top: g[1].y + '%'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-dive-val-n"
  }, st?.salSurface != null ? st.salSurface.toFixed(2) : '—'), /*#__PURE__*/React.createElement("span", {
    className: "fc-dive-val-u"
  }, "PSU")), anchors.strip && /*#__PURE__*/React.createElement("div", {
    className: "fc-dive-strip",
    style: {
      left: anchors.strip.x + '%',
      top: anchors.strip.y + '%'
    }
  }, /*#__PURE__*/React.createElement(Mono, {
    className: "fc-dive-strip-id"
  }, p.platform, " \xB7 cycle ", p.cycle))), /*#__PURE__*/React.createElement("div", {
    className: "fc-dive-readout",
    "aria-hidden": !settled
  }, /*#__PURE__*/React.createElement("header", {
    className: "fc-dive-head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Kicker, null, "Inside float"), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-dive-id"
  }, p.profile_id)), /*#__PURE__*/React.createElement("button", {
    ref: closeRef,
    className: "fc-dive-close",
    onClick: onClose
  }, "Surface \u2191")), /*#__PURE__*/React.createElement(DataRow, {
    k: "Observed",
    v: fmt.utc(p.time)
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Location",
    v: fmt.coord(p.latitude, p.longitude)
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Depth range",
    v: p.depth_min + '–' + p.depth_max + ' m',
    note: "Depth derived from pressure"
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Temperature (surface)",
    v: fmt.t(st?.sst)
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Salinity (surface)",
    v: fmt.s(st?.salSurface)
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Data mode",
    v: fmt.mode(p.data_mode)
  }), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted fc-dive-note"
  }, "Instrument readout \xB7 press Esc to surface")));
}
Object.assign(window, {
  DiveView,
  DiveStage
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "prototype/fc-dive.jsx", error: String((e && e.message) || e) }); }

// prototype/fc-geo.jsx
try { (() => {
/* FloatChat — Explore: regional map and globe, both on Natural Earth geometry. */

const BASIN_OPTS = [{
  value: 'all',
  label: 'All basins'
}, ...[['north-atlantic', 'North Atlantic'], ['south-atlantic', 'South Atlantic'], ['north-pacific', 'North Pacific'], ['south-pacific', 'South Pacific'], ['indian', 'Indian Ocean'], ['southern', 'Southern Ocean'], ['arabian-sea', 'Arabian Sea & Bay of Bengal']].map(([value, label]) => ({
  value,
  label
}))];
function FiltersDrawer({
  open,
  onClose,
  state
}) {
  const app = useApp();
  const [draft, setDraft] = React.useState(app.filters);
  const [pending, setPending] = React.useState(false);
  React.useEffect(() => {
    if (open) setDraft(app.filters);
  }, [open]);
  const set = (k, v) => setDraft(d => ({
    ...d,
    [k]: v
  }));
  const errors = {};
  if (draft.end < draft.start) errors.end = 'End date is before the start date.';
  if (+draft.depthMax <= +draft.depthMin) errors.depthMax = 'Maximum depth must exceed the minimum.';
  if (+draft.tempMax <= +draft.tempMin) errors.tempMax = 'Maximum temperature must exceed the minimum.';
  const invalid = state === 'invalid' || Object.keys(errors).length > 0;
  const preview = invalid ? [] : FC.filter(draft);
  const apply = () => {
    if (invalid) return;
    setPending(true);
    setTimeout(() => {
      setPending(false);
      app.setFilters(draft);
      onClose();
    }, 620);
  };
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-drawer-scrim",
    onMouseDown: e => {
      if (e.target === e.currentTarget) onClose();
    }
  }, /*#__PURE__*/React.createElement("aside", {
    className: "fc-drawer",
    role: "dialog",
    "aria-label": "Filters"
  }, /*#__PURE__*/React.createElement("header", {
    className: "fc-drawer-head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Kicker, null, "Filters"), /*#__PURE__*/React.createElement("h4", {
    className: "fc-panel-title"
  }, "Narrow the observations")), /*#__PURE__*/React.createElement(IconBtn, {
    label: "Close filters",
    onClick: onClose
  }, "\u2715")), /*#__PURE__*/React.createElement("div", {
    className: "fc-drawer-body"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Region"
  }, /*#__PURE__*/React.createElement(Select, {
    value: draft.basin,
    onChange: v => set('basin', v),
    options: BASIN_OPTS
  })), /*#__PURE__*/React.createElement("div", {
    className: "fc-grid-2"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "West / East bounds",
    hint: "Decimal degrees"
  }, /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2"
  }, /*#__PURE__*/React.createElement("input", {
    className: "fc-input",
    defaultValue: "-180",
    "aria-label": "West bound"
  }), /*#__PURE__*/React.createElement("input", {
    className: "fc-input",
    defaultValue: "180",
    "aria-label": "East bound"
  }))), /*#__PURE__*/React.createElement(Field, {
    label: "South / North bounds"
  }, /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2"
  }, /*#__PURE__*/React.createElement("input", {
    className: "fc-input",
    defaultValue: "-66",
    "aria-label": "South bound"
  }), /*#__PURE__*/React.createElement("input", {
    className: "fc-input",
    defaultValue: "62",
    "aria-label": "North bound"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "fc-grid-2"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Start date"
  }, /*#__PURE__*/React.createElement("input", {
    className: "fc-input",
    type: "date",
    value: draft.start,
    onChange: e => set('start', e.target.value)
  })), /*#__PURE__*/React.createElement(Field, {
    label: "End date",
    error: errors.end
  }, /*#__PURE__*/React.createElement("input", {
    className: "fc-input",
    type: "date",
    value: draft.end,
    onChange: e => set('end', e.target.value)
  }))), /*#__PURE__*/React.createElement("div", {
    className: "fc-grid-2"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Depth minimum (m)"
  }, /*#__PURE__*/React.createElement("input", {
    className: "fc-input",
    type: "number",
    value: draft.depthMin,
    onChange: e => set('depthMin', +e.target.value)
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Depth maximum (m)",
    error: errors.depthMax
  }, /*#__PURE__*/React.createElement("input", {
    className: "fc-input",
    type: "number",
    value: draft.depthMax,
    onChange: e => set('depthMax', +e.target.value)
  }))), /*#__PURE__*/React.createElement(Field, {
    label: "Exact depth (m)",
    hint: "Nearest bracketed level is used; no extrapolation."
  }, /*#__PURE__*/React.createElement("input", {
    className: "fc-input",
    type: "number",
    placeholder: "e.g. 100"
  })), /*#__PURE__*/React.createElement("div", {
    className: "fc-grid-2"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Surface temperature (\xB0C)",
    error: errors.tempMax
  }, /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2"
  }, /*#__PURE__*/React.createElement("input", {
    className: "fc-input",
    type: "number",
    value: draft.tempMin,
    onChange: e => set('tempMin', +e.target.value),
    "aria-label": "Minimum temperature"
  }), /*#__PURE__*/React.createElement("input", {
    className: "fc-input",
    type: "number",
    value: draft.tempMax,
    onChange: e => set('tempMax', +e.target.value),
    "aria-label": "Maximum temperature"
  }))), /*#__PURE__*/React.createElement(Field, {
    label: "Surface salinity (PSU)"
  }, /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2"
  }, /*#__PURE__*/React.createElement("input", {
    className: "fc-input",
    type: "number",
    step: "0.1",
    value: draft.salMin,
    onChange: e => set('salMin', +e.target.value),
    "aria-label": "Minimum salinity"
  }), /*#__PURE__*/React.createElement("input", {
    className: "fc-input",
    type: "number",
    step: "0.1",
    value: draft.salMax,
    onChange: e => set('salMax', +e.target.value),
    "aria-label": "Maximum salinity"
  })))), /*#__PURE__*/React.createElement(Field, {
    label: "Float IDs",
    hint: "WMO platform numbers, comma separated"
  }, /*#__PURE__*/React.createElement("input", {
    className: "fc-input",
    value: draft.floatIds,
    onChange: e => set('floatIds', e.target.value),
    placeholder: "5903312, 5903358"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Profile IDs"
  }, /*#__PURE__*/React.createElement("input", {
    className: "fc-input",
    placeholder: "5903312_121"
  })), /*#__PURE__*/React.createElement(Accordion, {
    title: "Advanced"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "QC settings",
    hint: "Strict keeps QC flags 1\u20132 only."
  }, /*#__PURE__*/React.createElement(Seg, {
    ariaLabel: "QC settings",
    value: draft.qcStrict ? 'strict' : 'all',
    onChange: v => set('qcStrict', v === 'strict'),
    options: [{
      value: 'strict',
      label: 'Strict'
    }, {
      value: 'all',
      label: 'All flags'
    }]
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Data mode"
  }, /*#__PURE__*/React.createElement(Select, {
    value: draft.dataMode,
    onChange: v => set('dataMode', v),
    options: [{
      value: 'all',
      label: 'Any mode'
    }, {
      value: 'R',
      label: 'Real-time (R)'
    }, {
      value: 'A',
      label: 'Adjusted (A)'
    }, {
      value: 'D',
      label: 'Delayed-mode (D)'
    }]
  }))), invalid && /*#__PURE__*/React.createElement(Notice, {
    tone: "warn"
  }, "Fix the highlighted fields before applying."), !invalid && preview.length === 0 && /*#__PURE__*/React.createElement(Notice, {
    tone: "warn"
  }, "No available observations for this combination. Widen the date window or the region.")), /*#__PURE__*/React.createElement("footer", {
    className: "fc-drawer-foot"
  }, /*#__PURE__*/React.createElement(Mono, {
    className: "fc-sm fc-muted"
  }, invalid ? '—' : preview.length + ' profiles'), /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2"
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "ghost",
    size: "sm",
    onClick: () => setDraft(FC.defaultFilters)
  }, "Reset"), /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    size: "sm",
    onClick: apply,
    disabled: invalid || pending
  }, pending ? 'Updating…' : 'Apply filters')))));
}
function Legend({
  variable
}) {
  const stops = variable === 'temp' ? TEMP_STOPS : SAL_STOPS;
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-legend"
  }, /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, variable === 'temp' ? 'Surface temperature °C' : 'Surface salinity PSU'), /*#__PURE__*/React.createElement("div", {
    className: "fc-legend-bar"
  }, stops.map(([v, c], i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      background: c
    }
  }))), /*#__PURE__*/React.createElement("div", {
    className: "fc-legend-ticks"
  }, /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs"
  }, stops[0][0]), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs"
  }, stops[stops.length - 1][0])), /*#__PURE__*/React.createElement("div", {
    className: "fc-legend-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-legend-swatch",
    style: {
      background: '#3d4d54'
    }
  }), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, "missing / QC failed")));
}
function ProfilePreview({
  p,
  onClose,
  onDive
}) {
  const app = useApp();
  const st = React.useMemo(() => FC.stats(p.profile_id), [p.profile_id]);
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-preview"
  }, /*#__PURE__*/React.createElement("header", {
    className: "fc-row fc-between"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Kicker, null, "Profile"), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-preview-id"
  }, p.profile_id)), /*#__PURE__*/React.createElement(IconBtn, {
    label: "Close preview",
    onClick: onClose
  }, "\u2715")), /*#__PURE__*/React.createElement(DataRow, {
    k: "Float",
    v: p.platform + ' · cycle ' + p.cycle
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Observed",
    v: fmt.utc(p.time)
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Location",
    v: fmt.coord(p.latitude, p.longitude)
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Depth range",
    v: p.depth_min + '–' + p.depth_max + ' m',
    note: "Depth derived from pressure"
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Surface",
    v: fmt.t(st?.sst) + ' · ' + fmt.s(st?.salSurface)
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Temperature (surface)",
    v: fmt.t(st?.sst)
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Salinity (surface)",
    v: fmt.s(st?.salSurface)
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Data mode",
    v: fmt.mode(p.data_mode)
  }), /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2 fc-mt-3 fc-wrap"
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    size: "sm",
    onClick: () => {
      app.setSel({
        ...app.sel,
        profileId: p.profile_id
      });
      app.go('profile');
    }
  }, "View measurements"), onDive && /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    onClick: onDive
  }, "Dive in"), /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    onClick: () => {
      app.setSel({
        ...app.sel,
        profileId: p.profile_id
      });
      app.go('depth');
    }
  }, "Depth view")));
}
function MapScreen() {
  const app = useApp();
  const [state, setState] = React.useState('ok');
  const [variable, setVariable] = React.useState('temp');
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [selected, setSelected] = React.useState(null);
  const [diving, setDiving] = React.useState(null);
  const [ref, w] = useElementWidth(1100);
  const svgRef = React.useRef(null);
  const gRef = React.useRef(null);
  const width = clamp(w, 320, 1680);
  const height = clamp(width * 0.47, 300, 720);
  const results = app.results;
  const geo = React.useMemo(() => {
    const proj = d3.geoNaturalEarth1().fitExtent([[4, 4], [width - 4, height - 4]], {
      type: 'Sphere'
    });
    const gen = d3.geoPath(proj);
    return {
      proj,
      land: FC.land ? gen(FC.land) : '',
      grat: gen(d3.geoGraticule10()),
      sphere: gen({
        type: 'Sphere'
      })
    };
  }, [width, height]);
  React.useEffect(() => {
    if (!svgRef.current || !window.d3) return;
    const zoom = d3.zoom().scaleExtent([1, 8]).on('zoom', e => {
      if (gRef.current) gRef.current.setAttribute('transform', e.transform);
    });
    d3.select(svgRef.current).call(zoom);
    return () => d3.select(svgRef.current).on('.zoom', null);
  }, [width, height]);
  const marks = results.map(p => ({
    p,
    xy: geo.proj([p.longitude, p.latitude])
  })).filter(m => m.xy);
  const dates = results.length ? [results[0].time.slice(0, 10), results[results.length - 1].time.slice(0, 10)] : null;
  const basinName = app.filters.basin === 'all' ? 'Global' : BASIN_OPTS.find(b => b.value === app.filters.basin)?.label;
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-shell"
  }, /*#__PURE__*/React.createElement(ScreenHead, {
    kicker: "Explore",
    title: "Argo observations, mapped",
    sub: basinName + ' · ' + (dates ? dates[0] + ' → ' + dates[1] : 'no observations in window') + ' · markers are profiles, not tracks',
    states: ['ok'],
    state: state,
    setState: setState,
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Seg, {
      ariaLabel: "View",
      value: "map",
      onChange: v => v === 'globe' && app.go('globe'),
      options: [{
        value: 'map',
        label: 'Map'
      }, {
        value: 'globe',
        label: 'Globe'
      }]
    }), /*#__PURE__*/React.createElement(Seg, {
      ariaLabel: "Variable",
      value: variable,
      onChange: setVariable,
      options: [{
        value: 'temp',
        label: 'Temp'
      }, {
        value: 'psal',
        label: 'Salinity'
      }]
    }), /*#__PURE__*/React.createElement(Btn, {
      size: "sm",
      onClick: () => setFiltersOpen(true)
    }, "Filters"))
  }), /*#__PURE__*/React.createElement("div", {
    className: "fc-map-wrap",
    ref: ref
  }, /*#__PURE__*/React.createElement("svg", {
    ref: svgRef,
    viewBox: '0 0 ' + width + ' ' + height,
    width: "100%",
    height: height,
    className: "fc-map",
    role: "img",
    "aria-label": 'World map with ' + marks.length + ' Argo profile markers'
  }, /*#__PURE__*/React.createElement("rect", {
    width: width,
    height: height,
    fill: "#081b23"
  }), /*#__PURE__*/React.createElement("g", {
    ref: gRef
  }, /*#__PURE__*/React.createElement("path", {
    d: geo.sphere,
    fill: "#0b2b36"
  }), /*#__PURE__*/React.createElement("path", {
    d: geo.grat,
    fill: "none",
    stroke: "rgba(139,203,196,0.09)",
    strokeWidth: "0.5"
  }), /*#__PURE__*/React.createElement("path", {
    d: geo.land,
    fill: "#0e1f25",
    stroke: "rgba(139,203,196,0.34)",
    strokeWidth: "0.6"
  }), /*#__PURE__*/React.createElement("g", {
    className: "fc-marks",
    onClick: e => {
      const id = e.target.getAttribute('data-id');
      if (id) setSelected(FC.byId[id]);
    }
  }, marks.map(({
    p,
    xy
  }) => {
    const on = selected?.profile_id === p.profile_id;
    const v = variable === 'temp' ? p.shape.sst : p.shape.surfSal;
    return /*#__PURE__*/React.createElement("circle", {
      key: p.profile_id,
      "data-id": p.profile_id,
      cx: xy[0],
      cy: xy[1],
      r: on ? 4.6 : 3.1,
      fill: scale[variable](v),
      stroke: on ? '#e6f2f0' : 'rgba(8,27,35,0.9)',
      strokeWidth: "1",
      className: "fc-mark"
    });
  }), selected && marks.some(m => m.p.profile_id === selected.profile_id) && (() => {
    const m = marks.find(x => x.p.profile_id === selected.profile_id);
    return /*#__PURE__*/React.createElement("circle", {
      cx: m.xy[0],
      cy: m.xy[1],
      r: "9",
      fill: "none",
      stroke: "#8bcbc4",
      strokeWidth: "1.2"
    });
  })()))), /*#__PURE__*/React.createElement(Legend, {
    variable: variable
  }), /*#__PURE__*/React.createElement("div", {
    className: "fc-attrib"
  }, /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs"
  }, "Coastlines: Natural Earth 110m \xB7 Observations: ERDDAP/GDAC Argo")), selected && /*#__PURE__*/React.createElement(ProfilePreview, {
    p: selected,
    onClose: () => setSelected(null),
    onDive: () => setDiving(selected)
  })), diving && /*#__PURE__*/React.createElement(DiveView, {
    p: diving,
    onClose: () => setDiving(null)
  }), /*#__PURE__*/React.createElement("div", {
    className: "fc-grid-3 fc-mt-6"
  }, /*#__PURE__*/React.createElement(Panel, {
    kicker: "Region summary",
    title: basinName
  }, /*#__PURE__*/React.createElement(DataRow, {
    k: "Profiles in view",
    v: results.length
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Distinct floats",
    v: new Set(results.map(p => p.platform)).size
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Deepest observation",
    v: results.length ? Math.max(...results.map(p => p.depth_max)) + ' m' : '—'
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Delayed-mode share",
    v: results.length ? Math.round(results.filter(p => p.data_mode === 'D').length / results.length * 100) + '%' : '—'
  })), /*#__PURE__*/React.createElement(Panel, {
    kicker: "Observation dates",
    title: "When these were recorded"
  }, /*#__PURE__*/React.createElement(DayHistogram, {
    profiles: results
  }), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, "Each bar is one UTC day of profile arrivals.")), /*#__PURE__*/React.createElement(Panel, {
    kicker: "Keyboard access",
    title: "Profiles in view"
  }, results.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    title: "Nothing in view",
    body: "No profiles match the current filters."
  }) : /*#__PURE__*/React.createElement("ul", {
    className: "fc-list",
    "aria-label": "Profiles in view"
  }, results.slice(0, 40).map(p => /*#__PURE__*/React.createElement("li", {
    key: p.profile_id
  }, /*#__PURE__*/React.createElement("button", {
    className: 'fc-list-btn' + (selected?.profile_id === p.profile_id ? ' is-on' : ''),
    onClick: () => setSelected(p)
  }, /*#__PURE__*/React.createElement(Mono, {
    className: "fc-sm"
  }, p.profile_id), /*#__PURE__*/React.createElement("span", {
    className: "fc-muted fc-xs"
  }, fmt.coord(p.latitude, p.longitude)), /*#__PURE__*/React.createElement("span", {
    className: "fc-swatch",
    style: {
      background: scale[variable](variable === 'temp' ? p.shape.sst : p.shape.surfSal)
    },
    "aria-hidden": "true"
  }))))), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, "Markers are also reachable here \u2014 first 40 of ", results.length, ".")), /*#__PURE__*/React.createElement(Panel, {
    kicker: "Structure",
    title: "Surface temperature against latitude"
  }, /*#__PURE__*/React.createElement(LatScatter, {
    profiles: results,
    variable: variable
  }), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, "One dot per profile. Colour follows the legend."))), /*#__PURE__*/React.createElement(FiltersDrawer, {
    open: filtersOpen,
    onClose: () => setFiltersOpen(false),
    state: "ok"
  }));
}
function DayHistogram({
  profiles
}) {
  const days = FC.timeSteps;
  const counts = days.map(d => profiles.filter(p => p.time.slice(0, 10) === d).length);
  const max = Math.max(1, ...counts);
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-histo",
    role: "img",
    "aria-label": "Profiles per UTC day"
  }, counts.map((c, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      height: Math.max(2, c / max * 84) + 'px'
    },
    title: days[i] + ': ' + c + ' profiles'
  })));
}
function LatScatter({
  profiles,
  variable
}) {
  const W = 260,
    H = 104;
  return /*#__PURE__*/React.createElement("svg", {
    viewBox: '0 0 ' + W + ' ' + H,
    width: "100%",
    height: H,
    role: "img",
    "aria-label": "Surface value against latitude"
  }, /*#__PURE__*/React.createElement("line", {
    x1: "0",
    y1: H / 2,
    x2: W,
    y2: H / 2,
    stroke: "rgba(139,203,196,0.18)",
    strokeWidth: "0.6"
  }), profiles.map(p => {
    const x = (p.latitude + 70) / 140 * W;
    const v = variable === 'temp' ? p.shape.sst : p.shape.surfSal;
    const dom = variable === 'temp' ? [-2, 32] : [33, 37];
    const y = H - (v - dom[0]) / (dom[1] - dom[0]) * (H - 8) - 4;
    return /*#__PURE__*/React.createElement("circle", {
      key: p.profile_id,
      cx: x,
      cy: clamp(y, 3, H - 3),
      r: "2",
      fill: scale[variable](v),
      opacity: "0.85"
    });
  }), /*#__PURE__*/React.createElement("text", {
    x: "2",
    y: H - 2,
    className: "fc-svg-tick"
  }, "70\xB0S"), /*#__PURE__*/React.createElement("text", {
    x: W - 24,
    y: H - 2,
    className: "fc-svg-tick"
  }, "70\xB0N"));
}
function GlobeScreen() {
  const app = useApp();
  const [state, setState] = React.useState('ok');
  const [rot, setRot] = React.useState([-60, -12]);
  const [anchor, setAnchor] = React.useState([60, 12]); /* the centre the user last chose — the search area and its list stay pinned here while the globe turns */
  const [spinning, setSpinning] = React.useState(true);
  const rotRef = React.useRef(rot);
  const idleTimer = React.useRef(0);
  rotRef.current = rot;
  const [zoom, setZoom] = React.useState(1);
  const [selected, setSelected] = React.useState(null);
  const [ref, w] = useElementWidth(760);
  const size = clamp(Math.min(w - 28, 520), 260, 520);
  const results = app.results;
  const svgRef = React.useRef(null);
  const geo = React.useMemo(() => {
    const proj = d3.geoOrthographic().rotate(rot).fitExtent([[10, 10], [size - 10, size - 10]], {
      type: 'Sphere'
    });
    proj.scale(proj.scale() * zoom);
    const gen = d3.geoPath(proj);
    const area = d3.geoCircle().center(anchor).radius(22)();
    return {
      proj,
      gen,
      land: FC.land ? gen(FC.land) : '',
      grat: gen(d3.geoGraticule10()),
      sphere: gen({
        type: 'Sphere'
      }),
      area: gen(area)
    };
  }, [rot, zoom, size, anchor]);
  const turning = spinning && !selected && state === 'ok';
  const hold = React.useCallback(() => {
    clearTimeout(idleTimer.current);
    setSpinning(false);
  }, []);
  const release = React.useCallback(() => {
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setSpinning(true), 2000);
  }, []);
  React.useEffect(() => () => clearTimeout(idleTimer.current), []);
  React.useEffect(() => {
    if (!turning) return;
    let raf,
      t0 = performance.now(),
      lastTick = t0,
      lastCommit = 0;
    let base = rotRef.current[0];
    const tick = now => {
      if (document.hidden || now - lastTick > 250) {
        base -= (lastTick - t0) / 1000 * 6;
        t0 = now;
      } /* rebase across a hidden tab */
      lastTick = now;
      if (!document.hidden && now - lastCommit >= 45) {
        lastCommit = now;
        /* 60s per rotation, vertical axis only. The angle comes from absolute
           elapsed time and commits at ~22fps, so the projection is not rebuilt
           on every animation frame and dropped frames do not slow the spin. */
        setRot(([, p]) => [base - (now - t0) / 1000 * 6, p]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [turning]);
  React.useEffect(() => {
    if (!svgRef.current) return;
    const drag = d3.drag().on('start', hold).on('drag', e => setRot(([l, p]) => [l + e.dx * 0.32, clamp(p - e.dy * 0.32, -85, 85)])).on('end', () => {
      const [l, p] = rotRef.current;
      setAnchor([-l, -p]);
      release();
    });
    d3.select(svgRef.current).call(drag);
    return () => d3.select(svgRef.current).on('.drag', null);
  }, [size, hold, release]);
  const centre = [-rot[0], -rot[1]];
  const visible = results.map(p => ({
    p,
    xy: geo.proj([p.longitude, p.latitude]),
    front: d3.geoDistance([p.longitude, p.latitude], centre) < Math.PI / 2
  }));
  const inArea = results.filter(p => d3.geoDistance([p.longitude, p.latitude], anchor) < 22 * Math.PI / 180);
  if (state === 'nowebgl') {
    return /*#__PURE__*/React.createElement("div", {
      className: "fc-shell"
    }, /*#__PURE__*/React.createElement(ScreenHead, {
      kicker: "Explore \xB7 Globe",
      title: "Globe view unavailable",
      states: ['ok', 'loading', 'empty', 'nowebgl'],
      state: state,
      setState: setState
    }), /*#__PURE__*/React.createElement(Panel, null, /*#__PURE__*/React.createElement(EmptyState, {
      title: "This browser cannot render the globe",
      body: "Hardware acceleration is unavailable, so the globe has been disabled. The regional map shows the same profiles with the same filters.",
      action: /*#__PURE__*/React.createElement(Btn, {
        variant: "primary",
        size: "sm",
        onClick: () => app.go('explore')
      }, "Return to regional map")
    })));
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-shell"
  }, /*#__PURE__*/React.createElement(ScreenHead, {
    kicker: "Explore \xB7 Globe",
    title: "Rotate to the region you care about",
    sub: "It turns slowly on its own. Drag to take hold and rotate it yourself, scroll the slider to zoom.",
    states: ['ok'],
    state: state,
    setState: setState,
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Seg, {
      ariaLabel: "View",
      value: "globe",
      onChange: v => v === 'map' && app.go('explore'),
      options: [{
        value: 'map',
        label: 'Map'
      }, {
        value: 'globe',
        label: 'Globe'
      }]
    }), /*#__PURE__*/React.createElement(Btn, {
      size: "sm",
      onClick: () => {
        const p = results[0];
        if (p) {
          setRot([-p.longitude, -p.latitude]);
          setAnchor([p.longitude, p.latitude]);
          hold();
          release();
        }
      }
    }, "Focus on results"), /*#__PURE__*/React.createElement(Btn, {
      variant: "primary",
      size: "sm",
      onClick: () => {
        if (selected) app.setSel({
          ...app.sel,
          profileId: selected.profile_id
        });
        app.go('depth');
      }
    }, "Explore depths"))
  }), /*#__PURE__*/React.createElement("div", {
    className: "fc-globe-layout"
  }, /*#__PURE__*/React.createElement("div", {
    className: "fc-globe-stage",
    ref: ref
  }, /*#__PURE__*/React.createElement("svg", {
    ref: svgRef,
    viewBox: '0 0 ' + size + ' ' + size,
    width: size,
    height: size,
    className: "fc-globe",
    role: "img",
    "aria-label": "Interactive globe of Argo profiles",
    onMouseEnter: hold,
    onMouseLeave: release
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("radialGradient", {
    id: "fc-globe-fill",
    cx: "36%",
    cy: "30%"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: "#175a66"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "72%",
    stopColor: "#0c2f3c"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: "#061921"
  }))), /*#__PURE__*/React.createElement("path", {
    d: geo.sphere,
    fill: "url(#fc-globe-fill)"
  }), /*#__PURE__*/React.createElement("path", {
    d: geo.grat,
    fill: "none",
    stroke: "rgba(139,203,196,0.12)",
    strokeWidth: "0.5"
  }), /*#__PURE__*/React.createElement("path", {
    d: geo.land,
    fill: "#0d2028",
    stroke: "rgba(139,203,196,0.4)",
    strokeWidth: "0.6"
  }), !turning && /*#__PURE__*/React.createElement("path", {
    d: geo.area,
    fill: "rgba(47,167,159,0.10)",
    stroke: "rgba(89,200,190,0.55)",
    strokeDasharray: "4 4",
    strokeWidth: "1"
  }), visible.filter(m => m.front).map(({
    p,
    xy
  }) => {
    const on = selected?.profile_id === p.profile_id;
    return /*#__PURE__*/React.createElement("circle", {
      key: p.profile_id,
      cx: xy[0],
      cy: xy[1],
      r: on ? 5 : 2.8,
      fill: scale.temp(p.shape.sst),
      stroke: on ? '#e6f2f0' : 'rgba(6,25,33,0.8)',
      strokeWidth: "1",
      className: "fc-mark",
      onClick: () => {
        const [l, p2] = rotRef.current;
        setAnchor([-l, -p2]);
        setSelected(p);
      }
    });
  }), /*#__PURE__*/React.createElement("path", {
    d: geo.sphere,
    fill: "none",
    stroke: "rgba(139,203,196,0.28)",
    strokeWidth: "1"
  })), /*#__PURE__*/React.createElement("div", {
    className: "fc-globe-controls"
  }, /*#__PURE__*/React.createElement("label", {
    className: "fc-row fc-gap-2"
  }, /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, "Zoom"), /*#__PURE__*/React.createElement("input", {
    type: "range",
    min: "1",
    max: "3",
    step: "0.05",
    value: zoom,
    onChange: e => setZoom(+e.target.value),
    "aria-label": "Globe zoom"
  })), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, "centre ", fmt.coord(centre[1], wrapLon(centre[0]))))), /*#__PURE__*/React.createElement(Panel, {
    kicker: "Search area",
    title: inArea.length + ' profiles in view',
    className: "fc-globe-list"
  }, inArea.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    title: "Nothing in this area",
    body: "Rotate the globe or widen the filters."
  }) : /*#__PURE__*/React.createElement("ul", {
    className: "fc-list",
    "aria-label": "Profiles inside the search area"
  }, inArea.slice(0, 40).map(p => /*#__PURE__*/React.createElement("li", {
    key: p.profile_id
  }, /*#__PURE__*/React.createElement("button", {
    className: 'fc-list-btn' + (selected?.profile_id === p.profile_id ? ' is-on' : ''),
    onClick: () => setSelected(p)
  }, /*#__PURE__*/React.createElement(Mono, {
    className: "fc-sm"
  }, p.profile_id), /*#__PURE__*/React.createElement("span", {
    className: "fc-muted fc-xs"
  }, fmt.coord(p.latitude, p.longitude), " \xB7 ", p.time.slice(0, 10)), /*#__PURE__*/React.createElement("span", {
    className: "fc-swatch",
    style: {
      background: scale.temp(p.shape.sst)
    },
    "aria-hidden": "true"
  }))))), selected && /*#__PURE__*/React.createElement("div", {
    className: "fc-mt-3"
  }, /*#__PURE__*/React.createElement(ProfilePreview, {
    p: selected,
    onClose: () => setSelected(null)
  })))));
}
window.FCScreens = Object.assign(window.FCScreens || {}, {
  explore: MapScreen,
  globe: GlobeScreen
});
Object.assign(window, {
  MapScreen,
  GlobeScreen,
  FiltersDrawer,
  Legend,
  ProfilePreview,
  BASIN_OPTS
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "prototype/fc-geo.jsx", error: String((e && e.message) || e) }); }

// prototype/fc-hero.jsx
try { (() => {
/* FloatChat — home hero. A depth-projected underwater scene on 2D canvas:
   plankton live in a 3D box and are projected through a pinhole camera, so the
   pointer's wake carries real parallax. No WebGL, so there is no unsupported path. */

function OceanScene({
  depth,
  motion,
  pointerRef
}) {
  const cv = React.useRef(null);
  const raf = React.useRef(0);
  const depthRef = React.useRef(depth);
  const motionRef = React.useRef(motion);
  depthRef.current = depth;
  motionRef.current = motion;
  React.useEffect(() => {
    const canvas = cv.current;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0,
      H = 0;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = r.width;
      H = r.height;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const rnd = rngFrom(4812);
    const N = 240;
    const parts = Array.from({
      length: N
    }, () => {
      const z = 0.55 + rnd() * 3.6;
      return {
        hx: (rnd() - 0.5) * 3.4,
        hy: (rnd() - 0.5) * 2.1,
        hz: z,
        x: 0,
        y: 0,
        z,
        vx: 0,
        vy: 0,
        vz: 0,
        ph: rnd() * 6.28,
        sp: 0.4 + rnd() * 0.9,
        big: rnd() > 0.88
      };
    });
    parts.forEach(p => {
      p.x = p.hx;
      p.y = p.hy;
    });
    const FOCAL = 1.55;
    let t = 0,
      last = performance.now();
    const draw = now => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (motionRef.current) t += dt;
      const d = depthRef.current; // 0 = surface, 1 = deep
      const cx = W / 2,
        cy = H * (0.52 - d * 0.04);
      const unit = Math.min(W, H) * 0.62;
      const ptr = pointerRef.current;

      // water column
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, d < 0.5 ? '#15505c' : '#0d3441');
      g.addColorStop(0.45, lerpHex('#11414f', '#0a2632', d));
      g.addColorStop(1, lerpHex('#08202a', '#050f16', d));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // light rays from the surface, narrowing with depth
      const rayAlpha = 0.085 * (1 - d * 0.8);
      if (rayAlpha > 0.004) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 4; i++) {
          const sway = Math.sin(t * 0.18 + i * 2.1) * W * 0.05;
          const x0 = W * (0.14 + i * 0.24) + sway;
          const spread = W * (0.055 + i * 0.012);
          const rg = ctx.createLinearGradient(x0, -H * 0.1, x0 + spread * 2, H * (0.95 - d * 0.35));
          rg.addColorStop(0, 'rgba(139,203,196,' + rayAlpha + ')');
          rg.addColorStop(1, 'rgba(139,203,196,0)');
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.moveTo(x0 - spread, -20);
          ctx.lineTo(x0 + spread, -20);
          ctx.lineTo(x0 + spread * 2.6, H * (0.95 - d * 0.3));
          ctx.lineTo(x0 + spread * 1.1, H * (0.95 - d * 0.3));
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      // plankton: pointer wake as a velocity impulse, spring back to home
      const proj = p => {
        const s = FOCAL / p.z * unit;
        return [cx + p.x * s, cy + p.y * s, s];
      };
      ctx.save();
      for (const p of parts) {
        if (motionRef.current) {
          const [sx, sy, s] = proj(p);
          if (ptr.active && ptr.speed > 0.01) {
            const dx = sx - ptr.x,
              dy = sy - ptr.y;
            const R = Math.max(W, H) * 0.22;
            const dist = Math.hypot(dx, dy);
            if (dist < R) {
              const fall = (1 - dist / R) ** 2 / Math.max(p.z * 0.5, 0.4);
              p.vx += ptr.vx / unit * fall * 2.4 + dx / (dist + 6) * 0.004 * fall;
              p.vy += ptr.vy / unit * fall * 2.4 + dy / (dist + 6) * 0.004 * fall;
              p.vz += ptr.speed / unit * fall * 0.35 * (p.big ? -1 : 1);
            }
          }
          p.vx += (p.hx - p.x) * 0.0022 + Math.sin(t * 0.3 * p.sp + p.ph) * 0.00022;
          p.vy += (p.hy - p.y) * 0.0022 + Math.cos(t * 0.24 * p.sp + p.ph) * 0.00018 + 0.00006;
          p.vz += (p.hz - p.z) * 0.0018;
          p.vx *= 0.955;
          p.vy *= 0.955;
          p.vz *= 0.94;
          p.x += p.vx;
          p.y += p.vy;
          p.z = clamp(p.z + p.vz, 0.5, 4.4);
        }
        const [sx, sy, s] = proj(p);
        if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) continue;
        const r = (p.big ? 2.3 : 1.15) * (s / unit) * 1.5;
        const near = clamp(1.25 - p.z / 4.4, 0.12, 1);
        ctx.globalAlpha = near * (0.5 - d * 0.16) + 0.06;
        ctx.fillStyle = p.big ? '#cfe9e4' : '#8bcbc4';
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(r, 0.5), 0, 6.283);
        ctx.fill();
      }
      ctx.restore();

      // Argo float schematic — surfaces into view as the camera descends
      const fa = clamp((d - 0.22) / 0.3, 0, 1);
      if (fa > 0.01) drawFloat(ctx, cx + W * 0.18, cy - H * 0.02 + Math.sin(t * 0.5) * 6 * (motionRef.current ? 1 : 0), Math.min(W, H) * 0.0013 * 100, fa, t, motionRef.current);

      // particulate haze
      ctx.fillStyle = 'rgba(5,15,22,' + (0.1 + d * 0.22) + ')';
      ctx.fillRect(0, 0, W, H);
      raf.current = requestAnimationFrame(draw);
    };
    raf.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener('resize', resize);
    };
  }, []);
  return /*#__PURE__*/React.createElement("canvas", {
    ref: cv,
    className: "fc-hero-canvas",
    "aria-hidden": "true"
  });
}
function lerpHex(a, b, t) {
  return d3.interpolateRgb(a, b)(clamp(t, 0, 1));
}

/* Schematic only: cylinder body, antenna, sensor band, ascent track with depth ticks. */
function drawFloat(ctx, x, y, k, alpha, t, moving) {
  const w = 13 * k * 0.1,
    h = 62 * k * 0.1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = 'rgba(139,203,196,0.55)';
  ctx.lineWidth = 1;
  // ascent track
  ctx.beginPath();
  ctx.setLineDash([3, 6]);
  ctx.moveTo(x, y - h * 2.6);
  ctx.lineTo(x, y + h * 2.2);
  ctx.stroke();
  ctx.setLineDash([]);
  for (let i = 0; i < 7; i++) {
    const ty = y + h * 2.2 - i / 6 * h * 4.8;
    ctx.globalAlpha = alpha * 0.5;
    ctx.beginPath();
    ctx.moveTo(x - 5, ty);
    ctx.lineTo(x + 5, ty);
    ctx.stroke();
  }
  ctx.globalAlpha = alpha;
  // body
  ctx.fillStyle = 'rgba(16,47,58,0.92)';
  ctx.strokeStyle = 'rgba(180,222,216,0.85)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, w / 2);else ctx.rect(x - w / 2, y - h / 2, w, h);
  ctx.fill();
  ctx.stroke();
  // sensor band + antenna
  ctx.strokeStyle = 'rgba(213,109,80,0.9)';
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y - h * 0.24);
  ctx.lineTo(x + w / 2, y - h * 0.24);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(180,222,216,0.8)';
  ctx.beginPath();
  ctx.moveTo(x, y - h / 2);
  ctx.lineTo(x, y - h / 2 - h * 0.34);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y - h / 2 - h * 0.36, 1.8, 0, 6.283);
  ctx.fillStyle = '#d56d50';
  ctx.fill();
  if (moving) {
    const pulse = (Math.sin(t * 1.6) + 1) / 2;
    ctx.globalAlpha = alpha * 0.35 * pulse;
    ctx.beginPath();
    ctx.arc(x, y - h / 2 - h * 0.36, 4 + pulse * 6, 0, 6.283);
    ctx.strokeStyle = '#d56d50';
    ctx.stroke();
  }
  ctx.restore();
}

/* Real coastline geometry, orthographic, framed on the dataset's centre of mass. */
function HeroGlobe({
  depth
}) {
  const [ref, w] = useElementWidth(520);
  const size = clamp(w, 240, 430);
  const [lon, setLon] = React.useState(-78);
  React.useEffect(() => {
    let raf,
      t0 = performance.now(),
      lastTick = t0,
      base = -78,
      lastCommit = 0;
    const tick = now => {
      if (document.hidden || now - lastTick > 250) {
        base -= (lastTick - t0) / 1000 * 6;
        t0 = now;
      } /* rebase across a hidden tab */
      lastTick = now;
      if (!document.hidden && now - lastCommit >= 45) {
        lastCommit = now;
        setLon(base - (now - t0) / 1000 * 6); /* absolute elapsed time — 6°/s regardless of frame rate */
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const path = React.useMemo(() => {
    if (!FC.land) return null;
    const proj = d3.geoOrthographic().rotate([lon, 8]).fitExtent([[6, 6], [size - 6, size - 6]], {
      type: 'Sphere'
    });
    const gen = d3.geoPath(proj);
    return {
      land: gen(FC.land),
      grat: gen(d3.geoGraticule10()),
      sphere: gen({
        type: 'Sphere'
      }),
      proj
    };
  }, [size, lon]);
  const marks = React.useMemo(() => {
    if (!path) return [];
    return FC.profiles.filter((_, i) => i % 7 === 0).map(p => ({
      p,
      xy: path.proj([p.longitude, p.latitude]),
      vis: d3.geoDistance([p.longitude, p.latitude], [-lon, -8]) < 1.55
    }));
  }, [path, lon]);
  const fade = clamp(1 - depth * 2.6, 0, 1);
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    className: "fc-hero-globe",
    style: {
      opacity: fade,
      transform: 'scale(' + (1 + depth * 1.8) + ')'
    }
  }, path && /*#__PURE__*/React.createElement("svg", {
    viewBox: '0 0 ' + size + ' ' + size,
    width: size,
    height: size,
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("radialGradient", {
    id: "fc-ocean-fill",
    cx: "38%",
    cy: "32%"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: "#18606c"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "70%",
    stopColor: "#0d3040"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: "#071c26"
  }))), /*#__PURE__*/React.createElement("path", {
    d: path.sphere,
    fill: "url(#fc-ocean-fill)"
  }), /*#__PURE__*/React.createElement("path", {
    d: path.grat,
    fill: "none",
    stroke: "rgba(139,203,196,0.14)",
    strokeWidth: "0.5"
  }), /*#__PURE__*/React.createElement("path", {
    d: path.land,
    fill: "#0b2129",
    stroke: "rgba(139,203,196,0.42)",
    strokeWidth: "0.6"
  }), /*#__PURE__*/React.createElement("path", {
    d: path.sphere,
    fill: "none",
    stroke: "rgba(139,203,196,0.3)",
    strokeWidth: "1"
  }), marks.filter(m => m.vis).map(m => /*#__PURE__*/React.createElement("circle", {
    key: m.p.profile_id,
    cx: m.xy[0],
    cy: m.xy[1],
    r: "1.6",
    fill: "#8bcbc4",
    opacity: "0.85"
  }))));
}
function HeroScreen() {
  const app = useApp();
  const reduced = prefersReduced();
  const [depth, setDepth] = React.useState(reduced ? 1 : 0);
  const wrap = React.useRef(null);
  const stageRef = React.useRef(null);
  const pointerRef = React.useRef({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    speed: 0,
    active: false
  });
  const coverage = React.useMemo(() => FC.coverage(), []);
  React.useEffect(() => {
    if (reduced) return;
    const onScroll = () => {
      const el = wrap.current;
      if (!el) return;
      const total = el.offsetHeight - window.innerHeight;
      setDepth(clamp((window.scrollY - el.offsetTop) / Math.max(total, 1), 0, 1));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, {
      passive: true
    });
    return () => window.removeEventListener('scroll', onScroll);
  }, [reduced]);
  React.useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let lx = 0,
      ly = 0,
      lt = performance.now();
    const move = e => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left,
        y = e.clientY - r.top;
      const now = performance.now(),
        dt = Math.max(now - lt, 8);
      const p = pointerRef.current;
      p.vx = (x - lx) * (16 / dt);
      p.vy = (y - ly) * (16 / dt);
      p.speed = Math.hypot(p.vx, p.vy);
      p.x = x;
      p.y = y;
      p.active = true;
      lx = x;
      ly = y;
      lt = now;
    };
    const leave = () => {
      pointerRef.current.active = false;
      pointerRef.current.speed = 0;
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-hero-wrap",
    ref: wrap,
    style: {
      height: reduced ? 'auto' : '280vh'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "fc-hero-stage",
    ref: stageRef,
    style: {
      position: reduced ? 'relative' : 'sticky'
    }
  }, /*#__PURE__*/React.createElement(OceanScene, {
    depth: depth,
    motion: true,
    pointerRef: pointerRef
  }), /*#__PURE__*/React.createElement("div", {
    className: "fc-hero-globe-slot"
  }, depth < 0.42 && /*#__PURE__*/React.createElement(HeroGlobe, {
    depth: depth
  })), /*#__PURE__*/React.createElement("header", {
    className: "fc-hero-nav"
  }, /*#__PURE__*/React.createElement("button", {
    className: "fc-brand",
    onClick: () => app.go('home')
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-brand-mark",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement("span", null)), "FloatChat"), /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2"
  }, NAV.map(n => /*#__PURE__*/React.createElement("button", {
    key: n.id,
    className: "fc-navlink",
    onClick: () => app.go(n.id)
  }, n.label)), /*#__PURE__*/React.createElement(AccountMenu, null))), /*#__PURE__*/React.createElement("div", {
    className: "fc-hero-copy",
    style: {
      transform: 'translateY(' + -depth * 26 + 'px)'
    }
  }, /*#__PURE__*/React.createElement(Kicker, null, "Argo global array \xB7 ", coverage.label), /*#__PURE__*/React.createElement("h1", {
    className: "fc-hero-h1"
  }, "Explore real Argo", /*#__PURE__*/React.createElement("br", null), "ocean observations."), /*#__PURE__*/React.createElement("p", {
    className: "fc-hero-lede"
  }, "Understand how temperature and salinity change with depth. Ask questions about the data that is actually available \u2014 and see the evidence behind every answer."), /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-3 fc-wrap fc-mt-4"
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    onClick: () => app.go('explore')
  }, "Explore ocean data"), /*#__PURE__*/React.createElement(Btn, {
    onClick: () => app.go('assistant')
  }, "Ask the assistant")), /*#__PURE__*/React.createElement("dl", {
    className: "fc-hero-facts"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("dt", null, "Floats"), /*#__PURE__*/React.createElement("dd", null, /*#__PURE__*/React.createElement(Mono, null, coverage.distinct_floats))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("dt", null, "Profiles"), /*#__PURE__*/React.createElement("dd", null, /*#__PURE__*/React.createElement(Mono, null, coverage.distinct_profiles))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("dt", null, "Window"), /*#__PURE__*/React.createElement("dd", null, /*#__PURE__*/React.createElement(Mono, null, coverage.date_range[0].slice(0, 10), " \u2192 ", coverage.date_range[1].slice(0, 10)))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("dt", null, "Depth"), /*#__PURE__*/React.createElement("dd", null, /*#__PURE__*/React.createElement(Mono, null, "0\u20132000 m"))))), /*#__PURE__*/React.createElement("div", {
    className: "fc-hero-controls"
  }, /*#__PURE__*/React.createElement("div", {
    className: "fc-depthmeter",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("div", {
    className: "fc-depthmeter-fill",
    style: {
      height: (depth * 100).toFixed(1) + '%'
    }
  })), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-sm fc-muted"
  }, Math.round(depth * 2000), " m")), !reduced && depth < 0.08 && /*#__PURE__*/React.createElement("div", {
    className: "fc-hero-scrollhint",
    "aria-hidden": "true"
  }, "Scroll to descend")), !reduced && /*#__PURE__*/React.createElement("p", {
    className: "fc-hero-sr"
  }, "Move the pointer through the water to drag a wake through the plankton field."));
}
window.FCScreens = Object.assign(window.FCScreens || {}, {
  home: HeroScreen
});
Object.assign(window, {
  HeroScreen,
  OceanScene,
  HeroGlobe
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "prototype/fc-hero.jsx", error: String((e && e.message) || e) }); }

// prototype/fc-profile.jsx
try { (() => {
/* FloatChat — profile details and comparison. Depth runs downward on the y axis;
   values on x. Nothing is interpolated across gaps: a break in the data is a break
   in the line. */

function DepthChart({
  series,
  variable,
  height = 460,
  showGrid = true,
  svgRef
}) {
  const [ref, w] = useElementWidth(680);
  const [hover, setHover] = React.useState(null);
  const width = clamp(w, 280, 1000);
  const pad = {
    l: 56,
    r: 18,
    t: 18,
    b: 40
  };
  const key = variable === 'temp' ? 'temp' : 'psal';
  const all = series.flatMap(s => s.obs.filter(o => o[key] != null));
  if (!all.length) return /*#__PURE__*/React.createElement("div", {
    ref: ref
  }, /*#__PURE__*/React.createElement(EmptyState, {
    title: "No valid levels",
    body: 'This profile carries no ' + (variable === 'temp' ? 'temperature' : 'salinity') + ' values that pass QC.'
  }));
  const vMin = Math.min(...all.map(o => o[key])),
    vMax = Math.max(...all.map(o => o[key]));
  const pad0 = (vMax - vMin) * 0.08 || 0.4;
  const dom = [vMin - pad0, vMax + pad0];
  const dMax = Math.max(...series.flatMap(s => s.obs.map(o => o.depth)));
  const x = v => pad.l + (v - dom[0]) / (dom[1] - dom[0]) * (width - pad.l - pad.r);
  const y = d => pad.t + d / dMax * (height - pad.t - pad.b);
  const segs = obs => {
    const out = [];
    let cur = [];
    obs.forEach((o, i) => {
      const gap = i > 0 && o.depth - obs[i - 1].depth > 120;
      if (o[key] == null || gap) {
        if (cur.length > 1) out.push(cur);
        cur = o[key] == null ? [] : [o];
        return;
      }
      cur.push(o);
    });
    if (cur.length > 1) out.push(cur);
    return out;
  };
  const line = d3.line().x(o => x(o[key])).y(o => y(o.depth)).curve(d3.curveLinear);
  const vTicks = d3.ticks(dom[0], dom[1], 5);
  const dTicks = d3.ticks(0, dMax, 6);
  const onMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const py = (e.clientY - rect.top) / rect.height * height;
    const depth = clamp((py - pad.t) / (height - pad.t - pad.b) * dMax, 0, dMax);
    const rows = series.map(s => {
      let best = null,
        bd = 1e9;
      for (const o of s.obs) {
        const d = Math.abs(o.depth - depth);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      return {
        s,
        o: best
      };
    }).filter(r => r.o);
    setHover({
      depth: rows[0]?.o.depth ?? depth,
      rows,
      py: y(rows[0]?.o.depth ?? depth)
    });
  };
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    className: "fc-chart-wrap"
  }, /*#__PURE__*/React.createElement("svg", {
    ref: svgRef,
    viewBox: '0 0 ' + width + ' ' + height,
    width: "100%",
    height: height,
    className: "fc-chart",
    role: "img",
    "aria-label": 'Depth profile of ' + (variable === 'temp' ? 'temperature' : 'salinity'),
    onMouseMove: onMove,
    onMouseLeave: () => setHover(null)
  }, /*#__PURE__*/React.createElement("rect", {
    width: width,
    height: height,
    fill: "#0b1e26"
  }), showGrid && dTicks.map(d => /*#__PURE__*/React.createElement("g", {
    key: 'd' + d
  }, /*#__PURE__*/React.createElement("line", {
    x1: pad.l,
    x2: width - pad.r,
    y1: y(d),
    y2: y(d),
    stroke: "rgba(139,203,196,0.10)",
    strokeWidth: "0.6"
  }), /*#__PURE__*/React.createElement("text", {
    x: pad.l - 8,
    y: y(d) + 4,
    textAnchor: "end",
    className: "fc-svg-tick"
  }, d))), vTicks.map(v => /*#__PURE__*/React.createElement("g", {
    key: 'v' + v
  }, /*#__PURE__*/React.createElement("line", {
    x1: x(v),
    x2: x(v),
    y1: pad.t,
    y2: height - pad.b,
    stroke: "rgba(139,203,196,0.07)",
    strokeWidth: "0.6"
  }), /*#__PURE__*/React.createElement("text", {
    x: x(v),
    y: height - pad.b + 16,
    textAnchor: "middle",
    className: "fc-svg-tick"
  }, variable === 'temp' ? v.toFixed(0) : v.toFixed(1)))), /*#__PURE__*/React.createElement("text", {
    x: pad.l - 40,
    y: pad.t - 6,
    className: "fc-svg-label"
  }, "Depth m"), /*#__PURE__*/React.createElement("text", {
    x: width - pad.r,
    y: height - 8,
    textAnchor: "end",
    className: "fc-svg-label"
  }, variable === 'temp' ? 'Temperature °C' : 'Salinity PSU'), series.map(s => /*#__PURE__*/React.createElement("g", {
    key: s.id
  }, segs(s.obs).map((seg, i) => /*#__PURE__*/React.createElement("path", {
    key: i,
    d: line(seg),
    fill: "none",
    stroke: s.color,
    strokeWidth: "1.8",
    strokeDasharray: s.dashed ? '6 4' : undefined
  })), s.obs.filter(o => o[key] != null).filter((_, i) => i % 2 === 0).map(o => s.square ? /*#__PURE__*/React.createElement("rect", {
    key: o.depth,
    x: x(o[key]) - 2.6,
    y: y(o.depth) - 2.6,
    width: "5.2",
    height: "5.2",
    fill: "#0b1e26",
    stroke: s.color,
    strokeWidth: "1.1"
  }) : /*#__PURE__*/React.createElement("circle", {
    key: o.depth,
    cx: x(o[key]),
    cy: y(o.depth),
    r: "2.6",
    fill: "#0b1e26",
    stroke: s.color,
    strokeWidth: "1.1"
  })), s.obs.filter(o => o[key] == null).map(o => /*#__PURE__*/React.createElement("line", {
    key: 'm' + o.depth,
    x1: pad.l,
    x2: pad.l + 10,
    y1: y(o.depth),
    y2: y(o.depth),
    stroke: "#54696f",
    strokeWidth: "1.4"
  })))), hover && /*#__PURE__*/React.createElement("g", null, /*#__PURE__*/React.createElement("line", {
    x1: pad.l,
    x2: width - pad.r,
    y1: hover.py,
    y2: hover.py,
    stroke: "rgba(230,242,240,0.42)",
    strokeWidth: "0.8",
    strokeDasharray: "3 3"
  }))), hover && /*#__PURE__*/React.createElement("div", {
    className: "fc-tip",
    style: {
      top: hover.py / height * 100 + '%'
    }
  }, /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs"
  }, Math.round(hover.depth), " m"), hover.rows.map(({
    s,
    o
  }) => /*#__PURE__*/React.createElement(Mono, {
    key: s.id,
    className: "fc-xs",
    style: {
      color: s.color
    }
  }, s.label, ": ", variable === 'temp' ? fmt.t(o.temp) : fmt.s(o.psal)))));
}
function ProfileScreen() {
  const app = useApp();
  const [state, setState] = React.useState('ok');
  const [variable, setVariable] = React.useState('temp');
  const [mode, setMode] = React.useState(app.session.detail);
  const svgRef = React.useRef(null);
  const p = FC.byId[app.sel.profileId] || FC.profiles[0];
  const floatProfiles = React.useMemo(() => FC.profiles.filter(x => x.platform === p.platform), [p.platform]);
  const i = floatProfiles.findIndex(x => x.profile_id === p.profile_id);
  const obs = React.useMemo(() => state === 'empty' ? [] : FC.observations(p.profile_id), [p.profile_id, state]);
  const st = React.useMemo(() => FC.stats(p.profile_id), [p.profile_id]);
  const woa = React.useMemo(() => FC.woaMatch(p.profile_id), [p.profile_id]);
  const setProfile = id => app.setSel({
    ...app.sel,
    profileId: id
  });
  const platforms = [...new Set(FC.profiles.map(x => x.platform))];
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-shell"
  }, /*#__PURE__*/React.createElement(ScreenHead, {
    kicker: "Profile details",
    title: 'Float ' + p.platform + ' · cycle ' + p.cycle,
    sub: fmt.utc(p.time) + ' · ' + fmt.coord(p.latitude, p.longitude) + ' · ' + p.depth_min + '–' + p.depth_max + ' m',
    states: ['ok', 'loading', 'empty', 'error', 'fallback'],
    state: state,
    setState: setState,
    actions: /*#__PURE__*/React.createElement(Seg, {
      ariaLabel: "Reading",
      value: mode,
      onChange: setMode,
      options: [{
        value: 'simple',
        label: 'Simple'
      }, {
        value: 'detailed',
        label: 'Detailed'
      }]
    })
  }), /*#__PURE__*/React.createElement("div", {
    className: "fc-selectors"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Float"
  }, /*#__PURE__*/React.createElement(Select, {
    value: p.platform,
    onChange: v => setProfile(FC.profiles.find(x => x.platform === v).profile_id),
    options: platforms.map(v => ({
      value: v,
      label: v
    }))
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Observation"
  }, /*#__PURE__*/React.createElement(Select, {
    value: p.profile_id,
    onChange: setProfile,
    options: floatProfiles.map(x => ({
      value: x.profile_id,
      label: 'Cycle ' + x.cycle + ' — ' + x.time.slice(0, 10)
    }))
  })), /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2 fc-selectors-nav"
  }, /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    disabled: i <= 0,
    onClick: () => setProfile(floatProfiles[i - 1].profile_id)
  }, "\u2039 Previous"), /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    disabled: i >= floatProfiles.length - 1,
    onClick: () => setProfile(floatProfiles[i + 1].profile_id)
  }, "Next \u203A"), /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    onClick: () => {
      app.setSel({
        ...app.sel,
        compareA: p.profile_id
      });
      app.go('compare');
    }
  }, "Compare"), /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    onClick: () => app.go('explore')
  }, "View on map"))), state === 'fallback' && /*#__PURE__*/React.createElement(Notice, {
    tone: "info"
  }, "Served from ", /*#__PURE__*/React.createElement("strong", null, "cached historical observations"), "; the live GDAC index did not respond."), /*#__PURE__*/React.createElement("div", {
    className: "fc-profile-layout"
  }, /*#__PURE__*/React.createElement(Panel, {
    kicker: p.profile_id,
    title: variable === 'temp' ? 'Temperature against depth' : 'Salinity against depth',
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Seg, {
      ariaLabel: "Variable",
      value: variable,
      onChange: setVariable,
      options: [{
        value: 'temp',
        label: 'Temperature'
      }, {
        value: 'psal',
        label: 'Salinity'
      }]
    }), /*#__PURE__*/React.createElement(Btn, {
      size: "sm",
      onClick: () => exportSvgPng(svgRef.current, p.profile_id + '-' + variable + '.png')
    }, "Export PNG"))
  }, state === 'loading' && /*#__PURE__*/React.createElement(Loading, {
    label: 'Reading ' + p.profile_id,
    lines: 4
  }), state === 'error' && /*#__PURE__*/React.createElement(ErrorState, {
    body: "This profile could not be read.",
    detail: 'GET /api/profiles/' + p.profile_id + ' → 404 Profile not found',
    onRetry: () => setState('ok')
  }), state === 'empty' && /*#__PURE__*/React.createElement(EmptyState, {
    title: "No levels returned",
    body: "Every level in this profile failed QC, so nothing can be plotted."
  }), (state === 'ok' || state === 'fallback') && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(DepthChart, {
    svgRef: svgRef,
    variable: variable,
    series: [{
      id: 'a',
      label: p.platform,
      color: '#59c8be',
      obs
    }]
  }), /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-4 fc-wrap fc-mt-2"
  }, /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, st?.levels, " levels \xB7 ", variable === 'temp' ? st?.missingTemp : st?.missingPsal, " missing"), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, "units: ", variable === 'temp' ? '°C (ITS-90)' : 'PSU (PSS-78)'), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, "depth derived from pressure \u25B2")))), /*#__PURE__*/React.createElement("div", {
    className: "fc-profile-side"
  }, /*#__PURE__*/React.createElement(Panel, {
    kicker: "Metadata",
    title: "Observation"
  }, /*#__PURE__*/React.createElement(DataRow, {
    k: "Profile ID",
    v: p.profile_id
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Observed (UTC)",
    v: fmt.utc(p.time)
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Location",
    v: fmt.coord(p.latitude, p.longitude)
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Depth range",
    v: p.depth_min + '–' + p.depth_max + ' m',
    note: "Derived from pressure"
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Temperature (surface)",
    v: fmt.t(st?.sst)
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Salinity (surface)",
    v: fmt.s(st?.salSurface)
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Direction",
    v: p.direction === 'A' ? 'Ascending' : 'Descending'
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Data mode",
    v: fmt.mode(p.data_mode)
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Levels (T / S)",
    v: p.temp_count + ' / ' + p.psal_count
  })), /*#__PURE__*/React.createElement(Accordion, {
    title: "Changes with depth",
    open: true
  }, mode === 'simple' ? /*#__PURE__*/React.createElement("p", {
    className: "fc-sm"
  }, "The water is warmest at the surface, around ", /*#__PURE__*/React.createElement(Mono, null, fmt.t(st?.sst)), ". It stays close to that down to about ", /*#__PURE__*/React.createElement(Mono, null, fmt.m(st?.mldDepth)), ", then cools quickly through the thermocline near ", /*#__PURE__*/React.createElement(Mono, null, fmt.m(st?.thermoDepth)), ", reaching ", /*#__PURE__*/React.createElement(Mono, null, fmt.t(st?.deepT)), " at ", /*#__PURE__*/React.createElement(Mono, null, fmt.m(st?.deepDepth)), ".") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(DataRow, {
    k: "Surface value",
    v: fmt.t(st?.sst)
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Mixed layer base",
    v: fmt.m(st?.mldDepth),
    note: "0.2 \xB0C criterion from the shallowest level"
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Strongest gradient",
    v: st ? st.maxGrad.toFixed(3) + ' °C/m at ' + fmt.m(st.thermoDepth) : '—'
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Deepest value",
    v: fmt.t(st?.deepT) + ' at ' + fmt.m(st?.deepDepth)
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Salinity range",
    v: st?.salRange ? st.salRange[0].toFixed(3) + '–' + st.salRange[1].toFixed(3) + ' PSU' : '—'
  }))), /*#__PURE__*/React.createElement(Accordion, {
    title: "WOA comparison"
  }, woa.status === 'Success' ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(DataRow, {
    k: "Comparison depth",
    v: woa.comparison_depth + ' m'
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Argo (interpolated)",
    v: woa.argo_interpolated_value.toFixed(3) + ' °C',
    note: "Linear interpolation within a 20 m maximum gap"
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "WOA reference",
    v: woa.woa_reference_value.toFixed(3) + ' °C'
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Difference",
    v: (woa.difference > 0 ? '+' : '') + woa.difference.toFixed(3) + ' °C'
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Baseline",
    v: 'WOA23 ' + woa.baseline_period + ', month ' + woa.month
  }), mode === 'detailed' && /*#__PURE__*/React.createElement(DataRow, {
    k: "Spatial offset",
    v: woa.spatial_offset.lat + '°, ' + woa.spatial_offset.lon + '°',
    note: "Nearest-neighbour grid cell"
  }), /*#__PURE__*/React.createElement(Notice, {
    tone: "info"
  }, "A difference is not a trend. One profile against a 30-year monthly climatology says only how this cast compares to that average.")) : /*#__PURE__*/React.createElement(EmptyState, {
    title: "Comparison unavailable",
    body: woa.reason
  })), mode === 'detailed' && /*#__PURE__*/React.createElement(Accordion, {
    title: "Scientific details"
  }, /*#__PURE__*/React.createElement(DataRow, {
    k: "Temperature QC",
    v: "Flags 1\u20132 retained; 3\u20134 and 9 dropped"
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Salinity QC",
    v: st?.missingPsal ? st.missingPsal + ' levels dropped' : 'no levels dropped'
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Pressure field",
    v: "PRES_ADJUSTED"
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Depth conversion",
    v: "Gravity-corrected from pressure \u25B2"
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Vertical gaps",
    v: "Not interpolated \u2014 the line breaks"
  })), /*#__PURE__*/React.createElement(Accordion, {
    title: "Provenance"
  }, /*#__PURE__*/React.createElement(DataRow, {
    k: "Source",
    v: "ERDDAP / Argo GDAC"
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Dataset",
    v: "argo_profiles + argo_observations"
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Retrieved",
    v: "2024-01-11 06:12 UTC"
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Marine heatwave detection",
    v: "Not yet available"
  }), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, "Argo data are collected and made freely available by the International Argo Program and the national programmes that contribute to it.")))));
}
function CompareScreen() {
  const app = useApp();
  const [state, setState] = React.useState('ok');
  const [variable, setVariable] = React.useState('temp');
  const svgRef = React.useRef(null);
  const a = FC.byId[app.sel.compareA] || FC.profiles[0];
  const b = FC.byId[app.sel.compareB] || FC.profiles[1];
  const obsA = React.useMemo(() => FC.observations(a.profile_id), [a.profile_id]);
  const obsB = React.useMemo(() => FC.observations(b.profile_id), [b.profile_id]);
  const stA = FC.stats(a.profile_id),
    stB = FC.stats(b.profile_id);
  const opts = FC.profiles.map(p => ({
    value: p.profile_id,
    label: p.profile_id + ' — ' + p.basinName + ' — ' + p.time.slice(0, 10)
  }));
  const key = variable === 'temp' ? 'temp' : 'psal';
  const overlap = obsA.filter(o => o[key] != null && obsB.some(x => x.depth === o.depth && x[key] != null));
  const diffs = overlap.map(o => o[key] - obsB.find(x => x.depth === o.depth)[key]);
  const meanDiff = diffs.length ? diffs.reduce((s, v) => s + v, 0) / diffs.length : null;
  return /*#__PURE__*/React.createElement("div", {
    className: "fc-shell"
  }, /*#__PURE__*/React.createElement(ScreenHead, {
    kicker: "Compare",
    title: "Two profiles on shared axes",
    sub: "Same axes, same units, depth downward. Only levels present in both profiles are differenced.",
    states: ['ok'],
    state: state,
    setState: setState,
    actions: /*#__PURE__*/React.createElement(Seg, {
      ariaLabel: "Variable",
      value: variable,
      onChange: setVariable,
      options: [{
        value: 'temp',
        label: 'Temperature'
      }, {
        value: 'psal',
        label: 'Salinity'
      }]
    })
  }), /*#__PURE__*/React.createElement("div", {
    className: "fc-selectors"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Profile A",
    hint: "Solid line, circles"
  }, /*#__PURE__*/React.createElement(Select, {
    value: a.profile_id,
    onChange: v => app.setSel({
      ...app.sel,
      compareA: v
    }),
    options: opts
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Profile B",
    hint: "Dashed line, squares"
  }, /*#__PURE__*/React.createElement(Select, {
    value: b.profile_id,
    onChange: v => app.setSel({
      ...app.sel,
      compareB: v
    }),
    options: opts
  }))), /*#__PURE__*/React.createElement("div", {
    className: "fc-profile-layout"
  }, /*#__PURE__*/React.createElement(Panel, {
    kicker: "Shared axes",
    title: variable === 'temp' ? 'Temperature against depth' : 'Salinity against depth',
    actions: /*#__PURE__*/React.createElement(Btn, {
      size: "sm",
      onClick: () => exportSvgPng(svgRef.current, a.profile_id + '-vs-' + b.profile_id + '.png')
    }, "Export PNG")
  }, /*#__PURE__*/React.createElement(DepthChart, {
    svgRef: svgRef,
    variable: variable,
    series: [{
      id: 'a',
      label: a.platform + ' A',
      color: '#59c8be',
      obs: obsA
    }, {
      id: 'b',
      label: b.platform + ' B',
      color: '#d56d50',
      obs: obsB,
      dashed: true,
      square: true
    }]
  }), /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-4 fc-wrap fc-mt-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-key"
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-key-line",
    style: {
      background: '#59c8be'
    }
  }), "A \xB7 ", a.profile_id), /*#__PURE__*/React.createElement("span", {
    className: "fc-key"
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-key-line is-dash",
    style: {
      background: '#d56d50'
    }
  }), "B \xB7 ", b.profile_id), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, overlap.length, " shared levels"))), /*#__PURE__*/React.createElement("div", {
    className: "fc-profile-side"
  }, /*#__PURE__*/React.createElement(Panel, {
    kicker: "Difference",
    title: meanDiff == null ? 'No shared levels' : 'A − B, mean ' + (meanDiff > 0 ? '+' : '') + meanDiff.toFixed(3) + (variable === 'temp' ? ' °C' : ' PSU')
  }, /*#__PURE__*/React.createElement(DataRow, {
    k: "Shared levels",
    v: overlap.length
  }), /*#__PURE__*/React.createElement(DataRow, {
    k: "Largest difference",
    v: diffs.length ? Math.max(...diffs.map(Math.abs)).toFixed(3) + (variable === 'temp' ? ' °C' : ' PSU') : '—'
  }), /*#__PURE__*/React.createElement(Notice, {
    tone: "info"
  }, "Differences are taken level by level. Where either profile is missing a level, no difference is computed.")), /*#__PURE__*/React.createElement(Panel, {
    kicker: "Side by side",
    title: "Profile summaries"
  }, /*#__PURE__*/React.createElement("table", {
    className: "fc-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null), /*#__PURE__*/React.createElement("th", null, "A"), /*#__PURE__*/React.createElement("th", null, "B"))), /*#__PURE__*/React.createElement("tbody", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, "Float"), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Mono, null, a.platform)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Mono, null, b.platform))), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, "Region"), /*#__PURE__*/React.createElement("td", null, a.basinName), /*#__PURE__*/React.createElement("td", null, b.basinName)), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, "Observed"), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Mono, null, a.time.slice(0, 10))), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Mono, null, b.time.slice(0, 10)))), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, "Surface T"), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Mono, null, fmt.t(stA?.sst))), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Mono, null, fmt.t(stB?.sst)))), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, "Mixed layer"), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Mono, null, fmt.m(stA?.mldDepth))), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Mono, null, fmt.m(stB?.mldDepth)))), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, "Max depth"), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Mono, null, a.depth_max, " m")), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Mono, null, b.depth_max, " m"))), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, "Data mode"), /*#__PURE__*/React.createElement("td", null, fmt.mode(a.data_mode)), /*#__PURE__*/React.createElement("td", null, fmt.mode(b.data_mode)))))))));
}
window.FCScreens = Object.assign(window.FCScreens || {}, {
  profile: ProfileScreen,
  compare: CompareScreen
});
Object.assign(window, {
  DepthChart,
  ProfileScreen,
  CompareScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "prototype/fc-profile.jsx", error: String((e && e.message) || e) }); }

// prototype/fc-session.js
try { (() => {
/* FloatChat session handoff. Written by Auth.html, read by the app on load.
   Mock only — no backend, no token, no secret. */
(() => {
  const KEY = 'fc-session';
  const store = {
    read() {
      try {
        const raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
    write(session) {
      try {
        localStorage.setItem(KEY, JSON.stringify(session));
      } catch (e) {}
    },
    clear() {
      try {
        localStorage.removeItem(KEY);
      } catch (e) {}
    }
  };
  window.FCSession = store;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "prototype/fc-session.js", error: String((e && e.message) || e) }); }

// prototype/fc-widget.jsx
try { (() => {
/* Floating assistant widget — Phosphor Eye trigger plus a compact chat panel.
   Built from the design-system component classes (.card, .dialog, .field, .input,
   .btn, .btn-primary); the widget root rebinds --color-accent / --color-surface /
   --color-bg to this page's ocean tokens, so no new colour, radius or shadow is
   introduced and the widget still belongs to the screen it floats over. */

const WIDGET_STORAGE = 'fc-widget-open';
function FCWidget() {
  const app = useApp();
  const [msgs, setMsgs] = FCChat.useChat();
  const unread = FCChat.useUnread();
  const [open, setOpen] = React.useState(() => {
    try {
      return localStorage.getItem(WIDGET_STORAGE) === '1';
    } catch (e) {
      return false;
    }
  });
  const [input, setInput] = React.useState('');
  const [thinking, setThinking] = React.useState(false);
  const rootRef = React.useRef(null);
  const logRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const btnRef = React.useRef(null);
  const wasOpen = React.useRef(open);
  React.useEffect(() => {
    try {
      localStorage.setItem(WIDGET_STORAGE, open ? '1' : '0');
    } catch (e) {}
  }, [open]);
  React.useEffect(() => {
    if (open) FCChat.clearUnread();
  }, [open, msgs]);

  // focus into the panel on open, back to the trigger on close
  React.useEffect(() => {
    if (open) inputRef.current?.focus();else if (wasOpen.current) btnRef.current?.focus();
    wasOpen.current = open;
  }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const away = e => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  React.useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [msgs, thinking, open]);
  const send = text => {
    const t = (text ?? input).trim();
    if (!t) return;
    setInput('');
    setMsgs(m => [...m, {
      role: 'user',
      body: t
    }]);
    setThinking(true);
    setTimeout(() => {
      setThinking(false);
      setMsgs(m => [...m, {
        role: 'assistant',
        ...makeReply(t, app)
      }]);
      if (!open) FCChat.markUnread();
    }, 780);
  };
  const openFull = () => {
    setOpen(false);
    app.go('assistant');
  };
  if (app.screen === 'assistant') return null;
  return /*#__PURE__*/React.createElement("div", {
    className: 'fc-widget' + (app.screen === 'home' ? ' on-hero' : ''),
    ref: rootRef
  }, open && /*#__PURE__*/React.createElement("div", {
    className: "fc-widget-panel card dialog elev-md",
    role: "dialog",
    "aria-label": "AI Assistant",
    "aria-modal": "false"
  }, /*#__PURE__*/React.createElement("header", {
    className: "fc-widget-head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "card-kicker"
  }, "FloatChat"), /*#__PURE__*/React.createElement("h4", {
    className: "dialog-title fc-widget-title"
  }, "AI Assistant")), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-ghost btn-icon",
    onClick: () => setOpen(false),
    "aria-label": "Close assistant"
  }, /*#__PURE__*/React.createElement("i", {
    className: "ph ph-x",
    "aria-hidden": "true"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "fc-widget-log",
    ref: logRef,
    role: "log",
    "aria-live": "polite"
  }, msgs.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: 'fc-widget-msg' + (m.role === 'user' ? ' is-user' : '')
  }, m.role === 'assistant' && m.kind && m.kind !== 'explain' && /*#__PURE__*/React.createElement("span", {
    className: "card-kicker"
  }, {
    clarify: 'Clarification',
    proposal: 'Query proposal',
    unsupported: 'Unsupported',
    nodata: 'No data',
    evidence: 'Evidence'
  }[m.kind] || 'Explanation'), /*#__PURE__*/React.createElement("p", {
    className: "fc-widget-body"
  }, m.body), m.meta && /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, m.meta), m.chips && /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2 fc-wrap fc-mt-2"
  }, m.chips.map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    className: "fc-chip",
    onClick: () => send(c)
  }, c))), m.evidence && /*#__PURE__*/React.createElement("div", {
    className: "fc-widget-evidence"
  }, m.evidence.map(([k, v]) => /*#__PURE__*/React.createElement(DataRow, {
    key: k,
    k: k,
    v: v
  }))), m.proposal && /*#__PURE__*/React.createElement("div", {
    className: "fc-widget-proposal"
  }, /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs"
  }, m.proposal.summary), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, m.proposal.count, " profiles match"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-primary fc-widget-send",
    onClick: openFull
  }, "Review in assistant")), m.actions && /*#__PURE__*/React.createElement("button", {
    className: "btn btn-ghost fc-widget-link",
    onClick: openFull
  }, "Open the full assistant"))), thinking && /*#__PURE__*/React.createElement("div", {
    className: "fc-widget-msg"
  }, /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-spinner",
    "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement(Mono, {
    className: "fc-xs fc-muted"
  }, "Reading the loaded profiles\u2026")))), /*#__PURE__*/React.createElement("form", {
    className: "field fc-widget-composer",
    onSubmit: e => {
      e.preventDefault();
      send();
    }
  }, /*#__PURE__*/React.createElement("label", {
    htmlFor: "fc-widget-input"
  }, "Ask about the available data"), /*#__PURE__*/React.createElement("div", {
    className: "fc-row fc-gap-2"
  }, /*#__PURE__*/React.createElement("input", {
    id: "fc-widget-input",
    ref: inputRef,
    className: "input",
    value: input,
    onChange: e => setInput(e.target.value),
    placeholder: "Regions, depths, temperature\u2026"
  }), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    className: "btn btn-primary fc-widget-send",
    disabled: !input.trim()
  }, "Send")))), /*#__PURE__*/React.createElement("button", {
    ref: btnRef,
    className: "btn fc-widget-trigger",
    onClick: () => setOpen(o => !o),
    "aria-expanded": open,
    "aria-label": open ? 'Close AI Assistant' : 'Open AI Assistant'
  }, /*#__PURE__*/React.createElement("i", {
    className: "ph ph-eye",
    "aria-hidden": "true"
  }), !open && unread > 0 && /*#__PURE__*/React.createElement("span", {
    className: "fc-widget-dot",
    "aria-hidden": "true"
  })));
}
Object.assign(window, {
  FCWidget
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "prototype/fc-widget.jsx", error: String((e && e.message) || e) }); }

})();
