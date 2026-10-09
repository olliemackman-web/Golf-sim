// Countryside beyond the map, distant hills, the road, and the property fence.
import * as THREE from 'three';
import { MAP, ROAD_ROW, TILE, WORLD } from '../core/constants';
import { RNG, Simplex2 } from '../core/rng';
import type { World } from '../world/World';
import { InstancedModel } from './ObjectRenderer';

export class Surroundings {
  group = new THREE.Group();
  private fence: InstancedModel;
  private noise: Simplex2;

  constructor(private world: World) {
    this.noise = new Simplex2(world.seed + 77);
    this.buildOuter();
    this.buildMountains();
    this.buildForest();
    this.buildRoadside();
    this.fence = new InstancedModel('fence', this.group, 256, true);
    this.updateFence();
    world.on('owned', () => this.updateFence());
    world.on('height', () => this.updateFence());
  }

  private outerHeight(x: number, z: number): number {
    // distance outside the map
    const dx = Math.max(0, -x, x - WORLD);
    const dz = Math.max(0, -z, z - WORLD);
    const d = Math.hypot(dx, dz);
    const cx = Math.max(0, Math.min(WORLD - 0.01, x));
    const cz = Math.max(0, Math.min(WORLD - 0.01, z));
    const edge = this.world.heightAt(cx, cz);
    const n = this.noise.fbm(x / 400, z / 400, 4);
    const far = 6 + n * 30 + Math.max(0, d - 200) * 0.06 + this.noise.fbm(x / 120, z / 120, 3) * 6;
    const t = Math.min(1, d / 160);
    let h = edge * (1 - t) + far * t * t * (3 - 2 * t) + edge * 0;
    // keep the road flat where it leaves the map
    const roadZ = (ROAD_ROW + 1.5) * TILE;
    const rd = Math.abs(z - roadZ);
    if (rd < 20 && (x < 0 || x > WORLD)) {
      const k = Math.max(0, 1 - Math.max(0, rd - 7) / 13);
      h = h * (1 - k) + this.world.roadHeight() * k;
    }
    return h;
  }

  private buildOuter(): void {
    const ext = 1900;
    const seg = 150;
    const size = WORLD + ext * 2;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    g.translate(WORLD / 2, 0, WORLD / 2);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const roadZ = (ROAD_ROW + 1.5) * TILE;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const inside = x > 2 && x < WORLD - 2 && z > 2 && z < WORLD - 2;
      const h = inside ? this.world.heightAt(x, z) - 3 : this.outerHeight(x, z) - 0.05;
      pos.setY(i, h);
      const n = this.noise.fbm(x / 90, z / 90, 3);
      c.setRGB(0.18 + n * 0.05, 0.3 + n * 0.08, 0.1 + n * 0.03);
      // fields and hedgerow patchwork far out
      const field = this.noise.noise(Math.floor(x / 140) * 3.1, Math.floor(z / 140) * 2.7);
      const far = Math.hypot(Math.max(0, -x, x - WORLD), Math.max(0, -z, z - WORLD));
      if (far > 120 && field > 0.35) c.setRGB(0.42 + n * 0.05, 0.38, 0.16);
      else if (far > 120 && field < -0.45) c.setRGB(0.22, 0.36, 0.12);
      if (Math.abs(z - roadZ) < 6 && (x < 0 || x > WORLD)) c.setRGB(0.07, 0.075, 0.08);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildMountains(): void {
    const g = new THREE.BufferGeometry();
    const pos: number[] = [];
    const cols: number[] = [];
    const R = 2600, N = 160;
    const cx = WORLD / 2, cz = WORLD / 2;
    const ring = (r: number, hFn: (a: number) => number, color: THREE.Color) => {
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
        const h0 = hFn(a0), h1 = hFn(a1);
        const p = [
          [cx + Math.cos(a0) * r, -20, cz + Math.sin(a0) * r],
          [cx + Math.cos(a1) * r, -20, cz + Math.sin(a1) * r],
          [cx + Math.cos(a1) * r, h1, cz + Math.sin(a1) * r],
          [cx + Math.cos(a0) * r, h0, cz + Math.sin(a0) * r],
        ];
        for (const k of [0, 1, 2, 0, 2, 3]) {
          pos.push(...p[k]);
          const top = k === 2 || k === 3 ? 1 : 0;
          cols.push(color.r * (0.8 + top * 0.3), color.g * (0.8 + top * 0.3), color.b * (0.8 + top * 0.3));
        }
      }
    };
    ring(R, (a) => 140 + this.noise.fbm(Math.cos(a) * 3, Math.sin(a) * 3, 4) * 260 + Math.max(0, this.noise.noise(Math.cos(a) * 6, Math.sin(a) * 6)) * 160, new THREE.Color(0x4f6a7a));
    ring(R * 0.82, (a) => 60 + this.noise.fbm(Math.cos(a) * 4 + 9, Math.sin(a) * 4, 3) * 120, new THREE.Color(0x3d5a3a));
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    this.group.add(mesh);
  }

