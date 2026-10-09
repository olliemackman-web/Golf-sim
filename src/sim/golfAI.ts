// AI golfer shot planning and simplified outcome simulation (for visitors & tournament pros).
import { COURSE_SCALE, Surf, TILE, YARDS_PER_WORLD } from '../core/constants';
import { RNG } from '../core/rng';
import { CLUBS, ClubDef, aiCarryYards } from '../data/clubs';
import { ITEMS } from '../data/items';
import type { Course, HoleInfo, V2 } from '../world/Course';
import type { World } from '../world/World';

export interface ShotPlan {
  club: ClubDef;
  target: V2;
  carry: number; // world metres
  kind: 'full' | 'chip' | 'putt';
}

export interface ShotResult {
  keys: number[];
  duration: number;
  rest: V2;
  outcome: 'ok' | 'water' | 'ob' | 'holed' | 'tree';
  landSurf: Surf;
  safe: V2;
  carry: number;
}

const FULL_CLUBS = CLUBS.filter((c) => !c.putter);

function carryWorld(c: ClubDef, skill: number): number {
  return aiCarryYards(c, skill) / YARDS_PER_WORLD;
}

export function lieMods(s: Surf): { sigma: number; dist: number } {
  switch (s) {
    case Surf.Rough: return { sigma: 1.3, dist: 0.92 };
    case Surf.DeepRough: return { sigma: 1.75, dist: 0.78 };
    case Surf.Bunker: return { sigma: 1.6, dist: 0.74 };
    default: return { sigma: 1, dist: 1 };
  }
}

function okLanding(w: World, p: V2): number {
  // returns desirability score: 3 fairway/green, 2 rough, 1 deep rough/bunker, 0 bad
  if (!w.isOwnedWorld(p.x, p.z)) return 0;
  const s = w.surfAt(p.x, p.z);
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.z / TILE);
  if (w.treeAtTile(tx, ty)) return 0.5;
  const o = w.objectAtTile(tx, ty);
  if (o) return 0;
  switch (s) {
    case Surf.Fairway: case Surf.Green: return 3;
    case Surf.Tee: case Surf.Path: case Surf.Paving: return 2.2;
    case Surf.Rough: return 2;
    case Surf.DeepRough: return 1;
    case Surf.Bunker: return 0.8;
    case Surf.Water: return 0;
    default: return 0.3;
  }
}

export function planShot(w: World, course: Course, hole: HoleInfo, ball: V2, skill: number, isTee: boolean): ShotPlan {
  const pin = hole.pinWorld;
  const lie = w.surfAt(ball.x, ball.z);
  const dPin = Math.hypot(pin.x - ball.x, pin.z - ball.z);
  const putter = CLUBS[CLUBS.length - 1];
  if (lie === Surf.Green && dPin < 60) return { club: putter, target: pin, carry: dPin, kind: 'putt' };
  const yds = dPin * YARDS_PER_WORLD;
  const sw = CLUBS.find((c) => c.id === 'sw')!;
  if (yds < 42) return { club: lie === Surf.Bunker ? sw : CLUBS.find((c) => c.id === 'lw')!, target: pin, carry: dPin * 0.8, kind: 'chip' };

  const lm = lieMods(lie);
  const longest = isTee ? FULL_CLUBS[0] : FULL_CLUBS[1];
  const maxCarry = carryWorld(longest, skill) * lm.dist;
  const roll = isTee ? 1.08 : 1.04;

  if (dPin <= maxCarry * roll * 1.02) {
    const need = (dPin / lm.dist) * 0.97;
    return { club: pickClub(need, skill, isTee), target: pin, carry: dPin, kind: 'full' };
  }
  // lay up / tee shot along the route
  const s0 = course.projectOnRoute(hole, ball);
  let best: V2 | null = null;
  let bestScore = -1;
  for (let s = s0 + maxCarry * 1.05; s >= s0 + maxCarry * 0.55; s -= 4) {
    const p = course.pointAt(hole, s);
    const d = Math.hypot(p.x - ball.x, p.z - ball.z);
    if (d > maxCarry * 1.06) continue;
    const sc = okLanding(w, p) + d / (maxCarry * 4);
    if (sc > bestScore) {
      bestScore = sc;
      best = p;
    }
    if (sc >= 3) break;
  }
  if (!best) best = course.pointAt(hole, s0 + maxCarry * 0.9);
  const d = Math.hypot(best.x - ball.x, best.z - ball.z);
  return { club: pickClub(d / lm.dist / roll, skill, isTee), target: best, carry: d, kind: 'full' };
}

