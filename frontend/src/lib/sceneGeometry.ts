/**
 * Geometry, samples and colours for the globe and the regional depth scene.
 *
 * Pure functions over the executed result, so coordinate mapping, time
 * membership, missing values and colour scales are testable without WebGL.
 *
 * Coordinate conventions (three.js scene units, y up):
 *
 * - Globe: a unit sphere. For latitude φ and longitude λ in degrees (north
 *   and east positive): x = r·cos φ·sin λ, y = r·sin φ, z = r·cos φ·cos λ.
 *   (0° N, 0° E) faces +z and the North Pole is +y.
 * - Regional depth scene: a local equirectangular projection about the
 *   centre (φ0, λ0) of the result's profile positions, in kilometres:
 *   x = (λ − λ0)·111.32·cos φ0·s, z = −(φ − φ0)·111.32·s (north is −z),
 *   y = −(depth in km)·s·E. `s` scales the region to the scene; E is a stated
 *   vertical exaggeration. Labels always show actual metres. Across a region
 *   a few degrees tall the east-west scale error of using cos φ0 is about 1%.
 *
 * Nothing here interpolates, smooths or fills values: samples are the
 * returned levels and the backend's derived values, as returned.
 */

import type { DerivedValue, ExecutedObservation, ExecutedProfile, Variable } from './planContract.ts';

export const KM_PER_DEG_LAT = 111.32;
const RAD = Math.PI / 180;

export type Vec3 = [number, number, number];

// ---------------------------------------------------------------------------
// Globe
// ---------------------------------------------------------------------------

export function latLonToSphere(lat: number, lon: number, radius = 1): Vec3 {
  const phi = lat * RAD;
  const lambda = lon * RAD;
  return [
    radius * Math.cos(phi) * Math.sin(lambda),
    radius * Math.sin(phi),
    radius * Math.cos(phi) * Math.cos(lambda),
  ];
}

/** [longitude, latitude] pairs, as in GeoJSON. */
type Ring = number[][];

/**
 * Line segments (pairs of xyz points) along a ring on the sphere, split into
 * steps of at most `maxStepDeg` so long edges follow the curve. An edge that
 * crosses the antimeridian is skipped rather than drawn across the globe.
 */
export function ringSegments(ring: Ring, radius: number, maxStepDeg = 2): number[] {
  const out: number[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    if (Math.abs(lon2 - lon1) > 180) continue;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(lon2 - lon1), Math.abs(lat2 - lat1)) / maxStepDeg));
    for (let s = 0; s < steps; s++) {
      const a = s / steps;
      const b = (s + 1) / steps;
      out.push(
        ...latLonToSphere(lat1 + (lat2 - lat1) * a, lon1 + (lon2 - lon1) * a, radius),
        ...latLonToSphere(lat1 + (lat2 - lat1) * b, lon1 + (lon2 - lon1) * b, radius),
      );
    }
  }
  return out;
}

export interface OutlineGeometry {
  type: string;
  coordinates?: unknown;
}

/** Outline segments for GeoJSON Polygon and MultiPolygon geometries. */
export function outlineSegments(geometries: OutlineGeometry[], radius: number): Float32Array {
  const out: number[] = [];
  for (const geometry of geometries) {
    const polygons =
      geometry.type === 'Polygon'
        ? [geometry.coordinates as Ring[]]
        : geometry.type === 'MultiPolygon'
          ? (geometry.coordinates as Ring[][])
          : [];
    for (const polygon of polygons) for (const ring of polygon) out.push(...ringSegments(ring, radius));
  }
  return new Float32Array(out);
}

/** Meridians and parallels every `stepDeg` degrees. */
export function graticuleSegments(stepDeg: number, radius: number): Float32Array {
  const out: number[] = [];
  for (let lon = -180; lon < 180; lon += stepDeg) out.push(...ringSegments([[lon, -90], [lon, 90]], radius));
  for (let lat = -90 + stepDeg; lat < 90; lat += stepDeg) {
    out.push(...ringSegments([[-180, lat], [0, lat], [180, lat]], radius));
  }
  return new Float32Array(out);
}

