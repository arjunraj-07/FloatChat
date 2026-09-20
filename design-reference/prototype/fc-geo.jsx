/* FloatChat — Explore: regional map and globe, both on Natural Earth geometry. */

const BASIN_OPTS = [{ value: 'all', label: 'All basins' }, ...[
  ['north-atlantic', 'North Atlantic'], ['south-atlantic', 'South Atlantic'], ['north-pacific', 'North Pacific'],
  ['south-pacific', 'South Pacific'], ['indian', 'Indian Ocean'], ['southern', 'Southern Ocean'], ['arabian-sea', 'Arabian Sea & Bay of Bengal'],
].map(([value, label]) => ({ value, label }))];

function FiltersDrawer({ open, onClose, state }) {
  const app = useApp();
  const [draft, setDraft] = React.useState(app.filters);
  const [pending, setPending] = React.useState(false);
  React.useEffect(() => { if (open) setDraft(app.filters); }, [open]);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const errors = {};
  if (draft.end < draft.start) errors.end = 'End date is before the start date.';
  if (+draft.depthMax <= +draft.depthMin) errors.depthMax = 'Maximum depth must exceed the minimum.';
  if (+draft.tempMax <= +draft.tempMin) errors.tempMax = 'Maximum temperature must exceed the minimum.';
  const invalid = state === 'invalid' || Object.keys(errors).length > 0;
  const preview = invalid ? [] : FC.filter(draft);
  const apply = () => {
    if (invalid) return;
    setPending(true);
    setTimeout(() => { setPending(false); app.setFilters(draft); onClose(); }, 620);
  };
  if (!open) return null;
  return (
    <div className="fc-drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="fc-drawer" role="dialog" aria-label="Filters">
        <header className="fc-drawer-head">
          <div><Kicker>Filters</Kicker><h4 className="fc-panel-title">Narrow the observations</h4></div>
          <IconBtn label="Close filters" onClick={onClose}>✕</IconBtn>
        </header>
        <div className="fc-drawer-body">
          <Field label="Region"><Select value={draft.basin} onChange={(v) => set('basin', v)} options={BASIN_OPTS} /></Field>
          <div className="fc-grid-2">
            <Field label="West / East bounds" hint="Decimal degrees"><div className="fc-row fc-gap-2"><input className="fc-input" defaultValue="-180" aria-label="West bound" /><input className="fc-input" defaultValue="180" aria-label="East bound" /></div></Field>
            <Field label="South / North bounds"><div className="fc-row fc-gap-2"><input className="fc-input" defaultValue="-66" aria-label="South bound" /><input className="fc-input" defaultValue="62" aria-label="North bound" /></div></Field>
          </div>
          <div className="fc-grid-2">
            <Field label="Start date"><input className="fc-input" type="date" value={draft.start} onChange={(e) => set('start', e.target.value)} /></Field>
            <Field label="End date" error={errors.end}><input className="fc-input" type="date" value={draft.end} onChange={(e) => set('end', e.target.value)} /></Field>
          </div>
          <div className="fc-grid-2">
            <Field label="Depth minimum (m)"><input className="fc-input" type="number" value={draft.depthMin} onChange={(e) => set('depthMin', +e.target.value)} /></Field>
            <Field label="Depth maximum (m)" error={errors.depthMax}><input className="fc-input" type="number" value={draft.depthMax} onChange={(e) => set('depthMax', +e.target.value)} /></Field>
          </div>
          <Field label="Exact depth (m)" hint="Nearest bracketed level is used; no extrapolation."><input className="fc-input" type="number" placeholder="e.g. 100" /></Field>
          <div className="fc-grid-2">
            <Field label="Surface temperature (°C)" error={errors.tempMax}>
              <div className="fc-row fc-gap-2"><input className="fc-input" type="number" value={draft.tempMin} onChange={(e) => set('tempMin', +e.target.value)} aria-label="Minimum temperature" /><input className="fc-input" type="number" value={draft.tempMax} onChange={(e) => set('tempMax', +e.target.value)} aria-label="Maximum temperature" /></div>
            </Field>
            <Field label="Surface salinity (PSU)">
              <div className="fc-row fc-gap-2"><input className="fc-input" type="number" step="0.1" value={draft.salMin} onChange={(e) => set('salMin', +e.target.value)} aria-label="Minimum salinity" /><input className="fc-input" type="number" step="0.1" value={draft.salMax} onChange={(e) => set('salMax', +e.target.value)} aria-label="Maximum salinity" /></div>
            </Field>
          </div>
          <Field label="Float IDs" hint="WMO platform numbers, comma separated"><input className="fc-input" value={draft.floatIds} onChange={(e) => set('floatIds', e.target.value)} placeholder="5903312, 5903358" /></Field>
          <Field label="Profile IDs"><input className="fc-input" placeholder="5903312_121" /></Field>
          <Accordion title="Advanced">
            <Field label="QC settings" hint="Strict keeps QC flags 1–2 only."><Seg ariaLabel="QC settings" value={draft.qcStrict ? 'strict' : 'all'} onChange={(v) => set('qcStrict', v === 'strict')} options={[{ value: 'strict', label: 'Strict' }, { value: 'all', label: 'All flags' }]} /></Field>
            <Field label="Data mode"><Select value={draft.dataMode} onChange={(v) => set('dataMode', v)} options={[{ value: 'all', label: 'Any mode' }, { value: 'R', label: 'Real-time (R)' }, { value: 'A', label: 'Adjusted (A)' }, { value: 'D', label: 'Delayed-mode (D)' }]} /></Field>
          </Accordion>
          {invalid && <Notice tone="warn">Fix the highlighted fields before applying.</Notice>}
          {!invalid && preview.length === 0 && <Notice tone="warn">No available observations for this combination. Widen the date window or the region.</Notice>}
        </div>
        <footer className="fc-drawer-foot">
          <Mono className="fc-sm fc-muted">{invalid ? '—' : preview.length + ' profiles'}</Mono>
          <div className="fc-row fc-gap-2">
            <Btn variant="ghost" size="sm" onClick={() => setDraft(FC.defaultFilters)}>Reset</Btn>
            <Btn variant="primary" size="sm" onClick={apply} disabled={invalid || pending}>{pending ? 'Updating…' : 'Apply filters'}</Btn>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function Legend({ variable }) {
  const stops = variable === 'temp' ? TEMP_STOPS : SAL_STOPS;
  return (
    <div className="fc-legend">
      <Mono className="fc-xs fc-muted">{variable === 'temp' ? 'Surface temperature °C' : 'Surface salinity PSU'}</Mono>
      <div className="fc-legend-bar">{stops.map(([v, c], i) => <span key={i} style={{ background: c }} />)}</div>
      <div className="fc-legend-ticks"><Mono className="fc-xs">{stops[0][0]}</Mono><Mono className="fc-xs">{stops[stops.length - 1][0]}</Mono></div>
      <div className="fc-legend-row"><span className="fc-legend-swatch" style={{ background: '#3d4d54' }} /><Mono className="fc-xs fc-muted">missing / QC failed</Mono></div>
    </div>
  );
}

function ProfilePreview({ p, onClose, onDive }) {
  const app = useApp();
  const st = React.useMemo(() => FC.stats(p.profile_id), [p.profile_id]);
  return (
    <div className="fc-preview">
      <header className="fc-row fc-between">
        <div><Kicker>Profile</Kicker><Mono className="fc-preview-id">{p.profile_id}</Mono></div>
        <IconBtn label="Close preview" onClick={onClose}>✕</IconBtn>
      </header>
      <DataRow k="Float" v={p.platform + ' · cycle ' + p.cycle} />
      <DataRow k="Observed" v={fmt.utc(p.time)} />
      <DataRow k="Location" v={fmt.coord(p.latitude, p.longitude)} />
      <DataRow k="Depth range" v={p.depth_min + '–' + p.depth_max + ' m'} note="Depth derived from pressure" />
      <DataRow k="Surface" v={fmt.t(st?.sst) + ' · ' + fmt.s(st?.salSurface)} />
      <DataRow k="Temperature (surface)" v={fmt.t(st?.sst)} />
      <DataRow k="Salinity (surface)" v={fmt.s(st?.salSurface)} />
      <DataRow k="Data mode" v={fmt.mode(p.data_mode)} />
      <div className="fc-row fc-gap-2 fc-mt-3 fc-wrap">
        <Btn variant="primary" size="sm" onClick={() => { app.setSel({ ...app.sel, profileId: p.profile_id }); app.go('profile'); }}>View measurements</Btn>
        {onDive && <Btn size="sm" onClick={onDive}>Dive in</Btn>}
        <Btn size="sm" onClick={() => { app.setSel({ ...app.sel, profileId: p.profile_id }); app.go('depth'); }}>Depth view</Btn>
      </div>
    </div>
  );
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
    const proj = d3.geoNaturalEarth1().fitExtent([[4, 4], [width - 4, height - 4]], { type: 'Sphere' });
    const gen = d3.geoPath(proj);
    return { proj, land: FC.land ? gen(FC.land) : '', grat: gen(d3.geoGraticule10()), sphere: gen({ type: 'Sphere' }) };
  }, [width, height]);

  React.useEffect(() => {
    if (!svgRef.current || !window.d3) return;
    const zoom = d3.zoom().scaleExtent([1, 8]).on('zoom', (e) => { if (gRef.current) gRef.current.setAttribute('transform', e.transform); });
    d3.select(svgRef.current).call(zoom);
    return () => d3.select(svgRef.current).on('.zoom', null);
  }, [width, height]);

  const marks = results.map((p) => ({ p, xy: geo.proj([p.longitude, p.latitude]) })).filter((m) => m.xy);
  const dates = results.length ? [results[0].time.slice(0, 10), results[results.length - 1].time.slice(0, 10)] : null;
  const basinName = app.filters.basin === 'all' ? 'Global' : BASIN_OPTS.find((b) => b.value === app.filters.basin)?.label;

  return (
    <div className="fc-shell">
      <ScreenHead
        kicker="Explore"
        title="Argo observations, mapped"
        sub={basinName + ' · ' + (dates ? dates[0] + ' → ' + dates[1] : 'no observations in window') + ' · markers are profiles, not tracks'}
        states={['ok']}
        state={state} setState={setState}
        actions={<>
          <Seg ariaLabel="View" value="map" onChange={(v) => v === 'globe' && app.go('globe')} options={[{ value: 'map', label: 'Map' }, { value: 'globe', label: 'Globe' }]} />
          <Seg ariaLabel="Variable" value={variable} onChange={setVariable} options={[{ value: 'temp', label: 'Temp' }, { value: 'psal', label: 'Salinity' }]} />
          <Btn size="sm" onClick={() => setFiltersOpen(true)}>Filters</Btn>
        </>}
      />

      <div className="fc-map-wrap" ref={ref}>
        <svg ref={svgRef} viewBox={'0 0 ' + width + ' ' + height} width="100%" height={height} className="fc-map" role="img" aria-label={'World map with ' + marks.length + ' Argo profile markers'}>
          <rect width={width} height={height} fill="#081b23" />
          <g ref={gRef}>
            <path d={geo.sphere} fill="#0b2b36" />
            <path d={geo.grat} fill="none" stroke="rgba(139,203,196,0.09)" strokeWidth="0.5" />
            <path d={geo.land} fill="#0e1f25" stroke="rgba(139,203,196,0.34)" strokeWidth="0.6" />
            <g className="fc-marks" onClick={(e) => { const id = e.target.getAttribute('data-id'); if (id) setSelected(FC.byId[id]); }}>
              {marks.map(({ p, xy }) => {
                const on = selected?.profile_id === p.profile_id;
                const v = variable === 'temp' ? p.shape.sst : p.shape.surfSal;
                return <circle key={p.profile_id} data-id={p.profile_id} cx={xy[0]} cy={xy[1]} r={on ? 4.6 : 3.1} fill={scale[variable](v)} stroke={on ? '#e6f2f0' : 'rgba(8,27,35,0.9)'} strokeWidth="1" className="fc-mark" />;
              })}
              {selected && marks.some((m) => m.p.profile_id === selected.profile_id) && (() => {
                const m = marks.find((x) => x.p.profile_id === selected.profile_id);
                return <circle cx={m.xy[0]} cy={m.xy[1]} r="9" fill="none" stroke="#8bcbc4" strokeWidth="1.2" />;
              })()}
            </g>
          </g>
        </svg>
        <Legend variable={variable} />
        <div className="fc-attrib"><Mono className="fc-xs">Coastlines: Natural Earth 110m · Observations: ERDDAP/GDAC Argo</Mono></div>
        {selected && <ProfilePreview p={selected} onClose={() => setSelected(null)} onDive={() => setDiving(selected)} />}
      </div>

      {diving && <DiveView p={diving} onClose={() => setDiving(null)} />}

      <div className="fc-grid-3 fc-mt-6">
        <Panel kicker="Region summary" title={basinName}>
          <DataRow k="Profiles in view" v={results.length} />
          <DataRow k="Distinct floats" v={new Set(results.map((p) => p.platform)).size} />
          <DataRow k="Deepest observation" v={results.length ? Math.max(...results.map((p) => p.depth_max)) + ' m' : '—'} />
          <DataRow k="Delayed-mode share" v={results.length ? Math.round((results.filter((p) => p.data_mode === 'D').length / results.length) * 100) + '%' : '—'} />
        </Panel>
        <Panel kicker="Observation dates" title="When these were recorded">
          <DayHistogram profiles={results} />
          <Mono className="fc-xs fc-muted">Each bar is one UTC day of profile arrivals.</Mono>
        </Panel>
        <Panel kicker="Keyboard access" title="Profiles in view">
          {results.length === 0 ? <EmptyState title="Nothing in view" body="No profiles match the current filters." /> : (
            <ul className="fc-list" aria-label="Profiles in view">
              {results.slice(0, 40).map((p) => (
                <li key={p.profile_id}>
                  <button className={'fc-list-btn' + (selected?.profile_id === p.profile_id ? ' is-on' : '')} onClick={() => setSelected(p)}>
                    <Mono className="fc-sm">{p.profile_id}</Mono>
                    <span className="fc-muted fc-xs">{fmt.coord(p.latitude, p.longitude)}</span>
                    <span className="fc-swatch" style={{ background: scale[variable](variable === 'temp' ? p.shape.sst : p.shape.surfSal) }} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Mono className="fc-xs fc-muted">Markers are also reachable here — first 40 of {results.length}.</Mono>
        </Panel>
        <Panel kicker="Structure" title="Surface temperature against latitude">
          <LatScatter profiles={results} variable={variable} />
          <Mono className="fc-xs fc-muted">One dot per profile. Colour follows the legend.</Mono>
        </Panel>
      </div>

      <FiltersDrawer open={filtersOpen} onClose={() => setFiltersOpen(false)} state="ok" />
    </div>
  );
}

function DayHistogram({ profiles }) {
  const days = FC.timeSteps;
  const counts = days.map((d) => profiles.filter((p) => p.time.slice(0, 10) === d).length);
  const max = Math.max(1, ...counts);
  return (
    <div className="fc-histo" role="img" aria-label="Profiles per UTC day">
      {counts.map((c, i) => <span key={i} style={{ height: Math.max(2, (c / max) * 84) + 'px' }} title={days[i] + ': ' + c + ' profiles'} />)}
    </div>
  );
}

function LatScatter({ profiles, variable }) {
  const W = 260, H = 104;
  return (
    <svg viewBox={'0 0 ' + W + ' ' + H} width="100%" height={H} role="img" aria-label="Surface value against latitude">
      <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="rgba(139,203,196,0.18)" strokeWidth="0.6" />
      {profiles.map((p) => {
        const x = ((p.latitude + 70) / 140) * W;
        const v = variable === 'temp' ? p.shape.sst : p.shape.surfSal;
        const dom = variable === 'temp' ? [-2, 32] : [33, 37];
        const y = H - ((v - dom[0]) / (dom[1] - dom[0])) * (H - 8) - 4;
        return <circle key={p.profile_id} cx={x} cy={clamp(y, 3, H - 3)} r="2" fill={scale[variable](v)} opacity="0.85" />;
      })}
      <text x="2" y={H - 2} className="fc-svg-tick">70°S</text>
      <text x={W - 24} y={H - 2} className="fc-svg-tick">70°N</text>
    </svg>
  );
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
    const proj = d3.geoOrthographic().rotate(rot).fitExtent([[10, 10], [size - 10, size - 10]], { type: 'Sphere' });
    proj.scale(proj.scale() * zoom);
    const gen = d3.geoPath(proj);
    const area = d3.geoCircle().center(anchor).radius(22)();
    return { proj, gen, land: FC.land ? gen(FC.land) : '', grat: gen(d3.geoGraticule10()), sphere: gen({ type: 'Sphere' }), area: gen(area) };
  }, [rot, zoom, size, anchor]);

  const turning = spinning && !selected && state === 'ok';
  const hold = React.useCallback(() => { clearTimeout(idleTimer.current); setSpinning(false); }, []);
  const release = React.useCallback(() => {
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setSpinning(true), 2000);
  }, []);
  React.useEffect(() => () => clearTimeout(idleTimer.current), []);

  React.useEffect(() => {
    if (!turning) return;
    let raf, t0 = performance.now(), lastTick = t0, lastCommit = 0;
    let base = rotRef.current[0];
    const tick = (now) => {
      if (document.hidden || now - lastTick > 250) { base -= ((lastTick - t0) / 1000) * 6; t0 = now; } /* rebase across a hidden tab */
      lastTick = now;
      if (!document.hidden && now - lastCommit >= 45) {
        lastCommit = now;
        /* 60s per rotation, vertical axis only. The angle comes from absolute
           elapsed time and commits at ~22fps, so the projection is not rebuilt
           on every animation frame and dropped frames do not slow the spin. */
        setRot(([, p]) => [base - ((now - t0) / 1000) * 6, p]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [turning]);

  React.useEffect(() => {
    if (!svgRef.current) return;
    const drag = d3.drag()
      .on('start', hold)
      .on('drag', (e) => setRot(([l, p]) => [l + e.dx * 0.32, clamp(p - e.dy * 0.32, -85, 85)]))
      .on('end', () => { const [l, p] = rotRef.current; setAnchor([-l, -p]); release(); });
    d3.select(svgRef.current).call(drag);
    return () => d3.select(svgRef.current).on('.drag', null);
  }, [size, hold, release]);

  const centre = [-rot[0], -rot[1]];
  const visible = results.map((p) => ({ p, xy: geo.proj([p.longitude, p.latitude]), front: d3.geoDistance([p.longitude, p.latitude], centre) < Math.PI / 2 }));
  const inArea = results.filter((p) => d3.geoDistance([p.longitude, p.latitude], anchor) < (22 * Math.PI) / 180);

  if (state === 'nowebgl') {
    return (
      <div className="fc-shell">
        <ScreenHead kicker="Explore · Globe" title="Globe view unavailable" states={['ok', 'loading', 'empty', 'nowebgl']} state={state} setState={setState} />
        <Panel>
          <EmptyState title="This browser cannot render the globe" body="Hardware acceleration is unavailable, so the globe has been disabled. The regional map shows the same profiles with the same filters." action={<Btn variant="primary" size="sm" onClick={() => app.go('explore')}>Return to regional map</Btn>} />
        </Panel>
      </div>
    );
  }

  return (
    <div className="fc-shell">
      <ScreenHead
        kicker="Explore · Globe" title="Rotate to the region you care about"
        sub="It turns slowly on its own. Drag to take hold and rotate it yourself, scroll the slider to zoom."
        states={['ok']} state={state} setState={setState}
        actions={<>
          <Seg ariaLabel="View" value="globe" onChange={(v) => v === 'map' && app.go('explore')} options={[{ value: 'map', label: 'Map' }, { value: 'globe', label: 'Globe' }]} />
          <Btn size="sm" onClick={() => { const p = results[0]; if (p) { setRot([-p.longitude, -p.latitude]); setAnchor([p.longitude, p.latitude]); hold(); release(); } }}>Focus on results</Btn>
          <Btn variant="primary" size="sm" onClick={() => { if (selected) app.setSel({ ...app.sel, profileId: selected.profile_id }); app.go('depth'); }}>Explore depths</Btn>
        </>}
      />
      <div className="fc-globe-layout">
        <div className="fc-globe-stage" ref={ref}>
          {(
            <svg ref={svgRef} viewBox={'0 0 ' + size + ' ' + size} width={size} height={size} className="fc-globe" role="img" aria-label="Interactive globe of Argo profiles" onMouseEnter={hold} onMouseLeave={release}>
              <defs><radialGradient id="fc-globe-fill" cx="36%" cy="30%"><stop offset="0%" stopColor="#175a66" /><stop offset="72%" stopColor="#0c2f3c" /><stop offset="100%" stopColor="#061921" /></radialGradient></defs>
              <path d={geo.sphere} fill="url(#fc-globe-fill)" />
              <path d={geo.grat} fill="none" stroke="rgba(139,203,196,0.12)" strokeWidth="0.5" />
              <path d={geo.land} fill="#0d2028" stroke="rgba(139,203,196,0.4)" strokeWidth="0.6" />
              {!turning && <path d={geo.area} fill="rgba(47,167,159,0.10)" stroke="rgba(89,200,190,0.55)" strokeDasharray="4 4" strokeWidth="1" />}
              {visible.filter((m) => m.front).map(({ p, xy }) => {
                const on = selected?.profile_id === p.profile_id;
                return <circle key={p.profile_id} cx={xy[0]} cy={xy[1]} r={on ? 5 : 2.8} fill={scale.temp(p.shape.sst)} stroke={on ? '#e6f2f0' : 'rgba(6,25,33,0.8)'} strokeWidth="1" className="fc-mark" onClick={() => { const [l, p2] = rotRef.current; setAnchor([-l, -p2]); setSelected(p); }} />;
              })}
              <path d={geo.sphere} fill="none" stroke="rgba(139,203,196,0.28)" strokeWidth="1" />
            </svg>
          )}
          <div className="fc-globe-controls">
            <label className="fc-row fc-gap-2"><Mono className="fc-xs fc-muted">Zoom</Mono><input type="range" min="1" max="3" step="0.05" value={zoom} onChange={(e) => setZoom(+e.target.value)} aria-label="Globe zoom" /></label>
            <Mono className="fc-xs fc-muted">centre {fmt.coord(centre[1], wrapLon(centre[0]))}</Mono>
          </div>
        </div>
        <Panel kicker="Search area" title={inArea.length + ' profiles in view'} className="fc-globe-list">
          {inArea.length === 0 ? <EmptyState title="Nothing in this area" body="Rotate the globe or widen the filters." /> : (
            <ul className="fc-list" aria-label="Profiles inside the search area">
              {inArea.slice(0, 40).map((p) => (
                <li key={p.profile_id}>
                  <button className={'fc-list-btn' + (selected?.profile_id === p.profile_id ? ' is-on' : '')} onClick={() => setSelected(p)}>
                    <Mono className="fc-sm">{p.profile_id}</Mono>
                    <span className="fc-muted fc-xs">{fmt.coord(p.latitude, p.longitude)} · {p.time.slice(0, 10)}</span>
                    <span className="fc-swatch" style={{ background: scale.temp(p.shape.sst) }} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selected && <div className="fc-mt-3"><ProfilePreview p={selected} onClose={() => setSelected(null)} /></div>}
        </Panel>
      </div>
    </div>
  );
}

window.FCScreens = Object.assign(window.FCScreens || {}, { explore: MapScreen, globe: GlobeScreen });
Object.assign(window, { MapScreen, GlobeScreen, FiltersDrawer, Legend, ProfilePreview, BASIN_OPTS });
