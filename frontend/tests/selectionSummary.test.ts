/**
 * Readable descriptions of what a query selects.
 *
 *     npm run test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { QueryPlanRequest } from '../src/lib/planContract.ts';
import {
  REGION_LABELS,
  changedFields,
  datesLabel,
  depthLabel,
  regionLabel,
  selectionChanged,
  summarizeSelection,
  variablesLabel,
} from '../src/lib/selectionSummary.ts';

function plan(over: Partial<QueryPlanRequest> = {}): QueryPlanRequest {
  return {
    schema_version: '1.0',
    time: { start: '2024-01-01T00:00:00.000Z', end: '2024-01-09T23:59:59.999Z' },
    region: { kind: 'named', name: 'argo_cached_subset' },
    depth: { mode: 'range', min_m: 0, max_m: 500 },
    variables: ['temp'],
    ...over,
  };
}

describe('region names', () => {
  it('calls the cached extraction an Arabian Sea sample, not the whole sea', () => {
    assert.equal(REGION_LABELS.argo_cached_subset, 'Arabian Sea sample');
    assert.equal(regionLabel({ kind: 'named', name: 'argo_cached_subset' }), 'Arabian Sea sample');
  });

  it('names every region the schema accepts', () => {
    for (const label of Object.values(REGION_LABELS)) {
      assert.ok(label.length > 0);
      assert.doesNotMatch(label, /_/, 'labels are written for people, not identifiers');
    }
  });

  it('writes a box in degrees', () => {
    const text = regionLabel({ kind: 'bbox', west: 61.25, east: 64.45, south: 15.51, north: 19.25 });
    assert.match(text, /15\.51–19\.25° N/);
    assert.match(text, /61\.25–64\.45° E/);
  });
});

describe('dates', () => {
  it('collapses a range inside one month', () => {
    assert.equal(
      datesLabel({ start: '2024-01-01T00:00:00Z', end: '2024-01-09T23:59:59Z' }),
      '1–9 Jan 2024',
    );
  });

  it('keeps both months when they differ', () => {
    assert.equal(
      datesLabel({ start: '2024-01-28T00:00:00Z', end: '2024-02-03T23:59:59Z' }),
      '28 Jan – 3 Feb 2024',
    );
  });

  it('keeps both years when they differ', () => {
    assert.equal(
      datesLabel({ start: '2023-12-28T00:00:00Z', end: '2024-01-03T23:59:59Z' }),
      '28 Dec 2023 – 3 Jan 2024',
    );
  });

  it('writes a single day once', () => {
    assert.equal(
      datesLabel({ start: '2024-01-05T00:00:00Z', end: '2024-01-05T23:59:59Z' }),
      '5 Jan 2024',
    );
  });

  it('reads the UTC day from the text, so no local time zone can shift it', () => {
    // 2024-01-09T23:30Z is still the 9th in UTC even where the clock says the
    // 10th. Reading the characters avoids Date parsing entirely.
    assert.equal(
      datesLabel({ start: '2024-01-09T00:00:00Z', end: '2024-01-09T23:30:00Z' }),
      '9 Jan 2024',
    );
  });
});

describe('variables and depth', () => {
  it('names one or both variables', () => {
    assert.equal(variablesLabel(['temp']), 'Temperature');
    assert.equal(variablesLabel(['psal']), 'Salinity');
    assert.equal(variablesLabel(['temp', 'psal']), 'Temperature and salinity');
  });

  it('says so when nothing is selected', () => {
    assert.equal(variablesLabel([]), 'No variable');
  });

  it('distinguishes a range from an exact depth', () => {
    assert.equal(depthLabel({ mode: 'range', min_m: 0, max_m: 500 }), '0–500 m');
    assert.equal(depthLabel({ mode: 'at_depth', target_m: 100 }), 'at 100 m');
  });
});

describe('the compact summary', () => {
  it('describes the whole selection in four short parts', () => {
    assert.deepEqual(summarizeSelection(plan()), {
      region: 'Arabian Sea sample',
      dates: '1–9 Jan 2024',
      variables: 'Temperature',
      depth: '0–500 m',
    });
  });
});

describe('pending versus displayed', () => {
  it('reports nothing changed when the draft matches the shown plan', () => {
    assert.deepEqual(changedFields(plan(), plan()), []);
    assert.equal(selectionChanged(plan(), plan()), false);
  });

  it('names only the parts that differ', () => {
    const edited = plan({ variables: ['temp', 'psal'] });
    assert.deepEqual(changedFields(edited, plan()), ['variables']);
  });

  it('notices several changes at once', () => {
    const edited = plan({
      variables: ['psal'],
      depth: { mode: 'at_depth', target_m: 100 },
    });
    assert.deepEqual(changedFields(edited, plan()).sort(), ['depth', 'variables']);
  });

  it('claims no change when there is nothing to compare against', () => {
    // Before any run there is no displayed plan, so nothing is pending.
    assert.deepEqual(changedFields(plan(), null), []);
    assert.deepEqual(changedFields(null, plan()), []);
  });
});
