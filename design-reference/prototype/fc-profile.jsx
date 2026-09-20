/* FloatChat — profile details and comparison. Depth runs downward on the y axis;
   values on x. Nothing is interpolated across gaps: a break in the data is a break
   in the line. */

function DepthChart({ series, variable, height = 460, showGrid = true, svgRef }) {
  const [ref, w] = useElementWidth(680);
  const [hover, setHover] = React.useState(null);
  const width = clamp(w, 280, 1000);
  const pad = { l: 56, r: 18, t: 18, b: 40 };
  const key = variable === 'temp' ? 'temp' : 'psal';
  const all = series.flatMap((s) => s.obs.filter((o) => o[key] != null));
  if (!all.length) return <div ref={ref}><EmptyState title="No valid levels" body={'This profile carries no ' + (variable === 'temp' ? 'temperature' : 'salinity') + ' values that pass QC.'} /></div>;
  const vMin = Math.min(...all.map((o) => o[key])), vMax = Math.max(...all.map((o) => o[key]));
  const pad0 = (vMax - vMin) * 0.08 || 0.4;
  const dom = [vMin - pad0, vMax + pad0];
  const dMax = Math.max(...series.flatMap((s) => s.obs.map((o) => o.depth)));
  const x = (v) => pad.l + ((v - dom[0]) / (dom[1] - dom[0])) * (width - pad.l - pad.r);
  const y = (d) => pad.t + (d / dMax) * (height - pad.t - pad.b);

  const segs = (obs) => {
    const out = []; let cur = [];
    obs.forEach((o, i) => {
      const gap = i > 0 && o.depth - obs[i - 1].depth > 120;
      if (o[key] == null || gap) { if (cur.length > 1) out.push(cur); cur = o[key] == null ? [] : [o]; return; }
      cur.push(o);
    });
    if (cur.length > 1) out.push(cur);
    return out;
  };
  const line = d3.line().x((o) => x(o[key])).y((o) => y(o.depth)).curve(d3.curveLinear);
  const vTicks = d3.ticks(dom[0], dom[1], 5);
  const dTicks = d3.ticks(0, dMax, 6);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const py = ((e.clientY - rect.top) / rect.height) * height;
    const depth = clamp(((py - pad.t) / (height - pad.t - pad.b)) * dMax, 0, dMax);
    const rows = series.map((s) => {
      let best = null, bd = 1e9;
      for (const o of s.obs) { const d = Math.abs(o.depth - depth); if (d < bd) { bd = d; best = o; } }
      return { s, o: best };
    }).filter((r) => r.o);
    setHover({ depth: rows[0]?.o.depth ?? depth, rows, py: y(rows[0]?.o.depth ?? depth) });
  };

  return (
    <div ref={ref} className="fc-chart-wrap">
      <svg ref={svgRef} viewBox={'0 0 ' + width + ' ' + height} width="100%" height={height} className="fc-chart" role="img"
        aria-label={'Depth profile of ' + (variable === 'temp' ? 'temperature' : 'salinity')}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <rect width={width} height={height} fill="#0b1e26" />
        {showGrid && dTicks.map((d) => <g key={'d' + d}><line x1={pad.l} x2={width - pad.r} y1={y(d)} y2={y(d)} stroke="rgba(139,203,196,0.10)" strokeWidth="0.6" /><text x={pad.l - 8} y={y(d) + 4} textAnchor="end" className="fc-svg-tick">{d}</text></g>)}
        {vTicks.map((v) => <g key={'v' + v}><line x1={x(v)} x2={x(v)} y1={pad.t} y2={height - pad.b} stroke="rgba(139,203,196,0.07)" strokeWidth="0.6" /><text x={x(v)} y={height - pad.b + 16} textAnchor="middle" className="fc-svg-tick">{variable === 'temp' ? v.toFixed(0) : v.toFixed(1)}</text></g>)}
        <text x={pad.l - 40} y={pad.t - 6} className="fc-svg-label">Depth m</text>
        <text x={width - pad.r} y={height - 8} textAnchor="end" className="fc-svg-label">{variable === 'temp' ? 'Temperature °C' : 'Salinity PSU'}</text>
        {series.map((s) => (
          <g key={s.id}>
            {segs(s.obs).map((seg, i) => <path key={i} d={line(seg)} fill="none" stroke={s.color} strokeWidth="1.8" strokeDasharray={s.dashed ? '6 4' : undefined} />)}
            {s.obs.filter((o) => o[key] != null).filter((_, i) => i % 2 === 0).map((o) => (
              s.square
                ? <rect key={o.depth} x={x(o[key]) - 2.6} y={y(o.depth) - 2.6} width="5.2" height="5.2" fill="#0b1e26" stroke={s.color} strokeWidth="1.1" />
                : <circle key={o.depth} cx={x(o[key])} cy={y(o.depth)} r="2.6" fill="#0b1e26" stroke={s.color} strokeWidth="1.1" />
            ))}
            {s.obs.filter((o) => o[key] == null).map((o) => <line key={'m' + o.depth} x1={pad.l} x2={pad.l + 10} y1={y(o.depth)} y2={y(o.depth)} stroke="#54696f" strokeWidth="1.4" />)}
          </g>
        ))}
        {hover && <g><line x1={pad.l} x2={width - pad.r} y1={hover.py} y2={hover.py} stroke="rgba(230,242,240,0.42)" strokeWidth="0.8" strokeDasharray="3 3" /></g>}
      </svg>
      {hover && (
        <div className="fc-tip" style={{ top: (hover.py / height) * 100 + '%' }}>
          <Mono className="fc-xs">{Math.round(hover.depth)} m</Mono>
          {hover.rows.map(({ s, o }) => <Mono key={s.id} className="fc-xs" style={{ color: s.color }}>{s.label}: {variable === 'temp' ? fmt.t(o.temp) : fmt.s(o.psal)}</Mono>)}
        </div>
      )}
    </div>
  );
}

