// The tile world: surfaces, terrain heights, land ownership, placed objects and trees.
import {
  HN, MAP, PARCEL, PARCELS, ROAD_ROW, SUB, Surf, TILE, inMap, tileIndex,
} from '../core/constants';
import { Emitter } from '../core/events';
import { RNG, Simplex2, hash2 } from '../core/rng';
import { ITEMS, ItemDef, TREE_TYPES } from '../data/items';

export interface PlacedObject {
  id: number;
  type: string;
  /** Top-left tile of the (rotated) footprint. */
  x: number;
  y: number;
  rot: number; // 0..3
  level: number;
  /** Arbitrary per-object state (e.g. bay number). */
  data?: Record<string, number | string>;
}

export interface Tree {
  id: number;
  type: string;
  x: number; // world metres
  z: number;
  s: number; // scale
  r: number; // yaw
  /** Natural (pre-existing) tree. */
  nat?: boolean;
}

export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface WaterBody {
  id: number;
  tiles: number[];
  level: number;
}

type WorldEvents = {
  surf: Region;
  height: Region;
  objectAdded: PlacedObject;
  objectRemoved: PlacedObject;
  objectChanged: PlacedObject;
  treeAdded: Tree;
  treeRemoved: Tree;
  owned: { px: number; py: number };
  water: void;
};

export const OCC_ROAD = -1;

export function footprint(def: ItemDef, rot: number): { w: number; h: number } {
  return rot % 2 === 0 ? { w: def.w, h: def.h } : { w: def.h, h: def.w };
}

