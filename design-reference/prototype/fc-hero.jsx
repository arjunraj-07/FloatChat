/* FloatChat — home hero. A depth-projected underwater scene on 2D canvas:
   plankton live in a 3D box and are projected through a pinhole camera, so the
   pointer's wake carries real parallax. No WebGL, so there is no unsupported path. */

function OceanScene({ depth, motion, pointerRef }) {
  const cv = React.useRef(null);
  const raf = React.useRef(0);
  const depthRef = React.useRef(depth);
  const motionRef = React.useRef(motion);
  depthRef.current = depth; motionRef.current = motion;

  React.useEffect(() => {
    const canvas = cv.current;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const rnd = rngFrom(4812);
    const N = 240;
    const parts = Array.from({ length: N }, () => {
      const z = 0.55 + rnd() * 3.6;
      return { hx: (rnd() - 0.5) * 3.4, hy: (rnd() - 0.5) * 2.1, hz: z, x: 0, y: 0, z, vx: 0, vy: 0, vz: 0, ph: rnd() * 6.28, sp: 0.4 + rnd() * 0.9, big: rnd() > 0.88 };
    });
    parts.forEach((p) => { p.x = p.hx; p.y = p.hy; });

    const FOCAL = 1.55;
    let t = 0, last = performance.now();

    const draw = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      if (motionRef.current) t += dt;
      const d = depthRef.current;                       // 0 = surface, 1 = deep
      const cx = W / 2, cy = H * (0.52 - d * 0.04);
      const unit = Math.min(W, H) * 0.62;
      const ptr = pointerRef.current;

      // water column
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, d < 0.5 ? '#15505c' : '#0d3441');
      g.addColorStop(0.45, lerpHex('#11414f', '#0a2632', d));
      g.addColorStop(1, lerpHex('#08202a', '#050f16', d));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

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
          ctx.moveTo(x0 - spread, -20); ctx.lineTo(x0 + spread, -20);
          ctx.lineTo(x0 + spread * 2.6, H * (0.95 - d * 0.3)); ctx.lineTo(x0 + spread * 1.1, H * (0.95 - d * 0.3));
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }

      // plankton: pointer wake as a velocity impulse, spring back to home
      const proj = (p) => { const s = (FOCAL / p.z) * unit; return [cx + p.x * s, cy + p.y * s, s]; };
      ctx.save();
      for (const p of parts) {
        if (motionRef.current) {
          const [sx, sy, s] = proj(p);
          if (ptr.active && ptr.speed > 0.01) {
            const dx = sx - ptr.x, dy = sy - ptr.y;
            const R = Math.max(W, H) * 0.22;
            const dist = Math.hypot(dx, dy);
            if (dist < R) {
              const fall = (1 - dist / R) ** 2 / Math.max(p.z * 0.5, 0.4);
              p.vx += (ptr.vx / unit) * fall * 2.4 + (dx / (dist + 6)) * 0.004 * fall;
              p.vy += (ptr.vy / unit) * fall * 2.4 + (dy / (dist + 6)) * 0.004 * fall;
              p.vz += (ptr.speed / unit) * fall * 0.35 * (p.big ? -1 : 1);
            }
          }
          p.vx += (p.hx - p.x) * 0.0022 + Math.sin(t * 0.3 * p.sp + p.ph) * 0.00022;
          p.vy += (p.hy - p.y) * 0.0022 + Math.cos(t * 0.24 * p.sp + p.ph) * 0.00018 + 0.00006;
          p.vz += (p.hz - p.z) * 0.0018;
          p.vx *= 0.955; p.vy *= 0.955; p.vz *= 0.94;
          p.x += p.vx; p.y += p.vy; p.z = clamp(p.z + p.vz, 0.5, 4.4);
        }
        const [sx, sy, s] = proj(p);
        if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) continue;
        const r = (p.big ? 2.3 : 1.15) * (s / unit) * 1.5;
        const near = clamp(1.25 - p.z / 4.4, 0.12, 1);
        ctx.globalAlpha = near * (0.5 - d * 0.16) + 0.06;
        ctx.fillStyle = p.big ? '#cfe9e4' : '#8bcbc4';
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(r, 0.5), 0, 6.283); ctx.fill();
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
    return () => { cancelAnimationFrame(raf.current); window.removeEventListener('resize', resize); };
  }, []);

  return <canvas ref={cv} className="fc-hero-canvas" aria-hidden="true" />;
}

function lerpHex(a, b, t) { return d3.interpolateRgb(a, b)(clamp(t, 0, 1)); }

