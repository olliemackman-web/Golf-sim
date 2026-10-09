// Visitor behaviour coroutines.
import { COURSE_SCALE, Surf, TILE, YARDS_PER_WORLD } from '../core/constants';
import { ITEMS } from '../data/items';
import { FIRST_NAMES, LAST_NAMES, VISITOR_TYPES, VisitorTypeId } from '../data/visitors';
import type { HoleInfo } from '../world/Course';
import type { PlacedObject } from '../world/World';
import { Co, GolfBall, Group, Person, randomColors } from './agents';
import { all, until, wait } from './co';
import { planShot, simulateShot } from './golfAI';
import { Sim, carColor } from './Sim';

// ---------------------------------------------------------------- movement helpers
export function* walkTo(sim: Sim, p: Person, x: number, z: number, exact = true): Generator<void, boolean, number> {
  if (Math.hypot(p.x - x, p.z - z) < 0.3) return true;
  if (!sim.walkTo(p, x, z, p.kind === 'staff' ? 'staff' : 'walk', exact)) {
    // fall back to a straight walk for very short hops
    if (Math.hypot(p.x - x, p.z - z) < TILE * 3) sim.walkStraight(p, x, z);
    else return false;
  }
  let stuck = 0;
  let lx = p.x, lz = p.z;
  while (p.moving) {
    const dt = yield;
    if (Math.abs(p.x - lx) + Math.abs(p.z - lz) < 0.001) stuck += dt;
    else stuck = 0;
    lx = p.x;
    lz = p.z;
    if (stuck > 5) {
      p.moving = false;
      p.x = x;
      p.z = z;
    }
  }
  return true;
}

/** Travel to a point, riding the person's golf cart where possible. */
export function* travel(sim: Sim, p: Person, x: number, z: number, cart: import('./agents').Vehicle | null): Generator<void, boolean, number> {
  if (!cart) return yield* walkTo(sim, p, x, z);
  const d = Math.hypot(p.x - x, p.z - z);
  if (d < 14 && !p.vehicle) return yield* walkTo(sim, p, x, z);
  // get in the cart
  if (!p.vehicle) {
    const cd = Math.hypot(p.x - cart.x, p.z - cart.z);
    if (cd > 1.5) yield* walkTo(sim, p, cart.x + 0.8, cart.z);
    p.vehicle = cart;
    p.setAnim('drive');
  }
  // drive to the nearest cart-legal spot
  const t = sim.game.pf.nearestPassable(Math.floor(x / TILE), Math.floor(z / TILE), 'cart', 5);
  if (t) {
    const tx = (t.x + 0.5) * TILE, tz = (t.y + 0.5) * TILE;
    if (sim.driveVehicle(cart, tx, tz, 'cart')) {
      let time = 0;
      while (cart.moving) {
        time += yield;
        if (time > 90) break;
      }
    }
  }
  // hop out and walk the rest
  p.vehicle = null;
  p.x = cart.x + Math.cos(cart.heading) * 1.1;
  p.z = cart.z - Math.sin(cart.heading) * 1.1;
  p.setAnim('idle');
  return yield* walkTo(sim, p, x, z);
}

// ---------------------------------------------------------------- spawning
export function spawnParty(sim: Sim, typeId: VisitorTypeId, wantRange: boolean, wantCourse: boolean, holes: number[], opts: { member?: boolean; helicopter?: boolean } = {}): Group | null {
  const game = sim.game;
  const vt = VISITOR_TYPES[typeId];
  const r = sim.rng;
  const g = new Group();
  const n = r.int(vt.party[0], vt.party[1]);
  g.plan = { range: wantRange, course: wantCourse, holes };
  g.helicopter = !!opts.helicopter;
  // parking
  let parked: { carpark: PlacedObject; slot: number } | null = null;
  if (!g.helicopter) {
    parked = sim.freeSlot();
    if (!parked && game.world.objectsOfKind('carpark').length > 0) {
      game.noteParkingFull();
      return null;
    }
  }
  for (let i = 0; i < n; i++) {
    const p = sim.addPerson(randomColors(r), 0, 0);
    p.kind = 'visitor';
    p.vtype = typeId;
    p.name = `${r.pick(FIRST_NAMES)} ${r.pick(LAST_NAMES)}`;
    p.skill = r.range(vt.skill[0], vt.skill[1]);
    p.cash = r.range(vt.wealth[0], vt.wealth[1]);
    p.happiness = 62 + r.range(-6, 6);
    p.hunger = r.range(0, 30);
    p.thirst = r.range(0, 30);
    p.bladder = r.range(0, 30);
    p.member = !!opts.member;
    p.visible = false;
    p.group = g;
    p.arrivedMinute = game.state.minute;
    p.bag = wantCourse || wantRange;
    if (typeId === 'junior') p.scale = 0.8;
    g.members.push(p);
  }
  if (parked) {
    g.carpark = parked.carpark.id;
    g.carSlot = parked.slot;
    sim.slotsFor(parked.carpark)[parked.slot] = g.id;
  }
  g.co = partyLife(sim, g);
  sim.groups.push(g);
  return g;
}

