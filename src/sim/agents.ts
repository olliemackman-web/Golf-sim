// Runtime entities: people, vehicles, groups, balls.
import { RNG } from '../core/rng';
import type { VisitorTypeId } from '../data/visitors';
import type { StaffRole } from '../data/staff';

export type Anim =
  | 'idle' | 'walk' | 'swing' | 'chip' | 'putt' | 'sit' | 'cheer' | 'clap' | 'ride' | 'drive' | 'pick' | 'wave' | 'think';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Co = Generator<void, any, number>;

const SHIRTS = [0xe8e4da, 0x2f5d9e, 0xc0392b, 0x1f7a4d, 0xf2c14e, 0x8e44ad, 0x16a085, 0xe67e22, 0x2c3e50, 0xf06292, 0x5dade2, 0xffffff, 0x34495e, 0x9b2d2d, 0x7fb069];
const PANTS = [0xc8b48a, 0x2b3a55, 0xeeeeee, 0x707a80, 0x222222, 0x8a7d62, 0x3c4a3c];
const SKIN = [0xf1c9a5, 0xe0ac86, 0xc68a62, 0x9b6440, 0x6b4428, 0xf6d5bd];
const HAIR = [0x2b1d14, 0x4a3020, 0x8a5a2b, 0xd8b56a, 0x111111, 0xaaaaaa, 0x6b3b1f];
const HATS = [0xffffff, 0x1f3b6b, 0x111111, 0xc0392b, 0x1f7a4d, 0xe8e4da, 0xf2c14e];

export interface Colors {
  shirt: number;
  pants: number;
  skin: number;
  hair: number;
  hat: number;
  /** 0 none, 1 cap, 2 visor, 3 bucket hat */
  hatType: number;
}

export function randomColors(r: RNG): Colors {
  return {
    shirt: r.pick(SHIRTS),
    pants: r.pick(PANTS),
    skin: r.pick(SKIN),
    hair: r.pick(HAIR),
    hat: r.pick(HATS),
    hatType: r.chance(0.55) ? (r.chance(0.7) ? 1 : r.chance(0.5) ? 2 : 3) : 0,
  };
}

export interface Thought {
  key: string;
  text: string;
  good: boolean;
}

let nextEntityId = 1;
export function newEntityId(): number {
  return nextEntityId++;
}

export class Person {
  id = newEntityId();
  name = '';
  kind: 'visitor' | 'staff' | 'player' | 'spectator' | 'tourpro' = 'visitor';
  x = 0;
  z = 0;
  y = 0;
  heading = 0;
  targetHeading: number | null = null;
  speed = 6;
  anim: Anim = 'idle';
  animT = 0;
  /** Swing animation length scale (driver slower than wedge). */
  animDur = 1.2;
  visible = true;
  colors: Colors;
  bag = true;
  scale = 1;

  path: { x: number; z: number }[] = [];
  pathI = 0;
  moving = false;
  vehicle: Vehicle | null = null;

  // visitor data
  vtype: VisitorTypeId = 'casual';
  skill = 0.5;
  cash = 100;
  spent = 0;
  happiness = 65;
  hunger = 0;
  thirst = 0;
  bladder = 0;
  energy = 100;
  thoughts: Thought[] = [];
  group: Group | null = null;
  member = false;
  arrivedMinute = 0;
  waitMin = 0;
  activity = 'Arriving';
  /** Staff record id for staff people. */
  staffId = 0;
  role: StaffRole | null = null;
  removed = false;
  /** Individual behaviour coroutine (staff, solo activities). */
  co: Co | null = null;
  /** Walking surface speed bonus/penalty applied this frame. */
  lateral = 0;
  /** Time spent at current activity (for UI). */
  busy = 0;
  /** Range balls carried by a walking range assistant (visual units). */
  carry = 0;
  /** Scenery sampling while walking. */
  sceneSum = 0;
  sceneN = 0;
  /** Played holes this visit. */
  holesPlayed = 0;
  wantsLesson = false;

  constructor(colors: Colors) {
    this.colors = colors;
  }

  setAnim(a: Anim, dur = 1.2): void {
    if (this.anim !== a) this.animT = 0;
    this.anim = a;
    this.animDur = dur;
  }

  restartAnim(a: Anim, dur = 1.2): void {
    this.anim = a;
    this.animT = 0;
    this.animDur = dur;
  }

  face(x: number, z: number): void {
    const dx = x - this.x;
    const dz = z - this.z;
    if (dx * dx + dz * dz < 1e-6) return;
    this.targetHeading = Math.atan2(dx, dz);
  }

  think(key: string, text: string, delta: number): void {
    this.happiness = Math.max(0, Math.min(100, this.happiness + delta));
    const i = this.thoughts.findIndex((t) => t.key === key);
    if (i >= 0) this.thoughts.splice(i, 1);
    this.thoughts.unshift({ key, text, good: delta >= 0 });
    if (this.thoughts.length > 6) this.thoughts.pop();
  }
}

export type VehicleType = 'car' | 'golf_cart' | 'mower' | 'ball_picker' | 'helicopter';

export class Vehicle {
  id = newEntityId();
  x = 0;
  z = 0;
  y = 0;
  heading = 0;
  speed = 8;
  color = 0xffffff;
  visible = true;
  path: { x: number; z: number }[] = [];
  pathI = 0;
  moving = false;
  removed = false;
  /** Height offset (helicopter flight). */
  lift = 0;
  /** Cart/picker load for range picker. */
  load = 0;
  constructor(public type: VehicleType) {}
}

export interface GolfBall {
  x: number;
  z: number;
  strokes: number;
  holed: boolean;
  pickedUp: boolean;
  lastSafe: { x: number; z: number };
  ballId: number;
}

export class Group {
  id = newEntityId();
  members: Person[] = [];
  car: Vehicle | null = null;
  carSlot = -1;
  carpark = 0;
  plan = { range: false, course: false, holes: [] as number[] };
  co: Co | null = null;
  removed = false;
  carts: Vehicle[] = [];
  /** Per-member scorecards by hole id. */
  scores = new Map<number, number[]>();
  balls = new Map<number, GolfBall>();
  currentHole = 0;
  waiting = 0;
  isTournament = false;
  helicopter = false;
}

export type BallState = 'flying' | 'rolling' | 'rest' | 'hidden';

/** A visible golf ball moving along a precomputed keyframed path. */
export class BallEntity {
  id = newEntityId();
  x = 0;
  y = 0;
  z = 0;
  state: BallState = 'rest';
  t = 0;
  /** Keyframes: [time, x, y, z] flattened. */
  keys: number[] = [];
  removeAtEnd = false;
  onEnd: (() => void) | null = null;
  removed = false;
  trail = false;
  /** Range ball that should be dropped on the field at the end. */
  fieldDrop = false;
  /** Visible size multiplier. */
  size = 1;
}

export interface Litter {
  id: number;
  x: number;
  z: number;
  rot: number;
}