/* Schematic only: cylinder body, antenna, sensor band, ascent track with depth ticks. */
function drawFloat(ctx, x, y, k, alpha, t, moving) {
  const w = 13 * k * 0.1, h = 62 * k * 0.1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = 'rgba(139,203,196,0.55)';
  ctx.lineWidth = 1;
  // ascent track
  ctx.beginPath();
  ctx.setLineDash([3, 6]);
  ctx.moveTo(x, y - h * 2.6); ctx.lineTo(x, y + h * 2.2);
  ctx.stroke();
  ctx.setLineDash([]);
  for (let i = 0; i < 7; i++) {
    const ty = y + h * 2.2 - (i / 6) * h * 4.8;
    ctx.globalAlpha = alpha * 0.5;
    ctx.beginPath(); ctx.moveTo(x - 5, ty); ctx.lineTo(x + 5, ty); ctx.stroke();
  }
  ctx.globalAlpha = alpha;
  // body
  ctx.fillStyle = 'rgba(16,47,58,0.92)';
  ctx.strokeStyle = 'rgba(180,222,216,0.85)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, w / 2);
  else ctx.rect(x - w / 2, y - h / 2, w, h);
  ctx.fill(); ctx.stroke();
  // sensor band + antenna
  ctx.strokeStyle = 'rgba(213,109,80,0.9)';
  ctx.beginPath(); ctx.moveTo(x - w / 2, y - h * 0.24); ctx.lineTo(x + w / 2, y - h * 0.24); ctx.stroke();
  ctx.strokeStyle = 'rgba(180,222,216,0.8)';
  ctx.beginPath(); ctx.moveTo(x, y - h / 2); ctx.lineTo(x, y - h / 2 - h * 0.34); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y - h / 2 - h * 0.36, 1.8, 0, 6.283); ctx.fillStyle = '#d56d50'; ctx.fill();
  if (moving) {
    const pulse = (Math.sin(t * 1.6) + 1) / 2;
    ctx.globalAlpha = alpha * 0.35 * pulse;
    ctx.beginPath(); ctx.arc(x, y - h / 2 - h * 0.36, 4 + pulse * 6, 0, 6.283);
    ctx.strokeStyle = '#d56d50'; ctx.stroke();
  }
  ctx.restore();
}

