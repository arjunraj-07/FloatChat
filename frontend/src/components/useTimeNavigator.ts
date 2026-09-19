'use client';

/**
 * Time-navigator state for the displayed executed result.
 *
 * Wraps the pure logic in `timeNavigator.ts` with the two side effects it
 * needs: the playback timer and pausing when the tab is hidden. Both are
 * cleaned up on unmount. The only thing this touches outside itself is the
 * selected profile; the query draft and session are never involved.
 */

import { useEffect, useState } from 'react';

import type { ExecutedProfile, PlanExecutionResponse } from '@/lib/planContract.ts';
import {
  type NavigatorAction,
  type NavigatorState,
  applyNavigator,
  navigatorFor,
  profileAtStep,
  timeSteps,
  visibleThrough,
} from '@/lib/timeNavigator.ts';

/** Fixed pause between steps. Equal pauses do not represent equal elapsed time. */
export const PLAYBACK_STEP_MS = 1200;

const NO_PROFILES: ExecutedProfile[] = [];

export function useTimeNavigator(
  response: PlanExecutionResponse | null,
  onSelectProfile: (profileId: string) => void,
) {
  const profiles = response?.executed && response.results ? response.results.profiles : NO_PROFILES;
  const { steps, untimed } = timeSteps(profiles);
  const count = steps.length;
  const [stored, setStored] = useState<NavigatorState | null>(null);
  const nav = navigatorFor(stored, response, count);

  /**
   * Apply a navigator action. A time step opens a profile observed at that
   * time, unless `select` is false - used by "View all returned times", which
   * only widens the view and leaves the open profile as it is.
   */
  const command = (action: NavigatorAction, options: { select?: boolean } = {}) => {
    const next = applyNavigator(nav, action, count);
    setStored(next);
    if (options.select !== false && next.index !== nav.index && steps[next.index]) {
      onSelectProfile(profileAtStep(steps[next.index]));
    }
  };

  // Playback advances one actual step per interval and stops at the last.
  const upcoming = nav.playing && steps[nav.index + 1] ? profileAtStep(steps[nav.index + 1]) : null;
  useEffect(() => {
    if (!nav.playing) return;
    const timer = window.setTimeout(() => {
      setStored(applyNavigator({ key: response, index: nav.index, playing: true }, { type: 'tick' }, count));
      if (upcoming) onSelectProfile(upcoming);
    }, PLAYBACK_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [nav.playing, nav.index, count, response, upcoming, onSelectProfile]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        setStored((previous) => (previous ? { ...previous, playing: false } : previous));
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return {
    steps,
    untimed,
    index: nav.index,
    playing: nav.playing,
    step: steps[nav.index] ?? null,
    visible: visibleThrough(profiles, steps, nav.index),
    total: profiles.length,
    command,
  };
}

export type TimeNavigatorView = ReturnType<typeof useTimeNavigator>;
