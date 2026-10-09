// A* pathfinding over the tile grid with per-mode movement costs.
import { MAP, Surf, inMap, tileIndex } from '../core/constants';
import { ITEMS } from '../data/items';
import { OCC_ROAD, World } from './World';

export type MoveMode = 'walk' | 'cart' | 'staff';

const WALKABLE_KINDS = new Set(['carpark', 'target', 'practice', 'helipad', 'bay']);

export interface PathPoint {
  x: number;
  y: number;
}

class MinHeap {
  private ids: Int32Array;
  private keys: Float32Array;
  size = 0;
  constructor(cap: number) {
    this.ids = new Int32Array(cap);
    this.keys = new Float32Array(cap);
  }
  clear(): void {
    this.size = 0;
  }
  push(id: number, key: number): void {
    let i = this.size++;
    if (i >= this.ids.length) {
      const ni = new Int32Array(this.ids.length * 2);
      ni.set(this.ids);
      this.ids = ni;
      const nk = new Float32Array(this.keys.length * 2);
      nk.set(this.keys);
      this.keys = nk;
    }
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.ids[i] = this.ids[p];
      this.keys[i] = this.keys[p];
      i = p;
    }
    this.ids[i] = id;
    this.keys[i] = key;
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids[--this.size];
    const lastKey = this.keys[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= lastKey) break;
      this.ids[i] = this.ids[c];
      this.keys[i] = this.keys[c];
      i = c;
    }
    this.ids[i] = lastId;
    this.keys[i] = lastKey;
    return top;
  }
}

export class Pathfinder {
  private costs: Record<MoveMode, Float32Array | null> = { walk: null, cart: null, staff: null };
  private g = new Float32Array(MAP * MAP);
  private came = new Int32Array(MAP * MAP);
  private stamp = new Uint32Array(MAP * MAP);
  private closed = new Uint32Array(MAP * MAP);
  private gen = 1;
  private heap = new MinHeap(4096);

  constructor(private world: World) {
    const dirty = () => this.invalidate();
    world.on('surf', dirty);
    world.on('objectAdded', dirty);
    world.on('objectRemoved', dirty);
    world.on('treeAdded', dirty);
    world.on('treeRemoved', dirty);
    world.on('owned', dirty);
  }

  invalidate(): void {
    this.costs.walk = null;
    this.costs.cart = null;
    this.costs.staff = null;
  }

  private buildCosts(mode: MoveMode): Float32Array {
    const w = this.world;
    const c = new Float32Array(MAP * MAP);
    for (let y = 0; y < MAP; y++) {
      for (let x = 0; x < MAP; x++) {
        const i = tileIndex(x, y);
        const s = w.surf[i] as Surf;
        let cost = 1;
        const occ = w.occ[i];
        const owned = w.isOwnedTile(x, y);
        if (occ === OCC_ROAD) {
          c[i] = mode === 'cart' ? Infinity : 1.4;
          continue;
        }
        if (!owned) {
          c[i] = Infinity;
          continue;
        }
        if (occ > 0) {
          const o = w.objects.get(occ);
          const kind = o ? ITEMS[o.type].kind : 'deco';
          if (!WALKABLE_KINDS.has(kind) || (mode === 'cart' && kind !== 'carpark')) {
            c[i] = Infinity;
            continue;
          }
          cost = kind === 'bay' ? 3 : 1.1;
        }
        switch (s) {
          case Surf.Water: cost = Infinity; break;
          case Surf.Path: case Surf.Paving: cost *= 1; break;
          case Surf.Fairway: cost *= mode === 'cart' ? 1.6 : 1.3; break;
          case Surf.Rough: cost *= mode === 'cart' ? 2.0 : 1.6; break;
          case Surf.DeepRough: cost *= mode === 'cart' ? 4 : 2.6; break;
          case Surf.Tee: cost = mode === 'cart' ? Infinity : cost * 1.8; break;
          case Surf.Green: cost = mode === 'cart' ? Infinity : cost * (mode === 'staff' ? 2 : 5); break;
          case Surf.Bunker: cost = mode === 'cart' ? Infinity : cost * 7; break;
          default: break;
        }
        if (w.treeAt[i]) cost = mode === 'cart' ? Infinity : cost + 0.6;
        c[i] = cost;
      }
    }
    return c;
  }

