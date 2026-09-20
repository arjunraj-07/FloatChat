'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import type { ExecutedProfile } from '@/lib/planContract.ts';
import { formatUtc } from '@/lib/explorerModel.ts';

const DIVE_MS = 1200;
const CROSS_MS = 110;

function buildEase(v0 = 0.55, inEnd = 0.1, outStart = 0.85, steps = 512) {
  const smooth = (x: number) => x * x * (3 - 2 * x);
  const vel = (t: number) => {
    if (t < inEnd) return v0 + (1 - v0) * smooth(t / inEnd);
    if (t < outStart) return 1;
    return 1 - smooth((t - outStart) / (1 - outStart));
  };
  const cum = new Float32Array(steps + 1);
  let acc = 0;
  for (let i = 1; i <= steps; i++) { acc += vel((i - 0.5) / steps) / steps; cum[i] = acc; }
  for (let i = 0; i <= steps; i++) cum[i] /= acc;
  return (t: number) => {
    const x = Math.max(0, Math.min(1, t)) * steps;
    const i = Math.min(steps - 1, Math.floor(x));
    return cum[i] + (cum[i + 1] - cum[i]) * (x - i);
  };
}

function gradientTexture(stops: [number, string][]) {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(c);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  ctx.fillStyle = g; ctx.fillRect(0, 0, 8, 256);
  return new THREE.CanvasTexture(c);
}

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

