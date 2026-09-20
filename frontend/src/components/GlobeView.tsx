'use client';

/**
 * Globe view in Map Explorer.
 *
 * A WebGL sphere with coastlines from Natural Earth (public domain,
 * redistributed by the world-atlas package, ISC) and a 30° graticule for
 * geographic context. Profiles sit at their reported latitude and longitude.
 * The outline is the cached search region - the area the dataset was
 * extracted for - not an area sampled throughout: profiles were recorded only
 * at the marked points, and Argo data outside the region is simply not in
 * this cache. The canvas renders on demand, so nothing is drawn while idle or
 * hidden.
 */

import { useState } from 'react';
import { Canvas } from '@react-three/fiber';

import { formatUtc } from '@/lib/explorerModel.ts';
import {
  type Box,
  ROLE_COLOURS,
  boxCentre,
  boxOf,
  boxSegments,
  graticuleSegments,
  latLonToSphere,
} from '@/lib/sceneGeometry.ts';
import { coastlineSegments } from './scene/coastlines';
import {
  type CameraState,
  InstancedPoints,
  LineBuffer,
  SceneProbe,
  useOrbitControls,
  useRequest,
} from './scene/sceneKit';
import { ContextLossWatcher, SceneBoundary, SceneFallback, useWebGLSupport } from './scene/webgl';

export interface GlobeProfile {
  profile_id: string;
  platform: string;
  latitude: number;
  longitude: number;
  time: string;
}

interface Props {
  mode: 'overview' | 'results';
  /** Markers: the time-visible returned profiles, or the cached overview. */
  profiles: GlobeProfile[];
  /** The whole result (or overview), for Focus and the camera. */
  regionProfiles: GlobeProfile[];
  selectedProfileId: string | null;
  onSelectProfile: (profileId: string) => void;
  /** Identity of the executed result, so the camera is kept per result. */
  resultKey: object;
  canExploreDepths: boolean;
  onExploreDepths: () => void;
  onUseMap: () => void;
  /** The area the cached dataset was extracted for, if recorded. */
  searchRegion: Box | null;
}

const LAND = coastlineSegments(1.0015);
const GRATICULE = graticuleSegments(30, 1.001);
const MARKER_ALTITUDE = 1.004;
const START_DISTANCE = 2.6;
const FOCUS_DISTANCE = 1.32;
// Marker radius at the Focus on results view; it scales with the camera's
// height above the surface, so markers keep roughly the same size on screen
// at any zoom.
const MARKER_RADIUS = 0.0042;
const FOCUS_ALTITUDE = FOCUS_DISTANCE - 1;
const HALF_FOV = (22.5 * Math.PI) / 180;

/** A view straight down onto a set of recorded locations, fitting them with a margin. */
function viewOnto(points: { latitude: number; longitude: number }[]): CameraState | null {
  const box = boxOf(points);
  if (!box) return null;
  const centre = boxCentre(box);
  const halfDeg = Math.max(box.north - box.south, (box.east - box.west) * Math.cos((centre.lat * Math.PI) / 180)) / 2;
  const altitude = (Math.max(halfDeg, 0.05) * (Math.PI / 180) * 1.8) / Math.tan(HALF_FOV);
  return { position: latLonToSphere(centre.lat, centre.lon, Math.max(1.035, 1 + altitude)), target: [0, 0, 0] };
}

const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

function range(a: number, b: number, positive: string, negative: string): string {
  const d = (v: number) => (Number.isInteger(v) ? String(Math.abs(v)) : Math.abs(v).toFixed(2));
  const side = (v: number) => (v >= 0 ? positive : negative);
  return side(a) === side(b) ? `${d(a)}–${d(b)}° ${side(a)}` : `${d(a)}° ${side(a)}–${d(b)}° ${side(b)}`;
}

function describeRegion(box: Box): string {
  return `${range(box.west, box.east, 'E', 'W')}, ${range(box.south, box.north, 'N', 'S')}`;
}

