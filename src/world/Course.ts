// Golf holes: routing, par, validation and rating.
import { MAP, MAINTAINED, Surf, TILE, YARDS_PER_WORLD, inMap, tileIndex } from '../core/constants';
import { ITEMS } from '../data/items';
import { Pathfinder } from './Pathfinder';
import { OCC_ROAD, World } from './World';

export interface HoleSave {
  id: number;
  tee: { x: number; y: number };
  pin: { x: number; y: number };
  name: string;
  record?: { strokes: number; by: string; day: number };
}

export interface V2 {
  x: number;
  z: number;
}

export interface HoleInfo {
  save: HoleSave;
  num: number;
  valid: boolean;
  issues: string[];
  route: V2[];
  /** Cumulative distance along route at each point. */
  routeDist: number[];
  length: number;
  yards: number;
  par: number;
  design: number;
  difficulty: number;
  beauty: number;
  condition: number;
  rating: number;
  corridor: number[];
  greenTiles: number[];
  teeWorld: V2;
  pinWorld: V2;
  /** Runtime: group currently playing the hole. */
  occupiedBy: number;
  /** Runtime: groups waiting on the tee. */
  queue: number[];
  roundsPlayed: number;
  totalStrokes: number;
}

export function parFor(yds: number): number {
  if (yds <= 250) return 3;
  if (yds <= 470) return 4;
  if (yds <= 700) return 5;
  return 6;
}

export class Course {
  holes: HoleInfo[] = [];
  private dirty = true;
  private nextId = 1;
  extraBeauty = 1;
  championshipGreens = false;

  constructor(private world: World, private pf: Pathfinder, saves: HoleSave[]) {
    for (const s of saves) this.holes.push(this.makeInfo(s));
    this.nextId = saves.reduce((m, s) => Math.max(m, s.id + 1), 1);
    this.renumber();
    const mark = () => (this.dirty = true);
    world.on('surf', mark);
    world.on('height', mark);
    world.on('objectAdded', mark);
    world.on('objectRemoved', mark);
    world.on('treeAdded', mark);
    world.on('treeRemoved', mark);
    world.on('owned', mark);
  }

  private makeInfo(save: HoleSave): HoleInfo {
    return {
      save, num: 0, valid: false, issues: [], route: [], routeDist: [], length: 0, yards: 0, par: 3,
      design: 0, difficulty: 0, beauty: 0, condition: 0, rating: 0, corridor: [], greenTiles: [],
      teeWorld: { x: (save.tee.x + 0.5) * TILE, z: (save.tee.y + 0.5) * TILE },
      pinWorld: { x: (save.pin.x + 0.5) * TILE, z: (save.pin.y + 0.5) * TILE },
      occupiedBy: 0, queue: [], roundsPlayed: 0, totalStrokes: 0,
    };
  }

  saves(): HoleSave[] {
    return this.holes.map((h) => h.save);
  }

  addHole(tee: { x: number; y: number }, pin: { x: number; y: number }): HoleInfo {
    const save: HoleSave = { id: this.nextId++, tee, pin, name: '' };
    const info = this.makeInfo(save);
    this.holes.push(info);
    this.renumber();
    this.dirty = true;
    this.update();
    return info;
  }

  removeHole(id: number): void {
    const i = this.holes.findIndex((h) => h.save.id === id);
    if (i >= 0) this.holes.splice(i, 1);
    this.renumber();
    this.dirty = true;
  }

  moveHole(id: number, dir: -1 | 1): void {
    const i = this.holes.findIndex((h) => h.save.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.holes.length) return;
    [this.holes[i], this.holes[j]] = [this.holes[j], this.holes[i]];
    this.renumber();
  }

  setTee(id: number, t: { x: number; y: number }): void {
    const h = this.byId(id);
    if (!h) return;
    h.save.tee = t;
    h.teeWorld = { x: (t.x + 0.5) * TILE, z: (t.y + 0.5) * TILE };
    this.dirty = true;
  }
  setPin(id: number, p: { x: number; y: number }): void {
    const h = this.byId(id);
    if (!h) return;
    h.save.pin = p;
    h.pinWorld = { x: (p.x + 0.5) * TILE, z: (p.y + 0.5) * TILE };
    this.dirty = true;
  }

