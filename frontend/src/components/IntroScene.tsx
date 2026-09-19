'use client';

/**
 * Cinematic introduction: a sticky WebGL scene carried by scroll across three
 * chapters - the ocean planet, the cached study region, and a schematic look
 * below the surface.
 *
 * It is an overlay with its own scroll container above the workspace, which
 * stays mounted underneath, so skipping or replaying the introduction costs no
 * map view, camera or query state.
 *
 * Honesty rules, as everywhere else: the globe uses the same Natural Earth
 * coastlines as the globe view (public domain); the markers are the real
 * cached profile positions once the overview has loaded, labelled as recorded
 * locations; the underwater sequence is explicitly schematic and is not a
 * measured trajectory. Ambient motion stops when the tab is hidden, when the
 * viewer pauses it and under reduced-motion preferences; the scroll
 * choreography itself lives in `lib/introProgress.ts`.
 */

import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import {
  type IntroChapter,
  ambientMotionEnabled,
  floatDescent,
  introCamera,
  introChapter,
  introProgress,
} from '@/lib/introProgress.ts';
import { type Box, boxSegments, graticuleSegments, latLonToSphere } from '@/lib/sceneGeometry.ts';
import { InstancedPoints, LineBuffer, SceneProbe } from './scene/sceneKit';
import { coastlineSegments } from './scene/coastlines';
import { ContextLossWatcher, SceneBoundary, useWebGLSupport } from './scene/webgl';

export interface IntroMarker {
  latitude: number;
  longitude: number;
}

interface Props {
  /** Real cached profile positions, once the overview has loaded. */
  markers: IntroMarker[];
  /** The cached search region, outlined in the second chapter. */
  searchRegion: Box | null;
  onSkip: () => void;
  onOpenAssistant: () => void;
}

