/**
 * The time navigator over an executed result: timestamp steps and grouping,
 * the visible set, selection at a time, comparison handling, playback and
 * reset after a new execution. Fixtures only.
 *
 *     npm run test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { comparisonAtTime } from '../src/lib/explorerModel.ts';
import {
  activeAtTime,
  applyNavigator,
  formatStepTime,
  navigatorFor,
  profileAtStep,
  timeSteps,
  visibleThrough,
} from '../src/lib/timeNavigator.ts';

/** Deliberately out of order; two floats share one timestamp, written two ways. */
const PROFILES = [
  { profile_id: '6903060_485_A', time: '2024-01-05T04:46:30' },
  { profile_id: '6903060_483_A', time: '2024-01-01T00:50:30' },
  { profile_id: '2902390_316_A', time: '2024-01-07T06:55:20Z' },
  { profile_id: '6990514_32_A', time: '2024-01-07T06:55:20' },
  { profile_id: '2902201_287_A', time: '2024-01-05T12:13:51' },
];
const ids = (profiles: { profile_id: string }[]) => profiles.map((p) => p.profile_id);
const { steps } = timeSteps(PROFILES);

describe('time steps', () => {
  it('has one step per distinct observation time, earliest first', () => {
    assert.deepEqual(steps.map((s) => formatStepTime(s.instant)), [
      '2024-01-01 00:50:30 UTC',
      '2024-01-05 04:46:30 UTC',
      '2024-01-05 12:13:51 UTC',
      '2024-01-07 06:55:20 UTC',
    ]);
  });

  it('groups profiles sharing a timestamp into one step, ordered by profile id', () => {
    assert.deepEqual(steps[3].profileIds, ['2902390_316_A', '6990514_32_A']);
    assert.equal(profileAtStep(steps[3]), '2902390_316_A');
  });

  it('invents no steps between observations', () => {
    assert.equal(steps.length, new Set(PROFILES.map((p) => Date.parse(`${p.time.replace(/Z$/, '')}Z`))).size);
  });

  it('reports a profile without a readable time instead of placing it', () => {
    const result = timeSteps([...PROFILES, { profile_id: 'bad', time: 'not a time' }]);
    assert.deepEqual(result.untimed, ['bad']);
    assert.equal(result.steps.length, steps.length);
  });

  it('gives no steps for no profiles', () => {
    assert.deepEqual(timeSteps([]), { steps: [], untimed: [] });
  });
});

describe('visible profiles', () => {
  it('shows returned profiles observed on or before the selected step', () => {
    assert.deepEqual(ids(visibleThrough(PROFILES, steps, 0)), ['6903060_483_A']);
    assert.deepEqual(ids(visibleThrough(PROFILES, steps, 1)), ['6903060_485_A', '6903060_483_A']);
  });

  it('includes every profile at a shared final timestamp, and all profiles at the last step', () => {
    assert.equal(visibleThrough(PROFILES, steps, 3).length, PROFILES.length);
  });

  it('returns the same profile objects, unchanged, from the result only', () => {
    const visible = visibleThrough(PROFILES, steps, 2);
    for (const profile of visible) assert.ok(PROFILES.includes(profile));
  });

  it('keeps a visible selection and otherwise opens the profile at the step', () => {
    const visible = ids(visibleThrough(PROFILES, steps, 1));
    assert.equal(activeAtTime('6903060_483_A', visible, steps[1]), '6903060_483_A');
    assert.equal(activeAtTime('6990514_32_A', visible, steps[1]), '6903060_485_A');
    assert.equal(activeAtTime(null, [], null), null);
  });
});

describe('comparison at a time', () => {
  const resultIds = ids(PROFILES);
  const early = ids(visibleThrough(PROFILES, steps, 1));

  it('keeps selections that are still visible', () => {
    const view = comparisonAtTime({ a: '6903060_483_A', b: '6903060_485_A' }, resultIds, early, null);
    assert.deepEqual(view.selection, { a: '6903060_483_A', b: '6903060_485_A' });
    assert.deepEqual(view.hidden, []);
  });

  it('clears a selection observed after the selected time, without substituting another', () => {
    const view = comparisonAtTime({ a: '6903060_483_A', b: '6990514_32_A' }, resultIds, early, '6903060_485_A');
    assert.deepEqual(view.selection, { a: '6903060_483_A', b: null });
    assert.deepEqual(view.hidden, [{ side: 'b', profileId: '6990514_32_A' }]);
  });

  it('restores the selection once the time includes it again', () => {
    const view = comparisonAtTime({ a: '6903060_483_A', b: '6990514_32_A' }, resultIds, resultIds, null);
    assert.deepEqual(view.selection, { a: '6903060_483_A', b: '6990514_32_A' });
  });

  it('fills a never-chosen side only from visible profiles', () => {
    const view = comparisonAtTime({ a: null, b: null }, resultIds, early, '6903060_485_A');
    assert.deepEqual(view.selection, { a: '6903060_485_A', b: '6903060_483_A' });
  });

  it('never fills a side with the profile already chosen on the other', () => {
    const view = comparisonAtTime({ a: null, b: '6903060_485_A' }, resultIds, early, '6903060_485_A');
    assert.deepEqual(view.selection, { a: '6903060_483_A', b: '6903060_485_A' });
  });
});

describe('navigator state', () => {
  const count = steps.length;
  const first = { key: 'run-1', index: 1, playing: true };

  it('starts at the latest step with playback stopped', () => {
    assert.deepEqual(navigatorFor(null, 'run-1', count), { key: 'run-1', index: count - 1, playing: false });
  });

  it('resets to the latest step and stops playback after a new execution', () => {
    const reset = navigatorFor(first, 'run-2', count);
    assert.deepEqual(reset, { key: 'run-2', index: count - 1, playing: false });
    assert.equal(visibleThrough(PROFILES, steps, reset.index).length, PROFILES.length);
  });

  it('keeps its position for the same result, such as after a draft edit', () => {
    assert.deepEqual(navigatorFor(first, 'run-1', count), first);
  });

  it('steps within bounds and pauses on a manual move', () => {
    const at0 = { key: 'k', index: 0, playing: true };
    assert.deepEqual(applyNavigator(at0, { type: 'step', delta: -1 }, count), { key: 'k', index: 0, playing: false });
    assert.equal(applyNavigator(at0, { type: 'step', delta: 1 }, count).index, 1);
    assert.deepEqual(applyNavigator(at0, { type: 'go', index: 99 }, count), { key: 'k', index: count - 1, playing: false });
  });

  it('plays from the beginning when started at the final step', () => {
    assert.deepEqual(applyNavigator({ key: 'k', index: count - 1, playing: false }, { type: 'play' }, count), {
      key: 'k',
      index: 0,
      playing: true,
    });
  });

  it('advances one actual step per tick and stops at the end', () => {
    let state = applyNavigator({ key: 'k', index: 0, playing: false }, { type: 'play' }, count);
    const seen = [state.index];
    while (state.playing) {
      state = applyNavigator(state, { type: 'tick' }, count);
      seen.push(state.index);
    }
    assert.deepEqual(seen, [0, 1, 2, 3]);
    assert.equal(applyNavigator(state, { type: 'tick' }, count).index, count - 1);
  });

  it('cannot play with a single timestamp', () => {
    assert.deepEqual(applyNavigator({ key: 'k', index: 0, playing: false }, { type: 'play' }, 1), {
      key: 'k',
      index: 0,
      playing: false,
    });
  });

  it('pauses', () => {
    assert.equal(applyNavigator({ key: 'k', index: 1, playing: true }, { type: 'pause' }, count).playing, false);
  });
});