// ---------------------------------------------------------------- party lifecycle
function* partyLife(sim: Sim, g: Group): Co {
  const game = sim.game;
  yield* arrive(sim, g);
  for (const m of g.members) game.onVisitorArrived(m);

  if (g.plan.range && g.plan.course) {
    // warm up on the range first (just one bucket), then the course
    yield* all(g.members.map((m) => rangeSession(sim, m, 1)));
  } else if (g.plan.range) {
    yield* all(g.members.map((m) => rangeSession(sim, m, m.cash > 150 && sim.rng.chance(0.35) ? 2 : 1)));
  }
  if (g.plan.course && g.plan.holes.length) {
    yield* playRound(sim, g);
  }
  if (game.isOpen()) yield* all(g.members.map((m) => leisure(sim, m)));
  yield* leave(sim, g);
}

function* arrive(sim: Sim, g: Group): Co {
  const game = sim.game;
  const w = game.world;
  if (g.helicopter) {
    const pad = w.objectsOfKind('helipad')[0];
    if (pad) {
      const c = w.objectCenter(pad);
      const heli = sim.addVehicle('helicopter', c.x - 200, c.z - 120, 1);
      heli.lift = 60;
      heli.speed = 30;
      heli.path = [{ x: c.x, z: c.z }];
      heli.moving = true;
      while (heli.moving) yield;
      while (heli.lift > 0) {
        const dt = yield;
        heli.lift = Math.max(0, heli.lift - dt * 9);
      }
      g.car = heli;
      g.members.forEach((m, i) => {
        m.x = c.x + 4 + i * 0.9;
        m.z = c.z + 3;
        m.visible = true;
      });
      game.events.emit('notify', { text: 'A VIP party has landed on the helipad!', kind: 'info', x: c.x, z: c.z });
      return;
    }
  }
  if (g.carpark) {
    const cp = w.objects.get(g.carpark);
    if (cp) {
      const west = sim.rng.chance(0.5);
      const route = sim.carRouteIn(cp, g.carSlot, west);
      const car = sim.addVehicle('car', route[0].x, route[0].z, west ? Math.PI / 2 : -Math.PI / 2);
      car.color = carColor(sim.rng);
      car.path = route.slice(1);
      car.moving = true;
      g.car = car;
      let t = 0;
      while (car.moving) {
        t += yield;
        if (t > 60) break;
      }
      car.x = route[route.length - 1].x;
      car.z = route[route.length - 1].z;
      game.events.emit('sound', { name: 'car_door', x: car.x, z: car.z });
      g.members.forEach((m, i) => {
        m.x = car.x + (i % 2 ? 1.6 : -1.6);
        m.z = car.z + (i < 2 ? 0.5 : -1.2);
        m.y = w.heightAt(m.x, m.z);
        m.visible = true;
      });
      yield* wait(0.6);
      return;
    }
  }
  // dropped off at the entrance
  const e = sim.entranceSpot();
  g.members.forEach((m, i) => {
    m.x = e.x + i * 0.8;
    m.z = e.z + 1;
    m.visible = true;
  });
}

function* leave(sim: Sim, g: Group): Co {
  const game = sim.game;
  const live = g.members.filter((m) => !m.removed);
  for (const m of live) m.activity = 'Heading home';
  const car = g.car;
  if (car && !car.removed) {
    if (car.type === 'helicopter') {
      yield* all(live.map((m) => walkTo(sim, m, car.x + 2, car.z + 2)));
      for (const m of live) {
        game.onVisitorLeft(m);
        sim.removePerson(m);
      }
      yield* wait(1.5);
      while (car.lift < 70) {
        const dt = yield;
        car.lift += dt * 12;
        car.x += dt * 10;
      }
      sim.removeVehicle(car);
      g.removed = true;
      return;
    }
    yield* all(live.map((m, i) => walkTo(sim, m, car.x + (i % 2 ? 1.6 : -1.6), car.z)));
    for (const m of live) {
      game.onVisitorLeft(m);
      sim.removePerson(m);
    }
    game.events.emit('sound', { name: 'car_door', x: car.x, z: car.z });
    yield* wait(1);
    const cp = game.world.objects.get(g.carpark);
    if (cp && g.carSlot >= 0) {
      const route = sim.carRouteOut(cp, g.carSlot, sim.rng.chance(0.5));
      sim.releaseSlot(g);
      car.path = route;
      car.pathI = 0;
      car.moving = true;
      let t = 0;
      while (car.moving && t < 60) t += yield;
    }
    sim.removeVehicle(car);
    sim.releaseSlot(g);
    g.removed = true;
    return;
  }
  const e = sim.entranceSpot();
  yield* all(live.map((m) => walkTo(sim, m, e.x, e.z + 3)));
  for (const m of live) {
    game.onVisitorLeft(m);
    sim.removePerson(m);
  }
  g.removed = true;
}

