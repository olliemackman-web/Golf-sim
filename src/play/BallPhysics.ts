// Golf ball physics in real-world units. Positions are kept in world metres; real = world * COURSE_SCALE.
import { COURSE_SCALE, Surf, TILE } from '../core/constants';
import { ITEMS } from '../data/items';
import type { World } from '../world/World';

const K = COURSE_SCALE;
const G = 9.81;
const RHO = 1.225;
const R_BALL = 0.02134;
const AREA = Math.PI * R_BALL * R_BALL;
const MASS = 0.04593;
export const CUP_R = 0.054; // real metres

export type BallState = 'air' | 'roll' | 'rest' | 'water' | 'ob' | 'holed';

export interface SurfaceProps {
  e: number; // restitution
  mu: number; // impact tangential friction
  roll: number; // rolling resistance coefficient
}

export function surfaceProps(s: Surf, greenSpeed = 1): SurfaceProps {
  switch (s) {
    case Surf.Green: return { e: 0.22, mu: 0.22, roll: 0.058 / greenSpeed };
    case Surf.Fairway: return { e: 0.3, mu: 0.3, roll: 0.17 };
    case Surf.Tee: return { e: 0.3, mu: 0.32, roll: 0.17 };
    case Surf.Rough: return { e: 0.16, mu: 0.55, roll: 0.36 };
    case Surf.DeepRough: return { e: 0.06, mu: 0.8, roll: 0.9 };
    case Surf.Bunker: return { e: 0.02, mu: 0.92, roll: 2.4 };
    case Surf.Path: case Surf.Road: return { e: 0.55, mu: 0.18, roll: 0.07 };
    case Surf.Paving: return { e: 0.5, mu: 0.2, roll: 0.08 };
    case Surf.Water: return { e: 0, mu: 1, roll: 5 };
    default: return { e: 0.2, mu: 0.5, roll: 0.3 };
  }
}

export interface TreeCollider {
  x: number; // world
  z: number;
  cy: number; // canopy centre height above ground (world)
  r: number; // canopy radius (world)
  trunk: number; // trunk radius (world)
  top: number;
}

const TREE_DIMS: Record<string, [number, number, number]> = {
  // canopy centre height, canopy radius, total height (world metres at scale 1)
  tree_oak: [7, 4.2, 11], tree_pine: [11.5, 3, 15], tree_birch: [7, 2.8, 10], tree_maple: [5.8, 3.4, 9],
  tree_willow: [6, 4.2, 10], tree_cherry: [4.8, 3, 7], tree_palm: [9, 3, 10.5], tree_cypress: [6.5, 1.7, 12],
};

export interface Launch {
  speed: number; // real m/s
  launchDeg: number;
  yaw: number; // radians (world yaw: atan2(dx, dz))
  spinRpm: number;
  /** Spin axis tilt in radians (positive = slice / curves right). */
  tilt: number;
}

export interface ShotStats {
  carry: number; // world metres
  total: number;
  apex: number; // real metres
  hang: number; // seconds
  offline: number; // world metres (+ right)
  landX: number;
  landZ: number;
  firstSurf: Surf;
  hitTree: boolean;
}

export class BallPhysics {
  // world-space position, real-space velocity
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  // spin vector (rad/s) in real space
  wx = 0; wy = 0; wz = 0;
  state: BallState = 'rest';
  time = 0;
  bounces = 0;
  stats: ShotStats = { carry: 0, total: 0, apex: 0, hang: 0, offline: 0, landX: 0, landZ: 0, firstSurf: Surf.Rough, hitTree: false };
  private start = { x: 0, y: 0, z: 0, yaw: 0 };
  private landed = false;
  private treeHits = new Set<number>();
  /** Last position that was on dry, owned land (for drops). */
  lastDry = { x: 0, z: 0 };
  wind = { x: 0, z: 0 }; // real m/s
  greenSpeed = 1;
  cup: { x: number; z: number } | null = null;
  trees: TreeCollider[] = [];
  collideObjects = true;
  noCollide = false;

  constructor(private world: World) {}

  /** Gather nearby tree colliders along the expected flight. */
  gatherTrees(cx: number, cz: number, radius: number): void {
    this.trees = [];
    const r2 = radius * radius;
    for (const t of this.world.trees.values()) {
      const dx = t.x - cx, dz = t.z - cz;
      if (dx * dx + dz * dz > r2) continue;
      const d = TREE_DIMS[t.type] ?? [6, 3.5, 10];
      this.trees.push({ x: t.x, z: t.z, cy: d[0] * t.s, r: d[1] * t.s, trunk: 0.35 * t.s, top: d[2] * t.s });
    }
  }

