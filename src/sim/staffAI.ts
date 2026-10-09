// Staff behaviour coroutines.
import { MAINTAINED, MAP, Surf, TILE } from '../core/constants';
import { ITEMS } from '../data/items';
import { Co, Person, Vehicle } from './agents';
import { walkTo } from './behaviors';
import { wait } from './co';
import type { Sim } from './Sim';

function* drive(sim: Sim, v: Vehicle, x: number, z: number, onStep?: (dt: number) => void, timeout = 120): Generator<void, boolean, number> {
  if (!sim.driveVehicle(v, x, z, 'staff')) return false;
  let t = 0;
  while (v.moving) {
    const dt = yield;
    t += dt;
    onStep?.(dt);
    if (t > timeout) {
      v.moving = false;
      break;
    }
  }
  return true;
}

function* idleWander(sim: Sim, p: Person, near: { x: number; z: number }, secs: number): Co {
  const r = sim.rng;
  const tx = near.x + r.range(-10, 10), tz = near.z + r.range(-10, 10);
  if (sim.game.pf.passable(Math.floor(tx / TILE), Math.floor(tz / TILE), 'staff')) yield* walkTo(sim, p, tx, tz);
  p.setAnim('idle');
  yield* wait(secs);
}

function home(sim: Sim): { x: number; z: number } {
  const w = sim.game.world;
  const shed = w.objectsOfKind('maintenance')[0] ?? w.objectsOfKind('clubhouse')[0];
  if (shed) return sim.entrancePoint(shed);
  return sim.entranceSpot();
}

export function* greenkeeperLife(sim: Sim, p: Person): Co {
  const game = sim.game;
  const w = game.world;
  const h0 = home(sim);
  const mower = sim.addVehicle('mower', h0.x, h0.z, 0);
  mower.color = 0x2f7d32;
  try {
    for (;;) {
      if (p.removed) return;
      const holes = game.course.validHoles().filter((h) => h.corridor.length);
      // gather candidate turf tiles
      let target = -1;
      let worst = 256;
      const pool: number[][] = holes.length ? holes.map((h) => h.corridor) : [];
      if (!pool.length) {
        // no holes: look for any maintained surface
        for (let k = 0; k < 60; k++) {
          const i = sim.rng.int(0, MAP * MAP - 1);
          if (MAINTAINED.has(w.surf[i] as Surf) && w.isOwnedTile(i % MAP, (i / MAP) | 0) && w.condition[i] < worst) {
            worst = w.condition[i];
            target = i;
          }
        }
      } else {
        // prefer the worst holes but add randomness so several greenkeepers spread out
        const sorted = holes.slice().sort((a, b) => a.condition - b.condition);
        const h = sorted[Math.min(sorted.length - 1, Math.floor(sim.rng.next() ** 2 * Math.min(4, sorted.length)))];
        for (let k = 0; k < 24; k++) {
          const i = h.corridor[sim.rng.int(0, h.corridor.length - 1)];
          if (w.condition[i] < worst) {
            worst = w.condition[i];
            target = i;
          }
        }
      }
      if (target < 0 || worst > 235) {
        p.activity = 'Tidying the workshop';
        p.vehicle = null;
        mower.visible = true;
        yield* idleWander(sim, p, h0, 6);
        continue;
      }
      p.activity = 'Mowing';
      p.vehicle = mower;
      p.setAnim('drive');
      const tx = target % MAP, ty = (target / MAP) | 0;
      const rate = game.mowRate(p);
      const mowStep = (dt: number) => game.mowAt(mower.x, mower.z, rate * dt);
      yield* drive(sim, mower, (tx + 0.5) * TILE, (ty + 0.5) * TILE, mowStep, 90);
      // mow stripes back and forth over a 5x4 tile block
      const dir = sim.rng.chance(0.5);
      for (let row = -2; row <= 2; row++) {
        const a = dir ? { x: tx - 3, y: ty + row } : { x: tx + row, y: ty - 3 };
        const b = dir ? { x: tx + 3, y: ty + row } : { x: tx + row, y: ty + 3 };
        const from = row % 2 === 0 ? a : b;
        const to = row % 2 === 0 ? b : a;
        if (!game.pf.passable(from.x, from.y, 'staff') || !game.pf.passable(to.x, to.y, 'staff')) continue;
        mower.path = [{ x: (from.x + 0.5) * TILE, z: (from.y + 0.5) * TILE }, { x: (to.x + 0.5) * TILE, z: (to.y + 0.5) * TILE }];
        mower.pathI = 0;
        mower.moving = true;
        let t = 0;
        while (mower.moving && t < 20) {
          const dt = yield;
          t += dt;
          mowStep(dt);
        }
      }
      yield* wait(0.5);
    }
  } finally {
    p.vehicle = null;
    sim.removeVehicle(mower);
  }
}