  costGrid(mode: MoveMode): Float32Array {
    let c = this.costs[mode];
    if (!c) c = this.costs[mode] = this.buildCosts(mode);
    return c;
  }

  passable(x: number, y: number, mode: MoveMode): boolean {
    if (!inMap(x, y)) return false;
    return Number.isFinite(this.costGrid(mode)[tileIndex(x, y)]);
  }

  /** Nearest passable tile to (x,y) within radius. */
  nearestPassable(x: number, y: number, mode: MoveMode, radius = 6): PathPoint | null {
    if (this.passable(x, y, mode)) return { x, y };
    let best: PathPoint | null = null;
    let bd = Infinity;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d = dx * dx + dy * dy;
        if (d >= bd) continue;
        if (this.passable(x + dx, y + dy, mode)) {
          bd = d;
          best = { x: x + dx, y: y + dy };
        }
      }
    }
    return best;
  }

  /** Returns tile path from start to goal (inclusive), or null. maxNodes bounds work. */
  find(sx: number, sy: number, gx: number, gy: number, mode: MoveMode, maxNodes = 30000): PathPoint[] | null {
    const cost = this.costGrid(mode);
    const s = this.nearestPassable(sx, sy, mode, 4);
    const goal = this.nearestPassable(gx, gy, mode, 6);
    if (!s || !goal) return null;
    return this.search(cost, s.x, s.y, goal.x, goal.y, maxNodes, true);
  }

  /** A* over an arbitrary cost grid (Infinity = blocked). */
  search(cost: Float32Array, sx: number, sy: number, gx: number, gy: number, maxNodes = 30000, simplify = true): PathPoint[] | null {
    if (sx === gx && sy === gy) return [{ x: gx, y: gy }];
    const gen = ++this.gen;
    if (gen > 4e9) {
      this.gen = 1;
      this.stamp.fill(0);
      this.closed.fill(0);
    }
    const start = tileIndex(sx, sy);
    const goalI = tileIndex(gx, gy);
    const heap = this.heap;
    heap.clear();
    this.g[start] = 0;
    this.stamp[start] = gen;
    this.came[start] = -1;
    heap.push(start, this.heur(sx, sy, gx, gy));
    let expanded = 0;
    const SQ2 = Math.SQRT2;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goalI) return this.reconstruct(cur, simplify);
      if (++expanded > maxNodes) return null;
      const cx = cur % MAP;
      const cy = (cur / MAP) | 0;
      const gc = this.g[cur];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= MAP || ny >= MAP) continue;
          const ni = ny * MAP + nx;
          const tc = cost[ni];
          if (!Number.isFinite(tc)) continue;
          if (dx && dy) {
            // no corner cutting
            if (!Number.isFinite(cost[cy * MAP + nx]) || !Number.isFinite(cost[ny * MAP + cx])) continue;
          }
          const step = (dx && dy ? SQ2 : 1) * (tc + cost[cur]) * 0.5;
          const ng = gc + step;
          if (this.stamp[ni] === gen && ng >= this.g[ni]) continue;
          this.stamp[ni] = gen;
          this.g[ni] = ng;
          this.came[ni] = cur;
          heap.push(ni, ng + this.heur(nx, ny, gx, gy));
        }
      }
    }
    return null;
  }

  private heur(x: number, y: number, gx: number, gy: number): number {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return (dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)) * 1.0;
  }

  private reconstruct(end: number, simplify: boolean): PathPoint[] {
    const out: PathPoint[] = [];
    let c = end;
    while (c >= 0) {
      out.push({ x: c % MAP, y: (c / MAP) | 0 });
      c = this.came[c];
    }
    out.reverse();
    return simplify ? this.simplify(out) : out;
  }

  /** Drop collinear points to keep paths short. */
  private simplify(p: PathPoint[]): PathPoint[] {
    if (p.length < 3) return p;
    const out = [p[0]];
    for (let i = 1; i < p.length - 1; i++) {
      const a = out[out.length - 1];
      const b = p[i];
      const c = p[i + 1];
      const d1x = b.x - a.x, d1y = b.y - a.y;
      const d2x = c.x - b.x, d2y = c.y - b.y;
      if (Math.sign(d1x) === Math.sign(d2x) && Math.sign(d1y) === Math.sign(d2y) && d1x * d2y === d1y * d2x) continue;
      out.push(b);
    }
    out.push(p[p.length - 1]);
    return out;
  }
}