function pickClub(carryNeeded: number, skill: number, isTee: boolean): ClubDef {
  const options = isTee ? FULL_CLUBS : FULL_CLUBS.slice(1);
  let pick = options[0];
  for (const c of options) {
    if (carryWorld(c, skill) >= carryNeeded) pick = c;
    else break;
  }
  return pick;
}

/** Simulate an AI shot outcome and produce keyframes for the ball animation. */
export function simulateShot(w: World, plan: ShotPlan, from: V2, skill: number, rng: RNG, pin: V2, greenSpeed = 1): ShotResult {
  if (plan.kind === 'putt') return simulatePutt(w, from, pin, skill, rng, greenSpeed);
  const lie = w.surfAt(from.x, from.z);
  const lm = lieMods(lie);
  const isWood = plan.club.id === 'dr' || plan.club.id === '3w' || plan.club.id === '5w';
  const isChip = plan.kind === 'chip';
  let sigA = (0.075 - 0.062 * skill) * lm.sigma * (isWood ? 1.2 : 1);
  let sigD = 0.085 - 0.06 * skill;
  if (isChip) {
    sigA = (0.16 - 0.12 * skill) * (lie === Surf.Bunker ? 1.4 : 1);
    sigD = (0.24 - 0.17 * skill) * (lie === Surf.Bunker ? 1.4 : 1);
  }
  let distMul = 1 + rng.gauss() * sigD;
  let ang = rng.gauss() * sigA;
  if (!isChip && rng.chance(0.13 - 0.12 * skill)) {
    // mishit: topped, thin or shanked
    distMul *= rng.range(0.35, 0.7);
    ang += rng.gauss() * 0.18;
  }
  const dx = plan.target.x - from.x;
  const dz = plan.target.z - from.z;
  const baseAng = Math.atan2(dx, dz);
  const a = baseAng + ang;
  const dirx = Math.sin(a), dirz = Math.cos(a);
  let carry = plan.carry * distMul * (isChip ? 0.85 : 1) * (lie === Surf.Bunker && isChip ? 1 : 1);
  if (plan.kind === 'full' && lm.dist < 1) carry *= 1; // already accounted in plan
  carry = Math.max(3, carry);

  const startY = w.heightAt(from.x, from.z);
  const land = { x: from.x + dirx * carry, z: from.z + dirz * carry };
  const apexReal = isChip ? 4 + carry * 0.05 : Math.min(38, 10 + plan.club.launch * 0.9 + carry * 0.08);
  const apex = apexReal / COURSE_SCALE * (isChip ? 1 : 1.25);
  const flightT = isChip ? 0.9 + carry * 0.025 : 1.0 + carry * 0.011;

  const keys: number[] = [];
  const N = 14;
  // tree interception along the low parts of the flight
  let hitTree: V2 | null = null;
  let treeU = 1;
  for (let i = 1; i < 24; i++) {
    const u = i / 24;
    const hgt = apex * 4 * u * (1 - u);
    if (hgt > 9) continue;
    const px = from.x + dirx * carry * u, pz = from.z + dirz * carry * u;
    const t = w.treeAtTile(Math.floor(px / TILE), Math.floor(pz / TILE));
    if (t && Math.hypot(t.x - px, t.z - pz) < 3.5 && rng.chance(0.4)) {
      hitTree = { x: px, z: pz };
      treeU = u;
      break;
    }
  }
  const flightEnd = hitTree ? treeU : 1;
  for (let i = 0; i <= N; i++) {
    const u = (i / N) * flightEnd;
    const px = from.x + dirx * carry * u;
    const pz = from.z + dirz * carry * u;
    const ground = startY + (w.heightAt(land.x, land.z) - startY) * u;
    const hgt = apex * Math.sin(Math.PI * Math.pow(u, 0.88));
    keys.push(flightT * (i / N) * flightEnd, px, ground + hgt + 0.05, pz);
  }
  let t = flightT * flightEnd;

  if (hitTree) {
    // ball drops from the canopy near the trunk
    const dropX = hitTree.x + rng.range(-2.5, 2.5) - dirx * rng.range(0, 3);
    const dropZ = hitTree.z + rng.range(-2.5, 2.5) - dirz * rng.range(0, 3);
    const gy = w.heightAt(dropX, dropZ);
    t += 0.7;
    keys.push(t, dropX, gy + 0.05, dropZ);
    const s = w.surfAt(dropX, dropZ);
    const res: ShotResult = { keys, duration: t, rest: { x: dropX, z: dropZ }, outcome: 'tree', landSurf: s, safe: { x: dropX, z: dropZ }, carry: carry * treeU };
    return finalizeHazards(w, res, from);
  }

  // landing & roll
  const landS = w.surfAt(land.x, land.z);
  if (!w.isOwnedWorld(land.x, land.z) || isBlocked(w, land)) {
    return { keys, duration: t, rest: land, outcome: 'ob', landSurf: landS, safe: from, carry };
  }
  if (landS === Surf.Water) {
    return { keys, duration: t, rest: land, outcome: 'water', landSurf: landS, safe: lastDry(w, from, land), carry };
  }
  let rollFrac: number;
  switch (landS) {
    case Surf.Green: rollFrac = isChip ? 0.35 : plan.club.spin > 8000 ? 0.02 : 0.06; break;
    case Surf.Fairway: case Surf.Tee: rollFrac = isWood ? 0.12 : 0.06; break;
    case Surf.Path: case Surf.Paving: rollFrac = 0.18; break;
    case Surf.Rough: rollFrac = 0.025; break;
    case Surf.DeepRough: rollFrac = 0.008; break;
    case Surf.Bunker: rollFrac = 0.0; break;
    default: rollFrac = 0.03;
  }
  if (isChip && landS !== Surf.Green) rollFrac = Math.min(0.2, rollFrac * 3);
  const rollD = carry * rollFrac * rng.range(0.6, 1.3);
  // bounce
  const by = w.heightAt(land.x, land.z);
  if (rollD > 0.5) {
    const bx = land.x + dirx * rollD * 0.3, bz = land.z + dirz * rollD * 0.3;
    t += 0.35;
    keys.push(t - 0.18, (land.x + bx) / 2, by + Math.min(2, rollD * 0.08) + 0.05, (land.z + bz) / 2);
    keys.push(t, bx, w.heightAt(bx, bz) + 0.05, bz);
  }
  // roll, stopping at hazards
  let rest = { x: land.x, z: land.z };
  let outcome: ShotResult['outcome'] = 'ok';
  const steps = Math.ceil(rollD / 1.5);
  for (let i = 1; i <= steps; i++) {
    const d = rollD * (0.3 + 0.7 * (i / steps));
    const p = { x: land.x + dirx * d, z: land.z + dirz * d };
    const s = w.surfAt(p.x, p.z);
    if (!w.isOwnedWorld(p.x, p.z) || isBlocked(w, p)) {
      outcome = 'ob';
      rest = p;
      break;
    }
    if (s === Surf.Water) {
      outcome = 'water';
      rest = p;
      break;
    }
    rest = p;
    if (s === Surf.Bunker || s === Surf.DeepRough) break;
  }
  if (rollD > 0.5 || outcome !== 'ok') {
    t += Math.min(2.5, 0.4 + rollD * 0.09);
    keys.push(t, rest.x, w.heightAt(rest.x, rest.z) + 0.05, rest.z);
  }
  const res: ShotResult = { keys, duration: t, rest, outcome, landSurf: w.surfAt(rest.x, rest.z), safe: outcome === 'water' ? lastDry(w, from, rest) : rest, carry };
  // chip-ins
  if (isChip && outcome === 'ok' && Math.hypot(rest.x - pin.x, rest.z - pin.z) < 0.6 && rng.chance(0.35 + skill * 0.3)) {
    res.outcome = 'holed';
    res.rest = { ...pin };
    keys.push(t + 0.3, pin.x, w.heightAt(pin.x, pin.z) - 0.1, pin.z);
    res.duration = t + 0.3;
  }
  return res;
}

