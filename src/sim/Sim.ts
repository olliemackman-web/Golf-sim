// Runtime simulation: entities, movement, coroutines, range balls, litter, arrivals.
import { MAP, ROAD_ROW, Surf, TILE, WORLD, tileIndex } from '../core/constants';
import { RNG } from '../core/rng';
import { ITEMS } from '../data/items';
import { BAY_BALL, BAY_STAND, CARPARK_ENTRY, CARPARK_SLOTS, LANE_EAST_Z, LANE_WEST_Z } from '../data/layout';
import type { MoveMode } from '../world/Pathfinder';
import type { PlacedObject } from '../world/World';
import { BallEntity, Colors, Group, Litter, Person, Vehicle, VehicleType, newEntityId, randomColors } from './agents';
import type { Game } from './Game';

const WALK_SPEED = 5.2;
const CART_SPEED = 10;

export interface FieldBalls {
  x: Float32Array;
  z: Float32Array;
  n: number;
  version: number;
}

export interface ThoughtTally {
  text: string;
  good: boolean;
  count: number;
}

export class Sim {
  people: Person[] = [];
  vehicles: Vehicle[] = [];
  groups: Group[] = [];
  balls: BallEntity[] = [];
  field: FieldBalls = { x: new Float32Array(12000), z: new Float32Array(12000), n: 0, version: 0 };
  litter: Litter[] = [];
  litterVersion = 0;
  /** bay object id -> person id using it */
  bayUser = new Map<number, number>();
  /** object id -> people currently inside/using */
  occupancy = new Map<number, number>();
  /** carpark object id -> slot occupant group ids (0 = free) */
  slots = new Map<number, number[]>();
  thoughts = new Map<string, ThoughtTally>();
  rng: RNG;
  /** Balls currently in buckets being hit (counted out of the dispenser). */
  ballsInUse = 0;
  /** Accumulated through-traffic timer. */
  private trafficT = 3;
  lessonsActive = 0;

  constructor(public game: Game) {
    this.rng = new RNG((Date.now() & 0xffffff) + 17);
    game.world.on('objectRemoved', (o) => this.onObjectRemoved(o));
  }

  get world() {
    return this.game.world;
  }

  // ---------------------------------------------------------------- entities
  addPerson(colors: Colors = randomColors(this.rng), x = 0, z = 0): Person {
    const p = new Person(colors);
    p.x = x;
    p.z = z;
    p.y = this.world.heightAt(x, z);
    p.speed = WALK_SPEED * this.rng.range(0.9, 1.1);
    p.lateral = this.rng.range(-0.9, 0.9);
    this.people.push(p);
    return p;
  }

  removePerson(p: Person): void {
    p.removed = true;
    p.visible = false;
    if (p.vehicle && p.vehicle.type === 'golf_cart') this.removeVehicle(p.vehicle);
    p.vehicle = null;
    for (const [bay, pid] of this.bayUser) if (pid === p.id) this.bayUser.delete(bay);
  }

  addVehicle(type: VehicleType, x: number, z: number, heading = 0): Vehicle {
    const v = new Vehicle(type);
    v.x = x;
    v.z = z;
    v.heading = heading;
    v.y = this.world.heightAt(x, z);
    v.speed = type === 'car' ? 13 : type === 'golf_cart' ? CART_SPEED : type === 'mower' ? 4.5 : type === 'ball_picker' ? 4 : 10;
    this.vehicles.push(v);
    return v;
  }

  removeVehicle(v: Vehicle): void {
    v.removed = true;
    v.visible = false;
  }

  addBall(): BallEntity {
    const b = new BallEntity();
    this.balls.push(b);
    return b;
  }

  playBall(b: BallEntity, keys: number[], onEnd?: () => void): void {
    b.keys = keys;
    b.t = 0;
    b.state = 'flying';
    b.x = keys[1];
    b.y = keys[2];
    b.z = keys[3];
    b.onEnd = onEnd ?? null;
  }

