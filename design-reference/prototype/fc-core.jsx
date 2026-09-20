/* FloatChat — data model + shared UI. Data model mirrors the FastAPI schema in
   AnirudhHarish07/FloatChat (api/main.py): platform, cycle, direction, data_mode,
   profile_id, time, lat/lon, depth_min/max, temp_count, psal_count, observations
   with pres/depth/temp/psal/source_field, and woa_match's 20 m max-gap rule. */

const rngFrom = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const wrapLon = (x) => ((((x + 180) % 360) + 360) % 360) - 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

const BASINS = [
  { id: 'north-atlantic', name: 'North Atlantic', lon: [-62, -12], lat: [12, 58], sal: 36.3, w: 16 },
  { id: 'south-atlantic', name: 'South Atlantic', lon: [-38, 8], lat: [-46, -4], sal: 35.4, w: 10 },
  { id: 'north-pacific', name: 'North Pacific', lon: [148, 232], lat: [8, 50], sal: 34.4, w: 20 },
  { id: 'south-pacific', name: 'South Pacific', lon: [-168, -82], lat: [-52, -6], sal: 35.0, w: 16 },
  { id: 'indian', name: 'Indian Ocean', lon: [52, 108], lat: [-42, 14], sal: 35.1, w: 16 },
  { id: 'southern', name: 'Southern Ocean', lon: [-178, 178], lat: [-64, -46], sal: 34.2, w: 12 },
  { id: 'arabian-sea', name: 'Arabian Sea & Bay of Bengal', lon: [56, 94], lat: [4, 22], sal: 35.6, w: 8 },
];

const LEVELS = (() => { const out = []; for (let d = 0; d <= 200; d += 10) out.push(d); for (let d = 225; d <= 500; d += 25) out.push(d); for (let d = 550; d <= 1000; d += 50) out.push(d); for (let d = 1100; d <= 2000; d += 100) out.push(d); return out; })();

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
  return { sst, mld, thermoZ, thermoW, deepT, surfSal, salMinZ, deepSal: 34.68 + (r() - 0.5) * 0.09 };
}

function tempAt(s, d) {
  if (d <= s.mld) return s.sst - (d / Math.max(s.mld, 1)) * 0.35;
  const t = 1 / (1 + Math.exp((d - s.thermoZ) / (s.thermoW * 0.34)));
  return s.deepT + (s.sst - 0.35 - s.deepT) * t;
}
function psalAt(s, d) {
  if (d <= s.mld) return s.surfSal;
  if (d < s.salMinZ) { const t = (d - s.mld) / (s.salMinZ - s.mld); return lerp(s.surfSal, Math.min(s.surfSal, s.deepSal) - 0.22, Math.pow(t, 0.8)); }
  const t = clamp((d - s.salMinZ) / 900, 0, 1);
  return lerp(Math.min(s.surfSal, s.deepSal) - 0.22, s.deepSal, t);
}