  byId(id: number): HoleInfo | undefined {
    return this.holes.find((h) => h.save.id === id);
  }

  private renumber(): void {
    this.holes.forEach((h, i) => (h.num = i + 1));
  }

  markDirty(): void {
    this.dirty = true;
  }

  validHoles(): HoleInfo[] {
    return this.holes.filter((h) => h.valid);
  }

  averageRating(): number {
    const v = this.validHoles();
    if (!v.length) return 0;
    return v.reduce((s, h) => s + h.rating, 0) / v.length;
  }

  averageDifficulty(): number {
    const v = this.validHoles();
    if (!v.length) return 0.3;
    return v.reduce((s, h) => s + h.difficulty, 0) / v.length;
  }

  totalPar(): number {
    return this.validHoles().reduce((s, h) => s + h.par, 0);
  }

  /** Variety bonus 0..1: mix of par 3/4/5 holes. */
  variety(): number {
    const v = this.validHoles();
    if (v.length < 3) return 0;
    const pars = new Set(v.map((h) => h.par));
    return (pars.size - 1) / 2;
  }

  /** Recompute routing/ratings if the world changed. */
  update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.world.updateScenery();
    const cost = this.routeCostGrid();
    for (const h of this.holes) this.analyse(h, cost);
    // overlap penalties between holes
    for (const h of this.holes) {
      if (!h.valid) continue;
      let crossings = 0;
      for (const o of this.holes) {
        if (o === h || !o.valid) continue;
        if (routesCross(h.route, o.route) || minRouteDist(h.route, o.route) < TILE * 2.2) crossings++;
      }
      if (crossings) {
        h.issues.push(crossings === 1 ? 'Too close to another hole' : `Too close to ${crossings} other holes`);
        h.design = Math.max(0, h.design - 12 * crossings);
      }
      h.rating = this.finalRating(h);
    }
    this.updateCondition();
  }

  private routeCostGrid(): Float32Array {
    const w = this.world;
    const c = new Float32Array(MAP * MAP);
    for (let i = 0; i < MAP * MAP; i++) {
      const x = i % MAP;
      const y = (i / MAP) | 0;
      if (!w.isOwnedTile(x, y) || w.occ[i] === OCC_ROAD) {
        c[i] = Infinity;
        continue;
      }
      let v: number;
      switch (w.surf[i] as Surf) {
        case Surf.Fairway: case Surf.Green: case Surf.Tee: v = 1; break;
        case Surf.Rough: v = 2.4; break;
        case Surf.DeepRough: v = 3.6; break;
        case Surf.Bunker: v = 3; break;
        case Surf.Water: v = 3.5; break;
        case Surf.Path: v = 2; break;
        default: v = 3;
      }
      if (w.treeAt[i]) v += 6;
      const occ = w.occ[i];
      if (occ > 0) {
        const o = w.objects.get(occ);
        const k = o ? ITEMS[o.type].kind : '';
        v += k === 'course_prop' || k === 'deco' || k === 'bench' || k === 'bin' || k === 'lamp' || k === 'target' ? 4 : 40;
      }
      c[i] = v;
    }
    return c;
  }

  private analyse(h: HoleInfo, cost: Float32Array): void {
    const w = this.world;
    const issues: string[] = [];
    h.teeWorld = { x: (h.save.tee.x + 0.5) * TILE, z: (h.save.tee.y + 0.5) * TILE };
    h.pinWorld = { x: (h.save.pin.x + 0.5) * TILE, z: (h.save.pin.y + 0.5) * TILE };
    const teeS = w.surfAtTile(h.save.tee.x, h.save.tee.y);
    const pinS = w.surfAtTile(h.save.pin.x, h.save.pin.y);
    if (teeS !== Surf.Tee) issues.push('Tee markers must sit on a Tee Box');
    if (pinS !== Surf.Green) issues.push('The pin must be on a Green');
    if (!w.isOwnedTile(h.save.tee.x, h.save.tee.y) || !w.isOwnedTile(h.save.pin.x, h.save.pin.y)) issues.push('Hole is outside your land');

    let route: V2[] = [];
    const path = this.pf.search(cost, h.save.tee.x, h.save.tee.y, h.save.pin.x, h.save.pin.y, 60000, false);
    if (!path) {
      issues.push('No playable route from tee to green');
      route = [h.teeWorld, h.pinWorld];
    } else {
      const pts = path.map((p) => ({ x: (p.x + 0.5) * TILE, z: (p.y + 0.5) * TILE }));
      route = rdp(pts, TILE * 1.4);
      route[0] = h.teeWorld;
      route[route.length - 1] = h.pinWorld;
    }
    h.route = route;
    h.routeDist = [0];
    for (let i = 1; i < route.length; i++) h.routeDist.push(h.routeDist[i - 1] + Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z));
    h.length = h.routeDist[h.routeDist.length - 1];
    h.yards = Math.round(h.length * YARDS_PER_WORLD);
    h.par = parFor(h.yards);
    if (h.yards < 90) issues.push('Too short (minimum 90 yards)');
    if (h.yards > 700) issues.push('Too long (maximum 700 yards)');

    // green body around the pin
    h.greenTiles = floodTiles(w, h.save.pin.x, h.save.pin.y, Surf.Green, 400);
    const teeTiles = floodTiles(w, h.save.tee.x, h.save.tee.y, Surf.Tee, 200);

    h.valid = issues.length === 0;
    h.issues = issues;
    if (!h.valid) {
      h.design = 0;
      h.rating = 0;
      h.corridor = [];
      return;
    }

    // ---- design analysis
    const samples = sampleRoute(route, 4);
    let fair = 0, considered = 0, scen = 0;
    const startCut = Math.min(h.length * 0.12, 40);
    for (const s of samples) {
      const tx = Math.floor(s.x / TILE);
      const ty = Math.floor(s.z / TILE);
      scen += w.sceneryAt(tx, ty);
      if (s.d < startCut) continue;
      considered++;
      const sf = w.surfAtTile(tx, ty);
      if (sf === Surf.Fairway || sf === Surf.Green || sf === Surf.Tee) fair++;
      else if (sf === Surf.Water && h.par === 3) fair += 0.6; // carries over water on par 3s are fine
    }
    const cov = considered ? fair / considered : 0;
    const fwScore = Math.min(1, cov / 0.7) * 100;
    if (cov < 0.4 && h.par > 3) issues.push('Needs more fairway along the line of play');

    const gt = h.greenTiles.length;
    let greenScore: number;
    if (gt < 4) greenScore = 25;
    else if (gt < 8) greenScore = 60;
    else if (gt <= 26) greenScore = 100;
    else if (gt <= 45) greenScore = 75;
    else greenScore = 50;
    if (gt < 6) issues.push('Green is very small');
    if (gt > 45) issues.push('Green is huge');
    if (teeTiles.length < 2) issues.push('Tee box is tiny');

    // hazards near the line of play
    const near = new Set<number>();
    let bunkers = 0, water = 0, greenside = 0, treesNear = 0;
    for (const s of samples) {
      const tx = Math.floor(s.x / TILE);
      const ty = Math.floor(s.z / TILE);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const x = tx + dx, y = ty + dy;
        if (!inMap(x, y)) continue;
        const i = tileIndex(x, y);
        if (near.has(i)) continue;
        near.add(i);
        const sf = w.surf[i];
        if (sf === Surf.Bunker) bunkers++;
        else if (sf === Surf.Water) water++;
        if (w.treeAt[i]) treesNear++;
      }
    }
    for (const gtI of h.greenTiles) {
      const x = gtI % MAP, y = (gtI / MAP) | 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (inMap(x + dx, y + dy) && w.surf[tileIndex(x + dx, y + dy)] === Surf.Bunker) greenside++;
      }
    }
    const hazardPts = bunkers * 1 + water * 0.8 + Math.min(10, greenside) * 0.8;
    const challenge = Math.min(100, 20 + hazardPts * 4);
    if (hazardPts < 3) issues.push('A bit plain — add bunkers or water');

    const avgScen = samples.length ? scen / samples.length : 0;
    const beauty = Math.min(100, (avgScen * 1.6 + Math.min(20, treesNear) * 1.2) * this.extraBeauty);
    if (beauty < 25) issues.push('Could use more trees and scenery');

    // tee-side props
    let props = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const o = w.objectAtTile(h.save.tee.x + dx, h.save.tee.y + dy);
      if (o && (o.type === 'ball_washer' || o.type === 'tee_sign' || o.type === 'bench')) props++;
    }
    const propBonus = Math.min(8, props * 3);

    // danger: route in front of range bays
    let danger = 0;
    for (const b of w.objectsOfKind('bay')) {
      const c = w.objectCenter(b);
      const f = w.objectFront(b); // bays hit towards -front
      for (const s of samples) {
        const dx = s.x - c.x, dz = s.z - c.z;
        const along = -(dx * f.x + dz * f.z);
        const side = Math.abs(dx * f.z - dz * f.x);
        if (along > 0 && along < 170 && side < along * 0.35 + 6) {
          danger++;
          break;
        }
      }
    }
    if (danger) issues.push('Range balls fly across this hole!');

    // length suitability
    let lenScore = 100;
    const y = h.yards;
    if (h.par === 3) lenScore = y < 110 ? 70 : y > 235 ? 80 : 100;
    else if (h.par === 4) lenScore = y < 300 ? 80 : y > 455 ? 85 : 100;
    else if (h.par === 5) lenScore = y > 620 ? 80 : 100;
    else lenScore = 50;

    h.beauty = beauty;
    h.design = Math.max(0, Math.min(100,
      fwScore * 0.3 + greenScore * 0.17 + challenge * 0.18 + beauty * 0.25 + lenScore * 0.1 + propBonus - Math.min(3, danger) * 15));
    // difficulty 0..1
    const avgWidth = this.fairwayWidth(samples);
    h.difficulty = Math.max(0, Math.min(1,
      0.15 + hazardPts * 0.018 + (gt < 10 ? 0.12 : 0) + (avgWidth < 4 ? 0.12 : avgWidth < 6 ? 0.05 : 0) + (h.yards / (h.par * 140)) * 0.15 + Math.min(0.15, treesNear * 0.004)));

    // corridor of maintained tiles
    const corridor = new Set<number>();
    for (const s of samples) {
      const tx = Math.floor(s.x / TILE);
      const ty = Math.floor(s.z / TILE);
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const x = tx + dx, yy = ty + dy;
        if (!inMap(x, yy)) continue;
        const i = tileIndex(x, yy);
        if (MAINTAINED.has(w.surf[i] as Surf)) corridor.add(i);
      }
    }
    for (const i of h.greenTiles) corridor.add(i);
    h.corridor = Array.from(corridor);
  }

  private fairwayWidth(samples: { x: number; z: number; d: number; dirx: number; dirz: number }[]): number {
    const w = this.world;
    let total = 0, n = 0;
    for (let k = 0; k < samples.length; k += 4) {
      const s = samples[k];
      const px = -s.dirz, pz = s.dirx;
      let width = 0;
      for (const sign of [-1, 1]) {
        for (let d = 0; d < 12; d++) {
          const sx = s.x + px * d * TILE * sign;
          const sz = s.z + pz * d * TILE * sign;
          const sf = w.surfAt(sx, sz);
          if (sf === Surf.Fairway || sf === Surf.Green || sf === Surf.Tee) width += 0.5;
          else break;
        }
      }
      total += width;
      n++;
    }
    return n ? total / n : 0;
  }

  private finalRating(h: HoleInfo): number {
    if (!h.valid) return 0;
    const condW = this.championshipGreens ? 0.3 : 0.25;
    return Math.max(0, Math.min(100, h.design * (1 - condW) + h.condition * condW));
  }

  /** Average turf condition per hole (cheap; call every few game minutes). */
  updateCondition(): void {
    const cond = this.world.condition;
    for (const h of this.holes) {
      if (!h.valid || !h.corridor.length) {
        h.condition = 0;
        continue;
      }
      let s = 0;
      for (const i of h.corridor) s += cond[i];
      h.condition = (s / h.corridor.length / 255) * 100;
      h.rating = this.finalRating(h);
    }
  }

  /** Point along the route at distance d (clamped). */
  pointAt(h: HoleInfo, d: number): V2 {
    const r = h.route;
    if (d <= 0) return { ...r[0] };
    for (let i = 1; i < r.length; i++) {
      if (h.routeDist[i] >= d) {
        const seg = h.routeDist[i] - h.routeDist[i - 1];
        const t = seg > 0 ? (d - h.routeDist[i - 1]) / seg : 0;
        return { x: r[i - 1].x + (r[i].x - r[i - 1].x) * t, z: r[i - 1].z + (r[i].z - r[i - 1].z) * t };
      }
    }
    return { ...r[r.length - 1] };
  }

  /** Distance along the route of the closest point to p. */
  projectOnRoute(h: HoleInfo, p: V2): number {
    let best = 0;
    let bd = Infinity;
    const r = h.route;
    for (let i = 1; i < r.length; i++) {
      const ax = r[i - 1].x, az = r[i - 1].z;
      const bx = r[i].x - ax, bz = r[i].z - az;
      const L2 = bx * bx + bz * bz || 1;
      let t = ((p.x - ax) * bx + (p.z - az) * bz) / L2;
      t = Math.max(0, Math.min(1, t));
      const qx = ax + bx * t, qz = az + bz * t;
      const d = (p.x - qx) ** 2 + (p.z - qz) ** 2;
      if (d < bd) {
        bd = d;
        best = h.routeDist[i - 1] + Math.sqrt(L2) * t;
      }
    }
    return best;
  }
}

