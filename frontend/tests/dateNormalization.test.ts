/**
 * Date normalization across browser time zones.
 *
 * Found during the Gemini evaluation (2026-09-14): a timestamp without a time
 * zone in a proposal was re-read as browser-local time on accept. Fixed
 * 2026-09-15: date fields are parsed without the browser's zone, date-only
 * values stay YYYY-MM-DD and mean inclusive UTC days, explicit timestamps keep
 * their instant, and a timestamp without a zone becomes a form issue instead
 * of being guessed.
 *
 * Every case runs under UTC, Asia/Kolkata (UTC+05:30) and America/New_York
 * (UTC-04:00 in June), so any local-time reading changes the result. The
 * proposals are fixtures; no service is called.
 *
 *     npm run test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyPlanToForm,
  createDefaultForm,
  endInstant,
  formToPlan,
  parseTimeText,
  startInstant,
} from '../src/lib/draftPlan.ts';
import { canExecute, createSession, sessionReducer } from '../src/lib/querySession.ts';
import type { PlanDraftResponse, QueryPlanRequest } from '../src/lib/planContract.ts';

const ZONES = ['UTC', 'Asia/Kolkata', 'America/New_York'];

function inEachZone(test: (zone: string) => void) {
  const original = process.env.TZ;
  try {
    for (const zone of ZONES) {
      process.env.TZ = zone;
      test(zone);
    }
  } finally {
    process.env.TZ = original;
  }
}

function plan(time: QueryPlanRequest['time']): QueryPlanRequest {
  return {
    schema_version: '1.0',
    time,
    region: { kind: 'named', name: 'argo_cached_subset' },
    depth: { mode: 'range', min_m: 0, max_m: 200 },
    variables: ['temp'],
  };
}

/** What the planner now proposes for "June 2019" (explicit UTC). */
const JUNE_2019_UTC = plan({ start: '2019-06-01T00:00:00Z', end: '2019-06-30T23:59:59.999999Z' });
/** The same month with a +05:30 offset: its end falls on 1 July locally. */
const JUNE_2019_IST = plan({ start: '2019-06-01T05:30:00+05:30', end: '2019-07-01T05:29:59.999+05:30' });
/** Exactly what Gemini returned for "Show temperature in June 2019". */
const NAIVE_JUNE_2019 = plan({ start: '2019-06-01T00:00:00', end: '2019-06-30T23:59:59' });

const JUNE_2019 = { start: '2019-06-01T00:00:00.000Z', end: '2019-06-30T23:59:59.999Z' };

function accept(proposal: QueryPlanRequest) {
  const form = applyPlanToForm(createDefaultForm(), proposal);
  return { form, ...formToPlan(form) };
}