function buildScene(tx: number, tz: number) {
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xbfe4de, 0.22));
  const sun = new THREE.DirectionalLight(0xffffff, 0.95);
  sun.position.set(tx + 30, 90, tz + 40);
  scene.add(sun);
  const glow = new THREE.PointLight(0x8bcbc4, 1.25, 14, 2);
  glow.position.set(tx, -1.4, tz + 0.9);
  scene.add(glow);

  const mapPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(360, 180, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x0f4a58, roughness: 0.22, metalness: 0.18 })
  );
  mapPlane.rotation.x = -Math.PI / 2;
  scene.add(mapPlane);

  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(360, 180),
    new THREE.MeshBasicMaterial({ color: 0x0b3441 })
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -0.02;
  scene.add(ocean);

  const underside = new THREE.Mesh(
    new THREE.PlaneGeometry(360, 180),
    new THREE.MeshBasicMaterial({ color: 0x14586a, side: THREE.BackSide, transparent: true, opacity: 0.9 })
  );
  underside.rotation.x = -Math.PI / 2;
  underside.position.y = 0.04;
  scene.add(underside);

  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(46, 30, 40, 40, 1, true),
    new THREE.MeshBasicMaterial({ map: gradientTexture([[0, '#0f4956'], [0.45, '#093039'], [1, '#04121a']]), side: THREE.BackSide, transparent: true, opacity: 0.96, depthWrite: false })
  );
  column.position.set(tx, -17, tz);
  scene.add(column);
  scene.fog = new THREE.FogExp2(0x0a2e3a, 0.0);

  const floatGroup = new THREE.Group();
  floatGroup.position.set(tx, 0, tz);
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xc9d6d4, roughness: 0.42, metalness: 0.72 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 5.4, 64, 1, false), hullMat);
  floatGroup.add(body);
  const capTop = new THREE.Mesh(new THREE.SphereGeometry(1.5, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), hullMat);
  capTop.position.y = 2.7; floatGroup.add(capTop);
  const capBot = new THREE.Mesh(new THREE.SphereGeometry(1.5, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), hullMat);
  capBot.position.y = -2.7; floatGroup.add(capBot);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.54, 1.54, 0.34, 64), new THREE.MeshStandardMaterial({ color: 0x2fa79f, roughness: 0.35, metalness: 0.6 }));
  band.position.y = 1.1; floatGroup.add(band);
  const band2 = band.clone(); band2.position.y = -1.0; floatGroup.add(band2);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 2.4, 16), new THREE.MeshStandardMaterial({ color: 0x8a9a98, roughness: 0.5, metalness: 0.5 }));
  mast.position.y = 5.1; floatGroup.add(mast);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 14), new THREE.MeshBasicMaterial({ color: 0xd56d50 }));
  beacon.position.y = 6.3; floatGroup.add(beacon);
  scene.add(floatGroup);

  const cabin = new THREE.Group();
  cabin.position.set(tx, -1.5, tz);
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 2.4, 6.2, 64, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x14333d, roughness: 0.78, metalness: 0.42, side: THREE.BackSide })
  );
  cabin.add(wall);
  const ribMat = new THREE.MeshStandardMaterial({ color: 0x1d4b58, roughness: 0.6, metalness: 0.55, side: THREE.BackSide });
  [-2.15, 2.15].forEach((y) => {
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(2.37, 2.37, 0.2, 64, 1, true), ribMat);
    rib.position.y = y; cabin.add(rib);
  });

  const backing = new THREE.Mesh(
    new THREE.CircleGeometry(2.42, 64),
    new THREE.MeshStandardMaterial({ color: 0x0a2029, roughness: 0.9, metalness: 0.25 })
  );
  backing.position.set(0, 0, -2.46);
  cabin.add(backing);
  const rearCap = new THREE.Mesh(
    new THREE.CircleGeometry(2.42, 48),
    new THREE.MeshStandardMaterial({ color: 0x09202a, roughness: 0.92, metalness: 0.2, side: THREE.BackSide })
  );
  rearCap.position.set(0, 0, 3.0);
  cabin.add(rearCap);
  const capTopI = new THREE.Mesh(new THREE.CircleGeometry(2.42, 48), new THREE.MeshStandardMaterial({ color: 0x0b2630, roughness: 0.9, side: THREE.BackSide }));
  capTopI.rotation.x = Math.PI / 2; capTopI.position.y = 3.1; cabin.add(capTopI);
  const capBotI = capTopI.clone(); capBotI.rotation.x = -Math.PI / 2; capBotI.position.y = -3.1; cabin.add(capBotI);

  const panel = new THREE.Mesh(
    new THREE.CircleGeometry(1.62, 64),
    new THREE.MeshStandardMaterial({ color: 0x0b222b, roughness: 0.86, metalness: 0.3 })
  );
  panel.position.set(0, 0, -2.3);
  cabin.add(panel);
  const plateRing = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.07, 16, 72), new THREE.MeshStandardMaterial({ color: 0x1f5260, roughness: 0.45, metalness: 0.8 }));
  plateRing.position.set(0, 0, -2.29); cabin.add(plateRing);

  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x27616e, roughness: 0.34, metalness: 0.85 });
  const wellMat = new THREE.MeshStandardMaterial({ color: 0x061a22, roughness: 0.95, metalness: 0.1 });
  const gaugeAnchors: THREE.Vector3[] = [];
  [[0.2, 0.46], [0.2, -0.4]].forEach(([gx, gy]) => {
    const bez = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 18, 48), bezelMat);
    bez.position.set(gx, gy, -2.26); cabin.add(bez);
    const well = new THREE.Mesh(new THREE.CircleGeometry(0.32, 48), wellMat);
    well.position.set(gx, gy, -2.25); cabin.add(well);
    gaugeAnchors.push(new THREE.Vector3(gx, gy, -2.24));
  });

  const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.3), new THREE.MeshBasicMaterial({ color: 0x07202a }));
  strip.position.set(-0.42, -1.12, -2.26); cabin.add(strip);
  const stripAnchor = new THREE.Vector3(-0.42, -1.12, -2.24);

  const seaCanvas = document.createElement('canvas');
  seaCanvas.width = seaCanvas.height = 256;
  const sctx = seaCanvas.getContext('2d');
  if (sctx) {
    const rg = sctx.createRadialGradient(118, 112, 14, 128, 128, 150);
    rg.addColorStop(0, '#8fdad4'); rg.addColorStop(0.5, '#2a8f96'); rg.addColorStop(1, '#10545e');
    sctx.fillStyle = rg; sctx.fillRect(0, 0, 256, 256);
  }
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.54, 56), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(seaCanvas) }));
  glass.position.set(-1.0, 0.02, -2.25); cabin.add(glass);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.08, 20, 56), bezelMat);
  ring.position.set(-1.0, 0.02, -2.24); cabin.add(ring);

  const lampMat = new THREE.MeshBasicMaterial({ color: 0x59c8be });
  [-1.95, 1.95].forEach((x) => {
    const lamp = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 2.4), lampMat);
    lamp.position.set(x, 0.1, -1.6); lamp.rotation.y = x < 0 ? 0.5 : -0.5; cabin.add(lamp);
  });

  const MOTES = 150;
  const mp = new Float32Array(MOTES * 3);
  const mv = new Float32Array(MOTES);
  for (let i = 0; i < MOTES; i++) {
    mp[i * 3] = (Math.random() - 0.5) * 4.2;
    mp[i * 3 + 1] = (Math.random() - 0.5) * 5.0;
    mp[i * 3 + 2] = -2.2 + Math.random() * 4.0;
    mv[i] = 0.05 + Math.random() * 0.13;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    color: 0xbfe4de, size: 0.035, sizeAttenuation: true, transparent: true, opacity: 0.5, depthWrite: false,
  }));
  cabin.add(motes);

  cabin.visible = false;
  scene.add(cabin);

  const COUNT = 360;
  const pos = new Float32Array(COUNT * 3);
  const vel = new Float32Array(COUNT * 3);
  const seed = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.pow(Math.random(), 0.5) * 1.5;
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
    color: 0xdff3f0, size: 0.14, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false,
  }));
  bubbles.visible = false;
  scene.add(bubbles);

  return { scene, column, floatGroup, cabin, bubbles, bubbleData: { pos, vel, seed, COUNT }, gaugeAnchors, stripAnchor };
}