export function* rangeAssistantLife(sim: Sim, p: Person): Co {
  const game = sim.game;
  const w = game.world;
  let picker: Vehicle | null = null;
  try {
    for (;;) {
      if (p.removed) return;
      const shed = w.objectsOfKind('picker_shed')[0];
      const disp = sim.nearestObject((o) => ITEMS[o.type].kind === 'dispenser', p.x, p.z);
      if (shed && !picker) {
        const se = sim.entrancePoint(shed);
        picker = sim.addVehicle('ball_picker', se.x, se.z, 0);
        picker.color = 0xd98c1f;
      } else if (!shed && picker) {
        p.vehicle = null;
        sim.removeVehicle(picker);
        picker = null;
      }
      const cluster = sim.findBallCluster(p.x, p.z);
      if (!cluster || sim.field.n < 12 || !disp) {
        p.activity = disp ? 'Waiting for balls to collect' : 'No dispenser to refill';
        p.vehicle = null;
        if (picker) {
          picker.moving = false;
        }
        yield* idleWander(sim, p, disp ? sim.entrancePoint(disp) : home(sim), 5);
        continue;
      }
      if (picker) {
        p.vehicle = picker;
        p.setAnim('drive');
        p.activity = 'Driving the ball picker';
        const pk = picker;
        const collect = (dt: number) => {
          if (pk.load < 300) pk.load += sim.collectFieldBalls(pk.x, pk.z, 3.6, Math.ceil(dt * 40 * game.staffSpeed(p)));
        };
        yield* drive(sim, pk, cluster.x, cluster.z, collect, 90);
        // sweep around the cluster
        for (let k = 0; k < 6 && pk.load < 300; k++) {
          const a = (k / 6) * Math.PI * 2;
          const tx = cluster.x + Math.cos(a) * 9, tz = cluster.z + Math.sin(a) * 9;
          if (!game.pf.passable(Math.floor(tx / TILE), Math.floor(tz / TILE), 'staff')) continue;
          pk.path = [{ x: tx, z: tz }];
          pk.pathI = 0;
          pk.moving = true;
          let t = 0;
          while (pk.moving && t < 10) {
            const dt = yield;
            t += dt;
            collect(dt);
          }
        }
        if (pk.load >= 40 || sim.field.n < 20) {
          const de = sim.entrancePoint(disp);
          p.activity = 'Refilling the dispenser';
          yield* drive(sim, pk, de.x, de.z, collect, 90);
          yield* wait(2.5);
          pk.load = 0;
        }
      } else {
        // on foot with a basket
        p.vehicle = null;
        p.activity = 'Collecting balls by hand';
        yield* walkTo(sim, p, cluster.x, cluster.z);
        let t = 0;
        while (p.carry < 80 && t < 40) {
          p.setAnim('pick');
          const dt = yield;
          t += dt;
          if (sim.rng.chance(Math.min(1, dt * 4.5 * game.staffSpeed(p)))) {
            const got = sim.collectFieldBalls(p.x, p.z, 6, 1);
            if (!got) {
              const c2 = sim.findBallCluster(p.x, p.z);
              if (!c2 || Math.hypot(c2.x - p.x, c2.z - p.z) > 40) break;
              yield* walkTo(sim, p, c2.x + sim.rng.range(-2, 2), c2.z + sim.rng.range(-2, 2));
            }
            p.carry += got;
          }
        }
        const de = sim.entrancePoint(disp);
        p.activity = 'Refilling the dispenser';
        yield* walkTo(sim, p, de.x, de.z);
        p.setAnim('idle');
        yield* wait(2);
        p.carry = 0;
      }
    }
  } finally {
    p.vehicle = null;
    if (picker) sim.removeVehicle(picker);
  }
}