// ------------------------------------------------------------------ helpers
function floodTiles(w: World, x: number, y: number, s: Surf, max: number): number[] {
  if (!inMap(x, y) || w.surf[tileIndex(x, y)] !== s) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  const st = [tileIndex(x, y)];
  seen.add(st[0]);
  while (st.length && out.length < max) {
    const t = st.pop()!;
    out.push(t);
    const tx = t % MAP, ty = (t / MAP) | 0;
    const nb: [number, number][] = [[tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]];
    for (const [nx, ny] of nb) {
      if (!inMap(nx, ny)) continue;
      const i = tileIndex(nx, ny);
      if (seen.has(i) || w.surf[i] !== s) continue;
      seen.add(i);
      st.push(i);
    }
  }
  return out;
}

function rdp(pts: V2[], eps: number): V2[] {
  if (pts.length < 3) return pts.slice();
  let maxD = 0;
  let idx = 0;
  const a = pts[0];
  const b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], a, b);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > eps) {
    const l = rdp(pts.slice(0, idx + 1), eps);
    const r = rdp(pts.slice(idx), eps);
    return l.slice(0, -1).concat(r);
  }
  return [a, b];
}

function segDist(p: V2, a: V2, b: V2): number {
  const bx = b.x - a.x, bz = b.z - a.z;
  const L2 = bx * bx + bz * bz;
  if (L2 === 0) return Math.hypot(p.x - a.x, p.z - a.z);
  let t = ((p.x - a.x) * bx + (p.z - a.z) * bz) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + bx * t), p.z - (a.z + bz * t));
}