function isBlocked(w: World, p: V2): boolean {
  const o = w.objectAtTile(Math.floor(p.x / TILE), Math.floor(p.z / TILE));
  if (!o) return false;
  return !['target', 'course_prop', 'deco', 'bench', 'bin', 'lamp', 'practice'].includes(itemKind(o.type));
}

function itemKind(t: string): string {
  return ITEMS[t]?.kind ?? 'deco';
}

function lastDry(w: World, from: V2, to: V2): V2 {
  const L = Math.hypot(to.x - from.x, to.z - from.z);
  for (let d = L; d >= 0; d -= 1) {
    const p = { x: from.x + ((to.x - from.x) * d) / L, z: from.z + ((to.z - from.z) * d) / L };
    if (w.surfAt(p.x, p.z) !== Surf.Water) {
      // step back a little more from the edge
      const q = { x: from.x + ((to.x - from.x) * Math.max(0, d - 2.5)) / L, z: from.z + ((to.z - from.z) * Math.max(0, d - 2.5)) / L };
      return w.surfAt(q.x, q.z) !== Surf.Water ? q : p;
    }
  }
  return from;
}

function finalizeHazards(w: World, r: ShotResult, from: V2): ShotResult {
  const s = w.surfAt(r.rest.x, r.rest.z);
  if (s === Surf.Water) {
    r.outcome = 'water';
    r.safe = lastDry(w, from, r.rest);
  } else if (!w.isOwnedWorld(r.rest.x, r.rest.z)) {
    r.outcome = 'ob';
    r.safe = from;
  }
  return r;
}