export function* cleanerLife(sim: Sim, p: Person): Co {
  const game = sim.game;
  for (;;) {
    if (p.removed) return;
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < sim.litter.length; i++) {
      const l = sim.litter[i];
      const d = (l.x - p.x) ** 2 + (l.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      const l = sim.litter[best];
      p.activity = 'Picking up litter';
      const id = l.id;
      yield* walkTo(sim, p, l.x, l.z);
      p.setAnim('pick');
      yield* wait(1.2 / game.staffSpeed(p));
      sim.removeLitter(id);
      p.setAnim('idle');
      continue;
    }
    p.activity = 'Sweeping paths';
    const objs = Array.from(game.world.objects.values()).filter((o) => ITEMS[o.type].enterable);
    const o = objs.length ? sim.rng.pick(objs) : null;
    yield* idleWander(sim, p, o ? sim.entrancePoint(o) : sim.entranceSpot(), 5);
  }
}

export function* marshalLife(sim: Sim, p: Person): Co {
  const game = sim.game;
  const h0 = home(sim);
  const cart = sim.addVehicle('golf_cart', h0.x, h0.z, 0);
  cart.color = 0xb23a3a;
  try {
    for (;;) {
      if (p.removed) return;
      const holes = game.course.validHoles();
      if (!holes.length) {
        p.vehicle = null;
        p.activity = 'Waiting for a course to patrol';
        yield* idleWander(sim, p, h0, 6);
        continue;
      }
      const busiest = holes.slice().sort((a, b) => b.queue.length - a.queue.length)[0];
      const target = busiest.queue.length > 0 ? busiest : sim.rng.pick(holes);
      p.vehicle = cart;
      p.setAnim('drive');
      p.activity = `Patrolling hole ${target.num}`;
      const mid = game.course.pointAt(target, target.length * sim.rng.range(0.2, 0.7));
      const t = game.pf.nearestPassable(Math.floor(mid.x / TILE) + 4, Math.floor(mid.z / TILE), 'cart', 8);
      if (t) {
        if (sim.driveVehicle(cart, (t.x + 0.5) * TILE, (t.y + 0.5) * TILE, 'cart')) {
          let tt = 0;
          while (cart.moving && tt < 80) tt += yield;
        }
      }
      yield* wait(8);
    }
  } finally {
    p.vehicle = null;
    sim.removeVehicle(cart);
  }
}

export function* proLife(sim: Sim, p: Person): Co {
  const game = sim.game;
  for (;;) {
    if (p.removed) return;
    const academy = game.world.objectsOfKind('academy')[0];
    if (!academy) {
      p.activity = 'Waiting for an academy to teach in';
      yield* idleWander(sim, p, sim.entranceSpot(), 8);
      continue;
    }
    const e = sim.entrancePoint(academy);
    p.activity = sim.lessonsActive > 0 ? 'Teaching a lesson' : 'Waiting for students';
    if (Math.hypot(p.x - e.x, p.z - e.z) > 6) yield* walkTo(sim, p, e.x + sim.rng.range(-3, 3), e.z + sim.rng.range(0, 2));
    p.setAnim(sim.rng.chance(0.3) ? 'swing' : 'idle', 1.4);
    yield* wait(sim.rng.range(3, 6));
  }
}
