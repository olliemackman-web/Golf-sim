// Collects light sources (lamps, floodlights, lit buildings) and feeds the terrain's night-time light pools.
import * as THREE from 'three';
import { ROAD_ROW, TILE, WORLD } from '../core/constants';
import { ITEMS } from '../data/items';
import type { World } from '../world/World';
import { terrainUniforms } from './TerrainRenderer';

export class LightPools {
  private dirty = true;
  private lights: { x: number; z: number; r: number; i: number }[] = [];

  constructor(private world: World) {
    const mark = () => (this.dirty = true);
    world.on('objectAdded', mark);
    world.on('objectRemoved', mark);
    world.on('objectChanged', mark);
  }

  private rebuild(): void {
    const w = this.world;
    const L: { x: number; z: number; r: number; i: number }[] = [];
    for (const o of w.objects.values()) {
      const def = ITEMS[o.type];
      const c = w.objectCenter(o);
      if (def.kind === 'lamp') L.push({ x: c.x, z: c.z, r: 9, i: 0.9 });
      else if (def.kind === 'floodlight') {
        const f = w.objectFront(o);
        L.push({ x: c.x - f.x * 22, z: c.z - f.z * 22, r: 42, i: 0.75 });
      } else if (def.kind === 'carpark') {
        const a = w.localToWorld(o, -9, 0), b = w.localToWorld(o, 9, 0);
        L.push({ x: a.x, z: a.z, r: 11, i: 0.6 }, { x: b.x, z: b.z, r: 11, i: 0.6 });
      } else if (def.enterable && def.cat === 'buildings' || def.kind === 'sign') {
        const f = w.objectFront(o);
        const depth = (def.h * TILE) / 2;
        L.push({ x: c.x + f.x * (depth + 2), z: c.z + f.z * (depth + 2), r: 7 + def.w * 1.2, i: 0.55 });
      }
    }
    // street lamps along the road (matches Surroundings)
    for (let x = 0; x <= WORLD; x += 48) L.push({ x, z: ROAD_ROW * TILE + 3, r: 12, i: 0.5 });
    this.lights = L;
  }

  update(camPos: THREE.Vector3, night: number): void {
    terrainUniforms.uNightLight.value = night;
    if (night < 0.01) return;
    if (this.dirty) {
      this.dirty = false;
      this.rebuild();
    }
    // nearest lights to the camera fill the fixed uniform array
    const sorted = this.lights
      .map((l) => ({ l, d: (l.x - camPos.x) ** 2 + (l.z - camPos.z) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 48);
    const arr = terrainUniforms.uLights.value;
    sorted.forEach((s, i) => arr[i].set(s.l.x, s.l.z, s.l.r, s.l.i));
    terrainUniforms.uLightCount.value = sorted.length;
  }
}
