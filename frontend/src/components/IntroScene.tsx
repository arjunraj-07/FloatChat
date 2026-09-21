'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { interpolateRgb } from 'd3-interpolate';
import { geoOrthographic, geoPath, geoDistance, geoGraticule10 } from 'd3-geo';
import * as topojson from 'topojson-client';
import landTopo from 'world-atlas/land-110m.json';

import type { CoverageInfo } from '@/lib/explorerModel.ts';

export interface IntroMarker {
  latitude: number;
  longitude: number;
  profile_id?: string;
}

export interface Props {
  markers: IntroMarker[];
  searchRegion: any | null;
  coverage?: CoverageInfo | null;
  onSkip: () => void;
  onOpenAssistant: () => void;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(v, max));
}

function rngFrom(seed: number) {
  return function () {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

function lerpHex(a: string, b: string, t: number) {
  return interpolateRgb(a, b)(clamp(t, 0, 1));
}

const landGeoJSON = topojson.feature(landTopo as any, (landTopo as any).objects.land);

export function OceanScene({ depth, motion, pointerRef }: { depth: number; motion: boolean; pointerRef: React.MutableRefObject<any> }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const raf = useRef<number>(0);
  const depthRef = useRef(depth);
  const motionRef = useRef(motion);
  
  useEffect(() => { depthRef.current = depth; }, [depth]);
  useEffect(() => { motionRef.current = motion; }, [motion]);

  useEffect(() => {
    const canvas = cv.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
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
    let painted = 0;

    // Read-only probe for the browser checks, mirroring SceneProbe's shape for
    // the R3F views. This canvas is 2D, so there is no WebGL renderer to report.
    // `clock` is the ambient time the animation advances; pausing freezes it
    // while the canvas still repaints, so a check must assert on the clock, not
    // on a frame count. Registered here because the introduction lost its probe
    // when it moved from the R3F scene to this canvas.
    const registry = (window.__floatchatScene ??= {});
    registry.intro = {
      frames: () => painted,
      clock: () => t,
      ambient: () => motionRef.current,
    };

    const draw = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      if (motionRef.current) t += dt;
      painted += 1;
      const d = depthRef.current;
      const cx = W / 2, cy = H * (0.52 - d * 0.04);
      const unit = Math.min(W, H) * 0.62;
      const ptr = pointerRef.current;

      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, d < 0.5 ? '#15505c' : '#0d3441');
      g.addColorStop(0.45, lerpHex('#11414f', '#0a2632', d));
      g.addColorStop(1, lerpHex('#08202a', '#050f16', d));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

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

      const proj = (p: any) => { const s = (FOCAL / p.z) * unit; return [cx + p.x * s, cy + p.y * s, s]; };
      ctx.save();
      for (const p of parts) {
        if (motionRef.current) {
          const [sx, sy, s] = proj(p);
          if (ptr.active && ptr.speed > 0.01) {
            const dx = sx - ptr.x, dy = sy - ptr.y;
            const MathR = Math.max(W, H) * 0.22;
            const dist = Math.hypot(dx, dy);
            if (dist < MathR) {
              const fall = (1 - dist / MathR) ** 2 / Math.max(p.z * 0.5, 0.4);
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

      const fa = clamp((d - 0.22) / 0.3, 0, 1);
      if (fa > 0.01) drawFloat(ctx, cx + W * 0.18, cy - H * 0.02 + Math.sin(t * 0.5) * 6 * (motionRef.current ? 1 : 0), Math.min(W, H) * 0.0013 * 100, fa, t, motionRef.current);

      ctx.fillStyle = 'rgba(5,15,22,' + (0.1 + d * 0.22) + ')';
      ctx.fillRect(0, 0, W, H);
      raf.current = requestAnimationFrame(draw);
    };
    raf.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener('resize', resize);
      if (window.__floatchatScene) delete window.__floatchatScene.intro;
    };
  }, [pointerRef]);

  return <canvas ref={cv} className="fc-hero-canvas" aria-hidden="true" />;
}

function drawFloat(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, alpha: number, t: number, moving: boolean) {
  const w = 13 * k * 0.1, h = 62 * k * 0.1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = 'rgba(139,203,196,0.55)';
  ctx.lineWidth = 1;
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
  ctx.fillStyle = 'rgba(16,47,58,0.92)';
  ctx.strokeStyle = 'rgba(180,222,216,0.85)';
  ctx.beginPath();
  if (ctx.roundRect) {
      ctx.roundRect(x - w / 2, y - h / 2, w, h, w / 2);
  } else {
      ctx.rect(x - w / 2, y - h / 2, w, h);
  }
  ctx.fill(); ctx.stroke();
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

function HeroGlobe({ depth, markers }: { depth: number; markers: IntroMarker[] }) {
  const [w, setW] = useState(520);
  const ref = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
        setW(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const size = clamp(w, 240, 430);
  const [lon, setLon] = useState(-78);
  
  useEffect(() => {
    let raf: number;
    let t0 = performance.now(), lastTick = t0, base = -78, lastCommit = 0;
    const tick = (now: number) => {
      if (document.hidden || now - lastTick > 250) { base -= ((lastTick - t0) / 1000) * 6; t0 = now; }
      lastTick = now;
      if (!document.hidden && now - lastCommit >= 45) {
        lastCommit = now;
        setLon(base - ((now - t0) / 1000) * 6);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  
  const path = useMemo(() => {
    if (!landGeoJSON) return null;
    const proj = geoOrthographic().rotate([lon, 8]).fitExtent([[6, 6], [size - 6, size - 6]], { type: 'Sphere' });
    const gen = geoPath(proj);
    return { land: gen(landGeoJSON as any), grat: gen(geoGraticule10() as any), sphere: gen({ type: 'Sphere' } as any), proj };
  }, [size, lon]);
  
  const marks = useMemo(() => {
    if (!path) return [];
    return markers.filter((_, i) => i % 7 === 0).map((p) => ({
      p,
      xy: path.proj([p.longitude, p.latitude]),
      vis: geoDistance([p.longitude, p.latitude], [-lon, -8]) < 1.55
    }));
  }, [path, lon, markers]);
  
  const fade = clamp(1 - depth * 2.6, 0, 1);
  return (
    <div ref={ref} className="fc-hero-globe" style={{ opacity: fade, transform: 'scale(' + (1 + depth * 1.8) + ')' }}>
      {path && (
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
          <defs>
            <radialGradient id="fc-ocean-fill" cx="38%" cy="32%">
              <stop offset="0%" stopColor="#18606c" /><stop offset="70%" stopColor="#0d3040" /><stop offset="100%" stopColor="#071c26" />
            </radialGradient>
          </defs>
          <path d={path.sphere || ''} fill="url(#fc-ocean-fill)" />
          <path d={path.grat || ''} fill="none" stroke="rgba(139,203,196,0.14)" strokeWidth="0.5" />
          <path d={path.land || ''} fill="#0b2129" stroke="rgba(139,203,196,0.42)" strokeWidth="0.6" />
          <path d={path.sphere || ''} fill="none" stroke="rgba(139,203,196,0.3)" strokeWidth="1" />
          {marks.filter((m) => m.vis && m.xy).map((m, i) => (
            <circle key={m.p.profile_id || i} cx={m.xy![0]} cy={m.xy![1]} r="1.6" fill="#8bcbc4" opacity="0.85" />
          ))}
        </svg>
      )}
    </div>
  );
}

export default function IntroScene({ markers, coverage, onSkip, onOpenAssistant }: Props) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const [paused, setPaused] = useState(false);
  // `useState(reduced ? 1 : 0)` could only ever read false, because `reduced` is
  // resolved in an effect that runs after the first render. Under reduced motion
  // the depth then stayed at 0 while the scroll handler below was disabled, so
  // the hero was stuck at the surface with no way to descend. Derive it instead:
  // reduced motion shows the hero fully descended, its static readable state.
  const [scrollDepth, setDepth] = useState(0);
  const depth = reduced ? 1 : scrollDepth;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef({ x: 0, y: 0, vx: 0, vy: 0, speed: 0, active: false });

  useEffect(() => {
    if (reduced) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onScroll = () => {
      const el = wrap.current;
      if (!el) return;
      const total = el.offsetHeight - scroller.clientHeight;
      setDepth(clamp(scroller.scrollTop / Math.max(total, 1), 0, 1));
    };
    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [reduced]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let lx = 0, ly = 0, lt = performance.now();
    const move = (e: PointerEvent) => {
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
    el.addEventListener('pointermove', move as any);
    el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointermove', move as any); el.removeEventListener('pointerleave', leave); };
  }, []);

  return (
    <div
      ref={scrollerRef}
      className="intro-page"
      data-testid="intro"
      style={{ position: 'fixed', inset: 0, zIndex: 2000, overflowY: 'auto', background: 'var(--fc-bg)', color: 'var(--fc-fg)' }}
    >
      <div className="fc-hero-wrap" ref={wrap} style={{ height: reduced ? 'auto' : '280vh' }}>
        <div className="fc-hero-stage" ref={stageRef} style={{ position: reduced ? 'relative' : 'sticky', top: 0, height: '100vh' }}>
          {/* Reduced motion switches off the ambient animation too, not only
              the scroll-driven descent. */}
          <OceanScene depth={depth} motion={!paused && !reduced} pointerRef={pointerRef} />
          <div className="fc-hero-globe-slot">{depth < 0.42 && <HeroGlobe depth={depth} markers={markers} />}</div>

          <div className="fc-hero-copy" style={{ transform: `translateY(${-depth * 26}px)` }}>
            <div style={{ marginBottom: '1.5rem', opacity: 1 - depth * 3 }}>
              <span className="fc-brand">
                <span className="fc-brand-mark" aria-hidden="true"><span></span><span></span><span></span></span>
                FloatChat
              </span>
            </div>
            {coverage && <div className="fc-kicker">Argo global array · {coverage.label}</div>}
            <h1 className="fc-hero-h1">Explore real Argo<br />ocean observations.</h1>
            <p className="fc-hero-lede">Understand how temperature and salinity change with depth. Ask questions about the data that is actually available — and see the evidence behind every answer.</p>
            <div className="fc-row fc-gap-3 fc-wrap fc-mt-4">
              <button className="fc-btn fc-btn-primary" data-testid="skip-intro" onClick={onSkip}>Explore ocean data</button>
              <button className="fc-btn" onClick={onOpenAssistant}>Ask the assistant</button>
            </div>
            <dl className="fc-hero-facts">
              <div><dt>Floats</dt><dd><span className="fc-mono">{coverage ? coverage.distinct_floats : '...'}</span></dd></div>
              <div><dt>Profiles</dt><dd><span className="fc-mono">{coverage ? coverage.distinct_profiles : '...'}</span></dd></div>
              <div><dt>Window</dt><dd><span className="fc-mono">{coverage ? `${coverage.date_range[0].slice(0, 10)} → ${coverage.date_range[1].slice(0, 10)}` : '...'}</span></dd></div>
              <div><dt>Depth</dt><dd><span className="fc-mono">{coverage && coverage.depth_range_m ? `${coverage.depth_range_m[0]}–${coverage.depth_range_m[1]} m` : '...'}</span></dd></div>
            </dl>
          </div>

          <div className="fc-hero-controls" style={{ display: 'flex', gap: '1rem', alignItems: 'center', pointerEvents: 'auto' }}>
            <div className="fc-depthmeter" aria-hidden="true"><div className="fc-depthmeter-fill" style={{ height: (depth * 100).toFixed(1) + '%' }} /></div>
            <span className="fc-mono fc-sm fc-muted">{Math.round(depth * (coverage?.depth_range_m?.[1] || 2000))} m</span>
            <button 
              type="button" 
              data-testid="intro-motion"
              onClick={() => setPaused(!paused)} 
              style={{ background: 'transparent', border: '1px solid rgba(139,203,196,0.3)', color: '#8bcbc4', borderRadius: '4px', padding: '4px 8px', fontSize: '12px', cursor: 'pointer', marginLeft: 'auto' }}
            >
              {paused ? 'Resume motion' : 'Pause motion'}
            </button>
          </div>

          {!reduced && depth < 0.08 && <div className="fc-hero-scrollhint" aria-hidden="true">Scroll to descend</div>}
        </div>
        {!reduced && <p className="fc-hero-sr">Move the pointer through the water to drag a wake through the plankton field.</p>}
      </div>
    </div>
  );
}