  place(x: number, z: number): void {
    this.x = x;
    this.z = z;
    this.y = this.world.heightAt(x, z);
    this.vx = this.vy = this.vz = 0;
    this.wx = this.wy = this.wz = 0;
    this.state = 'rest';
    this.lastDry = { x, z };
  }

  launch(l: Launch, teeHeight = 0): void {
    const la = (l.launchDeg * Math.PI) / 180;
    const h = Math.cos(la) * l.speed;
    this.vx = Math.sin(l.yaw) * h;
    this.vz = Math.cos(l.yaw) * h;
    this.vy = Math.sin(la) * l.speed;
    // backspin axis is horizontal, perpendicular to travel (to the left of travel for backspin lift)
    const w = (l.spinRpm * 2 * Math.PI) / 60;
    // travel dir d=(sx,0,cz); backspin axis a = up x d rotated... axis = (-cz, 0, sx) gives lift = a x v upward
    const ax = -Math.cos(l.yaw), az = Math.sin(l.yaw);
    // tilt the axis around the travel direction for side spin
    const c = Math.cos(l.tilt), s = Math.sin(l.tilt);
    this.wx = ax * w * c;
    this.wz = az * w * c;
    this.wy = -w * s;
    this.y += teeHeight;
    this.state = 'air';
    this.time = 0;
    this.bounces = 0;
    this.landed = false;
    this.treeHits.clear();
    this.start = { x: this.x, y: this.y, z: this.z, yaw: l.yaw };
    this.stats = { carry: 0, total: 0, apex: 0, hang: 0, offline: 0, landX: this.x, landZ: this.z, firstSurf: Surf.Rough, hitTree: false };
  }

  /** Putts start rolling immediately. */
  putt(speed: number, yaw: number): void {
    this.vx = Math.sin(yaw) * speed;
    this.vz = Math.cos(yaw) * speed;
    this.vy = 0;
    this.wx = this.wy = this.wz = 0;
    this.state = 'roll';
    this.time = 0;
    this.landed = true;
    this.start = { x: this.x, y: this.y, z: this.z, yaw };
    this.stats = { carry: 0, total: 0, apex: 0, hang: 0, offline: 0, landX: this.x, landZ: this.z, firstSurf: this.world.surfAt(this.x, this.z), hitTree: false };
  }

  get moving(): boolean {
    return this.state === 'air' || this.state === 'roll';
  }

  step(dt: number): void {
    const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / sub;
    for (let i = 0; i < sub && this.moving; i++) this.substep(h);
    this.finalStats();
  }

  private finalStats(): void {
    const dx = this.x - this.start.x, dz = this.z - this.start.z;
    this.stats.total = Math.hypot(dx, dz);
    const ry = Math.cos(this.start.yaw), rx = Math.sin(this.start.yaw);
    // right-hand perpendicular of travel (rx, rz) -> (-rz, rx)... right of facing (x=sin,z=cos) is (-cos, sin)
    this.stats.offline = dx * -ry + dz * rx;
  }

  private substep(h: number): void {
    const w = this.world;
    this.time += h;
    if (this.state === 'air') {
      // aerodynamics in real units
      const rvx = this.vx - this.wind.x, rvy = this.vy, rvz = this.vz - this.wind.z;
      const sp = Math.hypot(rvx, rvy, rvz) || 1e-6;
      const wmag = Math.hypot(this.wx, this.wy, this.wz);
      const S = (wmag * R_BALL) / sp;
      const cd = 0.212 + 0.07 * Math.min(1, S * 3);
      const cl = Math.min(0.3, 0.05 + 0.98 * S);
      const kd = (0.5 * RHO * AREA * cd * sp) / MASS;
      let ax = -kd * rvx, ay = -kd * rvy - G, az = -kd * rvz;
      if (wmag > 1e-3) {
        // lift along (w x v) normalised
        let lx = this.wy * rvz - this.wz * rvy;
        let ly = this.wz * rvx - this.wx * rvz;
        let lz = this.wx * rvy - this.wy * rvx;
        const ll = Math.hypot(lx, ly, lz) || 1;
        const kl = (0.5 * RHO * AREA * cl * sp * sp) / MASS;
        lx /= ll; ly /= ll; lz /= ll;
        ax += kl * lx;
        ay += kl * ly;
        az += kl * lz;
      }
      this.vx += ax * h;
      this.vy += ay * h;
      this.vz += az * h;
      const decay = Math.exp(-h / 22);
      this.wx *= decay;
      this.wy *= decay;
      this.wz *= decay;
      this.x += (this.vx * h) / K;
      this.y += (this.vy * h) / K;
      this.z += (this.vz * h) / K;
      const alt = (this.y - this.start.y) * K;
      if (alt > this.stats.apex) this.stats.apex = alt;
      if (!this.noCollide) {
        this.collideTrees();
        if (this.collideObjects) this.collideBuildings();
      }
      const gh = w.heightAt(this.x, this.z);
      if (this.y <= gh) this.impact(gh);
      return;
    }
    if (this.state === 'roll') this.roll(h);
  }

