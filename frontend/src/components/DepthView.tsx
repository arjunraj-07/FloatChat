'use client';

/**
 * Regional depth scene: the returned profiles of one executed result in
 * longitude, latitude and actual depth, for the profiles visible at the time
 * navigator's selected time.
 *
 * Each profile is a column anchored at its reported position; its levels are
 * drawn at their actual depths (with a stated vertical exaggeration), coloured
 * on a scale fixed for the whole result. Levels with no valid value are grey
 * and never on the scale; backend-derived values are diamonds. Nothing is
 * interpolated, smoothed or connected between floats. See `sceneGeometry.ts`
 * for the coordinate mapping.
 *
 * The legend and controls sit beside the canvas (above it on phones), never
 * over it. A selected level can be stepped to the next shallower or deeper
 * recorded level of the same profile.
 */

import { useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import type { ExecutedProfile, ExecutionResults, Variable } from '@/lib/planContract.ts';
import { exclusionReason, formatUtc, profileLabel } from '@/lib/explorerModel.ts';
import {
  type DepthSample,
  type RegionFrame,
  MISSING_COLOUR,
  RAMPS,
  ROLE_COLOURS,
  colourScale,
  depthSamples,
  depthTicks,
  regionFrame,
  sampleColour,
  toScene,
} from '@/lib/sceneGeometry.ts';
import {
  type CameraState,
  InstancedPoints,
  LineBuffer,
  SceneProbe,
  disposeObject,
  textSprite,
  useOrbitControls,
  useRequest,
} from './scene/sceneKit';
import { ContextLossWatcher, SceneBoundary, SceneFallback, useWebGLSupport } from './scene/webgl';

export const DEPTH_NOTE =
  'Depth samples are positioned at the reported profile location. These columns are not measured underwater tracks.';

const VARIABLES: Record<Variable, { label: string; unit: string; legendDigits: number; exactDigits: number }> = {
  temp: { label: 'Temperature', unit: '°C', legendDigits: 2, exactDigits: 3 },
  psal: { label: 'Salinity', unit: 'PSS-78, no unit', legendDigits: 3, exactDigits: 4 },
};

function formatValue(variable: Variable, value: number, digits = VARIABLES[variable].legendDigits): string {
  return variable === 'temp' ? `${value.toFixed(digits)} °C` : `${value.toFixed(digits)} (PSS-78)`;
}

function hemisphere(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(value % 1 === 0 ? 0 : 1)}° ${value >= 0 ? positive : negative}`;
}

interface Reference {
  grid: Float32Array;
  axis: Float32Array;
  labels: THREE.Group;
  plane: { width: number; depth: number };
  depthUnits: number;
  size: number;
  /** Outer (left) edges of the depth-axis labels and title, for fitting the view. */
  axisLabelEdges: [number, number, number][];
  labelHeight: number;
}

/** Surface grid with degree labels, and a depth axis in actual metres. */
function buildReference(frame: RegionFrame): Reference {
  const labels = new THREE.Group();
  const grid: number[] = [];
  const axis: number[] = [];
  const spanDeg = Math.max(frame.east - frame.west, frame.north - frame.south);
  const step = spanDeg > 4 ? 1 : 0.5;
  const size = (frame.east - frame.west) * frame.kmPerDegLon * frame.unitsPerKm;
  const labelHeight = size * 0.05;

  for (let lon = Math.ceil(frame.west / step) * step; lon <= frame.east; lon += step) {
    grid.push(...toScene(frame, frame.south, lon, 0), ...toScene(frame, frame.north, lon, 0));
    const sprite = textSprite(hemisphere(lon, 'E', 'W'), labelHeight, '#8bcbc4');
    const [x, , z] = toScene(frame, frame.south, lon, 0);
    sprite.position.set(x, labelHeight * 0.6, z + labelHeight * 1.2);
    labels.add(sprite);
  }
  for (let lat = Math.ceil(frame.south / step) * step; lat <= frame.north; lat += step) {
    grid.push(...toScene(frame, lat, frame.west, 0), ...toScene(frame, lat, frame.east, 0));
    const sprite = textSprite(hemisphere(lat, 'N', 'S'), labelHeight, '#8bcbc4', 'right');
    const [x, , z] = toScene(frame, lat, frame.west, 0);
    sprite.position.set(x - labelHeight * 0.4, labelHeight * 0.6, z);
    labels.add(sprite);
  }
  const north = textSprite('N ↑', labelHeight * 1.2, '#e6f2f0');
  const [nx, , nz] = toScene(frame, frame.north, (frame.west + frame.east) / 2, 0);
  north.position.set(nx, labelHeight, nz - labelHeight * 1.2);
  labels.add(north);

  // Depth axis just outside the south-west corner, so its labels stay clear
  // of the degree labels; ticks in actual metres.
  const ticks = depthTicks(frame.maxDepthM);
  const corner = (depth: number): [number, number, number] => {
    const [x, y, z] = toScene(frame, frame.south, frame.west, depth);
    return [x - labelHeight * 1.6, y, z + labelHeight * 1.6];
  };
  axis.push(...corner(0), ...corner(ticks[ticks.length - 1]));
  const axisLabelEdges: [number, number, number][] = [];
  for (const depth of ticks) {
    const [x, y, z] = corner(depth);
    axis.push(x, y, z, x - labelHeight * 0.5, y, z);
    const sprite = textSprite(`${depth} m`, labelHeight * 0.9, '#8bcbc4', 'right');
    sprite.position.set(x - labelHeight * 0.7, y, z);
    labels.add(sprite);
    // The label is right-aligned at its position; its left edge is one
    // label width further out.
    axisLabelEdges.push([x - labelHeight * 0.7 - sprite.scale.x, y, z]);
  }
  const [, bottom] = corner(ticks[ticks.length - 1]);
  const title = textSprite(`Depth, actual metres (drawn ×${frame.exaggeration})`, labelHeight * 0.9, '#e6f2f0', 'left');
  const [cx, , cz] = corner(0);
  title.position.set(cx + labelHeight * 0.4, bottom - labelHeight * 1.2, cz);
  labels.add(title);
  axisLabelEdges.push([cx + labelHeight * 0.4 + title.scale.x, bottom - labelHeight * 1.2, cz]);

  return {
    axisLabelEdges,
    labelHeight,
    grid: new Float32Array(grid),
    axis: new Float32Array(axis),
    labels,
    plane: {
      width: size,
      depth: (frame.north - frame.south) * 111.32 * frame.unitsPerKm,
    },
    depthUnits: -bottom,
    size: Math.max(size, (frame.north - frame.south) * 111.32 * frame.unitsPerKm),
  };
}

interface Picked {
  profileId: string;
  depth: number;
  derived: boolean;
}

function DepthScene({
  frame,
  reference,
  profiles,
  samples,
  scaleColours,
  activeProfileId,
  selectedSample,
  resultKey,
  resetRequest,
  onPickSample,
  onPickProfile,
  onLost,
}: {
  frame: RegionFrame;
  reference: Reference;
  profiles: ExecutedProfile[];
  samples: DepthSample[];
  scaleColours: string[];
  activeProfileId: string | null;
  selectedSample: DepthSample | null;
  resultKey: object;
  resetRequest: number;
  onPickSample: (sample: DepthSample) => void;
  onPickProfile: (profileId: string) => void;
  onLost: () => void;
}) {
  // Fit the whole scene - surface extent, exaggerated depth, and the depth
  // axis with its labels - inside the narrower of the two fields of view,
  // with a margin, seen from the south-east above. The canvas has no
  // overlays, so the fitted box is centred.
  const size = useThree((s) => s.size);
  const aspect = size.width > 0 && size.height > 0 ? size.width / size.height : 1;
  const extent = new THREE.Box3(
    new THREE.Vector3(-reference.plane.width / 2, -reference.depthUnits, -reference.plane.depth / 2),
    new THREE.Vector3(reference.plane.width / 2, reference.labelHeight * 1.5, reference.plane.depth / 2),
  );
  for (const edge of reference.axisLabelEdges) extent.expandByPoint(new THREE.Vector3(...edge));
  const centre = extent.getCenter(new THREE.Vector3());
  const radius = extent.getSize(new THREE.Vector3()).length() / 2;
  const halfFov = (20 * Math.PI) / 180;
  const halfFovX = Math.atan(Math.tan(halfFov) * aspect);
  const distance = (radius / Math.sin(Math.min(halfFov, halfFovX))) * 1.05;
  const view = new THREE.Vector3(0.55, 0.5, 1).normalize().multiplyScalar(distance).add(centre);
  const initial: CameraState = { position: [view.x, view.y, view.z], target: [centre.x, centre.y, centre.z] };
  const controls = useOrbitControls({ store: 'depth', resultKey, initial, enablePan: true, minDistance: 1, maxDistance: reference.size * 6 });
  useRequest(resetRequest, () => controls.set(initial));

  const byId = useMemo(() => new Map(profiles.map((p) => [p.profile_id, p])), [profiles]);
  const layers = useMemo(() => {
    const measured: number[] = [];
    const measuredColours: string[] = [];
    const measuredIndex: number[] = [];
    const missing: number[] = [];
    const missingIndex: number[] = [];
    const derived: number[] = [];
    const derivedColours: string[] = [];
    const derivedIndex: number[] = [];
    samples.forEach((sample, index) => {
      const profile = byId.get(sample.profileId);
      if (!profile) return;
      const position = toScene(frame, profile.latitude, profile.longitude, sample.depth);
      if (sample.kind === 'measured') {
        measured.push(...position);
        measuredColours.push(scaleColours[index]);
        measuredIndex.push(index);
      } else if (sample.kind === 'missing') {
        missing.push(...position);
        missingIndex.push(index);
      } else {
        derived.push(...position);
        derivedColours.push(scaleColours[index]);
        derivedIndex.push(index);
      }
    });
    return {
      measured: new Float32Array(measured), measuredColours, measuredIndex,
      missing: new Float32Array(missing), missingIndex,
      derived: new Float32Array(derived), derivedColours, derivedIndex,
    };
  }, [samples, scaleColours, byId, frame]);

  const columns = useMemo(() => {
    const other: number[] = [];
    const active: number[] = [];
    const tops: number[] = [];
    const topColours: string[] = [];
    const selected = profiles.find((p) => p.profile_id === activeProfileId) ?? null;
    // The location marker sits just above the surface, like a pin head, so
    // it never covers the shallowest measured level.
    const lift = reference.size * 0.035;
    for (const profile of profiles) {
      const head = toScene(frame, profile.latitude, profile.longitude, 0);
      head[1] += lift;
      const segment = [...head, ...toScene(frame, profile.latitude, profile.longitude, profile.depth_max_m)];
      (profile.profile_id === activeProfileId ? active : other).push(...segment);
      tops.push(...head);
      topColours.push(
        profile.profile_id === activeProfileId
          ? ROLE_COLOURS.selected
          : selected && profile.platform === selected.platform
            ? ROLE_COLOURS.sameFloat
            : ROLE_COLOURS.otherFloat,
      );
    }
    return { other: new Float32Array(other), active: new Float32Array(active), tops: new Float32Array(tops), topColours };
  }, [profiles, activeProfileId, frame, reference]);

  useEffect(() => () => disposeObject(reference.labels), [reference]);

  const unit = reference.size;
  const highlight = selectedSample
    ? (() => {
        const profile = byId.get(selectedSample.profileId);
        return profile ? new Float32Array(toScene(frame, profile.latitude, profile.longitude, selectedSample.depth)) : null;
      })()
    : null;

  return (
    <>
      <color attach="background" args={['#050f16']} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
        <planeGeometry args={[reference.plane.width, reference.plane.depth]} />
        <meshBasicMaterial color="#0c2f3c" transparent opacity={0.35} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <LineBuffer positions={reference.grid} color="#2fa79f" />
      <LineBuffer positions={reference.axis} color="#8bcbc4" />
      <primitive object={reference.labels} />
      <LineBuffer positions={columns.other} color="#175a66" opacity={0.8} />
      <LineBuffer positions={columns.active} color={ROLE_COLOURS.selected} />
      <InstancedPoints
        positions={columns.tops}
        colours={columns.topColours}
        shape="sphere"
        size={unit * 0.012}
        onPick={(index) => onPickProfile(profiles[index].profile_id)}
      />
      <InstancedPoints
        positions={layers.missing}
        colours={MISSING_COLOUR}
        shape="sphere"
        size={unit * 0.0045}
        opacity={0.75}
        onPick={(index) => onPickSample(samples[layers.missingIndex[index]])}
      />
      <InstancedPoints
        positions={layers.measured}
        colours={layers.measuredColours}
        shape="sphere"
        size={unit * 0.0065}
        onPick={(index) => onPickSample(samples[layers.measuredIndex[index]])}
      />
      <InstancedPoints
        positions={layers.derived}
        colours={layers.derivedColours}
        shape="octahedron"
        size={unit * 0.016}
        onPick={(index) => onPickSample(samples[layers.derivedIndex[index]])}
      />
      {highlight && (
        <>
          <InstancedPoints positions={highlight} colours="#e6f2f0" shape="sphere" size={unit * 0.016} wireframe />
          <InstancedPoints positions={highlight} colours="#050f16" shape="sphere" size={unit * 0.0095} opacity={0.35} />
        </>
      )}
      <ContextLossWatcher onLost={onLost} />
      <SceneProbe
        name="depth"
        points={() => [
          ...samples.flatMap((sample) => {
            const profile = byId.get(sample.profileId);
            return profile
              ? [{ id: sample.profileId, depth: sample.depth, kind: sample.kind, value: sample.value,
                  position: toScene(frame, profile.latitude, profile.longitude, sample.depth) }]
              : [];
          }),
          // The depth-axis labels' outer edges, so a check can see them in view.
          ...reference.axisLabelEdges.map((position) => ({ id: '__axis', depth: -1, kind: 'axis', value: null, position })),
        ]}
        extra={() => ({
          exaggeration: frame.exaggeration,
          selected: selectedSample ? { id: selectedSample.profileId, depth: selectedSample.depth, kind: selectedSample.kind } : null,
        })}
      />
    </>
  );
}

interface Props {
  results: ExecutionResults;
  requested: Variable[];
  visibleProfiles: ExecutedProfile[];
  totalCount: number;
  throughLabel: string | null;
  activeProfileId: string | null;
  onSelectProfile: (profileId: string) => void;
  variable: Variable;
  onVariableChange: (variable: Variable) => void;
  resultKey: object;
  onBack: () => void;
  onUseMap: () => void;
}

export default function DepthView({
  results,
  requested,
  visibleProfiles,
  totalCount,
  throughLabel,
  activeProfileId,
  onSelectProfile,
  variable: preferred,
  onVariableChange,
  resultKey,
  onBack,
  onUseMap,
}: Props) {
  const support = useWebGLSupport();
  const [failure, setFailure] = useState<string | null>(null);
  const [resetRequest, setResetRequest] = useState(0);
  const [picked, setPicked] = useState<Picked | null>(null);

  const variable = requested.includes(preferred) ? preferred : requested[0];
  // Fixed for the result: every returned profile and every finite value.
  const frame = useMemo(() => regionFrame(results.profiles), [results]);
  const scale = useMemo(() => colourScale(results.observations, results.derived, variable), [results, variable]);
  const reference = useMemo(() => buildReference(frame), [frame]);
  const visibleIds = useMemo(() => new Set(visibleProfiles.map((p) => p.profile_id)), [visibleProfiles]);
  const samples = useMemo(
    () => depthSamples(results.observations, results.derived, visibleIds, variable),
    [results, visibleIds, variable],
  );
  const scaleColours = useMemo(() => samples.map((s) => sampleColour(s, scale, variable)), [samples, scale, variable]);

  // The picked level stays selected across variable changes (showing that
  // variable at the same level) while its profile is the open profile.
  const selectedSample =
    picked && picked.profileId === activeProfileId
      ? samples.find((s) => s.profileId === picked.profileId && s.depth === picked.depth && (s.kind === 'derived') === picked.derived) ?? null
      : null;
  const selectedProfile = selectedSample ? results.profiles.find((p) => p.profile_id === selectedSample.profileId) ?? null : null;

  // Recorded levels of the selected profile, shallow to deep, for stepping.
  // Derived values are not recorded levels, so stepping skips them.
  const levels = selectedSample
    ? samples.filter((s) => s.profileId === selectedSample.profileId && s.kind !== 'derived').sort((a, b) => a.depth - b.depth)
    : [];
  const at = selectedSample && selectedSample.kind !== 'derived' ? levels.findIndex((s) => s.depth === selectedSample.depth) : -1;
  const shallower = selectedSample
    ? (at >= 0 ? levels[at - 1] : [...levels].reverse().find((s) => s.depth < selectedSample.depth)) ?? null
    : null;
  const deeper = selectedSample ? (at >= 0 ? levels[at + 1] : levels.find((s) => s.depth > selectedSample.depth)) ?? null : null;
  const stepTo = (sample: DepthSample) => setPicked({ profileId: sample.profileId, depth: sample.depth, derived: false });

  const counts = {
    measured: samples.filter((s) => s.kind === 'measured').length,
    missing: samples.filter((s) => s.kind === 'missing').length,
    derived: samples.filter((s) => s.kind === 'derived').length,
  };
  const meta = VARIABLES[variable];

  if (!support.ok || failure) return <SceneFallback reason={failure ?? support.reason} onUseMap={onUseMap} />;

  const key = (
    <>
      <p>● measured level · ◆ derived at an exact depth (not measured)</p>
      <p>
        <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: MISSING_COLOUR }} />
        grey: level with no valid value (not on the scale)
      </p>
    </>
  );
  const countsLine = `${visibleProfiles.length} of ${totalCount} profiles through ${throughLabel ?? '—'}: ${counts.measured} measured, ${counts.missing} without a value, ${counts.derived} derived`;

  return (
    <div data-testid="depth-view" className="absolute inset-0 flex flex-col bg-[#050f16] sm:flex-row">
      {/* Controls and legend, beside the scene -------------------------------- */}
      <aside
        data-testid="depth-panel"
        aria-label="Depth scene controls and legend"
        className="flex max-h-[50%] shrink-0 flex-col gap-2 overflow-y-auto border-b border-[rgba(139,203,196,0.15)] bg-[#09222c] p-2 text-[11px] text-[var(--fc-muted)] sm:max-h-none sm:w-60 sm:border-b-0 sm:border-r"
      >
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            data-testid="depth-back"
            onClick={onBack}
            className="fc-btn fc-btn-primary fc-btn-sm"
          >
            ‹ Back to globe
          </button>
          <button
            type="button"
            data-testid="depth-reset"
            onClick={() => setResetRequest((n) => n + 1)}
            className="fc-btn fc-btn-sm"
          >
            Reset view
          </button>
        </div>

        <div data-testid="depth-legend">
          <div role="radiogroup" aria-label="Colour by" className="mb-1 flex rounded border border-[rgba(139,203,196,0.15)] p-0.5">
            {requested.map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={variable === name}
                data-testid={`depth-var-${name}`}
                onClick={() => onVariableChange(name)}
                className={`flex-1 rounded px-2 py-0.5 ${variable === name ? 'bg-[#0d366b] font-semibold text-[var(--fc-fg)]' : 'hover:bg-[#10303e]'}`}
              >
                {VARIABLES[name].label}
              </button>
            ))}
          </div>
          <p className="font-medium text-[var(--fc-fg)]">
            {meta.label} ({meta.unit})
          </p>
          {scale ? (
            <>
              <div
                aria-hidden
                className="mt-0.5 h-2.5 w-full rounded-sm"
                style={{ background: `linear-gradient(to right, ${RAMPS[variable].join(', ')})` }}
              />
              <p data-testid="depth-scale" className="flex justify-between tabular-nums">
                <span>{formatValue(variable, scale.min)}</span>
                <span>{formatValue(variable, scale.max)}</span>
              </p>
              <p className="text-[var(--fc-muted)]">Scale fixed for this result.</p>
            </>
          ) : (
            <p className="text-[var(--fc-warn)]">No valid {meta.label.toLowerCase()} in this result.</p>
          )}
        </div>

        {selectedSample && selectedProfile && (
          <section data-testid="depth-sample" aria-label="Selected sample" className="rounded-md border border-[rgba(139,203,196,0.15)] bg-[#071820] p-1.5 text-[var(--fc-fg)]">
            <p className="font-semibold">{profileLabel(selectedProfile)}</p>
            <p className="text-[var(--fc-muted)]">Profile {selectedProfile.profile_id} · observed {formatUtc(selectedProfile.time)}</p>
            <p title={`${selectedSample.depth} m`}>
              Depth: {selectedSample.depth.toFixed(2)} m (actual
              {selectedSample.kind === 'derived'
                ? ' target depth)'
                : selectedSample.pressure !== null && selectedSample.pressure !== undefined
                  ? `; from recorded pressure ${selectedSample.pressure.toFixed(2)} dbar)`
                  : ')'}
            </p>
            <p title={selectedSample.value !== null ? String(selectedSample.value) : undefined}>
              {meta.label}:{' '}
              {selectedSample.value !== null
                ? formatValue(variable, selectedSample.value, meta.exactDigits)
                : `no valid value (${exclusionReason(selectedSample.status)})`}
            </p>
            <p>
              {selectedSample.kind === 'derived'
                ? selectedSample.method === 'exact'
                  ? 'Derived at an exact depth: an observed level sits on this depth.'
                  : `Derived at an exact depth by linear interpolation between ${selectedSample.bracketing?.[0]?.toFixed(1)} m and ${selectedSample.bracketing?.[1]?.toFixed(1)} m. Not a measurement.`
                : selectedSample.kind === 'measured'
                  ? 'Measured level.'
                  : 'Recorded level without a valid value.'}
            </p>
            <div className="mt-1 flex items-center gap-1" role="group" aria-label="Step through recorded levels of this profile">
              <button
                type="button"
                data-testid="sample-shallower"
                disabled={!shallower}
                onClick={() => shallower && stepTo(shallower)}
                aria-label="Previous recorded level (shallower)"
                className="rounded border border-[rgba(139,203,196,0.15)] bg-transparent px-1.5 py-0.5 hover:bg-[#10303e] disabled:opacity-40"
              >
                ▲ Shallower
              </button>
              <span data-testid="sample-position" className="flex-1 text-center tabular-nums text-[var(--fc-muted)]">
                {at >= 0 ? `Level ${at + 1} of ${levels.length}` : `${levels.length} recorded levels`}
              </span>
              <button
                type="button"
                data-testid="sample-deeper"
                disabled={!deeper}
                onClick={() => deeper && stepTo(deeper)}
                aria-label="Next recorded level (deeper)"
                className="rounded border border-[rgba(139,203,196,0.15)] bg-transparent px-1.5 py-0.5 hover:bg-[#10303e] disabled:opacity-40"
              >
                Deeper ▼
              </button>
            </div>
          </section>
        )}

        {/* The short fact stays on screen; the longer method explanation is
            one click away rather than occupying the panel. */}
        <p data-testid="depth-note" className="font-medium text-[var(--fc-fg)]">
          Depth ×{frame.exaggeration} — axis labels give actual metres. Not underwater tracks.
        </p>
        <details data-testid="depth-method">
          <summary className="cursor-pointer text-[var(--fc-fg)]">How this is drawn</summary>
          <div className="mt-1 space-y-1 text-[var(--fc-muted)]">
            <p>{DEPTH_NOTE}</p>
            <p>
              Each column is anchored at its profile&apos;s reported position, and its levels sit at their
              actual depths, drawn ×{frame.exaggeration} so they stay visible. Nothing is interpolated,
              smoothed, or joined between floats.
            </p>
          </div>
        </details>

        {/* The key and counts: always shown beside the scene; folded on phones. */}
        <div className="hidden space-y-0.5 sm:block">
          {key}
          <p data-testid="depth-counts" className="text-[var(--fc-muted)]">{countsLine}</p>
        </div>
        <details className="sm:hidden">
          <summary className="cursor-pointer text-[var(--fc-fg)]">Key and counts</summary>
          <div className="mt-1 space-y-0.5">
            {key}
            <p className="text-[var(--fc-muted)]">{countsLine}</p>
          </div>
        </details>
      </aside>

      {/* Scene ---------------------------------------------------------------- */}
      <div data-testid="depth-canvas" className="relative min-h-0 flex-1">
        <SceneBoundary fallback={(reason) => <SceneFallback reason={reason} onUseMap={onUseMap} />}>
          <Canvas frameloop="demand" dpr={[1, 2]} camera={{ fov: 40, near: 0.05, far: 500 }} gl={{ antialias: true }} aria-label="Regional depth scene">
            <DepthScene
              frame={frame}
              reference={reference}
              profiles={visibleProfiles}
              samples={samples}
              scaleColours={scaleColours}
              activeProfileId={activeProfileId}
              selectedSample={selectedSample}
              resultKey={resultKey}
              resetRequest={resetRequest}
              onPickSample={(sample) => {
                setPicked({ profileId: sample.profileId, depth: sample.depth, derived: sample.kind === 'derived' });
                onSelectProfile(sample.profileId);
              }}
              onPickProfile={onSelectProfile}
              onLost={() => setFailure('the WebGL context was lost')}
            />
          </Canvas>
        </SceneBoundary>
      </div>
    </div>
  );
}
