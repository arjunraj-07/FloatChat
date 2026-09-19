/**
 * Interaction tests for the draft/validation/execution state machine.
 *
 * Run with Node's built-in test runner and native TypeScript stripping, so no
 * test framework is added to the project:
 *
 *     npm run test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createDefaultForm,
  formToPlan,
  describePlan,
  endInstant,
  startInstant,
  splitIds,
  type DraftForm,
} from '../src/lib/draftPlan.ts';
import {
  canExecute,
  createSession,
  currentValidation,
  displayedResults,
  executionBlockedReason,
  resultsAreStale,
  sessionReducer,
  type SessionState,
} from '../src/lib/querySession.ts';
import {
  isExecutable,
  type Outcome,
  type PlanExecutionResponse,
  type PlanValidationResponse,
} from '../src/lib/planContract.ts';

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

function validation(
  outcome: Outcome,
  overrides: Partial<PlanValidationResponse> = {},
): PlanValidationResponse {
  return {
    schema_version: '1.0',
    outcome,
    requested: {},
    normalized_plan: outcome === 'invalid' ? null : ({} as never),
    errors: outcome === 'invalid' || outcome === 'unsupported'
      ? [{ code: 'x', field: null, message: 'boom' }]
      : [],
    warnings: [],
    matching: { observations: 10, profiles: 2, floats: 1, platforms: [], profile_ids: [] },
    coverage: null,
    dataset: null,
    ...overrides,
  };
}

function execution(planVariables: string[]): PlanExecutionResponse {
  return {
    schema_version: '1.0',
    executed: true,
    executed_at: '2024-05-01T00:00:00Z',
    outcome: 'valid',
    plan: { variables: planVariables } as never,
    validation: validation('valid'),
    dataset: null,
    results: {
      profiles: [],
      observations: [],
      observation_count: 3,
      returned_observation_count: 3,
      derived: [],
      truncated: false,
      variables: planVariables as never,
      limitations: [],
    },
  };
}

function ready(): SessionState {
  const state = createSession(createDefaultForm());
  return sessionReducer(state, {
    type: 'validation:result',
    revision: state.revision,
    result: validation('valid'),
  });
}

function edit(state: SessionState, changes: Partial<DraftForm>): SessionState {
  return sessionReducer(state, { type: 'edit', form: { ...state.form, ...changes } });
}

// --------------------------------------------------------------------------

describe('date semantics', () => {
  it('starts a date-only start at the first instant of the day', () => {
    assert.equal(startInstant('2024-01-01'), '2024-01-01T00:00:00.000Z');
  });

  it('runs a date-only end to the last instant of that day', () => {
    // "through January 10" must include all of January 10.
    assert.equal(endInstant('2024-01-10'), '2024-01-10T23:59:59.999Z');
  });

  it('does not collapse an end date to midnight at its start', () => {
    assert.notEqual(endInstant('2024-01-10'), '2024-01-10T00:00:00.000Z');
  });

  it('passes through an explicit instant unchanged', () => {
    assert.equal(endInstant('2024-01-10T06:30:00Z'), '2024-01-10T06:30:00.000Z');
  });

  it('treats blank and unparseable input as absent', () => {
    assert.equal(startInstant(''), null);
    assert.equal(startInstant('   '), null);
    assert.equal(endInstant('not a date'), null);
  });
});

describe('form to plan conversion', () => {
  it('builds a plan from the default form', () => {
    const { plan, issues } = formToPlan(createDefaultForm());
    assert.deepEqual(issues, []);
    assert.ok(plan);
    assert.equal(plan.schema_version, '1.0');
    assert.equal(plan.time.start, '2024-01-01T00:00:00.000Z');
    assert.equal(plan.time.end, '2024-01-10T23:59:59.999Z');
  });

  it('lets a numeric field be cleared without substituting a default', () => {
    const form = { ...createDefaultForm(), regionKind: 'bbox' as const, west: '' };
    const { plan, issues } = formToPlan(form);
    assert.equal(plan, null, 'an incomplete form must not produce a plan');
    assert.ok(issues.some((i) => i.field === 'region.west'));
    // The cleared value is still exactly what the user left behind.
    assert.equal(form.west, '');
  });

  it('rejects a non-finite number rather than sending it', () => {
    const form = { ...createDefaultForm(), depthMax: 'abc' };
    const { plan, issues } = formToPlan(form);
    assert.equal(plan, null);
    assert.ok(issues.some((i) => i.field === 'depth.max_m'));
  });

  it('requires at least one variable', () => {
    const { plan, issues } = formToPlan({ ...createDefaultForm(), variables: [] });
    assert.equal(plan, null);
    assert.ok(issues.some((i) => i.field === 'variables'));
  });

  it('omits qc_policy unless the user made it explicit', () => {
    const implicit = formToPlan(createDefaultForm()).plan;
    assert.equal(implicit?.qc_policy, undefined);

    const explicit = formToPlan({
      ...createDefaultForm(), qcPolicyExplicit: true,
    }).plan;
    assert.deepEqual(explicit?.qc_policy, {
      accepted_qc_flags: [1], data_modes: ['R', 'A', 'D'],
    });
  });

  it('omits selection when no ids were typed', () => {
    assert.equal(formToPlan(createDefaultForm()).plan?.selection, undefined);
  });

  it('parses identifier lists on commas or whitespace', () => {
    assert.deepEqual(splitIds(' 2902201, 2902263  6903060 '),
      ['2902201', '2902263', '6903060']);
    assert.deepEqual(splitIds('  '), []);
  });

  it('passes malformed ids through for the backend to judge', () => {
    // The frontend must not duplicate the identifier rules.
    const plan = formToPlan({ ...createDefaultForm(), platforms: 'abc' }).plan;
    assert.deepEqual(plan?.selection?.platforms, ['abc']);
  });

  it('builds an exact-depth plan', () => {
    const plan = formToPlan({
      ...createDefaultForm(), depthMode: 'at_depth', depthTarget: '75',
    }).plan;
    assert.deepEqual(plan?.depth, { mode: 'at_depth', target_m: 75 });
  });
});

describe('plan description', () => {
  it('reads back the plan in plain language', () => {
    const plan = formToPlan(createDefaultForm()).plan!;
    const text = describePlan(plan);
    assert.match(text, /temperature/);
    assert.match(text, /2024-01-01 through 2024-01-10 inclusive/);
    assert.match(text, /between 0 m and 500 m depth/);
  });

  it('says an exact depth is interpolated', () => {
    const plan = formToPlan({
      ...createDefaultForm(), depthMode: 'at_depth', depthTarget: '75',
    }).plan!;
    assert.match(describePlan(plan), /at exactly 75 m depth \(interpolated/);
  });
});

describe('editing the draft', () => {
  it('keeps one draft as the source of truth across controls', () => {
    let state = createSession(createDefaultForm());
    state = edit(state, { variables: ['temp', 'psal'] });
    state = edit(state, { depthMax: '250' });
    assert.deepEqual(state.form.variables, ['temp', 'psal']);
    assert.equal(state.form.depthMax, '250');
    assert.deepEqual(state.plan?.variables, ['temp', 'psal']);
    assert.equal(state.plan?.depth.mode === 'range' && state.plan.depth.max_m, 250);
  });

  it('invalidates the previous validation on every edit', () => {
    let state = ready();
    assert.ok(currentValidation(state));
    state = edit(state, { depthMax: '250' });
    assert.equal(currentValidation(state), null);
    assert.equal(canExecute(state), false);
  });
});

describe('out-of-order responses', () => {
  it('ignores a validation reply for a superseded revision', () => {
    let state = createSession(createDefaultForm());
    const firstRevision = state.revision;
    state = edit(state, { depthMax: '250' });

    state = sessionReducer(state, {
      type: 'validation:result',
      revision: firstRevision,
      result: validation('valid'),
    });
    assert.equal(state.validation, null, 'stale reply must be dropped');
    assert.equal(canExecute(state), false);
  });

  it('keeps the latest reply when an older one arrives afterwards', () => {
    let state = createSession(createDefaultForm());
    const stale = state.revision;
    state = edit(state, { depthMax: '250' });

    state = sessionReducer(state, {
      type: 'validation:result',
      revision: state.revision,
      result: validation('valid', { matching: { observations: 99, profiles: 1, floats: 1, platforms: [], profile_ids: [] } }),
    });
    state = sessionReducer(state, {
      type: 'validation:result',
      revision: stale,
      result: validation('valid', { matching: { observations: 1, profiles: 1, floats: 1, platforms: [], profile_ids: [] } }),
    });

    assert.equal(currentValidation(state)?.matching?.observations, 99);
  });

  it('drops an execution reply for a superseded revision', () => {
    let state = ready();
    const old = state.revision;
    state = edit(state, { depthMax: '250' });
    state = sessionReducer(state, {
      type: 'execution:result', revision: old, response: execution(['temp']),
    });
    assert.equal(state.execution, null);
  });
});

describe('execution gating', () => {
  it('runs a valid draft', () => {
    assert.equal(canExecute(ready()), true);
    assert.equal(executionBlockedReason(ready()), null);
  });

  it('runs a partial-coverage draft', () => {
    let state = createSession(createDefaultForm());
    state = sessionReducer(state, {
      type: 'validation:result',
      revision: state.revision,
      result: validation('valid_partial_coverage'),
    });
    assert.equal(canExecute(state), true);
  });

  it('refuses an invalid draft', () => {
    let state = createSession(createDefaultForm());
    state = sessionReducer(state, {
      type: 'validation:result', revision: state.revision,
      result: validation('invalid'),
    });
    assert.equal(canExecute(state), false);
    assert.match(executionBlockedReason(state)!, /errors/);
  });

  it('refuses an unsupported draft', () => {
    let state = createSession(createDefaultForm());
    state = sessionReducer(state, {
      type: 'validation:result', revision: state.revision,
      result: validation('unsupported'),
    });
    assert.equal(canExecute(state), false);
    assert.match(executionBlockedReason(state)!, /does not implement/);
  });

  it('refuses a no-data draft with an explicit reason', () => {
    let state = createSession(createDefaultForm());
    state = sessionReducer(state, {
      type: 'validation:result', revision: state.revision,
      result: validation('valid_no_data'),
    });
    assert.equal(canExecute(state), false);
    assert.match(executionBlockedReason(state)!, /Nothing in the dataset matches/);
  });

  it('refuses while the form is incomplete', () => {
    let state = createSession(createDefaultForm());
    state = edit(state, { regionKind: 'bbox', west: '' });
    state = sessionReducer(state, {
      type: 'validation:result', revision: state.revision,
      result: validation('valid'),
    });
    assert.equal(canExecute(state), false);
    assert.match(executionBlockedReason(state)!, /Complete the highlighted fields/);
  });

  it('refuses a second run while one is in flight', () => {
    let state = ready();
    state = sessionReducer(state, { type: 'execution:start', revision: state.revision });
    assert.equal(state.executing, true);
    assert.equal(canExecute(state), false);

    // A second start must not reset or duplicate the run.
    const again = sessionReducer(state, {
      type: 'execution:start', revision: state.revision,
    });
    assert.equal(again, state);
  });

  it('isExecutable alone does not consider which draft a result described', () => {
    // It is necessary but not sufficient; canExecute adds revision matching.
    const result = validation('valid');
    assert.equal(isExecutable(result), true);

    let state = ready();
    state = edit(state, { depthMax: '250' });
    assert.equal(canExecute(state), false);
  });

  it('isExecutable rejects a result that carries errors', () => {
    const contradictory = validation('valid', {
      errors: [{ code: 'x', field: null, message: 'boom' }],
    });
    assert.equal(isExecutable(contradictory), false);
  });

  it('isExecutable rejects a result with no normalized plan', () => {
    assert.equal(
      isExecutable(validation('valid', { normalized_plan: null })), false,
    );
  });
});

describe('results versus the current draft', () => {
  it('marks results stale once the draft is edited', () => {
    let state = ready();
    state = sessionReducer(state, {
      type: 'execution:result', revision: state.revision, response: execution(['temp']),
    });
    assert.equal(resultsAreStale(state), false);
    assert.equal(displayedResults(state)?.stale, false);

    state = edit(state, { variables: ['temp', 'psal'] });
    assert.equal(resultsAreStale(state), true);
    assert.equal(displayedResults(state)?.stale, true);
  });

  it('labels results by the executed plan, not the edited draft', () => {
    let state = ready();
    state = sessionReducer(state, {
      type: 'execution:result', revision: state.revision, response: execution(['temp']),
    });
    state = edit(state, { variables: ['temp', 'psal'] });

    // The draft now asks for salinity, but the displayed results must still
    // describe themselves as the temperature-only run that produced them.
    assert.deepEqual(displayedResults(state)?.response.plan?.variables, ['temp']);
    assert.deepEqual(state.plan?.variables, ['temp', 'psal']);
  });

  it('keeps the previous results visible while a new draft is unvalidated', () => {
    let state = ready();
    state = sessionReducer(state, {
      type: 'execution:result', revision: state.revision, response: execution(['temp']),
    });
    state = edit(state, { depthMax: '250' });
    assert.ok(displayedResults(state), 'results stay on screen, flagged stale');
    assert.equal(currentValidation(state), null);
  });

  it('reports a transport failure without discarding earlier results', () => {
    let state = ready();
    state = sessionReducer(state, {
      type: 'execution:result', revision: state.revision, response: execution(['temp']),
    });
    state = sessionReducer(state, {
      type: 'execution:error', revision: state.revision, message: 'network down',
    });
    assert.equal(state.executionError, 'network down');
    assert.equal(state.executing, false);
    assert.ok(displayedResults(state));
  });
});

describe('a reply for a draft that has moved on', () => {
  it('discards the result but stops the screen saying it is loading', () => {
    // Found with a larger dataset: the first run was still in flight when the
    // draft changed, its reply was dropped, and `executing` stayed true - so
    // canExecute was false from then on and automatic results simply stopped.
    let state = createSession(createDefaultForm());
    const first = state.revision;
    state = sessionReducer(state, { type: 'execution:start', revision: first });
    assert.equal(state.executing, true);
    state = sessionReducer(state, { type: 'edit', form: state.form });
    state = sessionReducer(state, {
      type: 'execution:result', revision: first, response: execution(['temp']),
    });
    assert.equal(state.executing, false, 'the request has ended');
    assert.equal(state.execution, null, 'the superseded result is not shown');
  });

  it('does the same for a superseded failure', () => {
    let state = createSession(createDefaultForm());
    const first = state.revision;
    state = sessionReducer(state, { type: 'execution:start', revision: first });
    state = sessionReducer(state, { type: 'edit', form: state.form });
    state = sessionReducer(state, { type: 'execution:error', revision: first, message: 'boom' });
    assert.equal(state.executing, false);
    assert.equal(state.executionError, null, 'an old failure is not reported against new filters');
  });
});
