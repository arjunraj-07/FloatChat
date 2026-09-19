/**
 * Scroll choreography of the cinematic introduction. Pure logic only.
 *
 *     npm run test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  STORY_VIEWPORTS,
  ambientMotionEnabled,
  floatDescent,
  introCamera,
  introChapter,
  introProgress,
} from '../src/lib/introProgress.ts';

describe('intro scroll progress', () => {
  it('runs from 0 at the top to 1 at the end of the story, clamped both ways', () => {
    assert.equal(introProgress(0, 800), 0);
    assert.equal(introProgress(-200, 800), 0);
    assert.equal(introProgress(800 * STORY_VIEWPORTS, 800), 1);
    assert.equal(introProgress(99999, 800), 1);
  });

  it('reverses with the scroll position', () => {
    const down = introProgress(900, 800);
    const back = introProgress(400, 800);
    assert.ok(back < down);
    assert.equal(introProgress(900, 800), down);
  });

  it('survives a zero-height viewport', () => {
    assert.ok(Number.isFinite(introProgress(500, 0)));
  });
});

describe('intro chapters', () => {
  it('moves planet → region → depth as the story advances', () => {
    assert.equal(introChapter(0), 'planet');
    assert.equal(introChapter(0.33), 'planet');
    assert.equal(introChapter(0.34), 'region');
    assert.equal(introChapter(0.68), 'region');
    assert.equal(introChapter(0.69), 'depth');
    assert.equal(introChapter(1), 'depth');
  });

  it('draws the camera in and down as the chapters change', () => {
    const planet = introCamera(0);
    const region = introCamera(0.5);
    const depth = introCamera(1);
    assert.ok(region.position[2] < planet.position[2], 'approaches the region');
    assert.ok(depth.position[2] < region.position[2], 'continues below the surface');
    assert.ok(depth.lookAt[1] < planet.lookAt[1], 'looks downward at the end');
  });

  it('keeps the schematic float at the surface until the last chapter', () => {
    assert.equal(floatDescent(0.5), 0);
    assert.equal(floatDescent(0.7), 0);
    assert.ok(floatDescent(0.85) > 0);
    assert.equal(floatDescent(1), 1);
  });
});

describe('ambient motion', () => {
  it('runs only when visible, not paused and motion is allowed', () => {
    assert.equal(ambientMotionEnabled({ hidden: false, reducedMotion: false, paused: false }), true);
    assert.equal(ambientMotionEnabled({ hidden: true, reducedMotion: false, paused: false }), false);
    assert.equal(ambientMotionEnabled({ hidden: false, reducedMotion: true, paused: false }), false);
    assert.equal(ambientMotionEnabled({ hidden: false, reducedMotion: false, paused: true }), false);
  });
});
