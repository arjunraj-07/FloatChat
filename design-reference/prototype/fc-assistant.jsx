/* FloatChat — AI assistant, analysis and about. The assistant only ever proposes a
   query against data that exists; it never answers beyond the loaded subset. */

const SUGGESTIONS = [
  'Show me salinity profiles in the Arabian Sea in January',
  'How does temperature change with depth here?',
  'Compare this profile with the climatology',
  'What was the sea surface temperature in 1950?',
  'Predict next month’s temperature',
];

function makeReply(text, ctx) {
  const q = text.toLowerCase();
  const anchor = FC.byId[ctx.sel.profileId];
  if (/1950|1980|1999|last century|decade/.test(q)) {
    return { kind: 'nodata', body: 'The loaded subset covers January to March 2024 only. There are no observations before 2024-01-01 in this deployment, so this question cannot be answered from the available data.', meta: 'Coverage: ' + FC.coverage().date_range[0].slice(0, 10) + ' → ' + FC.coverage().date_range[1].slice(0, 10) };
  }
  if (/predict|forecast|will be|next month|future/.test(q)) {
    return { kind: 'unsupported', body: 'Forecasting is out of scope. FloatChat reads recorded Argo observations and compares them with climatology; it does not run or serve predictive models.', meta: 'Unsupported request' };
  }
  if (/salinity|temperature|profiles?/.test(q) && /(in|near|around)\s|sea|ocean|atlantic|pacific|indian/.test(q)) {
    const basin = /arabian|bengal/.test(q) ? 'arabian-sea' : /atlantic/.test(q) ? 'north-atlantic' : /pacific/.test(q) ? 'north-pacific' : /indian/.test(q) ? 'indian' : 'all';
    const filters = { ...FC.defaultFilters, basin, start: '2024-01-01', end: '2024-01-31', depthMin: 0, depthMax: 2000 };
    const count = FC.filter(filters).length;
    return {
      kind: 'proposal', body: 'I can narrow the map to that. Here is the query I would run — check it before applying.',
      proposal: {
        summary: (basin === 'all' ? 'All basins' : BASIN_OPTS.find((b) => b.value === basin).label) + ' · 2024-01-01 → 2024-01-31 · 0–2000 m',
        count, filters,
        details: [
          ['Region', basin === 'all' ? 'global' : basin],
          ['Date window', '2024-01-01 → 2024-01-31 (UTC)'],
          ['Depth band', '0–2000 m, bracketed levels only'],
          ['Variables', /salinity/.test(q) ? 'PSAL (PSS-78)' : 'TEMP (ITS-90)'],
          ['QC', 'flags 1–2 retained'],
          ['Endpoint', 'GET /api/floats → filter client-side'],
        ],
      },
    };
  }
  if (/change.*depth|thermocline|mixed layer|how does/.test(q)) {
    const st = FC.stats(anchor.profile_id);
    return {
      kind: 'evidence',
      body: 'In ' + anchor.profile_id + ', recorded ' + fmt.utc(anchor.time) + ' at ' + fmt.coord(anchor.latitude, anchor.longitude) + ', temperature holds near ' + fmt.t(st.sst) + ' down to about ' + fmt.m(st.mldDepth) + '. Below that it falls steeply — the strongest gradient is ' + st.maxGrad.toFixed(3) + ' °C/m near ' + fmt.m(st.thermoDepth) + ' — and reaches ' + fmt.t(st.deepT) + ' at ' + fmt.m(st.deepDepth) + '.',
      evidence: [['Profile', anchor.profile_id], ['Levels used', st.levels + ' (QC 1–2)'], ['Missing levels', st.missingTemp + ' temperature, ' + st.missingPsal + ' salinity'], ['Depth source', 'derived from PRES_ADJUSTED ▲']],
      actions: true,
    };
  }
  if (/climatolog|woa|compare/.test(q)) {
    const w = FC.woaMatch(anchor.profile_id);
    if (w.status !== 'Success') return { kind: 'nodata', body: 'A climatology comparison is not possible for ' + anchor.profile_id + ': ' + w.reason.toLowerCase() + '. No extrapolation is performed, so no value is reported.', meta: 'woa_match → Comparison unavailable' };
    return {
      kind: 'evidence',
      body: 'At ' + w.comparison_depth + ' m, ' + anchor.profile_id + ' interpolates to ' + w.argo_interpolated_value.toFixed(2) + ' °C against a WOA23 ' + w.baseline_period + ' reference of ' + w.woa_reference_value.toFixed(2) + ' °C — a difference of ' + (w.difference > 0 ? '+' : '') + w.difference.toFixed(2) + ' °C. One cast against a monthly average is not a trend.',
      evidence: [['Method', w.method], ['Month', String(w.month)], ['Spatial offset', w.spatial_offset.lat + '°, ' + w.spatial_offset.lon + '°']],
      actions: true,
    };
  }
  if (q.trim().length < 12) {
    return { kind: 'clarify', body: 'I can help with that — which region and which time window? The loaded subset runs 2024-01-01 to 2024-03-31 across seven basins.', chips: ['Arabian Sea, January', 'North Atlantic, February', 'Southern Ocean, March'] };
  }
  return {
    kind: 'explain',
    body: 'Argo floats drift at about 1 000 m, then rise to the surface every ten days, recording temperature and salinity as they climb. Each rise produces one profile — a single vertical column of measurements — which is what FloatChat reads. There are ' + FC.profiles.length + ' such profiles from ' + FC.floats.length + ' floats loaded here.',
  };
}

