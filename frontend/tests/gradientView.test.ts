/**
 * Presentation of vertical gradients: selection and wording, never arithmetic.
 *
 *     npm run test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  ExecutionResults,
  GradientInterval,
  GradientReport,
  ThermoclineEstimate,
  VariableGradients,
} from '../src/lib/planContract.ts';
import {
  describeBreaks,
  describeChange,
  formatGradient,
  gradientsForProfile,
  intervalDepths,
  thermoclineForProfile,
  steepestFirst,
  unavailableReason,
  variableGradients,
} from '../src/lib/gradientView.ts';

function interval(over: Partial<GradientInterval> = {}): GradientInterval {
  return {
    variable: 'temp',
    profile_id: 'P1',
    upper: { depth_m: 10, value: 25 },
    lower: { depth_m: 20, value: 24 },
    midpoint_depth_m: 15,
    delta_depth_m: 10,
    delta_value: -1,
    gradient: -0.1,
    units: 'degrees Celsius per metre (ITS-90)',
    value_units: 'degree_Celsius',
    derived: true,
    ...over,
  };
}

function series(over: Partial<VariableGradients> = {}): VariableGradients {
  return {
    variable: 'temp',
    profile_id: 'P1',
    status: 'ok',
    intervals: [interval()],
    interval_count: 1,
    breaks: [],
    break_count: 0,
    accepted_sample_count: 2,
    units: 'degrees Celsius per metre (ITS-90)',
    max_gap_m: 20,
    max_gap_policy: 'application policy',
    method: 'first difference',
    // Carried once per series rather than repeated on every interval.
    derivation: 'derived quantity: a finite difference between two levels',
    derived: true,
    ...over,
  };
}

function report(profileId: string, over: Partial<GradientReport> = {}): GradientReport {
  return {
    profile_id: profileId,
    variables: { temp: series({ profile_id: profileId }) },
    strongest_cooling: null,
    derived: true,
    ...over,
  };
}

function results(gradients?: GradientReport[]): ExecutionResults {
  return {
    profiles: [],
    observations: [],
    observation_count: 0,
    returned_observation_count: 0,
    derived: [],
    gradients,
    truncated: false,
    variables: ['temp'],
    limitations: [],
  };
}

describe('selecting a report', () => {
  it('returns the report belonging to the requested profile', () => {
    const found = gradientsForProfile(results([report('A'), report('B')]), 'B');
    assert.equal(found?.profile_id, 'B');
  });

  it('never returns another profile report when this one has none', () => {
    // The guard that matters: a report must not appear under a profile it
    // does not belong to.
    assert.equal(gradientsForProfile(results([report('A')]), 'B'), null);
  });

  it('is null when the analysis was not requested or the result is older', () => {
    assert.equal(gradientsForProfile(results(undefined), 'A'), null);
    assert.equal(gradientsForProfile(results([]), 'A'), null);
    assert.equal(gradientsForProfile(null, 'A'), null);
    assert.equal(gradientsForProfile(results([report('A')]), null), null);
  });

  it('reads one variable at a time, so a missing one does not hide the other', () => {
    const both = report('A', {
      variables: { temp: series(), psal: series({ variable: 'psal' }) },
    });
    assert.equal(variableGradients(both, 'temp')?.variable, 'temp');
    assert.equal(variableGradients(both, 'psal')?.variable, 'psal');
    assert.equal(variableGradients(report('A'), 'psal'), null);
  });
});

describe('formatting', () => {
  it('keeps the sign, because it carries the direction', () => {
    assert.equal(formatGradient(interval({ gradient: -0.1 }), 3), '-0.100 °C/m');
    assert.equal(formatGradient(interval({ gradient: 0.25 }), 3), '+0.250 °C/m');
    assert.equal(formatGradient(interval({ gradient: 0 }), 3), '0.000 °C/m');
  });

  it('gives salinity no invented numerator unit', () => {
    const psal = interval({ variable: 'psal', gradient: 0.01 });
    assert.equal(formatGradient(psal, 3), '+0.010 /m');
  });

  it('shows the two depths the interval actually spans', () => {
    assert.equal(intervalDepths(interval()), '10.0–20.0 m');
  });

  it('describes the direction of change in plain words', () => {
    assert.match(describeChange(interval({ delta_value: -1 })), /temperature falls 1\.00 °C/);
    assert.match(describeChange(interval({ delta_value: 1.5 })), /temperature rises 1\.50 °C/);
    assert.match(describeChange(interval({ delta_value: 0 })), /unchanged/);
  });

  it('names salinity without a unit', () => {
    const text = describeChange(interval({ variable: 'psal', delta_value: 0.2 }));
    assert.match(text, /salinity rises 0\.20 between/);
  });
});

describe('stating why there is nothing to show', () => {
  it('separates no samples from one sample', () => {
    assert.match(
      unavailableReason(series({ status: 'insufficient_samples', accepted_sample_count: 0 })) ?? '',
      /No accepted levels/,
    );
    assert.match(
      unavailableReason(series({ status: 'insufficient_samples', accepted_sample_count: 1 })) ?? '',
      /needs two/,
    );
  });

  it('does not guess why no interval was eligible', () => {
    // A wide gap, a rejected level between two good ones, and conflicting
    // duplicates all produce this status. Only the breaks know which.
    const text = unavailableReason(series({ status: 'no_eligible_intervals' })) ?? '';
    assert.match(text, /could be compared/);
    assert.match(text, /skipped intervals/);
    assert.doesNotMatch(text, /too far apart/);
  });

  it('says when the result carries no analysis at all', () => {
    assert.match(unavailableReason(null) ?? '', /does not include/);
  });

  it('is null when there is something to show', () => {
    assert.equal(unavailableReason(series()), null);
  });
});

describe('breaks', () => {
  it('counts skipped intervals by reason, so gaps stay visible', () => {
    const withBreaks = series({
      breaks: [
        { reason: 'missing_value', message: '' },
        { reason: 'missing_value', message: '' },
        { reason: 'gap_exceeds_policy', message: '' },
      ],
      break_count: 3,
    });
    const text = describeBreaks(withBreaks) ?? '';
    assert.match(text, /3 intervals skipped/);
    assert.match(text, /2 no accepted value/);
    assert.match(text, /1 levels too far apart/);
  });

  it('is null when nothing was skipped', () => {
    assert.equal(describeBreaks(series()), null);
  });
});

describe('ordering', () => {
  it('puts the steepest changes first, by magnitude', () => {
    const many = series({
      intervals: [
        interval({ gradient: -0.1 }),
        interval({ gradient: 0.4 }),
        interval({ gradient: -0.9 }),
      ],
    });
    assert.deepEqual(steepestFirst(many).map((i) => i.gradient), [-0.9, 0.4, -0.1]);
  });

  it('does not mutate the response order', () => {
    const many = series({
      intervals: [interval({ gradient: -0.1 }), interval({ gradient: -0.9 })],
    });
    steepestFirst(many);
    assert.deepEqual(many.intervals.map((i) => i.gradient), [-0.1, -0.9]);
  });

  it('limits how many are shown', () => {
    const many = series({
      intervals: [interval(), interval(), interval(), interval()],
    });
    assert.equal(steepestFirst(many, 2).length, 2);
  });
});


// --- thermocline selection ---------------------------------------------------
//
// Selection only. The estimate itself is computed and tested in the backend;
// nothing here recalculates it.

function thermocline(over: Partial<ThermoclineEstimate> = {}): ThermoclineEstimate {
  return {
    profile_id: 'P1',
    status: 'estimated',
    reason: 'ok',
    method: 'strongest-eligible-cooling-interval',
    method_version: '1.0',
    policy: { min_gradient_c_per_m: 0.2, note: 'policies' },
    analysed_depth_range_m: [0, 200],
    range_note: 'range',
    candidate: null,
    ...over,
  };
}

describe('thermoclineForProfile', () => {
  const results = {
    thermoclines: [thermocline(), thermocline({ profile_id: 'P2', status: 'ambiguous' })],
  } as unknown as ExecutionResults;

  it('returns the estimate recorded for that profile', () => {
    assert.equal(thermoclineForProfile(results, 'P2')?.status, 'ambiguous');
  });

  it("shows nothing rather than another profile's estimate", () => {
    assert.equal(thermoclineForProfile(results, 'P9'), null);
    assert.equal(thermoclineForProfile(results, null), null);
  });

  it('shows nothing when the analysis was not requested', () => {
    assert.equal(thermoclineForProfile({} as ExecutionResults, 'P1'), null);
    assert.equal(thermoclineForProfile(null, 'P1'), null);
  });
});
