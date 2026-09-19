/**
 * Globe and depth-scene geometry: coordinate mapping and depth direction,
 * time-visible membership, missing values and observed/derived samples, and
 * colour scales that stay fixed while stepping through time. Fixtures only.
 *
 *     npm run test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  KM_PER_DEG_LAT,
  MISSING_COLOUR,
  NICE_EXAGGERATIONS,
  RAMPS,
  colourFraction,
  colourScale,
  depthSamples,
  depthTicks,
  latLonToSphere,
  rampHex,
  regionFrame,
  ringSegments,
  sampleColour,
  sceneDepthM,
  toScene,
} from '../src/lib/sceneGeometry.ts';
import { timeSteps, visibleThrough } from '../src/lib/timeNavigator.ts';
import type { DerivedValue, ExecutedObservation } from '../src/lib/planContract.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const length = ([x, y, z]: number[]) => Math.hypot(x, y, z);

describe('globe mapping', () => {
  it('places (0° N, 0° E) at +z, the North Pole at +y and 90° E at +x', () => {
    const origin = latLonToSphere(0, 0);
    near(origin[0], 0); near(origin[1], 0); near(origin[2], 1);
    const pole = latLonToSphere(90, 45);
    near(pole[0], 0); near(pole[1], 1); near(pole[2], 0);
    const east = latLonToSphere(0, 90);
    near(east[0], 1); near(east[1], 0); near(east[2], 0);
    const west = latLonToSphere(0, -90);
    near(west[0], -1);
  });

  it('keeps every point on the sphere of the given radius', () => {
    near(length(latLonToSphere(17.4, 62.9, 1.004)), 1.004);
    near(length(latLonToSphere(-33.9, 151.2, 2)), 2);
  });

  it('puts the northern hemisphere above the equator and the Arabian Sea east of Greenwich', () => {
    const [x, y] = latLonToSphere(17.4, 62.9);
    assert.ok(y > 0 && x > 0);
  });

  it('densifies long edges along the sphere and never draws across the antimeridian', () => {
    const segments = ringSegments([[0, 0], [60, 0]], 1, 2);
    assert.equal(segments.length / 6, 30);
    for (let i = 0; i < segments.length; i += 3) near(length(segments.slice(i, i + 3)), 1, 1e-6);
    assert.deepEqual(ringSegments([[179, 10], [-179, 10]], 1), []);
  });
});

const PROFILES = [
  { profile_id: 'A', latitude: 15.52, longitude: 61.26, depth_max_m: 496, time: '2024-01-01T00:50:30' },
  { profile_id: 'B', latitude: 19.25, longitude: 64.45, depth_max_m: 447, time: '2024-01-05T12:13:51' },
  { profile_id: 'C', latitude: 17.00, longitude: 62.00, depth_max_m: 300, time: '2024-01-09T08:52:30' },
];

describe('regional depth frame', () => {
  const frame = regionFrame(PROFILES);

  it('maps east to +x, north to −z and the surface to y = 0', () => {
    const [x1, y1, z1] = toScene(frame, 17, 62, 0);
    const [x2, , z2] = toScene(frame, 17, 63, 0);
    const [, , z3] = toScene(frame, 18, 62, 0);
    near(y1, 0);
    assert.ok(x2 > x1, 'east is +x');
    near(z2, z1);
    assert.ok(z3 < z1, 'north is −z');
  });

  it('puts deeper samples lower, monotonically', () => {
    const ys = [0, 10, 100, 250, 496].map((d) => toScene(frame, 17, 62, d)[1]);
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i] < ys[i - 1]);
  });

  it('keeps actual depth recoverable through the stated exaggeration', () => {
    const [, y] = toScene(frame, 17, 62, 321.5);
    near(sceneDepthM(frame, y), 321.5, 1e-9);
    assert.ok(NICE_EXAGGERATIONS.includes(frame.exaggeration));
  });

  it('scales east-west by cos of the centre latitude, in kilometres', () => {
    near(frame.kmPerDegLon, KM_PER_DEG_LAT * Math.cos((frame.lat0 * Math.PI) / 180));
    const [xa] = toScene(frame, frame.lat0, 62, 0);
    const [xb] = toScene(frame, frame.lat0, 63, 0);
    near((xb - xa) / frame.unitsPerKm, frame.kmPerDegLon, 1e-9);
    const [, , za] = toScene(frame, 17, 62, 0);
    const [, , zb] = toScene(frame, 18, 62, 0);
    near((za - zb) / frame.unitsPerKm, KM_PER_DEG_LAT, 1e-9);
  });

  it('chooses the largest round exaggeration keeping depth within 60% of the extent', () => {
    const extentKm = 10 / frame.unitsPerKm;
    const depthKm = (frame.maxDepthM / 1000) * frame.exaggeration;
    assert.ok(depthKm <= 0.6 * extentKm + 1e-9);
    const next = NICE_EXAGGERATIONS[NICE_EXAGGERATIONS.indexOf(frame.exaggeration) + 1];
    assert.ok((frame.maxDepthM / 1000) * next > 0.6 * extentKm);
  });

  it('pads the frame around the data box', () => {
    assert.ok(frame.west < frame.dataBox.west && frame.east > frame.dataBox.east);
    assert.ok(frame.south < frame.dataBox.south && frame.north > frame.dataBox.north);
  });

  it('labels depth in round steps past the deepest level', () => {
    assert.deepEqual(depthTicks(496), [0, 100, 200, 300, 400, 500]);
    assert.deepEqual(depthTicks(99), [0, 20, 40, 60, 80, 100]);
  });
});

function obs(profile_id: string, depth: number, temp: number | null, psal: number | null, psal_status: string | null = null): ExecutedObservation {
  return {
    profile_id, pres: depth, pres_qc: 1, depth, source_field: 'adjusted', derived: false,
    temp, temp_qc: temp === null ? null : 1, temp_status: temp === null ? 'qc_rejected' : 'ok',
    psal, psal_qc: psal === null ? null : 1, psal_status: psal_status ?? (psal === null ? 'missing_value' : 'ok'),
  };
}

const OBSERVATIONS: ExecutedObservation[] = [
  obs('A', 5, 26.1, null),
  obs('A', 50, null, null, 'qc_rejected'),
  obs('A', 100, 22.4, null),
  obs('B', 5, 26.8, 36.40),
  obs('B', 120, 18.2, 35.95),
  obs('C', 10, 25.0, 36.10),
];

const DERIVED: DerivedValue[] = [
  { profile_id: 'B', variable: 'temp', target_depth_m: 100, available: true, value: 19.0, method: 'linear_interpolation',
    bracketing_depths: [5, 120], gap_m: 115, reason: null, derived: true, derivation: 'fixture' },
  { profile_id: 'A', variable: 'temp', target_depth_m: 100, available: false, value: null, method: null,
    bracketing_depths: null, gap_m: null, reason: 'gap too large', derived: true, derivation: 'fixture' },
  { profile_id: 'B', variable: 'psal', target_depth_m: 100, available: true, value: 36.0, method: 'linear_interpolation',
    bracketing_depths: [5, 120], gap_m: 115, reason: null, derived: true, derivation: 'fixture' },
];

const ALL = new Set(['A', 'B', 'C']);

describe('samples', () => {
  it('keeps a missing value missing, never zero, with its stored reason', () => {
    const temp = depthSamples(OBSERVATIONS, DERIVED, ALL, 'temp');
    const gap = temp.find((s) => s.profileId === 'A' && s.depth === 50)!;
    assert.equal(gap.kind, 'missing');
    assert.equal(gap.value, null);
    assert.equal(gap.status, 'qc_rejected');
    assert.ok(!temp.some((s) => s.kind === 'measured' && s.value === 0));
  });

  it('shows a temperature-only profile as salinity levels without values', () => {
    const psal = depthSamples(OBSERVATIONS, DERIVED, new Set(['A']), 'psal');
    assert.equal(psal.length, 3);
    assert.ok(psal.every((s) => s.kind === 'missing' && s.value === null));
    assert.deepEqual(psal.map((s) => s.status), ['missing_value', 'qc_rejected', 'missing_value']);
  });

  it('keeps backend-derived values distinct, and skips unavailable or other-variable ones', () => {
    const temp = depthSamples(OBSERVATIONS, DERIVED, ALL, 'temp');
    const derived = temp.filter((s) => s.kind === 'derived');
    assert.equal(derived.length, 1);
    assert.deepEqual(
      { id: derived[0].profileId, depth: derived[0].depth, value: derived[0].value, method: derived[0].method, bracketing: derived[0].bracketing },
      { id: 'B', depth: 100, value: 19.0, method: 'linear_interpolation', bracketing: [5, 120] },
    );
    // The measured levels of B are untouched; nothing new is interpolated.
    assert.deepEqual(temp.filter((s) => s.profileId === 'B' && s.kind === 'measured').map((s) => s.depth), [5, 120]);
  });

  it('keeps each level’s returned depth and recorded pressure exactly, unrounded', () => {
    const levels = depthSamples([{ ...obs('A', 24.453419114137894, 26.1, null), pres: 24.6 }], [], new Set(['A']), 'temp');
    assert.equal(levels[0].depth, 24.453419114137894);
    assert.equal(levels[0].pressure, 24.6);
  });

  it('includes only profiles visible at the selected time', () => {
    const { steps } = timeSteps(PROFILES);
    const early = new Set(visibleThrough(PROFILES, steps, 0).map((p) => p.profile_id));
    assert.deepEqual([...early], ['A']);
    assert.deepEqual([...new Set(depthSamples(OBSERVATIONS, DERIVED, early, 'temp').map((s) => s.profileId))], ['A']);
    const late = new Set(visibleThrough(PROFILES, steps, steps.length - 1).map((p) => p.profile_id));
    assert.deepEqual([...new Set(depthSamples(OBSERVATIONS, DERIVED, late, 'temp').map((s) => s.profileId))].sort(), ['A', 'B', 'C']);
  });
});

describe('colour scale', () => {
  it('spans every finite value in the result, measured and derived, ignoring missing ones', () => {
    assert.deepEqual(colourScale(OBSERVATIONS, DERIVED, 'temp'), { min: 18.2, max: 26.8 });
    assert.deepEqual(colourScale(OBSERVATIONS, DERIVED, 'psal'), { min: 35.95, max: 36.4 });
  });

  it('does not depend on the time-visible set, so colours hold while stepping', () => {
    const scale = colourScale(OBSERVATIONS, DERIVED, 'temp')!;
    const early = depthSamples(OBSERVATIONS, DERIVED, new Set(['A']), 'temp');
    const late = depthSamples(OBSERVATIONS, DERIVED, ALL, 'temp');
    const colourOf = (samples: typeof early) => sampleColour(samples.find((s) => s.profileId === 'A' && s.depth === 5)!, scale, 'temp');
    assert.equal(colourOf(early), colourOf(late));
  });

  it('gives missing values the neutral colour, never a ramp colour', () => {
    const scale = colourScale(OBSERVATIONS, DERIVED, 'temp');
    const gap = depthSamples(OBSERVATIONS, DERIVED, ALL, 'temp').find((s) => s.kind === 'missing')!;
    assert.equal(sampleColour(gap, scale, 'temp'), MISSING_COLOUR);
    assert.ok(!RAMPS.temp.includes(MISSING_COLOUR) && !RAMPS.psal.includes(MISSING_COLOUR));
  });

  it('is null when the result has no finite value for the variable', () => {
    assert.equal(colourScale([obs('A', 5, 20, null)], [], 'psal'), null);
  });

  it('maps the domain ends to the ramp ends and clamps outside it', () => {
    const scale = { min: 18.2, max: 26.8 };
    assert.equal(rampHex('temp', colourFraction(scale, 18.2)), RAMPS.temp[0]);
    assert.equal(rampHex('temp', colourFraction(scale, 26.8)), RAMPS.temp[RAMPS.temp.length - 1]);
    assert.equal(colourFraction(scale, 40), 1);
    assert.equal(colourFraction({ min: 5, max: 5 }, 5), 0.5);
  });
});