function GlobeScene({
  mode,
  positions,
  colours,
  ids,
  outline,
  outlineKind,
  initial,
  focus,
  focusRequest,
  floatFocus,
  floatFocusRequest,
  resultKey,
  onPick,
  onHover,
  onLost,
}: {
  mode: 'overview' | 'results';
  positions: Float32Array;
  colours: string[];
  ids: string[];
  outline: Float32Array | null;
  outlineKind: 'search_region' | 'observed_extent' | 'none';
  initial: CameraState;
  focus: CameraState;
  focusRequest: number;
  floatFocus: CameraState | null;
  floatFocusRequest: number;
  resultKey: object;
  onPick: (index: number) => void;
  onHover: (index: number | null) => void;
  onLost: () => void;
}) {
  const [altitude, setAltitude] = useState(START_DISTANCE - 1);
  const controls = useOrbitControls({
    store: 'globe',
    resultKey,
    initial,
    enablePan: false,
    minDistance: 1.03,
    maxDistance: 5,
    // Re-render only when the height changes by more than 4%.
    onChange: (distance) => {
      const next = Math.max(0.01, distance - 1);
      setAltitude((previous) => (Math.abs(next - previous) / previous > 0.04 ? next : previous));
    },
  });
  useRequest(focusRequest, () => controls.set(focus));
  useRequest(floatFocusRequest, () => {
    if (floatFocus) controls.set(floatFocus);
  });
  const k = Math.min(5, altitude / FOCUS_ALTITUDE);

  return (
    <>
      <color attach="background" args={['#050f16']} />
      {/* The sphere hides markers on the far side from pointer events too. */}
      <mesh onClick={stop} onPointerMove={stop}>
        <sphereGeometry args={[1, 96, 64]} />
        <meshBasicMaterial color="#0b2b36" />
      </mesh>
      <LineBuffer positions={GRATICULE} color="#8bcbc4" opacity={0.09} />
      <LineBuffer positions={LAND} color="#0e1f25" />
      {outline && <LineBuffer positions={outline} color={mode === 'results' ? '#2fa79f' : '#3d4d54'} />}
      <InstancedPoints
        positions={positions}
        colours={colours}
        shape="sphere"
        size={MARKER_RADIUS * k}
        onPick={onPick}
        onHover={onHover}
      />
      <ContextLossWatcher onLost={onLost} />
      <SceneProbe
        name="globe"
        isGlobe={true}
        points={() =>
          ids.map((id, i) => ({ id, position: [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]] }))
        }
        extra={() => ({ outline: outlineKind, markerRadius: MARKER_RADIUS * k })}
      />
    </>
  );
}