export interface Box {
  west: number;
  east: number;
  south: number;
  north: number;
}

export function boxOf(points: { latitude: number; longitude: number }[]): Box | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p.latitude);
  const lons = points.map((p) => p.longitude);
  return { west: Math.min(...lons), east: Math.max(...lons), south: Math.min(...lats), north: Math.max(...lats) };
}

export function boxCentre(box: Box): { lat: number; lon: number } {
  return { lat: (box.south + box.north) / 2, lon: (box.west + box.east) / 2 };
}

/** The outline of a box on the sphere. */
export function boxSegments(box: Box, radius: number): Float32Array {
  const { west, east, south, north } = box;
  return new Float32Array(
    ringSegments([[west, south], [east, south], [east, north], [west, north], [west, south]], radius, 0.25),
  );
}

// ---------------------------------------------------------------------------
// Regional depth scene
// ---------------------------------------------------------------------------

/** Vertical exaggerations offered, so the stated factor is a round number. */
export const NICE_EXAGGERATIONS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

export interface RegionFrame extends Box {
  /** The profile positions themselves; the frame bounds add a margin. */
  dataBox: Box;
  lat0: number;
  lon0: number;
  kmPerDegLon: number;
  unitsPerKm: number;
  exaggeration: number;
  maxDepthM: number;
}

/**
 * The frame for a result's profiles. Derive it from every returned profile,
 * not the time-visible subset, so the scene does not move while stepping
 * through time.
 */
export function regionFrame(
  profiles: Pick<ExecutedProfile, 'latitude' | 'longitude' | 'depth_max_m'>[],
  sceneSize = 10,
): RegionFrame {
  const dataBox = boxOf(profiles) ?? { west: 0, east: 0, south: 0, north: 0 };
  const padLat = Math.max(0.1, (dataBox.north - dataBox.south) * 0.1);
  const padLon = Math.max(0.1, (dataBox.east - dataBox.west) * 0.1);
  const south = dataBox.south - padLat;
  const north = dataBox.north + padLat;
  const west = dataBox.west - padLon;
  const east = dataBox.east + padLon;
  const lat0 = (south + north) / 2;
  const lon0 = (west + east) / 2;
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos(lat0 * RAD);
  const extentKm = Math.max((east - west) * kmPerDegLon, (north - south) * KM_PER_DEG_LAT, 1);
  const maxDepthM = Math.max(1, ...profiles.map((p) => p.depth_max_m));
  // The largest round factor that keeps the depth span within 60% of the
  // horizontal extent; true scale would make a 500 m column invisible
  // beside a 400 km region.
  const target = (0.6 * extentKm) / (maxDepthM / 1000);
  const exaggeration = [...NICE_EXAGGERATIONS].reverse().find((f) => f <= target) ?? 1;
  return {
    west, east, south, north, dataBox, lat0, lon0, kmPerDegLon,
    unitsPerKm: sceneSize / extentKm,
    exaggeration,
    maxDepthM,
  };
}

/** Scene position of a point at a latitude, longitude and actual depth (m). */
export function toScene(frame: RegionFrame, lat: number, lon: number, depthM: number): Vec3 {
  return [
    (lon - frame.lon0) * frame.kmPerDegLon * frame.unitsPerKm,
    -(depthM / 1000) * frame.unitsPerKm * frame.exaggeration,
    -(lat - frame.lat0) * KM_PER_DEG_LAT * frame.unitsPerKm,
  ];
}

/** Actual depth (m) of a scene height, the inverse used for labels and checks. */
export function sceneDepthM(frame: RegionFrame, y: number): number {
  return (-y / (frame.unitsPerKm * frame.exaggeration)) * 1000;
}

/** Depth-scale ticks from the surface to just past the deepest level. */
export function depthTicks(maxDepthM: number): number[] {
  const step = [10, 20, 50, 100, 200, 500, 1000, 2000].find((s) => maxDepthM / s <= 8) ?? 5000;
  const ticks: number[] = [];
  for (let d = 0; d <= Math.ceil(maxDepthM / step) * step; d += step) ticks.push(d);
  return ticks;
}

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------

