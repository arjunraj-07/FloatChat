/**
 * Behaviour of the explorer's presentation logic: float navigation,
 * comparison selection, availability, and the "use cached data" draft - plus
 * checks that these never disturb the query session's draft/result
 * separation.
 *
 *     npm run test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cachedDataForm,
  describeExclusions,
  floatPosition,
  formatPosition,
  formatUtc,
  groupByFloat,
  profileIdentity,
  profileLabel,
  profileSeries,
  resolveComparison,
  unavailableReason,
  utcDate,
  variableAvailability,
} from '../src/lib/explorerModel.ts';
import { createDefaultForm, formToPlan } from '../src/lib/draftPlan.ts';
import {
  canExecute,
  createSession,
  currentValidation,
  displayedResults,
  sessionReducer,
} from '../src/lib/querySession.ts';
import type {
  ExecutedObservation,
  ExecutedProfile,
  PlanExecutionResponse,
  PlanValidationResponse,
} from '../src/lib/planContract.ts';

function profile(id: string, time: string, variables?: ExecutedProfile['variables']): ExecutedProfile {
  const [platform, cycle] = id.split('_');
  return {
    profile_id: id,
    platform,
    cycle: Number(cycle),
    direction: 'A',
    data_mode: 'D',
    source_field: 'adjusted',
    time,
    latitude: 16,
    longitude: 62,
    levels_in_plan: 3,
    depth_min_m: 2,
    depth_max_m: 50,
    profile_levels_total: 3,
    dataset_id: 'test',
    source_url: null,
    retrieved_at: null,
    variables: variables ?? {
      temp: { valid_levels: 3, excluded_levels: 0 },
      psal: { valid_levels: 0, excluded_levels: 3, exclusions: { missing_value: 2, qc_rejected: 1 } },
    },
  };
}

const PROFILES = [
  profile('6903060_485_A', '2024-01-05T04:46:30'),
  profile('2902201_287_A', '2024-01-05T12:13:51'),
  profile('6903060_483_A', '2024-01-01T00:50:30'),
  profile('6903060_484_A', '2024-01-03T02:54:30'),
];

describe('time and place formatting', () => {
  it('reads naive backend timestamps as UTC, not browser-local time', () => {
    assert.equal(utcDate('2024-01-05T04:46:30').toISOString(), '2024-01-05T04:46:30.000Z');
    assert.equal(formatUtc('2024-01-05T04:46:30'), '2024-01-05 04:46 UTC');
    assert.equal(formatUtc('2024-01-05T04:46:30', false), '2024-01-05');
  });

  it('keeps an explicit offset', () => {
    assert.equal(formatUtc('2024-01-05T04:46:30+05:30'), '2024-01-04 23:16 UTC');
  });

  it('writes hemispheres instead of signs', () => {
    assert.equal(formatPosition(15.5187, 61.2556), '15.52° N, 61.26° E');
    assert.equal(formatPosition(-3.1, -40.25, 1), '3.1° S, 40.3° W');
  });
});

describe('Float Detective navigation', () => {
  it('groups profiles by float and orders each float by observation time', () => {
    const groups = groupByFloat(PROFILES);
    assert.deepEqual(groups.map((g) => g.platform), ['2902201', '6903060']);
    assert.deepEqual(
      groups[1].profiles.map((p) => p.profile_id),
      ['6903060_483_A', '6903060_484_A', '6903060_485_A'],
    );
  });

  it('gives the position and neighbours within the same float only', () => {
    const middle = floatPosition(PROFILES, '6903060_484_A')!;
    assert.equal(middle.index, 1);
    assert.equal(middle.count, 3);
    assert.equal(middle.previousId, '6903060_483_A');
    assert.equal(middle.nextId, '6903060_485_A');
  });

  it('stops at the ends instead of wrapping to another float', () => {
    assert.equal(floatPosition(PROFILES, '6903060_483_A')!.previousId, null);
    assert.equal(floatPosition(PROFILES, '6903060_485_A')!.nextId, null);
    const single = floatPosition(PROFILES, '2902201_287_A')!;
    assert.equal(single.count, 1);
    assert.equal(single.previousId, null);
    assert.equal(single.nextId, null);
  });

  it('returns nothing for a profile that is not in the result', () => {
    assert.equal(floatPosition(PROFILES, '9999999_1_A'), null);
    assert.equal(floatPosition(PROFILES, null), null);
  });
});

describe('comparison selection', () => {
  const ids = ['2902201_287_A', '6903060_483_A', '6903060_484_A'];

  it('seeds A from the open profile and B from the next different one', () => {
    assert.deepEqual(resolveComparison({ a: null, b: null }, ids, '6903060_483_A'), {
      a: '6903060_483_A',
      b: '2902201_287_A',
    });
  });

  it('keeps a valid user selection', () => {
    const chosen = { a: '6903060_484_A', b: '2902201_287_A' };
    assert.deepEqual(resolveComparison(chosen, ids, '6903060_483_A'), chosen);
  });

  it('never compares a profile with itself', () => {
    const resolved = resolveComparison({ a: '6903060_483_A', b: '6903060_483_A' }, ids, null);
    assert.equal(resolved.a, '6903060_483_A');
    assert.notEqual(resolved.b, resolved.a);
  });

  it('resets selections that are not in a new executed result', () => {
    const before = { a: '6903060_484_A', b: '2902201_287_A' };
    const newResult = ['6903060_483_A', '6903060_485_A'];
    assert.deepEqual(resolveComparison(before, newResult, '6903060_485_A'), {
      a: '6903060_485_A',
      b: '6903060_483_A',
    });
  });

  it('leaves B empty when the result has a single profile', () => {
    assert.deepEqual(resolveComparison({ a: null, b: null }, ['2902201_287_A'], null), {
      a: '2902201_287_A',
      b: null,
    });
  });

  it('is empty for an empty result', () => {
    assert.deepEqual(resolveComparison({ a: 'x', b: 'y' }, [], null), { a: null, b: null });
  });
});

describe('profile series for comparison', () => {
  const observations: ExecutedObservation[] = [
    { profile_id: 'P', pres: 50, pres_qc: 1, depth: 49.7, source_field: 'raw', derived: false, temp: 20.1, psal: null },
    { profile_id: 'P', pres: 2, pres_qc: 1, depth: 2.0, source_field: 'raw', derived: false, temp: 26.5, psal: 36.4 },
    { profile_id: 'P', pres: 10, pres_qc: 1, depth: 9.9, source_field: 'raw', derived: false, temp: 26.3, psal: null },
    { profile_id: 'Q', pres: 5, pres_qc: 1, depth: 5.0, source_field: 'raw', derived: false, temp: 25.0 },
  ];

  it('takes one profile, sorted shallow to deep', () => {
    const series = profileSeries(observations, 'P', 'temp');
    assert.deepEqual(series.depths, [2.0, 9.9, 49.7]);
    assert.deepEqual(series.values, [26.5, 26.3, 20.1]);
    assert.equal(series.validCount, 3);
  });

  it('keeps missing values as gaps rather than filling them', () => {
    const series = profileSeries(observations, 'P', 'psal');
    assert.deepEqual(series.values, [36.4, null, null]);
    assert.equal(series.validCount, 1);
    assert.equal(series.levelCount, 3);
  });

  it('treats a variable absent from the records as missing, not zero', () => {
    const series = profileSeries(observations, 'Q', 'psal');
    assert.deepEqual(series.values, [null]);
    assert.equal(series.validCount, 0);
  });
});

describe('profile labels', () => {
  it('names a profile compactly by float, cycle and UTC time', () => {
    assert.equal(profileLabel(PROFILES[1]), 'Float 2902201 · cycle 287 · 2024-01-05 12:13 UTC');
  });

  it('gives every profile in a result a distinct label', () => {
    const labels = PROFILES.map(profileLabel);
    assert.equal(new Set(labels).size, labels.length);
  });

  it('keeps the full identity available', () => {
    assert.equal(
      profileIdentity(PROFILES[1]),
      'Profile 2902201_287_A: float 2902201, cycle 287, ascending, 2024-01-05 12:13 UTC, 16.00° N, 62.00° E',
    );
  });

  it('marks a descending profile so it cannot share its ascending twin’s label', () => {
    const up = profile('6903060_485_A', '2024-01-05T04:46:30');
    const down = { ...up, profile_id: '6903060_485_D', direction: 'D' };
    assert.notEqual(profileLabel(up), profileLabel(down));
  });
});

describe('variable availability', () => {
  const tempOnly = profile('6903060_483_A', '2024-01-01T00:50:30');

  it('reports a temperature-only profile normally', () => {
    assert.deepEqual(variableAvailability(tempOnly, 'temp', ['temp', 'psal']), {
      state: 'available',
      valid: 3,
      excluded: 0,
    });
  });

  it('explains salinity that is unavailable in the result', () => {
    const psal = variableAvailability(tempOnly, 'psal', ['temp', 'psal']);
    assert.equal(psal.state, 'none');
    if (psal.state === 'none') {
      assert.equal(
        describeExclusions(psal.reasons),
        '2 levels had no value in the source file, 1 level failed quality control',
      );
      assert.equal(unavailableReason(psal), describeExclusions(psal.reasons, 3));
    }
  });

  it('never describes a missing value as a quality-control failure', () => {
    const text = describeExclusions({ missing_value: 34 });
    assert.equal(text, '34 levels had no value in the source file');
    assert.doesNotMatch(text, /quality/);
  });

  it('keeps malformed flags distinct from rejected ones', () => {
    assert.equal(
      describeExclusions({ qc_rejected: 2, qc_malformed: 1 }),
      '2 levels failed quality control, 1 level had an unreadable quality flag',
    );
  });

  it('says so when the cached data records no reason, rather than assigning one', () => {
    assert.equal(describeExclusions({}, 34), '34 levels excluded for a reason the cached data does not record');
    assert.equal(
      describeExclusions({ qc_rejected: 1 }, 3),
      '1 level failed quality control, 2 levels excluded for a reason the cached data does not record',
    );
  });

  it('explains a variable with no levels in the result', () => {
    const bare = profile('6903060_483_A', '2024-01-01T00:50:30', {
      temp: { valid_levels: 3, excluded_levels: 0 },
    });
    assert.equal(
      unavailableReason(variableAvailability(bare, 'psal', ['temp', 'psal'])),
      'no levels of this profile are in the result',
    );
  });

  it('distinguishes "not requested" from "unavailable"', () => {
    assert.deepEqual(variableAvailability(tempOnly, 'psal', ['temp']), { state: 'not_requested' });
  });
});

describe('Use cached data', () => {
  const coverage = {
    date_range: ['2024-01-01T00:50:30', '2024-01-09T08:52:30'] as [string, string],
    bounding_box: { west: 61.2556, east: 64.446035, south: 15.518741666666667, north: 19.24811 },
    depth_range_m: [1.1529642520545593, 496.3724922756864] as [number, number],
  };

  it('fills the draft from the reported coverage, rounded outward', () => {
    const form = cachedDataForm(createDefaultForm(), coverage);
    assert.equal(form.regionKind, 'bbox');
    assert.deepEqual([form.west, form.east, form.south, form.north], ['61.25', '64.45', '15.51', '19.25']);
    assert.equal(form.startDate, '2024-01-01');
    assert.equal(form.endDate, '2024-01-09');
    assert.equal(form.depthMin, '0');
    assert.equal(form.depthMax, '497');
    assert.deepEqual(form.variables, ['temp', 'psal']);
  });

  it('uses whatever coverage is supplied rather than remembered numbers', () => {
    const other = cachedDataForm(createDefaultForm(), {
      date_range: ['2019-06-02T10:00:00', '2019-06-20T00:00:00'],
      bounding_box: { west: -10.004, east: -5.001, south: 40.0, north: 41.5 },
      depth_range_m: [3, 1200.2],
    });
    assert.deepEqual([other.west, other.east, other.south, other.north], ['-10.01', '-5', '40', '41.5']);
    assert.equal(other.startDate, '2019-06-02');
    assert.equal(other.depthMax, '1201');
  });

  it('produces a complete plan whose end date covers the whole last day', () => {
    const plan = formToPlan(cachedDataForm(createDefaultForm(), coverage)).plan!;
    assert.ok(plan);
    assert.equal(plan.time.end, '2024-01-09T23:59:59.999Z');
    assert.equal(plan.region.kind, 'bbox');
  });

  it('keeps the user’s own quality-policy choice', () => {
    const base = { ...createDefaultForm(), qcPolicyExplicit: true, acceptedQcFlags: '1' };
    const form = cachedDataForm(base, coverage);
    assert.equal(form.qcPolicyExplicit, true);
    assert.equal(form.acceptedQcFlags, '1');
  });
});

describe('query state is preserved', () => {
  const validation = (): PlanValidationResponse => ({
    schema_version: '1.0',
    outcome: 'valid',
    requested: {},
    normalized_plan: {} as never,
    errors: [],
    warnings: [],
    matching: { observations: 1, profiles: 1, floats: 1, platforms: [], profile_ids: [] },
    coverage: null,
    dataset: null,
  });
  const execution = (): PlanExecutionResponse => ({
    schema_version: '1.0',
    executed: true,
    executed_at: '2024-05-01T00:00:00Z',
    outcome: 'valid',
    plan: { variables: ['temp'] } as never,
    validation: validation(),
    dataset: null,
    results: {
      profiles: PROFILES,
      observations: [],
      observation_count: 0,
      returned_observation_count: 0,
      derived: [],
      truncated: false,
      variables: ['temp'],
      limitations: [],
    },
  });

  it('"Use cached data" is an ordinary edit: it re-validates and does not run', () => {
    let state = createSession(createDefaultForm());
    state = sessionReducer(state, { type: 'validation:result', revision: state.revision, result: validation() });
    const before = state.revision;
    state = sessionReducer(state, {
      type: 'edit',
      form: cachedDataForm(state.form, {
        date_range: ['2024-01-01T00:50:30', '2024-01-09T08:52:30'],
        bounding_box: { west: 61.2556, east: 64.446035, south: 15.518741666666667, north: 19.24811 },
        depth_range_m: [1.15, 496.37],
      }),
    });
    assert.equal(state.revision, before + 1);
    assert.equal(currentValidation(state), null);
    assert.equal(canExecute(state), false);
    assert.equal(state.execution, null);
  });

  it('keeps the previous results on screen, flagged stale, after a filter edit', () => {
    let state = createSession(createDefaultForm());
    state = sessionReducer(state, { type: 'validation:result', revision: state.revision, result: validation() });
    state = sessionReducer(state, { type: 'execution:result', revision: state.revision, response: execution() });
    state = sessionReducer(state, { type: 'edit', form: { ...state.form, depthMax: '100' } });
    const shown = displayedResults(state)!;
    assert.equal(shown.stale, true);
    assert.equal(shown.response.results?.profiles.length, PROFILES.length);
  });
});