export default function GlobeView({
  mode,
  profiles,
  regionProfiles,
  selectedProfileId,
  onSelectProfile,
  resultKey,
  canExploreDepths,
  onExploreDepths,
  onUseMap,
  searchRegion,
}: Props) {
  const support = useWebGLSupport();
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [floatFocusRequest, setFloatFocusRequest] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);

  const selected = profiles.find((p) => p.profile_id === selectedProfileId) ?? null;
  const ids = profiles.map((p) => p.profile_id);
  const positions = new Float32Array(profiles.flatMap((p) => latLonToSphere(p.latitude, p.longitude, MARKER_ALTITUDE)));
  const colours = profiles.map((p) =>
    mode === 'overview'
      ? ROLE_COLOURS.overview
      : p.profile_id === selectedProfileId
        ? ROLE_COLOURS.selected
        : selected && p.platform === selected.platform
          ? ROLE_COLOURS.sameFloat
          : ROLE_COLOURS.otherFloat,
  );
  const observed = boxOf(regionProfiles);
  const centre = observed ? boxCentre(observed) : { lat: 15, lon: 60 };
  const initial: CameraState = { position: latLonToSphere(centre.lat, centre.lon, START_DISTANCE), target: [0, 0, 0] };
  const focus: CameraState = { position: latLonToSphere(centre.lat, centre.lon, FOCUS_DISTANCE), target: [0, 0, 0] };
  // Outline the recorded search region; only without it, the observed extent.
  const outlineKind: 'search_region' | 'observed_extent' | 'none' = searchRegion ? 'search_region' : observed ? 'observed_extent' : 'none';
  const outlineBox = searchRegion ?? observed;
  const outline = outlineBox ? boxSegments(outlineBox, 1.0025) : null;

  // The open profile's float can still be framed on its own, taken from the
  // profiles in this result rather than from any overlay.
  const floatPoints = selected ? profiles.filter((p) => p.platform === selected.platform) : [];
  const floatFocus = floatPoints.length > 1 ? viewOnto(floatPoints) : null;
  const hoveredProfile = hovered !== null ? profiles[hovered] ?? null : null;

  if (!support.ok || failure) {
    return <SceneFallback reason={failure ?? support.reason} onUseMap={onUseMap} />;
  }

  return (
    <div data-testid="globe-view" className="absolute inset-0 bg-[#050f16]">
      <SceneBoundary fallback={(reason) => <SceneFallback reason={reason} onUseMap={onUseMap} />}>
        <Canvas
          frameloop="demand"
          dpr={[1, 2]}
          camera={{ fov: 45, near: 0.005, far: 50, position: [0, 0, START_DISTANCE] }}
          gl={{ antialias: true }}
          aria-label="Globe showing recorded profile locations"
        >
          <GlobeScene
            mode={mode}
            positions={positions}
            colours={colours}
            ids={ids}
            outline={outline}
            outlineKind={outlineKind}
            initial={initial}
            focus={focus}
            focusRequest={focusRequest}
            floatFocus={floatFocus}
            floatFocusRequest={floatFocusRequest}
            resultKey={resultKey}
            onPick={(index) => {
              if (mode === 'results' && profiles[index]) onSelectProfile(profiles[index].profile_id);
            }}
            onHover={setHovered}
            onLost={() => setFailure('the WebGL context was lost')}
          />
        </Canvas>
      </SceneBoundary>

      {/* Phones: one compact coverage line, the full wording on request. */}
      <div
        data-testid="globe-legend-compact"
        className="absolute left-2 top-2 max-w-[11.5rem] rounded-md bg-[rgba(8,27,35,0.85)] px-2 py-1 text-[11px] leading-snug text-[var(--fc-muted)] shadow sm:hidden"
      >
        <p>
          <span className={`mr-1 inline-block h-2.5 w-2.5 border-2 align-middle ${mode === 'results' ? 'border-[#2fa79f]' : 'border-[#3d4d54]'}`} />
          Cached search region, not sampled throughout; dots are recorded profiles.
        </p>
        <details>
          <summary className="cursor-pointer text-[var(--fc-fg)]">More</summary>
          <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
            {outlineBox && (
              <p>
                {outlineKind === 'search_region' ? 'Cached search region' : 'Extent of recorded profile locations'} (
                {describeRegion(outlineBox)}): the area this dataset was extracted for. Profiles were recorded only at
                the marked points, not across the whole region.
              </p>
            )}
            <p>Argo profiles outside this region are not part of the cached data.</p>
            <p>Coastlines: Natural Earth (public domain)</p>
          </div>
        </details>
      </div>

      <div
        data-testid="globe-legend"
        className="pointer-events-none absolute left-2 top-2 hidden max-w-[16rem] space-y-0.5 rounded-md bg-[rgba(8,27,35,0.85)] px-2 py-1.5 text-[11px] leading-snug text-[var(--fc-muted)] shadow sm:block"
      >
        {mode === 'overview' ? (
          <p>
            <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#3d4d54] align-middle" />
            Cached profile locations (overview, not query results)
          </p>
        ) : (
          <div>
            <p><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#e6f2f0] align-middle" />Selected profile</p>
            <p><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#8bcbc4] align-middle" />Same float</p>
            <p><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#175a66] align-middle" />Other floats in this result</p>
          </div>
        )}
        {/* One short line for the dataset's geographic scope; the wording that
            used to repeat it in three paragraphs is gone. */}
        {outlineKind !== 'none' && outlineBox && (
          <p data-testid="globe-coverage">
            <span className={`mr-1 inline-block h-2.5 w-2.5 border-2 align-middle ${mode === 'results' ? 'border-[#2fa79f]' : 'border-[#3d4d54]'}`} />
            {outlineKind === 'search_region' ? 'Cached search region' : 'Recorded profile extent'} (
            {describeRegion(outlineBox)}) — sampled only at the marked points.
          </p>
        )}
        <p className="text-[var(--fc-muted)]">Coastlines: Natural Earth (public domain)</p>
      </div>

      <div className="absolute right-2 top-2 flex max-w-[10rem] flex-col items-end gap-1.5 sm:max-w-[13rem]">
        <button
          type="button"
          data-testid="globe-focus"
          onClick={() => setFocusRequest((n) => n + 1)}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 shadow-sm hover:bg-slate-50"
        >
          {mode === 'results' ? 'Focus on results' : 'Focus on cached data'}
        </button>
        <button
          type="button"
          data-testid="explore-depths"
          disabled={!canExploreDepths}
          onClick={onExploreDepths}
          title={canExploreDepths ? 'Open the regional depth scene' : 'Show results first, then explore their depths'}
          className="rounded-md bg-sky-700 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
        >
          Explore depths
        </button>
        {mode === 'results' && floatFocus && selected && (
          <button
            type="button"
            data-testid="globe-focus-float"
            onClick={() => setFloatFocusRequest((n) => n + 1)}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 shadow-sm hover:bg-slate-50"
          >
            Focus on float {selected.platform}
          </button>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex flex-wrap items-end justify-between gap-2 text-[11px]">
        <p className="rounded bg-[rgba(8,27,35,0.85)] px-1.5 py-0.5 text-[var(--fc-muted)]">Drag to rotate · scroll or pinch to zoom</p>
        {hoveredProfile && (
          <p data-testid="globe-hover" className="rounded bg-[rgba(8,27,35,0.95)] px-2 py-1 text-[var(--fc-fg)] shadow">
            Float {hoveredProfile.platform} · {hoveredProfile.profile_id} · {formatUtc(hoveredProfile.time)}
          </p>
        )}
      </div>
    </div>
  );
}