function ProposalCard({ msg, stale, onApply, onDiscard }) {
  const [open, setOpen] = React.useState(false);
  const p = msg.proposal;
  return (
    <div className={'fc-proposal' + (stale ? ' is-stale' : '')}>
      <header className="fc-row fc-between fc-wrap fc-gap-2">
        <div><Kicker>Query proposal</Kicker><Mono className="fc-sm">{p.summary}</Mono></div>
        {stale ? <Tag tone="coral">Stale — filters changed</Tag> : <Tag tone="accent">{p.count} profiles</Tag>}
      </header>
      {open && <div className="fc-mt-3">{p.details.map(([k, v]) => <DataRow key={k} k={k} v={v} />)}</div>}
      <div className="fc-row fc-gap-2 fc-mt-3 fc-wrap">
        <Btn variant="primary" size="sm" onClick={onApply} disabled={stale}>Apply to map</Btn>
        <Btn size="sm" onClick={onDiscard}>Discard</Btn>
        <button className="fc-link-sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide details' : 'Expand details'}</button>
      </div>
      {stale && <Notice tone="warn">The filters changed after this proposal was written. Ask again to get a proposal against the current view.</Notice>}
    </div>
  );
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
  React.useEffect(() => { if (filterKey !== firstKey.current) setStaleAt(msgs.length); }, [filterKey]);
  React.useEffect(() => { if (endRef.current) endRef.current.parentElement.scrollTop = endRef.current.parentElement.scrollHeight; }, [msgs, thinking]);

  const send = (text) => {
    const t = (text ?? input).trim();
    if (!t) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', body: t }]);
    setThinking(true);
    setTimeout(() => {
      setThinking(false);
      setMsgs((m) => [...m, { role: 'assistant', ...makeReply(t, app) }]);
    }, 780);
  };

  return (
    <div className="fc-shell">
      <ScreenHead kicker="AI Assistant" title="Ask about the available data"
        sub="Answers cite the profiles they came from. Nothing is inferred beyond the loaded subset."
        states={['ok']} state={state} setState={setState} />

      <div className="fc-chat">
        <div className="fc-chat-log" role="log" aria-live="polite">
          {msgs.map((m, i) => (
            <div key={i} className={'fc-msg fc-msg-' + (m.role === 'user' ? 'user' : 'bot')}>
              {m.role === 'assistant' && m.kind && m.kind !== 'explain' && (
                <Kicker>{{ clarify: 'Clarification', proposal: 'Query proposal', unsupported: 'Unsupported request', nodata: 'No data available', evidence: 'Evidence-based answer' }[m.kind] || 'Explanation'}</Kicker>
              )}
              <p className="fc-msg-body">{m.body}</p>
              {m.meta && <Mono className="fc-xs fc-muted">{m.meta}</Mono>}
              {m.chips && <div className="fc-row fc-gap-2 fc-wrap fc-mt-2">{m.chips.map((c) => <button key={c} className="fc-chip" onClick={() => send(c)}>{c}</button>)}</div>}
              {m.evidence && <div className="fc-evidence">{m.evidence.map(([k, v]) => <DataRow key={k} k={k} v={v} />)}</div>}
              {m.proposal && (
                <ProposalCard msg={m} stale={staleAt != null && i < staleAt}
                  onApply={() => { app.setFilters(m.proposal.filters); app.go('explore'); }}
                  onDiscard={() => setMsgs((arr) => arr.filter((_, j) => j !== i))} />
              )}
              {m.actions && (
                <div className="fc-row fc-gap-2 fc-mt-2 fc-wrap">
                  <Btn size="sm" onClick={() => app.go('explore')}>View on map</Btn>
                  <Btn size="sm" onClick={() => app.go('compare')}>Compare profiles</Btn>
                  <Btn size="sm" onClick={() => app.go('profile')}>Open the profile</Btn>
                </div>
              )}
            </div>
          ))}
          {thinking && <div className="fc-msg fc-msg-bot"><Loading label="Reading the loaded profiles" lines={2} /></div>}
          <div ref={endRef} />
        </div>
        <div className="fc-composer">
          <div className="fc-row fc-gap-2 fc-wrap fc-mb-2">{SUGGESTIONS.slice(0, 3).map((s) => <button key={s} className="fc-chip" onClick={() => send(s)}>{s}</button>)}</div>
          <form className="fc-row fc-gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input className="fc-input fc-grow" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about regions, depths, temperature or salinity…" aria-label="Ask the assistant" />
            <Btn variant="primary" type="submit" disabled={!input.trim()}>Send</Btn>
          </form>
          <Mono className="fc-xs fc-muted">Context: {app.results.length} profiles match the current filters · {app.filters.basin === 'all' ? 'global' : app.filters.basin}</Mono>
        </div>
      </div>
    </div>
  );
}