const GLOBE_RADIUS = 1.16;
const COAST = coastlineSegments(GLOBE_RADIUS * 1.012);
const GRATICULE = graticuleSegments(30, GLOBE_RADIUS * 1.008);
/** Depths labelled on the schematic ruler, in metres. */
const RULER_DEPTHS = [0, 500, 1000, 1500, 2000];
// The planet gives way to the schematic scene as the story descends: any
// position near the view axis at a comfortable camera distance would sit
// inside the globe's radius and be hidden by it, so the two never share a
// frame. This is the chapter cut between "a study region" and "below the
// surface".
const UNDERWATER_FROM = 0.72;
const UNDERWATER_Z = 0.6;
const SURFACE_Y = 0.35;
const RULER_TOP_Y = 0.28;
const RULER_SPAN_Y = 0.55;
const DESCENT_Y = 0.6;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function Story({
  progressRef,
  ambientRef,
  invalidateRef,
  markers,
  searchRegion,
  onLost,
}: {
  progressRef: { current: number };
  ambientRef: { current: boolean };
  invalidateRef: { current: (() => void) | null };
  markers: IntroMarker[];
  searchRegion: Box | null;
  onLost: () => void;
}) {
  const globe = useRef<THREE.Group>(null);
  const floatBody = useRef<THREE.Group>(null);
  const region = useRef<THREE.Group>(null);
  const underwater = useRef<THREE.Group>(null);
  const { camera, invalidate } = useThree();
  const target = useRef(new THREE.Vector3());
  const lookAt = useRef(new THREE.Vector3());

  // Let the scroll handler outside the canvas ask for a frame.
  useEffect(() => {
    invalidateRef.current = invalidate;
    return () => {
      invalidateRef.current = null;
    };
  }, [invalidate, invalidateRef]);

  const markerPositions = new Float32Array(
    markers.slice(0, 60).flatMap((m) => latLonToSphere(m.latitude, m.longitude, GLOBE_RADIUS * 1.03)),
  );
  const outline = searchRegion ? boxSegments(searchRegion, GLOBE_RADIUS * 1.02) : null;

  useFrame(({ clock }) => {
    const progress = progressRef.current;
    const ambient = ambientRef.current;
    if (globe.current) {
      globe.current.rotation.y = (ambient ? clock.getElapsedTime() * 0.018 : 0) + progress * 0.55;
    }
    const frame = introCamera(progress);
    target.current.set(...frame.position);
    camera.position.lerp(target.current, 0.06);
    lookAt.current.set(...frame.lookAt);
    camera.lookAt(lookAt.current);

    if (region.current) region.current.visible = progress > 0.18;
    const descent = floatDescent(progress);
    // The planet and the underwater scene never share a frame.
    if (globe.current) globe.current.visible = progress < UNDERWATER_FROM;
    if (underwater.current) underwater.current.visible = progress >= UNDERWATER_FROM;
    if (floatBody.current) {
      const bob = ambient ? Math.sin(clock.getElapsedTime() * 1.4) * 0.03 : 0;
      floatBody.current.position.y = SURFACE_Y - descent * DESCENT_Y + bob;
    }

    // Keep drawing while motion runs or the camera is still catching up; once
    // both settle the canvas goes idle, so a hidden or paused scene costs
    // nothing.
    if (ambient || camera.position.distanceTo(target.current) > 0.0008) invalidate();
  });

  return (
    <>
      <color attach="background" args={['#071c24']} />
      <ambientLight intensity={0.52} />
      <directionalLight position={[3, 2, 4]} intensity={1.35} color="#ddebe4" />
      <pointLight position={[-2, -1, 1]} intensity={0.7} color="#4baba1" />

      <group ref={globe} rotation={[0.08, -0.35, 0]}>
        <mesh>
          <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
          <meshStandardMaterial color="#123f4a" roughness={0.72} metalness={0.04} />
        </mesh>
        <LineBuffer positions={GRATICULE} color="#2d6b70" opacity={0.5} />
        <LineBuffer positions={COAST} color="#8eb8ac" opacity={0.75} />
        <group ref={region} visible={false}>
          {outline && <LineBuffer positions={outline} color="#d1846c" />}
          <InstancedPoints positions={markerPositions} colours="#77b7aa" shape="sphere" size={0.015} />
        </group>
      </group>

      <group ref={underwater} visible={false}>
        {/* Scaled to sit in the frame rather than fill it. */}
        <group ref={floatBody} position={[0.42, SURFACE_Y, UNDERWATER_Z]} scale={0.55}>
          <mesh>
            <cylinderGeometry args={[0.075, 0.075, 0.36, 16]} />
            <meshStandardMaterial color="#d1846c" roughness={0.44} />
          </mesh>
          <mesh position={[0, 0.22, 0]}>
            <sphereGeometry args={[0.1, 16, 12]} />
            <meshStandardMaterial color="#edf1eb" roughness={0.6} />
          </mesh>
          <mesh position={[0, -0.22, 0]}>
            <coneGeometry args={[0.13, 0.18, 12]} />
            <meshStandardMaterial color="#77b7aa" roughness={0.55} />
          </mesh>
        </group>
        {/* A schematic depth ruler: evenly spaced marks, not a data axis. */}
        <LineBuffer
          positions={new Float32Array([-0.12, RULER_TOP_Y, UNDERWATER_Z, -0.12, RULER_TOP_Y - RULER_SPAN_Y, UNDERWATER_Z])}
          color="#a7bec1"
          opacity={0.65}
        />
        <LineBuffer
          positions={
            new Float32Array(
              RULER_DEPTHS.flatMap((depth) => {
                const y = RULER_TOP_Y - (depth / 2000) * RULER_SPAN_Y;
                return [-0.18, y, UNDERWATER_Z, -0.06, y, UNDERWATER_Z];
              }),
            )
          }
          color="#a7bec1"
          opacity={0.5}
        />
      </group>
      <ContextLossWatcher onLost={onLost} />
      <SceneProbe
        name="intro"
        points={() => []}
        extra={() => ({ progress: progressRef.current, ambient: ambientRef.current })}
      />
    </>
  );
}