  private impact(gh: number): void {
    const w = this.world;
    const surf = w.surfAt(this.x, this.z);
    if (!this.landed) {
      this.landed = true;
      this.stats.carry = Math.hypot(this.x - this.start.x, this.z - this.start.z);
      this.stats.hang = this.time;
      this.stats.landX = this.x;
      this.stats.landZ = this.z;
      this.stats.firstSurf = surf;
      // direct hit in the cup
      if (this.cup && Math.hypot(this.x - this.cup.x, this.z - this.cup.z) * K < CUP_R * 1.4 && Math.hypot(this.vx, this.vz) < 12) {
        this.y = gh - 0.06;
        this.state = 'holed';
        return;
      }
    }
    if (!w.isOwnedWorld(this.x, this.z)) {
      this.y = gh;
      this.state = 'ob';
      return;
    }
    if (surf === Surf.Water && this.waterHere()) {
      this.state = 'water';
      return;
    }
    this.y = gh;
    const n = w.normalAt(this.x, this.z);
    const vn = this.vx * n.x + this.vy * n.y + this.vz * n.z;
    let tx = this.vx - vn * n.x, ty = this.vy - vn * n.y, tz = this.vz - vn * n.z;
    const sp = surfaceProps(surf, this.greenSpeed);
    const spin = Math.hypot(this.wx, this.wy, this.wz) * 60 / (2 * Math.PI);
    let mu = sp.mu;
    if (this.bounces === 0) mu = Math.min(0.95, mu + Math.min(0.6, spin / 12000) * (surf === Surf.Green ? 1.25 : 0.9));
    tx *= 1 - mu;
    ty *= 1 - mu;
    tz *= 1 - mu;
    const nvn = -vn * sp.e;
    this.vx = tx + nvn * n.x;
    this.vy = ty + nvn * n.y;
    this.vz = tz + nvn * n.z;
    this.wx *= 0.35;
    this.wy *= 0.35;
    this.wz *= 0.35;
    this.bounces++;
    if (Math.abs(nvn) < 1.0 || surf === Surf.Bunker || this.bounces > 8) {
      this.state = 'roll';
      this.vy = 0;
    } else {
      this.y = gh + 0.002;
    }
    if (surf !== Surf.Water) this.lastDry = { x: this.x, z: this.z };
  }

  private waterHere(): boolean {
    const w = this.world;
    const tx = Math.floor(this.x / TILE), ty = Math.floor(this.z / TILE);
    const b = w.waterBodyOf[ty * 160 + tx];
    if (b < 0) return w.surfAt(this.x, this.z) === Surf.Water;
    return this.y <= w.waterBodies[b].level + 0.05;
  }

  private roll(h: number): void {
    const w = this.world;
    const surf = w.surfAt(this.x, this.z);
    if (!w.isOwnedWorld(this.x, this.z)) {
      this.state = 'ob';
      return;
    }
    if (surf === Surf.Water) {
      this.state = 'water';
      return;
    }
    const n = w.normalAt(this.x, this.z);
    const sp = surfaceProps(surf, this.greenSpeed);
    // slope acceleration (horizontal part of gravity along the surface)
    let ax = G * n.y * n.x;
    let az = G * n.y * n.z;
    const v = Math.hypot(this.vx, this.vz);
    if (v > 1e-4) {
      const dec = sp.roll * G;
      ax -= (this.vx / v) * dec;
      az -= (this.vz / v) * dec;
    }
    const nvx = this.vx + ax * h, nvz = this.vz + az * h;
    // friction must not reverse direction on its own
    if (v > 1e-4 && nvx * this.vx + nvz * this.vz < 0 && Math.hypot(G * n.y * n.x, G * n.y * n.z) < sp.roll * G * 1.05) {
      this.vx = 0;
      this.vz = 0;
    } else {
      this.vx = nvx;
      this.vz = nvz;
    }
    this.x += (this.vx * h) / K;
    this.z += (this.vz * h) / K;
    this.y = w.heightAt(this.x, this.z);
    if (w.surfAt(this.x, this.z) !== Surf.Water) this.lastDry = { x: this.x, z: this.z };
    if (!this.noCollide && this.collideObjects) this.collideBuildings();
    // cup
    if (this.cup) {
      const d = Math.hypot(this.x - this.cup.x, this.z - this.cup.z) * K;
      const s = Math.hypot(this.vx, this.vz);
      if (d < CUP_R) {
        if (s < 1.45) {
          this.x = this.cup.x;
          this.z = this.cup.z;
          this.y -= 0.06;
          this.state = 'holed';
          return;
        }
        // lip out: deflect a little
        const ang = (Math.random() - 0.5) * 0.6;
        const c = Math.cos(ang), sn = Math.sin(ang);
        const vx = this.vx * c - this.vz * sn, vz = this.vx * sn + this.vz * c;
        this.vx = vx * 0.75;
        this.vz = vz * 0.75;
      }
    }
    const speed = Math.hypot(this.vx, this.vz);
    const slopeAcc = Math.hypot(G * n.y * n.x, G * n.y * n.z);
    if (speed < 0.05 && slopeAcc < sp.roll * G * 1.05) {
      this.vx = this.vz = 0;
      this.state = 'rest';
    }
    if (this.time > 40) this.state = 'rest';
  }