  // ---------------------------------------------------------------- movement
  /** Path a person to a world point. Returns false if unreachable. */
  walkTo(p: Person, x: number, z: number, mode: MoveMode = 'walk', exact = true): boolean {
    const sx = Math.floor(p.x / TILE), sy = Math.floor(p.z / TILE);
    const gx = Math.floor(x / TILE), gy = Math.floor(z / TILE);
    const path = this.game.pf.find(sx, sy, gx, gy, mode);
    if (!path) return false;
    const pts: { x: number; z: number }[] = [];
    for (let i = 1; i < path.length - 1; i++) {
      // offset waypoints sideways per person so crowds don't walk in single file
      pts.push({ x: (path[i].x + 0.5) * TILE + p.lateral, z: (path[i].y + 0.5) * TILE - p.lateral * 0.7 });
    }
    if (exact) pts.push({ x, z });
    else pts.push({ x: (path[path.length - 1].x + 0.5) * TILE, z: (path[path.length - 1].y + 0.5) * TILE });
    p.path = pts;
    p.pathI = 0;
    p.moving = true;
    if (!p.vehicle) p.setAnim('walk');
    return true;
  }

  /** Teleport-free straight walk for short distances (e.g. stepping up to the ball). */
  walkStraight(p: Person, x: number, z: number): void {
    p.path = [{ x, z }];
    p.pathI = 0;
    p.moving = true;
    if (!p.vehicle) p.setAnim('walk');
  }

  driveVehicle(v: Vehicle, x: number, z: number, mode: MoveMode): boolean {
    const path = this.game.pf.find(Math.floor(v.x / TILE), Math.floor(v.z / TILE), Math.floor(x / TILE), Math.floor(z / TILE), mode);
    if (!path) return false;
    const pts = path.slice(1).map((p) => ({ x: (p.x + 0.5) * TILE, z: (p.y + 0.5) * TILE }));
    if (pts.length) pts[pts.length - 1] = { x, z };
    else pts.push({ x, z });
    v.path = smoothPath(pts);
    v.pathI = 0;
    v.moving = true;
    return true;
  }

