'use client';

/**
 * Small building blocks shared by the globe and the depth scene: orbit
 * controls that render on demand and remember the camera per result,
 * batched line geometry, instanced markers with picking, text sprites, and
 * a read-only probe for automated browser checks.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { Vec3 } from '@/lib/sceneGeometry.ts';

export interface CameraState {
  position: Vec3;
  target: Vec3;
}

// Camera positions per view, per executed result. Module-level, so a view
// that is unmounted and shown again for the same result keeps its camera.
const savedCameras = new Map<string, WeakMap<object, CameraState>>();

function memoryFor(store: string): WeakMap<object, CameraState> {
  let memory = savedCameras.get(store);
  if (!memory) {
    memory = new WeakMap();
    savedCameras.set(store, memory);
  }
  return memory;
}

/**
 * Orbit controls bound to the scene camera. The canvas redraws only when the
 * view changes. For a result the view has shown before, the remembered
 * camera is restored; otherwise `initial` is used. Ordinary selection and
 * time changes do not move the camera; `set` does, on an explicit action.
 */
export function useOrbitControls(options: {
  store: string;
  resultKey: object;
  initial: CameraState;
  enablePan: boolean;
  minDistance: number;
  maxDistance: number;
  /** Called with the camera's distance from the target after every view change. */
  onChange?: (distance: number) => void;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const controlsRef = useRef<OrbitControls | null>(null);
  const { store, resultKey, initial, enablePan, minDistance, maxDistance } = options;
  // The latest callback, without recreating the controls when it changes.
  const onChangeRef = useRef(options.onChange);
  useEffect(() => {
    onChangeRef.current = options.onChange;
  });

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enablePan = enablePan;
    controls.minDistance = minDistance;
    controls.maxDistance = maxDistance;
    controls.rotateSpeed = 0.6;
    controls.zoomSpeed = 0.9;
    const memory = memoryFor(store);
    const state = memory.get(resultKey) ?? initial;
    camera.position.set(...state.position);
    controls.target.set(...state.target);
    controls.update();
    const remember = () => {
      memory.set(resultKey, {
        position: camera.position.toArray() as Vec3,
        target: controls.target.toArray() as Vec3,
      });
      onChangeRef.current?.(camera.position.distanceTo(controls.target));
      invalidate();
    };
    remember();
    controls.addEventListener('change', remember);
    controlsRef.current = controls;
    return () => {
      controls.removeEventListener('change', remember);
      controls.dispose();
      controlsRef.current = null;
    };
    // `initial` only matters when a result is first shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, gl, invalidate, store, resultKey, enablePan, minDistance, maxDistance]);

  return {
    set(state: CameraState) {
      const controls = controlsRef.current;
      if (!controls) return;
      camera.position.set(...state.position);
      controls.target.set(...state.target);
      controls.update();
      memoryFor(store).set(resultKey, state);
      onChangeRef.current?.(camera.position.distanceTo(controls.target));
      invalidate();
    },
  };
}

/** Run `action` when `request` changes after mount (a button press counter). */
export function useRequest(request: number, action: () => void) {
  const handled = useRef(request);
  useEffect(() => {
    if (request !== handled.current) {
      handled.current = request;
      action();
    }
  });
}

/** One batched line-segment geometry. */
export function LineBuffer({ positions, color, opacity = 1 }: { positions: Float32Array; color: string; opacity?: number }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} />
    </lineSegments>
  );
}