const FC = {
  floats: [], profiles: [], byId: {}, timeSteps: [], land: null, obsCache: {},
  init(land) {
    this.land = land;
    const r = rngFrom(20240110);
    const onLand = (lon, lat) => (land && window.d3 ? d3.geoContains(land, [lon, lat]) : false);
    const floats = [];
    let wmo = 5903301;
    for (const b of BASINS) {
      for (let i = 0; i < b.w; i++) {
        let lon = 0, lat = 0, ok = false;
        for (let tries = 0; tries < 24 && !ok; tries++) {
          lon = wrapLon(lerp(b.lon[0], b.lon[1], r()));
          lat = lerp(b.lat[0], b.lat[1], r());
          ok = !onLand(lon, lat);
        }
        if (!ok) continue;
        wmo += 1 + Math.floor(r() * 7);
        const nProf = 4 + Math.floor(r() * 6);
        const f = { platform: String(wmo), basin: b.id, basinName: b.name, profiles: [] };
        let plon = lon, plat = lat;
        let heading = r() * 6.283;
        for (let c = 0; c < nProf; c++) {
          const cycle = 118 + c;
          const day = 4 + c * 10 + Math.floor(r() * 4);
          const time = new Date(Date.UTC(2024, 0, day, Math.floor(r() * 24), Math.floor(r() * 60)));
          heading += (r() - 0.5) * 2.4;
          const stepDeg = 0.35 + r() * 0.9;
          const nlon = wrapLon(plon + Math.cos(heading) * stepDeg), nlat = clamp(plat + Math.sin(heading) * stepDeg * 0.7, -66, 62);
          if (!onLand(nlon, nlat)) { plon = nlon; plat = nlat; }
          const deep = r() > 0.22 ? (r() > 0.5 ? 2000 : 1500) : 1000;
          const shallowStart = r() > 0.9 ? 40 : 0;
          const mode = r() > 0.62 ? 'D' : r() > 0.3 ? 'A' : 'R';
          const shape = profileShape(plat, plon, b.sal, (time.getUTCMonth() + 0.5) / 12, r);
          const gapSeed = r();
          const p = {
            profile_id: f.platform + '_' + cycle, platform: f.platform, cycle, direction: 'A', data_mode: mode,
            time: time.toISOString(), latitude: +plat.toFixed(3), longitude: +plon.toFixed(3),
            basin: b.id, basinName: b.name, depth_min: shallowStart, depth_max: deep,
            shape, gapSeed, psalMissing: r() > 0.86, seed: Math.floor(r() * 1e9),
          };
          const levels = LEVELS.filter((d) => d >= shallowStart && d <= deep);
          p.temp_count = levels.length - (r() > 0.7 ? 2 : 0);
          p.psal_count = p.psalMissing ? Math.floor(levels.length * 0.55) : levels.length - (r() > 0.8 ? 3 : 0);
          f.profiles.push(p);
        }
        if (f.profiles.length) floats.push(f);
      }
    }
    this.floats = floats;
    this.profiles = floats.flatMap((f) => f.profiles).sort((a, b2) => a.time.localeCompare(b2.time));
    this.profiles.forEach((p) => { this.byId[p.profile_id] = p; });
    const days = [...new Set(this.profiles.map((p) => p.time.slice(0, 10)))].sort();
    this.timeSteps = days;
    return this;
  },
  observations(profile_id) {
    if (this.obsCache[profile_id]) return this.obsCache[profile_id];
    const p = this.byId[profile_id];
    if (!p) return [];
    const r = rngFrom(p.seed);
    const s = p.shape;
    const out = LEVELS.filter((d) => d >= p.depth_min && d <= p.depth_max).map((d) => {
      const noise = (r() - 0.5) * (d < 300 ? 0.16 : 0.05);
      let temp = +(tempAt(s, d) + noise).toFixed(3);
      let psal = +(psalAt(s, d) + (r() - 0.5) * 0.02).toFixed(3);
      let temp_qc = '1', psal_qc = '1';
      if (r() > 0.985) { temp = null; temp_qc = '4'; }
      if (p.psalMissing && d > s.salMinZ * 0.8) { psal = null; psal_qc = '9'; }
      else if (r() > 0.99) { psal = null; psal_qc = '4'; }
      else if (r() > 0.96) psal_qc = '2';
      return { pres: +(d * 1.0053).toFixed(1), depth: d, temp, psal, temp_qc, psal_qc, source_field: 'PRES_ADJUSTED', derived_depth: true };
    });
    // one deliberate vertical gap in the mid-water column on some profiles
    if (p.gapSeed > 0.72) {
      const start = out.findIndex((o) => o.depth >= 60 + Math.floor(p.gapSeed * 120));
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
    const obs = this.observations(profile_id).filter((o) => o.temp != null);
    if (!obs.length) return null;
    const sst = obs[0].temp;
    let mldDepth = obs[0].depth;
    for (const o of obs) { if (Math.abs(o.temp - sst) < 0.2) mldDepth = o.depth; else break; }
    let maxGrad = 0, thermoDepth = null;
    for (let i = 1; i < obs.length; i++) {
      const dz = obs[i].depth - obs[i - 1].depth;
      if (!dz) continue;
      const g = (obs[i - 1].temp - obs[i].temp) / dz;
      if (g > maxGrad) { maxGrad = g; thermoDepth = (obs[i].depth + obs[i - 1].depth) / 2; }
    }
    const psals = this.observations(profile_id).filter((o) => o.psal != null);
    return {
      sst, mldDepth, thermoDepth, maxGrad,
      deepT: obs[obs.length - 1].temp, deepDepth: obs[obs.length - 1].depth,
      salSurface: psals.length ? psals[0].psal : null,
      salRange: psals.length ? [Math.min(...psals.map((o) => o.psal)), Math.max(...psals.map((o) => o.psal))] : null,
      levels: obs.length, missingTemp: this.observations(profile_id).filter((o) => o.temp == null).length,
      missingPsal: this.observations(profile_id).filter((o) => o.psal == null).length,
    };
  },
  /* Mirrors /api/woa_match: bracketed WOA standard depth, linear interpolation of
     Argo within a 20 m max gap, nearest-neighbour spatial lookup, else unavailable. */
  woaMatch(profile_id) {
    const p = this.byId[profile_id];
    const obs = this.observations(profile_id).filter((o) => o.temp != null);
    if (!obs.length) return { status: 'Comparison unavailable', reason: 'No valid temperature data' };
    const woaDepths = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
    const valid = woaDepths.filter((d) => d >= obs[0].depth && d <= obs[obs.length - 1].depth);
    if (!valid.length) return { status: 'Comparison unavailable', reason: 'No bracketed standard depth (no extrapolation allowed)' };
    const target = valid[0];
    let i = obs.findIndex((o) => o.depth >= target);
    if (i <= 0) i = 1;
    const d1 = obs[i - 1].depth, d2 = obs[i].depth;
    if (d2 - d1 > 20) return { status: 'Comparison unavailable', reason: 'Gap ' + (d2 - d1).toFixed(1) + 'm exceeds max configured gap 20.0m' };
    const t = (target - d1) / (d2 - d1);
    const argo = lerp(obs[i - 1].temp, obs[i].temp, t);
    const r = rngFrom(p.seed + 77);
    const month = +p.time.slice(5, 7);
    const woa = argo - (r() - 0.45) * 1.8;
    return {
      status: 'Success', argo_interpolated_value: +argo.toFixed(3), woa_reference_value: +woa.toFixed(3),
      difference: +(argo - woa).toFixed(3), units: 'degrees_celsius', comparison_depth: target, month,
      baseline_period: '1991-2020',
      method: 'Linear interpolation of Argo within 20m max gap; nearest-neighbor spatial WOA lookup',
      spatial_offset: { lat: +(Math.round(p.latitude) - p.latitude).toFixed(3), lon: +(Math.round(p.longitude) - p.longitude).toFixed(3) },
    };
  },
  coverage() {
    const lats = this.profiles.map((p) => p.latitude), lons = this.profiles.map((p) => p.longitude);
    return {
      dataset: 'ERDDAP GDAC Argo — global subset', label: 'cached historical observations',
      distinct_floats: this.floats.length, distinct_profiles: this.profiles.length,
      date_range: [this.profiles[0].time, this.profiles[this.profiles.length - 1].time],
      bounding_box: { west: Math.min(...lons), east: Math.max(...lons), south: Math.min(...lats), north: Math.max(...lats) },
    };
  },
  defaultFilters: { basin: 'all', start: '2024-01-01', end: '2024-03-31', depthMin: 0, depthMax: 2000, tempMin: -2, tempMax: 32, salMin: 33, salMax: 37, floatIds: '', dataMode: 'all', qcStrict: true },
  filter(f) {
    return this.profiles.filter((p) => {
      if (f.basin !== 'all' && p.basin !== f.basin) return false;
      const d = p.time.slice(0, 10);
      if (d < f.start || d > f.end) return false;
      if (p.depth_max < f.depthMin || p.depth_min > f.depthMax) return false;
      if (f.dataMode !== 'all' && p.data_mode !== f.dataMode) return false;
      if (f.floatIds.trim()) { const ids = f.floatIds.split(/[,\s]+/).filter(Boolean); if (!ids.some((id) => p.platform.includes(id))) return false; }
      if (p.shape.sst < f.tempMin || p.shape.sst > f.tempMax) return false;
      if (p.shape.surfSal < f.salMin || p.shape.surfSal > f.salMax) return false;
      return true;
    });
  },
};

/* ── formatting + scales ─────────────────────────────────────────────── */
const fmt = {
  utc: (iso) => iso.slice(0, 10) + ' ' + iso.slice(11, 16) + ' UTC',
  day: (iso) => new Date(iso).toUTCString().slice(5, 16),
  coord: (lat, lon) => Math.abs(lat).toFixed(2) + '° ' + (lat >= 0 ? 'N' : 'S') + ', ' + Math.abs(lon).toFixed(2) + '° ' + (lon >= 0 ? 'E' : 'W'),
  mode: (m) => ({ R: 'Real-time', A: 'Adjusted', D: 'Delayed-mode' }[m] || m),
  t: (v) => (v == null ? '—' : v.toFixed(2) + ' °C'),
  s: (v) => (v == null ? '—' : v.toFixed(3) + ' PSU'),
  m: (v) => (v == null ? '—' : Math.round(v) + ' m'),
};
const TEMP_STOPS = [[-2, '#5a93b0'], [4, '#2f8f97'], [10, '#3fae9f'], [17, '#8bcbc4'], [23, '#e8cf9a'], [28, '#d56d50'], [32, '#b8452f']];
const SAL_STOPS = [[33, '#5a93b0'], [34.2, '#2b8a90'], [34.9, '#63b6b1'], [35.6, '#cfd9b6'], [36.6, '#c98a5c'], [37.2, '#a8563a']];
function rampColor(stops, v) {
  if (v == null || Number.isNaN(v)) return '#3d4d54';
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      const t = (v - a) / (b - a);
      const pa = d3.color(ca), pb = d3.color(cb);
      return d3.interpolateRgb(pa, pb)(t);
    }
  }
  return stops[stops.length - 1][1];
}
const scale = { temp: (v) => rampColor(TEMP_STOPS, v), psal: (v) => rampColor(SAL_STOPS, v) };

