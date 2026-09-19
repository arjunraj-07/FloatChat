'use client';

/**
 * Natural Earth 1:110m land outlines (public domain), redistributed by the
 * world-atlas package (ISC) and decoded with topojson-client. Shared by the
 * globe view and the cinematic introduction, and cached per radius so the
 * geometry is built once.
 */

import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import landTopology from 'world-atlas/land-110m.json';

import { outlineSegments } from '@/lib/sceneGeometry.ts';

const cache = new Map<number, Float32Array>();

export function coastlineSegments(radius: number): Float32Array {
  const cached = cache.get(radius);
  if (cached) return cached;
  const topology = landTopology as unknown as Topology<{ land: GeometryCollection }>;
  const land = feature(topology, topology.objects.land);
  const segments = outlineSegments(land.features.map((f) => f.geometry), radius);
  cache.set(radius, segments);
  return segments;
}