// ---------------------------------------------------------------- range
function* rangeSession(sim: Sim, p: Person, buckets: number): Co {
  const game = sim.game;
  if (p.removed) return;
  p.activity = 'Heading to the range';
  const disp = sim.nearestObject((o) => ITEMS[o.type].kind === 'dispenser', p.x, p.z);
  if (!disp) {
    p.think('nodisp', 'This range has no ball dispenser!', -10);
    return;
  }
  const dp = sim.entrancePoint(disp);
  yield* walkTo(sim, p, dp.x, dp.z);
  yield* until(() => (sim.occupancy.get(disp.id) ?? 0) < 2, 25);
  sim.enter(disp, 1);
  const dc = game.world.objectCenter(disp);
  p.face(dc.x, dc.z);
  p.activity = 'Buying range balls';
  yield* wait(2.2);
  sim.enter(disp, -1);

  for (let b = 0; b < buckets; b++) {
    if (!game.rangeOpen()) break;
    if (sim.ballsAvailable() < 50) {
      p.think('noballs', 'The range has run out of balls!', -14);
      game.noteNoBalls();
      return;
    }
    // find a bay first (so we know the tier for price expectations)
    p.activity = 'Waiting for a free bay';
    const vt = VISITOR_TYPES[p.vtype];
    let bay: PlacedObject | null = null;
    const patience = vt.patience * game.patienceMul() / 0.8; // sim seconds ≈ game minutes / 0.8
    let waited = 0;
    const ok = yield* until(() => (bay = sim.freeBay(p.x, p.z, p.cash > 300 ? 3 : 0)) !== null, patience, (dt) => {
      waited += dt;
      p.setAnim('idle');
    });
    if (!ok || !bay) {
      p.think('baywait', 'I waited ages for a free bay', -12);
      return;
    }
    const theBay = bay as PlacedObject;
    if (waited > 8) p.think('baywait2', 'Had to queue for a bay', -3);
    const def = ITEMS[theBay.type];
    const price = game.bucketPrice(def.tier ?? 1);
    const verdict = game.priceCheck(p, price, game.fairBucketPrice(def.tier ?? 1));
    if (verdict === 'refuse') {
      p.think('bucketprice', 'Range balls are far too expensive here', -10);
      return;
    }
    if (verdict === 'cheap') p.think('bucketcheap', 'Range balls are great value', 4);
    sim.bayUser.set(theBay.id, p.id);
    game.earn('range', price, { x: dp.x, z: dp.z });
    p.cash -= price;
    p.spent += price;
    sim.ballsInUse += 50;
    let shotsLeft = 10;
    try {
      p.activity = 'Hitting balls';
      const stand = sim.bayStand(theBay);
      yield* walkTo(sim, p, stand.x, stand.z);
      if (!game.world.objects.has(theBay.id)) return;
      p.face(stand.face.x, stand.face.z);
      const tier = def.tier ?? 1;
      if (tier === 3) p.think('tracker', 'The ball tracker screens are brilliant!', 6);
      else if (tier === 2) p.think('covered', 'Nice covered bays', 3);
      if (game.weatherRain() && tier === 1) p.think('rainbay', 'Getting soaked in an uncovered bay', -6);
      let targetHits = 0;
      while (shotsLeft > 0) {
        if (!game.world.objects.has(theBay.id)) break;
        p.restartAnim('swing', 1.25);
        yield* wait(0.6);
        const land = sim.launchRangeBall(theBay, p.skill);
        game.events.emit('rangeHit', { x: p.x, z: p.z });
        sim.ballsInUse -= 5;
        shotsLeft--;
        if (game.targetNear(land.x, land.z)) {
          targetHits++;
          game.events.emit('sparkle', { x: land.x, z: land.z });
        }
        yield* wait(0.65 + sim.rng.range(0.6, 2.4));
        if (!game.rangeOpen() && sim.rng.chance(0.3)) break;
      }
      const targets = game.world.objectsOfKind('target').length;
      if (targets === 0) p.think('notargets', 'Nothing to aim at on this range', -3);
      else if (targetHits >= 2) p.think('targets', 'Loved hitting the targets!', 5 + targetHits);
      else p.think('rangeok', 'Good practice session', 3);
      if (sim.rng.chance(0.08 + p.skill * 0.05)) p.think('swingfeel', 'My swing felt great today', 3);
    } finally {
      sim.ballsInUse -= shotsLeft * 5;
      sim.bayUser.delete(theBay.id);
      p.setAnim('idle');
    }
  }
}

