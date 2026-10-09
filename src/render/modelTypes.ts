import type * as THREE from 'three';

/**
 * Material slots used by procedural models. The renderer owns the actual materials:
 *  - std:     opaque, vertex-coloured, matte (roughness ~0.8)
 *  - metal:   vertex-coloured metal (roughness ~0.35, metalness ~0.8)
 *  - glass:   windows; dark reflective by day, warm glow at night
 *  - glow:    light bulbs / lamp heads; bright emissive at night
 *  - foliage: leaves; vertex-coloured, sways in the wind, tinted by season
 *  - cloth:   waving flags only (displacement grows with local +X distance from the pole)
 *  - water:   translucent animated water (fountains, moats)
 */
export type MatKey = 'std' | 'metal' | 'glass' | 'glow' | 'foliage' | 'cloth' | 'water';

export interface ModelPart {
  /** Non-indexed BufferGeometry with `position`, `normal` and `color` (linear RGB) attributes. */
  geometry: THREE.BufferGeometry;
  mat: MatKey;
  /** When true the renderer multiplies this part by a per-instance colour (e.g. car paint). */
  tint?: boolean;
}

export interface ModelData {
  parts: ModelPart[];
  /** Approximate overall height in metres. */
  height: number;
}
