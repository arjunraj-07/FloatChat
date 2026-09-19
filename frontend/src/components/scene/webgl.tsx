'use client';

/**
 * WebGL availability and failure handling for the 3D views. When WebGL is
 * missing, fails to start, throws while rendering or loses its context, the
 * view is replaced by a message and a way back to the 2D regional map.
 */

import { Component, type ReactNode, useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';

/** Whether this browser can create a WebGL context, checked once. */
export function useWebGLSupport(): { ok: boolean; reason: string } {
  const [state] = useState(() => {
    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!context) return { ok: false, reason: 'the browser did not provide a WebGL context' };
      // Release the probe context straight away.
      context.getExtension('WEBGL_lose_context')?.loseContext();
      return { ok: true, reason: '' };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  });
  return state;
}

export function SceneFallback({ reason, onUseMap }: { reason: string; onUseMap: () => void }) {
  return (
    <div data-testid="webgl-fallback" role="alert" className="absolute inset-0 flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-sm space-y-2 text-center text-sm text-slate-700">
        <p className="font-semibold text-slate-900">The 3D view is unavailable</p>
        <p>This browser could not start WebGL ({reason}). The regional map shows the same profiles and times.</p>
        <button
          type="button"
          data-testid="webgl-use-map"
          onClick={onUseMap}
          className="rounded-md bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800"
        >
          Use the regional map
        </button>
      </div>
    </div>
  );
}

/** Catches errors thrown while creating or rendering a 3D view. */
export class SceneBoundary extends Component<
  { fallback: (reason: string) => ReactNode; children: ReactNode },
  { reason: string | null }
> {
  state = { reason: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { reason: error instanceof Error ? error.message : String(error) };
  }

  render() {
    return this.state.reason ? this.props.fallback(this.state.reason) : this.props.children;
  }
}

/** Reports a lost WebGL context, so the view can fall back. */
export function ContextLossWatcher({ onLost }: { onLost: () => void }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const canvas = gl.domElement;
    const handle = (event: Event) => {
      event.preventDefault();
      onLost();
    };
    canvas.addEventListener('webglcontextlost', handle);
    return () => canvas.removeEventListener('webglcontextlost', handle);
  }, [gl, onLost]);
  return null;
}