export function sampleRoute(route: V2[], step: number): { x: number; z: number; d: number; dirx: number; dirz: number }[] {
  const out: { x: number; z: number; d: number; dirx: number; dirz: number }[] = [];
  let acc = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L < 1e-6) continue;
    const dx = (b.x - a.x) / L, dz = (b.z - a.z) / L;
    for (let t = 0; t < L; t += step) out.push({ x: a.x + dx * t, z: a.z + dz * t, d: acc + t, dirx: dx, dirz: dz });
    acc += L;
  }
  const last = route[route.length - 1];
  if (route.length > 1) {
    const a = route[route.length - 2];
    const L = Math.hypot(last.x - a.x, last.z - a.z) || 1;
    out.push({ x: last.x, z: last.z, d: acc, dirx: (last.x - a.x) / L, dirz: (last.z - a.z) / L });
  }
  return out;
}

function segIntersect(a: V2, b: V2, c: V2, d: V2): boolean {
  const o = (p: V2, q: V2, r: V2) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

function routesCross(r1: V2[], r2: V2[]): boolean {
  for (let i = 1; i < r1.length; i++) for (let j = 1; j < r2.length; j++) if (segIntersect(r1[i - 1], r1[i], r2[j - 1], r2[j])) return true;
  return false;
}

function minRouteDist(r1: V2[], r2: V2[]): number {
  let m = Infinity;
  const s1 = sampleRoute(r1, 6);
  for (const p of s1) {
    for (let j = 1; j < r2.length; j++) m = Math.min(m, segDist(p, r2[j - 1], r2[j]));
  }
  return m;
}