// ---------------------------------------------------------------- course
function* playRound(sim: Sim, g: Group): Co {
  const game = sim.game;
  const w = game.world;
  const club = w.objectsOfKind('clubhouse')[0];
  if (!club) return;
  let players = g.members.filter((m) => !m.removed);
  const holesN = g.plan.holes.length;
  // check in at the clubhouse
  const ce = sim.entrancePoint(club);
  for (const m of players) m.activity = 'Checking in at the clubhouse';
  yield* all(players.map((m, i) => walkTo(sim, m, ce.x + (i - 1.5) * 0.8, ce.z)));
  for (const m of players) m.visible = false;
  sim.enter(club, players.length);
  yield* wait(6);
  sim.enter(club, -players.length);
  for (const m of players) m.visible = true;

  // green fees
  const fee = game.greenFee(holesN);
  const fair = game.fairGreenFee(holesN);
  const paying: Person[] = [];
  for (const m of players) {
    if (m.member) {
      paying.push(m);
      continue;
    }
    const v = game.priceCheck(m, fee, fair);
    if (v === 'refuse') {
      m.think('greenfee', 'The green fees are outrageous!', -12);
      continue;
    }
    if (v === 'cheap') m.think('greencheap', 'Green fees are a bargain', 5);
    game.earn('greenfees', fee, { x: ce.x, z: ce.z });
    m.cash -= fee;
    m.spent += fee;
    paying.push(m);
  }
  players = paying;
  if (!players.length) return;
  game.recordRound(holesN, players.length);

  // carts
  const carts = new Map<number, import('./agents').Vehicle>();
  const barn = w.objectsOfKind('cart_shed')[0];
  if (barn) {
    const vt = VISITOR_TYPES[players[0].vtype];
    if (sim.rng.chance(vt.cart)) {
      const be = sim.entrancePoint(barn);
      const price = game.cartPrice();
      yield* all(players.map((m, i) => walkTo(sim, m, be.x + (i - 1.5) * 1.2, be.z)));
      for (let i = 0; i < players.length; i += 2) {
        const m = players[i];
        if (game.priceCheck(m, price, game.fairCartPrice()) === 'refuse') {
          m.think('cartprice', 'Cart hire is too expensive', -4);
          continue;
        }
        game.earn('carts', price, { x: be.x, z: be.z });
        m.cash -= price;
        const cart = sim.addVehicle('golf_cart', be.x + i, be.z + 1, 0);
        cart.color = 0xf4f4ee;
        if (game.hasResearch('gps_carts')) cart.speed *= 1.15;
        g.carts.push(cart);
        carts.set(m.id, cart);
        if (players[i + 1]) carts.set(players[i + 1].id, cart);
      }
    }
  }

  // practice putting green warm-up
  const practice = w.objectsOfType('practice_green')[0];
  if (practice && sim.rng.chance(0.45)) {
    const pc = w.objectCenter(practice);
    for (const m of players) m.activity = 'Practising putts';
    yield* all(players.map((m, i) => walkTo(sim, m, pc.x + (i - 1.5) * 2.2, pc.z + (i % 2) * 2)));
    for (let k = 0; k < 3; k++) {
      for (const m of players) m.restartAnim('putt', 1);
      yield* wait(2.4);
    }
    for (const m of players) m.think('practice', 'Nice to warm up on the practice green', 3);
  }

  for (const m of players) {
    g.scores.set(m.id, []);
    m.holesPlayed = 0;
  }
  let holeCount = 0;
  for (const hid of g.plan.holes) {
    players = players.filter((m) => !m.removed);
    if (!players.length) break;
    if (game.courseClosed()) {
      for (const m of players) m.think('closed', 'Had to stop early — the course closed', -6);
      break;
    }
    const hole = game.course.byId(hid);
    if (!hole || !hole.valid) continue;
    yield* playHole(sim, g, hole, players, carts);
    holeCount++;
    // halfway house stop
    if (holeCount === 9 && g.plan.holes.length > 9) yield* halfwayStop(sim, players, carts);
  }

  // return carts
  if (g.carts.length && barn) {
    const be = sim.entrancePoint(barn);
    yield* all(players.map((m) => travel(sim, m, be.x, be.z + 1, carts.get(m.id) ?? null)));
  }
  for (const c of g.carts) sim.removeVehicle(c);
  g.carts = [];
  for (const m of players) {
    m.vehicle = null;
    const sc = g.scores.get(m.id) ?? [];
    if (m.holesPlayed > 0) {
      const total = sc.reduce((a, b) => a + b, 0);
      const par = g.plan.holes.slice(0, m.holesPlayed).reduce((a, id) => a + (game.course.byId(id)?.par ?? 4), 0);
      const diff = total - par;
      const expected = 4 + (1 - m.skill) * 30 * (m.holesPlayed / 18);
      if (diff < expected - 4) m.think('goodround', `Shot ${total} — my best round in ages!`, 8);
      else if (diff > expected + 6) m.think('badround', `Shot ${total}. Never again...`, -4);
      else m.think('round', `Enjoyed my round (${total})`, 3);
    }
  }
}

function* halfwayStop(sim: Sim, players: Person[], carts: Map<number, import('./agents').Vehicle>): Co {
  const game = sim.game;
  const hh = sim.nearestObject((o) => o.type === 'halfway_house' || o.type === 'drinking_fountain', players[0].x, players[0].z);
  if (!hh) return;
  const c = game.world.objectCenter(hh);
  if (Math.hypot(c.x - players[0].x, c.z - players[0].z) > 160) return;
  const e = sim.entrancePoint(hh);
  yield* all(players.map((m) => travel(sim, m, e.x, e.z, carts.get(m.id) ?? null)));
  if (hh.type === 'halfway_house') {
    for (const m of players) {
      m.visible = false;
      const spend = game.foodSpend(m, ITEMS.halfway_house.spend ?? 9);
      if (spend > 0) {
        game.earn('food', spend, e);
        m.cash -= spend;
        m.spent += spend;
      }
      m.hunger = Math.max(0, m.hunger - 50);
      m.thirst = 0;
      m.think('halfway', 'A hot dog at the turn — perfect', 4);
    }
    yield* wait(8);
    for (const m of players) m.visible = true;
  } else {
    for (const m of players) {
      m.thirst = Math.max(0, m.thirst - 60);
      m.think('water', 'Handy water station on the course', 2);
    }
    yield* wait(2);
  }
}

