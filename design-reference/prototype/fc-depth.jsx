/* FloatChat — depth view (geographic arrangement of vertical profile columns)
   and time exploration (stepping through recorded observation times). */

const ISO = { kx: 0.86, ky: 0.5 };
function isoPoint(lon, lat, lon0, lat0, s) {
  const dx = wrapLon(lon - lon0), dy = lat - lat0;
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
    return src
      .map((p) => ({ p, d: Math.hypot(wrapLon(p.longitude - anchor.longitude), p.latitude - anchor.latitude) }))
      .sort((a, b) => a.d - b.d).slice(0, 12).map((x) => x.p);
  }, [app.results, anchor.profile_id]);

  const spread = Math.max(2, ...pool.map((p) => Math.abs(wrapLon(p.longitude - anchor.longitude)) + Math.abs(p.latitude - anchor.latitude)));
  const s = Math.min(width * 0.36, 260) / spread;
  const depthK = (height * 0.52) / Math.max(range[1] - range[0], 50);
  const cx = width / 2, cy = height * 0.26;

  const columns = React.useMemo(() => pool.map((p) => {
    const [ix, iy] = isoPoint(p.longitude, p.latitude, anchor.longitude, anchor.latitude, s);
    const obs = FC.observations(p.profile_id).filter((o) => o.depth >= range[0] && o.depth <= range[1]);
    const step = Math.max(1, Math.round(obs.length / 22));
    const binned = obs.filter((_, i) => i % step === 0);
    return { p, x: cx + ix, y: cy + iy, obs: binned };
  }).sort((a, b) => a.y - b.y), [pool, s, range, cx, cy]);

  const yOf = (depth) => (depth - range[0]) * depthK;
  const exaggeration = ((height * 0.52) / (range[1] - range[0])) / (s / 111000 * 1000) || 0;
  const ticks = [range[0], range[0] + (range[1] - range[0]) / 4, range[0] + (range[1] - range[0]) / 2, range[0] + ((range[1] - range[0]) * 3) / 4, range[1]].map((d) => Math.round(d));

  return (
    <div className="fc-shell">
      <ScreenHead
        kicker="Depth view" title="Profiles arranged where they were recorded"
        sub={pool.length + ' profiles near ' + fmt.coord(anchor.latitude, anchor.longitude) + ' · columns are single profiles, not float tracks'}
        states={['ok', 'loading', 'empty', 'error']} state={state} setState={setState}
        actions={<>
          <Btn size="sm" onClick={() => app.go('globe')}>Back to globe</Btn>
          <Btn size="sm" onClick={() => { setRange([0, 1000]); setSample(null); }}>Reset view</Btn>
          <Seg ariaLabel="Variable" value={variable} onChange={setVariable} options={[{ value: 'temp', label: 'Temperature' }, { value: 'psal', label: 'Salinity' }]} />
        </>}
      />

      <div className="fc-depth-layout">
        <div className="fc-depth-stage" ref={ref}>
          {state === 'loading' && <Loading label="Reading 12 profiles" />}
          {state === 'error' && <ErrorState body="Observation levels could not be read for this region." detail="GET /api/profiles/5903318_121 → 502" onRetry={() => setState('ok')} />}
          {state === 'empty' && <EmptyState body="No profiles inside the current filters carry levels in this depth band." />}
          {state === 'ok' && (
            <>
              <div className="fc-row fc-between fc-wrap fc-gap-3 fc-mb-3">
                <div className="fc-row fc-gap-2">
                  <Btn size="sm" onClick={() => setRange(([a, b]) => [Math.max(0, a - 200), Math.max(200, b - 400)])}>↑ Shallower</Btn>
                  <Btn size="sm" onClick={() => setRange(([a, b]) => [a, Math.min(2000, b + 400)])}>↓ Deeper</Btn>
                  <Mono className="fc-sm fc-muted">{range[0]}–{range[1]} m shown</Mono>
                </div>
                <Legend variable={variable} />
              </div>
              <svg viewBox={'0 0 ' + width + ' ' + height} width="100%" height={height} className="fc-depth-svg" role="img" aria-label="Depth columns arranged by geographic position">
                <g className="fc-depth-axis">
                  <text x="8" y={cy - 16} className="fc-svg-label">depth scale ({anchor.platform})</text>
                  <line x1="44" x2="44" y1={cy} y2={cy + yOf(range[1])} stroke="rgba(139,203,196,0.3)" strokeWidth="0.8" />
                  {ticks.map((d) => (
                    <g key={d} transform={'translate(0,' + (cy + yOf(d)) + ')'}>
                      <line x1="38" x2="50" y1="0" y2="0" stroke="rgba(139,203,196,0.34)" strokeWidth="0.8" />
                      <text x="8" y="3" className="fc-svg-tick">{d} m</text>
                    </g>
                  ))}
                </g>
                {columns.map((c) => (
                  <g key={c.p.profile_id}>
                    {c.p.profile_id === anchor.profile_id && <rect x={c.x - 14} y={c.y - 9} width="28" height={yOf(range[1]) + 18} fill="none" stroke="rgba(139,203,196,0.35)" strokeDasharray="3 3" rx="4" />}
                    <ellipse cx={c.x} cy={c.y} rx="13" ry="6" fill="rgba(139,203,196,0.16)" stroke="rgba(139,203,196,0.4)" strokeWidth="0.7" />
                    {c.obs.map((o, i) => {
                      const v = variable === 'temp' ? o.temp : o.psal;
                      const h = Math.max(3, (c.obs[i + 1] ? yOf(c.obs[i + 1].depth) - yOf(o.depth) : 6));
                      const on = sample && sample.profile_id === c.p.profile_id && sample.o.depth === o.depth;
                      return (
                        <rect key={o.depth} x={c.x - 11} y={c.y + yOf(o.depth)} width="22" height={h + 0.6}
                          fill={v == null ? 'url(#fc-missing)' : scale[variable](v)} opacity={on ? 1 : 0.92}
                          stroke={on ? '#e6f2f0' : 'none'} strokeWidth={on ? 1.2 : 0} className="fc-depth-cell"
                          onClick={() => setSample({ profile_id: c.p.profile_id, p: c.p, o })}
                          tabIndex="0" role="button"
                          aria-label={c.p.profile_id + ' at ' + o.depth + ' metres, ' + (variable === 'temp' ? fmt.t(o.temp) : fmt.s(o.psal))}
                          onKeyDown={(e) => { if (e.key === 'Enter') setSample({ profile_id: c.p.profile_id, p: c.p, o }); }} />
                      );
                    })}
                    <text x={c.x} y={c.y - 12} className="fc-svg-label" textAnchor="middle">{c.p.platform}</text>
                  </g>
                ))}
                <defs>
                  <pattern id="fc-missing" width="4" height="4" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                    <rect width="4" height="4" fill="#33454c" /><line x1="0" y1="0" x2="0" y2="4" stroke="#54696f" strokeWidth="1.4" />
                  </pattern>
                </defs>
              </svg>
            </>
          )}
        </div>

        <div className="fc-depth-side">
          <Panel kicker="Selected sample" title={sample ? sample.p.profile_id : 'Nothing selected'}>
            {!sample ? <p className="fc-muted fc-sm">Click any cell in a column to read the measurement at that level.</p> : (
              <>
                <DataRow k="Depth" v={fmt.m(sample.o.depth)} note="Derived from pressure" />
                <DataRow k="Pressure" v={sample.o.pres + ' dbar'} />
                <DataRow k="Temperature" v={fmt.t(sample.o.temp)} />
                <DataRow k="Salinity" v={fmt.s(sample.o.psal)} />
                <DataRow k="QC flags" v={'T ' + sample.o.temp_qc + ' · S ' + sample.o.psal_qc} />
                <DataRow k="Observed" v={fmt.utc(sample.p.time)} />
                <DataRow k="Data mode" v={fmt.mode(sample.p.data_mode)} />
                {(sample.o.temp == null || sample.o.psal == null) && <Notice tone="warn">A value is missing at this level and is drawn neutral — it is not interpolated.</Notice>}
                <div className="fc-row fc-gap-2 fc-mt-3">
                  <Btn size="sm" variant="primary" onClick={() => { app.setSel({ ...app.sel, profileId: sample.p.profile_id }); app.go('profile'); }}>Open full profile</Btn>
                </div>
              </>
            )}
          </Panel>

          <Accordion title="How to read this view">
            <ul className="fc-bullets">
              <li>Each column is <strong>one profile</strong> — a single descent-to-ascent record at one time and place. Columns are not float tracks.</li>
              <li>Horizontal placement is geographic: columns sit where the float surfaced, in a tilted plan view.</li>
              <li>Vertical placement is <strong>actual depth in metres</strong>. The ruler on the left is anchored to the highlighted column ({anchor.platform}); other columns sit higher or lower because their positions are further away. Depth is exaggerated against horizontal distance so the water column stays legible.</li>
              <li>Colour is the measured value. Neutral hatching marks missing or QC-failed levels.</li>
              <li>Depth values are <em>derived</em> from pressure — marked ▲ wherever they appear.</li>
            </ul>
          </Accordion>
          <Panel kicker="Also here" title="Step through time">
            <p className="fc-muted fc-sm">See how the profiles in this region arrived, observation by observation.</p>
            <Btn size="sm" onClick={() => app.go('time')}>Open time exploration</Btn>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function TimeScreen() {
  const app = useApp();
  const [state, setState] = React.useState('ok');
  const [idx, setIdx] = React.useState(app.sel.timeIndex);
  const [playing, setPlaying] = React.useState(false);
  const [showAll, setShowAll] = React.useState(false);
  const [ref, w] = useElementWidth(1000);
  const width = clamp(w, 320, 1400), height = clamp(width * 0.42, 260, 560);
  const days = FC.timeSteps;

  React.useEffect(() => {
    if (!playing || prefersReduced()) return;
    const t = setInterval(() => setIdx((i) => (i + 1 >= days.length ? 0 : i + 1)), 900);
    return () => clearInterval(t);
  }, [playing, days.length]);

  const geo = React.useMemo(() => {
    const proj = d3.geoNaturalEarth1().fitExtent([[4, 4], [width - 4, height - 4]], { type: 'Sphere' });
    const gen = d3.geoPath(proj);
    return { proj, land: FC.land ? gen(FC.land) : '', sphere: gen({ type: 'Sphere' }), grat: gen(d3.geoGraticule10()) };
  }, [width, height]);

  const day = days[idx];
  const shown = state === 'empty' ? [] : app.results.filter((p) => (showAll ? true : p.time.slice(0, 10) === day));
  const atStep = app.results.filter((p) => p.time.slice(0, 10) === day);

  return (
    <div className="fc-shell">
      <ScreenHead
        kicker="Time exploration" title="Observations as they were recorded"
        sub={'UTC day ' + day + ' · ' + atStep.length + ' profiles arrived'}
        states={['ok', 'loading', 'empty', 'fallback']} state={state} setState={setState}
        actions={<Btn size="sm" onClick={() => app.go('explore')}>Back to map</Btn>}
      />
      <Notice tone="info">This steps through <strong>recorded observation times</strong>. It does not simulate float movement between them — nothing is interpolated or animated along a path.</Notice>

      <div className="fc-map-wrap" ref={ref}>
        {state === 'loading' && <div className="fc-map-overlay"><Loading label="Loading observation times" lines={2} /></div>}
        {state === 'fallback' && <div className="fc-map-badge"><Mono className="fc-xs">cached historical observations</Mono></div>}
        <svg viewBox={'0 0 ' + width + ' ' + height} width="100%" height={height} className="fc-map" role="img" aria-label={'Profiles recorded on ' + day}>
          <rect width={width} height={height} fill="#081b23" />
          <path d={geo.sphere} fill="#0b2b36" />
          <path d={geo.grat} fill="none" stroke="rgba(139,203,196,0.08)" strokeWidth="0.5" />
          <path d={geo.land} fill="#0e1f25" stroke="rgba(139,203,196,0.3)" strokeWidth="0.6" />
          {showAll && app.results.map((p) => { const xy = geo.proj([p.longitude, p.latitude]); return <circle key={'a' + p.profile_id} cx={xy[0]} cy={xy[1]} r="1.6" fill="#4d6a70" />; })}
          {shown.map((p) => {
            const xy = geo.proj([p.longitude, p.latitude]);
            const on = p.time.slice(0, 10) === day;
            return <circle key={p.profile_id} cx={xy[0]} cy={xy[1]} r={on ? 3.4 : 1.8} fill={scale.temp(p.shape.sst)} stroke={on ? 'rgba(230,242,240,0.8)' : 'none'} strokeWidth="0.8" />;
          })}
        </svg>
      </div>

      <Panel className="fc-mt-4" kicker="Timeline" title={fmt.day(day + 'T00:00:00Z') + ' 00:00 UTC'}
        actions={<>
          <IconBtn label="Previous time" onClick={() => setIdx((i) => Math.max(0, i - 1))}>‹</IconBtn>
          <Btn size="sm" variant="primary" onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</Btn>
          <IconBtn label="Next time" onClick={() => setIdx((i) => Math.min(days.length - 1, i + 1))}>›</IconBtn>
          <Btn size="sm" variant={showAll ? 'primary' : 'secondary'} onClick={() => setShowAll(!showAll)} aria-pressed={showAll}>Show all times</Btn>
        </>}>
        <input className="fc-range" type="range" min="0" max={days.length - 1} value={idx} onChange={(e) => { setIdx(+e.target.value); setPlaying(false); }} aria-label="Observation time" aria-valuetext={day} />
        <div className="fc-timeline-ticks">{days.map((d, i) => <button key={d} className={'fc-tick' + (i === idx ? ' is-on' : '')} onClick={() => { setIdx(i); setPlaying(false); }} aria-label={d} title={d} />)}</div>
        <div className="fc-row fc-between fc-mt-2"><Mono className="fc-xs fc-muted">{days[0]}</Mono><Mono className="fc-xs fc-muted">{days[days.length - 1]}</Mono></div>
        <ul className="fc-list fc-mt-3" aria-label={'Profiles recorded on ' + day}>
          {atStep.slice(0, 6).map((p) => (
            <li key={p.profile_id}>
              <button className="fc-list-btn" onClick={() => { app.setSel({ ...app.sel, profileId: p.profile_id, timeIndex: idx }); app.go('profile'); }}>
                <Mono className="fc-sm">{p.profile_id}</Mono>
                <span className="fc-muted fc-xs">{p.time.slice(11, 16)} UTC · {fmt.coord(p.latitude, p.longitude)}</span>
                <span className="fc-swatch" style={{ background: scale.temp(p.shape.sst) }} aria-hidden="true" />
              </button>
            </li>
          ))}
          {!atStep.length && <li><EmptyState title="No observations on this day" body="Step to another time, or widen the filters." /></li>}
        </ul>
      </Panel>
    </div>
  );
}

window.FCScreens = Object.assign(window.FCScreens || {}, { depth: DepthScreen, time: TimeScreen });
Object.assign(window, { DepthScreen, TimeScreen });