function AnalysisScreen() {
  const app = useApp();
  const [state, setState] = React.useState('ok');
  const sample = React.useMemo(() => app.results.slice(0, 60).map((p) => FC.stats(p.profile_id)).filter(Boolean), [app.results]);
  const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
  const woaRuns = React.useMemo(() => app.results.slice(0, 60).map((p) => FC.woaMatch(p.profile_id)), [app.results]);
  const ok = woaRuns.filter((w) => w.status === 'Success');

  return (
    <div className="fc-shell">
      <ScreenHead kicker="Analysis" title="What can be computed from this subset"
        sub="Every figure below is derived from the profiles currently in view."
        states={['ok']} state={state} setState={setState} />

      <div className="fc-grid-3">
        <Panel kicker="Available" title="Temperature changes with depth">
          <DataRow k="Profiles analysed" v={sample.length} />
          <DataRow k="Mean surface value" v={fmt.t(mean(sample.map((s) => s.sst)))} />
          <DataRow k="Mean mixed-layer base" v={fmt.m(mean(sample.map((s) => s.mldDepth)))} />
          <DataRow k="Mean strongest gradient" v={sample.length ? mean(sample.map((s) => s.maxGrad)).toFixed(3) + ' °C/m' : '—'} />
          <Btn size="sm" className="fc-mt-3" onClick={() => app.go('profile')}>Open a profile</Btn>
        </Panel>
        <Panel kicker="Available" title="Salinity changes with depth">
          <DataRow k="Profiles with salinity" v={sample.filter((s) => s.salSurface != null).length} />
          <DataRow k="Mean surface salinity" v={fmt.s(mean(sample.filter((s) => s.salSurface != null).map((s) => s.salSurface)))} />
          <DataRow k="Levels dropped by QC" v={sample.reduce((s, x) => s + x.missingPsal, 0)} />
          <Notice tone="info">Salinity gaps are left as gaps. Profiles with a subsurface minimum are not smoothed.</Notice>
        </Panel>
        <Panel kicker="Available" title="WOA comparison">
          <DataRow k="Attempted" v={woaRuns.length} />
          <DataRow k="Succeeded" v={ok.length} />
          <DataRow k="Unavailable" v={woaRuns.length - ok.length} />
          <DataRow k="Mean difference" v={ok.length ? (mean(ok.map((w) => w.difference)) > 0 ? '+' : '') + mean(ok.map((w) => w.difference)).toFixed(3) + ' °C' : '—'} />
          <Mono className="fc-xs fc-muted">Failures are reported, not hidden: the 20 m maximum-gap rule rejects profiles that would need extrapolation.</Mono>
        </Panel>
      </div>

    </div>
  );
}

function AboutScreen() {
  const cov = FC.coverage();
  const sections = [
    ['What FloatChat does', 'FloatChat reads a cached subset of Argo profiles and lets you explore them on a map, read them level by level, compare them, and ask questions in plain language. It answers from the loaded data only.'],
    ['What is ARGO?', 'ARGO is a global network of autonomous ocean-profiling floats that collect data from different depths of the ocean. These floats move through the water column and periodically record ocean conditions. The collected data helps monitor and understand changes in the ocean over time.'],
    ['What ARGO Measures & What Data Do We Get?', 'ARGO measures key ocean parameters such as temperature, salinity, pressure/depth, dissolved oxygen, pH, chlorophyll, and other biogeochemical properties. The data provides detailed depth-wise profiles, locations, and time-series measurements of ocean conditions.'],
    ['Coverage', cov.distinct_floats + ' floats and ' + cov.distinct_profiles + ' profiles, ' + cov.date_range[0].slice(0, 10) + ' to ' + cov.date_range[1].slice(0, 10) + ', 0–2000 m, across seven basins. Labelled throughout as cached historical observations.'],
    ['Temperature and salinity', 'Temperature is in °C on ITS-90. Salinity is practical salinity (PSS-78), which is dimensionless — shown as PSU by convention. Depth is derived from pressure and marked ▲ wherever it appears.'],
  ];
  return (
    <div className="fc-shell">
      <ScreenHead kicker="About" title="What this platform reads, and what it will not claim" />
      <div className="fc-about">
        {sections.map(([t, body]) => <section key={t} className="fc-about-sec"><h4>{t}</h4><p className="fc-muted">{body}</p></section>)}
      </div>
    </div>
  );
}

window.FCScreens = Object.assign(window.FCScreens || {}, { assistant: AssistantScreen, analysis: AnalysisScreen, about: AboutScreen });
Object.assign(window, { AssistantScreen, AnalysisScreen, AboutScreen, makeReply, ProposalCard });