function addressPoint(ball: { x: number; z: number }, target: { x: number; z: number }): { x: number; z: number; fx: number; fz: number } {
  let dx = target.x - ball.x, dz = target.z - ball.z;
  const L = Math.hypot(dx, dz) || 1;
  dx /= L;
  dz /= L;
  // golfer faces f = (-dz, dx); stands behind the ball along -f
  const fx = -dz, fz = dx;
  return { x: ball.x - fx * 0.75, z: ball.z - fz * 0.75, fx, fz };
}

export function* playHole(sim: Sim, g: Group, hole: HoleInfo, players: Person[], carts: Map<number, import('./agents').Vehicle>): Co {
  const game = sim.game;
  const w = game.world;
  const tee = hole.teeWorld;
  const next = hole.route[1] ?? hole.pinWorld;
  let dx = next.x - tee.x, dz = next.z - tee.z;
  const L = Math.hypot(dx, dz) || 1;
  dx /= L;
  dz /= L;
  for (const m of players) m.activity = `Walking to hole ${hole.num}`;
  // gather beside the tee
  yield* all(players.map((m, i) => travel(sim, m, tee.x - dx * 5 + dz * (i - 1.5) * 1.4, tee.z - dz * 5 - dx * (i - 1.5) * 1.4, carts.get(m.id) ?? null)));
  for (const m of players) {
    m.face(tee.x + dx * 50, tee.z + dz * 50);
    m.activity = `Waiting on the tee at hole ${hole.num}`;
  }

  // wait for the hole to clear
  hole.queue.push(g.id);
  let waited = 0;
  const vt = VISITOR_TYPES[players[0].vtype];
  const patience = (vt.patience * game.patienceMul()) / 0.8;
  let complained = false;
  yield* until(() => hole.occupiedBy === 0 && hole.queue[0] === g.id, Infinity, (dt) => {
    waited += dt;
    if (waited > patience && !complained) {
      complained = true;
      for (const m of players) m.think('slowplay', `Waited forever on the tee at hole ${hole.num}`, -8);
    }
  });
  if (waited > patience * 2) for (const m of players) m.happiness -= 4;
  hole.queue.shift();
  hole.occupiedBy = g.id;
  g.currentHole = hole.save.id;

  try {
    // set up balls
    const balls: GolfBall[] = [];
    players.forEach((m, i) => {
      const bx = tee.x + dz * (i - 1.5) * 0.6, bz = tee.z - dx * (i - 1.5) * 0.6;
      const be = sim.addBall();
      be.state = 'hidden';
      be.x = bx;
      be.z = bz;
      be.y = w.heightAt(bx, bz);
      const gb: GolfBall = { x: bx, z: bz, strokes: 0, holed: false, pickedUp: false, lastSafe: { x: bx, z: bz }, ballId: be.id };
      g.balls.set(m.id, gb);
      balls.push(gb);
    });
    const busy = new Set<number>();
    // tee shots
    for (const m of players) {
      m.activity = `Teeing off at hole ${hole.num}`;
      yield* takeShot(sim, g, m, hole, true, carts.get(m.id) ?? null, busy);
    }
    yield* until(() => busy.size === 0, 15);

    // play out the hole
    let guard = 0;
    for (;;) {
      if (++guard > 80) break;
      const live = players.filter((m) => !m.removed && !(g.balls.get(m.id)?.holed));
      if (!live.length) break;
      // everyone heads for their ball
      for (const m of live) {
        const gb = g.balls.get(m.id)!;
        const ad = addressPoint(gb, hole.pinWorld);
        if (Math.hypot(m.x - ad.x, m.z - ad.z) > 1.2 && !m.moving && !m.vehicle && !busy.has(m.id)) {
          m.activity = `Playing hole ${hole.num}`;
          const cart = carts.get(m.id) ?? null;
          if (cart && Math.hypot(m.x - ad.x, m.z - ad.z) > 20) {
            busy.add(m.id);
            const co = travel(sim, m, ad.x, ad.z, cart);
            sim.attachVehicleCo((function* () {
              yield* co;
              busy.delete(m.id);
            })());
          } else if (!sim.walkTo(m, ad.x, ad.z, 'walk')) sim.walkStraight(m, ad.x, ad.z);
        }
      }
      // farthest from the pin plays
      let pick = live[0];
      let pd = -1;
      for (const m of live) {
        const gb = g.balls.get(m.id)!;
        const d = Math.hypot(gb.x - hole.pinWorld.x, gb.z - hole.pinWorld.z);
        if (d > pd) {
          pd = d;
          pick = m;
        }
      }
      const gb = g.balls.get(pick.id)!;
      const ad = addressPoint(gb, hole.pinWorld);
      yield* until(() => !busy.has(pick.id) && (!pick.moving || Math.hypot(pick.x - ad.x, pick.z - ad.z) < 0.5), 60);
      if (pick.vehicle) {
        pick.vehicle = null;
      }
      if (Math.hypot(pick.x - ad.x, pick.z - ad.z) > 0.6) yield* walkTo(sim, pick, ad.x, ad.z);
      yield* takeShot(sim, g, pick, hole, false, carts.get(pick.id) ?? null, busy);
    }
    yield* until(() => busy.size === 0, 10);

    // score
    for (const m of players) {
      const gb = g.balls.get(m.id);
      if (!gb) continue;
      const strokes = gb.strokes + (gb.pickedUp ? 1 : 0);
      g.scores.get(m.id)?.push(strokes);
      m.holesPlayed++;
      hole.roundsPlayed++;
      hole.totalStrokes += strokes;
      const be = sim.balls.find((b) => b.id === gb.ballId);
      if (be) be.removed = true;
      const toPar = strokes - hole.par;
      if (strokes === 1) {
        m.think('ace', `HOLE IN ONE on hole ${hole.num}!!!`, 25);
        game.events.emit('notify', { text: `${m.name} made a hole-in-one on hole ${hole.num}!`, kind: 'good', x: hole.pinWorld.x, z: hole.pinWorld.z });
        game.events.emit('cheer', { x: hole.pinWorld.x, z: hole.pinWorld.z, big: true });
        game.reputationBoost(0.6);
      } else if (toPar <= -2) {
        m.think('eagle', `Eagle on hole ${hole.num}!`, 12);
        game.events.emit('cheer', { x: hole.pinWorld.x, z: hole.pinWorld.z, big: false });
      } else if (toPar === -1) {
        m.think('birdie', `Birdie on ${hole.num}!`, 6);
        game.events.emit('cheer', { x: hole.pinWorld.x, z: hole.pinWorld.z, big: false });
      }
      // course quality impressions
      const q = hole.rating;
      if (q >= 75) m.think('greathole', `Hole ${hole.num} is a superb hole`, 1.5);
      else if (q < 35) m.think('poorhole', `Hole ${hole.num} is badly designed`, -2);
      if (hole.condition < 45) m.think('condition', 'The course is in poor condition', -2.5);
      else if (hole.condition > 85) m.think('pristine', 'The course is in pristine condition', 1.5);
      const vtm = VISITOR_TYPES[m.vtype];
      if (hole.difficulty - vtm.hard > 0.45) m.think('toohard', 'This course is far too difficult for me', -2);
      else if (vtm.hard - hole.difficulty > 0.45) m.think('tooeasy', 'This course is too easy', -1.5);
      m.happiness += (q - 50) * 0.05;
    }
    for (const m of players) m.happiness = Math.max(0, Math.min(100, m.happiness));
  } finally {
    if (hole.occupiedBy === g.id) hole.occupiedBy = 0;
    for (const m of players) {
      const gb = g.balls.get(m.id);
      if (gb) {
        const be = sim.balls.find((b) => b.id === gb.ballId);
        if (be) be.removed = true;
      }
    }
    g.balls.clear();
  }
}