  private collideTrees(): void {
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      const dx = this.x - t.x, dz = this.z - t.z;
      const gy = this.world.heightAt(t.x, t.z);
      const hy = this.y - gy;
      if (hy < 0 || hy > t.top) continue;
      const d2 = dx * dx + dz * dz;
      // trunk
      if (hy < t.cy && d2 < t.trunk * t.trunk) {
        const d = Math.sqrt(d2) || 1;
        const nx = dx / d, nz = dz / d;
        const vn = this.vx * nx + this.vz * nz;
        if (vn < 0) {
          this.vx -= 1.6 * vn * nx;
          this.vz -= 1.6 * vn * nz;
          this.vx *= 0.5;
          this.vz *= 0.5;
          this.stats.hitTree = true;
        }
        continue;
      }
      // canopy
      const dy = hy - t.cy;
      if (d2 + dy * dy * 1.4 < t.r * t.r && !this.treeHits.has(i)) {
        this.treeHits.add(i);
        // chance to pass through the edge of the canopy
        const depth = 1 - Math.sqrt(d2 + dy * dy) / t.r;
        if (Math.random() < 0.25 + depth * 0.9) {
          this.stats.hitTree = true;
          const keep = 0.15 + Math.random() * 0.25;
          const a = (Math.random() - 0.5) * 2.2;
          const c = Math.cos(a), s = Math.sin(a);
          const vx = this.vx * c - this.vz * s, vz = this.vx * s + this.vz * c;
          this.vx = vx * keep;
          this.vz = vz * keep;
          this.vy = Math.min(this.vy, 0) * 0.3;
          this.wx *= 0.2;
          this.wy *= 0.2;
          this.wz *= 0.2;
        }
      }
    }
  }

  private collideBuildings(): void {
    const w = this.world;
    const tx = Math.floor(this.x / TILE), ty = Math.floor(this.z / TILE);
    const o = w.objectAtTile(tx, ty);
    if (!o) return;
    const def = ITEMS[o.type];
    if (['target', 'practice', 'carpark', 'helipad', 'deco', 'course_prop', 'bench', 'bin'].includes(def.kind)) return;
    const height = def.kind === 'bay' ? 3.2 : def.kind === 'floodlight' ? 12 : def.kind === 'lamp' ? 3 : def.kind === 'hotel' ? 20 : 7;
    const base = w.objectBaseHeight(o);
    if (this.y > base + height) return;
    // bounce back out the way we came (simple AABB response)
    const cx = (tx + 0.5) * TILE, cz = (ty + 0.5) * TILE;
    const dx = this.x - cx, dz = this.z - cz;
    if (Math.abs(dx) > Math.abs(dz)) this.vx = -this.vx * 0.35;
    else this.vz = -this.vz * 0.35;
    this.vy *= 0.5;
    this.x += (this.vx / K) * 0.02;
    this.z += (this.vz / K) * 0.02;
    if (this.state === 'roll' && Math.hypot(this.vx, this.vz) < 0.5) this.state = 'rest';
  }

  /** Predict a landing point (no wind, no collisions) for aiming. */
  static predict(world: World, from: { x: number; y: number; z: number }, l: Launch, maxT = 12): { x: number; z: number; carry: number; total: number; pts: { x: number; y: number; z: number }[] } {
    const b = new BallPhysics(world);
    b.x = from.x;
    b.y = from.y;
    b.z = from.z;
    b.noCollide = true;
    b.launch(l, 0);
    const pts: { x: number; y: number; z: number }[] = [];
    let t = 0;
    let land: { x: number; z: number } | null = null;
    while (t < maxT && b.moving) {
      b.step(1 / 60);
      t += 1 / 60;
      if (b.state === 'air') pts.push({ x: b.x, y: b.y, z: b.z });
      else if (!land) land = { x: b.x, z: b.z };
      if (b.state === 'water' || b.state === 'ob') break;
    }
    if (!land) land = { x: b.x, z: b.z };
    return { x: land.x, z: land.z, carry: b.stats.carry || Math.hypot(land.x - from.x, land.z - from.z), total: Math.hypot(b.x - from.x, b.z - from.z), pts };
  }
}