/* ── app context ─────────────────────────────────────────────────────── */
const AppCtx = React.createContext(null);
const useApp = () => React.useContext(AppCtx);

/* ── shared UI atoms ─────────────────────────────────────────────────── */
function Btn({ variant = 'secondary', size, children, ...rest }) {
  const cls = ['fc-btn', 'fc-btn-' + variant, size === 'sm' ? 'fc-btn-sm' : '', rest.className || ''].join(' ').trim();
  return <button {...rest} className={cls}>{children}</button>;
}
function IconBtn({ label, children, ...rest }) { return <button {...rest} aria-label={label} title={label} className={'fc-btn fc-btn-icon ' + (rest.className || '')}>{children}</button>; }
function Tag({ tone = 'neutral', children }) { return <span className={'fc-tag fc-tag-' + tone}>{children}</span>; }
function Kicker({ children }) { return <div className="fc-kicker">{children}</div>; }
function Mono({ children, className = '' }) { return <span className={'fc-mono ' + className}>{children}</span>; }

function Panel({ title, kicker, actions, children, className = '', ...rest }) {
  return (
    <section className={'fc-panel ' + className} {...rest}>
      {(title || actions) && (
        <header className="fc-panel-head">
          <div>{kicker && <Kicker>{kicker}</Kicker>}{title && <h4 className="fc-panel-title">{title}</h4>}</div>
          {actions && <div className="fc-row fc-gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/* State chips — per-screen state matrix switches, in the screen's own header. */
const STATE_LABELS = { ok: 'Live', loading: 'Loading', empty: 'Empty', error: 'Request failed', fallback: 'Historical fallback', nowebgl: 'No WebGL', signedout: 'Signed out', stale: 'Stale proposal', invalid: 'Validation errors', planned: 'Planned feature' };
function StateChips({ states, value, onChange }) {
  return (
    <div className="fc-chips" role="group" aria-label="Screen state">
      <span className="fc-chips-label">State</span>
      {states.map((s) => (
        <button key={s} className={'fc-chip' + (value === s ? ' is-on' : '')} aria-pressed={value === s} onClick={() => onChange(s)}>{STATE_LABELS[s] || s}</button>
      ))}
    </div>
  );
}

function Loading({ label = 'Loading observations', lines = 3 }) {
  return (
    <div className="fc-state" role="status" aria-live="polite">
      <div className="fc-row fc-gap-3"><span className="fc-spinner" aria-hidden="true"></span><span className="fc-mono fc-sm">{label}…</span></div>
      <div className="fc-skel-wrap">{Array.from({ length: lines }).map((_, i) => <div key={i} className="fc-skel" style={{ width: [88, 64, 74, 52][i % 4] + '%' }} />)}</div>
    </div>
  );
}
function EmptyState({ title = 'No observations match', body, action }) {
  return <div className="fc-state"><h5 className="fc-state-title">{title}</h5><p className="fc-muted fc-sm">{body}</p>{action}</div>;
}
function ErrorState({ title = 'Request failed', body, onRetry, detail }) {
  return (
    <div className="fc-state fc-state-error" role="alert">
      <h5 className="fc-state-title">{title}</h5>
      <p className="fc-muted fc-sm">{body}</p>
      {detail && <pre className="fc-pre">{detail}</pre>}
      {onRetry && <Btn size="sm" onClick={onRetry}>Retry request</Btn>}
    </div>
  );
}
function Notice({ tone = 'info', children }) { return <p className={'fc-notice fc-notice-' + tone}>{children}</p>; }

function Field({ label, hint, error, children }) {
  return <label className="fc-field"><span className="fc-field-label">{label}</span>{children}{error ? <span className="fc-field-error">{error}</span> : hint ? <span className="fc-field-hint">{hint}</span> : null}</label>;
}
function Select({ value, onChange, options, ...rest }) {
  return <select className="fc-input" value={value} onChange={(e) => onChange(e.target.value)} {...rest}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
}
function Seg({ value, onChange, options, ariaLabel }) {
  return (
    <div className="fc-seg" role="tablist" aria-label={ariaLabel}>
      {options.map((o) => <button key={o.value} role="tab" aria-selected={value === o.value} className={'fc-seg-opt' + (value === o.value ? ' is-on' : '')} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}
function Accordion({ title, children, open: initial = false }) {
  const [open, setOpen] = React.useState(initial);
  return (
    <div className={'fc-acc' + (open ? ' is-open' : '')}>
      <button className="fc-acc-head" aria-expanded={open} onClick={() => setOpen(!open)}><span>{title}</span><span className="fc-acc-mark" aria-hidden="true">{open ? '–' : '+'}</span></button>
      <div className="fc-acc-body" hidden={!open}>{children}</div>
    </div>
  );
}
function DataRow({ k, v, note }) {
  return <div className="fc-datarow"><span className="fc-muted fc-sm">{k}</span><span className="fc-mono fc-sm">{v}{note && <em className="fc-derived" title={note}> ▲</em>}</span></div>;
}

/* PNG export of an inline SVG chart */
function exportSvgPng(svg, filename) {
  if (!svg) return;
  const clone = svg.cloneNode(true);
  const w = svg.viewBox.baseVal.width || svg.clientWidth, h = svg.viewBox.baseVal.height || svg.clientHeight;
  clone.setAttribute('width', w); clone.setAttribute('height', h);
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = w * 2; c.height = h * 2;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0b1e26'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png'); a.download = filename; a.click();
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
}

function useElementWidth(fallback = 720) {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(fallback);
  React.useEffect(() => {
    if (!ref.current || !window.ResizeObserver) return;
    const ro = new ResizeObserver((entries) => { const cw = entries[0].contentRect.width; if (cw > 40) setW(cw); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
const prefersReduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

Object.assign(window, {
  FC, fmt, scale, TEMP_STOPS, SAL_STOPS, AppCtx, useApp, Btn, IconBtn, Tag, Kicker, Mono, Panel,
  StateChips, Loading, EmptyState, ErrorState, Notice, Field, Select, Seg, Accordion, DataRow,
  exportSvgPng, useElementWidth, prefersReduced, clamp, lerp, wrapLon, rngFrom,
});