function* takeShot(sim: Sim, g: Group, m: Person, hole: HoleInfo, isTee: boolean, cart: import('./agents').Vehicle | null, busy: Set<number>): Co {
  const game = sim.game;
  const w = game.world;
  const gb = g.balls.get(m.id)!;
  const plan = planShot(w, game.course, hole, gb, m.skill, isTee);
  const ad = addressPoint(gb, plan.target);
  if (Math.hypot(m.x - ad.x, m.z - ad.z) > 0.4) {
    if (m.vehicle) m.vehicle = null;
    yield* walkTo(sim, m, ad.x, ad.z);
  }
  m.targetHeading = Math.atan2(ad.fx, ad.fz);
  const be = sim.balls.find((b) => b.id === gb.ballId);
  if (be) {
    be.state = 'rest';
    be.x = gb.x;
    be.z = gb.z;
    be.y = w.heightAt(gb.x, gb.z) + (isTee && plan.kind === 'full' ? 0.08 : 0.04);
  }
  yield* wait(game.preShotTime() * sim.rng.range(0.6, 1.3));
  const anim = plan.kind === 'putt' ? 'putt' : plan.kind === 'chip' ? 'chip' : 'swing';
  const dur = plan.kind === 'putt' ? 1.0 : plan.kind === 'chip' ? 1.05 : plan.club.id === 'dr' ? 1.4 : 1.25;
  m.restartAnim(anim, dur);
  yield* wait(dur * 0.48);
  const res = simulateShot(w, plan, gb, m.skill, sim.rng, hole.pinWorld, game.greenSpeed());
  game.events.emit('hit', { x: gb.x, z: gb.z, kind: plan.kind === 'putt' ? 'putt' : plan.club.id === 'dr' ? 'driver' : plan.kind === 'chip' ? 'wedge' : 'iron', near: false });
  gb.strokes++;
  const startPos = { x: gb.x, z: gb.z };
  // divot/wear
  if (plan.kind !== 'putt') game.wearTile(gb.x, gb.z, plan.kind === 'full' ? 5 : 2);
  else game.wearTile(gb.x, gb.z, 0.6);

  busy.add(m.id);
  const done = { v: false };
  if (be) {
    be.trail = plan.kind === 'full';
    sim.playBall(be, res.keys, () => {
      done.v = true;
    });
  } else done.v = true;
  yield* wait(dur * 0.4);
  m.setAnim('idle');
  // the next golfer can step up while this ball is in the air, but we resolve the result here
  const resolve = function* (): Co {
    yield* until(() => done.v, 12);
    switch (res.outcome) {
      case 'holed':
        gb.holed = true;
        gb.x = hole.pinWorld.x;
        gb.z = hole.pinWorld.z;
        if (be) be.state = 'hidden';
        game.events.emit('sound', { name: 'cup', x: gb.x, z: gb.z });
        break;
      case 'water': {
        game.events.emit('splash', { x: res.rest.x, z: res.rest.z, small: false });
        m.think('waterball', 'Lost my ball in the water', -2);
        gb.strokes++;
        if (be) be.state = 'hidden';
        yield* wait(0.8);
        gb.x = res.safe.x;
        gb.z = res.safe.z;
        if (be) {
          be.state = 'rest';
          be.x = gb.x;
          be.z = gb.z;
          be.y = w.heightAt(gb.x, gb.z) + 0.04;
        }
        break;
      }
      case 'ob':
        m.think('ob', 'Hit it out of bounds', -2);
        gb.strokes++;
        if (be) be.state = 'hidden';
        yield* wait(0.5);
        // drop near where it went out (simplified penalty)
        gb.x = (startPos.x + res.rest.x) / 2;
        gb.z = (startPos.z + res.rest.z) / 2;
        if (!w.isOwnedWorld(gb.x, gb.z) || w.surfAt(gb.x, gb.z) === Surf.Water) {
          gb.x = startPos.x;
          gb.z = startPos.z;
        }
        if (be) {
          be.state = 'rest';
          be.x = gb.x;
          be.z = gb.z;
          be.y = w.heightAt(gb.x, gb.z) + 0.04;
        }
        break;
      default:
        gb.x = res.rest.x;
        gb.z = res.rest.z;
        gb.lastSafe = { ...res.rest };
        if (res.landSurf === Surf.Bunker) game.events.emit('sound', { name: 'land_sand', x: gb.x, z: gb.z });
        if (res.outcome === 'tree') game.events.emit('sound', { name: 'tree_hit', x: gb.x, z: gb.z });
        if (plan.kind === 'full' && isTee && plan.club.id === 'dr') {
          const yds = Math.round(Math.hypot(gb.x - startPos.x, gb.z - startPos.z) * YARDS_PER_WORLD);
          if (yds > 280 && sim.rng.chance(0.5)) m.think('bigdrive', `Smashed a ${yds}-yard drive!`, 3);
        }
    }
    // pick up when it's hopeless
    const maxOver = m.skill > 0.6 ? 4 : 5;
    if (!gb.holed && gb.strokes >= hole.par + maxOver) {
      gb.holed = true;
      gb.pickedUp = true;
      if (be) be.state = 'hidden';
    }
    busy.delete(m.id);
  };
  // run the resolver in the background so the group keeps moving
  sim.attachVehicleCo(resolve() as Generator<void, void, number>);
  if (isTee) yield* wait(0.3);
  else yield* until(() => !busy.has(m.id), 14);
  void COURSE_SCALE;
}