export function simulatePutt(w: World, from: V2, pin: V2, skill: number, rng: RNG, greenSpeed = 1): ShotResult {
  const d = Math.hypot(pin.x - from.x, pin.z - from.z);
  const dReal = d * COURSE_SCALE;
  const make = dReal < 0.6 ? 0.985 : Math.max(0.02, Math.min(0.97, 1.02 - dReal * (0.135 - 0.07 * skill) - (dReal > 8 ? 0.05 : 0)));
  const keys: number[] = [];
  const y0 = w.heightAt(from.x, from.z) + 0.05;
  keys.push(0, from.x, y0, from.z);
  const dir = Math.atan2(pin.x - from.x, pin.z - from.z);
  let rest: V2;
  let outcome: ShotResult['outcome'] = 'ok';
  const dur = Math.min(3.2, 0.8 + d * 0.16) / Math.sqrt(greenSpeed);
  if (rng.chance(make)) {
    rest = { ...pin };
    outcome = 'holed';
    // slight curve
    const mid = { x: (from.x + pin.x) / 2 + Math.cos(dir) * d * 0.04 * rng.range(-1, 1), z: (from.z + pin.z) / 2 - Math.sin(dir) * d * 0.04 * rng.range(-1, 1) };
    keys.push(dur * 0.55, mid.x, w.heightAt(mid.x, mid.z) + 0.05, mid.z);
    keys.push(dur, pin.x, w.heightAt(pin.x, pin.z) + 0.04, pin.z);
    keys.push(dur + 0.15, pin.x, w.heightAt(pin.x, pin.z) - 0.12, pin.z);
    return { keys, duration: dur + 0.15, rest, outcome, landSurf: Surf.Green, safe: rest, carry: d };
  }
  const leaveReal = Math.max(0.25, dReal * rng.range(0.04, 0.22) * (1.4 - skill * 0.6) + rng.range(0, 0.4));
  const leave = leaveReal / COURSE_SCALE;
  const long = rng.chance(0.65);
  const side = rng.gauss() * 0.7;
  const along = long ? d + leave * 0.8 : d - leave * 0.8;
  const ax = from.x + Math.sin(dir) * along + Math.cos(dir) * side * leave;
  const az = from.z + Math.cos(dir) * along - Math.sin(dir) * side * leave;
  rest = { x: ax, z: az };
  const mid = { x: (from.x + ax) / 2, z: (from.z + az) / 2 };
  keys.push(dur * 0.55, mid.x, w.heightAt(mid.x, mid.z) + 0.05, mid.z);
  keys.push(dur, ax, w.heightAt(ax, az) + 0.05, az);
  if (w.surfAt(ax, az) !== Surf.Green && w.surfAt(ax, az) === Surf.Water) outcome = 'water';
  return { keys, duration: dur, rest, outcome, landSurf: w.surfAt(ax, az), safe: from, carry: d };
}