function ProfileScreen() {
  const app = useApp();
  const [state, setState] = React.useState('ok');
  const [variable, setVariable] = React.useState('temp');
  const [mode, setMode] = React.useState(app.session.detail);
  const svgRef = React.useRef(null);
  const p = FC.byId[app.sel.profileId] || FC.profiles[0];
  const floatProfiles = React.useMemo(() => FC.profiles.filter((x) => x.platform === p.platform), [p.platform]);
  const i = floatProfiles.findIndex((x) => x.profile_id === p.profile_id);
  const obs = React.useMemo(() => (state === 'empty' ? [] : FC.observations(p.profile_id)), [p.profile_id, state]);
  const st = React.useMemo(() => FC.stats(p.profile_id), [p.profile_id]);
  const woa = React.useMemo(() => FC.woaMatch(p.profile_id), [p.profile_id]);
  const setProfile = (id) => app.setSel({ ...app.sel, profileId: id });
  const platforms = [...new Set(FC.profiles.map((x) => x.platform))];

  return (
    <div className="fc-shell">
      <ScreenHead
        kicker="Profile details" title={'Float ' + p.platform + ' · cycle ' + p.cycle}
        sub={fmt.utc(p.time) + ' · ' + fmt.coord(p.latitude, p.longitude) + ' · ' + p.depth_min + '–' + p.depth_max + ' m'}
        states={['ok', 'loading', 'empty', 'error', 'fallback']} state={state} setState={setState}
        actions={<Seg ariaLabel="Reading" value={mode} onChange={setMode} options={[{ value: 'simple', label: 'Simple' }, { value: 'detailed', label: 'Detailed' }]} />}
      />

      <div className="fc-selectors">
        <Field label="Float"><Select value={p.platform} onChange={(v) => setProfile(FC.profiles.find((x) => x.platform === v).profile_id)} options={platforms.map((v) => ({ value: v, label: v }))} /></Field>
        <Field label="Observation"><Select value={p.profile_id} onChange={setProfile} options={floatProfiles.map((x) => ({ value: x.profile_id, label: 'Cycle ' + x.cycle + ' — ' + x.time.slice(0, 10) }))} /></Field>
        <div className="fc-row fc-gap-2 fc-selectors-nav">
          <Btn size="sm" disabled={i <= 0} onClick={() => setProfile(floatProfiles[i - 1].profile_id)}>‹ Previous</Btn>
          <Btn size="sm" disabled={i >= floatProfiles.length - 1} onClick={() => setProfile(floatProfiles[i + 1].profile_id)}>Next ›</Btn>
          <Btn size="sm" onClick={() => { app.setSel({ ...app.sel, compareA: p.profile_id }); app.go('compare'); }}>Compare</Btn>
          <Btn size="sm" onClick={() => app.go('explore')}>View on map</Btn>
        </div>
      </div>

      {state === 'fallback' && <Notice tone="info">Served from <strong>cached historical observations</strong>; the live GDAC index did not respond.</Notice>}

      <div className="fc-profile-layout">
        <Panel kicker={p.profile_id} title={variable === 'temp' ? 'Temperature against depth' : 'Salinity against depth'}
          actions={<>
            <Seg ariaLabel="Variable" value={variable} onChange={setVariable} options={[{ value: 'temp', label: 'Temperature' }, { value: 'psal', label: 'Salinity' }]} />
            <Btn size="sm" onClick={() => exportSvgPng(svgRef.current, p.profile_id + '-' + variable + '.png')}>Export PNG</Btn>
          </>}>
          {state === 'loading' && <Loading label={'Reading ' + p.profile_id} lines={4} />}
          {state === 'error' && <ErrorState body="This profile could not be read." detail={'GET /api/profiles/' + p.profile_id + ' → 404 Profile not found'} onRetry={() => setState('ok')} />}
          {state === 'empty' && <EmptyState title="No levels returned" body="Every level in this profile failed QC, so nothing can be plotted." />}
          {(state === 'ok' || state === 'fallback') && (
            <>
              <DepthChart svgRef={svgRef} variable={variable} series={[{ id: 'a', label: p.platform, color: '#59c8be', obs }]} />
              <div className="fc-row fc-gap-4 fc-wrap fc-mt-2">
                <Mono className="fc-xs fc-muted">{st?.levels} levels · {variable === 'temp' ? st?.missingTemp : st?.missingPsal} missing</Mono>
                <Mono className="fc-xs fc-muted">units: {variable === 'temp' ? '°C (ITS-90)' : 'PSU (PSS-78)'}</Mono>
                <Mono className="fc-xs fc-muted">depth derived from pressure ▲</Mono>
              </div>
            </>
          )}
        </Panel>

        <div className="fc-profile-side">
          <Panel kicker="Metadata" title="Observation">
            <DataRow k="Profile ID" v={p.profile_id} />
            <DataRow k="Observed (UTC)" v={fmt.utc(p.time)} />
            <DataRow k="Location" v={fmt.coord(p.latitude, p.longitude)} />
            <DataRow k="Depth range" v={p.depth_min + '–' + p.depth_max + ' m'} note="Derived from pressure" />
            <DataRow k="Temperature (surface)" v={fmt.t(st?.sst)} />
            <DataRow k="Salinity (surface)" v={fmt.s(st?.salSurface)} />
            <DataRow k="Direction" v={p.direction === 'A' ? 'Ascending' : 'Descending'} />
            <DataRow k="Data mode" v={fmt.mode(p.data_mode)} />
            <DataRow k="Levels (T / S)" v={p.temp_count + ' / ' + p.psal_count} />
          </Panel>

          <Accordion title="Changes with depth" open>
            {mode === 'simple' ? (
              <p className="fc-sm">The water is warmest at the surface, around <Mono>{fmt.t(st?.sst)}</Mono>. It stays close to that down to about <Mono>{fmt.m(st?.mldDepth)}</Mono>, then cools quickly through the thermocline near <Mono>{fmt.m(st?.thermoDepth)}</Mono>, reaching <Mono>{fmt.t(st?.deepT)}</Mono> at <Mono>{fmt.m(st?.deepDepth)}</Mono>.</p>
            ) : (
              <>
                <DataRow k="Surface value" v={fmt.t(st?.sst)} />
                <DataRow k="Mixed layer base" v={fmt.m(st?.mldDepth)} note="0.2 °C criterion from the shallowest level" />
                <DataRow k="Strongest gradient" v={st ? st.maxGrad.toFixed(3) + ' °C/m at ' + fmt.m(st.thermoDepth) : '—'} />
                <DataRow k="Deepest value" v={fmt.t(st?.deepT) + ' at ' + fmt.m(st?.deepDepth)} />
                <DataRow k="Salinity range" v={st?.salRange ? st.salRange[0].toFixed(3) + '–' + st.salRange[1].toFixed(3) + ' PSU' : '—'} />
              </>
            )}
          </Accordion>

          <Accordion title="WOA comparison">
            {woa.status === 'Success' ? (
              <>
                <DataRow k="Comparison depth" v={woa.comparison_depth + ' m'} />
                <DataRow k="Argo (interpolated)" v={woa.argo_interpolated_value.toFixed(3) + ' °C'} note="Linear interpolation within a 20 m maximum gap" />
                <DataRow k="WOA reference" v={woa.woa_reference_value.toFixed(3) + ' °C'} />
                <DataRow k="Difference" v={(woa.difference > 0 ? '+' : '') + woa.difference.toFixed(3) + ' °C'} />
                <DataRow k="Baseline" v={'WOA23 ' + woa.baseline_period + ', month ' + woa.month} />
                {mode === 'detailed' && <DataRow k="Spatial offset" v={woa.spatial_offset.lat + '°, ' + woa.spatial_offset.lon + '°'} note="Nearest-neighbour grid cell" />}
                <Notice tone="info">A difference is not a trend. One profile against a 30-year monthly climatology says only how this cast compares to that average.</Notice>
              </>
            ) : (
              <EmptyState title="Comparison unavailable" body={woa.reason} />
            )}
          </Accordion>

          {mode === 'detailed' && (
            <Accordion title="Scientific details">
              <DataRow k="Temperature QC" v="Flags 1–2 retained; 3–4 and 9 dropped" />
              <DataRow k="Salinity QC" v={st?.missingPsal ? st.missingPsal + ' levels dropped' : 'no levels dropped'} />
              <DataRow k="Pressure field" v="PRES_ADJUSTED" />
              <DataRow k="Depth conversion" v="Gravity-corrected from pressure ▲" />
              <DataRow k="Vertical gaps" v="Not interpolated — the line breaks" />
            </Accordion>
          )}

          <Accordion title="Provenance">
            <DataRow k="Source" v="ERDDAP / Argo GDAC" />
            <DataRow k="Dataset" v="argo_profiles + argo_observations" />
            <DataRow k="Retrieved" v="2024-01-11 06:12 UTC" />
            <DataRow k="Marine heatwave detection" v="Not yet available" />
            <Mono className="fc-xs fc-muted">Argo data are collected and made freely available by the International Argo Program and the national programmes that contribute to it.</Mono>
          </Accordion>
        </div>
      </div>
    </div>
  );
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
  const stA = FC.stats(a.profile_id), stB = FC.stats(b.profile_id);
  const opts = FC.profiles.map((p) => ({ value: p.profile_id, label: p.profile_id + ' — ' + p.basinName + ' — ' + p.time.slice(0, 10) }));
  const key = variable === 'temp' ? 'temp' : 'psal';
  const overlap = obsA.filter((o) => o[key] != null && obsB.some((x) => x.depth === o.depth && x[key] != null));
  const diffs = overlap.map((o) => o[key] - obsB.find((x) => x.depth === o.depth)[key]);
  const meanDiff = diffs.length ? diffs.reduce((s, v) => s + v, 0) / diffs.length : null;

  return (
    <div className="fc-shell">
      <ScreenHead
        kicker="Compare" title="Two profiles on shared axes"
        sub="Same axes, same units, depth downward. Only levels present in both profiles are differenced."
        states={['ok']} state={state} setState={setState}
        actions={<Seg ariaLabel="Variable" value={variable} onChange={setVariable} options={[{ value: 'temp', label: 'Temperature' }, { value: 'psal', label: 'Salinity' }]} />}
      />
      <div className="fc-selectors">
        <Field label="Profile A" hint="Solid line, circles"><Select value={a.profile_id} onChange={(v) => app.setSel({ ...app.sel, compareA: v })} options={opts} /></Field>
        <Field label="Profile B" hint="Dashed line, squares"><Select value={b.profile_id} onChange={(v) => app.setSel({ ...app.sel, compareB: v })} options={opts} /></Field>
      </div>

      <div className="fc-profile-layout">
        <Panel kicker="Shared axes" title={variable === 'temp' ? 'Temperature against depth' : 'Salinity against depth'}
          actions={<Btn size="sm" onClick={() => exportSvgPng(svgRef.current, a.profile_id + '-vs-' + b.profile_id + '.png')}>Export PNG</Btn>}>
          <DepthChart svgRef={svgRef} variable={variable} series={[
            { id: 'a', label: a.platform + ' A', color: '#59c8be', obs: obsA },
            { id: 'b', label: b.platform + ' B', color: '#d56d50', obs: obsB, dashed: true, square: true },
          ]} />
          <div className="fc-row fc-gap-4 fc-wrap fc-mt-2">
            <span className="fc-key"><span className="fc-key-line" style={{ background: '#59c8be' }} />A · {a.profile_id}</span>
            <span className="fc-key"><span className="fc-key-line is-dash" style={{ background: '#d56d50' }} />B · {b.profile_id}</span>
            <Mono className="fc-xs fc-muted">{overlap.length} shared levels</Mono>
          </div>
        </Panel>
        <div className="fc-profile-side">
          <Panel kicker="Difference" title={meanDiff == null ? 'No shared levels' : 'A − B, mean ' + (meanDiff > 0 ? '+' : '') + meanDiff.toFixed(3) + (variable === 'temp' ? ' °C' : ' PSU')}>
            <DataRow k="Shared levels" v={overlap.length} />
            <DataRow k="Largest difference" v={diffs.length ? (Math.max(...diffs.map(Math.abs))).toFixed(3) + (variable === 'temp' ? ' °C' : ' PSU') : '—'} />
            <Notice tone="info">Differences are taken level by level. Where either profile is missing a level, no difference is computed.</Notice>
          </Panel>
          <Panel kicker="Side by side" title="Profile summaries">
            <table className="fc-table">
              <thead><tr><th></th><th>A</th><th>B</th></tr></thead>
              <tbody>
                <tr><td>Float</td><td><Mono>{a.platform}</Mono></td><td><Mono>{b.platform}</Mono></td></tr>
                <tr><td>Region</td><td>{a.basinName}</td><td>{b.basinName}</td></tr>
                <tr><td>Observed</td><td><Mono>{a.time.slice(0, 10)}</Mono></td><td><Mono>{b.time.slice(0, 10)}</Mono></td></tr>
                <tr><td>Surface T</td><td><Mono>{fmt.t(stA?.sst)}</Mono></td><td><Mono>{fmt.t(stB?.sst)}</Mono></td></tr>
                <tr><td>Mixed layer</td><td><Mono>{fmt.m(stA?.mldDepth)}</Mono></td><td><Mono>{fmt.m(stB?.mldDepth)}</Mono></td></tr>
                <tr><td>Max depth</td><td><Mono>{a.depth_max} m</Mono></td><td><Mono>{b.depth_max} m</Mono></td></tr>
                <tr><td>Data mode</td><td>{fmt.mode(a.data_mode)}</td><td>{fmt.mode(b.data_mode)}</td></tr>
              </tbody>
            </table>
          </Panel>
        </div>
      </div>
    </div>
  );
}

window.FCScreens = Object.assign(window.FCScreens || {}, { profile: ProfileScreen, compare: CompareScreen });
Object.assign(window, { DepthChart, ProfileScreen, CompareScreen });
