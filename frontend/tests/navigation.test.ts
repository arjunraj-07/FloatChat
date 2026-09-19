/**
 * Section navigation and the toolbar summary. Pure functions only; no service
 * is called.
 *
 * The assistant's five-stage workflow was tested here. The conversation
 * replaced it, so those tests went with the machine they described rather
 * than staying green over code no screen renders. The reducer behaviour they
 * also touched - a proposal going stale after later edits - is still covered
 * in `nlDrafting.test.ts`, and the conversation's own ordering rules are in
 * `chat.test.ts`.
 *
 *     npm run test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_SECTION, SECTIONS, pausesPlayback } from '../src/lib/navigation.ts';
import { createDefaultForm, formToPlan, summarizePlan } from '../src/lib/draftPlan.ts';

describe('sections', () => {
  it('names the four workspaces in order, with Explore first and default', () => {
    assert.deepEqual(SECTIONS.map((s) => s.label), ['Explore', 'AI Assistant', 'Compare', 'About']);
    // Labels are written for people; the ids behind them stay stable, which is
    // what makes renaming a section safe for state, focus and test ids.
    assert.deepEqual(SECTIONS.map((s) => s.id), ['map', 'assistant', 'compare', 'about']);
    assert.equal(DEFAULT_SECTION, 'map');
  });

  it('pauses playback only when leaving Explore', () => {
    assert.equal(pausesPlayback('map', 'compare'), true);
    assert.equal(pausesPlayback('map', 'about'), true);
    assert.equal(pausesPlayback('map', 'map'), false);
    assert.equal(pausesPlayback('compare', 'map'), false);
    assert.equal(pausesPlayback('assistant', 'about'), false);
  });
});

describe('toolbar summary', () => {
  it('fits the draft on one short line', () => {
    const summary = summarizePlan(formToPlan(createDefaultForm()).plan!);
    assert.equal(summary, 'Temperature · argo cached subset · 2024-01-01 → 2024-01-10 · 0–500 m');
  });

  it('names an exact depth and a box', () => {
    const plan = formToPlan({
      ...createDefaultForm(),
      regionKind: 'bbox',
      variables: ['temp', 'psal'],
      depthMode: 'at_depth',
      depthTarget: '100',
    }).plan!;
    assert.equal(summarizePlan(plan), 'Temperature, salinity · 15–20° N, 60–65° E · 2024-01-01 → 2024-01-10 · at 100 m');
  });
});