  private moveAlong(e: { x: number; z: number; path: { x: number; z: number }[]; pathI: number; moving: boolean }, speed: number, dt: number): number {
    let remaining = speed * dt;
    let heading = NaN;
    while (remaining > 0 && e.pathI < e.path.length) {
      const t = e.path[e.pathI];
      const dx = t.x - e.x, dz = t.z - e.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) heading = Math.atan2(dx, dz);
      if (d <= remaining) {
        e.x = t.x;
        e.z = t.z;
        remaining -= d;
        e.pathI++;
      } else {
        e.x += (dx / d) * remaining;
        e.z += (dz / d) * remaining;
        remaining = 0;
      }
    }
    if (e.pathI >= e.path.length) {
      e.moving = false;
      e.path = [];
      e.pathI = 0;
    }
    return heading;
  }

  // ---------------------------------------------------------------- update
  update(dt: number): void {
    const w = this.world;
    // through traffic on the road
    this.trafficT -= dt;
    if (this.trafficT <= 0) {
      this.trafficT = this.rng.range(4, 14) / (this.game.isDaytime() ? 1 : 3);
      this.spawnPassingCar();
    }

    // coroutines
    this.runVehicleCos(dt);
    for (const g of this.groups) {
      if (g.removed || !g.co) continue;
      try {
        if (g.co.next(dt).done) g.co = null;
      } catch (e) {
        console.error('group coroutine error', e);
        g.co = null;
        this.disbandGroup(g);
      }
    }
    for (const p of this.people) {
      if (p.removed || !p.co) continue;
      try {
        if (p.co.next(dt).done) p.co = null;
      } catch (e) {
        console.error('person coroutine error', e);
        p.co = null;
      }
    }

    // movement
    for (const p of this.people) {
      if (p.removed) continue;
      p.animT += dt;
      p.busy += dt;
      if (p.vehicle) {
        const v = p.vehicle;
        p.x = v.x;
        p.z = v.z;
        p.y = v.y;
        p.heading = v.heading;
        continue;
      }
      if (p.moving) {
        const tx = Math.floor(p.x / TILE), ty = Math.floor(p.z / TILE);
        const s = w.surfAtTile(tx, ty);
        let mul = s === Surf.Path || s === Surf.Paving || s === Surf.Road ? 1.15 : s === Surf.DeepRough ? 0.8 : s === Surf.Bunker ? 0.7 : 1;
        if (p.kind === 'staff') mul *= 0.9;
        const h = this.moveAlong(p, p.speed * mul, dt);
        if (!Number.isNaN(h)) p.targetHeading = h;
        if (!p.moving && p.anim === 'walk') p.setAnim('idle');
      }
      if (p.targetHeading !== null) {
        let d = p.targetHeading - p.heading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const k = Math.min(1, dt * 10);
        p.heading += d * k;
        if (Math.abs(d) < 0.01) p.targetHeading = null;
      }
      p.y = w.heightAt(p.x, p.z);
    }
    for (const v of this.vehicles) {
      if (v.removed) continue;
      if (v.moving) {
        const prevX = v.x, prevZ = v.z;
        const h = this.moveAlong(v, v.speed, dt);
        if (!Number.isNaN(h)) {
          let d = h - v.heading;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          v.heading += d * Math.min(1, dt * 6);
        }
        void prevX;
        void prevZ;
      }
      v.y = v.type === 'car' && v.z > ROAD_ROW * TILE - 0.5 ? w.roadHeight() : w.heightAt(v.x, v.z);
    }

    // balls
    for (const b of this.balls) {
      if (b.removed || (b.state !== 'flying' && b.state !== 'rolling')) continue;
      b.t += dt;
      const k = b.keys;
      const n = k.length / 4;
      const end = k[(n - 1) * 4];
      if (b.t >= end) {
        b.x = k[(n - 1) * 4 + 1];
        b.y = k[(n - 1) * 4 + 2];
        b.z = k[(n - 1) * 4 + 3];
        b.state = 'rest';
        const cb = b.onEnd;
        b.onEnd = null;
        if (b.removeAtEnd) b.removed = true;
        cb?.();
        continue;
      }
      for (let i = 1; i < n; i++) {
        const t1 = k[i * 4];
        if (b.t <= t1) {
          const t0 = k[(i - 1) * 4];
          const u = t1 > t0 ? (b.t - t0) / (t1 - t0) : 1;
          b.x = k[(i - 1) * 4 + 1] + (k[i * 4 + 1] - k[(i - 1) * 4 + 1]) * u;
          b.y = k[(i - 1) * 4 + 2] + (k[i * 4 + 2] - k[(i - 1) * 4 + 2]) * u;
          b.z = k[(i - 1) * 4 + 3] + (k[i * 4 + 3] - k[(i - 1) * 4 + 3]) * u;
          break;
        }
      }
    }

    // cleanup
    if (this.people.some((p) => p.removed)) this.people = this.people.filter((p) => !p.removed);
    if (this.vehicles.some((v) => v.removed)) this.vehicles = this.vehicles.filter((v) => !v.removed);
    if (this.balls.some((b) => b.removed)) this.balls = this.balls.filter((b) => !b.removed);
    if (this.groups.some((g) => g.removed)) this.groups = this.groups.filter((g) => !g.removed);
  }

  disbandGroup(g: Group): void {
    g.removed = true;
    for (const m of g.members) this.removePerson(m);
    if (g.car) this.removeVehicle(g.car);
    for (const c of g.carts) this.removeVehicle(c);
    this.releaseSlot(g);
    for (const b of g.balls.values()) {
      const be = this.balls.find((x) => x.id === b.ballId);
      if (be) be.removed = true;
    }
    for (const h of this.game.course.holes) {
      if (h.occupiedBy === g.id) h.occupiedBy = 0;
      const qi = h.queue.indexOf(g.id);
      if (qi >= 0) h.queue.splice(qi, 1);
    }
  }

  visitorCount(): number {
    let c = 0;
    for (const p of this.people) if (p.kind === 'visitor' && !p.removed) c++;
    return c;
  }

  // ---------------------------------------------------------------- objects & facilities
  private onObjectRemoved(o: PlacedObject): void {
    this.bayUser.delete(o.id);
    this.occupancy.delete(o.id);
    const s = this.slots.get(o.id);
    if (s) {
      this.slots.delete(o.id);
      for (const g of this.groups) if (g.carpark === o.id) {
        g.carpark = 0;
        g.carSlot = -1;
        if (g.car) g.car.visible = false;
      }
    }
  }

  nearestObject(pred: (o: PlacedObject) => boolean, x: number, z: number): PlacedObject | null {
    let best: PlacedObject | null = null;
    let bd = Infinity;
    for (const o of this.world.objects.values()) {
      if (!pred(o)) continue;
      const c = this.world.objectCenter(o);
      const d = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /** World position just outside an object's entrance. */
  entrancePoint(o: PlacedObject): { x: number; z: number } {
    const t = this.world.entranceTile(o);
    const f = this.world.objectFront(o);
    return { x: (t.x + 0.5) * TILE - f.x * 1.2, z: (t.y + 0.5) * TILE - f.z * 1.2 };
  }

  enter(o: PlacedObject, delta: number): void {
    this.occupancy.set(o.id, Math.max(0, (this.occupancy.get(o.id) ?? 0) + delta));
  }

  // ---------------------------------------------------------------- range
  freeBay(x: number, z: number, preferTier = 0): PlacedObject | null {
    let best: PlacedObject | null = null;
    let bd = Infinity;
    const night = !this.game.isDaytime();
    for (const o of this.world.objects.values()) {
      const def = ITEMS[o.type];
      if (def.kind !== 'bay' || this.bayUser.has(o.id)) continue;
      if (night && !this.game.isLitAt(this.world.objectCenter(o))) continue;
      if (this.game.weatherRain() && (def.tier ?? 1) < 2 && this.rng.chance(0.7)) continue;
      const c = this.world.objectCenter(o);
      let d = Math.hypot(c.x - x, c.z - z);
      if (preferTier && (def.tier ?? 1) === preferTier) d -= 60;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  bayStand(o: PlacedObject): { x: number; z: number; face: { x: number; z: number } } {
    const s = this.world.localToWorld(o, BAY_STAND.x, BAY_STAND.z);
    const b = this.world.localToWorld(o, BAY_BALL.x, BAY_BALL.z);
    return { x: s.x, z: s.z, face: b };
  }

  /** Launch a range ball from a bay. Returns the landing point. */
  launchRangeBall(o: PlacedObject, skill: number, player = false): { x: number; z: number } {
    const w = this.world;
    const ball = w.localToWorld(o, BAY_BALL.x, BAY_BALL.z);
    const front = w.objectFront(o);
    const dir = Math.atan2(-front.x, -front.z) + this.rng.gauss() * (0.12 - 0.08 * skill);
    const r = this.rng.next();
    // club mix: wedges, irons, woods
    const full = r < 0.25 ? 0.35 : r < 0.8 ? 0.6 : 0.95;
    let carry = (40 + 120 * skill) * full * this.rng.range(0.75, 1.1) + 12;
    if (this.rng.chance(0.1 - 0.08 * skill)) carry *= 0.45;
    const apex = 4 + carry * 0.14;
    const dur = 0.9 + carry * 0.012;
    const ex = ball.x + Math.sin(dir) * carry;
    const ez = ball.z + Math.cos(dir) * carry;
    const y0 = w.heightAt(ball.x, ball.z) + 0.05;
    const y1 = w.heightAt(ex, ez);
    const keys: number[] = [];
    const N = 10;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      keys.push(dur * u, ball.x + (ex - ball.x) * u, y0 + (y1 - y0) * u + apex * Math.sin(Math.PI * Math.pow(u, 0.9)), ball.z + (ez - ball.z) * u);
    }
    // a short bounce-roll
    const rx = ex + Math.sin(dir) * carry * 0.06, rz = ez + Math.cos(dir) * carry * 0.06;
    keys.push(dur + 0.5, rx, w.heightAt(rx, rz) + 0.05, rz);
    const b = this.addBall();
    b.removeAtEnd = true;
    b.size = 1;
    this.playBall(b, keys, () => this.rangeBallLanded(rx, rz, player));
    return { x: ex, z: ez };
  }

  private rangeBallLanded(x: number, z: number, player: boolean): void {
    const w = this.world;
    const s = w.surfAt(x, z);
    const tx = Math.floor(x / TILE), ty = Math.floor(z / TILE);
    const o = w.objectAtTile(tx, ty);
    const blocked = o && !['target', 'practice'].includes(ITEMS[o.type].kind);
    if (s === Surf.Water || !w.isOwnedWorld(x, z) || blocked || z > ROAD_ROW * TILE) {
      if (s === Surf.Water) this.game.events.emit('splash', { x, z, small: true });
      if (!player) {
        this.game.state.ballsOwned = Math.max(0, this.game.state.ballsOwned - 5);
        this.game.lostBallsToday += 5;
      }
      return;
    }
    if (player) return;
    this.addFieldBall(x, z);
  }

  addFieldBall(x: number, z: number): void {
    const f = this.field;
    if (f.n >= f.x.length) return;
    f.x[f.n] = x;
    f.z[f.n] = z;
    f.n++;
    f.version++;
  }

  /** Remove up to max field balls within r of (x,z). Returns count removed. */
  collectFieldBalls(x: number, z: number, r: number, max: number): number {
    const f = this.field;
    let c = 0;
    const r2 = r * r;
    for (let i = f.n - 1; i >= 0 && c < max; i--) {
      const dx = f.x[i] - x, dz = f.z[i] - z;
      if (dx * dx + dz * dz <= r2) {
        f.n--;
        f.x[i] = f.x[f.n];
        f.z[i] = f.z[f.n];
        c++;
      }
    }
    if (c) f.version++;
    return c;
  }

  /** Find a dense cluster of field balls (owned land only). */
  findBallCluster(fromX: number, fromZ: number): { x: number; z: number; n: number } | null {
    const f = this.field;
    if (f.n === 0) return null;
    const CELL = 16;
    const cells = new Map<number, { n: number; x: number; z: number }>();
    for (let i = 0; i < f.n; i++) {
      const k = Math.floor(f.x[i] / CELL) * 1000 + Math.floor(f.z[i] / CELL);
      const c = cells.get(k);
      if (c) {
        c.n++;
        c.x += f.x[i];
        c.z += f.z[i];
      } else cells.set(k, { n: 1, x: f.x[i], z: f.z[i] });
    }
    let best: { x: number; z: number; n: number } | null = null;
    let bs = -Infinity;
    for (const c of cells.values()) {
      const cx = c.x / c.n, cz = c.z / c.n;
      const d = Math.hypot(cx - fromX, cz - fromZ);
      const score = c.n * 3 - d * 0.08;
      if (score > bs) {
        bs = score;
        best = { x: cx, z: cz, n: c.n };
      }
    }
    return best;
  }

  /** Range balls available in dispensers. */
  ballsAvailable(): number {
    return this.game.state.ballsOwned - this.field.n * 5 - this.ballsInUse - this.ballsCarried();
  }

  ballsCarried(): number {
    let c = 0;
    for (const v of this.vehicles) if (v.type === 'ball_picker') c += v.load * 5;
    for (const p of this.people) if (p.role === 'range' && !p.vehicle) c += p.carry * 5;
    return c;
  }

  // ---------------------------------------------------------------- litter
  dropLitter(x: number, z: number): void {
    if (this.litter.length > 400) return;
    this.litter.push({ id: newEntityId(), x: x + this.rng.range(-0.8, 0.8), z: z + this.rng.range(-0.8, 0.8), rot: this.rng.range(0, 6.28) });
    this.litterVersion++;
  }

  litterNear(x: number, z: number, r: number): number {
    let c = 0;
    const r2 = r * r;
    for (const l of this.litter) if ((l.x - x) ** 2 + (l.z - z) ** 2 < r2) c++;
    return c;
  }

  removeLitter(id: number): void {
    const i = this.litter.findIndex((l) => l.id === id);
    if (i >= 0) {
      this.litter.splice(i, 1);
      this.litterVersion++;
    }
  }

  // ---------------------------------------------------------------- thoughts
  tallyThought(key: string, text: string, good: boolean): void {
    const t = this.thoughts.get(key);
    if (t) t.count++;
    else this.thoughts.set(key, { text, good, count: 1 });
  }

  // ---------------------------------------------------------------- car parks & cars
  slotsFor(o: PlacedObject): number[] {
    let s = this.slots.get(o.id);
    if (!s) {
      s = new Array(CARPARK_SLOTS.length).fill(0);
      this.slots.set(o.id, s);
    }
    return s;
  }

  freeSlot(): { carpark: PlacedObject; slot: number } | null {
    const cps = this.world.objectsOfKind('carpark');
    let best: { carpark: PlacedObject; slot: number } | null = null;
    let bestFree = 0;
    for (const c of cps) {
      const s = this.slotsFor(c);
      const free = s.filter((v) => v === 0).length;
      if (free > bestFree) {
        bestFree = free;
        // choose a random free slot for variety
        const freeIdx = s.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
        best = { carpark: c, slot: this.rng.pick(freeIdx) };
      }
    }
    return best;
  }

  totalSlots(): { used: number; total: number } {
    let used = 0, total = 0;
    for (const c of this.world.objectsOfKind('carpark')) {
      const s = this.slotsFor(c);
      total += s.length;
      used += s.filter((v) => v !== 0).length;
    }
    return { used, total };
  }

  releaseSlot(g: Group): void {
    if (!g.carpark) return;
    const s = this.slots.get(g.carpark);
    if (s && g.carSlot >= 0 && s[g.carSlot] === g.id) s[g.carSlot] = 0;
    g.carpark = 0;
    g.carSlot = -1;
  }

  /** Road path from an edge to a car park slot. */
  carRouteIn(cp: PlacedObject, slot: number, fromWest: boolean): { x: number; z: number }[] {
    const w = this.world;
    const c = w.objectCenter(cp);
    const s = CARPARK_SLOTS[slot];
    const lane = fromWest ? LANE_EAST_Z : LANE_WEST_Z;
    const startX = fromWest ? -40 : WORLD + 40;
    const entry = { x: c.x + CARPARK_ENTRY.x, z: c.z + CARPARK_ENTRY.z };
    return [
      { x: startX, z: lane },
      { x: entry.x + (fromWest ? -6 : 6), z: lane },
      { x: entry.x, z: lane - 2.5 },
      { x: entry.x, z: c.z + 1.5 },
      { x: c.x + s.x, z: c.z + (s.z < 0 ? 1.2 : -1.2) },
      { x: c.x + s.x, z: c.z + s.z },
    ];
  }

  carRouteOut(cp: PlacedObject, slot: number, toWest: boolean): { x: number; z: number }[] {
    const w = this.world;
    const c = w.objectCenter(cp);
    const s = CARPARK_SLOTS[slot];
    const entry = { x: c.x + CARPARK_ENTRY.x, z: c.z + CARPARK_ENTRY.z };
    const lane = toWest ? LANE_WEST_Z : LANE_EAST_Z;
    return [
      { x: c.x + s.x, z: c.z + (s.z < 0 ? -1.5 : 1.5) },
      { x: c.x + s.x + (s.x < 0 ? 2.5 : -2.5), z: c.z },
      { x: entry.x, z: c.z + 1.5 },
      { x: entry.x, z: lane - 1 },
      { x: entry.x + (toWest ? -8 : 8), z: lane },
      { x: toWest ? -40 : WORLD + 40, z: lane },
    ];
  }

  spawnPassingCar(): void {
    const west = this.rng.chance(0.5);
    const v = this.addVehicle('car', west ? -40 : WORLD + 40, west ? LANE_EAST_Z : LANE_WEST_Z, west ? Math.PI / 2 : -Math.PI / 2);
    v.color = carColor(this.rng);
    v.speed = this.rng.range(12, 17);
    v.path = [{ x: west ? WORLD + 40 : -40, z: v.z }];
    v.pathI = 0;
    v.moving = true;
    v.y = this.world.roadHeight();
    const co = (function* (sim: Sim) {
      while (v.moving) yield;
      sim.removeVehicle(v);
    })(this);
    this.attachVehicleCo(co);
  }

  private vehicleCos: Generator<void, void, number>[] = [];
  attachVehicleCo(co: Generator<void, void, number>): void {
    this.vehicleCos.push(co);
  }
  runVehicleCos(dt: number): void {
    this.vehicleCos = this.vehicleCos.filter((c) => !c.next(dt).done);
  }

  /** The point visitors walk to when arriving on foot. */
  entranceSpot(): { x: number; z: number } {
    const sign = this.world.objectsOfType('entrance_sign')[0];
    if (sign) {
      const c = this.world.objectCenter(sign);
      return { x: c.x + 7, z: c.z - 1 };
    }
    return { x: (MAP / 2) * TILE, z: (ROAD_ROW - 1) * TILE };
  }
}

export function carColor(r: RNG): number {
  return r.pick([0xd0d4d8, 0x1b1f24, 0xb22222, 0x2a4d8f, 0xf0f0f0, 0x6b7076, 0x1f5f3a, 0xc9a227, 0x8a1c3c, 0x3b8ad9, 0x4a3b2a]);
}

/** Insert intermediate points on sharp corners so vehicles turn smoothly. */
function smoothPath(pts: { x: number; z: number }[]): { x: number; z: number }[] {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    out.push({ x: c.x * 0.25 + b.x * 0.75, z: c.z * 0.25 + b.z * 0.75 });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function tileOf(x: number, z: number): number {
  return tileIndex(Math.floor(x / TILE), Math.floor(z / TILE));
}