// ---------------------------------------------------------------- leisure
function* leisure(sim: Sim, p: Person): Co {
  const game = sim.game;
  if (p.removed) return;
  const vt = VISITOR_TYPES[p.vtype];
  const w = game.world;
  // restroom
  if (p.bladder > 45) {
    const t = sim.nearestObject((o) => ITEMS[o.type].kind === 'toilet', p.x, p.z);
    if (t) {
      const e = sim.entrancePoint(t);
      p.activity = 'Using the restroom';
      yield* walkTo(sim, p, e.x, e.z);
      p.visible = false;
      yield* wait(4);
      p.visible = true;
      p.bladder = 0;
    } else if (p.bladder > 70) p.think('notoilet', 'Why are there no restrooms here?!', -10);
  }
  // lesson
  const academy = w.objectsOfKind('academy')[0];
  const lessonChance = p.vtype === 'beginner' || p.vtype === 'junior' ? 0.3 : p.vtype === 'casual' ? 0.18 : 0.06;
  if (academy && game.freePros() > 0 && sim.rng.chance(lessonChance)) {
    const price = game.state.prices.lesson;
    if (game.priceCheck(p, price, game.fairLessonPrice()) !== 'refuse') {
      const e = sim.entrancePoint(academy);
      p.activity = 'Taking a golf lesson';
      yield* walkTo(sim, p, e.x, e.z);
      if (game.freePros() > 0) {
        sim.lessonsActive++;
        p.visible = false;
        game.earn('lessons', price, e);
        p.cash -= price;
        p.spent += price;
        yield* wait(30);
        sim.lessonsActive--;
        p.visible = true;
        p.think('lesson', 'My lesson really helped!', 9);
      }
    } else p.think('lessonprice', 'Lessons cost too much', -3);
  }
  // food & drink
  const hungry = p.hunger > 40 || p.thirst > 40 || sim.rng.chance(vt.food * 0.6);
  if (hungry) {
    const wealthy = p.cash > 250;
    const pref = wealthy ? ['restaurant', 'bar', 'cafe', 'clubhouse'] : p.holesPlayed > 0 ? ['bar', 'cafe', 'restaurant', 'clubhouse'] : ['cafe', 'bar', 'clubhouse', 'restaurant'];
    let outlet: PlacedObject | null = null;
    for (const t of pref) {
      outlet = sim.nearestObject((o) => o.type === t, p.x, p.z);
      if (outlet) break;
    }
    if (outlet) {
      const def = ITEMS[outlet.type];
      const cap = (def.capacity ?? 10) * (outlet.level || 1);
      const e = sim.entrancePoint(outlet);
      p.activity = `Visiting the ${def.name}`;
      yield* walkTo(sim, p, e.x, e.z);
      const ok = yield* until(() => (sim.occupancy.get(outlet!.id) ?? 0) < cap, 15);
      if (ok) {
        const base = outlet.type === 'clubhouse' ? 7 : def.spend ?? 8;
        const spend = game.foodSpend(p, base * (outlet.level > 1 ? 1.25 : 1));
        if (spend > 0) {
          sim.enter(outlet, 1);
          p.visible = false;
          yield* wait(outlet.type === 'restaurant' ? 26 : outlet.type === 'bar' ? 20 : 12);
          sim.enter(outlet, -1);
          p.visible = true;
          game.earn('food', spend, e);
          p.cash -= spend;
          p.spent += spend;
          p.hunger = 0;
          p.thirst = 0;
          p.think('food_' + outlet.type, outlet.type === 'restaurant' ? 'What a wonderful meal' : outlet.type === 'bar' ? 'A cold pint after golf — lovely' : 'Tasty snack', outlet.type === 'restaurant' ? 7 : 4);
          // litter
          if (sim.rng.chance(0.25)) {
            const bin = sim.nearestObject((o) => o.type === 'bin', p.x, p.z);
            const binD = bin ? Math.hypot(w.objectCenter(bin).x - p.x, w.objectCenter(bin).z - p.z) : Infinity;
            if (binD > 26) sim.dropLitter(p.x + sim.rng.range(-3, 3), p.z + sim.rng.range(-3, 3));
          }
        } else p.think('foodprice', 'Food prices here are a rip-off', -5);
      } else p.think('foodqueue', 'The queue for food was too long', -5);
    } else if (p.hunger > 60 || p.thirst > 60) p.think('nofood', "I'm starving and there's nowhere to eat", -8);
  }
  // pro shop
  const shop = w.objectsOfType('pro_shop')[0];
  if (shop && sim.rng.chance(vt.shop) && p.cash > 30) {
    const e = sim.entrancePoint(shop);
    p.activity = 'Browsing the pro shop';
    yield* walkTo(sim, p, e.x, e.z);
    p.visible = false;
    yield* wait(10);
    p.visible = true;
    const spend = game.shopSpend(p, shop.level);
    if (spend > 0) {
      game.earn('shop', spend, e);
      p.cash -= spend;
      p.spent += spend;
      p.think('shop', sim.rng.pick(['Bought a new glove', 'Picked up some new balls', 'Treated myself to a new polo', 'New putter — this changes everything']), 4);
    } else p.think('shopprice', 'Pro shop prices are silly', -3);
  }
  // relax on a bench / gazebo with nice scenery
  if (sim.rng.chance(0.15)) {
    const bench = sim.nearestObject((o) => o.type === 'bench' || o.type === 'gazebo', p.x, p.z);
    if (bench) {
      const c = w.objectCenter(bench);
      if (Math.hypot(c.x - p.x, c.z - p.z) < 80) {
        p.activity = 'Enjoying the view';
        yield* walkTo(sim, p, c.x, c.z + 0.6);
        p.setAnim('sit');
        yield* wait(8);
        p.setAnim('idle');
        p.think('bench', 'Lovely spot to sit and relax', 3);
      }
    }
  }
}

/** Visitor-type weighted random pick. */
export function pickVisitorType(sim: Sim, boosts: Record<string, number>): VisitorTypeId | null {
  const game = sim.game;
  const rep = game.state.reputation;
  const helipad = game.world.objectsOfKind('helipad').length > 0;
  const entries = Object.values(VISITOR_TYPES).filter((v) => rep >= v.minRep && (v.id !== 'vip' || helipad));
  if (!entries.length) return null;
  let total = 0;
  const ws = entries.map((v) => {
    const wgt = v.weight * (1 + (boosts[v.id] ?? 0));
    total += wgt;
    return wgt;
  });
  let r = sim.rng.next() * total;
  for (let i = 0; i < entries.length; i++) {
    r -= ws[i];
    if (r <= 0) return entries[i].id;
  }
  return entries[entries.length - 1].id;
}