  private buildForest(): void {
    const rng = new RNG(this.world.seed + 5);
    const types = ['tree_pine', 'tree_oak', 'tree_birch', 'tree_pine', 'tree_oak'];
    const batches = new Map<string, InstancedModel>();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const UP = new THREE.Vector3(0, 1, 0);
    let id = 1;
    const roadZ = (ROAD_ROW + 1.5) * TILE;
    for (let k = 0; k < 9000 && id < 3200; k++) {
      const x = rng.range(-700, WORLD + 700);
      const z = rng.range(-700, WORLD + 500);
      const inside = x > -6 && x < WORLD + 6 && z > -6 && z < WORLD + 6;
      if (inside) continue;
      if (Math.abs(z - roadZ) < 14) continue;
      const d = Math.hypot(Math.max(0, -x, x - WORLD), Math.max(0, -z, z - WORLD));
      const dens = this.noise.fbm(x / 160, z / 160, 3) + 0.25 - d / 2000;
      if (dens < 0.05) continue;
      const near = d < 70;
      const type = rng.pick(types) + (near ? '' : '__lod');
      let b = batches.get(type);
      if (!b) {
        b = new InstancedModel(type, this.group, 512, near);
        batches.set(type, b);
      }
      q.setFromAxisAngle(UP, rng.range(0, 6.28));
      const s = rng.range(0.8, 1.3);
      m.compose(new THREE.Vector3(x, this.outerHeight(x, z) - 0.2, z), q, new THREE.Vector3(s, s, s));
      b.set(id++, m);
    }
  }

  private buildRoadside(): void {
    // street lamps along the road
    const b = new InstancedModel('streetlamp', this.group, 64, true);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    let id = 1;
    for (let x = -400; x <= WORLD + 400; x += 48) {
      const z = ROAD_ROW * TILE - 0.6;
      const y = x >= 0 && x <= WORLD ? this.world.heightAt(x, z) : this.outerHeight(x, z);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
      b.set(id++, m);
    }
  }

  updateFence(): void {
    const w = this.world;
    this.fence.clear();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const UP = new THREE.Vector3(0, 1, 0);
    let id = 1;
    const own = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP && y < MAP && w.isOwnedTile(x, y);
    for (let y = 0; y < ROAD_ROW; y++) {
      for (let x = 0; x < MAP; x++) {
        if (!own(x, y)) continue;
        const edges: [number, number, number, number, number][] = [
          [x, y - 1, (x + 0.5) * TILE, y * TILE + 0.3, 0],
          [x, y + 1, (x + 0.5) * TILE, (y + 1) * TILE - 0.3, 0],
          [x - 1, y, x * TILE + 0.3, (y + 0.5) * TILE, Math.PI / 2],
          [x + 1, y, (x + 1) * TILE - 0.3, (y + 0.5) * TILE, Math.PI / 2],
        ];
        for (const [nx, ny, fx, fz, rot] of edges) {
          if (own(nx, ny) || ny >= ROAD_ROW) continue;
          q.setFromAxisAngle(UP, rot);
          m.compose(new THREE.Vector3(fx, w.heightAt(fx, fz), fz), q, new THREE.Vector3(1, 1, 1));
          this.fence.set(id++, m);
        }
      }
    }
  }
}