/** Rotate a local offset (metres, relative to footprint centre) by rot quarter turns (matches mesh.rotation.y = rot*PI/2). */
export function rotateLocal(lx: number, lz: number, rot: number): { x: number; z: number } {
  const a = (rot * Math.PI) / 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

export class World extends Emitter<WorldEvents> {
  readonly seed: number;
  surf = new Uint8Array(MAP * MAP);
  /** Generated terrain height (never edited). */
  baseGen = new Float32Array(HN * HN);
  /** Player terraforming delta (metres). */
  delta = new Float32Array(HN * HN);
  /** Final render/physics height = base + delta + surface modifiers. */
  final = new Float32Array(HN * HN);
  owned = new Uint8Array(PARCELS * PARCELS);
  occ = new Int32Array(MAP * MAP);
  treeAt = new Int32Array(MAP * MAP);
  /** Turf condition 0..255 for maintained surfaces. */
  condition = new Uint8Array(MAP * MAP).fill(230);
  objects = new Map<number, PlacedObject>();
  trees = new Map<number, Tree>();
  waterBodies: WaterBody[] = [];
  waterBodyOf = new Int16Array(MAP * MAP).fill(-1);
  /** Scenic beauty per tile (0..~100). */
  scenery = new Float32Array(MAP * MAP);
  sceneryDirty = true;
  private nextId = 1;
  private noise: Simplex2;

  constructor(seed: number) {
    super();
    this.seed = seed;
    this.noise = new Simplex2(seed);
  }

  // ------------------------------------------------------------ generation
  generate(): void {
    const n = this.noise;
    const rng = new RNG(this.seed * 7 + 3);
    // base heights
    for (let vy = 0; vy < HN; vy++) {
      for (let vx = 0; vx < HN; vx++) {
        const wx = (vx / SUB) * TILE;
        const wz = (vy / SUB) * TILE;
        let h = 5.5 * n.fbm(wx / 260, wz / 260, 4) + 1.6 * n.fbm(wx / 70 + 13, wz / 70 - 7, 3);
        // rolling hills towards the north and the sides, flatter near the road
        const ty = vy / SUB;
        const tx = vx / SUB;
        const north = Math.max(0, 1 - ty / (MAP * 0.55));
        h += north * north * 9 * (0.6 + 0.4 * n.noise(wx / 120, wz / 120));
        const edge = Math.min(tx, MAP - tx);
        h += Math.max(0, 1 - edge / 22) ** 2 * 5;
        // flatten close to the road
        const roadDist = ROAD_ROW - ty;
        const flat = Math.min(1, Math.max(0, (roadDist - 2) / 22));
        h = h * (0.25 + 0.75 * flat);
        if (ty >= ROAD_ROW - 0.5) h = this.roadHeight();
        this.baseGen[vy * HN + vx] = h;
      }
    }
    // smooth the road shoulder
    for (let vy = (ROAD_ROW - 3) * SUB; vy < (ROAD_ROW) * SUB; vy++) {
      const t = (vy - (ROAD_ROW - 3) * SUB) / (3 * SUB);
      for (let vx = 0; vx < HN; vx++) {
        const i = vy * HN + vx;
        this.baseGen[i] = this.baseGen[i] * (1 - t) + this.roadHeight() * t;
      }
    }

    // surfaces: rough everywhere, long grass meadows and lakes in the wild
    for (let y = 0; y < MAP; y++) {
      for (let x = 0; x < MAP; x++) {
        const i = tileIndex(x, y);
        if (y >= ROAD_ROW) {
          this.surf[i] = Surf.Road;
          this.occ[i] = OCC_ROAD;
          continue;
        }
        const wx = (x + 0.5) * TILE;
        const wz = (y + 0.5) * TILE;
        const m = n.fbm(wx / 90 + 40, wz / 90 - 20, 3);
        if (m > 0.32) this.surf[i] = Surf.DeepRough;
      }
    }
    // lakes in natural low spots away from the starting land
    const lakeCount = 3;
    let placed = 0;
    for (let attempt = 0; attempt < 400 && placed < lakeCount; attempt++) {
      const cx = rng.int(10, MAP - 10);
      const cy = rng.int(8, ROAD_ROW - 30);
      if (this.isStartParcel(Math.floor(cx / PARCEL), Math.floor(cy / PARCEL))) continue;
      const r = rng.range(3.5, 7);
      const stretch = rng.range(0.6, 1.5);
      for (let y = Math.floor(cy - r * 2); y <= cy + r * 2; y++) {
        for (let x = Math.floor(cx - r * 2); x <= cx + r * 2; x++) {
          if (!inMap(x, y) || y >= ROAD_ROW - 2) continue;
          const dx = (x - cx) / (r * stretch);
          const dy = (y - cy) / (r / stretch);
          const wob = 0.25 * n.noise(x * 0.25, y * 0.25);
          if (dx * dx + dy * dy < 1 + wob) this.surf[tileIndex(x, y)] = Surf.Water;
        }
      }
      placed++;
    }

    // starting land
    for (let py = 0; py < PARCELS; py++) {
      for (let px = 0; px < PARCELS; px++) {
        if (this.isStartParcel(px, py)) this.owned[py * PARCELS + px] = 1;
      }
    }

    // trees: forests in the wild, a few specimen trees on the starting land
    for (let y = 1; y < ROAD_ROW - 1; y++) {
      for (let x = 1; x < MAP - 1; x++) {
        const i = tileIndex(x, y);
        if (this.surf[i] === Surf.Water) continue;
        const wx = (x + 0.5) * TILE;
        const wz = (y + 0.5) * TILE;
        const f = n.fbm(wx / 110 - 70, wz / 110 + 30, 4);
        const own = this.isOwnedTile(x, y);
        const edgeBoost = Math.max(0, 1 - Math.min(x, MAP - x, y) / 12) * 0.5;
        let p = 0;
        if (f + edgeBoost > 0.12) p = own ? 0.05 : 0.55 * Math.min(1, (f + edgeBoost - 0.12) * 4 + 0.3);
        else p = own ? 0.006 : 0.03;
        if (y > ROAD_ROW - 4) p = 0;
        if (hash2(x, y, this.seed) < p) {
          const hgt = this.baseAt(wx, wz);
          let type: string;
          const t = hash2(x, y, this.seed + 11);
          if (hgt > 7) type = t < 0.6 ? 'tree_pine' : t < 0.8 ? 'tree_birch' : 'tree_oak';
          else type = t < 0.45 ? 'tree_oak' : t < 0.65 ? 'tree_birch' : t < 0.85 ? 'tree_pine' : t < 0.93 ? 'tree_maple' : 'tree_cypress';
          const jx = (hash2(x, y, this.seed + 5) - 0.5) * TILE * 0.6;
          const jz = (hash2(x, y, this.seed + 6) - 0.5) * TILE * 0.6;
          this.addTree(type, wx + jx, wz + jz, 0.75 + hash2(x, y, 9) * 0.5, hash2(x, y, 10) * Math.PI * 2, true, false);
        }
      }
    }
    // ensure tree types are valid
    void TREE_TYPES;

    this.computeWater();
    this.recomputeHeights({ x0: 0, y0: 0, x1: MAP - 1, y1: MAP - 1 }, false);
    this.sceneryDirty = true;
  }

  roadHeight(): number {
    return 0.2;
  }

  isStartParcel(px: number, py: number): boolean {
    return px >= 3 && px <= 6 && py >= 7;
  }

  // ------------------------------------------------------------ ownership
  parcelOf(x: number, y: number): number {
    return Math.floor(y / PARCEL) * PARCELS + Math.floor(x / PARCEL);
  }
  isOwnedTile(x: number, y: number): boolean {
    if (!inMap(x, y)) return false;
    return this.owned[this.parcelOf(x, y)] === 1;
  }
  isOwnedWorld(wx: number, wz: number): boolean {
    return this.isOwnedTile(Math.floor(wx / TILE), Math.floor(wz / TILE));
  }
  ownedCount(): number {
    let c = 0;
    for (let i = 0; i < this.owned.length; i++) c += this.owned[i];
    return c;
  }
  parcelPrice(px: number, py: number): number {
    const owned = this.ownedCount();
    // price grows with every purchase; wilder land (hills/forest) is slightly cheaper
    let trees = 0;
    for (let y = py * PARCEL; y < (py + 1) * PARCEL; y++) for (let x = px * PARCEL; x < (px + 1) * PARCEL; x++) if (this.treeAt[tileIndex(x, y)]) trees++;
    const base = 9000 + Math.max(0, owned - 12) * 3500 + Math.pow(Math.max(0, owned - 12), 1.6) * 600;
    return Math.round((base * (1 - Math.min(0.25, trees / 600))) / 100) * 100;
  }
  canBuyParcel(px: number, py: number): boolean {
    if (px < 0 || py < 0 || px >= PARCELS || py >= PARCELS) return false;
    if (this.owned[py * PARCELS + px]) return false;
    // must be adjacent to owned land
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    return n.some(([dx, dy]) => {
      const qx = px + dx;
      const qy = py + dy;
      return qx >= 0 && qy >= 0 && qx < PARCELS && qy < PARCELS && this.owned[qy * PARCELS + qx] === 1;
    });
  }
  buyParcel(px: number, py: number): void {
    this.owned[py * PARCELS + px] = 1;
    this.emit('owned', { px, py });
  }

  // ------------------------------------------------------------ heights
  h(vx: number, vy: number): number {
    vx = vx < 0 ? 0 : vx >= HN ? HN - 1 : vx;
    vy = vy < 0 ? 0 : vy >= HN ? HN - 1 : vy;
    return this.final[vy * HN + vx];
  }

  /** Generated base height at world position (bilinear, ignores modifiers). */
  baseAt(wx: number, wz: number): number {
    const fx = (wx / TILE) * SUB;
    const fz = (wz / TILE) * SUB;
    const x0 = Math.max(0, Math.min(HN - 2, Math.floor(fx)));
    const z0 = Math.max(0, Math.min(HN - 2, Math.floor(fz)));
    const u = fx - x0;
    const v = fz - z0;
    const b = this.baseGen;
    const a = b[z0 * HN + x0] * (1 - u) + b[z0 * HN + x0 + 1] * u;
    const c = b[(z0 + 1) * HN + x0] * (1 - u) + b[(z0 + 1) * HN + x0 + 1] * u;
    return a * (1 - v) + c * v;
  }

  /** Exact surface height matching the rendered triangulation. */
  heightAt(wx: number, wz: number): number {
    const fx = (wx / TILE) * SUB;
    const fz = (wz / TILE) * SUB;
    if (fx < 0 || fz < 0 || fx >= HN - 1 || fz >= HN - 1) {
      const cx = Math.max(0, Math.min(HN - 1.001, fx));
      const cz = Math.max(0, Math.min(HN - 1.001, fz));
      return this.heightAt((cx / SUB) * TILE, (cz / SUB) * TILE);
    }
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const u = fx - x0;
    const v = fz - z0;
    const f = this.final;
    const h00 = f[z0 * HN + x0];
    const h10 = f[z0 * HN + x0 + 1];
    const h01 = f[(z0 + 1) * HN + x0];
    const h11 = f[(z0 + 1) * HN + x0 + 1];
    if (v >= u) return h00 + (h11 - h01) * u + (h01 - h00) * v;
    return h00 + (h10 - h00) * u + (h11 - h10) * v;
  }

  /** Surface normal (unnormalised components returned normalised). */
  normalAt(wx: number, wz: number, out = { x: 0, y: 1, z: 0 }): { x: number; y: number; z: number } {
    const e = 0.5;
    const hl = this.heightAt(wx - e, wz);
    const hr = this.heightAt(wx + e, wz);
    const hd = this.heightAt(wx, wz - e);
    const hu = this.heightAt(wx, wz + e);
    let nx = hl - hr;
    let ny = 2 * e;
    let nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    nx /= l;
    ny /= l;
    nz /= l;
    out.x = nx;
    out.y = ny;
    out.z = nz;
    return out;
  }

  surfAtTile(x: number, y: number): Surf {
    if (!inMap(x, y)) return Surf.DeepRough;
    return this.surf[tileIndex(x, y)] as Surf;
  }
  surfAt(wx: number, wz: number): Surf {
    return this.surfAtTile(Math.floor(wx / TILE), Math.floor(wz / TILE));
  }

  tileHeight(x: number, y: number): number {
    return this.heightAt((x + 0.5) * TILE, (y + 0.5) * TILE);
  }

  /** Recompute water bodies (flood fill) and their surface levels. */
  computeWater(): void {
    this.waterBodyOf.fill(-1);
    this.waterBodies = [];
    const stack: number[] = [];
    for (let i = 0; i < MAP * MAP; i++) {
      if (this.surf[i] !== Surf.Water || this.waterBodyOf[i] >= 0) continue;
      const id = this.waterBodies.length;
      const body: WaterBody = { id, tiles: [], level: 0 };
      stack.push(i);
      this.waterBodyOf[i] = id;
      let minH = Infinity;
      while (stack.length) {
        const t = stack.pop()!;
        body.tiles.push(t);
        const x = t % MAP;
        const y = (t / MAP) | 0;
        // base height around the tile corners (with terraform delta)
        for (let dy = 0; dy <= SUB; dy++) {
          for (let dx = 0; dx <= SUB; dx++) {
            const vi = (y * SUB + dy) * HN + x * SUB + dx;
            const hh = this.baseGen[vi] + this.delta[vi];
            if (hh < minH) minH = hh;
          }
        }
        const nb = [t - 1, t + 1, t - MAP, t + MAP];
        const ok = [x > 0, x < MAP - 1, y > 0, y < MAP - 1];
        for (let k = 0; k < 4; k++) {
          if (!ok[k]) continue;
          const q = nb[k];
          if (this.surf[q] === Surf.Water && this.waterBodyOf[q] < 0) {
            this.waterBodyOf[q] = id;
            stack.push(q);
          }
        }
      }
      body.level = minH - 0.3;
      this.waterBodies.push(body);
    }
    this.emit('water', undefined);
  }

  /** Fraction (0..1) of the 4 half-tile samples around a height vertex that have surface s. */
  private vertexFrac(vx: number, vy: number, s: Surf): number {
    let c = 0;
    for (let k = 0; k < 4; k++) {
      const sx = vx + (k & 1 ? 0.5 : -0.5);
      const sy = vy + (k & 2 ? 0.5 : -0.5);
      const tx = Math.floor(sx / SUB);
      const ty = Math.floor(sy / SUB);
      if (inMap(tx, ty) && this.surf[ty * MAP + tx] === s) c++;
    }
    return c / 4;
  }

  private vertexWaterLevel(vx: number, vy: number): number {
    let lvl = Infinity;
    for (let k = 0; k < 4; k++) {
      const sx = vx + (k & 1 ? 0.5 : -0.5);
      const sy = vy + (k & 2 ? 0.5 : -0.5);
      const tx = Math.floor(sx / SUB);
      const ty = Math.floor(sy / SUB);
      if (!inMap(tx, ty)) continue;
      const b = this.waterBodyOf[ty * MAP + tx];
      if (b >= 0) lvl = Math.min(lvl, this.waterBodies[b].level);
    }
    return lvl;
  }

  /** Recompute final heights for vertices touching the tile region (inclusive). */
  recomputeHeights(r: Region, emit = true): void {
    const vx0 = Math.max(0, (r.x0 - 1) * SUB);
    const vy0 = Math.max(0, (r.y0 - 1) * SUB);
    const vx1 = Math.min(HN - 1, (r.x1 + 2) * SUB);
    const vy1 = Math.min(HN - 1, (r.y1 + 2) * SUB);
    for (let vy = vy0; vy <= vy1; vy++) {
      for (let vx = vx0; vx <= vx1; vx++) {
        const i = vy * HN + vx;
        let h = this.baseGen[i] + this.delta[i];
        const fw = this.vertexFrac(vx, vy, Surf.Water);
        if (fw > 0) {
          const lvl = this.vertexWaterLevel(vx, vy);
          if (fw >= 0.5) h = Math.min(h, lvl - 0.15 - (fw - 0.5) * 2.6);
          else h = Math.min(h, h * 0.5 + (lvl + 0.1) * 0.5);
        }
        const fb = this.vertexFrac(vx, vy, Surf.Bunker);
        if (fb > 0) h -= 0.75 * Math.pow(fb, 1.3);
        const ft = this.vertexFrac(vx, vy, Surf.Tee);
        if (ft > 0) h += 0.35 * Math.min(1, ft * 1.6);
        const fg = this.vertexFrac(vx, vy, Surf.Green);
        if (fg > 0) h += 0.12 * fg;
        this.final[i] = h;
      }
    }
    if (emit) this.emit('height', r);
  }

  // ------------------------------------------------------------ surfaces
  setSurf(x: number, y: number, s: Surf): boolean {
    if (!inMap(x, y)) return false;
    const i = tileIndex(x, y);
    if (this.surf[i] === s) return false;
    const was = this.surf[i];
    this.surf[i] = s;
    if (s === Surf.Fairway || s === Surf.Green || s === Surf.Tee) this.condition[i] = 235;
    if (was === Surf.Water || s === Surf.Water) this.waterDirty = true;
    return true;
  }
  waterDirty = false;

  /** Call after a batch of setSurf calls. */
  commitSurf(r: Region): void {
    if (this.waterDirty) {
      this.computeWater();
      this.waterDirty = false;
      // water levels may change across a whole body
      this.recomputeHeights({ x0: 0, y0: 0, x1: MAP - 1, y1: MAP - 1 });
    } else {
      this.recomputeHeights(r);
    }
    this.sceneryDirty = true;
    this.emit('surf', r);
  }

  /** Terraform: raise/lower base heights around a world point. */
  terraform(wx: number, wz: number, radius: number, amount: number, mode: 'raise' | 'lower' | 'flatten' | 'smooth', target = 0): Region {
    const cx = (wx / TILE) * SUB;
    const cz = (wz / TILE) * SUB;
    const rv = (radius / TILE) * SUB;
    const x0 = Math.max(0, Math.floor(cx - rv));
    const x1 = Math.min(HN - 1, Math.ceil(cx + rv));
    const z0 = Math.max(0, Math.floor(cz - rv));
    const z1 = Math.min(HN - 1, Math.ceil(cz + rv));
    const copy = mode === 'smooth' ? this.delta.slice() : null;
    for (let vy = z0; vy <= z1; vy++) {
      for (let vx = x0; vx <= x1; vx++) {
        const tx = Math.floor(vx / SUB);
        const ty = Math.floor(vy / SUB);
        if (!this.isOwnedTile(Math.min(MAP - 1, tx), Math.min(MAP - 1, ty))) continue;
        if (ty >= ROAD_ROW - 1) continue;
        const d = Math.hypot(vx - cx, vy - cz) / rv;
        if (d > 1) continue;
        const w = 0.5 + 0.5 * Math.cos(d * Math.PI);
        const i = vy * HN + vx;
        if (mode === 'raise') this.delta[i] += amount * w;
        else if (mode === 'lower') this.delta[i] -= amount * w;
        else if (mode === 'flatten') {
          const cur = this.baseGen[i] + this.delta[i];
          this.delta[i] += (target - cur) * Math.min(1, w * amount);
        } else if (copy) {
          let s = 0;
          let c = 0;
          for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
            const qx = vx + ox;
            const qy = vy + oy;
            if (qx < 0 || qy < 0 || qx >= HN || qy >= HN) continue;
            s += this.baseGen[qy * HN + qx] + copy[qy * HN + qx];
            c++;
          }
          const avg = s / c;
          const cur = this.baseGen[i] + copy[i];
          this.delta[i] = copy[i] + (avg - cur) * Math.min(1, w * amount);
        }
        this.delta[i] = Math.max(-12, Math.min(18, this.delta[i]));
      }
    }
    const r: Region = {
      x0: Math.max(0, Math.floor(x0 / SUB) - 1),
      y0: Math.max(0, Math.floor(z0 / SUB) - 1),
      x1: Math.min(MAP - 1, Math.ceil(x1 / SUB) + 1),
      y1: Math.min(MAP - 1, Math.ceil(z1 / SUB) + 1),
    };
    // water levels follow the land
    let touchesWater = false;
    for (let y = r.y0; y <= r.y1 && !touchesWater; y++) for (let x = r.x0; x <= r.x1; x++) if (this.surf[tileIndex(x, y)] === Surf.Water) { touchesWater = true; break; }
    if (touchesWater) {
      this.computeWater();
      this.recomputeHeights({ x0: 0, y0: 0, x1: MAP - 1, y1: MAP - 1 });
    } else this.recomputeHeights(r);
    // keep objects and trees sitting on the ground
    return r;
  }

  /** Flatten the vertices of a tile rectangle (inclusive) to height `target`, blending a margin. */
  flattenRect(x0: number, y0: number, x1: number, y1: number, target: number, margin = 1): void {
    const vx0 = x0 * SUB, vy0 = y0 * SUB, vx1 = (x1 + 1) * SUB, vy1 = (y1 + 1) * SUB;
    const m = margin * SUB;
    for (let vy = Math.max(0, vy0 - m); vy <= Math.min(HN - 1, vy1 + m); vy++) {
      for (let vx = Math.max(0, vx0 - m); vx <= Math.min(HN - 1, vx1 + m); vx++) {
        const dx = vx < vx0 ? vx0 - vx : vx > vx1 ? vx - vx1 : 0;
        const dy = vy < vy0 ? vy0 - vy : vy > vy1 ? vy - vy1 : 0;
        const d = Math.max(dx, dy);
        const w = d === 0 ? 1 : m > 0 ? Math.max(0, 1 - d / (m + 1)) : 0;
        if (w <= 0) continue;
        const i = vy * HN + vx;
        const cur = this.baseGen[i] + this.delta[i];
        this.delta[i] += (target - cur) * w;
      }
    }
    this.recomputeHeights({ x0: Math.max(0, x0 - margin - 1), y0: Math.max(0, y0 - margin - 1), x1: Math.min(MAP - 1, x1 + margin + 1), y1: Math.min(MAP - 1, y1 + margin + 1) });
  }

  /** Average un-modified terrain height over a tile rectangle (inclusive). */
  avgBaseHeight(x0: number, y0: number, x1: number, y1: number): number {
    let s = 0, c = 0;
    for (let vy = y0 * SUB; vy <= (y1 + 1) * SUB; vy++) for (let vx = x0 * SUB; vx <= (x1 + 1) * SUB; vx++) {
      if (vx < 0 || vy < 0 || vx >= HN || vy >= HN) continue;
      s += this.baseGen[vy * HN + vx] + this.delta[vy * HN + vx];
      c++;
    }
    return c ? s / c : 0;
  }

  // ------------------------------------------------------------ objects
  objectAtTile(x: number, y: number): PlacedObject | undefined {
    if (!inMap(x, y)) return undefined;
    const id = this.occ[tileIndex(x, y)];
    return id > 0 ? this.objects.get(id) : undefined;
  }

  footprintTiles(def: ItemDef, x: number, y: number, rot: number): { x: number; y: number }[] {
    const f = footprint(def, rot);
    const out: { x: number; y: number }[] = [];
    for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) out.push({ x: x + i, y: y + j });
    return out;
  }

  /** World centre of an object footprint. */
  objectCenter(o: PlacedObject): { x: number; z: number } {
    const def = ITEMS[o.type];
    const f = footprint(def, o.rot);
    return { x: (o.x + f.w / 2) * TILE, z: (o.y + f.h / 2) * TILE };
  }

  /** Average ground height under an object (objects sit flat). */
  objectBaseHeight(o: PlacedObject): number {
    const def = ITEMS[o.type];
    const f = footprint(def, o.rot);
    let s = 0;
    let c = 0;
    for (let j = 0; j <= f.h; j++) for (let i = 0; i <= f.w; i++) {
      s += this.h((o.x + i) * SUB, (o.y + j) * SUB);
      c++;
    }
    return s / c;
  }

  /** Convert local model offset (metres, relative to footprint centre, rot 0) to world. */
  localToWorld(o: PlacedObject, lx: number, lz: number): { x: number; z: number } {
    const c = this.objectCenter(o);
    const r = rotateLocal(lx, lz, o.rot);
    return { x: c.x + r.x, z: c.z + r.z };
  }

  /** Front-facing direction of an object (unit vector in world XZ). */
  objectFront(o: PlacedObject): { x: number; z: number } {
    return rotateLocal(0, 1, o.rot);
  }

  /** The walkable tile just outside the front-centre of the footprint. */
  entranceTile(o: PlacedObject): { x: number; y: number } {
    const def = ITEMS[o.type];
    const f = footprint(def, o.rot);
    const c = this.objectCenter(o);
    const fr = this.objectFront(o);
    const depth = (o.rot % 2 === 0 ? f.h : f.w) / 2;
    const wx = c.x + fr.x * (depth + 0.5) * TILE;
    const wz = c.z + fr.z * (depth + 0.5) * TILE;
    return { x: Math.floor(wx / TILE), y: Math.floor(wz / TILE) };
  }

  canPlace(def: ItemDef, x: number, y: number, rot: number): { ok: boolean; reason?: string; treeCost: number } {
    const tiles = this.footprintTiles(def, x, y, rot);
    let treeCost = 0;
    for (const t of tiles) {
      if (!inMap(t.x, t.y)) return { ok: false, reason: 'Outside the map', treeCost };
      if (!this.isOwnedTile(t.x, t.y)) return { ok: false, reason: 'You do not own this land', treeCost };
      const i = tileIndex(t.x, t.y);
      if (this.occ[i] === OCC_ROAD) return { ok: false, reason: 'Cannot build on the road', treeCost };
      if (this.occ[i] !== 0) return { ok: false, reason: 'Something is already here', treeCost };
      const s = this.surf[i];
      if (s === Surf.Water && def.kind !== 'target') return { ok: false, reason: 'Cannot build on water', treeCost };
      if ((s === Surf.Green || s === Surf.Tee) && def.cat !== 'course') return { ok: false, reason: 'Cannot build on greens or tees', treeCost };
      if (this.treeAt[i]) treeCost += 40;
    }
    if (def.place === 'roadside') {
      const f = footprint(def, rot);
      // footprint must touch the road on its southern edge and face the road
      if (y + f.h !== ROAD_ROW || rot !== 0) return { ok: false, reason: 'Car parks must face and touch the road', treeCost };
    }
    // slope check for big buildings
    if (def.w * def.h >= 4) {
      let mn = Infinity;
      let mx = -Infinity;
      const f = footprint(def, rot);
      for (let j = 0; j <= f.h; j++) for (let i = 0; i <= f.w; i++) {
        const hh = this.h((x + i) * SUB, (y + j) * SUB);
        mn = Math.min(mn, hh);
        mx = Math.max(mx, hh);
      }
      if (mx - mn > 3.2) return { ok: false, reason: 'Ground is too steep — flatten it first', treeCost };
    }
    return { ok: true, treeCost };
  }

  addObject(type: string, x: number, y: number, rot: number, level = 1, data?: Record<string, number | string>, id?: number): PlacedObject {
    const def = ITEMS[type];
    const o: PlacedObject = { id: id ?? this.nextId++, type, x, y, rot, level, data };
    if (id !== undefined) this.nextId = Math.max(this.nextId, id + 1);
    for (const t of this.footprintTiles(def, x, y, rot)) {
      const i = tileIndex(t.x, t.y);
      this.occ[i] = o.id;
      const tid = this.treeAt[i];
      if (tid) this.removeTree(tid);
    }
    this.objects.set(o.id, o);
    this.sceneryDirty = true;
    this.emit('objectAdded', o);
    return o;
  }

  removeObject(id: number): PlacedObject | undefined {
    const o = this.objects.get(id);
    if (!o) return undefined;
    const def = ITEMS[o.type];
    for (const t of this.footprintTiles(def, o.x, o.y, o.rot)) {
      const i = tileIndex(t.x, t.y);
      if (this.occ[i] === id) this.occ[i] = 0;
    }
    this.objects.delete(id);
    this.sceneryDirty = true;
    this.emit('objectRemoved', o);
    return o;
  }

  objectsOfKind(kind: string): PlacedObject[] {
    const out: PlacedObject[] = [];
    for (const o of this.objects.values()) if (ITEMS[o.type].kind === kind) out.push(o);
    return out;
  }
  objectsOfType(type: string): PlacedObject[] {
    const out: PlacedObject[] = [];
    for (const o of this.objects.values()) if (o.type === type) out.push(o);
    return out;
  }

  // ------------------------------------------------------------ trees
  addTree(type: string, wx: number, wz: number, s: number, r: number, nat = false, emit = true, id?: number): Tree | undefined {
    const tx = Math.floor(wx / TILE);
    const ty = Math.floor(wz / TILE);
    if (!inMap(tx, ty)) return undefined;
    const i = tileIndex(tx, ty);
    if (this.treeAt[i] || this.occ[i] !== 0) return undefined;
    const t: Tree = { id: id ?? this.nextId++, type, x: wx, z: wz, s, r, nat };
    if (id !== undefined) this.nextId = Math.max(this.nextId, id + 1);
    this.trees.set(t.id, t);
    this.treeAt[i] = t.id;
    if (emit) {
      this.sceneryDirty = true;
      this.emit('treeAdded', t);
    }
    return t;
  }

  removeTree(id: number): void {
    const t = this.trees.get(id);
    if (!t) return;
    const i = tileIndex(Math.floor(t.x / TILE), Math.floor(t.z / TILE));
    if (this.treeAt[i] === id) this.treeAt[i] = 0;
    this.trees.delete(id);
    this.sceneryDirty = true;
    this.emit('treeRemoved', t);
  }

  treeAtTile(x: number, y: number): Tree | undefined {
    if (!inMap(x, y)) return undefined;
    const id = this.treeAt[tileIndex(x, y)];
    return id ? this.trees.get(id) : undefined;
  }

  // ------------------------------------------------------------ scenery
  updateScenery(): void {
    if (!this.sceneryDirty) return;
    this.sceneryDirty = false;
    const src = new Float32Array(MAP * MAP);
    for (const o of this.objects.values()) {
      const def = ITEMS[o.type];
      if (!def.scenery) continue;
      const c = this.objectCenter(o);
      const i = tileIndex(Math.floor(c.x / TILE), Math.floor(c.z / TILE));
      src[i] += def.scenery * 6 * (o.level || 1);
    }
    for (const t of this.trees.values()) {
      const i = tileIndex(Math.floor(t.x / TILE), Math.floor(t.z / TILE));
      src[i] += (ITEMS[t.type]?.scenery ?? 2) * 3;
    }
    for (let i = 0; i < MAP * MAP; i++) {
      const s = this.surf[i];
      if (s === Surf.Water) src[i] += 4;
      else if (s === Surf.DeepRough) src[i] += 0.6;
      else if (s === Surf.Green || s === Surf.Fairway) src[i] += 0.5;
    }
    // separable box blur with radius 5 (two passes ~ gaussian)
    const tmp = new Float32Array(MAP * MAP);
    const R = 5;
    const blur = (a: Float32Array, b: Float32Array, horiz: boolean) => {
      for (let y = 0; y < MAP; y++) {
        for (let x = 0; x < MAP; x++) {
          let s = 0;
          for (let k = -R; k <= R; k++) {
            const qx = horiz ? x + k : x;
            const qy = horiz ? y : y + k;
            if (qx < 0 || qy < 0 || qx >= MAP || qy >= MAP) continue;
            s += a[qy * MAP + qx];
          }
          b[y * MAP + x] = s;
        }
      }
    };
    blur(src, tmp, true);
    blur(tmp, this.scenery, false);
    for (let i = 0; i < MAP * MAP; i++) this.scenery[i] = Math.min(100, this.scenery[i] * 0.9);
  }

  sceneryAt(x: number, y: number): number {
    if (!inMap(x, y)) return 0;
    return this.scenery[tileIndex(x, y)];
  }

  // ------------------------------------------------------------ serialisation
  serialize(): WorldSave {
    const treeTypes = TREE_TYPES.slice();
    const trees: number[] = [];
    for (const t of this.trees.values()) {
      let ti = treeTypes.indexOf(t.type);
      if (ti < 0) ti = 0;
      trees.push(ti, Math.round(t.x * 10), Math.round(t.z * 10), Math.round(t.s * 100), Math.round(t.r * 100), t.nat ? 1 : 0);
    }
    return {
      seed: this.seed,
      surf: rle(this.surf),
      delta: rleDelta(this.delta),
      owned: Array.from(this.owned),
      condition: rle(this.condition),
      objects: Array.from(this.objects.values()).map((o) => ({ ...o })),
      trees,
      treeTypes,
      nextId: this.nextId,
    };
  }

  static load(s: WorldSave): World {
    const w = new World(s.seed);
    w.generateBaseOnly();
    unrle(s.surf, w.surf);
    unrleDelta(s.delta, w.delta);
    w.owned.set(s.owned);
    unrle(s.condition, w.condition);
    for (let i = 0; i < MAP * MAP; i++) if (w.surf[i] === Surf.Road) w.occ[i] = OCC_ROAD;
    w.trees.clear();
    w.treeAt.fill(0);
    for (let k = 0; k < s.trees.length; k += 6) {
      const type = s.treeTypes[s.trees[k]] ?? 'tree_oak';
      w.addTree(type, s.trees[k + 1] / 10, s.trees[k + 2] / 10, s.trees[k + 3] / 100, s.trees[k + 4] / 100, s.trees[k + 5] === 1, false);
    }
    for (const o of s.objects) {
      if (!ITEMS[o.type]) continue;
      w.addObject(o.type, o.x, o.y, o.rot, o.level, o.data, o.id);
    }
    w.nextId = Math.max(w.nextId, s.nextId);
    w.computeWater();
    w.recomputeHeights({ x0: 0, y0: 0, x1: MAP - 1, y1: MAP - 1 }, false);
    w.sceneryDirty = true;
    return w;
  }

  /** Regenerate only base heights (for loading). */
  private generateBaseOnly(): void {
    // generate() fills everything; we overwrite surfaces/trees afterwards
    this.generate();
  }
}

export interface WorldSave {
  seed: number;
  surf: number[];
  delta: number[];
  owned: number[];
  condition: number[];
  objects: PlacedObject[];
  trees: number[];
  treeTypes: string[];
  nextId: number;
}

function rle(a: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < a.length) {
    const v = a[i];
    let n = 1;
    while (i + n < a.length && a[i + n] === v && n < 65535) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}
function unrle(src: number[], dst: Uint8Array): void {
  let p = 0;
  for (let k = 0; k < src.length; k += 2) {
    dst.fill(src[k], p, p + src[k + 1]);
    p += src[k + 1];
  }
}
function rleDelta(a: Float32Array): number[] {
  // quantise to cm, then run-length encode
  const out: number[] = [];
  let i = 0;
  while (i < a.length) {
    const v = Math.round(a[i] * 100);
    let n = 1;
    while (i + n < a.length && Math.round(a[i + n] * 100) === v && n < 1e6) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}
function unrleDelta(src: number[], dst: Float32Array): void {
  let p = 0;
  for (let k = 0; k < src.length; k += 2) {
    dst.fill(src[k] / 100, p, p + src[k + 1]);
    p += src[k + 1];
  }
}
