/**
 * Scroll choreography for the cinematic introduction.
 *
 * Pure functions, so the chapter boundaries, clamping and motion rules are
 * testable without a browser. Progress runs 0 → 1 across the scroll story and
 * reverses with the scroll; each chapter is a range of that progress.
 */

/** Scroll distance of the story, in viewport heights. */
export const STORY_VIEWPORTS = 2.05;

export type IntroChapter = 'planet' | 'region' | 'depth';

/** Progress through the story for a scroll position, clamped to 0…1. */
export function introProgress(scrollY: number, viewportHeight: number): number {
  const span = Math.max(1, viewportHeight * STORY_VIEWPORTS);
  if (!Number.isFinite(scrollY) || scrollY <= 0) return 0;
  return Math.min(1, scrollY / span);
}

export function introChapter(progress: number): IntroChapter {
  if (progress < 0.34) return 'planet';
  if (progress < 0.69) return 'region';
  return 'depth';
}

/** Camera position and look-at target for the story's progress. */
export function introCamera(progress: number): { position: [number, number, number]; lookAt: [number, number, number] } {
  const approach = Math.min(1, Math.max(0, (progress - 0.2) * 1.65));
  const descent = Math.min(1, Math.max(0, (progress - 0.68) * 3.1));
  return {
    position: [0.05 + approach * 0.24, 0.08 - descent * 0.16, 3.65 - approach * 1.55 - descent * 0.4],
    // The view follows the descending float, so it stays in frame.
    lookAt: [0.02, -descent * 0.3, 0],
  };
}

/**
 * How far the schematic float has descended (0…1). It starts at the last
 * chapter and reaches the bottom exactly at the end of the story.
 */
const DESCENT_FROM = 0.7;

export function floatDescent(progress: number): number {
  return Math.min(1, Math.max(0, (progress - DESCENT_FROM) / (1 - DESCENT_FROM)));
}

/**
 * Whether ambient motion should run. It stops when the tab is hidden, when
 * the viewer asks for reduced motion, and when they pause it by hand.
 */
export function ambientMotionEnabled(state: { hidden: boolean; reducedMotion: boolean; paused: boolean }): boolean {
  return !state.hidden && !state.reducedMotion && !state.paused;
}