interface Anchors { gauges: { x: number, y: number }[], strip: { x: number, y: number } | null }

function DiveStage({ p, onSettled }: { p: ExecutedProfile, onSettled: (a: Anchors) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const anchors = useRef<Anchors>({ gauges: [], strip: null });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) { onSettled({ gauges: [], strip: null }); return; }

    const lon = p.longitude ?? 0;
    const lat = p.latitude ?? 0;
    const tx = lon, tz = -lat;
    const w = el.clientWidth, h = el.clientHeight;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    } catch (e) {
      el.innerHTML = '<div class="absolute inset-0 flex items-center justify-center bg-[var(--fc-bg)]"><div class="fc-panel max-w-sm text-center" data-testid="webgl-fallback"><h2 class="text-lg font-semibold mb-2">The 3D view is unavailable</h2><p class="text-sm text-[var(--fc-muted)] mb-4">This browser could not start WebGL.</p><button type="button" class="fc-btn fc-btn-primary" data-testid="webgl-use-map" aria-keyshortcuts="Escape">Surface</button></div></div>';
      const btn = el.querySelector('button');
      if (btn) btn.addEventListener('click', () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(w, h);
    renderer.setClearColor(0x071820, 1);
    el.appendChild(renderer.domElement);

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const built = buildScene(tx, tz);
    const camera = new THREE.PerspectiveCamera(62, w / h, 0.05, 900);
    camera.up.set(0, 1, 0);

    const lookAt = new THREE.Vector3(tx, -1.5, tz);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(tx + 6.0, 10.5, tz + 59),
      new THREE.Vector3(tx + 4.9, 8.5, tz + 47),
      new THREE.Vector3(tx + 3.8, 6.4, tz + 35),
      new THREE.Vector3(tx + 2.7, 4.4, tz + 24),
      new THREE.Vector3(tx + 1.8, 2.6, tz + 15),
      new THREE.Vector3(tx + 1.1, 1.0, tz + 8.5),
      new THREE.Vector3(tx + 0.6, -0.3, tz + 4.6),
      new THREE.Vector3(tx + 0.18, -1.1, tz + 2.6),
      new THREE.Vector3(tx, -1.5, tz + 1.55),
    ], false, 'catmullrom', 0.5);

    const ease = buildEase();
    let crossT = 0.5;
    const entry = new THREE.Vector3(tx, 0, tz);
    {
      const N = 400; let prev = curve.getPointAt(0).y;
      for (let i = 1; i <= N; i++) {
        const u = i / N, pt = curve.getPointAt(u), y = pt.y;
        if (prev > 0 && y <= 0) {
          entry.set(pt.x, 0, pt.z);
          const uu = u - (1 / N) * (y / (y - prev));
          for (let k = 0; k <= 200; k++) { if (ease(k / 200) >= uu) { crossT = k / 200; break; } }
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
        tDiffuse: { value: rt.texture }, uDistort: { value: 0 },
        uSubmerged: { value: 0 }, uTime: { value: 0 }, uCentre: { value: new THREE.Vector2(0.5, 0.5) },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: REFRACT_FRAG,
      depthTest: false, depthWrite: false,
    });
    postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));

    const project = () => {
      const toScreen = (v: THREE.Vector3) => {
        const q = v.clone().applyMatrix4(built.cabin.matrixWorld).project(camera);
        return { x: (q.x * 0.5 + 0.5) * 100, y: (-q.y * 0.5 + 0.5) * 100 };
      };
      return { gauges: built.gaugeAnchors.map(toScreen), strip: toScreen(built.stripAnchor) };
    };

    let raf = 0, start = 0, done = false;
    const crossMsFrac = CROSS_MS / DIVE_MS;

    const frame = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / DIVE_MS);
      const u = ease(t);

      curve.getPointAt(u, camera.position);
      camera.lookAt(lookAt);

      const below = camera.position.y < 0;
      const dt = (t - crossT) / crossMsFrac;
      const inWindow = Math.abs(dt) < 1;

      const sub = Math.max(0, Math.min(1, (t - crossT + crossMsFrac) / (crossMsFrac * 2)));
      postMat.uniforms.uSubmerged.value = sub;
      postMat.uniforms.uDistort.value = inWindow ? Math.cos(dt * Math.PI * 0.5) : 0;
      postMat.uniforms.uTime.value = (now - start) / 1000;
      (built.column.material as THREE.Material).opacity = 0.55 + 0.41 * sub;
      renderer.setClearColor(below ? 0x061a22 : 0x9fc5cf, 1);
      const inside = t > 0.88;
      if (built.cabin.visible !== inside) built.cabin.visible = inside;
      built.floatGroup.visible = !inside;

      if (t >= crossT) {
        if (!built.bubbles.visible) { built.bubbles.visible = true; (built.bubbles.material as THREE.Material).opacity = 0.9; }
        const age = (t - crossT) * (DIVE_MS / 1000);
        const arr = built.bubbles.geometry.attributes.position.array as Float32Array;
        const { pos, vel, COUNT } = built.bubbleData;
        for (let i = 0; i < COUNT; i++) {
          arr[i * 3] = pos[i * 3] + vel[i * 3] * age;
          arr[i * 3 + 1] = pos[i * 3 + 1] + vel[i * 3 + 1] * age - 1.1 * age * age;
          arr[i * 3 + 2] = pos[i * 3 + 2] + vel[i * 3 + 2] * age;
        }
        built.bubbles.geometry.attributes.position.needsUpdate = true;
        (built.bubbles.material as THREE.Material).opacity = Math.max(0, 0.9 - age * 2.6);
      }

      renderer.setRenderTarget(rt);
      renderer.render(built.scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCam);

      if (t < 1) { raf = requestAnimationFrame(frame); }
      else if (!done) {
        done = true;
        built.cabin.updateMatrixWorld(true);
        const a = project();
        anchors.current = a;
        setReady(true);
        onSettled(a);
      }
    };

    curve.getPointAt(reduce ? 1 : 0, camera.position);
    camera.lookAt(lookAt);
    built.cabin.visible = true;
    renderer.compile(built.scene, camera);
    renderer.setRenderTarget(rt);
    renderer.render(built.scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
    built.cabin.visible = false;

    if (reduce) {
      done = true;
      built.cabin.updateMatrixWorld(true);
      const a = project();
      anchors.current = a;
      setReady(true);
      onSettled(a);
    } else {
      raf = requestAnimationFrame(frame);
    }

    const onResize = () => {
      const nw = el.clientWidth, nh = el.clientHeight;
      if (!nw || !nh) return;
      camera.aspect = nw / nh; camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
      rt.setSize(Math.floor(nw * renderer.getPixelRatio()), Math.floor(nh * renderer.getPixelRatio()));
      if (done) { built.cabin.updateMatrixWorld(true); const a = project(); anchors.current = a; onSettled(a); }
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      rt.dispose();
      built.scene.traverse((o: THREE.Object3D) => {
        if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
        if ((o as THREE.Mesh).material) { const mats = Array.isArray((o as THREE.Mesh).material) ? (o as THREE.Mesh).material as THREE.Material[] : [(o as THREE.Mesh).material as THREE.Material]; mats.forEach((x: THREE.Material) => { if ('map' in x && x.map) (x.map as THREE.Texture).dispose(); x.dispose(); }); }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, [p.profile_id, p.latitude, p.longitude, onSettled]);

  return <div className="fc-dive-gl" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} ref={host} data-ready={ready}></div>;
}

export default function DiveView({ p, onClose }: { p: ExecutedProfile, onClose: () => void }) {
  const [settled, setSettled] = useState(false);
  const [anchors, setAnchors] = useState<Anchors>({ gauges: [], strip: null });
  const closeRef = useRef<HTMLButtonElement>(null);

  // Compute stats for surface
  const st = useMemo(() => {
    return { sst: null as number | null, salSurface: null as number | null };
  }, [p]);

  const depthMin = p.depth_min_m;
  const depthMax = p.depth_max_m;

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);

  useEffect(() => { if (settled) closeRef.current?.focus(); }, [settled]);

  const onSettled = useCallback((a: Anchors) => { setAnchors(a); setSettled(true); }, []);
  const g = anchors.gauges || [];

  return (
    <div className={'fc-dive' + (settled ? ' is-settled' : '')} role="dialog" aria-modal="true" aria-label={'Inside float ' + p.platform} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--fc-bg)', opacity: settled ? 1 : 0.99, transition: 'opacity 0.2s' }}>
      <DiveStage p={p} onSettled={onSettled} />

      <div className="fc-dive-hud" aria-hidden={!settled} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: settled ? 1 : 0, transition: 'opacity 0.6s' }}>
        {g[0] && <div className="fc-dive-val" style={{ position: 'absolute', transform: 'translate(-50%, -50%)', left: g[0].x + '%', top: g[0].y + '%', color: 'var(--fc-aqua)', textAlign: 'center', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
          <span className="fc-dive-val-n" style={{ fontSize: '1.4rem', fontWeight: 600, display: 'block' }}>{st?.sst != null ? st.sst.toFixed(2) : '—'}</span><span className="fc-dive-val-u" style={{ fontSize: '0.75rem', opacity: 0.8 }}>°C</span>
        </div>}
        {g[1] && <div className="fc-dive-val" style={{ position: 'absolute', transform: 'translate(-50%, -50%)', left: g[1].x + '%', top: g[1].y + '%', color: 'var(--fc-aqua)', textAlign: 'center', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
          <span className="fc-dive-val-n" style={{ fontSize: '1.4rem', fontWeight: 600, display: 'block' }}>{st?.salSurface != null ? st.salSurface.toFixed(2) : '—'}</span><span className="fc-dive-val-u" style={{ fontSize: '0.75rem', opacity: 0.8 }}>PSU</span>
        </div>}
        {anchors.strip && <div className="fc-dive-strip" style={{ position: 'absolute', transform: 'translate(-50%, -50%)', left: anchors.strip.x + '%', top: anchors.strip.y + '%', color: 'rgba(255,255,255,0.7)' }}>
          <span className="fc-mono fc-dive-strip-id" style={{ fontSize: '11px', letterSpacing: '0.05em' }}>{p.platform} · cycle {p.cycle}</span>
        </div>}
      </div>

      <div className="fc-dive-readout" aria-hidden={!settled} style={{ position: 'absolute', bottom: '24px', left: '24px', width: '340px', background: 'rgba(7, 24, 32, 0.85)', backdropFilter: 'blur(12px)', border: '1px solid var(--fc-line)', borderRadius: '12px', padding: '16px', opacity: settled ? 1 : 0, transition: 'opacity 0.6s', transform: settled ? 'translateY(0)' : 'translateY(20px)' }}>
        <header className="fc-dive-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div><div className="fc-kicker" style={{ margin: 0 }}>Inside float</div><span className="fc-mono fc-dive-id" style={{ fontSize: '18px', color: 'var(--fc-text)' }}>{p.profile_id}</span></div>
          <button ref={closeRef} className="fc-btn fc-btn-ghost fc-dive-close" onClick={onClose}>Surface ↑</button>
        </header>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
          <div className="fc-datarow"><span>Observed</span><span className="fc-mono">{formatUtc(p.time)}</span></div>
          <div className="fc-datarow"><span>Location</span><span className="fc-mono">{Math.abs(p.latitude).toFixed(3)}°{p.latitude >= 0 ? 'N' : 'S'} {Math.abs(p.longitude).toFixed(3)}°{p.longitude >= 0 ? 'E' : 'W'}</span></div>
          <div className="fc-datarow"><span title="Depth derived from pressure">Depth range</span><span className="fc-mono">{depthMin}–{depthMax} m</span></div>
          <div className="fc-datarow"><span>Temperature (surface)</span><span className="fc-mono">{st.sst != null ? st.sst.toFixed(3) + ' °C' : '—'}</span></div>
          <div className="fc-datarow"><span>Salinity (surface)</span><span className="fc-mono">{st.salSurface != null ? st.salSurface.toFixed(3) + ' PSU' : '—'}</span></div>
          <div className="fc-datarow"><span>Data mode</span><span className="fc-mono">{p.data_mode || 'R'}</span></div>
        </div>
        <div className="fc-mono fc-xs fc-muted fc-dive-note" style={{ marginTop: '16px', textAlign: 'center' }}>Instrument readout · press Esc to surface</div>
      </div>
    </div>
  );
}