/** One batched geometry of dashed line segments (dash sizes in scene units). */
export function DashedLineBuffer({
  positions,
  color,
  dashSize,
  gapSize,
  opacity = 1,
}: {
  positions: Float32Array;
  color: string;
  dashSize: number;
  gapSize: number;
  opacity?: number;
}) {
  const ref = useRef<THREE.LineSegments>(null);
  const invalidate = useThree((s) => s.invalidate);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  useLayoutEffect(() => {
    // Dashes need the distance along each segment.
    ref.current?.computeLineDistances();
    invalidate();
  }, [geometry, invalidate]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (positions.length === 0) return null;
  return (
    <lineSegments ref={ref} geometry={geometry}>
      <lineDashedMaterial color={color} dashSize={dashSize} gapSize={gapSize} transparent={opacity < 1} opacity={opacity} />
    </lineSegments>
  );
}

/**
 * Many markers drawn as one instanced mesh, with per-instance colours and
 * picking by instance index. A click that ends a drag does not pick.
 */
export function InstancedPoints({
  positions,
  colours,
  shape,
  size,
  opacity = 1,
  wireframe = false,
  onPick,
  onHover,
}: {
  positions: Float32Array;
  colours: string[] | string;
  shape: 'sphere' | 'octahedron';
  size: number;
  opacity?: number;
  wireframe?: boolean;
  onPick?: (index: number) => void;
  onHover?: (index: number | null) => void;
}) {
  const count = positions.length / 3;
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const colour = new THREE.Color();
    for (let i = 0; i < count; i++) {
      matrix.makeTranslation(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      mesh.setMatrixAt(i, matrix);
      if (Array.isArray(colours)) mesh.setColorAt(i, colour.set(colours[i]));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [positions, colours, count, invalidate]);

  if (count === 0) return null;
  return (
    <instancedMesh
      key={count}
      ref={ref}
      args={[undefined, undefined, count]}
      onClick={
        onPick
          ? (event) => {
              event.stopPropagation();
              if (event.delta <= 4 && event.instanceId !== undefined) onPick(event.instanceId);
            }
          : undefined
      }
      onPointerMove={
        onHover
          ? (event) => {
              event.stopPropagation();
              onHover(event.instanceId ?? null);
            }
          : undefined
      }
      onPointerOut={onHover ? () => onHover(null) : undefined}
    >
      {shape === 'sphere' ? <sphereGeometry args={[size, 12, 8]} /> : <octahedronGeometry args={[size, 0]} />}
      <meshBasicMaterial
        color={typeof colours === 'string' ? colours : '#ffffff'}
        transparent={opacity < 1}
        opacity={opacity}
        wireframe={wireframe}
      />
    </instancedMesh>
  );
}

/** A text label that always faces the camera. Dispose with `disposeObject`. */
export function textSprite(text: string, height: number, color = '#334155', align: 'left' | 'center' | 'right' = 'center') {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  const fontPx = 44;
  const font = `500 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  context.font = font;
  canvas.width = Math.ceil(context.measureText(text).width) + 12;
  canvas.height = fontPx + 14;
  context.font = font;
  context.fillStyle = color;
  context.textBaseline = 'middle';
  context.fillText(text, 6, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1);
  sprite.center.set(align === 'left' ? 0 : align === 'right' ? 1 : 0.5, 0.5);
  sprite.renderOrder = 10;
  return sprite;
}

/** Free the geometries, materials and textures under an object. */
export function disposeObject(root: THREE.Object3D) {
  root.traverse((node) => {
    const item = node as THREE.Mesh & { material?: THREE.Material | THREE.Material[] };
    item.geometry?.dispose();
    const materials = Array.isArray(item.material) ? item.material : item.material ? [item.material] : [];
    for (const material of materials) {
      (material as THREE.SpriteMaterial).map?.dispose();
      material.dispose();
    }
  });
}

export interface ProbePoint {
  id: string;
  position: Vec3;
  [key: string]: unknown;
}

declare global {
  interface Window {
    __floatchatScene?: Record<string, unknown>;
  }
}

/**
 * Read-only hooks for automated browser checks: the WebGL renderer, the
 * last frame's draw calls, the camera, and screen positions of the points
 * a view draws, so a test can click them with real pointer events.
 */
export function SceneProbe({ name, points, extra, isGlobe = false }: { name: string; points: () => ProbePoint[]; extra?: () => unknown; isGlobe?: boolean }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const registry = (window.__floatchatScene ??= {});
    registry[name] = {
      renderer: () => {
        const context = gl.getContext();
        const info = context.getExtension('WEBGL_debug_renderer_info');
        return {
          webgl2: gl.capabilities.isWebGL2,
          renderer: info ? context.getParameter(info.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER),
        };
      },
      calls: () => gl.info.render.calls,
      // Total frames rendered; unchanged while the view is idle or hidden.
      frames: () => gl.info.render.frame,
      camera: () => camera.position.toArray(),
      extra: () => extra?.(),
      points: () => {
        const rect = gl.domElement.getBoundingClientRect();
        const eye = camera.position;
        return points().map(({ position, ...rest }) => {
          const world = new THREE.Vector3(...position);
          const ndc = world.clone().project(camera);
          return {
            ...rest,
            x: rect.left + ((ndc.x + 1) / 2) * rect.width,
            y: rect.top + ((1 - ndc.y) / 2) * rect.height,
            onScreen: ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1,
            // For points on a globe: on the hemisphere facing the camera.
            facing: isGlobe ? world.dot(eye.clone().sub(world)) > 0 : true,
          };
        });
      },
    };
    return () => {
      delete registry[name];
    };
  });
  return null;
}
