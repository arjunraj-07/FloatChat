/**
 * Binding an explanation to the result it describes.
 *
 * An explanation is about one executed result. The rules under test:
 *
 *  - it is kept with the execution it was asked about, not the draft;
 *  - a reply that arrives after different results are shown is discarded;
 *  - running a new query drops the previous explanation rather than leaving it
 *    beside results it never described;
 *  - editing filters alone does not silently reattach it to something else.
 *
 * Run with Node's built-in test runner:  npm run test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDefaultForm } from '../src/lib/draftPlan.ts';
import {
  createSession,
  currentExplanation,
  sessionReducer,
  type SessionState,
} from '../src/lib/querySession.ts';
import type {
  PlanExecutionResponse,
  PlanExplanationResponse,
  PlanValidationResponse,
} from '../src/lib/planContract.ts';

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const validation: PlanValidationResponse = {
  schema_version: '1.0',
  outcome: 'valid',
  requested: {},
  normalized_plan: {} as never,
  errors: [],
  warnings: [],
  matching: { observations: 10, profiles: 2, floats: 1, platforms: [], profile_ids: [] },
  coverage: null,
  dataset: null,
};

function execution(overrides: Partial<PlanExecutionResponse> = {}): PlanExecutionResponse {
  return {
    schema_version: '1.0',
    executed: true,
    executed_at: '2024-05-01T00:00:00Z',
    outcome: 'valid',
    plan: {} as never,
    validation,
    dataset: { raw_file_checksum: 'sha256:abc' } as never,
    results: null,
    ...overrides,
  };
}

function explanation(overrides: Partial<PlanExplanationResponse> = {}): PlanExplanationResponse {
  return {
    schema_version: '1.0',
    outcome: 'explained',
    sentences: [
      { template: 'scope.profiles', variable: null, text: 'This result covers 11 profiles.', fact_ids: ['profiles.count'] },
    ],
    caveats: [],
    limitations: [],
    used_fact_ids: ['profiles.count'],
    rejected: [],
    provider_message: null,
    dataset_version: 'sha256:abc',
    plan_fingerprint: 'sha256:def',
    source: 'model',
    ...overrides,
  };
}

/** A session with one executed result on screen. */
function sessionWithResults(): SessionState {
  let state = createSession(createDefaultForm());
  const revision = state.revision;
  state = sessionReducer(state, { type: 'execution:start', revision });
  state = sessionReducer(state, { type: 'execution:result', revision, response: execution() });
  return state;
}

// --------------------------------------------------------------------------

describe('asking for an explanation', () => {
  it('is ignored when there are no results to explain', () => {
    const state = createSession(createDefaultForm());
    const next = sessionReducer(state, { type: 'explain:start', revision: state.revision });
    assert.equal(next.explaining, false);
    assert.equal(next, state);
  });

  it('does not start a second request while one is in flight', () => {
    let state = sessionWithResults();
    state = sessionReducer(state, { type: 'explain:start', revision: state.execution!.revision });
    assert.equal(state.explaining, true);
    const again = sessionReducer(state, { type: 'explain:start', revision: state.execution!.revision });
    assert.equal(again, state);
  });

  it('keeps the explanation with the results it described', () => {
    let state = sessionWithResults();
    const revision = state.execution!.revision;
    state = sessionReducer(state, { type: 'explain:start', revision });
    state = sessionReducer(state, { type: 'explain:result', revision, response: explanation() });
    assert.equal(state.explaining, false);
    assert.equal(currentExplanation(state)?.sentences[0].text, 'This result covers 11 profiles.');
  });
});