describe('date normalization', () => {
  it('runs each case in zones where a local-time reading would differ', () => {
    const readings = new Set<string>();
    inEachZone(() => readings.add(new Date('2019-06-30T23:59:59').toISOString()));
    assert.equal(readings.size, ZONES.length);
  });

  it('represents a date-only June 2019 as the complete calendar month', () => {
    inEachZone(() => {
      assert.equal(startInstant('2019-06-01'), JUNE_2019.start);
      assert.equal(endInstant('2019-06-30'), JUNE_2019.end);
    });
  });

  it('passes an explicit UTC timestamp through unchanged', () => {
    inEachZone(() => {
      assert.equal(endInstant('2019-06-30T23:59:59.999Z'), '2019-06-30T23:59:59.999Z');
    });
  });

  it('accepts a UTC proposal as date-only fields and the same instants', () => {
    inEachZone((zone) => {
      const { form, plan: accepted, issues } = accept(JUNE_2019_UTC);
      assert.equal(form.startDate, '2019-06-01', zone);
      assert.equal(form.endDate, '2019-06-30', zone);
      assert.deepEqual(issues, [], zone);
      assert.deepEqual(accepted!.time, JUNE_2019, zone);
    });
  });

  it('accepts an offset proposal across the date boundary without shifting the day', () => {
    inEachZone((zone) => {
      const { form, plan: accepted } = accept(JUNE_2019_IST);
      assert.equal(form.startDate, '2019-06-01', zone);
      assert.equal(form.endDate, '2019-06-30', zone);
      assert.deepEqual(accepted!.time, JUNE_2019, zone);
    });
  });

  it('keeps an instant that is not on a day boundary, shown in UTC', () => {
    // 20:00 UTC on 30 June is 1 July in Kolkata; 06:00 UTC is 02:00 in New York.
    const proposal = plan({ start: '2019-06-01T02:00:00-04:00', end: '2019-06-30T20:00:00Z' });
    inEachZone((zone) => {
      const { form, plan: accepted } = accept(proposal);
      assert.equal(form.startDate, '2019-06-01T06:00:00.000Z', zone);
      assert.equal(form.endDate, '2019-06-30T20:00:00.000Z', zone);
      assert.deepEqual(accepted!.time, { start: '2019-06-01T06:00:00.000Z', end: '2019-06-30T20:00:00.000Z' }, zone);
    });
  });

  it('reports a timestamp without a time zone instead of reading it as local time', () => {
    inEachZone((zone) => {
      const { form, plan: accepted, issues } = accept(NAIVE_JUNE_2019);
      assert.equal(accepted, null, zone);
      assert.equal(form.startDate, '2019-06-01T00:00:00', zone);
      assert.equal(form.endDate, '2019-06-30T23:59:59', zone);
      assert.deepEqual(issues.map((issue) => issue.field), ['time.start', 'time.end'], zone);
      for (const issue of issues) assert.match(issue.message, /has no time zone/);
    });
  });

  it('recovers once the reported dates are corrected', () => {
    inEachZone((zone) => {
      const { form } = accept(NAIVE_JUNE_2019);
      const fixed = formToPlan({ ...form, startDate: '2019-06-01', endDate: '2019-06-30T23:59:59Z' });
      assert.deepEqual(fixed.issues, [], zone);
      assert.deepEqual(fixed.plan!.time, { start: JUNE_2019.start, end: '2019-06-30T23:59:59.000Z' }, zone);
    });
  });

  it('never makes a zoneless proposal runnable through the session', () => {
    inEachZone((zone) => {
      let state = createSession(createDefaultForm());
      state = sessionReducer(state, { type: 'draft:start', revision: state.revision });
      const response = {
        schema_version: '1.0',
        outcome: 'proposed_draft',
        proposed_plan: NAIVE_JUNE_2019,
        normalized_plan: null,
        changes: [],
        retained_fields: [],
        assumptions: [],
        clarification_question: null,
        unsupported: [],
        errors: [],
        provider_message: null,
        reference_date_utc: '2026-09-15T00:00:00+00:00',
        revision: state.revision,
        question: 'Show temperature in June 2019',
      } as unknown as PlanDraftResponse;
      state = sessionReducer(state, { type: 'draft:result', revision: state.revision, response });
      state = sessionReducer(state, { type: 'draft:accept' });
      assert.equal(state.plan, null, zone);
      assert.ok(state.formIssues.some((issue) => issue.field === 'time.end'), zone);
      assert.equal(canExecute(state), false, zone);
    });
  });

  it('parses typed text the same way in every zone', () => {
    inEachZone((zone) => {
      assert.deepEqual(parseTimeText('2019-06-30T23:59:59+0530'), { kind: 'instant', iso: '2019-06-30T18:29:59.000Z' }, zone);
      assert.deepEqual(parseTimeText('2019-06-30 23:59:59Z'), { kind: 'instant', iso: '2019-06-30T23:59:59.000Z' }, zone);
      assert.deepEqual(parseTimeText('2019-06-30T23:59:59'), { kind: 'no_timezone' }, zone);
      assert.deepEqual(parseTimeText('June 2019'), { kind: 'invalid' }, zone);
      assert.deepEqual(parseTimeText(''), { kind: 'empty' }, zone);
    });
  });
});