/* Real coastline geometry, orthographic, framed on the dataset's centre of mass. */
function HeroGlobe({ depth }) {
  const [ref, w] = useElementWidth(520);
  const size = clamp(w, 240, 430);
  const [lon, setLon] = React.useState(-78);
  React.useEffect(() => {
    let raf, t0 = performance.now(), lastTick = t0, base = -78, lastCommit = 0;
    const tick = (now) => {
      if (document.hidden || now - lastTick > 250) { base -= ((lastTick - t0) / 1000) * 6; t0 = now; } /* rebase across a hidden tab */
      lastTick = now;
      if (!document.hidden && now - lastCommit >= 45) {
        lastCommit = now;
        setLon(base - ((now - t0) / 1000) * 6); /* absolute elapsed time — 6°/s regardless of frame rate */
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const path = React.useMemo(() => {
    if (!FC.land) return null;
    const proj = d3.geoOrthographic().rotate([lon, 8]).fitExtent([[6, 6], [size - 6, size - 6]], { type: 'Sphere' });
    const gen = d3.geoPath(proj);
    return { land: gen(FC.land), grat: gen(d3.geoGraticule10()), sphere: gen({ type: 'Sphere' }), proj };
  }, [size, lon]);
  const marks = React.useMemo(() => {
    if (!path) return [];
    return FC.profiles.filter((_, i) => i % 7 === 0).map((p) => ({ p, xy: path.proj([p.longitude, p.latitude]), vis: d3.geoDistance([p.longitude, p.latitude], [-lon, -8]) < 1.55 }));
  }, [path, lon]);
  const fade = clamp(1 - depth * 2.6, 0, 1);
  return (
    <div ref={ref} className="fc-hero-globe" style={{ opacity: fade, transform: 'scale(' + (1 + depth * 1.8) + ')' }}>
      {path && (
        <svg viewBox={'0 0 ' + size + ' ' + size} width={size} height={size} aria-hidden="true">
          <defs>
            <radialGradient id="fc-ocean-fill" cx="38%" cy="32%">
              <stop offset="0%" stopColor="#18606c" /><stop offset="70%" stopColor="#0d3040" /><stop offset="100%" stopColor="#071c26" />
            </radialGradient>
          </defs>
          <path d={path.sphere} fill="url(#fc-ocean-fill)" />
          <path d={path.grat} fill="none" stroke="rgba(139,203,196,0.14)" strokeWidth="0.5" />
          <path d={path.land} fill="#0b2129" stroke="rgba(139,203,196,0.42)" strokeWidth="0.6" />
          <path d={path.sphere} fill="none" stroke="rgba(139,203,196,0.3)" strokeWidth="1" />
          {marks.filter((m) => m.vis).map((m) => <circle key={m.p.profile_id} cx={m.xy[0]} cy={m.xy[1]} r="1.6" fill="#8bcbc4" opacity="0.85" />)}
        </svg>
      )}
    </div>
  );
}

function HeroScreen() {
  const app = useApp();
  const reduced = prefersReduced();
  const [depth, setDepth] = React.useState(reduced ? 1 : 0);
  const wrap = React.useRef(null);
  const stageRef = React.useRef(null);
  const pointerRef = React.useRef({ x: 0, y: 0, vx: 0, vy: 0, speed: 0, active: false });
  const coverage = React.useMemo(() => FC.coverage(), []);

  React.useEffect(() => {
    if (reduced) return;
    const onScroll = () => {
      const el = wrap.current; if (!el) return;
      const total = el.offsetHeight - window.innerHeight;
      setDepth(clamp((window.scrollY - el.offsetTop) / Math.max(total, 1), 0, 1));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [reduced]);

  React.useEffect(() => {
    const el = stageRef.current; if (!el) return;
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

  return (
    <div className="fc-hero-wrap" ref={wrap} style={{ height: reduced ? 'auto' : '280vh' }}>
      <div className="fc-hero-stage" ref={stageRef} style={{ position: reduced ? 'relative' : 'sticky' }}>
        <OceanScene depth={depth} motion={true} pointerRef={pointerRef} />
        <div className="fc-hero-globe-slot">{depth < 0.42 && <HeroGlobe depth={depth} />}</div>

        <header className="fc-hero-nav">
          <button className="fc-brand" onClick={() => app.go('home')}><span className="fc-brand-mark" aria-hidden="true"><span></span><span></span><span></span></span>FloatChat</button>
          <div className="fc-row fc-gap-2">
            {NAV.map((n) => <button key={n.id} className="fc-navlink" onClick={() => app.go(n.id)}>{n.label}</button>)}
            <AccountMenu />
          </div>
        </header>

        <div className="fc-hero-copy" style={{ transform: 'translateY(' + (-depth * 26) + 'px)' }}>
          <Kicker>Argo global array · {coverage.label}</Kicker>
          <h1 className="fc-hero-h1">Explore real Argo<br />ocean observations.</h1>
          <p className="fc-hero-lede">Understand how temperature and salinity change with depth. Ask questions about the data that is actually available — and see the evidence behind every answer.</p>
          <div className="fc-row fc-gap-3 fc-wrap fc-mt-4">
            <Btn variant="primary" onClick={() => app.go('explore')}>Explore ocean data</Btn>
            <Btn onClick={() => app.go('assistant')}>Ask the assistant</Btn>
          </div>
          <dl className="fc-hero-facts">
            <div><dt>Floats</dt><dd><Mono>{coverage.distinct_floats}</Mono></dd></div>
            <div><dt>Profiles</dt><dd><Mono>{coverage.distinct_profiles}</Mono></dd></div>
            <div><dt>Window</dt><dd><Mono>{coverage.date_range[0].slice(0, 10)} → {coverage.date_range[1].slice(0, 10)}</Mono></dd></div>
            <div><dt>Depth</dt><dd><Mono>0–2000 m</Mono></dd></div>
          </dl>
        </div>

        <div className="fc-hero-controls">
          <div className="fc-depthmeter" aria-hidden="true"><div className="fc-depthmeter-fill" style={{ height: (depth * 100).toFixed(1) + '%' }} /></div>
          <Mono className="fc-sm fc-muted">{Math.round(depth * 2000)} m</Mono>
        </div>

        {!reduced && depth < 0.08 && <div className="fc-hero-scrollhint" aria-hidden="true">Scroll to descend</div>}
      </div>
      {!reduced && <p className="fc-hero-sr">Move the pointer through the water to drag a wake through the plankton field.</p>}
    </div>
  );
}

window.FCScreens = Object.assign(window.FCScreens || {}, { home: HeroScreen });
Object.assign(window, { HeroScreen, OceanScene, HeroGlobe });
