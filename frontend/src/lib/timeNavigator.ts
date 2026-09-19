/**
 * Time navigation over one executed result.
 *
 * Display state only. The steps are the distinct observation timestamps of
 * the profiles the executed query returned - never retrieval dates or query
 * execution times - and profiles sharing a timestamp form one step. Nothing
 * is interpolated between steps and no daily samples are invented. The
 * visible set is a filter over the returned profiles: those observed on or
 * before the selected step. Moving through time never edits the draft, calls
 * the model or runs a query.
 */

import type { ExecutedProfile } from './planContract.ts';
import { utcDate } from './explorerModel.ts';

type Timed = Pick<ExecutedProfile, 'profile_id' | 'time'>;

export interface TimeStep {
  /** Observation instant, epoch milliseconds (UTC). */
  instant: number;
  /** Profiles observed at exactly this instant, ordered by profile id. */
  profileIds: string[];
}

export interface TimeSteps {
  steps: TimeStep[];
  /** Returned profiles whose timestamp cannot be read. They are never shown
   * by the navigator, and are reported rather than placed at a guessed time. */
  untimed: string[];
}

const byId = (a: string, b: string) => a.localeCompare(b);

/** One step per distinct observation timestamp, earliest first. */
export function timeSteps(profiles: Timed[]): TimeSteps {
  const groups = new Map<number, string[]>();
  const untimed: string[] = [];
  for (const profile of profiles) {
    const instant = utcDate(profile.time).getTime();
    if (Number.isNaN(instant)) {
      untimed.push(profile.profile_id);
      continue;
    }
    const ids = groups.get(instant);
    if (ids) ids.push(profile.profile_id);
    else groups.set(instant, [profile.profile_id]);
  }
  const steps = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([instant, ids]) => ({ instant, profileIds: [...ids].sort(byId) }));
  return { steps, untimed: untimed.sort(byId) };
}

/** The profile a time step selects. Ties go to the first profile id. */
export function profileAtStep(step: TimeStep): string {
  return step.profileIds[0];
}

/** Returned profiles observed on or before step `index`, in their given order. */
export function visibleThrough<T extends Timed>(profiles: T[], steps: TimeStep[], index: number): T[] {
  const step = steps[index];
  if (!step) return [];
  return profiles.filter((profile) => {
    const instant = utcDate(profile.time).getTime();
    return !Number.isNaN(instant) && instant <= step.instant;
  });
}

/** "2024-01-05 04:46:30 UTC". Seconds are kept so neighbouring steps never share a label. */
export function formatStepTime(instant: number): string {
  return `${new Date(instant).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

/**
 * The open profile at the selected time: the user's choice while it is
 * visible, otherwise the profile the current step selects.
 */
export function activeAtTime(
  selectedId: string | null,
  visibleIds: string[],
  step: TimeStep | null,
): string | null {
  if (selectedId !== null && visibleIds.includes(selectedId)) return selectedId;
  return step ? profileAtStep(step) : null;
}

// ---------------------------------------------------------------------------
// Navigator state
// ---------------------------------------------------------------------------

export interface NavigatorState {
  /** The executed result this state belongs to, compared by identity. */
  key: unknown;
  index: number;
  playing: boolean;
}

export type NavigatorAction =
  | { type: 'go'; index: number }
  | { type: 'step'; delta: 1 | -1 }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'tick' };

/**
 * The navigator state that applies to the result `key`. A different result -
 * a new execution, even of the same plan - starts at its latest step, so
 * every returned profile is visible, with playback stopped.
 */
export function navigatorFor(state: NavigatorState | null, key: unknown, count: number): NavigatorState {
  const latest = Math.max(0, count - 1);
  if (!state || state.key !== key) return { key, index: latest, playing: false };
  const index = Math.min(Math.max(0, state.index), latest);
  return { key, index, playing: state.playing && index < latest };
}

/** The next navigator state. Any manual move pauses playback. */
export function applyNavigator(state: NavigatorState, action: NavigatorAction, count: number): NavigatorState {
  const last = Math.max(0, count - 1);
  const clamp = (index: number) => Math.min(Math.max(0, index), last);
  switch (action.type) {
    case 'go':
      return { ...state, index: clamp(action.index), playing: false };
    case 'step':
      return { ...state, index: clamp(state.index + action.delta), playing: false };
    case 'play':
      if (count < 2) return { ...state, playing: false };
      // From the final step, playback starts again at the beginning.
      return { ...state, index: state.index >= last ? 0 : state.index, playing: true };
    case 'pause':
      return { ...state, playing: false };
    case 'tick': {
      if (!state.playing) return state;
      const index = clamp(state.index + 1);
      return { ...state, index, playing: index < last };
    }
  }
}