describe('results that change underneath an explanation', () => {
  it('drops the explanation when a new result is displayed', () => {
    let state = sessionWithResults();
    const revision = state.execution!.revision;
    state = sessionReducer(state, { type: 'explain:start', revision });
    state = sessionReducer(state, { type: 'explain:result', revision, response: explanation() });

    // A fresh run of an edited draft.
    state = sessionReducer(state, { type: 'edit', form: state.form });
    const next = state.revision;
    state = sessionReducer(state, { type: 'execution:start', revision: next });
    state = sessionReducer(state, { type: 'execution:result', revision: next, response: execution() });

    assert.equal(state.explanation, null);
    assert.equal(currentExplanation(state), null);
  });

  it('keeps it while only the draft has moved on, so it still describes what is shown', () => {
    let state = sessionWithResults();
    const revision = state.execution!.revision;
    state = sessionReducer(state, { type: 'explain:start', revision });
    state = sessionReducer(state, { type: 'explain:result', revision, response: explanation() });

    // Editing filters does not replace the results on screen, so the
    // explanation still describes them; it is labelled, not discarded.
    state = sessionReducer(state, { type: 'edit', form: state.form });
    assert.notEqual(currentExplanation(state), null);
    assert.notEqual(state.execution!.revision, state.revision);
  });

  it('ignores a reply about results that are no longer displayed', () => {
    let state = sessionWithResults();
    const stale = state.execution!.revision;
    state = sessionReducer(state, { type: 'explain:start', revision: stale });

    // Different results arrive while the explanation is in flight.
    state = sessionReducer(state, { type: 'edit', form: state.form });
    const next = state.revision;
    state = sessionReducer(state, { type: 'execution:start', revision: next });
    state = sessionReducer(state, { type: 'execution:result', revision: next, response: execution() });

    const late = sessionReducer(state, {
      type: 'explain:result',
      revision: stale,
      response: explanation({ sentences: [{ template: 'scope.profiles', variable: null, text: 'About the old results.', fact_ids: [] }] }),
    });
    assert.equal(late.explanation, null);
    assert.equal(currentExplanation(late), null);
  });

  it('ignores a late error about superseded results', () => {
    let state = sessionWithResults();
    const stale = state.execution!.revision;
    state = sessionReducer(state, { type: 'edit', form: state.form });
    const next = state.revision;
    state = sessionReducer(state, { type: 'execution:start', revision: next });
    state = sessionReducer(state, { type: 'execution:result', revision: next, response: execution() });

    const late = sessionReducer(state, { type: 'explain:error', revision: stale, message: 'boom' });
    assert.equal(late.explanationError, null);
  });
});

describe('the plan an explanation is about', () => {
  it('snapshots the plan that was executed, not the draft as it stands', () => {
    let state = createSession(createDefaultForm());
    const planAtRun = state.plan;
    const revision = state.revision;
    state = sessionReducer(state, { type: 'execution:start', revision });
    state = sessionReducer(state, { type: 'execution:result', revision, response: execution() });
    assert.deepEqual(state.executedPlan?.value ?? null, planAtRun);

    // Editing filters afterwards must not change which query would be
    // explained: the results on screen still came from the earlier plan.
    state = sessionReducer(state, { type: 'edit', form: state.form });
    assert.deepEqual(state.executedPlan?.value ?? null, planAtRun);
    assert.equal(state.executedPlan?.revision, revision);
  });

  it('replaces the snapshot when different results are displayed', () => {
    let state = sessionWithResults();
    const first = state.executedPlan?.revision;
    state = sessionReducer(state, { type: 'edit', form: state.form });
    const next = state.revision;
    state = sessionReducer(state, { type: 'execution:start', revision: next });
    state = sessionReducer(state, { type: 'execution:result', revision: next, response: execution() });
    assert.notEqual(state.executedPlan?.revision, first);
    assert.equal(state.executedPlan?.revision, next);
  });

  it('never edits the draft, the plan or the revision', () => {
    let state = sessionWithResults();
    const before = {
      form: state.form,
      plan: state.plan,
      revision: state.revision,
      formIssues: state.formIssues,
      execution: state.execution,
      executedPlan: state.executedPlan,
    };
    const revision = state.execution!.revision;

    state = sessionReducer(state, { type: 'explain:start', revision });
    state = sessionReducer(state, { type: 'explain:result', revision, response: explanation() });
    state = sessionReducer(state, { type: 'explain:clear' });

    // Reference equality: asking for an explanation must not even rebuild
    // these, let alone change a filter, a QC rule or which result is shown.
    assert.equal(state.form, before.form);
    assert.equal(state.plan, before.plan);
    assert.equal(state.revision, before.revision);
    assert.equal(state.formIssues, before.formIssues);
    assert.equal(state.execution, before.execution);
    assert.equal(state.executedPlan, before.executedPlan);
  });
});

describe('what the explanation says about itself', () => {
  it('reports a data summary as a summary, never as a model answer', () => {
    let state = sessionWithResults();
    const revision = state.execution!.revision;
    state = sessionReducer(state, {
      type: 'explain:result',
      revision,
      response: explanation({
        outcome: 'provider_unavailable',
        source: 'data_summary',
        provider_message: 'No explanation service is configured.',
      }),
    });
    const current = currentExplanation(state)!;
    assert.equal(current.source, 'data_summary');
    assert.notEqual(current.outcome, 'explained');
  });

  it('can be cleared explicitly', () => {
    let state = sessionWithResults();
    const revision = state.execution!.revision;
    state = sessionReducer(state, { type: 'explain:result', revision, response: explanation() });
    state = sessionReducer(state, { type: 'explain:clear' });
    assert.equal(currentExplanation(state), null);
  });

  it('records an error without discarding the results', () => {
    let state = sessionWithResults();
    const revision = state.execution!.revision;
    state = sessionReducer(state, { type: 'explain:start', revision });
    state = sessionReducer(state, { type: 'explain:error', revision, message: 'Network failed' });
    assert.equal(state.explaining, false);
    assert.equal(state.explanationError, 'Network failed');
    assert.notEqual(state.execution, null);
  });
});
