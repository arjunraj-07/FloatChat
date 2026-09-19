/**
 * Interaction tests for natural-language drafting.
 *
 * Provider replies are fixtures shaped like the backend's response, so these
 * cover how the UI state machine handles a draft - never model quality.
 *
 *     npm run test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyPlanToForm,
  createDefaultForm,
  formToPlan,
  type DraftForm,
} from '../src/lib/draftPlan.ts';
import {
  canAcceptProposal,
  canExecute,
  createSession,
  currentValidation,
  proposalIsStale,
  sessionReducer,
  type SessionState,
} from '../src/lib/querySession.ts';
import type {
  PlanDraftResponse,
  PlanValidationResponse,
  QueryPlanRequest,
} from '../src/lib/planContract.ts';

function validation(): PlanValidationResponse {
  return {
    schema_version: '1.0',
    outcome: 'valid',
    requested: {},
    normalized_plan: {} as never,
    errors: [],
    warnings: [],
    matching: {
      observations: 5, profiles: 1, floats: 1, platforms: [], profile_ids: [],
    },
    coverage: null,
    dataset: null,
  };
}

function proposal(overrides: Partial<PlanDraftResponse> = {}): PlanDraftResponse {
  const plan: QueryPlanRequest = {
    schema_version: '1.0',
    time: { start: '2024-01-01T00:00:00.000Z', end: '2024-01-10T23:59:59.999Z' },
    region: { kind: 'named', name: 'argo_cached_subset' },
    depth: { mode: 'at_depth', target_m: 100 },
    variables: ['temp'],
  };
  return {
    schema_version: '1.0',
    outcome: 'proposed_draft',
    proposed_plan: plan,
    normalized_plan: null,
    changes: [
      {
        field: 'depth',
        previous: { min_m: 0, max_m: 500 },
        proposed: { target_m: 100 },
        origin: 'changed',
      },
      { field: 'region', previous: 'x', proposed: 'x', origin: 'retained' },
    ],
    retained_fields: ['region', 'time', 'variables'],
    assumptions: ['Read 100 m as an exact depth.'],
    clarification_question: null,
    unsupported: [],
    errors: [],
    provider_message: null,
    reference_date_utc: '2025-07-15T00:00:00+00:00',
    revision: 1,
    question: 'show temperature at 100 m',
    ...overrides,
  };
}

function ready(): SessionState {
  const state = createSession(createDefaultForm());
  return sessionReducer(state, {
    type: 'validation:result',
    revision: state.revision,
    result: validation(),
  });
}

function edit(state: SessionState, changes: Partial<DraftForm>): SessionState {
  return sessionReducer(state, { type: 'edit', form: { ...state.form, ...changes } });
}

describe('applying a proposed plan to the form', () => {
  it('round-trips date-only fields without drifting', () => {
    const form = createDefaultForm();
    const plan = formToPlan(form).plan!;
    const applied = applyPlanToForm(form, plan);
    assert.equal(applied.startDate, form.startDate);
    assert.equal(applied.endDate, form.endDate);
  });

  it('fills the exact-depth controls', () => {
    const applied = applyPlanToForm(createDefaultForm(), proposal().proposed_plan!);
    assert.equal(applied.depthMode, 'at_depth');
    assert.equal(applied.depthTarget, '100');
  });

  it('keeps form-only settings the plan does not carry', () => {
    const form = {
      ...createDefaultForm(), qcPolicyExplicit: true, acceptedQcFlags: '1',
    };
    const applied = applyPlanToForm(form, proposal().proposed_plan!);
    assert.equal(applied.qcPolicyExplicit, true);
    assert.equal(applied.acceptedQcFlags, '1');
  });

  it('writes a bbox region back into the four boxes', () => {
    const plan: QueryPlanRequest = {
      ...proposal().proposed_plan!,
      region: { kind: 'bbox', west: 61, east: 64, south: 15, north: 19 },
    };
    const applied = applyPlanToForm(createDefaultForm(), plan);
    assert.equal(applied.regionKind, 'bbox');
    assert.equal(applied.west, '61');
    assert.equal(applied.north, '19');
  });

  it('clears a selection the plan does not carry', () => {
    const form = { ...createDefaultForm(), platforms: '2902201' };
    const applied = applyPlanToForm(form, proposal().proposed_plan!);
    assert.equal(applied.platforms, '');
  });
});

describe('drafting does not run anything', () => {
  it('a proposal never produces an execution', () => {
    let state = ready();
    state = sessionReducer(state, { type: 'draft:start', revision: state.revision });
    state = sessionReducer(state, {
      type: 'draft:result', revision: state.revision, response: proposal(),
    });
    assert.equal(state.execution, null);
    assert.equal(state.executing, false);
  });

  it('accepting a proposal still does not run it', () => {
    let state = ready();
    state = sessionReducer(state, {
      type: 'draft:result', revision: state.revision, response: proposal(),
    });
    state = sessionReducer(state, { type: 'draft:accept' });
    assert.equal(state.execution, null);
    assert.equal(state.executing, false);
  });
});

describe('accepting a proposal is an ordinary edit', () => {
  it('advances the revision and invalidates the old validation', () => {
    let state = ready();
    const before = state.revision;
    assert.ok(currentValidation(state));

    state = sessionReducer(state, {
      type: 'draft:result', revision: state.revision, response: proposal(),
    });
    state = sessionReducer(state, { type: 'draft:accept' });

    assert.equal(state.revision, before + 1);
    assert.equal(currentValidation(state), null, 're-validation is required');
    assert.equal(canExecute(state), false);
  });

  it('updates the form and the plan together', () => {
    let state = ready();
    state = sessionReducer(state, {
      type: 'draft:result', revision: state.revision, response: proposal(),
    });
    state = sessionReducer(state, { type: 'draft:accept' });
    assert.equal(state.form.depthMode, 'at_depth');
    assert.equal(state.plan?.depth.mode, 'at_depth');
    assert.equal(state.proposal, null, 'the proposal is consumed');
  });

  it('does nothing when the proposal carries no plan', () => {
    let state = ready();
    state = sessionReducer(state, {
      type: 'draft:result',
      revision: state.revision,
      response: proposal({ outcome: 'clarification_needed', proposed_plan: null }),
    });
    const before = state.revision;
    state = sessionReducer(state, { type: 'draft:accept' });
    assert.equal(state.revision, before);
    assert.equal(canAcceptProposal(state), false);
  });
});

describe('a stale proposal never overwrites newer manual work', () => {
  it('is kept but flagged when the draft moved on', () => {
    let state = ready();
    const asked = state.revision;
    state = sessionReducer(state, { type: 'draft:start', revision: asked });

    // The user keeps editing while the request is in flight.
    state = edit(state, { depthMax: '250' });

    state = sessionReducer(state, {
      type: 'draft:result', revision: asked, response: proposal(),
    });

    assert.ok(state.proposal, 'offered separately rather than dropped');
    assert.equal(proposalIsStale(state), true);
    // Crucially, it has not been applied.
    assert.equal(state.form.depthMax, '250');
    assert.equal(state.form.depthMode, 'range');
  });

  it('is not stale when no edit happened', () => {
    let state = ready();
    state = sessionReducer(state, {
      type: 'draft:result', revision: state.revision, response: proposal(),
    });
    assert.equal(proposalIsStale(state), false);
  });

  it('is only applied on an explicit accept', () => {
    let state = ready();
    const asked = state.revision;
    state = edit(state, { depthMax: '250' });
    state = sessionReducer(state, {
      type: 'draft:result', revision: asked, response: proposal(),
    });
    assert.equal(state.form.depthMax, '250');

    state = sessionReducer(state, { type: 'draft:accept' });
    assert.equal(state.form.depthMode, 'at_depth');
  });

  it('can be dismissed without touching the draft', () => {
    let state = ready();
    const before = state.revision;
    state = sessionReducer(state, {
      type: 'draft:result', revision: state.revision, response: proposal(),
    });
    state = sessionReducer(state, { type: 'draft:dismiss' });
    assert.equal(state.proposal, null);
    assert.equal(state.revision, before);
    assert.equal(state.form.depthMode, 'range');
  });

  it('refuses a second drafting request while one is in flight', () => {
    let state = ready();
    state = sessionReducer(state, { type: 'draft:start', revision: state.revision });
    assert.equal(state.drafting, true);
    const again = sessionReducer(state, {
      type: 'draft:start', revision: state.revision,
    });
    assert.equal(again, state);
  });
});

describe('provider failure leaves manual work alone', () => {
  it('records the error without changing the draft', () => {
    let state = ready();
    const before = JSON.stringify(state.form);
    state = sessionReducer(state, { type: 'draft:start', revision: state.revision });
    state = sessionReducer(state, {
      type: 'draft:error', revision: state.revision, message: 'service unreachable',
    });
    assert.equal(state.draftError, 'service unreachable');
    assert.equal(state.drafting, false);
    assert.equal(JSON.stringify(state.form), before);
  });

  it('leaves the manual draft executable after a provider failure', () => {
    let state = ready();
    state = sessionReducer(state, {
      type: 'draft:error', revision: state.revision, message: 'timeout',
    });
    assert.equal(canExecute(state), true, 'manual exploration keeps working');
  });

  it('surfaces an unavailable provider as a proposal with no plan', () => {
    let state = ready();
    state = sessionReducer(state, {
      type: 'draft:result',
      revision: state.revision,
      response: proposal({
        outcome: 'provider_unavailable',
        proposed_plan: null,
        provider_message: 'Natural-language service not configured.',
        errors: [{ code: 'provider_not_configured', field: null, message: 'none' }],
      }),
    });
    assert.equal(canAcceptProposal(state), false);
    assert.equal(canExecute(state), true, 'manual builder unaffected');
  });
});

describe('unsupported and clarification proposals', () => {
  it('an unsupported request carries the reason and no runnable change', () => {
    let state = ready();
    state = sessionReducer(state, {
      type: 'draft:result',
      revision: state.revision,
      response: proposal({
        outcome: 'unsupported_request',
        proposed_plan: null,
        unsupported: [{
          requested: 'marine_heatwave_detection',
          kind: 'analysis',
          reason: 'Requires a daily SST series and a documented baseline.',
        }],
      }),
    });
    assert.equal(canAcceptProposal(state), false);
    assert.match(
      state.proposal!.value.unsupported[0].reason!,
      /daily SST series/,
    );
  });

  it('a clarification keeps the draft untouched', () => {
    let state = ready();
    const before = JSON.stringify(state.form);
    state = sessionReducer(state, {
      type: 'draft:result',
      revision: state.revision,
      response: proposal({
        outcome: 'clarification_needed',
        proposed_plan: null,
        changes: [],
        clarification_question: 'Which period should last summer mean?',
      }),
    });
    assert.equal(JSON.stringify(state.form), before);
    assert.match(state.proposal!.value.clarification_question!, /last summer/);
  });
});