export default function IntroScene({ markers, searchRegion, onSkip, onOpenAssistant }: Props) {
  const support = useWebGLSupport();
  const reducedMotion = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [chapter, setChapter] = useState<IntroChapter>('planet');
  const [failure, setFailure] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);
  const ambientRef = useRef(true);
  const invalidateRef = useRef<(() => void) | null>(null);

  // Ambient motion just started or stopped: record it for the render loop and
  // ask for one more frame, which either resumes drawing or draws the last
  // settled one.
  useEffect(() => {
    ambientRef.current = ambientMotionEnabled({ hidden, reducedMotion, paused });
    invalidateRef.current?.();
  }, [hidden, reducedMotion, paused]);

  // Progress comes from the overlay's own scroll container, so the workspace
  // underneath keeps its scroll positions.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const onScroll = () => {
      progressRef.current = introProgress(element.scrollTop, element.clientHeight);
      setChapter(introChapter(progressRef.current));
      invalidateRef.current?.();
    };
    onScroll();
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden');
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const copyClass = (id: IntroChapter) => `intro-copy${chapter === id ? '' : ' is-hidden'}`;
  const sceneReady = support.ok && !failure;

  return (
    <div
      ref={scroller}
      data-testid="intro"
      role="dialog"
      aria-modal="true"
      aria-label="FloatChat introduction"
      className="intro-page"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onSkip();
      }}
    >
      <button type="button" data-testid="skip-intro" className="skip-intro" onClick={onSkip}>
        Skip introduction <span aria-hidden>→</span>
      </button>

      <section className="intro-story">
        <div className="intro-stage">
          {sceneReady ? (
            <SceneBoundary
              fallback={(reason) => (
                <div data-testid="intro-fallback" className="intro-fallback">
                  <p>The introductory scene could not run ({reason}). Everything it shows is available in the workspace.</p>
                </div>
              )}
            >
              <Canvas
                frameloop="demand"
                dpr={[1, 1.5]}
                camera={{ fov: 37, near: 0.1, far: 100, position: [0.05, 0.08, 3.65] }}
                gl={{ antialias: true }}
                aria-label="Introductory ocean scene"
              >
                <Story
                  progressRef={progressRef}
                  ambientRef={ambientRef}
                  invalidateRef={invalidateRef}
                  markers={markers}
                  searchRegion={searchRegion}
                  onLost={() => setFailure('the WebGL context was lost')}
                />
              </Canvas>
            </SceneBoundary>
          ) : (
            <div data-testid="intro-fallback" className="intro-fallback">
              <p>
                The introductory scene needs WebGL, which this browser did not provide
                {failure ?? support.reason ? ` (${failure ?? support.reason})` : ''}. It is decorative: the maps,
                profiles and measurements are all in the workspace.
              </p>
            </div>
          )}

          <div className="intro-meta">
            <span>FloatChat / Argo profile explorer</span>
            <span>Illustrative scene · measurements live in Map Explorer</span>
          </div>
          <div className="intro-progress" aria-hidden>
            <span className={chapter === 'planet' ? 'is-active' : ''} />
            <span className={chapter === 'region' ? 'is-active' : ''} />
            <span className={chapter === 'depth' ? 'is-active' : ''} />
          </div>
        </div>

        <div className={copyClass('planet')} data-testid="intro-chapter-planet">
          <span className="intro-index">01 / The ocean planet</span>
          <h1>Explore the ocean beneath the surface.</h1>
          <p>
            Ask a question in words or set the filters yourself, then read real Argo temperature and salinity profiles
            through depth and time.
          </p>
          <div>
            <button type="button" data-testid="intro-open-explorer" className="intro-primary" onClick={onSkip}>
              Open Map Explorer <span aria-hidden>↗</span>
            </button>
          </div>
          <span className="intro-scroll-cue">
            Scroll to descend <span className="scroll-line" />
          </span>
        </div>

        <div className={copyClass('region')} data-testid="intro-chapter-region">
          <span className="intro-index">02 / A study region</span>
          <h2>Start with a place.</h2>
          <p>
            The cached dataset was extracted for one Arabian Sea region. The outline is that search region; the points
            are the recorded profile locations inside it.
          </p>
          <span className="intro-note">Profiles were recorded only at those points, not across the whole region</span>
        </div>

        <div className={copyClass('depth')} data-testid="intro-chapter-depth">
          <span className="intro-index">03 / Below the surface</span>
          <h2>Follow a float downward.</h2>
          <p>
            A float drifts, dives and reports measurements at many depths. Each dive becomes one profile you can
            inspect, compare and step through in time.
          </p>
          <span className="intro-note">Schematic sequence · not a measured trajectory</span>
        </div>

        <div className="intro-end">
          <span className="intro-index">Ready when you are</span>
          <h2>Read the ocean with evidence.</h2>
          <div>
            <button type="button" className="intro-primary" onClick={onSkip}>
              Open Map Explorer <span aria-hidden>↗</span>
            </button>
            <button type="button" className="intro-secondary" onClick={onOpenAssistant}>
              Ask the AI Assistant <span aria-hidden>↗</span>
            </button>
          </div>
        </div>
      </section>

      <div className="intro-controls">
        <button type="button" data-testid="intro-motion" aria-pressed={paused} onClick={() => setPaused((v) => !v)}>
          {paused ? 'Resume motion' : 'Pause motion'}
        </button>
        <span data-testid="intro-motion-state">
          {reducedMotion
            ? 'Reduced motion: ambient motion off'
            : paused
              ? 'Ambient motion paused'
              : 'Ambient motion on'}
        </span>
      </div>
    </div>
  );
}