export type SampleKind = 'measured' | 'missing' | 'derived';

export interface DepthSample {
  profileId: string;
  depth: number;
  /** Null exactly when the level has no valid value for the variable. */
  value: number | null;
  kind: SampleKind;
  /** Stored exclusion status of a missing value, as returned. */
  status?: string | null;
  /** Recorded pressure of a returned level (dbar); depth is derived from it. */
  pressure?: number | null;
  method?: DerivedValue['method'];
  bracketing?: [number, number] | null;
}

/**
 * The samples of one variable for the visible profiles: each returned level
 * (measured, or missing when it has no valid value) and each available
 * backend-derived value. Missing values stay missing - never zero.
 */
export function depthSamples(
  observations: ExecutedObservation[],
  derived: DerivedValue[],
  visibleIds: ReadonlySet<string>,
  variable: Variable,
): DepthSample[] {
  const samples: DepthSample[] = [];
  for (const o of observations) {
    if (!visibleIds.has(o.profile_id)) continue;
    const raw = o[variable];
    const finite = typeof raw === 'number' && Number.isFinite(raw);
    samples.push({
      profileId: o.profile_id,
      depth: o.depth,
      value: finite ? raw : null,
      kind: finite ? 'measured' : 'missing',
      status: finite ? null : (variable === 'temp' ? o.temp_status : o.psal_status) ?? null,
      pressure: typeof o.pres === 'number' && Number.isFinite(o.pres) ? o.pres : null,
    });
  }
  for (const d of derived) {
    if (!visibleIds.has(d.profile_id) || d.variable !== variable || !d.available) continue;
    if (typeof d.value !== 'number' || !Number.isFinite(d.value)) continue;
    samples.push({
      profileId: d.profile_id,
      depth: d.target_depth_m,
      value: d.value,
      kind: 'derived',
      method: d.method,
      bracketing: d.bracketing_depths,
    });
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

export interface ColourScale {
  min: number;
  max: number;
}

/**
 * The colour domain for one variable over the whole executed result - every
 * returned finite value, measured or derived - so colours stay fixed while
 * stepping through time. Null when the result has no finite value for it.
 */
export function colourScale(
  observations: ExecutedObservation[],
  derived: DerivedValue[],
  variable: Variable,
): ColourScale | null {
  let min = Infinity;
  let max = -Infinity;
  const take = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
  };
  for (const o of observations) take(o[variable]);
  for (const d of derived) if (d.variable === variable && d.available) take(d.value);
  return Number.isFinite(min) ? { min, max } : null;
}

export function colourFraction(scale: ColourScale, value: number): number {
  if (scale.max === scale.min) return 0.5;
  return Math.min(1, Math.max(0, (value - scale.min) / (scale.max - scale.min)));
}

/** Sequential single-hue ramps, light to dark (ColorBrewer Oranges and Blues). */
export const RAMPS: Record<Variable, string[]> = {
  temp: ['#0c2f3c', '#1d5e6e', '#369794', '#6ac3a7', '#d4f0d3'],
  psal: ['#0c2f3c', '#1b5674', '#3b86ae', '#7eb6d6', '#e4f3fa'],
};

/** Neutral grey for levels with no valid value; never on a ramp. */
export const MISSING_COLOUR = '#3d4d54';

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rampHex(variable: Variable, t: number): string {
  const stops = RAMPS[variable];
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  const mix = a.map((c, k) => Math.round(c + (b[k] - c) * f));
  return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** The colour a sample is drawn with: the ramp for a value, grey for none. */
export function sampleColour(sample: DepthSample, scale: ColourScale | null, variable: Variable): string {
  if (sample.value === null || !scale) return MISSING_COLOUR;
  return rampHex(variable, colourFraction(scale, sample.value));
}

/** Marker colours on the globe and depth scene, matching the 2D map. */
export const ROLE_COLOURS = {
  overview: '#3d4d54',
  selected: '#e6f2f0',
  sameFloat: '#8bcbc4',
  otherFloat: '#175a66',
};
