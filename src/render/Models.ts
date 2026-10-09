// Procedural model library for Fairway Empire.
// All models are built from primitives with the Kit in ./modelKit. Conventions:
//   metres, +Y up, origin = centre of footprint at ground level, FRONT faces +Z.
//   Range bays: golfers hit towards -Z.
import * as THREE from 'three';
import { Kit, shade, type BuildOpts, type Col, type PO, type V2, type V3 } from './modelKit';
import type { ModelData } from './modelTypes';

const PI = Math.PI;
const TAU = PI * 2;

// ------------------------------------------------------------------------------------------------
// Palette (sRGB hex; Kit converts to linear)
// ------------------------------------------------------------------------------------------------
const C = {
  green: 0x1f5135,
  greenD: 0x173d28,
  greenL: 0x2f6c49,
  cream: 0xf1e9d2,
  creamD: 0xe2d6b8,
  brass: 0xc9a54a,
  white: 0xf7f5ef,
  trim: 0xfbfaf6,
  slate: 0x434a56,
  slateD: 0x323843,
  charcoal: 0x2f3236,
  timber: 0x9b6a3f,
  timberD: 0x5c3c24,
  timberL: 0xc49a69,
  timberG: 0x8a7e70,
  stone: 0xbdb4a3,
  stoneD: 0x8f8777,
  stoneL: 0xd8d0c0,
  sandstone: 0xe0cba0,
  brick: 0xa5573d,
  brickD: 0x7b3e2c,
  sand: 0xe3d3a1,
  sandD: 0xcbb57f,
  fairway: 0x4f9a3a,
  putt: 0x5cb247,
  fringe: 0x4a9439,
  rough: 0x3f7f2f,
  turf: 0x6dbf50,
  turfD: 0x55a440,
  rubber: 0x2c302d,
  concrete: 0xc4c1b8,
  concreteD: 0xa3a098,
  asphalt: 0x3d4044,
  gravel: 0xbcb19b,
  glass: 0x506b80,
  screen: 0x4f86b8,
  glow: 0xfff3d4,
  water: 0x3d93ab,
  waterD: 0x1d4a55,
  soil: 0x5a3f2b,
  red: 0xc23a2e,
  yellow: 0xf2c331,
  navy: 0x1f2e4e,
  black: 0x1d1e20,
  iron: 0x23302a,
  steel: 0xa3abb2,
  steelD: 0x5d636a,
  bark: 0x5b4636,
  leaf: 0x4a8a33,
};

// ------------------------------------------------------------------------------------------------
// Registry
// ------------------------------------------------------------------------------------------------
type Def = (k: Kit) => BuildOpts | void;
const DEFS: Record<string, Def> = {};
function def(key: string, fn: Def): void {
  DEFS[key] = fn;
}

// ------------------------------------------------------------------------------------------------
// Generic helpers
// ------------------------------------------------------------------------------------------------
/** Yaw that maps local +X onto the direction (dx, dz). */
function yawX(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

function golfBall(k: Kit, x: number, y: number, z: number, r = 0.024): void {
  k.ball(0xf8f8f4, r, x, y + r, z, { kind: 'octa', detail: 0, smooth: true });
}

/** Foliage blob. */
function blob(k: Kit, c: Col, r: number, x: number, y: number, z: number, o?: { sx?: number; sy?: number; sz?: number; detail?: number; kind?: 'ico' | 'dodeca' | 'octa'; jit?: number; grad?: [number, number]; ry?: number; rx?: number; rz?: number }): void {
  k.ball(c, r, x, y, z, {
    mat: 'foliage',
    detail: o?.detail ?? 1,
    kind: o?.kind ?? 'ico',
    jit: o?.jit ?? 0.16,
    sx: o?.sx,
    sy: o?.sy,
    sz: o?.sz,
    rx: o?.rx,
    ry: o?.ry,
    rz: o?.rz,
    grad: o?.grad ?? [0.66, 1.1],
  });
}

/** Small cluster of flowers on a leaf mound. */
function flowerClump(k: Kit, x: number, y: number, z: number, r: number, petals: number[], n: number, leaf = 0x3f7f2f): void {
  blob(k, k.jc(leaf, 0.12), r, x, y + r * 0.25, z, { detail: 0, sy: 0.6, jit: 0.2, grad: [0.6, 1.05] });
  for (let i = 0; i < n; i++) {
    const a = k.r() * TAU;
    const d = Math.sqrt(k.r()) * r * 0.85;
    const px = x + Math.cos(a) * d;
    const pz = z + Math.sin(a) * d;
    const py = y + r * 0.25 + Math.sqrt(Math.max(0, 1 - (d / r) ** 2)) * r * 0.62 + 0.02;
    k.ball(k.jc(k.pick(petals), 0.1), r * 0.24 + k.r() * 0.03, px, py, pz, { kind: 'octa', detail: 0, sy: 0.7, ry: k.r() * 3 });
  }
}

/** Simple park bench facing +Z (seat centred at origin). */
function parkBench(k: Kit, len = 1.7, wood: Col = 0xa8743f, iron: Col = C.iron, padded?: Col): void {
  const hl = len / 2;
  for (const sx of [-1, 1]) {
    const x = sx * (hl - 0.12);
    k.box(iron, 0.06, 0.44, 0.06, x, 0.22, 0.2);
    k.box(iron, 0.06, 0.06, 0.5, x, 0.4, 0.0);
    k.box(iron, 0.06, 0.9, 0.06, x, 0.45, -0.22, { rx: -0.12 });
    k.box(iron, 0.05, 0.05, 0.46, x, 0.64, 0.05);
    k.box(iron, 0.06, 0.2, 0.05, x, 0.53, 0.25);
  }
  if (padded) {
    k.cbox(padded, len - 0.1, 0.1, 0.48, 0, 0.47, 0.0, 0.04);
    k.cbox(padded, len - 0.1, 0.42, 0.1, 0, 0.72, -0.25, 0.04, { rx: -0.14 });
  } else {
    for (let i = 0; i < 4; i++) k.box(k.jc(wood, 0.06), len, 0.04, 0.1, 0, 0.45, -0.17 + i * 0.12);
    for (let i = 0; i < 3; i++) k.box(k.jc(wood, 0.06), len, 0.09, 0.035, 0, 0.6 + i * 0.13, -0.24 - i * 0.017, { rx: -0.13 });
  }
}

/** Golf bag standing (slightly tilted) with clubs; origin at base. */
function golfBag(k: Kit, x: number, z: number, ry: number, tilt: number, bag: Col, trimC: Col = C.white): void {
  k.push(x, 0, z, ry, 1, tilt);
  k.cyl(bag, 0.13, 0.82, 0, 0, 0, { seg: 8, rt: 0.135 });
  k.cyl(C.black, 0.14, 0.07, 0, 0, 0, { seg: 8, caps: 'top' });
  k.cyl(trimC, 0.145, 0.08, 0, 0.8, 0, { seg: 8, caps: 'none' });
  k.box(trimC, 0.03, 0.55, 0.02, 0, 0.42, 0.135);
  k.box(shade(bag, 0.8), 0.16, 0.26, 0.07, 0, 0.36, 0.15);
  // clubs: two headcovers + irons
  k.tube(C.steel, [0.03, 0.8, 0.02], [0.05, 1.0, 0.03], 0.01, { seg: 4, mat: 'metal' });
  k.ball(C.red, 0.065, 0.05, 1.03, 0.04, { detail: 0, sy: 1.15 });
  k.ball(C.navy, 0.06, -0.06, 0.99, 0.03, { detail: 0, sy: 1.15 });
  k.box(C.steel, 0.025, 0.05, 0.08, 0.02, 0.98, -0.07, { mat: 'metal', rx: 0.3 });
  k.box(C.steel, 0.025, 0.05, 0.08, -0.05, 0.95, -0.05, { mat: 'metal', rx: 0.2 });
  k.pop();
}

function ballTray(k: Kit, x: number, z: number, ry = 0): void {
  k.push(x, 0, z, ry);
  k.tbox(C.timberD, 0.5, 0.26, 0.34, 0, 0, 0, 0.03);
  const g = C.greenL;
  k.box(g, 0.46, 0.03, 0.3, 0, 0.275, 0);
  k.box(g, 0.46, 0.06, 0.02, 0, 0.3, 0.14);
  k.box(g, 0.46, 0.06, 0.02, 0, 0.3, -0.14);
  k.box(g, 0.02, 0.06, 0.3, 0.22, 0.3, 0);
  k.box(g, 0.02, 0.06, 0.3, -0.22, 0.3, 0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) if ((i + j) % 4 !== 3) golfBall(k, -0.15 + i * 0.1 + (j % 2) * 0.03, 0.29, -0.08 + j * 0.08);
  k.pop();
}

/** Range-ball bucket (origin at base). */
function ballBucket(k: Kit, x: number, y: number, z: number, s = 1, bucketC: Col = C.greenL, balls = true, fine = false): void {
  k.push(x, y, z, 0, s);
  k.lathe([bucketC, bucketC, shade(bucketC, 1.15), bucketC, shade(bucketC, 0.5)], [[0, 0], [0.12, 0], [0.155, 0.27], [0.165, 0.28], [0.165, 0.31], [0.15, 0.31]], 0, 0, 0, { seg: 10 });
  k.lathe(shade(bucketC, 0.45), [[0.15, 0.3], [0, 0.3]], 0, 0, 0, { seg: 10 });
  k.tubes(C.steelD, [[-0.165, 0.27, 0], [-0.13, 0.4, 0], [0, 0.45, 0], [0.13, 0.4, 0], [0.165, 0.27, 0]], 0.008, { seg: 3 });
  if (balls) {
    const pts: [number, number, number][] = [[0, 0.33, 0]];
    for (let i = 0; i < 6; i++) pts.push([Math.cos((i * TAU) / 6) * 0.065, 0.315, Math.sin((i * TAU) / 6) * 0.065]);
    for (let i = 0; i < 9; i++) pts.push([Math.cos((i * TAU) / 9 + 0.3) * 0.125, 0.3, Math.sin((i * TAU) / 9 + 0.3) * 0.125]);
    for (const [px, py, pz] of pts) {
      if (fine) k.ball(0xf8f8f4, 0.024, px, py, pz, { detail: 0, smooth: true });
      else golfBall(k, px, py - 0.024, pz, 0.024);
    }
  }
  k.pop();
}

/** Flag pin with a cloth flag extending +X. */
function flagPin(k: Kit, x: number, y: number, z: number, h: number, flagC: Col | Col[], fw: number, fh: number, r = 0.015, poleC: Col = C.white): void {
  k.lathe(poleC, [[0, 0], [r, 0], [r * 0.85, h], [0, h]], x, y, z, { seg: 6 });
  k.ball(C.white, r * 1.4, x, y + h, z, { detail: 0, smooth: true });
  k.flag(flagC, fw, fh, x + r * 0.6, y + h - fh - 0.02, z, 6, { mat: flagMat(x) });
}
/**
 * The game's cloth shader displaces vertices by their raw local +X, so only flags whose pole sits on
 * the model's x = 0 axis may use 'cloth'; off-axis flags are static ('std').
 */
function flagMat(poleX: number): 'cloth' | 'std' {
  return Math.abs(poleX) < 0.1 ? 'cloth' : 'std';
}

/** Victorian lamp post (origin at base). */
function vicLamp(k: Kit, x: number, z: number, h = 3.6, ironC: Col = C.iron): void {
  k.push(x, 0, z, 0);
  k.lathe(ironC, [[0.24, 0], [0.24, 0.1], [0.19, 0.16], [0.14, 0.52], [0.07, 0.68]], 0, 0, 0, { seg: 6 });
  k.lathe(ironC, [[0.065, 0.68], [0.05, h - 0.75], [0.075, h - 0.66], [0.05, h - 0.55]], 0, 0, 0, { seg: 6 });
  k.lathe(C.brass, [[0.072, 1.25], [0.072, 1.32]], 0, 0, 0, { seg: 6, mat: 'metal' });
  k.box(ironC, 0.62, 0.04, 0.04, 0, h - 0.82, 0);
  // lantern
  const ly = h - 0.55;
  k.lathe(ironC, [[0.04, ly], [0.13, ly + 0.08], [0.14, ly + 0.1]], 0, 0, 0, { seg: 4, phase: PI / 4 });
  k.lathe(C.glow, [[0.12, ly + 0.1], [0.16, ly + 0.46], [0, ly + 0.46]], 0, 0, 0, { seg: 4, phase: PI / 4, mat: 'glow', flat: true });
  k.lathe(ironC, [[0, ly + 0.46], [0.22, ly + 0.47], [0.19, ly + 0.52], [0.06, ly + 0.66], [0, ly + 0.74]], 0, 0, 0, { seg: 4, phase: PI / 4, flat: true });
  k.pop();
}

/** Picnic table (along X) at origin. */
function picnicTable(k: Kit, wood: Col = 0xa77546): void {
  for (let i = 0; i < 4; i++) k.box(k.jc(wood, 0.05), 1.8, 0.05, 0.17, 0, 0.74, -0.27 + i * 0.18);
  for (const s of [-1, 1]) {
    k.box(k.jc(wood, 0.05), 1.8, 0.05, 0.24, 0, 0.44, s * 0.66);
    for (const sx of [-0.7, 0.7]) {
      k.box(shade(wood, 0.8), 0.07, 0.9, 0.08, sx, 0.38, s * 0.35, { rx: s * 0.62 });
    }
  }
  for (const sx of [-0.7, 0.7]) k.box(shade(wood, 0.85), 0.07, 0.06, 1.55, sx, 0.4, 0);
}

/** Round café table with chairs and an optional striped parasol. */
function cafeTable(k: Kit, chairs: number, parasol: [Col, Col] | null, tableC: Col = 0xf2f0ea, chairC: Col = C.greenL): void {
  k.lathe([C.steelD, C.steelD, tableC, tableC], [[0.26, 0], [0.03, 0.06], [0.03, 0.72], [0.38, 0.72], [0.38, 0.76], [0, 0.76]], 0, 0, 0, { seg: 8 });
  for (let i = 0; i < chairs; i++) {
    const a = (i / chairs) * TAU + PI / 4;
    k.push(Math.sin(a) * 0.7, 0, Math.cos(a) * 0.7, a + PI);
    k.box(chairC, 0.42, 0.05, 0.4, 0, 0.45, 0);
    k.box(chairC, 0.42, 0.38, 0.04, 0, 0.66, -0.2, { rx: -0.1, nb: true });
    for (const sx of [-0.18, 0.18]) k.box(C.steelD, 0.03, 0.43, 0.36, sx, 0.215, 0, { nb: true });
    k.pop();
  }
  if (parasol) {
    k.cyl(C.white, 0.022, 2.35, 0, 0.76, 0, { seg: 5 });
    const n = 8;
    const R = 1.25;
    const top: V3 = [0, 2.65, 0];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU;
      const a1 = ((i + 1) / n) * TAU;
      const p0: V3 = [Math.sin(a0) * R, 2.25, Math.cos(a0) * R];
      const p1: V3 = [Math.sin(a1) * R, 2.25, Math.cos(a1) * R];
      const c = i % 2 ? parasol[0] : parasol[1];
      k.tri(c, top, p0, p1, { up: [0, 1, 0] });
      k.tri(shade(c, 0.8), [0, 2.63, 0], [p0[0], 2.23, p0[2]], [p1[0], 2.23, p1[2]], { up: [0, -1, 0] });
      // valance flap
      k.quad(c, p0, p1, [p1[0], 2.12, p1[2]], [p0[0], 2.12, p0[2]], { up: [Math.sin((a0 + a1) / 2), 0, Math.cos((a0 + a1) / 2)] });
    }
    k.ball(C.white, 0.05, 0, 2.68, 0, { detail: 0 });
  }
}

/** Striped awning on a wall: wall at local z=0, extends +Z by depth, from y top down by drop. */
function awning(k: Kit, w: number, y: number, depth: number, drop: number, a: Col, b: Col, stripes: number, valance = true): void {
  const sw = w / stripes;
  for (let i = 0; i < stripes; i++) {
    const x0 = -w / 2 + i * sw;
    const x1 = x0 + sw;
    const c = i % 2 ? a : b;
    k.quad2(c, [x0, y, 0.02], [x1, y, 0.02], [x1, y - drop, depth], [x0, y - drop, depth], 0.01);
    if (valance) {
      k.quad2(c, [x0, y - drop, depth], [x1, y - drop, depth], [x1, y - drop - 0.22, depth], [x0, y - drop - 0.22, depth], 0.01);
      k.tri(c, [x0, y - drop - 0.22, depth + 0.012], [x1, y - drop - 0.22, depth + 0.012], [(x0 + x1) / 2, y - drop - 0.34, depth + 0.012], { up: [0, 0, 1] });
    }
  }
  // brackets
  for (const sx of [-w / 2 + 0.05, w / 2 - 0.05]) k.tube(C.iron, [sx, y - drop * 1.6, 0.02], [sx, y - drop + 0.02, depth - 0.05], 0.015, { seg: 4 });
}

/** Window opening at local origin: wall face at z=0, bottom-centre at y=0, facing +Z. */
interface WinO {
  frame?: Col;
  glass?: Col;
  sill?: Col | null;
  cols?: number;
  rows?: number;
  shutters?: Col;
  box?: number[]; // flower colours for a window box
  head?: Col; // lintel colour
  arch?: boolean;
  depth?: number;
  ft?: number;
}
function win(k: Kit, w: number, h: number, o: WinO = {}): void {
  const fr = o.frame ?? C.trim;
  const ft = o.ft ?? 0.08;
  const dz = o.depth ?? 0.07;
  k.quad(o.glass ?? C.glass, [-w / 2, 0, 0.03], [w / 2, 0, 0.03], [w / 2, h, 0.03], [-w / 2, h, 0.03], { mat: 'glass', up: [0, 0, 1] });
  k.box(fr, w + ft * 2, ft, dz, 0, h + ft / 2, dz / 2);
  k.box(fr, w + ft * 2, ft, dz, 0, -ft / 2, dz / 2);
  k.box(fr, ft, h, dz, -w / 2 - ft / 2, h / 2, dz / 2, { nb: true });
  k.box(fr, ft, h, dz, w / 2 + ft / 2, h / 2, dz / 2, { nb: true });
  const cols = o.cols ?? 2;
  const rows = o.rows ?? 2;
  for (let i = 1; i < cols; i++) k.box(fr, 0.04, h, 0.04, -w / 2 + (i * w) / cols, h / 2, 0.05, { nb: true });
  for (let j = 1; j < rows; j++) k.box(fr, w, 0.04, 0.04, 0, (j * h) / rows, 0.05);
  if (o.sill !== null) k.box(o.sill ?? fr, w + ft * 2 + 0.12, 0.06, 0.16, 0, -ft - 0.03, 0.08);
  if (o.head) k.box(o.head, w + ft * 2 + 0.16, 0.14, 0.1, 0, h + ft + 0.07, 0.05);
  if (o.shutters) {
    for (const s of [-1, 1]) {
      const sx = s * (w / 2 + ft + w * 0.27);
      k.box(o.shutters, w * 0.5, h + ft, 0.04, sx, h / 2, 0.03, { nb: true });
    }
  }
  if (o.box) {
    const bw = w + ft * 2 + 0.08;
    k.box(C.timberD, bw, 0.2, 0.22, 0, -ft - 0.2, 0.15);
    const n = Math.max(2, Math.round(bw / 0.42));
    for (let i = 0; i < n; i++) {
      const px = -bw / 2 + 0.12 + (i * (bw - 0.24)) / (n - 1);
      blob(k, k.jc(0x3e7d2f, 0.1), 0.16, px, -ft - 0.05, 0.16, { detail: 0, sy: 0.75 });
      k.ball(k.jc(k.pick(o.box), 0.1), 0.05, px + 0.04, -ft + 0.05, 0.22, { kind: 'octa', detail: 0 });
      k.ball(k.jc(k.pick(o.box), 0.1), 0.045, px - 0.06, -ft + 0.03, 0.19, { kind: 'octa', detail: 0 });
    }
  }
}

/** Panelled door (single or double) at local origin, wall at z=0, facing +Z. */
function door(k: Kit, w: number, h: number, o: { col?: Col; frame?: Col; double?: boolean; glazed?: boolean; fan?: boolean; step?: Col } = {}): void {
  const dc = o.col ?? C.green;
  const fr = o.frame ?? C.trim;
  const leaves = o.double ? 2 : 1;
  const lw = w / leaves;
  for (let i = 0; i < leaves; i++) {
    const cx = -w / 2 + lw * (i + 0.5);
    k.box(dc, lw - 0.02, h, 0.06, cx, h / 2, 0.0);
    if (o.glazed) {
      k.quad(C.glass, [cx - lw * 0.32, h * 0.42, 0.035], [cx + lw * 0.32, h * 0.42, 0.035], [cx + lw * 0.32, h * 0.9, 0.035], [cx - lw * 0.32, h * 0.9, 0.035], { mat: 'glass', up: [0, 0, 1] });
      k.box(shade(dc, 1.15), lw * 0.6, h * 0.28, 0.03, cx, h * 0.2, 0.035);
    } else {
      k.box(shade(dc, 1.15), lw * 0.6, h * 0.32, 0.03, cx, h * 0.68, 0.035);
      k.box(shade(dc, 1.15), lw * 0.6, h * 0.32, 0.03, cx, h * 0.24, 0.035);
    }
    const hx = o.double ? (i === 0 ? cx + lw * 0.38 : cx - lw * 0.38) : cx + lw * 0.38;
    k.box(C.brass, 0.04, 0.12, 0.05, hx, h * 0.48, 0.05, { mat: 'metal' });
  }
  k.box(fr, w + 0.24, 0.12, 0.1, 0, h + 0.06, 0.03);
  k.box(fr, 0.12, h, 0.1, -w / 2 - 0.06, h / 2, 0.03, { nb: true });
  k.box(fr, 0.12, h, 0.1, w / 2 + 0.06, h / 2, 0.03, { nb: true });
  if (o.fan) {
    const pts: V2[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = PI - (i / 8) * PI;
      pts.push([Math.cos(a) * w * 0.5, h + 0.12 + Math.sin(a) * w * 0.32]);
    }
    k.extZ(C.glass, pts, -0.02, 0.015, { mat: 'glass' });
    const arc: V2[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = PI - (i / 8) * PI;
      arc.push([Math.cos(a) * (w * 0.5 + 0.1), h + 0.12 + Math.sin(a) * (w * 0.32 + 0.1)]);
    }
    for (let i = 8; i >= 0; i--) {
      const a = PI - (i / 8) * PI;
      arc.push([Math.cos(a) * w * 0.5, h + 0.12 + Math.sin(a) * w * 0.32]);
    }
    k.extZ(fr, arc, -0.02, 0.08);
  }
  if (o.step) k.cbox(o.step, w + 0.6, 0.16, 0.5, 0, 0.08, 0.25, 0.03);
}

/**
 * Gable roof with ridge along X. Walls top at y0; roof spans z in [-d/2, d/2] (wall line),
 * x in [-w/2, w/2]; rise above y0. Adds gable infill (wall colour), fascia & bargeboard trims.
 */
function gableRoof(
  k: Kit,
  w: number,
  d: number,
  y0: number,
  rise: number,
  o: { roof: Col; wall?: Col | null; trim?: Col | null; over?: number; overX?: number; t?: number; ridge?: Col; mat?: 'std' | 'metal'; courses?: number },
): void {
  const over = o.over ?? 0.45;
  const overX = o.overX ?? over;
  const t = o.t ?? 0.16;
  const half = d / 2;
  const a = Math.atan2(rise, half);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const s = (half + over) / ca; // slab slope length
  const L = w + overX * 2;
  const ytop = y0 + rise + t / ca; // top surface at ridge line (z=0)
  for (const side of [1, -1]) {
    // top surface line from (z=0, ytop) going down along side
    const mz = side * (s / 2) * ca;
    const my = ytop - (s / 2) * sa;
    const cz = mz - side * (t / 2) * sa;
    const cy = my - (t / 2) * ca;
    k.box(o.roof, L, t, s, 0, cy, cz, { rx: side * a, mat: o.mat });
    // tile courses: shallow steps across the slope
    const nc = o.courses ?? 0;
    for (let i = 1; i <= nc; i++) {
      const u = (i / (nc + 1)) * s; // distance down the slope from the ridge
      const pz = side * u * ca + side * 0.02 * sa;
      const py = ytop - u * sa + 0.02 * ca;
      k.box(shade(o.roof, 0.82), L, 0.04, 0.09, 0, py, pz, { rx: side * a, mat: o.mat, nb: true });
    }
    if (o.trim) {
      // fascia along the eave
      const ez = side * (half + over);
      const ey = ytop - s * sa;
      k.box(o.trim, L + 0.04, 0.18, 0.05, 0, ey - 0.06, ez + side * 0.02);
      // bargeboards on both gable ends
      for (const ex of [-L / 2, L / 2]) {
        k.box(o.trim, 0.06, 0.2, s + 0.02, ex, cy - 0.04, cz, { rx: side * a });
      }
    }
  }
  if (o.ridge) k.box(o.ridge, L + 0.02, 0.12, 0.22, 0, ytop + 0.02, 0);
  if (o.wall) {
    // gable infill (prism along X)
    const tri: V2[] = [[-half, y0 - 0.01], [half, y0 - 0.01], [0, y0 + rise - 0.02]];
    k.extX(o.wall, tri, -w / 2, w / 2);
  }
}

/** Hip roof (convex hull) over a w x d rectangle (centred), eaves at y0. */
function hipRoof(k: Kit, w: number, d: number, y0: number, rise: number, o: { roof: Col; over?: number; t?: number; ridgeFrac?: number; trim?: Col | null; mat?: 'std' | 'metal' }): void {
  const ov = o.over ?? 0.45;
  const t = o.t ?? 0.18;
  const W = w / 2 + ov;
  const D = d / 2 + ov;
  const slope = rise / (Math.min(w, d) / 2);
  const ytop = y0 + slope * Math.min(W, D) - slope * ov + 0.0;
  const rl = Math.max(0, W - D) * (o.ridgeFrac ?? 1);
  const rd = Math.max(0, D - W) * (o.ridgeFrac ?? 1);
  const ye = y0 - ov * slope * 0.35; // eave slightly lower
  const pts: V3[] = [
    [-W, ye, -D], [W, ye, -D], [W, ye, D], [-W, ye, D],
    [-W, ye - t, -D], [W, ye - t, -D], [W, ye - t, D], [-W, ye - t, D],
    [-rl, ytop, -rd], [rl, ytop, rd], [-rl, ytop, rd], [rl, ytop, -rd],
  ];
  k.hull(o.roof, pts, 0, 0, 0, { mat: o.mat });
  if (o.trim) {
    k.box(o.trim, W * 2 + 0.04, 0.12, 0.05, 0, ye - t - 0.02, D + 0.02);
    k.box(o.trim, W * 2 + 0.04, 0.12, 0.05, 0, ye - t - 0.02, -D - 0.02);
    k.box(o.trim, 0.05, 0.12, D * 2 + 0.04, W + 0.02, ye - t - 0.02, 0);
    k.box(o.trim, 0.05, 0.12, D * 2 + 0.04, -W - 0.02, ye - t - 0.02, 0);
  }
}

function chimney(k: Kit, x: number, y: number, z: number, h: number, w = 0.7, d = 0.55): void {
  k.boxb(C.brick, w, h, d, x, y, z);
  k.boxb(C.stoneL, w + 0.12, 0.12, d + 0.12, x, y + h, z);
  k.cyl(0xb4643c, 0.09, 0.32, x - w * 0.22, y + h + 0.12, z, { seg: 6, rt: 0.07 });
  k.cyl(0xb4643c, 0.09, 0.26, x + w * 0.22, y + h + 0.12, z, { seg: 6, rt: 0.07 });
}

/** Rail (top rail + posts + balusters) from a to b at height h, base y. */
function railing(k: Kit, a: V2, b: V2, y: number, h: number, o: { col?: Col; spacing?: number; post?: number; baluster?: number; mat?: 'std' | 'metal'; glass?: boolean; panel?: Col } = {}): void {
  const c = o.col ?? C.trim;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L = Math.hypot(dx, dz);
  k.push((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2, yawX(dx, dz));
  k.box(c, L + 0.06, 0.06, 0.08, 0, h, 0, { mat: o.mat });
  if (!o.glass) k.box(c, L, 0.04, 0.05, 0, 0.12, 0, { mat: o.mat });
  const ps = o.post ?? 2.0;
  const np = Math.max(1, Math.round(L / ps));
  for (let i = 0; i <= np; i++) k.box(c, 0.08, h, 0.08, -L / 2 + (i * L) / np, h / 2, 0, { mat: o.mat, nb: true });
  if (o.panel !== undefined) {
    k.box(o.panel, L, h - 0.2, 0.05, 0, h / 2 - 0.02, 0, { nb: true });
  } else if (o.glass) {
    k.box(C.glass, L - 0.1, h - 0.2, 0.03, 0, h / 2 + 0.02, 0, { mat: 'glass' });
  } else if (o.baluster) {
    const nb = Math.max(1, Math.round(L / o.baluster));
    for (let i = 1; i < nb; i++) k.box(c, 0.035, h - 0.14, 0.035, -L / 2 + (i * L) / nb, 0.13 + (h - 0.14) / 2, 0, { mat: o.mat, nb: true });
  }
  k.pop();
}

function planterBox(k: Kit, x: number, z: number, w: number, d: number, h: number, boxC: Col, plants: 'shrub' | 'flowers' | 'grass', petals: number[] = [0xe0413a, 0xf3c632, 0xf6f1f0]): void {
  k.cbox(boxC, w, h, d, x, h / 2, z, 0.04);
  k.box(C.soil, w - 0.12, 0.04, d - 0.12, x, h + 0.0, z);
  if (plants === 'shrub') {
    const n = Math.max(1, Math.round(w / 0.7));
    for (let i = 0; i < n; i++) blob(k, k.jc(0x3d7a2c, 0.12), Math.min(d, 0.8) * 0.5, x - w / 2 + (w / n) * (i + 0.5), h + 0.25, z, { detail: 0, sx: 1.1 });
  } else if (plants === 'flowers') {
    const n = Math.max(1, Math.round(w / 0.65));
    for (let i = 0; i < n; i++) flowerClump(k, x - w / 2 + (w / n) * (i + 0.5), h - 0.02, z, Math.min(d, 0.7) * 0.48, petals, 3);
  } else {
    const n = Math.max(1, Math.round(w / 0.4));
    for (let i = 0; i < n; i++) k.lathe(k.jc(0x6f9a3a, 0.1), [[0.12, h], [0, h + 0.5 + k.r() * 0.2]], x - w / 2 + (w / n) * (i + 0.5), 0, z, { seg: 5, mat: 'foliage' });
  }
}

/** Pixel font for painted numbers (3x5). */
const FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '011', '001', '111'],
  '5': ['111', '100', '111', '001', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '8': ['111', '101', '111', '101', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '7': ['111', '001', '010', '010', '010'],
  '6': ['111', '100', '111', '101', '111'],
  H: ['101', '101', '111', '101', '101'],
  P: ['110', '101', '110', '100', '100'],
};
/** Paint text made of quads on a plane facing +Z at z, top-left at (x, y). */
function pixelText(k: Kit, s: string, x: number, y: number, z: number, px: number, c: Col, gap = 1): void {
  let cx = x;
  for (const ch of s) {
    const g = FONT[ch];
    if (g) {
      for (let r = 0; r < 5; r++) {
        let run = -1;
        for (let cc = 0; cc <= 3; cc++) {
          const on = cc < 3 && g[r][cc] === '1';
          if (on && run < 0) run = cc;
          if (!on && run >= 0) {
            const x0 = cx + run * px;
            const x1 = cx + cc * px;
            const y0 = y - (r + 1) * px;
            const y1 = y - r * px;
            k.quad(c, [x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], { up: [0, 0, 1] });
            run = -1;
          }
        }
      }
    }
    cx += (3 + gap) * px;
  }
}

/** Golf cart facing +Z, origin at ground centre. Body part tinted. */
function golfCart(k: Kit, tintBody = true, bagCols: Col[] = [C.navy, C.red]): void {
  const body = 0xf4f4f0;
  const bo = { tint: tintBody };
  // chassis / floor
  k.cbox(C.charcoal, 1.08, 0.12, 2.2, 0, 0.3, 0, 0.03);
  // front cowl
  k.hull(body, [[-0.56, 0.32, 0.72], [0.56, 0.32, 0.72], [-0.56, 0.32, 1.18], [0.56, 0.32, 1.18], [-0.52, 0.72, 0.8], [0.52, 0.72, 0.8], [-0.5, 0.62, 1.16], [0.5, 0.62, 1.16], [-0.5, 0.36, 1.2], [0.5, 0.36, 1.2]], 0, 0, 0, bo);
  k.box(C.charcoal, 1.1, 0.12, 0.08, 0, 0.36, 1.2); // bumper
  k.box(C.glow, 0.14, 0.06, 0.02, -0.33, 0.56, 1.18, { mat: 'glow' });
  k.box(C.glow, 0.14, 0.06, 0.02, 0.33, 0.56, 1.18, { mat: 'glow' });
  // dash / steering
  k.box(C.charcoal, 1.0, 0.36, 0.12, 0, 0.84, 0.74, { rx: -0.25 });
  k.tube(C.black, [-0.24, 0.8, 0.64], [-0.24, 1.08, 0.46], 0.02, { seg: 4 });
  k.lathe(C.black, [[0.17, -0.02], [0.17, 0.02]], -0.24, 1.08, 0.46, { seg: 10, rx: -1.15 });
  // seat base + rear body
  k.cbox(body, 1.08, 0.4, 0.8, 0, 0.56, -0.22, 0.05, bo);
  k.cbox(C.cream, 0.98, 0.12, 0.52, 0, 0.82, -0.12, 0.04);
  k.cbox(C.cream, 0.98, 0.42, 0.1, 0, 1.08, -0.42, 0.04, { rx: -0.12 });
  // rear deck with bags
  k.cbox(body, 1.08, 0.3, 0.55, 0, 0.5, -0.86, 0.04, bo);
  k.box(C.charcoal, 1.1, 0.12, 0.08, 0, 0.36, -1.16);
  golfBag(k, -0.24, -0.86, 0, -0.3, bagCols[0]);
  golfBag(k, 0.24, -0.86, 0, -0.3, bagCols[1 % bagCols.length]);
  k.push(0, 0.55, -0.86, 0);
  k.box(C.black, 1.0, 0.05, 0.05, 0, 0.35, -0.12);
  k.pop();
  // canopy struts + roof
  for (const sx of [-0.48, 0.48]) {
    k.tube(C.charcoal, [sx, 0.72, 0.78], [sx, 1.88, 0.62], 0.025, { seg: 4 });
    k.tube(C.charcoal, [sx, 0.75, -0.5], [sx, 1.88, -0.5], 0.025, { seg: 4 });
  }
  k.cbox(body, 1.2, 0.07, 1.6, 0, 1.92, 0.05, 0.03, bo);
  k.box(C.charcoal, 0.9, 0.035, 0.03, 0, 1.36, 0.71, { rx: -0.35 });
  k.quad(C.glass, [-0.46, 1.0, 0.7], [0.46, 1.0, 0.7], [0.46, 1.86, 0.63], [-0.46, 1.86, 0.63], { mat: 'glass', up: [0, 0, 1] });
  // wheels
  for (const sx of [-0.5, 0.5])
    for (const sz of [-0.72, 0.78]) {
      k.cyl(C.black, 0.22, 0.18, sx + Math.sign(sx) * -0.09, 0.22, sz, { seg: 10, rz: -PI / 2 * Math.sign(sx) });
      k.cyl(C.steel, 0.12, 0.02, sx + Math.sign(sx) * 0.09, 0.22, sz, { seg: 8, rz: -PI / 2 * Math.sign(sx), mat: 'metal' });
    }
}

// ================================================================================================
// TREES
// ================================================================================================
def('tree_oak', (k) => {
  k.lathe(C.bark, [[0.62, 0], [0.46, 0.45], [0.38, 1.8], [0.33, 3.4], [0.26, 5.0], [0.15, 6.4]], 0, 0, 0, { seg: 7, grad: [0.72, 1.05] });
  const limbs: V3[] = [[2.1, 6.3, 0.8], [-2.0, 6.6, 0.9], [0.4, 6.9, -2.2], [-0.8, 7.6, -0.3]];
  limbs.forEach((e, i) => k.tube(C.bark, [0, 3.2 + i * 0.45, 0], e, 0.19, { r1: 0.08, seg: 5 }));
  const g = [0x467f30, 0x3d7329, 0x528c36, 0x3a6d27, 0x4b8532];
  blob(k, k.jc(g[0], 0.06), 3.0, 0, 7.6, 0, { sy: 0.86 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3 + k.rr(-0.2, 0.2);
    const d = 2.6 + k.rr(-0.3, 0.3);
    const r = 2.1 + k.rr(-0.25, 0.3);
    blob(k, k.jc(g[i % 5], 0.08), r, Math.cos(a) * d, 6.7 + k.rr(-0.4, 0.5), Math.sin(a) * d, { kind: i % 2 ? 'dodeca' : 'ico', detail: i % 2 ? 0 : 1, sy: 0.82 });
  }
  blob(k, k.jc(g[2], 0.06), 1.9, 0.5, 9.3, 0.4, { kind: 'dodeca', detail: 0 });
  blob(k, k.jc(g[0], 0.06), 1.7, -0.9, 8.9, -0.7, { kind: 'dodeca', detail: 0 });
  // small outer clumps break up the silhouette
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 1.0;
    blob(k, k.jc(g[(i + 3) % 5], 0.08), 1.05, Math.cos(a) * 4.0, 6.0 + i * 0.5, Math.sin(a) * 4.0, { kind: 'dodeca', detail: 0, jit: 0.2 });
  }
});

def('tree_pine', (k) => {
  k.lathe([0x4e4038, 0x584739, 0x77553b, 0xae6538, 0xbd7140, 0xc07642], [[0.42, 0], [0.33, 0.6], [0.28, 4.6], [0.23, 8.4], [0.17, 11.2], [0.11, 13.4], [0.02, 14.6]], 0, 0, 0, { seg: 6 });
  k.tube(0x5a4637, [0, 5.2, 0], [0.7, 5.6, 0.3], 0.06, { r1: 0.02, seg: 4 });
  k.tube(0x6d5139, [0, 7.0, 0], [-0.6, 7.5, -0.4], 0.06, { r1: 0.02, seg: 4 });
  const g = [0x2d5230, 0x355e35, 0x284a2b, 0x3a6337];
  const clumps: [number, number, number, number][] = [
    [2.2, 9.8, 0.4, 1.9], [-2.0, 10.6, -0.9, 1.8], [0.9, 11.4, -2.0, 1.7], [-1.1, 12.2, 1.6, 1.7], [1.5, 13.0, 1.0, 1.5], [-1.3, 13.4, -1.0, 1.5],
  ];
  clumps.forEach(([x, y, z, r], i) => {
    k.tube(0xb06a3c, [0, y - 1.1, 0], [x * 0.85, y - 0.1, z * 0.85], 0.09, { r1: 0.04, seg: 4 });
    blob(k, k.jc(g[i % 4], 0.08), r, x, y, z, { kind: i % 3 === 0 ? 'ico' : 'dodeca', detail: i % 3 === 0 ? 1 : 0, sy: 0.42, jit: 0.2, grad: [0.55, 1.1] });
  });
  blob(k, k.jc(g[1], 0.06), 1.7, 0.1, 14.4, 0.1, { sy: 0.5, jit: 0.2, grad: [0.55, 1.1] });
  blob(k, k.jc(g[0], 0.06), 1.2, 0.3, 11.8, 0.2, { kind: 'dodeca', detail: 0, sy: 0.6 });
});

def('tree_birch', (k) => {
  const ys = [0, 0.8, 1.55, 1.68, 2.8, 2.9, 3.9, 4.02, 5.1, 5.18, 6.3, 6.38, 8.8];
  const prof: V2[] = ys.map((y) => [Math.max(0.05, 0.24 - y * 0.021), y]);
  const cols: Col[] = [];
  for (let i = 0; i < ys.length - 1; i++) cols.push(i === 0 ? 0x6d655c : i % 2 === 1 ? 0xeae6dc : 0x2f2a28);
  k.lathe(cols, prof, 0, 0, 0, { seg: 6 });
  k.tube(0xe6e1d6, [0, 4.6, 0], [1.4, 7.4, 0.5], 0.09, { r1: 0.04, seg: 5 });
  k.tube(0xe6e1d6, [0, 5.4, 0], [-1.3, 7.9, -0.6], 0.08, { r1: 0.035, seg: 5 });
  k.tube(0xe6e1d6, [0, 6.0, 0], [0.4, 8.4, -1.3], 0.07, { r1: 0.03, seg: 5 });
  const g = [0x86b84a, 0x93c256, 0x76a842, 0x7fb247, 0x9bc65e];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + 0.4;
    const t = i / (n - 1);
    const d = 0.7 + Math.sin(t * PI) * 1.7 + k.rr(-0.2, 0.3);
    const y = 4.9 + t * 4.6 + k.rr(-0.3, 0.3);
    const r = 0.75 + Math.sin(t * PI) * 0.4 + k.rr(0, 0.18);
    blob(k, k.jc(g[i % 5], 0.07), r, Math.cos(a) * d, y, Math.sin(a) * d, { kind: 'dodeca', detail: 0, jit: 0.22, sy: 1.25, grad: [0.62, 1.1] });
  }
});

def('tree_cypress', (k) => {
  k.cyl(C.bark, 0.22, 0.9, 0, 0, 0, { seg: 6, rt: 0.16, caps: 'none' });
  const g = 0x2e5732;
  const prof: V2[] = [[0, 0.45], [0.7, 0.6], [1.12, 1.6], [1.28, 3.2], [1.24, 5.0], [1.1, 6.8], [0.88, 8.6], [0.6, 10.2], [0.3, 11.3], [0, 12.0]];
  k.lathe(k.jc(g, 0.05), prof, 0, 0, 0, { seg: 8, mat: 'foliage', flat: true, grad: [0.62, 1.12] });
  const rAt = (y: number): number => {
    for (let i = 0; i < prof.length - 1; i++) {
      if (y >= prof[i][1] && y <= prof[i + 1][1]) {
        const t = (y - prof[i][1]) / (prof[i + 1][1] - prof[i][1]);
        return prof[i][0] + (prof[i + 1][0] - prof[i][0]) * t;
      }
    }
    return 0;
  };
  for (let i = 0; i < 11; i++) {
    const y = 1.4 + i * 0.86;
    const a = i * 2.39996;
    const r = rAt(y);
    blob(k, k.jc(i % 2 ? 0x335f35 : 0x2a5030, 0.08), r * 0.55 + 0.15, Math.cos(a) * r * 0.72, y, Math.sin(a) * r * 0.72, { kind: 'dodeca', detail: 0, sy: 1.9, jit: 0.18, grad: [0.7, 1.1] });
  }
});

def('tree_maple', (k) => {
  k.lathe(0x54402f, [[0.5, 0], [0.36, 0.4], [0.3, 1.8], [0.24, 3.4], [0.14, 4.8]], 0, 0, 0, { seg: 7, grad: [0.7, 1.05] });
  const limbs: V3[] = [[1.5, 5.0, 0.6], [-1.4, 5.3, 0.7], [0.3, 5.4, -1.6]];
  limbs.forEach((e, i) => k.tube(0x54402f, [0, 2.5 + i * 0.35, 0], e, 0.15, { r1: 0.06, seg: 5 }));
  const g = [0xa92f27, 0xbf3d2b, 0xcc5730, 0x952620];
  blob(k, k.jc(g[0], 0.06), 2.6, 0, 6.1, 0, { sy: 0.95 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + k.rr(-0.25, 0.25);
    const d = 1.9 + k.rr(-0.2, 0.3);
    blob(k, k.jc(g[(i + 1) % 4], 0.08), 1.75 + k.rr(-0.2, 0.25), Math.cos(a) * d, 5.4 + k.rr(-0.3, 0.6), Math.sin(a) * d, { kind: i % 2 ? 'dodeca' : 'ico', detail: i % 2 ? 0 : 1 });
  }
  blob(k, k.jc(g[2], 0.06), 1.7, 0.2, 7.7, -0.1, { sy: 0.9 });
});

def('tree_willow', (k) => {
  const bark = 0x5a4a38;
  k.lathe(bark, [[0.66, 0], [0.5, 0.5], [0.44, 1.8], [0.4, 3.0]], 0, 0, 0, { seg: 7, grad: [0.7, 1.0] });
  const limbs: V3[] = [[2.0, 6.9, 0.9], [-1.9, 7.1, 0.6], [0.6, 7.5, -2.0], [-0.8, 7.3, -1.7], [0.3, 8.0, 1.8]];
  for (const e of limbs) k.tube(bark, [0, 2.8, 0], e, 0.22, { r1: 0.07, seg: 5 });
  const g = [0x8fb24f, 0x80a544, 0x9dbe5c, 0x87ab48];
  blob(k, k.jc(g[0], 0.05), 2.7, 0, 8.4, 0, { sy: 0.55, grad: [0.75, 1.12] });
  blob(k, k.jc(g[1], 0.05), 2.0, 1.5, 8.1, 0.8, { sy: 0.5, kind: 'dodeca', detail: 0 });
  blob(k, k.jc(g[2], 0.05), 2.0, -1.4, 8.1, -0.9, { sy: 0.5, kind: 'dodeca', detail: 0 });
  blob(k, k.jc(g[3], 0.05), 1.8, -0.9, 8.2, 1.5, { sy: 0.5, kind: 'dodeca', detail: 0 });
  blob(k, k.jc(g[1], 0.05), 1.8, 1.0, 8.2, -1.5, { sy: 0.5, kind: 'dodeca', detail: 0 });
  blob(k, k.jc(g[2], 0.05), 1.4, 0.2, 9.3, 0.1, { sy: 0.6, kind: 'dodeca', detail: 0 });
  // hanging curtain of tapering drapes
  const n = 42;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + k.rr(-0.06, 0.06);
    const inner = i % 3 === 0;
    const R = inner ? 2.2 + k.rr(0, 0.5) : 3.1 + k.rr(-0.25, 0.5);
    const top = 8.7 - (R - 2.2) * 0.75 + k.rr(-0.2, 0.2);
    const L = top - (inner ? 2.6 : 1.4) - k.r() * 1.2;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    // tilt the lower end slightly outwards
    const tilt = 0.06 + k.r() * 0.06;
    k.lathe(k.jc(g[i % 4], 0.1), [[0.42 + k.r() * 0.12, 0], [0.0, -L]], x, top, z, {
      seg: 4, phase: k.r() * PI, mat: 'foliage', flat: true, rz: -Math.cos(a) * tilt, rx: Math.sin(a) * tilt, grad: [1.12, 0.78],
    });
  }
});

def('tree_cherry', (k) => {
  k.lathe(0x4a3029, [[0.45, 0], [0.32, 0.4], [0.27, 1.6], [0.2, 2.6]], 0, 0, 0, { seg: 7, grad: [0.7, 1.05] });
  const limbs: V3[] = [[2.2, 4.4, 0.9], [-2.1, 4.6, 0.6], [0.6, 4.5, -2.2], [-0.6, 4.8, 1.9], [0.1, 5.2, 0]];
  for (const e of limbs) k.tube(0x4a3029, [0, 2.3, 0], e, 0.15, { r1: 0.05, seg: 5 });
  const g = [0xf0a9c2, 0xf8c6d6, 0xe48fb2, 0xfad8e4];
  blob(k, k.jc(g[0], 0.05), 2.4, 0, 5.4, 0, { sy: 0.7 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + k.rr(-0.2, 0.2);
    const d = 2.4 + k.rr(-0.2, 0.4);
    blob(k, k.jc(g[(i + 1) % 4], 0.06), 1.6 + k.rr(-0.2, 0.2), Math.cos(a) * d, 4.9 + k.rr(-0.3, 0.5), Math.sin(a) * d, { kind: i % 2 ? 'dodeca' : 'ico', detail: i % 2 ? 0 : 1, sy: 0.72 });
  }
  blob(k, k.jc(g[3], 0.05), 1.5, 0.3, 6.5, 0.2, { kind: 'dodeca', detail: 0, sy: 0.8 });
});

def('tree_palm', (k) => {
  const segs = 10;
  const H = 8.6;
  const pt = (t: number): V3 => [Math.pow(t, 2) * 1.4, t * H, Math.pow(t, 2) * 0.35];
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const r0 = 0.3 - t0 * 0.1;
    k.tube(i % 2 ? 0x8a7457 : 0x7a644a, pt(t0), pt(t1), r0 * 1.08, { r1: r0 * 0.86, seg: 7, phase: i * 0.3 });
  }
  const top = pt(1);
  k.ball(0x6d7a3e, 0.36, top[0], top[1] + 0.1, top[2], { detail: 0, sy: 1.1 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.4;
    k.ball(0x5a4a2a, 0.13, top[0] + Math.cos(a) * 0.28, top[1] - 0.15, top[2] + Math.sin(a) * 0.28, { detail: 0 });
  }
  const fronds = 11;
  const gc = [0x4f8f35, 0x5b9c3c, 0x46822f];
  for (let f = 0; f < fronds; f++) {
    const young = f >= 9;
    const a = young ? f * 2.4 : (f / 9) * TAU + k.rr(-0.15, 0.15);
    const up = young ? 1.6 : f % 2 ? 0.55 : 0.2;
    const L = young ? 2.2 : 3.6 + k.rr(-0.3, 0.4);
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const n = 5;
    const spine: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      spine.push(new THREE.Vector3(top[0], top[1] + 0.2, top[2]).addScaledVector(dir, s * L).add(new THREE.Vector3(0, up * s * L * 0.6 - 1.6 * s * s * L * 0.45, 0)));
    }
    const fc = k.jc(gc[f % 3], 0.08);
    for (let i = 0; i < n; i++) {
      const p0 = spine[i];
      const p1 = spine[i + 1];
      const w0 = Math.sin(((i + 0.3) / n) * PI) * 0.75 + 0.08;
      const w1 = Math.sin(((i + 1.3) / n) * PI) * 0.75 + 0.05;
      for (const sd of [-1, 1]) {
        const o0 = p0.clone().addScaledVector(side, sd * w0).add(new THREE.Vector3(0, -0.28 * w0, 0)).addScaledVector(dir, 0.18);
        const o1 = p1.clone().addScaledVector(side, sd * w1).add(new THREE.Vector3(0, -0.28 * w1, 0)).addScaledVector(dir, 0.18);
        k.quad2(fc, [p0.x, p0.y, p0.z], [p1.x, p1.y, p1.z], [o1.x, o1.y, o1.z], [o0.x, o0.y, o0.z], 0.01, { mat: 'foliage' });
      }
    }
  }
});

// ================================================================================================
// SMALL PROPS / SCENERY
// ================================================================================================
def('bench', (k) => {
  k.cbox(C.stone, 2.1, 0.06, 0.9, 0, 0.03, 0, 0.02);
  parkBench(k, 1.8);
});

def('bin', (k) => {
  k.cyl(C.concrete, 0.34, 0.06, 0, 0, 0, { seg: 10 });
  k.lathe([C.green, C.green, C.brass, C.green, C.black, C.green], [[0.24, 0.06], [0.26, 0.1], [0.27, 0.7], [0.275, 0.76], [0.275, 0.8], [0.27, 0.86], [0.27, 0.94]], 0, 0, 0, { seg: 10 });
  k.lathe([C.green, C.green, C.green], [[0.29, 0.94], [0.29, 0.98], [0.2, 1.06], [0, 1.1]], 0, 0, 0, { seg: 10 });
  k.ball(C.brass, 0.045, 0, 1.12, 0, { detail: 0, mat: 'metal' });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + PI / 4;
    k.box(C.greenD, 0.05, 0.6, 0.03, Math.sin(a) * 0.27, 0.4, Math.cos(a) * 0.27, { ry: a });
  }
});

def('lamp', (k) => {
  k.cyl(C.stone, 0.4, 0.08, 0, 0, 0, { seg: 8 });
  vicLamp(k, 0, 0, 3.6);
});

function flowerBed(k: Kit, petals: number[]): void {
  const S = 3.0;
  const h = 0.32;
  // timber sleeper frame
  for (const s of [-1, 1]) {
    k.box(k.jc(C.timber, 0.06), S, h, 0.16, 0, h / 2, s * (S / 2 - 0.08), { nb: true });
    k.box(k.jc(C.timber, 0.06), 0.16, h, S - 0.32, s * (S / 2 - 0.08), h / 2, 0, { nb: true });
  }
  k.box(C.soil, S - 0.3, 0.05, S - 0.3, 0, h - 0.04, 0, { nb: true });
  const n = 3;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x = (i - 1) * 0.86 + k.rr(-0.12, 0.12);
      const z = (j - 1) * 0.86 + k.rr(-0.12, 0.12);
      flowerClump(k, x, h - 0.02, z, 0.5 + k.rr(-0.04, 0.06), petals, (i + j) % 3 === 0 ? 3 : 4);
    }
}
def('flowers_red', (k) => flowerBed(k, [0xd2302c, 0xe8473b, 0xb9222a, 0xf3efe8]));
def('flowers_yellow', (k) => flowerBed(k, [0xf3c632, 0xf8d84b, 0xeaa628, 0xfaf1d0]));
def('flowers_purple', (k) => flowerBed(k, [0x7b4bb0, 0x9466c6, 0x6a3a9a, 0xb796e0]));

def('bush', (k) => {
  const g = [0x3f7b2e, 0x4a8734, 0x376d29];
  blob(k, k.jc(g[0], 0.08), 0.95, 0, 0.8, 0, { sy: 0.85 });
  blob(k, k.jc(g[1], 0.08), 0.75, 0.65, 0.6, 0.25, { kind: 'dodeca', detail: 0 });
  blob(k, k.jc(g[2], 0.08), 0.72, -0.6, 0.58, -0.2, { kind: 'dodeca', detail: 0 });
  blob(k, k.jc(g[1], 0.08), 0.7, 0.15, 0.55, -0.62, { detail: 1 });
  blob(k, k.jc(g[0], 0.08), 0.6, -0.2, 1.35, 0.15, { kind: 'dodeca', detail: 0 });
  blob(k, k.jc(g[2], 0.08), 0.62, -0.25, 0.5, 0.6, { kind: 'dodeca', detail: 0 });
});

def('hedge', (k) => {
  const g = 0x3a7430;
  k.hull(k.jc(g, 0.03), [
    [-2, 0, -0.55], [2, 0, -0.55], [-2, 0, 0.55], [2, 0, 0.55],
    [-2, 1.0, -0.55], [2, 1.0, -0.55], [-2, 1.0, 0.55], [2, 1.0, 0.55],
    [-2, 1.14, -0.4], [2, 1.14, -0.4], [-2, 1.14, 0.4], [2, 1.14, 0.4],
  ], 0, 0, 0, { mat: 'foliage', grad: [0.6, 1.1] });
  const shades = [0x3f7d33, 0x467f35, 0x36702c, 0x4a8638];
  // clipped leafy texture: low bumps on top and sides (kept inside x = +-1.85 so neighbours join cleanly)
  for (let i = 0; i < 6; i++) {
    const x = -1.6 + i * 0.64 + k.rr(-0.06, 0.06);
    blob(k, k.jc(shades[i % 4], 0.04), 0.5, x, 1.04, k.rr(-0.06, 0.06), { kind: 'dodeca', detail: 0, sy: 0.24, sz: 0.85, jit: 0.12, grad: [0.9, 1.1] });
  }
});

function rockShape(k: Kit, x: number, z: number, sx: number, sy: number, sz: number, c: Col): void {
  const pts: V3[] = [];
  for (let i = 0; i < 16; i++) {
    const u = k.r() * 2 - 1;
    const a = k.r() * TAU;
    const rr = Math.sqrt(1 - u * u);
    pts.push([Math.cos(a) * rr * sx * k.rr(0.8, 1.1), Math.max(0, u) * sy * k.rr(0.85, 1.1), Math.sin(a) * rr * sz * k.rr(0.8, 1.1)]);
  }
  pts.push([0, -0.05, 0]);
  k.hull(c, pts, x, -0.02, z, { grad: [0.8, 1.12] });
}
def('rock', (k) => {
  rockShape(k, 0, 0, 1.0, 0.85, 0.8, 0x8f8b84);
  rockShape(k, 0.9, 0.55, 0.5, 0.42, 0.45, 0x9a958c);
  rockShape(k, -0.75, 0.6, 0.38, 0.3, 0.34, 0x85817b);
  blob(k, 0x5d8a3a, 0.35, -0.25, 0.72, -0.1, { detail: 0, sy: 0.3, sx: 1.4 });
  for (let i = 0; i < 4; i++) {
    const a = k.r() * TAU;
    k.lathe(k.jc(0x5f8d3a, 0.1), [[0.14, 0], [0, 0.35 + k.r() * 0.2]], Math.cos(a) * 1.1, 0, Math.sin(a) * 0.95, { seg: 5, mat: 'foliage' });
  }
});

def('topiary', (k) => {
  k.lathe([0xb5653f, 0xc4734a, 0xa95d3a, 0xb5653f], [[0.32, 0], [0.42, 0.55], [0.47, 0.6], [0.47, 0.68], [0.4, 0.68]], 0, 0, 0, { seg: 8, phase: PI / 8 });
  k.cyl(C.soil, 0.4, 0.02, 0, 0.62, 0, { seg: 8, caps: 'top' });
  const leaf = 0x2f6a2d;
  // central stem + spiral coil of clipped box
  k.cyl(0x2a5a28, 0.12, 2.0, 0, 0.62, 0, { seg: 6, rt: 0.05, caps: 'none', mat: 'foliage' });
  const pts: V3[] = [];
  const rad: number[] = [];
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * 3.0 * TAU;
    const R = 0.36 * (1 - t) + 0.07;
    pts.push([Math.cos(a) * R, 0.86 + t * 1.75, Math.sin(a) * R]);
    rad.push(0.24 * (1 - t * 0.6));
  }
  k.sweep(leaf, pts, rad, { seg: 6, mat: 'foliage', flat: true, grad: [0.7, 1.1] });
  blob(k, k.jc(leaf, 0.04), 0.22, 0, 2.78, 0, { detail: 0, jit: 0.08 });
});
def('flag_pole', (k) => {
  k.lathe([C.stone, C.stoneL, C.stone], [[0.55, 0], [0.55, 0.3], [0.45, 0.38], [0.2, 0.42]], 0, 0, 0, { seg: 8, phase: PI / 8 });
  k.lathe(C.white, [[0.075, 0.4], [0.04, 7.9], [0, 7.9]], 0, 0, 0, { seg: 8 });
  k.ball(C.brass, 0.09, 0, 7.98, 0, { detail: 1, mat: 'metal', smooth: true });
  k.box(C.steelD, 0.03, 0.18, 0.06, 0, 1.3, 0.06, { mat: 'metal' });
  k.flag([C.green, C.cream, C.green], 1.8, 1.15, 0.04, 6.55, 0, 8);
});

def('fence', (k) => {
  for (const x of [-2, 2]) {
    k.boxb(C.white, 0.12, 1.02, 0.12, x, 0, 0);
    k.hull(C.white, [[-0.07, 0, -0.07], [0.07, 0, -0.07], [-0.07, 0, 0.07], [0.07, 0, 0.07], [0, 0.1, 0]], x, 1.02, 0);
  }
  for (const y of [0.35, 0.65, 0.93]) k.box(0xf2f0ea, 4.0, 0.11, 0.04, 0, y, 0.07);
});

def('streetlamp', (k) => streetLampBody(k, 7.0));

def('litter', (k) => {
  k.lathe([C.red, C.red, C.steel, C.steel], [[0, 0], [0.033, 0], [0.033, 0.11], [0.03, 0.122], [0, 0.122]], -0.05, 0.033, 0, { seg: 8, rz: PI / 2, ry: 0.4 });
  k.ball(0xf1efe6, 0.06, 0.08, 0.05, 0.03, { detail: 0, jit: 0.35, sy: 0.75 });
  k.ball(0xe9e4d6, 0.035, 0.0, 0.03, 0.09, { detail: 0, jit: 0.35 });
});

def('bucket', (k) => ballBucket(k, 0, 0, 0, 1.0, C.greenL, true, true));

def('flagstick', (k) => {
  k.lathe(C.white, [[0, 0], [0.012, 0], [0.012, 2.3], [0, 2.3]], 0, 0, 0, { seg: 6 });
  k.flag(C.yellow, 0.5, 0.35, 0.008, 1.93, 0, 6);
});

def('tee_markers', (k) => {
  for (const x of [-1.6, 1.6]) {
    k.cyl(0x4d4f52, 0.1, 0.03, x, 0, 0, { seg: 8 });
    k.lathe(C.white, [[0, 0.02], [0.075, 0.025], [0.11, 0.08], [0.12, 0.13], [0.105, 0.19], [0.07, 0.225], [0, 0.24]], x, 0, 0, { seg: 10, tint: true });
  }
});

// ================================================================================================
// RANGE
// ================================================================================================
/** Hitting mat centred at (0, -2.4). */
function hittingMat(k: Kit, base = 0.0): void {
  k.cbox(0x2b3a2e, 1.72, 0.025, 1.72, 0, base + 0.0125, -2.4, 0.01);
  k.box(C.turf, 1.56, 0.02, 1.56, 0, base + 0.03, -2.4, { nb: true });
  k.box(0x3d4d3b, 0.22, 0.008, 1.56, 0.02, base + 0.042, -2.4, { nb: true });
  k.cyl(C.black, 0.02, 0.025, 0, base + 0.046, -2.4, { seg: 6 });
}

/** Little bay number post (plate faces +Z). */
function bayPost(k: Kit, x: number, z: number, postC: Col = C.timberD): void {
  k.boxb(postC, 0.09, 1.05, 0.09, x, 0, z);
  k.box(C.green, 0.36, 0.36, 0.04, x, 1.05, z + 0.06);
  k.box(C.white, 0.28, 0.28, 0.02, x, 1.05, z + 0.085);
  k.box(C.brass, 0.1, 0.16, 0.012, x, 1.05, z + 0.1, { mat: 'metal' });
}

function bagStand(k: Kit, x: number, z: number, bagC: Col): void {
  k.tube(C.steelD, [x - 0.2, 0, z - 0.12], [x, 0.7, z - 0.02], 0.015, { seg: 4, mat: 'metal' });
  k.tube(C.steelD, [x + 0.2, 0, z - 0.12], [x, 0.7, z - 0.02], 0.015, { seg: 4, mat: 'metal' });
  k.box(C.steelD, 0.34, 0.03, 0.03, x, 0.4, z - 0.08, { mat: 'metal' });
  golfBag(k, x, z + 0.06, 0, -0.18, bagC);
}

def('bay_basic', (k) => {
  hittingMat(k);
  // stepping-stone patio for the waiting area
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 3; j++) k.cbox(k.jc(C.stone, 0.06), 1.78, 0.05, 1.12, -0.92 + i * 1.84, 0.025, 0.95 + j * 1.2, 0.015);
  // dividers (timber frame + painted panel)
  for (const s of [-1, 1]) {
    const x = s * 1.95;
    for (const z of [-3.45, -2.0, -0.55]) {
      k.boxb(C.timberD, 0.1, 1.38, 0.1, x, 0, z);
      k.boxb(C.timberD, 0.13, 0.05, 0.13, x, 1.38, z);
    }
    k.box(k.jc(C.greenL, 0.03), 0.05, 1.1, 2.9, x, 0.68, -2.0);
    k.box(C.cream, 0.07, 0.06, 2.9, x, 1.25, -2.0);
    k.box(C.cream, 0.07, 0.05, 2.9, x, 0.14, -2.0);
  }
  ballTray(k, -1.3, -1.3, 0);
  k.at(0, 0, 2.6, PI, () => parkBench(k, 1.6));
  bagStand(k, 1.35, 1.2, C.navy);
  bayPost(k, -1.68, 0.05);
  ballBucket(k, -1.25, 0.05, 1.0, 0.95, C.greenL, true);
});

// ---------------------------------------------------------------- shapes
/** Closed smooth loop through control points (XZ), sampled to n points. */
function smoothLoop(ctrl: V2[], n: number): V2[] {
  const curve = new THREE.CatmullRomCurve3(ctrl.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  return curve.getSpacedPoints(n).slice(0, n).map((v) => [v.x, v.z] as V2);
}
/** Offset a closed loop outwards by d (negative = inwards). */
function offsetLoop(pts: V2[], d: number): V2[] {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    area += x0 * z1 - x1 * z0;
  }
  const sgn = area > 0 ? 1 : -1;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length];
    const b = pts[(i + 1) % pts.length];
    const tx = b[0] - a[0];
    const tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    // outward normal for CCW (positive area) loop in (x,z): (tz, -tx)
    return [p[0] + (sgn * tz * d) / l, p[1] + (-sgn * tx * d) / l] as V2;
  });
}

/** Clip a polygon to the half-plane x >= a (keep = 1) or x <= a (keep = -1). */
function clipX(poly: V2[], a: number, keep: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const pin = (p[0] - a) * keep >= 0;
    const qin = (q[0] - a) * keep >= 0;
    if (pin) out.push(p);
    if (pin !== qin) {
      const t = (a - p[0]) / (q[0] - p[0]);
      out.push([a, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}
/** Mown-stripe top surface: polygon split into alternating stripes along direction `ang`. */
function stripedTop(k: Kit, loop: V2[], y: number, w: number, a: Col, b: Col, ang = 0.5): void {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const rot = loop.map(([x, z]) => [x * ca + z * sa, -x * sa + z * ca] as V2);
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x] of rot) {
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  let i = 0;
  for (let x0 = lo - 0.001; x0 < hi; x0 += w, i++) {
    const part = clipX(clipX(rot, x0, 1), x0 + w, -1);
    if (part.length < 3) continue;
    const back = part.map(([u, v]) => [u * ca - v * sa, u * sa + v * ca] as V2);
    k.extY(i % 2 ? a : b, back, y, y, { noBottom: true });
  }
}

// ================================================================================================
// RANGE (continued)
// ================================================================================================
def('bay_covered', (k) => {
  const post = 0x24543a;
  k.box(0x5b635d, 3.98, 0.03, 7.6, 0, 0.015, 0.2, { nb: true });
  // rubber floor seams
  for (const z of [-0.6, 1.6]) k.box(0x4a514c, 3.98, 0.004, 0.04, 0, 0.032, z, { nb: true });
  hittingMat(k, 0.03);
  for (const s of [-1, 1]) {
    const x = s * 1.95;
    for (const z of [-3.45, -0.55]) k.boxb(post, 0.08, 1.36, 0.08, x, 0, z, { mat: 'metal' });
    k.box(C.cream, 0.05, 1.14, 2.84, x, 0.7, -2.0);
    k.box(C.green, 0.07, 0.07, 2.92, x, 1.33, -2.0);
    k.box(C.green, 0.06, 0.2, 2.84, x, 0.2, -2.0);
  }
  // roof structure
  const yF = 3.35;
  const yB = 3.0;
  const zF = -3.6;
  const zB = 4.0;
  const roofY = (z: number): number => yF + ((z - zF) / (zB - zF)) * (yB - yF);
  const a = Math.atan2(yF - yB, zB - zF);
  const L = Math.hypot(zB - zF, yF - yB);
  for (const s of [-1, 1]) {
    k.boxb(post, 0.12, roofY(-3.5) - 0.18, 0.12, s * 1.88, 0, -3.5, { mat: 'metal' });
    k.boxb(post, 0.12, roofY(3.82) - 0.18, 0.12, s * 1.88, 0, 3.82, { mat: 'metal' });
    k.box(post, 0.1, 0.16, L - 0.2, s * 1.88, (yF + yB) / 2 - 0.1, 0.2, { rx: a, mat: 'metal' });
    // knee braces
    k.tube(post, [s * 1.88, roofY(-3.5) - 0.8, -3.5], [s * 1.88, roofY(-2.7) - 0.15, -2.7], 0.03, { seg: 4, mat: 'metal' });
    k.tube(post, [s * 1.88, roofY(3.82) - 0.8, 3.82], [s * 1.88, roofY(3.0) - 0.15, 3.0], 0.03, { seg: 4, mat: 'metal' });
  }
  k.box(post, 4.0, 0.2, 0.12, 0, roofY(-3.5) - 0.12, -3.5, { mat: 'metal' });
  k.box(post, 4.0, 0.2, 0.12, 0, roofY(3.82) - 0.12, 3.82, { mat: 'metal' });
  k.box(0x2c5c41, 4.0, 0.12, L, 0, (yF + yB) / 2 + 0.06, 0.2, { rx: a });
  k.box(0xe9e2cf, 3.96, 0.02, L - 0.1, 0, (yF + yB) / 2 - 0.01, 0.2, { rx: a });
  for (let i = 0; i < 5; i++) k.box(0x3d7354, 0.05, 0.05, L, -1.6 + i * 0.8, (yF + yB) / 2 + 0.14, 0.2, { rx: a });
  k.box(C.green, 4.02, 0.3, 0.06, 0, yF + 0.02, zF - 0.03);
  k.box(C.cream, 4.02, 0.04, 0.02, 0, yF + 0.06, zF - 0.065);
  k.box(C.green, 4.02, 0.24, 0.06, 0, yB + 0.02, zB + 0.03);
  // gutter + downpipe
  k.box(C.steelD, 4.0, 0.1, 0.12, 0, yB - 0.08, zB + 0.1, { mat: 'metal' });
  k.tube(C.steelD, [1.86, yB - 0.1, zB + 0.12], [1.86, 0.02, zB + 0.12], 0.035, { seg: 5, mat: 'metal' });
  // light fitting
  k.box(C.steelD, 0.18, 0.07, 1.3, 0, roofY(-1.6) - 0.3, -1.6, { mat: 'metal' });
  k.box(C.glow, 0.14, 0.02, 1.2, 0, roofY(-1.6) - 0.34, -1.6, { mat: 'glow' });
  k.tube(C.steelD, [0, roofY(-2.1) - 0.27, -2.1], [0, roofY(-2.1), -2.1], 0.01, { seg: 3 });
  k.tube(C.steelD, [0, roofY(-1.1) - 0.27, -1.1], [0, roofY(-1.1), -1.1], 0.01, { seg: 3 });
  // bay number board on back beam
  k.box(C.green, 0.6, 0.4, 0.04, 0, roofY(3.82) - 0.45, 3.9);
  k.box(C.cream, 0.5, 0.3, 0.02, 0, roofY(3.82) - 0.45, 3.925);
  k.box(C.green, 0.1, 0.2, 0.01, 0, roofY(3.82) - 0.45, 3.94);
  ballTray(k, -1.3, -1.3, 0);
  k.at(0, 0.03, 2.6, PI, () => parkBench(k, 1.6, 0xa8743f, C.iron, C.green));
  bagStand(k, 1.35, 1.1, C.red);
  ballBucket(k, -1.3, 0.03, 1.1, 0.95);
  // club rack on the back post
  k.box(C.timberD, 0.06, 0.08, 0.5, -1.82, 1.2, 3.4);
});

def('bay_premium', (k) => {
  const dark = 0x3b2819;
  const stoneW = 0x8d8578;
  // slate floor tiles
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 4; j++) k.box(k.jc((i + j) % 2 ? 0x55585c : 0x4b4e52, 0.03), 1.98, 0.04, 1.9, -0.995 + i * 1.99, 0.02, -3.6 + 0.95 + j * 1.9, { nb: true });
  hittingMat(k, 0.04);
  k.sec('walls');
  // side walls: stone base + glass screens
  for (const s of [-1, 1]) {
    const x = s * 1.92;
    k.tbox(stoneW, 0.16, 0.95, 3.1, x, 0, -2.0, 0.02);
    k.box(C.stoneL, 0.2, 0.06, 3.14, x, 0.97, -2.0);
    k.box(0xb4c6d0, 0.03, 1.3, 2.9, x, 1.67, -2.0);
    for (const z of [-3.47, -0.53]) k.boxb(dark, 0.08, 1.4, 0.08, x, 1.0, z);
    k.box(dark, 0.08, 0.06, 3.0, x, 2.37, -2.0);
    // planters along the lounge sides
    k.tbox(stoneW, 0.34, 0.5, 1.5, s * 1.78, 0, 3.05, 0.03);
    for (let i = 0; i < 3; i++) k.lathe(k.jc(0x7a9a45, 0.1), [[0.14, 0.48], [0, 1.0 + k.r() * 0.25]], s * 1.78, 0, 2.5 + i * 0.5, { seg: 5, mat: 'foliage' });
  }
  k.sec('roof');
  // posts + roof
  const yF = 3.4;
  const yB = 3.15;
  const zF = -3.65;
  const zB = 4.0;
  const roofY = (z: number): number => yF + ((z - zF) / (zB - zF)) * (yB - yF);
  const a = Math.atan2(yF - yB, zB - zF);
  const L = Math.hypot(zB - zF, yF - yB);
  for (const s of [-1, 1])
    for (const z of [-3.5, 3.82]) {
      k.tbox(stoneW, 0.3, 0.35, 0.3, s * 1.84, 0, z, 0.03);
      k.boxb(dark, 0.18, roofY(z) - 0.55, 0.18, s * 1.84, 0.35, z);
    }
  k.box(dark, 4.0, 0.14, L, 0, (yF + yB) / 2 - 0.02, 0.17, { rx: a });
  // sedum green roof
  const sedum = [0x6f8f3e, 0x7a9846, 0x7f8a4c, 0x698a3c, 0x83a04e, 0x74884a];
  for (let i = 0; i < 6; i++) {
    const zz = -3.0 + i * 1.25;
    k.box(k.jc(sedum[i], 0.04), 3.7, 0.06, 1.25, 0, roofY(zz) + 0.08, zz, { rx: a, nb: true });
    k.box(k.jc(i % 2 ? 0x8f7a56 : 0x9aa85a, 0.05), 0.9 + (i % 3) * 0.4, 0.07, 0.6, -1.1 + ((i * 1.37) % 2.2), roofY(zz) + 0.09, zz + 0.1, { rx: a, nb: true });
  }
  for (const s of [-1, 1]) k.box(0x6b4a30, 0.12, 0.12, L, s * 1.92, (yF + yB) / 2 + 0.1, 0.17, { rx: a });
  k.box(dark, 4.02, 0.42, 0.1, 0, yF - 0.12, zF - 0.02);
  k.box(C.brass, 4.02, 0.03, 0.02, 0, yF - 0.02, zF - 0.075, { mat: 'metal' });
  k.box(dark, 4.02, 0.36, 0.1, 0, yB - 0.12, zB + 0.03);
  for (let i = 0; i < 5; i++) {
    const z = -3.3 + i * 1.6;
    k.box(0x6b4a30, 3.9, 0.06, 0.1, 0, roofY(z) - 0.13, z, { nb: true });
  }
  for (const z of [-1.4]) {
    k.cyl(C.steelD, 0.09, 0.04, 0, roofY(z) - 0.21, z, { seg: 6, mat: 'metal', caps: 'none' });
    k.cyl(C.glow, 0.07, 0.01, 0, roofY(z) - 0.22, z, { seg: 6, mat: 'glow' });
  }
  k.sec('screen');
  // launch monitor screen on a stand, angled at the golfer
  const ry = Math.atan2(-0.7 - 1.6, -2.4 - -1.0);
  k.push(1.6, 0, -1.0, ry);
  k.cyl(C.charcoal, 0.25, 0.04, 0, 0.04, 0, { seg: 8, mat: 'metal' });
  k.cyl(C.charcoal, 0.035, 1.3, 0, 0.08, 0, { seg: 6, mat: 'metal' });
  k.box(C.black, 1.0, 0.62, 0.07, 0, 1.6, -0.02, { rx: -0.08 });
  k.box(C.screen, 0.92, 0.54, 0.02, 0, 1.6, 0.02, { mat: 'glass', rx: -0.08 });
  k.box(C.brass, 0.2, 0.02, 0.01, 0, 1.3, 0.03, { mat: 'metal' });
  k.pop();
  // small radar unit on the floor in front of the ball
  k.cbox(C.charcoal, 0.22, 0.14, 0.1, 0.0, 0.11, -1.2, 0.02);
  k.box(C.glow, 0.12, 0.04, 0.01, 0.0, 0.12, -1.25, { mat: 'glow' });
  k.sec('heater');
  // patio heater
  k.push(1.5, 0, 0.55, 0);
  k.cyl(C.steelD, 0.22, 0.12, 0, 0.04, 0, { seg: 8, mat: 'metal', rt: 0.18 });
  k.cyl(C.steel, 0.035, 1.6, 0, 0.16, 0, { seg: 6, mat: 'metal' });
  k.cyl(C.glow, 0.07, 0.45, 0, 1.75, 0, { seg: 6, mat: 'glow' });
  for (let i = 0; i < 3; i++) {
    const b = (i / 3) * TAU;
    k.tube(C.steel, [Math.sin(b) * 0.1, 1.7, Math.cos(b) * 0.1], [Math.sin(b) * 0.1, 2.25, Math.cos(b) * 0.1], 0.012, { seg: 3, mat: 'metal' });
  }
  k.lathe([C.steel, C.steel], [[0.05, 2.22], [0.42, 2.3], [0.05, 2.36]], 0, 0, 0, { seg: 8, mat: 'metal' });
  k.pop();
  k.sec('lounge');
  // lounge: sofa + coffee table + armchair
  const leather = 0x6e4a32;
  k.push(0, 0.04, 3.35, PI);
  k.box(dark, 1.9, 0.12, 0.82, 0, 0.12, 0);
  k.tbox(leather, 1.86, 0.22, 0.8, 0, 0.17, 0, 0.05);
  k.tbox(leather, 1.86, 0.62, 0.2, 0, 0.17, -0.32, 0.06);
  for (const s of [-1, 1]) {
    k.tbox(leather, 0.18, 0.42, 0.8, s * 0.86, 0.17, 0, 0.06);
    k.tbox(0xe8dcc4, 0.76, 0.12, 0.58, s * 0.38, 0.38, 0.06, 0.05);
  }
  k.box(C.green, 0.36, 0.34, 0.12, -0.55, 0.62, -0.2, { rz: 0.2, rx: -0.2 });
  k.pop();
  k.push(0, 0.04, 2.25, 0);
  k.tbox(dark, 0.9, 0.38, 0.5, 0, 0, 0, 0.02);
  k.lathe(C.glass, [[0, 0.38], [0.035, 0.38], [0.04, 0.52], [0, 0.52]], 0.2, 0, 0.05, { seg: 6, mat: 'glass' });
  k.lathe(0xd8d2c4, [[0, 0.38], [0.07, 0.38], [0.06, 0.5], [0, 0.5]], -0.25, 0, -0.05, { seg: 6 });
  blob(k, 0x4f8a3a, 0.12, -0.25, 0.6, -0.05, { detail: 0 });
  k.pop();
  k.push(-1.3, 0.04, 1.35, 0.9);
  k.box(dark, 0.72, 0.12, 0.7, 0, 0.12, 0);
  k.tbox(leather, 0.7, 0.22, 0.68, 0, 0.17, 0, 0.05);
  k.tbox(leather, 0.7, 0.62, 0.18, 0, 0.17, -0.27, 0.06);
  for (const s of [-1, 1]) k.tbox(leather, 0.14, 0.42, 0.68, s * 0.33, 0.17, 0, 0.05);
  k.tbox(0xe8dcc4, 0.44, 0.1, 0.5, 0, 0.38, 0.05, 0.04);
  k.pop();
  k.sec('tray');
  ballTray(k, -1.3, -1.3, 0);
  bagStand(k, -1.45, -0.2, C.green);
  // bay number plaque on the back fascia
  k.box(C.brass, 0.4, 0.24, 0.02, 0, yB - 0.12, zB + 0.09, { mat: 'metal' });
});

def('dispenser', (k) => {
  k.tbox(C.concrete, 3.0, 0.06, 2.8, 0, 0, 0.3, 0.02);
  // machine
  k.tbox(C.greenD, 1.24, 0.14, 0.9, 0, 0.06, -0.4, 0.02);
  k.cbox(C.green, 1.12, 1.78, 0.8, 0, 0.2 + 0.89, -0.4, 0.06);
  const fz = 0.0;
  k.box(C.white, 0.94, 0.92, 0.03, 0, 1.42, fz + 0.01);
  k.box(C.charcoal, 0.54, 0.34, 0.02, 0, 1.64, fz + 0.03);
  k.quad(C.screen, [-0.24, 1.49, fz + 0.045], [0.24, 1.49, fz + 0.045], [0.24, 1.79, fz + 0.045], [-0.24, 1.79, fz + 0.045], { mat: 'glass', up: [0, 0, 1] });
  // keypad
  k.box(0xd9dcde, 0.22, 0.24, 0.025, -0.22, 1.18, fz + 0.035);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) k.box(C.steelD, 0.045, 0.04, 0.012, -0.29 + i * 0.07, 1.1 + j * 0.065, fz + 0.05);
  // card + coin slots
  k.box(C.brass, 0.2, 0.09, 0.02, 0.22, 1.26, fz + 0.035, { mat: 'metal' });
  k.box(C.black, 0.15, 0.02, 0.02, 0.22, 1.26, fz + 0.045);
  k.box(C.brass, 0.08, 0.12, 0.02, 0.22, 1.1, fz + 0.035, { mat: 'metal' });
  k.box(C.black, 0.012, 0.07, 0.02, 0.22, 1.1, fz + 0.045);
  k.cyl(0x2fa84f, 0.035, 0.02, 0.36, 1.18, fz + 0.03, { rx: PI / 2, seg: 8, mat: 'glow' });
  // chute + bucket
  k.hull(C.steel, [[-0.2, 0.92, fz], [0.2, 0.92, fz], [-0.2, 0.62, fz], [0.2, 0.62, fz], [-0.12, 0.66, fz + 0.28], [0.12, 0.66, fz + 0.28], [-0.12, 0.55, fz + 0.26], [0.12, 0.55, fz + 0.26]], 0, 0, 0, { mat: 'metal' });
  k.box(C.black, 0.22, 0.03, 0.2, 0, 0.55, fz + 0.17);
  k.box(C.steelD, 0.5, 0.03, 0.42, 0, 0.075, fz + 0.18, { mat: 'metal' });
  ballBucket(k, 0, 0.09, fz + 0.2, 0.95);
  // side stripes + logo
  for (const s of [-1, 1]) {
    k.box(C.white, 0.02, 0.1, 0.78, s * 0.565, 1.0, -0.4);
    k.box(C.cream, 0.02, 0.05, 0.78, s * 0.565, 0.86, -0.4);
  }
  // canopy
  k.box(C.green, 1.5, 0.08, 1.15, 0, 2.08, -0.2, { rx: 0.12 });
  k.box(C.white, 1.52, 0.14, 0.04, 0, 1.98, 0.37, { rx: 0.12 });
  for (const s of [-1, 1]) k.tube(C.charcoal, [s * 0.5, 1.6, -0.0], [s * 0.6, 2.0, 0.28], 0.02, { seg: 4 });
  // top sign with ball emblem
  k.cbox(C.green, 1.1, 0.42, 0.14, 0, 2.42, -0.5, 0.03);
  k.box(C.cream, 1.0, 0.32, 0.02, 0, 2.42, -0.42);
  k.ball(C.white, 0.16, -0.32, 2.42, -0.42, { detail: 1, smooth: true, sz: 0.45 });
  for (let i = 0; i < 3; i++) k.box(C.green, 0.44 - i * 0.08, 0.04, 0.012, 0.12 - i * 0.04, 2.51 - i * 0.09, -0.405);
  k.boxb(C.charcoal, 0.05, 0.2, 0.05, -0.4, 2.12, -0.5);
  k.boxb(C.charcoal, 0.05, 0.2, 0.05, 0.4, 2.12, -0.5);
  // spare buckets + bin
  for (let i = 0; i < 3; i++) ballBucket(k, -1.05, 0.06 + i * 0.07, 0.15, 0.95, C.greenL, false);
  ballBucket(k, -1.05, 0.27, 0.15, 0.95, C.greenL, false);
  k.lathe([C.green, C.green, C.black], [[0, 0.06], [0.2, 0.06], [0.22, 0.8], [0.23, 0.86], [0, 0.88]], 1.05, 0, 0.15, { seg: 10 });
  // price board on a post
  k.boxb(C.charcoal, 0.06, 1.0, 0.06, 1.3, 0.06, 1.2);
  k.box(C.green, 0.6, 0.42, 0.04, 1.3, 1.25, 1.22);
  for (let i = 0; i < 3; i++) k.box(C.white, 0.42, 0.035, 0.01, 1.3, 1.35 - i * 0.1, 1.245);
});

def('target_flag', (k) => {
  const g1 = 0x5fb84a;
  const g2 = 0x53a742;
  k.lathe([C.fringe, 0x4c9b3c, g2, g1, g2, g1, g2, g1], [[3.8, 0], [3.55, 0.07], [3.3, 0.115], [2.85, 0.14], [2.35, 0.152], [1.85, 0.158], [1.35, 0.162], [0.8, 0.164], [0, 0.165]], 0, 0, 0, { seg: 28 });
  k.lathe([0x222222, 0x222222], [[0.1, 0.166], [0.0, 0.166]], 0, 0, 0, { seg: 8 });
  k.lathe(C.white, [[0.12, 0.165], [0.1, 0.168]], 0, 0, 0, { seg: 8 });
  flagPin(k, 0, 0.16, 0, 3.1, C.red, 0.95, 0.62, 0.035);
});

def('target_ring', (k) => {
  const g1 = 0x5bb447;
  const g2 = 0x4fa53f;
  k.lathe([C.fringe, g2, g1, g2, g1], [[5.95, 0], [5.6, 0.05], [4.1, 0.06], [2.7, 0.062], [1.0, 0.064], [0, 0.064]], 0, 0, 0, { seg: 36 });
  const ring = (ri: number, ro: number, h: number, c: Col, seg: number) =>
    k.lathe(c, [[ro + 0.06, 0.03], [ro, h - 0.04], [ro - 0.05, h], [ri + 0.05, h], [ri, h - 0.04], [ri - 0.06, 0.03]], 0, 0, 0, { seg });
  ring(5.15, 5.55, 0.24, 0xf4f2ec, 40);
  ring(3.75, 4.12, 0.22, C.red, 32);
  ring(2.35, 2.7, 0.2, 0xf4f2ec, 24);
  k.lathe(C.yellow, [[1.08, 0.03], [1.0, 0.17], [0.94, 0.2], [0, 0.2]], 0, 0, 0, { seg: 18 });
  flagPin(k, 0, 0.2, 0, 3.2, C.red, 0.95, 0.62, 0.035);
});

def('target_island', (k) => {
  k.lathe(C.waterD, [[7.6, 0.02], [4.7, 0.02]], 0, 0, 0, { seg: 40 });
  k.lathe(C.water, [[7.55, 0.11], [4.7, 0.11]], 0, 0, 0, { seg: 40, mat: 'water' });
  const kerb = (R: number, n: number, rad: number, h: number) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const len = ((TAU * R) / n) * 0.97;
      k.tbox(k.jc(i % 3 ? C.stone : 0xa79f90, 0.05), len, h + k.rr(-0.03, 0.03), rad, Math.sin(a) * R, 0, Math.cos(a) * R, 0.05, { ry: a });
    }
  };
  kerb(7.75, 34, 0.42, 0.3);
  kerb(4.66, 22, 0.36, 0.36);
  const g1 = 0x5fb84a;
  const g2 = 0x53a742;
  k.lathe([C.fringe, 0x4c9b3c, g2, g1, g2, g1], [[4.5, 0.3], [4.3, 0.44], [3.8, 0.55], [3.0, 0.62], [2.0, 0.66], [1.0, 0.675], [0, 0.68]], 0, 0, 0, { seg: 32 });
  flagPin(k, 0, 0.67, -0.4, 3.0, C.yellow, 0.95, 0.62, 0.035);
  // arched timber bridge (front, +Z)
  const z0 = 4.15;
  const z1 = 8.0;
  const arch = (t: number): number => 0.42 + Math.sin(t * PI) * 0.38;
  const n = 11;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const z = z0 + (z1 - z0) * t;
    const slope = Math.cos(t * PI) * 0.38 * PI / (z1 - z0);
    k.box(k.jc(C.timber, 0.07), 1.3, 0.06, (z1 - z0) / n - 0.03, 0, arch(t), z, { rx: -Math.atan(slope) });
  }
  for (const s of [-1, 1]) {
    const pts: V3[] = [];
    const rails: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      pts.push([s * 0.62, arch(t) - 0.1, z0 + (z1 - z0) * t]);
      rails.push([s * 0.62, arch(t) + 0.85, z0 + (z1 - z0) * t]);
    }
    k.tubes(C.timberD, pts, 0.06, { seg: 4 });
    k.tubes(C.timberL, rails, 0.035, { seg: 4 });
    for (let i = 0; i <= 3; i++) {
      const t = i / 3;
      const z = z0 + (z1 - z0) * t;
      k.boxb(C.timberD, 0.09, arch(t) + 0.9 - (i === 0 || i === 3 ? 0 : arch(t) - 0.3), 0.09, s * 0.62, i === 0 || i === 3 ? 0 : arch(t) - 0.3, z);
    }
  }
  // reeds & lily pads
  for (let i = 0; i < 5; i++) {
    const a = 1.2 + i * 1.05;
    const R = 7.1;
    const x = Math.sin(a) * R;
    const z = Math.cos(a) * R;
    for (let j = 0; j < 4; j++) k.lathe(k.jc(0x6c8f3a, 0.1), [[0.07, 0], [0, 0.9 + k.r() * 0.5]], x + k.rr(-0.25, 0.25), 0, z + k.rr(-0.25, 0.25), { seg: 4, mat: 'foliage', rx: k.rr(-0.15, 0.15), rz: k.rr(-0.15, 0.15) });
    k.cyl(0x5a3a22, 0.04, 0.2, x + 0.1, 0.9, z, { seg: 5 });
  }
  for (const [a, R] of [[2.4, 6.2], [3.6, 5.6], [5.2, 6.5]] as [number, number][]) {
    k.cyl(0x4f8e3a, 0.32, 0.01, Math.sin(a) * R, 0.11, Math.cos(a) * R, { seg: 7, caps: 'top' });
    k.ball(0xf2a7c3, 0.07, Math.sin(a) * R + 0.1, 0.15, Math.cos(a) * R, { kind: 'octa', detail: 0 });
  }
});

def('picker_shed', (k) => {
  const wall = 0x3d6b52;
  const z0 = -3.5;
  const z1 = 1.8;
  const zc = (z0 + z1) / 2;
  const D = z1 - z0;
  const W = 6.0;
  const H = 3.0;
  k.tbox(C.concrete, 7.2, 0.1, 7.7, 0, 0, 0.1, 0.03);
  k.boxb(wall, W, H, D, 0, 0.1, zc);
  k.boxb(C.cream, W + 0.06, 0.12, D + 0.06, 0, 0.1, zc);
  // corrugation ribs
  for (let i = 0; i < 12; i++) {
    const z = z0 + 0.25 + i * ((D - 0.5) / 11);
    for (const s of [-1, 1]) k.box(shade(wall, 0.82), 0.03, H - 0.2, 0.05, s * (W / 2 + 0.015), 0.2 + (H - 0.2) / 2, z, { nb: true });
  }
  for (let i = 0; i < 13; i++) k.box(shade(wall, 0.82), 0.05, H - 0.2, 0.03, -W / 2 + 0.25 + i * ((W - 0.5) / 12), 0.2 + (H - 0.2) / 2, z0 - 0.015, { nb: true });
  // corners
  for (const sx of [-1, 1]) for (const sz of [z0, z1]) k.boxb(C.cream, 0.12, H, 0.12, sx * (W / 2), 0.1, sz);
  // roller door
  const dw = 3.6;
  const dh = 2.65;
  k.box(0x2a2d2f, dw, dh, 0.04, 0, 0.1 + dh / 2, z1 + 0.0);
  const slats = 10;
  for (let i = 0; i < slats; i++) k.box(i % 2 ? 0xc9cdd0 : 0xbcc1c4, dw - 0.1, dh / slats - 0.025, 0.04, 0, 0.14 + (i + 0.5) * (dh / slats), z1 + 0.04, { mat: 'metal' });
  k.box(C.steelD, dw + 0.3, 0.4, 0.36, 0, 0.1 + dh + 0.22, z1 + 0.12, { mat: 'metal' });
  for (const s of [-1, 1]) k.boxb(C.cream, 0.14, dh, 0.12, s * (dw / 2 + 0.07), 0.1, z1 + 0.04);
  k.box(C.yellow, 0.08, 0.5, 0.02, 0, 0.1 + 0.3, z1 + 0.07);
  // roof (ridge along Z)
  k.at(0, 0, zc, PI / 2, () => gableRoof(k, D, W, H + 0.1, 1.15, { roof: 0x56606a, wall, trim: C.cream, over: 0.35, overX: 0.3, t: 0.14, ridge: 0x3d444c, courses: 4 }));
  // sign on front gable
  k.cbox(C.green, 2.4, 0.62, 0.08, 0, H + 0.62, z1 + 0.09, 0.02);
  k.box(C.cream, 2.26, 0.5, 0.02, 0, H + 0.62, z1 + 0.13);
  k.ball(C.white, 0.18, -0.8, H + 0.62, z1 + 0.13, { detail: 1, smooth: true, sz: 0.4 });
  k.box(C.green, 1.2, 0.07, 0.012, 0.25, H + 0.69, z1 + 0.145);
  k.box(C.green, 0.9, 0.05, 0.012, 0.1, H + 0.56, z1 + 0.145);
  // lamp over sign
  k.box(C.charcoal, 0.3, 0.08, 0.3, 0, H + 1.08, z1 + 0.3);
  k.box(C.glow, 0.24, 0.02, 0.24, 0, H + 1.035, z1 + 0.3, { mat: 'glow' });
  k.tube(C.charcoal, [0, H + 1.1, z1 + 0.08], [0, H + 1.1, z1 + 0.3], 0.02, { seg: 4 });
  // side window + door (+X wall)
  k.at(W / 2, 1.2, -1.6, PI / 2, () => win(k, 1.3, 0.8, { frame: C.cream, cols: 2, rows: 1 }));
  k.at(-W / 2, 0.1, -0.4, -PI / 2, () => door(k, 0.95, 2.1, { col: C.cream, frame: C.cream }));
  // gutters + downpipes
  for (const s of [-1, 1]) {
    k.box(C.steelD, 0.12, 0.1, D + 0.6, s * (W / 2 + 0.38), H - 0.05, zc, { mat: 'metal' });
    k.tubes(C.steelD, [[s * (W / 2 + 0.36), H - 0.05, z1 + 0.12], [s * (W / 2 + 0.08), H - 0.45, z1 + 0.12], [s * (W / 2 + 0.08), 0.1, z1 + 0.12]], 0.035, { seg: 5, mat: 'metal' });
  }
  // ball crate & baskets
  k.push(2.55, 0.1, 3.0, -0.2);
  k.tbox(C.timberL, 0.9, 0.5, 0.62, 0, 0, 0, 0.02);
  for (let i = 0; i < 3; i++) k.box(C.timber, 0.92, 0.06, 0.64, 0, 0.1 + i * 0.16, 0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) golfBall(k, -0.3 + i * 0.2 + (j % 2) * 0.05, 0.5, -0.18 + j * 0.18, 0.03);
  k.pop();
  for (let i = 0; i < 3; i++) ballBucket(k, -2.6, 0.1 + i * 0.08, 2.9, 1.0, 0x2f2f2f, false);
  // oil stain + tyre marks
  k.box(0x8c897f, 2.2, 0.004, 2.0, 0, 0.102, 2.9, { nb: true });
});

def('floodlight', (k) => {
  const steel = 0x8e979e;
  k.tbox(C.concrete, 1.4, 0.4, 1.4, 0, 0, 0, 0.05);
  const H = 11.4;
  const legs = [PI / 6, (5 * PI) / 6, (3 * PI) / 2];
  const at = (a: number, y: number): V3 => {
    const r = 0.58 - (y / H) * 0.36;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  for (const a of legs) k.tube(steel, at(a, 0.4), at(a, H), 0.055, { seg: 5, mat: 'metal' });
  const levels = 8;
  for (let l = 0; l < levels; l++) {
    const y0 = 0.4 + ((H - 0.4) * l) / levels;
    const y1 = 0.4 + ((H - 0.4) * (l + 1)) / levels;
    for (let i = 0; i < 3; i++) {
      const a = legs[i];
      const b = legs[(i + 1) % 3];
      k.tube(steel, at(a, y1), at(b, y1), 0.025, { seg: 3, mat: 'metal' });
      k.tube(steel, at(l % 2 ? a : b, y0), at(l % 2 ? b : a, y1), 0.022, { seg: 3, mat: 'metal' });
    }
  }
  // platform
  k.box(0x6f777e, 1.6, 0.06, 1.2, 0, H + 0.05, -0.1, { mat: 'metal' });
  for (const s of [-1, 1]) k.tube(steel, [s * 0.8, H + 0.08, 0.5], [s * 0.8, H + 0.95, 0.5], 0.02, { seg: 3, mat: 'metal' });
  k.tube(steel, [-0.8, H + 0.95, 0.5], [0.8, H + 0.95, 0.5], 0.02, { seg: 3, mat: 'metal' });
  // lamp frame
  k.box(0x5f676e, 2.6, 0.1, 0.1, 0, H + 0.6, -0.55, { mat: 'metal' });
  k.box(0x5f676e, 2.6, 0.1, 0.1, 0, H + 1.45, -0.55, { mat: 'metal' });
  for (const x of [-1.25, 1.25]) k.box(0x5f676e, 0.1, 1.0, 0.1, x, H + 1.02, -0.55, { mat: 'metal' });
  k.tube(0x5f676e, [0, H + 0.08, -0.1], [0, H + 1.5, -0.55], 0.06, { seg: 5, mat: 'metal' });
  for (let r = 0; r < 2; r++)
    for (let i = 0; i < 3; i++) {
      const x = -0.85 + i * 0.85;
      const y = H + 0.62 + r * 0.85;
      k.push(x, y, -0.68, 0, 1, -0.55);
      k.cbox(0x3c4248, 0.62, 0.5, 0.26, 0, 0, 0, 0.04, { mat: 'metal' });
      k.box(C.glow, 0.52, 0.4, 0.02, 0, 0, -0.135, { mat: 'glow' });
      k.box(0x3c4248, 0.64, 0.03, 0.18, 0, 0.26, -0.2, { mat: 'metal' });
      k.pop();
    }
  // conduit + control box
  k.tube(0x2b2f33, [0.42, 0.4, 0.2], [0.18, H, 0.1], 0.03, { seg: 4 });
  k.cbox(0x9ea6ac, 0.4, 0.55, 0.22, 0.5, 0.9, 0.6, 0.02, { mat: 'metal' });
  k.boxb(0x6f777e, 0.08, 0.6, 0.08, 0.5, 0.0, 0.48);
});

def('practice_green', (k) => {
  const ctrl: V2[] = [[-6.6, -0.6], [-5.4, -4.6], [-2.0, -6.1], [2.2, -6.2], [5.6, -4.6], [6.7, -0.8], [6.0, 3.0], [3.6, 5.3], [1.0, 3.9], [-1.6, 3.7], [-4.4, 5.5], [-6.5, 3.2]];
  const loop = smoothLoop(ctrl, 52);
  k.extY(C.fairway, offsetLoop(loop, 1.05), 0, 0.045, { noBottom: true });
  k.extY(C.fringe, offsetLoop(loop, 0.55), 0, 0.075, { noBottom: true });
  k.extY(C.putt, loop, 0, 0.1, { noBottom: true, noTop: true });
  stripedTop(k, loop, 0.1, 1.5, C.putt, 0x66bb50, 0.6);
  const cups: [number, number, number][] = [[0, -3.6, 0], [-3.8, -1.2, 1], [3.6, 1.4, 2]];
  const flags = [C.red, C.yellow, 0x2f6fd6];
  for (const [x, z, f] of cups) {
    k.lathe([C.white, 0x1b1b1b], [[0.075, 0.1], [0.055, 0.102], [0, 0.102]], x, 0, z, { seg: 8 });
    flagPin(k, x, 0.1, z, 0.62, flags[f], 0.22, 0.15, 0.008);
  }
  golfBall(k, -2.9, 0.1, -0.9, 0.03);
  golfBall(k, 1.8, 0.1, -2.6, 0.03);
  golfBall(k, 0.4, 0.1, 0.2, 0.03);
  golfBall(k, 3.1, 0.1, 1.1, 0.03);
  // sign + ball tray at the front
  k.boxb(C.timberD, 0.08, 0.8, 0.08, -1.0, 0, 6.6);
  k.box(C.green, 0.8, 0.36, 0.04, -1.0, 0.85, 6.63, { rx: -0.2 });
  k.box(C.cream, 0.68, 0.06, 0.012, -1.0, 0.89, 6.66, { rx: -0.2 });
  ballBucket(k, 1.2, 0.0, 6.6, 1.0);
});

def('chipping_area', (k) => {
  // target green
  const green = smoothLoop([[-3.6, -2.4], [-2.4, -4.6], [0.6, -5.0], [3.0, -3.6], [3.2, -1.2], [1.4, 0.2], [-1.4, 0.0]], 40);
  k.extY(C.fairway, offsetLoop(green, 0.9), 0, 0.045, { noBottom: true });
  k.extY(C.fringe, offsetLoop(green, 0.45), 0, 0.075, { noBottom: true });
  k.extY(C.putt, green, 0, 0.1, { noBottom: true, noTop: true });
  stripedTop(k, green, 0.1, 1.2, C.putt, 0x66bb50, 0.6);
  k.lathe([C.white, 0x1b1b1b], [[0.075, 0.1], [0.055, 0.102], [0, 0.102]], 0, 0, -2.4, { seg: 8 });
  flagPin(k, 0, 0.1, -2.4, 2.1, C.red, 0.5, 0.34, 0.013);
  golfBall(k, -0.6, 0.1, -1.6, 0.03);
  golfBall(k, 0.7, 0.1, -3.1, 0.03);
  golfBall(k, -1.9, 0.1, -2.9, 0.03);
  // bunker
  const bunker = smoothLoop([[4.9, -1.6], [6.0, -3.4], [7.5, -2.8], [7.6, -0.9], [6.6, 0.5], [5.2, 0.2]], 32);
  k.extY(0x3f7f2f, offsetLoop(bunker, 0.35), 0, 0.13, { noBottom: true });
  k.extY(C.sandD, offsetLoop(bunker, 0.05), 0, 0.14, { noBottom: true });
  k.extY(C.sand, offsetLoop(bunker, -0.25), 0, 0.15, { noBottom: true });
  k.tube(C.timberL, [6.2, 0.17, -1.6], [7.4, 0.25, -0.4], 0.02, { seg: 4 });
  k.box(0x2f2f2f, 0.45, 0.04, 0.06, 6.15, 0.18, -1.65, { ry: -0.78 });
  // hitting strip (+Z)
  k.tbox(0x3f7a3a, 13.6, 0.025, 1.9, 0, 0, 4.4, 0.01);
  for (let i = 0; i < 3; i++) {
    const x = -4.5 + i * 4.5;
    k.box(0x2b3a2e, 1.72, 0.012, 1.72, x, 0.026, 4.4, { nb: true });
    k.box(C.turf, 1.6, 0.02, 1.6, x, 0.03, 4.4, { nb: true });
    k.box(0x3d4d3b, 0.22, 0.008, 1.6, x + 0.3, 0.042, 4.4, { nb: true });
    ballBucket(k, x - 1.2, 0.025, 4.9, 0.95);
  }
  k.boxb(C.timberD, 0.08, 0.8, 0.08, 6.6, 0, 5.4);
  k.box(C.green, 0.7, 0.34, 0.04, 6.6, 0.85, 5.43, { rx: -0.2 });
  k.box(C.cream, 0.58, 0.05, 0.012, 6.6, 0.88, 5.46, { rx: -0.2 });
});

def('yardage_board', (k) => {
  for (const x of [-0.95, 0.95]) {
    k.tbox(C.concrete, 0.3, 0.1, 0.3, x, 0, 0, 0.02);
    k.boxb(C.white, 0.14, 2.45, 0.14, x, 0.1, 0);
    k.boxb(C.white, 0.18, 0.06, 0.18, x, 2.55, 0);
  }
  const y0 = 1.15;
  const y1 = 2.5;
  const ym = (y0 + y1) / 2;
  k.box(C.green, 2.5, y1 - y0 + 0.08, 0.1, 0, ym, -0.1);
  k.box(C.white, 2.4, y1 - y0 - 0.02, 0.04, 0, ym, -0.03);
  k.box(C.red, 2.4, 0.16, 0.012, 0, y1 - 0.12, -0.003);
  k.box(C.black, 2.4, 0.1, 0.012, 0, y0 + 0.1, -0.003);
  pixelText(k, '150', -0.87, y1 - 0.29, 0.004, 0.155, C.black, 1);
  // little roof cap
  k.box(C.green, 2.62, 0.06, 0.32, 0, y1 + 0.08, -0.06, { rx: -0.15 });
});

// ================================================================================================
// BUILDING HELPERS
// ================================================================================================
interface Box2 {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
type Face = 'f' | 'b' | 'l' | 'r';
/** Run fn in a frame on the given wall face of box b (local +Z = outward normal, local X along the wall). */
function onWall(k: Kit, b: Box2, face: Face, u: number, y: number, fn: () => void): void {
  if (face === 'f') k.at(u, y, b.z1, 0, fn);
  else if (face === 'b') k.at(u, y, b.z0, PI, fn);
  else if (face === 'r') k.at(b.x1, y, u, PI / 2, fn);
  else k.at(b.x0, y, u, -PI / 2, fn);
}
function bw(b: Box2): number {
  return b.x1 - b.x0;
}
function bd(b: Box2): number {
  return b.z1 - b.z0;
}
function bcx(b: Box2): number {
  return (b.x0 + b.x1) / 2;
}
function bcz(b: Box2): number {
  return (b.z0 + b.z1) / 2;
}
/** Walls of a block from y0 to y0+h (with optional plinth below y0 and trims). */
function block(k: Kit, b: Box2, y0: number, h: number, wall: Col, o: { plinth?: Col; quoin?: Col; band?: Col; bandY?: number[] } = {}): void {
  const cx = bcx(b);
  const cz = bcz(b);
  k.boxb(wall, bw(b), h, bd(b), cx, y0, cz, { nb: true });
  if (o.plinth && y0 > 0) k.tbox(o.plinth, bw(b) + 0.16, y0, bd(b) + 0.16, cx, 0, cz, 0.04);
  if (o.quoin)
    for (const x of [b.x0, b.x1]) for (const z of [b.z0, b.z1]) k.boxb(o.quoin, 0.26, h, 0.26, x, y0, z, { nb: true });
  if (o.band) for (const y of o.bandY ?? []) k.boxb(o.band, bw(b) + 0.12, 0.18, bd(b) + 0.12, cx, y, cz);
}
/** Cheap window: frame slab + glass pane (+ optional sill, mullions, head). */
function liteWin(k: Kit, w: number, h: number, o: { frame?: Col; sill?: Col | null; mull?: boolean; head?: Col; glass?: Col } = {}): void {
  const fr = o.frame ?? C.trim;
  k.box(fr, w + 0.16, h + 0.16, 0.06, 0, h / 2, 0.0, { nb: true });
  k.quad(o.glass ?? C.glass, [-w / 2, 0, 0.075], [w / 2, 0, 0.075], [w / 2, h, 0.075], [-w / 2, h, 0.075], { mat: 'glass', up: [0, 0, 1] });
  if (o.mull) {
    k.box(fr, 0.05, h, 0.03, 0, h / 2, 0.09, { nb: true });
    k.box(fr, w, 0.05, 0.03, 0, h * 0.62, 0.09);
  }
  if (o.sill !== null) k.box(o.sill ?? fr, w + 0.3, 0.07, 0.14, 0, -0.1, 0.07);
  if (o.head) k.box(o.head, w + 0.34, 0.16, 0.1, 0, h + 0.14, 0.05);
}
/** Classical column (lathe) standing at (x, y, z). */
function column(k: Kit, x: number, y: number, z: number, h: number, c: Col, r = 0.18, seg = 8): void {
  k.boxb(c, r * 2.7, 0.16, r * 2.7, x, y, z, { nb: true });
  k.lathe(c, [[r * 1.22, y + 0.16], [r * 1.12, y + 0.26], [r, y + 0.3], [r * 0.86, y + h - 0.32], [r * 1.0, y + h - 0.26], [r * 1.2, y + h - 0.18]], x, 0, z, { seg });
  k.box(c, r * 2.8, 0.18, r * 2.8, x, y + h - 0.09, z);
}
/** Club crest: brass-framed green shield with crossed clubs, facing +Z at local origin (centre). */
function crest(k: Kit, s = 1): void {
  const shield = (sc: number): V2[] => {
    const pts: V2[] = [[-0.45 * sc, 0.5 * sc], [0.45 * sc, 0.5 * sc], [0.45 * sc, 0.05 * sc]];
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      pts.push([0.45 * sc * Math.cos((t * PI) / 2), 0.05 * sc - 0.55 * sc * Math.sin((t * PI) / 2)]);
    }
    pts.push([0, -0.5 * sc]);
    for (let i = 5; i >= 1; i--) {
      const t = i / 6;
      pts.push([-0.45 * sc * Math.cos((t * PI) / 2), 0.05 * sc - 0.55 * sc * Math.sin((t * PI) / 2)]);
    }
    pts.push([-0.45 * sc, 0.05 * sc]);
    return pts;
  };
  k.extZ(C.brass, shield(1.12 * s), 0, 0.05, { mat: 'metal' });
  k.extZ(C.green, shield(1.0 * s), 0.05, 0.08);
  k.box(C.brass, 0.05 * s, 0.75 * s, 0.02, 0, 0.0, 0.09, { rz: 0.6, mat: 'metal' });
  k.box(C.brass, 0.05 * s, 0.75 * s, 0.02, 0, 0.0, 0.09, { rz: -0.6, mat: 'metal' });
  k.ball(C.white, 0.09 * s, 0, -0.26 * s, 0.1, { detail: 0, smooth: true, sz: 0.5 });
  k.box(C.cream, 0.7 * s, 0.07 * s, 0.02, 0, 0.36 * s, 0.09);
}
/** Wall lantern (bracket + glowing box) facing +Z. */
function wallLamp(k: Kit, x: number, y: number, z: number): void {
  k.box(C.iron, 0.12, 0.2, 0.04, x, y, z + 0.02);
  k.tube(C.iron, [x, y, z + 0.03], [x, y + 0.05, z + 0.22], 0.015, { seg: 3 });
  k.box(C.glow, 0.16, 0.22, 0.16, x, y - 0.08, z + 0.24, { mat: 'glow' });
  k.lathe(C.iron, [[0.13, y + 0.03], [0, y + 0.13]], x, 0, z + 0.24, { seg: 4, phase: PI / 4 });
}
/** Dormer facing +Z (front face at local z=0, sits on slope); w wide, h tall walls. */
function dormer(k: Kit, w: number, h: number, depth: number, wall: Col, roof: Col, trim: Col = C.trim): void {
  k.boxb(wall, w, h, depth, 0, 0, -depth / 2, { nb: true });
  k.at(0, 0, 0, 0, () => liteWin(k, w * 0.55, h * 0.6, { frame: trim, sill: null, mull: true }));
  k.push(0, 0, -depth / 2 + 0.1, PI / 2);
  gableRoof(k, depth + 0.2, w, h, w * 0.45, { roof, wall, trim: null, over: 0.15, overX: 0.0, t: 0.1 });
  k.box(trim, 0.05, 0.08, 0.05, 0, h + w * 0.45, 0.12);
  k.pop();
}
/** Flat roof deck with a parapet ring on top of block b at height y. */
function flatRoof(k: Kit, b: Box2, y: number, ph: number, parapet: Col, deck: Col, t = 0.25): void {
  const cx = bcx(b);
  const cz = bcz(b);
  const W = bw(b) + 0.2;
  const D = bd(b) + 0.2;
  k.boxb(deck, W - 0.1, 0.12, D - 0.1, cx, y, cz, { nb: true });
  k.boxb(parapet, W, ph, t, cx, y, cz + D / 2 - t / 2, { nb: true });
  k.boxb(parapet, W, ph, t, cx, y, cz - D / 2 + t / 2, { nb: true });
  k.boxb(parapet, t, ph, D - 2 * t, cx + W / 2 - t / 2, y, cz, { nb: true });
  k.boxb(parapet, t, ph, D - 2 * t, cx - W / 2 + t / 2, y, cz, { nb: true });
}
/** Interior "room": inward-facing walls + ceiling, so openings show a lit interior instead of the sky. */
function room(k: Kit, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: Col): void {
  const g: PO = { grad: [0.55, 1.0] };
  k.quad(c, [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], { ...g, up: [0, 0, 1] });
  k.quad(c, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], { ...g, up: [1, 0, 0] });
  k.quad(c, [x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], { ...g, up: [-1, 0, 0] });
  k.quad(shade(c, 0.7), [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], { up: [0, -1, 0] });
  k.quad(c, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], { ...g, up: [0, 0, -1] });
}
/** Low clipped shrub row along X. */
function shrubRow(k: Kit, x0: number, x1: number, z: number, r = 0.42, c: Col = 0x3a7a2e): void {
  const n = Math.max(1, Math.round((x1 - x0) / (r * 1.6)));
  for (let i = 0; i < n; i++) blob(k, k.jc(c, 0.1), r, x0 + ((i + 0.5) * (x1 - x0)) / n, r * 0.7, z, { detail: 0, jit: 0.12 });
}

// ================================================================================================
// CLUBHOUSES
// ================================================================================================
def('clubhouse', (k) => {
  const wall = C.cream;
  const trim = C.trim;
  const roof = 0x24563a;
  const F = 0.5;
  const H = 3.8;
  const main: Box2 = { x0: -9.5, x1: 9.5, z0: -6.5, z1: 2.5 };
  const proj: Box2 = { x0: -3.5, x1: 3.5, z0: 1.0, z1: 4.5 };
  // forecourt path
  k.tbox(C.stone, 3.6, 0.05, 1.4, 0, 0, 9.35, 0.02);
  block(k, main, F, H, wall, { plinth: C.stone, quoin: trim });
  block(k, proj, F, H, wall, { plinth: C.stone, quoin: trim });
  k.boxb(trim, bw(main) + 0.1, 0.2, bd(main) + 0.1, 0, F + H - 0.2, bcz(main));
  // porch deck + steps
  k.tbox(C.stone, 7.6, F, 3.3, 0, 0, 6.1, 0.04);
  for (let i = 0; i < 3; i++) k.tbox(C.stoneL, 4.4, F - (i + 1) * 0.125, 0.42, 0, 0, 7.75 + i * 0.4, 0.02);
  for (const x of [-3.25, -2.45, 2.45, 3.25]) column(k, x, F, 7.3, 3.6, trim, 0.17);
  k.box(trim, 7.4, 0.32, 0.5, 0, F + 3.6 + 0.16, 7.35);
  for (const s of [-1, 1]) railing(k, [s * 3.5, 4.6], [s * 3.5, 7.1], F, 0.9, { col: trim, baluster: 0.22, post: 3 });
  // front door + lamps + crest
  onWall(k, proj, 'f', 0, F, () => {
    door(k, 1.8, 2.6, { col: C.green, double: true, glazed: true, fan: true });
    wallLamp(k, -1.45, 2.2, 0);
    wallLamp(k, 1.45, 2.2, 0);
    liteWin(k, 0.6, 1.8, { frame: trim, mull: true });
  });
  for (const x of [-2.45, 2.45]) onWall(k, proj, 'f', x, F + 0.8, () => win(k, 0.6, 1.9, { frame: trim, cols: 1, rows: 3 }));
  // roofs
  k.at(0, 0, bcz(main), 0, () => gableRoof(k, bw(main), bd(main), F + H, 3.0, { roof, wall, trim, over: 0.6, overX: 0.5, ridge: shade(roof, 0.8), courses: 6 }));
  k.at(0, 0, 4.3, PI / 2, () => gableRoof(k, 6.6, 7.0, F + H, 2.4, { roof, wall, trim, over: 0.45, overX: 0.35, ridge: shade(roof, 0.8), courses: 4 }));
  k.at(0, F + H + 1.05, 7.62, 0, () => crest(k, 0.95));
  // gable-end vents
  for (const s of [-1, 1]) k.lathe([trim, 0x6d6a62], [[0.42, 0], [0.42, 0.06], [0, 0.06]], s * 9.52, F + H + 1.2, bcz(main), { seg: 12, rz: (-s * PI) / 2 });
  // windows
  const petals = [0xd8322e, 0xf6f1ea, 0xe77fa8, 0xf3c632];
  for (const x of [-8.3, -6.4, -4.8, 4.8, 6.4, 8.3])
    onWall(k, main, 'f', x, F + 0.9, () => win(k, 1.1, 1.8, { frame: trim, cols: 2, rows: 3, shutters: C.green, box: petals }));
  for (const s of [-1, 1]) onWall(k, proj, s > 0 ? 'r' : 'l', 3.3, F + 0.9, () => win(k, 0.7, 1.8, { frame: trim, cols: 1, rows: 3 }));
  for (const z of [-4.6, -1.9, 0.7]) {
    onWall(k, main, 'r', z, F + 0.9, () => win(k, 1.1, 1.8, { frame: trim, cols: 2, rows: 3, shutters: C.green }));
    onWall(k, main, 'l', z, F + 0.9, () => win(k, 1.1, 1.8, { frame: trim, cols: 2, rows: 3, shutters: C.green }));
  }
  for (const x of [-7.2, -3.6, 3.6, 7.2]) onWall(k, main, 'b', x, F + 0.9, () => liteWin(k, 1.1, 1.8, { frame: trim, mull: true }));
  onWall(k, main, 'b', 0, F, () => door(k, 1.0, 2.3, { col: C.green }));
  chimney(k, 6.2, 5.6, -4.2, 3.0);
  chimney(k, -6.8, 5.6, -4.2, 3.0);
  // planting
  for (const s of [-1, 1]) {
    shrubRow(k, s * 4.0, s * 9.3, 3.05, 0.38);
    flowerClump(k, s * 2.9, 0, 8.4, 0.55, petals, 4);
    vicLamp(k, s * 2.4, 9.4, 3.4);
  }
  k.at(10.9, 0, -0.5, -PI / 2, () => parkBench(k, 1.6));
  k.at(-10.9, 0, -0.5, PI / 2, () => parkBench(k, 1.6));
});

def('clubhouse_2', (k) => {
  const wall = C.cream;
  const trim = C.trim;
  const roof = 0x24563a;
  const F = 0.5;
  const G = 3.6; // ground storey
  const U = 3.2; // upper storey
  const main: Box2 = { x0: -7, x1: 7, z0: -6.8, z1: 2.4 };
  const wings: Box2[] = [{ x0: -11.6, x1: -7, z0: -5.6, z1: 1.4 }, { x0: 7, x1: 11.6, z0: -5.6, z1: 1.4 }];
  block(k, main, F, G + U, wall, { plinth: C.stone, quoin: trim, band: trim, bandY: [F + G - 0.1] });
  k.boxb(trim, bw(main) + 0.12, 0.22, bd(main) + 0.12, 0, F + G + U - 0.22, bcz(main));
  k.at(0, 0, bcz(main), 0, () => hipRoof(k, bw(main), bd(main), F + G + U, 3.4, { roof, over: 0.55, trim }));
  for (const w of wings) {
    block(k, w, F, G, wall, { plinth: C.stone, quoin: trim });
    k.boxb(trim, bw(w) + 0.1, 0.2, bd(w) + 0.1, bcx(w), F + G - 0.2, bcz(w));
    k.at(bcx(w), 0, bcz(w), 0, () => hipRoof(k, bw(w), bd(w), F + G, 2.3, { roof, over: 0.5, trim }));
    const s = Math.sign(bcx(w));
    for (const x of [bcx(w) - 1.2, bcx(w) + 1.2])
      onWall(k, w, 'f', x, F + 0.85, () => win(k, 1.2, 1.9, { frame: trim, cols: 2, rows: 3, box: [0xd8322e, 0xf6f1ea, 0xe77fa8] }));
    for (const z of [-3.6, -0.8]) onWall(k, w, s > 0 ? 'r' : 'l', z, F + 0.85, () => win(k, 1.2, 1.9, { frame: trim, cols: 2, rows: 3, shutters: C.green }));
    for (const x of [bcx(w) - 1.2, bcx(w) + 1.2]) onWall(k, w, 'b', x, F + 0.85, () => liteWin(k, 1.1, 1.8, { frame: trim, mull: true }));
    chimney(k, bcx(w) + s * 1.2, F + G + 0.6, -3.6, 2.4);
  }
  // porch with balcony terrace on top
  const pz0 = 2.4;
  const pz1 = 6.0;
  k.tbox(C.stone, 7.6, F, pz1 - pz0 + 0.1, 0, 0, (pz0 + pz1) / 2, 0.04);
  for (let i = 0; i < 3; i++) k.tbox(C.stoneL, 4.4, F - (i + 1) * 0.125, 0.42, 0, 0, pz1 + 0.21 + i * 0.4, 0.02);
  for (const x of [-3.4, -1.3, 1.3, 3.4]) column(k, x, F, pz1 - 0.35, G - 0.3, trim, 0.17);
  k.boxb(trim, 7.4, 0.4, pz1 - pz0, 0, F + G - 0.3, (pz0 + pz1) / 2);
  k.boxb(C.stoneL, 7.2, 0.04, pz1 - pz0 - 0.2, 0, F + G + 0.1, (pz0 + pz1) / 2 - 0.05);
  railing(k, [-3.6, pz1 - 0.1], [3.6, pz1 - 0.1], F + G + 0.1, 1.0, { col: trim, baluster: 0.3 });
  for (const s of [-1, 1]) railing(k, [s * 3.6, pz0 + 0.05], [s * 3.6, pz1 - 0.1], F + G + 0.1, 1.0, { col: trim, baluster: 0.3 });
  for (const s of [-1, 1]) planterBox(k, s * 2.6, pz1 - 0.55, 1.1, 0.45, 0.45, C.green, 'flowers');
  k.at(0, F + G + 0.12, 4.2, PI, () => cafeTable(k, 2, null, 0xf4f2ec, C.green));
  // doors & windows on the main block
  onWall(k, main, 'f', 0, F, () => door(k, 1.9, 2.7, { col: C.green, double: true, glazed: true, fan: false }));
  onWall(k, main, 'f', 0, F + G + 0.1, () => {
    door(k, 1.6, 2.3, { col: trim, double: true, glazed: true });
  });
  for (const s of [-1, 1]) {
    onWall(k, main, 'f', s * 2.3, F + 0.85, () => win(k, 0.8, 2.0, { frame: trim, cols: 1, rows: 3 }));
    onWall(k, main, 'f', s * 5.2, F + 0.85, () => win(k, 1.2, 2.0, { frame: trim, cols: 2, rows: 3, shutters: C.green, box: [0xd8322e, 0xf6f1ea] }));
    onWall(k, main, 'f', s * 2.3, F + G + 0.6, () => win(k, 0.9, 1.6, { frame: trim, cols: 2, rows: 2 }));
    onWall(k, main, 'f', s * 5.2, F + G + 0.6, () => win(k, 1.2, 1.6, { frame: trim, cols: 2, rows: 2, shutters: C.green }));
    for (const z of [-5.0, -2.2]) onWall(k, main, s > 0 ? 'r' : 'l', z, F + G + 0.6, () => liteWin(k, 1.1, 1.6, { frame: trim, mull: true }));
    wallLamp(k, s * 1.4, F + 2.3, 2.4);
  }
  for (const x of [-5.2, -2.6, 0, 2.6, 5.2]) {
    onWall(k, main, 'b', x, F + 0.85, () => liteWin(k, 1.1, 1.9, { frame: trim, mull: true }));
    onWall(k, main, 'b', x, F + G + 0.6, () => liteWin(k, 1.1, 1.6, { frame: trim, mull: true }));
  }
  // dormers on the front roof slope
  // roof surface: eave (z = z1 + over) at ~y0-0.13, ridge at y0 + rise over (d/2 + over)
  const eaveZ = main.z1 + 0.55;
  const rs = (3.4 + 0.13) / (bd(main) / 2 + 0.55);
  for (const x of [-4.2, 0, 4.2]) {
    const zf = 1.35;
    const y = F + G + U - 0.13 + (eaveZ - zf) * rs - 0.15;
    k.at(x, y, zf, 0, () => dormer(k, 1.5, 1.4, 2.2, wall, roof, trim));
  }
  chimney(k, -3.0, F + G + U + 1.5, -4.2, 2.6);
  chimney(k, 3.0, F + G + U + 1.5, -4.2, 2.6);
  k.at(0, F + G + U + 0.35, 2.48, 0, () => crest(k, 0.9));
  // grounds
  k.tbox(C.stone, 3.6, 0.05, 2.0, 0, 0, 8.6, 0.02);
  for (const s of [-1, 1]) {
    shrubRow(k, s * 4.2, s * 6.8, 2.95, 0.36);
    shrubRow(k, s * 7.4, s * 11.4, 1.95, 0.36);
    vicLamp(k, s * 2.4, 8.8, 3.4);
    flowerClump(k, s * 3.2, 0, 7.6, 0.6, [0xd8322e, 0xf6f1ea, 0xe77fa8], 4);
  }
});

def('clubhouse_3', (k) => {
  const wall = 0xf0e6cf;
  const trim = C.trim;
  const roof = 0x48505c;
  const F = 0.6;
  const S = 3.3;
  const centre: Box2 = { x0: -6, x1: 6, z0: -7.6, z1: 1.2 };
  const wings: Box2[] = [{ x0: -11.7, x1: -6, z0: -6.8, z1: 0.4 }, { x0: 6, x1: 11.7, z0: -6.8, z1: 0.4 }];
  const cH = S * 3;
  const wH = S * 2;
  k.sec('walls');
  block(k, centre, F, cH, wall, { plinth: C.stone, quoin: C.stoneL, band: C.stoneL, bandY: [F + S - 0.1, F + S * 2 - 0.1] });
  k.boxb(C.stoneL, bw(centre) + 0.3, 0.3, bd(centre) + 0.3, 0, F + cH - 0.3, bcz(centre));
  k.at(0, 0, bcz(centre), 0, () => hipRoof(k, bw(centre), bd(centre), F + cH, 3.2, { roof, over: 0.45, trim: C.stoneL, ridgeFrac: 0.6 }));
  k.sec('wings');
  for (const w of wings) {
    block(k, w, F, wH, wall, { plinth: C.stone, quoin: C.stoneL, band: C.stoneL, bandY: [F + S - 0.1] });
    k.boxb(C.stoneL, bw(w) + 0.26, 0.26, bd(w) + 0.26, bcx(w), F + wH - 0.26, bcz(w));
    k.at(bcx(w), 0, bcz(w), 0, () => hipRoof(k, bw(w), bd(w), F + wH, 2.6, { roof, over: 0.4, trim: C.stoneL }));
    const s = Math.sign(bcx(w));
    for (let f = 0; f < 2; f++) {
      for (const x of [bcx(w) - 1.6, bcx(w), bcx(w) + 1.6]) {
        onWall(k, w, 'f', x, F + f * S + 0.8, () => liteWin(k, 1.0, 1.9, { frame: trim, mull: true, sill: C.stoneL, head: f === 0 ? C.stoneL : undefined }));
        onWall(k, w, 'b', x, F + f * S + 0.8, () => liteWin(k, 1.0, 1.9, { frame: trim, sill: null }));
      }
      for (const z of [-4.4, -1.4]) onWall(k, w, s > 0 ? 'r' : 'l', z, F + f * S + 0.8, () => liteWin(k, 1.0, 1.9, { frame: trim, sill: C.stoneL }));
    }
    // wing dormers
    for (const x of [bcx(w) - 1.4, bcx(w) + 1.4]) k.at(x, F + wH + 0.05, 0.25, 0, () => dormer(k, 1.1, 1.3, 1.8, wall, roof, trim));
    chimney(k, bcx(w) + s * 1.9, F + wH + 0.8, -4.6, 2.4, 0.8, 0.6);
  }
  k.sec('cwin');
  for (let f = 0; f < 3; f++)
    for (const x of [-4.4, -2.2, 0, 2.2, 4.4]) {
      if (f === 0 && x === 0) continue;
      onWall(k, centre, 'f', x, F + f * S + 0.75, () => liteWin(k, 1.1, 2.0, { frame: trim, mull: true, sill: C.stoneL, head: f < 2 ? C.stoneL : undefined }));
      onWall(k, centre, 'b', x, F + f * S + 0.75, () => liteWin(k, 1.1, 2.0, { frame: trim, sill: null }));
    }
  for (let f = 1; f < 3; f++) for (const z of [-5.6, -3.0]) for (const fc of ['l', 'r'] as Face[]) onWall(k, centre, fc, z, F + f * S + 0.75, () => liteWin(k, 1.1, 2.0, { frame: trim, sill: null }));
  onWall(k, centre, 'f', 0, F, () => door(k, 2.0, 2.8, { col: C.green, double: true, glazed: true, fan: true }));
  k.sec('colonnade');
  // colonnade along the front with a terrace on top
  const cz = 4.3;
  k.tbox(C.stone, 23.2, F, cz + 0.4 - 0.2, 0, 0, (cz + 0.4 + 0.2) / 2, 0.04);
  for (let i = 0; i < 4; i++) k.tbox(C.stoneL, 7.0, F - (i + 1) * (F / 5) + 0.0, 0.42, 0, 0, cz + 0.6 + i * 0.4, 0.02);
  k.sec('columns');
  const cols = 9;
  for (let i = 0; i < cols; i++) {
    const x = -10.8 + (i * 21.6) / (cols - 1);
    column(k, x, F, cz, S - 0.35, trim, 0.19, 6);
  }
  k.boxb(C.stoneL, 22.6, 0.45, 1.0, 0, F + S - 0.35, cz);
  k.boxb(C.stoneL, 22.6, 0.12, 4.0, 0, F + S - 0.02, cz - 1.8);
  k.boxb(C.stone, 22.4, 0.3, 3.4, 0, F + S - 0.35, cz - 2.2);
  k.sec('rail');
  railing(k, [-11.2, cz + 0.35], [11.2, cz + 0.35], F + S + 0.1, 0.95, { col: C.stoneL, post: 2.7, panel: C.stoneL });
  for (const s of [-1, 1]) railing(k, [s * 11.2, cz + 0.35], [s * 11.2, 0.6], F + S + 0.1, 0.95, { col: C.stoneL, panel: C.stoneL });
  k.sec('tables');
  for (const x of [-7.6, 7.6]) k.at(x, F + S + 0.1, 2.6, 0, () => cafeTable(k, 2, [C.green, C.cream], 0xf4f2ec, C.green));
  k.sec('pediment');
  // pediment over the central bay
  k.extZ(C.stoneL, [[-4.0, F + cH], [4.0, F + cH], [0, F + cH + 1.9]], 1.0, 1.45);
  k.extZ(wall, [[-3.4, F + cH + 0.2], [3.4, F + cH + 0.2], [0, F + cH + 1.55]], 1.45, 1.5);
  k.at(0, F + cH + 0.8, 1.5, 0, () => crest(k, 0.9));
  k.sec('tower');
  // clock tower + cupola
  const tz = -3.0;
  const tb = F + cH + 1.6;
  k.boxb(wall, 3.0, 3.6, 3.0, 0, tb, tz);
  k.boxb(C.stoneL, 3.3, 0.3, 3.3, 0, tb + 3.6, tz);
  k.boxb(C.stoneL, 3.2, 0.25, 3.2, 0, tb, tz);
  for (const [fx, fz, ry] of [[0, 1, 0], [0, -1, PI], [1, 0, PI / 2], [-1, 0, -PI / 2]] as [number, number, number][]) {
    k.at(fx * 1.5, tb + 1.9, tz + fz * 1.5, ry, () => {
      k.lathe([C.brass, C.white], [[0.9, 0], [0.9, 0.06], [0.78, 0.07], [0, 0.07]], 0, 0, 0, { seg: 12, rx: PI / 2, mat: 'std' });
      k.box(C.black, 0.07, 0.55, 0.02, 0, 0.2, 0.09);
      k.box(C.black, 0.4, 0.07, 0.02, 0.15, 0, 0.1, { rz: 0.3 });
    });
  }
  const cb = tb + 3.9;
  k.lathe(C.stoneL, [[1.25, cb], [1.25, cb + 0.2], [1.1, cb + 0.25]], 0, 0, tz, { seg: 8, phase: PI / 8 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + PI / 8;
    k.cyl(trim, 0.09, 1.6, Math.sin(a) * 0.95, cb + 0.25, tz + Math.cos(a) * 0.95, { seg: 4, caps: 'none' });
  }
  k.cyl(0x2f3a33, 0.75, 1.6, 0, cb + 0.25, tz, { seg: 8, phase: PI / 8 });
  k.lathe(trim, [[1.25, cb + 1.85], [1.25, cb + 2.05], [0, cb + 2.05]], 0, 0, tz, { seg: 8, phase: PI / 8 });
  k.lathe([0x5f8f7c, 0x5f8f7c, 0x5f8f7c, 0x5f8f7c], [[1.15, cb + 2.05], [1.0, cb + 2.6], [0.6, cb + 3.1], [0.15, cb + 3.4], [0, cb + 3.5]], 0, 0, tz, { seg: 8, phase: PI / 8, mat: 'metal' });
  k.cyl(C.brass, 0.03, 1.1, 0, cb + 3.45, tz, { seg: 4, mat: 'metal' });
  k.ball(C.brass, 0.1, 0, cb + 3.9, tz, { detail: 0, mat: 'metal' });
  k.box(C.brass, 0.9, 0.04, 0.04, 0, cb + 4.3, tz, { mat: 'metal' });
  k.hull(C.brass, [[0.45, 0, -0.1], [0.45, 0, 0.1], [0.65, 0, 0], [0.45, 0.04, 0]], 0, cb + 4.28, tz, { mat: 'metal' });
  k.sec('dormers');
  // dormers on the central roof
  for (const x of [-3.2, 3.2]) k.at(x, F + cH + 0.2, 0.9, 0, () => dormer(k, 1.3, 1.5, 2.0, wall, roof, trim));
  chimney(k, -4.4, F + cH + 1.2, -5.6, 2.4, 0.8, 0.6);
  chimney(k, 4.4, F + cH + 1.2, -5.6, 2.4, 0.8, 0.6);
  k.sec('flags');
  // flagpoles + grounds
  for (const [x, fc] of [[-9.4, [C.green, C.cream, C.green]], [9.4, [C.navy, C.white, C.red]], [0, [C.green, C.brass]]] as [number, Col[]][]) {
    const z = x === 0 ? 9.0 : 8.6;
    k.lathe([C.stone, C.stoneL], [[0.42, 0], [0.42, 0.25], [0.15, 0.32]], x, 0, z, { seg: 8 });
    k.lathe(C.white, [[0.06, 0.3], [0.035, 7.4], [0, 7.4]], x, 0, z, { seg: 6 });
    k.ball(C.brass, 0.08, x, 7.46, z, { detail: 0, mat: 'metal' });
    k.flag(fc, 1.5, 1.0, x + 0.03, 6.25, z, 5, { mat: flagMat(x) });
  }
  k.sec('grounds');
  k.tbox(C.stone, 7.0, 0.05, 2.6, 0, 0, 8.4, 0.02);
  for (const s of [-1, 1]) {
    shrubRow(k, s * 4.0, s * 11.2, 5.3, 0.65);
    vicLamp(k, s * 3.0, 8.0, 3.6);
    k.boxb(C.stoneL, 2.4, 0.3, 0.9, s * 5.2, 0, 8.5, { nb: true });
    flowerClump(k, s * 4.7, 0.28, 8.5, 0.45, [0xd8322e, 0xf6f1ea, 0xf3c632], 4);
    flowerClump(k, s * 5.7, 0.28, 8.5, 0.45, [0xd8322e, 0xf6f1ea, 0xf3c632], 4);
  }
});

// ================================================================================================
// SHOPS / FOOD / FACILITIES
// ================================================================================================
/** Boutique pro shop spanning x0..x1 (front at z=2.4). */
function proShopBody(k: Kit, x0: number, x1: number): void {
  const wall = C.cream;
  const fac = C.green;
  const b: Box2 = { x0, x1, z0: -4.6, z1: 2.4 };
  const W = x1 - x0;
  const cx = (x0 + x1) / 2;
  const P = 0.15;
  const H = 4.3;
  k.sec('body');
  k.tbox(C.stone, W + 0.4, 0.05, 3.3, cx, 0, 4.1, 0.02);
  block(k, b, P, H, wall, { plinth: C.stoneD });
  // parapet + flat roof
  flatRoof(k, b, P + H, 0.45, C.trim, 0xa8a398);
  {
    const RW = W + 0.26;
    const RD = bd(b) + 0.26;
    const cz = bcz(b);
    k.boxb(fac, RW, 0.1, 0.3, cx, P + H + 0.43, cz + RD / 2 - 0.15, { nb: true });
    k.boxb(fac, RW, 0.1, 0.3, cx, P + H + 0.43, cz - RD / 2 + 0.15, { nb: true });
    k.boxb(fac, 0.3, 0.1, RD - 0.6, cx + RW / 2 - 0.15, P + H + 0.43, cz, { nb: true });
    k.boxb(fac, 0.3, 0.1, RD - 0.6, cx - RW / 2 + 0.15, P + H + 0.43, cz, { nb: true });
  }
  k.cbox(C.steel, 1.4, 0.7, 1.0, cx - W * 0.28, P + H + 0.45, -3.4, 0.05, { mat: 'metal' });
  k.cyl(0x3a3d40, 0.32, 0.03, cx - W * 0.28, P + H + 0.8, -3.4, { seg: 10, caps: 'top' });
  k.cyl(C.steelD, 0.08, 0.6, cx + W * 0.32, P + H + 0.1, -3.6, { seg: 6, mat: 'metal' });
  // glazed roof lantern over the shop floor
  const lw = Math.min(3.6, W * 0.45);
  k.tbox(C.trim, lw + 0.3, 0.35, 2.4, cx + 0.2, P + H + 0.1, -0.9, 0.03);
  k.hull(C.glass, [[-lw / 2, 0, -1.05], [lw / 2, 0, -1.05], [-lw / 2, 0, 1.05], [lw / 2, 0, 1.05], [-lw / 2 + 0.6, 0.75, 0], [lw / 2 - 0.6, 0.75, 0]], cx + 0.2, P + H + 0.45, -0.9, { mat: 'glass' });
  for (let i = 0; i <= 4; i++) {
    const x = cx + 0.2 - lw / 2 + 0.6 + (i * (lw - 1.2)) / 4;
    for (const sd of [-1, 1]) k.tube(fac, [x, P + H + 0.47, -0.9 + sd * 1.05], [x, P + H + 1.21, -0.9], 0.03, { seg: 3 });
  }
  k.box(fac, lw - 1.1, 0.06, 0.08, cx + 0.2, P + H + 1.22, -0.9);
  // shopfront
  k.sec('front');
  const fz = b.z1;
  const dw = 1.3;
  for (const px of [x0 + 0.15, cx - dw / 2 - 0.15, cx + dw / 2 + 0.15, x1 - 0.15]) k.boxb(fac, 0.3, 3.3, 0.16, px, P, fz + 0.06, { nb: true });
  k.boxb(fac, W + 0.1, 0.95, 0.24, cx, P + 3.25, fz + 0.08);
  k.box(C.brass, W - 0.3, 0.04, 0.02, cx, P + 3.35, fz + 0.21, { mat: 'metal' });
  k.box(C.brass, W - 0.3, 0.04, 0.02, cx, P + 4.1, fz + 0.21, { mat: 'metal' });
  // painted lettering blocks
  const letters = Math.floor((W - 2.2) / 0.42);
  for (let i = 0; i < letters; i++) {
    if (i === Math.floor(letters / 2)) continue;
    k.box(C.cream, 0.26, 0.36, 0.02, cx - ((letters - 1) / 2) * 0.42 + i * 0.42, P + 3.72, fz + 0.21);
  }
  k.at(cx, P + 3.72, fz + 0.2, 0, () => crest(k, 0.6));
  for (const s of [-1, 1]) {
    const wx0 = s < 0 ? x0 + 0.3 : cx + dw / 2 + 0.3;
    const wx1 = s < 0 ? cx - dw / 2 - 0.3 : x1 - 0.3;
    const ww = wx1 - wx0;
    const wcx = (wx0 + wx1) / 2;
    k.boxb(fac, ww, 0.6, 0.12, wcx, P, fz + 0.06);
    k.box(C.cream, ww, 0.05, 0.14, wcx, P + 0.62, fz + 0.07);
    k.quad(C.glass, [wx0, P + 0.65, fz + 0.03], [wx1, P + 0.65, fz + 0.03], [wx1, P + 3.2, fz + 0.03], [wx0, P + 3.2, fz + 0.03], { mat: 'glass', up: [0, 0, 1] });
    k.box(fac, ww, 0.06, 0.08, wcx, P + 2.55, fz + 0.05);
    k.box(fac, 0.06, 2.55, 0.08, wcx, P + 1.92, fz + 0.05, { nb: true });
    k.at(wcx, 0, fz + 0.12, 0, () => awning(k, ww + 0.2, P + 3.2, 1.25, 0.65, C.green, C.cream, 7));
  }
  k.at(cx, P, fz + 0.02, 0, () => door(k, dw - 0.1, 2.5, { col: fac, glazed: true, frame: fac }));
  k.quad(C.glass, [cx - 0.55, P + 2.7, fz + 0.05], [cx + 0.55, P + 2.7, fz + 0.05], [cx + 0.55, P + 3.15, fz + 0.05], [cx - 0.55, P + 3.15, fz + 0.05], { mat: 'glass', up: [0, 0, 1] });
  for (const s of [-1, 1]) {
    k.sec('pots');
    k.lathe([0x3b3f42, 0x3b3f42], [[0.22, 0], [0.28, 0.5], [0.24, 0.5]], cx + s * (dw / 2 + 0.55), 0.05, fz + 0.55, { seg: 8 });
    k.cyl(C.bark, 0.03, 0.5, cx + s * (dw / 2 + 0.55), 0.5, fz + 0.55, { seg: 4, caps: 'none' });
    blob(k, 0x2f6a2d, 0.36, cx + s * (dw / 2 + 0.55), 1.2, fz + 0.55, { detail: 1, jit: 0.08 });
  }
  // side + back windows
  k.sec('sides');
  for (const z of [-3.0, -0.6]) {
    onWall(k, b, 'l', z, P + 1.0, () => liteWin(k, 1.2, 1.8, { frame: C.trim, mull: true }));
    onWall(k, b, 'r', z, P + 1.0, () => liteWin(k, 1.2, 1.8, { frame: C.trim, mull: true }));
  }
  onWall(k, b, 'b', cx + 1.5, P, () => door(k, 1.0, 2.2, { col: C.charcoal }));
}
function bagRack(k: Kit, x: number, z: number, n: number, cols: Col[]): void {
  k.push(x, 0, z, 0);
  const L = n * 0.42 + 0.2;
  for (const s of [-1, 1]) {
    k.box(C.timberD, 0.06, 0.9, 0.06, s * (L / 2), 0.45, -0.2, { nb: true });
    k.box(C.timberD, 0.06, 0.06, 0.6, s * (L / 2), 0.08, -0.05);
  }
  k.box(C.timber, L + 0.06, 0.07, 0.08, 0, 0.85, -0.2);
  k.box(C.timber, L + 0.06, 0.07, 0.08, 0, 0.12, 0.2);
  for (let i = 0; i < n; i++) golfBag(k, -L / 2 + 0.31 + i * 0.42, 0.1, 0, -0.22, cols[i % cols.length], i % 2 ? C.cream : C.white);
  k.pop();
}

def('pro_shop', (k) => {
  proShopBody(k, -4.7, 4.7);
  k.sec('extras');
  bagRack(k, 3.2, 4.4, 4, [C.navy, C.red, C.green, 0x2f2f33]);
  // A-board
  k.box(C.green, 0.6, 0.85, 0.04, -3.3, 0.42, 4.3, { rx: 0.2 });
  k.box(C.green, 0.6, 0.85, 0.04, -3.3, 0.42, 4.6, { rx: -0.2 });
  for (let i = 0; i < 3; i++) k.box(C.cream, 0.42, 0.04, 0.01, -3.3, 0.62 - i * 0.14, 4.21 + i * 0.03, { rx: 0.2 });
  k.at(-1.8, 0.05, 5.0, PI, () => parkBench(k, 1.5));
});

def('pro_shop_2', (k) => {
  proShopBody(k, -5.8, 1.8);
  k.sec('annex');
  // fitting studio annex
  const a: Box2 = { x0: 1.8, x1: 5.8, z0: -4.6, z1: 0.2 };
  block(k, a, 0.15, 3.5, 0x4d3a2a, { plinth: C.stoneD });
  for (let i = 0; i < 9; i++) k.box(0x5e4834, 0.05, 3.4, 0.03, a.x0 + 0.25 + i * 0.44, 1.9, a.z0 - 0.015, { nb: true });
  k.boxb(C.charcoal, 4.3, 0.25, 5.1, 3.8, 3.65, -2.2);
  k.quad(C.glass, [2.1, 0.4, 0.22], [5.5, 0.4, 0.22], [5.5, 3.2, 0.22], [2.1, 3.2, 0.22], { mat: 'glass', up: [0, 0, 1] });
  for (const x of [2.1, 3.25, 4.4, 5.5]) k.box(C.charcoal, 0.07, 2.8, 0.06, x, 1.8, 0.24, { nb: true });
  k.box(C.charcoal, 3.5, 0.08, 0.06, 3.8, 3.2, 0.24);
  k.box(C.brass, 2.6, 0.12, 0.03, 3.8, 3.5, 0.33, { mat: 'metal' });
  // hitting net cage
  k.sec('net');
  const nx0 = 2.2;
  const nx1 = 5.7;
  const nz0 = 0.6;
  const nz1 = 5.6;
  const NH = 3.0;
  const pc = 0x26292c;
  for (const x of [nx0, nx1]) for (const z of [nz0, nz1]) k.boxb(pc, 0.08, NH, 0.08, x, 0, z, { mat: 'metal', nb: true });
  for (const z of [nz0, nz1]) k.box(pc, nx1 - nx0, 0.06, 0.06, (nx0 + nx1) / 2, NH, z, { mat: 'metal' });
  for (const x of [nx0, nx1]) k.box(pc, 0.06, 0.06, nz1 - nz0, x, NH, (nz0 + nz1) / 2, { mat: 'metal' });
  const net = 0x2c3330;
  for (let i = 1; i < 7; i++) {
    const x = nx0 + ((nx1 - nx0) * i) / 7;
    k.box(net, 0.015, NH, 0.015, x, NH / 2, nz0, { nb: true });
    k.box(net, 0.015, 0.015, nz1 - nz0, x, NH, (nz0 + nz1) / 2);
  }
  for (let j = 1; j < 6; j++) {
    const y = (NH * j) / 6;
    k.box(net, nx1 - nx0, 0.015, 0.015, (nx0 + nx1) / 2, y, nz0);
    for (const x of [nx0, nx1]) k.box(net, 0.015, 0.015, nz1 - nz0, x, y, (nz0 + nz1) / 2);
  }
  for (let i = 1; i < 9; i++) {
    const z = nz0 + ((nz1 - nz0) * i) / 9;
    for (const x of [nx0, nx1]) k.box(net, 0.015, NH, 0.015, x, NH / 2, z, { nb: true });
    k.box(net, nx1 - nx0, 0.015, 0.015, (nx0 + nx1) / 2, NH, z);
  }
  // target sheet + mat + monitor
  k.box(C.white, 1.6, 1.4, 0.02, (nx0 + nx1) / 2, 1.5, nz0 + 0.1);
  k.lathe([C.red, C.white, C.red], [[0.5, 0], [0.42, 0], [0.26, 0], [0.18, 0], [0, 0]].map(([r]) => [r, 0] as V2), 0, 0, 0, { seg: 3 });
  k.at((nx0 + nx1) / 2, 1.5, nz0 + 0.115, 0, () => {
    k.lathe(C.red, [[0.5, 0], [0.4, 0.001]], 0, 0, 0, { seg: 16, rx: PI / 2 });
    k.lathe(C.red, [[0.2, 0], [0, 0.001]], 0, 0, 0, { seg: 12, rx: PI / 2 });
  });
  k.tbox(0x2b3a2e, 1.6, 0.03, 1.6, (nx0 + nx1) / 2, 0, 3.6, 0.01);
  k.box(C.turf, 1.4, 0.02, 1.4, (nx0 + nx1) / 2, 0.035, 3.6, { nb: true });
  k.cbox(C.charcoal, 0.25, 0.15, 0.12, (nx0 + nx1) / 2 + 0.2, 0.13, 2.4, 0.02);
  k.sec('extras');
  bagRack(k, -3.4, 4.6, 3, [C.navy, C.red, C.green]);
});

function cafeBody(k: Kit): Box2 {
  const brick = 0xa9583c;
  const trim = C.cream;
  const b: Box2 = { x0: -4.6, x1: 4.6, z0: -5.4, z1: 0.8 };
  const P = 0.2;
  const H = 3.3;
  k.sec('body');
  block(k, b, P, H, brick, { plinth: C.stone, quoin: trim });
  k.boxb(trim, bw(b) + 0.1, 0.18, bd(b) + 0.1, 0, P + H - 0.18, bcz(b));
  k.at(0, 0, bcz(b), 0, () => gableRoof(k, bw(b), bd(b), P + H, 2.4, { roof: C.slate, wall: 0xe4d3ad, trim, over: 0.55, overX: 0.45, ridge: C.slateD, courses: 5 }));
  chimney(k, 3.4, 4.2, -3.6, 2.3);
  const roofAt = (z: number): number => P + H + (1 - Math.abs(z - bcz(b)) / (bd(b) / 2)) * 2.4;
  k.at(-2.0, roofAt(-0.2) - 0.55, -0.15, 0, () => dormer(k, 1.4, 1.3, 2.0, 0xe4d3ad, C.slate, trim));
  k.sec('front');
  const fz = b.z1;
  for (const s of [-1, 1]) {
    onWall(k, b, 'f', s * 2.55, P + 0.75, () => win(k, 2.3, 1.85, { frame: trim, cols: 3, rows: 2, sill: trim }));
  }
  onWall(k, b, 'f', 0, P, () => door(k, 1.1, 2.4, { col: C.green, glazed: true, frame: trim }));
  k.at(0, 0, fz + 0.04, 0, () => awning(k, 8.6, P + 3.1, 1.6, 0.6, 0xb8352c, C.cream, 13));
  // corner bracket sign with coffee cup
  k.tube(C.iron, [4.6, 2.9, fz - 0.4], [5.4, 2.9, fz - 0.4], 0.025, { seg: 4 });
  k.at(5.15, 2.45, fz - 0.4, PI / 2, () => {
    k.lathe([C.brass, C.green], [[0.42, -0.03], [0.42, 0.03], [0, 0.03]], 0, 0, 0, { seg: 12, rx: PI / 2 });
    k.lathe([C.brass, C.green], [[0.42, 0.03], [0.42, -0.03], [0, -0.03]], 0, 0, 0, { seg: 12, rx: -PI / 2 });
    for (const sd of [-1, 1]) {
      k.box(C.cream, 0.28, 0.24, 0.02, 0, -0.04, sd * 0.045);
      k.box(C.cream, 0.36, 0.03, 0.02, 0, -0.18, sd * 0.045);
    }
  });
  // side + back windows
  k.sec('sides');
  for (const z of [-3.6, -1.4]) {
    onWall(k, b, 'l', z, P + 0.9, () => liteWin(k, 1.0, 1.5, { frame: trim, mull: true }));
    onWall(k, b, 'r', z, P + 0.9, () => liteWin(k, 1.0, 1.5, { frame: trim, mull: true }));
  }
  for (const x of [-2.6, 2.6]) onWall(k, b, 'b', x, P + 0.9, () => liteWin(k, 1.0, 1.4, { frame: trim, mull: true }));
  onWall(k, b, 'b', 0, P, () => door(k, 0.95, 2.2, { col: C.charcoal, frame: trim }));
  return b;
}
function chalkBoard(k: Kit, x: number, z: number, ry: number): void {
  k.push(x, 0, z, ry);
  for (const s of [-1, 1]) {
    k.box(C.timber, 0.62, 0.92, 0.04, 0, 0.44, s * 0.16, { rx: -s * 0.2 });
    k.box(0x2a2e2b, 0.5, 0.7, 0.01, 0, 0.47, s * 0.185, { rx: -s * 0.2 });
    for (let i = 0; i < 3; i++) k.box(C.white, 0.34 - i * 0.06, 0.025, 0.005, 0, 0.66 - i * 0.14, s * (0.193 - i * 0.027), { rx: -s * 0.2 });
  }
  k.pop();
}

def('cafe', (k) => {
  cafeBody(k);
  k.sec('terrace');
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 3; j++) k.tbox(k.jc(C.stone, 0.05), 2.28, 0.05, 1.68, -3.42 + i * 2.28, 0, 1.75 + j * 1.7, 0.015);
  for (const [x, z] of [[-2.6, 3.7], [2.6, 3.7]] as V2[]) k.at(x, 0.05, z, 0, () => cafeTable(k, 3, [0xb8352c, C.cream]));
  chalkBoard(k, 0.0, 4.6, 0.3);
  for (const s of [-1, 1]) {
    k.lathe([C.timberD, C.timber, C.timberD], [[0.3, 0], [0.36, 0.25], [0.36, 0.3], [0.3, 0.5]], s * 4.9, 0, 5.5, { seg: 8 });
    flowerClump(k, s * 4.9, 0.45, 5.5, 0.38, [0xd8322e, 0xf6f1ea, 0xf3c632], 4);
  }
  k.at(-4.0, 0.05, 1.4, 0, () => parkBench(k, 1.4));
});

def('cafe_2', (k) => {
  cafeBody(k);
  k.sec('deck');
  const D = 0.35;
  const z0 = 0.8;
  const z1 = 5.3;
  for (let i = 0; i < 10; i++) {
    const z = z0 + 0.225 + i * 0.45;
    k.box(k.jc(i % 2 ? 0xa2734a : 0x96693f, 0.04), 11.6, 0.06, 0.43, 0, D - 0.03, z, { nb: true });
  }
  k.boxb(0x6b4a30, 11.6, D - 0.06, z1 - z0, 0, 0, (z0 + z1) / 2, { nb: true });
  for (let i = 0; i < 2; i++) k.tbox(0x8f6340, 2.2, D - (i + 1) * 0.12, 0.32, 0, 0, z1 + 0.16 + i * 0.3, 0.02);
  const rc = 0x7a5534;
  railing(k, [-5.75, z1 - 0.05], [-1.2, z1 - 0.05], D, 0.9, { col: rc, baluster: 0.35, post: 1.6 });
  railing(k, [1.2, z1 - 0.05], [5.75, z1 - 0.05], D, 0.9, { col: rc, baluster: 0.35, post: 1.6 });
  for (const s of [-1, 1]) railing(k, [s * 5.75, z0 + 0.1], [s * 5.75, z1 - 0.05], D, 0.9, { col: rc, baluster: 0.35, post: 1.6 });
  k.sec('tables');
  const tabs: [number, number, Col][] = [[-3.9, 2.4, 0xb8352c], [-1.4, 4.1, C.green], [1.6, 2.5, 0xb8352c], [4.1, 4.1, C.green]];
  for (const [x, z, c] of tabs) k.at(x, D, z, 0, () => cafeTable(k, 2, [c, C.cream]));
  k.sec('planters');
  for (const s of [-1, 1]) {
    planterBox(k, s * 5.1, 4.7, 0.9, 0.9, 0.55, 0x6b4a30, 'flowers', [0xd8322e, 0xf6f1ea, 0xe77fa8]);
  }
  // festoon lights between tall posts
  k.sec('lights');
  const posts: V3[] = [[-5.75, 0, z1 - 0.05], [5.75, 0, z1 - 0.05]];
  for (const p of posts) k.boxb(rc, 0.1, 3.0, 0.1, p[0], D, p[2]);
  const anchors: V3[] = [[-5.75, D + 2.95, z1 - 0.05], [-4.6, 3.6, 0.85], [0, 3.6, 0.85], [4.6, 3.6, 0.85], [5.75, D + 2.95, z1 - 0.05]];
  for (let i = 0; i < 4; i++) {
    const a = anchors[i % 2 === 0 ? i : i];
    const b2 = anchors[i + 1];
    const pts: V3[] = [];
    for (let j = 0; j <= 6; j++) {
      const t = j / 6;
      pts.push([a[0] + (b2[0] - a[0]) * t, a[1] + (b2[1] - a[1]) * t - Math.sin(t * PI) * 0.35, a[2] + (b2[2] - a[2]) * t]);
    }
    k.tubes(0x2a2a2a, pts, 0.008, { seg: 3 });
    for (let j = 1; j < 6; j++) k.ball(C.glow, 0.05, pts[j][0], pts[j][1] - 0.06, pts[j][2], { kind: 'octa', detail: 0, mat: 'glow' });
  }
  chalkBoard(k, 2.4, 5.65, 0.2);
});

def('toilets', (k) => {
  const b: Box2 = { x0: -3.0, x1: 3.0, z0: -2.3, z1: 1.5 };
  const P = 0.15;
  const H = 2.9;
  k.sec('body');
  k.tbox(C.stone, 5.4, 0.05, 1.8, 0, 0, 2.5, 0.02);
  block(k, b, P, H, C.cream, { plinth: C.stoneD, quoin: C.trim });
  k.boxb(C.brick, bw(b) + 0.04, 1.0, bd(b) + 0.04, 0, P, bcz(b), { nb: true });
  k.boxb(C.stoneL, bw(b) + 0.1, 0.08, bd(b) + 0.1, 0, P + 1.0, bcz(b));
  k.at(0, 0, bcz(b), 0, () => hipRoof(k, bw(b), bd(b), P + H, 1.5, { roof: C.slate, over: 0.45, trim: C.trim }));
  // roof vent cupola
  k.boxb(C.cream, 0.8, 0.6, 0.8, 0, P + H + 1.3, bcz(b));
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    k.box(C.slateD, 0.6, 0.05, 0.03, 0, P + H + 1.45 + i * 0.14, bcz(b) + s * 0.41);
    k.box(C.slateD, 0.03, 0.05, 0.6, s * 0.41, P + H + 1.45 + i * 0.14, bcz(b));
  }
  k.hull(C.slate, [[-0.55, 0, -0.55], [0.55, 0, -0.55], [-0.55, 0, 0.55], [0.55, 0, 0.55], [0, 0.5, 0]], 0, P + H + 1.9, bcz(b));
  k.ball(C.brass, 0.06, 0, P + H + 2.45, bcz(b), { detail: 0, mat: 'metal' });
  k.sec('doors');
  const signs: [number, Col][] = [[-1.35, 0x2f63b8], [1.35, 0xc23a5a]];
  for (const [x, sc] of signs) {
    onWall(k, b, 'f', x, P, () => {
      door(k, 0.95, 2.15, { col: C.green, frame: C.trim });
      k.lathe(sc, [[0.17, 0], [0.17, 0.025], [0, 0.025]], 0, 1.6, 0.03, { seg: 12, rx: PI / 2 });
      k.ball(C.white, 0.035, 0, 1.68, 0.065, { kind: 'octa', detail: 0 });
      if (x < 0) k.box(C.white, 0.09, 0.14, 0.02, 0, 1.55, 0.065);
      else k.extZ(C.white, [[-0.07, 1.47], [0.07, 1.47], [0, 1.64]], 0.055, 0.07);
    });
    wallLamp(k, x + 0.85, P + 2.2, b.z1);
  }
  onWall(k, b, 'f', 0, P + 1.5, () => {
    k.box(0x2f63b8, 0.34, 0.34, 0.03, 0, 0.8, 0.02);
    k.box(C.white, 0.08, 0.16, 0.01, 0, 0.8, 0.04);
  });
  for (const fc of ['l', 'r', 'b'] as Face[])
    for (const u of fc === 'b' ? [-1.5, 1.5] : [-0.4]) onWall(k, b, fc, u, P + 2.0, () => liteWin(k, 1.0, 0.45, { frame: C.trim, sill: null, glass: 0xc8d6de }));
  k.sec('extras');
  shrubRow(k, -2.9, -2.1, 2.0, 0.32);
  shrubRow(k, 2.1, 2.9, 2.0, 0.32);
  k.lathe([C.green, C.green, C.black], [[0, 0], [0.2, 0], [0.22, 0.8], [0.23, 0.86], [0, 0.88]], 3.5, 0, 2.2, { seg: 10 });
  // gutters / downpipes
  for (const s of [-1, 1]) k.tubes(C.steelD, [[s * 3.32, P + H - 0.2, 1.62], [s * 3.08, P + H - 0.55, 1.62], [s * 3.08, 0.1, 1.62]], 0.035, { seg: 4, mat: 'metal' });
});

def('bar', (k) => {
  const timber = 0x4a3324;
  const trim = C.cream;
  const b: Box2 = { x0: -6.6, x1: 6.6, z0: -5.6, z1: 0.4 };
  const P = 0.4;
  const H = 3.2;
  k.sec('body');
  block(k, b, P, H, timber, { plinth: C.stoneD, quoin: 0x2d1f15 });
  for (let i = 1; i < 8; i++) k.box(0x3d2a1d, bw(b) + 0.02, 0.03, 0.03, 0, P + (i * H) / 8, b.z1 + 0.005);
  k.at(0, 0, bcz(b), 0, () => gableRoof(k, bw(b), bd(b), P + H, 2.6, { roof: C.slate, wall: 0xeee3c8, trim: 0x2d1f15, over: 0.5, overX: 0.45, ridge: C.slateD, courses: 5 }));
  chimney(k, -5.2, 4.5, -2.6, 2.4);
  chimney(k, 5.2, 4.5, -2.6, 2.4);
  // front gabled entrance bay (mock tudor gable)
  const e: Box2 = { x0: -5.6, x1: -2.2, z0: 0.0, z1: 1.6 };
  block(k, e, P, H, timber, { plinth: C.stoneD });
  k.at(bcx(e), 0, 0.9, PI / 2, () => gableRoof(k, 2.8, bw(e), P + H, 1.9, { roof: C.slate, wall: 0xeee3c8, trim: 0x2d1f15, over: 0.4, overX: 0.35 }));
  const gx = bcx(e);
  const gz = e.z1 + 0.37;
  k.box(0x2d1f15, 0.12, 1.75, 0.04, gx, P + H + 0.88, gz);
  k.box(0x2d1f15, 3.2, 0.12, 0.04, gx, P + H + 0.05, gz);
  for (const s of [-1, 1]) k.box(0x2d1f15, 0.1, 1.5, 0.04, gx + s * 0.75, P + H + 0.6, gz, { rz: s * 0.65 });
  onWall(k, e, 'f', gx, P, () => {
    door(k, 1.15, 2.3, { col: C.green, frame: trim, glazed: true });
    wallLamp(k, 0, 2.75, 0);
    k.box(C.green, 1.0, 0.36, 0.05, 0, 3.15, 0.02);
    pixelText(k, '19', -0.24, 3.29, 0.05, 0.05, C.brass);
  });
  for (const fc of ['l', 'r'] as Face[]) onWall(k, e, fc, 0.8, P + 1.0, () => liteWin(k, 0.6, 1.2, { frame: trim, glass: 0xd8b878 }));
  // bay windows
  k.sec('bays');
  for (const x of [-0.6, 3.6]) {
    k.tbox(C.stoneD, 2.5, P + 0.7, 0.75, x, 0, b.z1 + 0.37, 0.03);
    k.boxb(timber, 2.4, 1.7, 0.7, x, P + 0.7, b.z1 + 0.35, { nb: true });
    k.quad(0xd8b878, [x - 1.1, P + 0.85, b.z1 + 0.71], [x + 1.1, P + 0.85, b.z1 + 0.71], [x + 1.1, P + 2.25, b.z1 + 0.71], [x - 1.1, P + 2.25, b.z1 + 0.71], { mat: 'glass', up: [0, 0, 1] });
    for (let i = 0; i <= 4; i++) k.box(trim, 0.05, 1.4, 0.03, x - 1.1 + i * 0.55, P + 1.55, b.z1 + 0.72, { nb: true });
    for (let j = 0; j <= 2; j++) k.box(trim, 2.2, 0.05, 0.03, x, P + 0.85 + j * 0.7, b.z1 + 0.72);
    k.hull(C.slateD, [[-1.3, 0, -0.05], [1.3, 0, -0.05], [-1.3, 0, 0.85], [1.3, 0, 0.85], [-1.1, 0.35, -0.05], [1.1, 0.35, -0.05]], x, P + 2.4, b.z1);
  }
  for (const z of [-4.0, -1.6]) for (const fc of ['l', 'r'] as Face[]) onWall(k, b, fc, z, P + 0.9, () => liteWin(k, 0.9, 1.4, { frame: trim, mull: true, glass: 0xd8b878 }));
  for (const x of [-3.5, 0, 3.5]) onWall(k, b, 'b', x, P + 0.9, () => liteWin(k, 0.9, 1.4, { frame: trim, glass: 0xd8b878 }));
  // hanging pub sign on a bracket
  k.sec('sign');
  k.boxb(0x2d1f15, 0.14, 3.6, 0.14, 6.1, 0, 2.2);
  k.box(C.iron, 0.06, 0.06, 1.1, 6.1, 3.4, 2.7);
  k.tube(C.iron, [6.1, 2.8, 2.2], [6.1, 3.38, 2.8], 0.025, { seg: 3 });
  for (const zz of [2.45, 3.05]) k.tube(C.iron, [6.1, 3.37, zz], [6.1, 3.2, zz], 0.01, { seg: 3 });
  k.at(6.1, 2.6, 2.75, PI / 2, () => {
    k.box(C.brass, 0.84, 0.7, 0.07, 0, 0, 0, { mat: 'metal' });
    k.box(C.green, 0.74, 0.6, 0.09, 0, 0, 0);
    pixelText(k, '19', -0.25, 0.18, 0.047, 0.065, C.brass);
    k.push(0, 0, 0, PI);
    pixelText(k, '19', -0.25, 0.18, 0.047, 0.065, C.brass);
    k.pop();
  });
  // beer garden
  k.sec('garden');
  for (let i = 0; i < 3; i++) {
    const x = -4.6 + i * 4.4;
    k.at(x, 0, 3.7, 0, () => picnicTable(k));
    if (i !== 1) {
      k.cyl(C.white, 0.03, 2.2, x, 0.78, 3.7, { seg: 4 });
      k.lathe([C.green, C.green], [[0, 2.85], [1.35, 2.35], [1.3, 2.25]], x, 0, 3.7, { seg: 8, flat: true });
      k.lathe(shade(C.green, 0.7), [[1.3, 2.25], [0, 2.8]], x, 0, 3.7, { seg: 8, flat: true });
    }
  }
  for (const x of [-7.2, -4.4, -1.6, 1.6, 4.4, 7.2]) {
    if (Math.abs(x) < 1) continue;
    k.boxb(C.white, 0.08, 0.9, 0.08, x, 0, 5.85);
  }
  for (const y of [0.3, 0.75]) {
    k.box(C.white, 6.4, 0.08, 0.04, -4.2, y, 5.9);
    k.box(C.white, 6.4, 0.08, 0.04, 4.2, y, 5.9);
  }
  for (let i = 0; i < 2; i++) {
    const x = i ? 1.8 : -1.8;
    k.lathe([0x6b4527, 0x3b3f42, 0x6b4527, 0x3b3f42, 0x6b4527], [[0.3, 0], [0.34, 0.15], [0.36, 0.2], [0.36, 0.7], [0.34, 0.75], [0.3, 0.9]], x, 0, 1.3, { seg: 8 });
    k.cyl(0x6b4527, 0.32, 0.03, x, 0.9, 1.3, { seg: 8 });
  }
  k.tbox(C.gravel, 3.4, 0.04, 1.6, gx, 0, 2.6, 0.02);
});

/** Ride-on fairway mower facing +Z (origin at ground centre). */
function mowerBody(k: Kit): void {
  const g = 0x2f7a3c;
  const y = 0xf0c330;
  // chassis + engine hood
  k.cbox(g, 0.9, 0.35, 1.6, 0, 0.55, -0.25, 0.05);
  k.hull(g, [[-0.42, 0.7, -1.05], [0.42, 0.7, -1.05], [-0.42, 0.7, -0.35], [0.42, 0.7, -0.35], [-0.36, 1.1, -0.95], [0.36, 1.1, -0.95], [-0.36, 1.05, -0.45], [0.36, 1.05, -0.45]]);
  for (let i = 0; i < 4; i++) k.box(C.black, 0.6, 0.02, 0.04, 0, 1.05, -0.9 + i * 0.12);
  // seat
  k.cbox(C.black, 0.5, 0.12, 0.45, 0, 0.98, -0.1, 0.04);
  k.cbox(C.black, 0.5, 0.42, 0.1, 0, 1.2, -0.32, 0.04, { rx: -0.15 });
  // steering column + wheel
  k.tube(C.black, [0, 0.75, 0.45], [0, 1.25, 0.28], 0.03, { seg: 4 });
  k.lathe(C.black, [[0.17, -0.02], [0.17, 0.02]], 0, 1.27, 0.27, { seg: 10, rx: -1.0 });
  k.cbox(g, 0.7, 0.35, 0.35, 0, 0.7, 0.5, 0.04);
  // ROPS bar
  for (const s of [-1, 1]) k.tube(y, [s * 0.42, 0.7, -0.55], [s * 0.42, 1.95, -0.55], 0.035, { seg: 5 });
  k.tube(y, [-0.42, 1.95, -0.55], [0.42, 1.95, -0.55], 0.035, { seg: 5 });
  k.box(C.glow, 0.12, 0.06, 0.03, -0.25, 0.82, 0.68, { mat: 'glow' });
  k.box(C.glow, 0.12, 0.06, 0.03, 0.25, 0.82, 0.68, { mat: 'glow' });
  // wheels
  for (const s of [-1, 1]) {
    k.cyl([C.black, C.black, y], 0.36, 0.26, s * 0.6 - s * 0.13, 0.36, 0.25, { seg: 10, rz: (-PI / 2) * s });
    k.cyl([C.black, C.black, y], 0.28, 0.2, s * 0.55 - s * 0.1, 0.28, -0.95, { seg: 10, rz: (-PI / 2) * s });
  }
  // three reel cutting units at the front
  const units: V3[] = [[-0.62, 0, 1.1], [0.62, 0, 1.1], [0, 0, 1.55]];
  for (const [ux, , uz] of units) {
    k.lathe(C.steel, [[0, -0.36], [0.13, -0.36], [0.13, 0.36], [0, 0.36]], ux, 0.15, uz, { seg: 8, rz: PI / 2, mat: 'metal' });
    for (let i = 0; i < 4; i++) k.box(C.steelD, 0.72, 0.02, 0.02, ux, 0.15 + Math.sin(i * 1.57) * 0.12, uz + Math.cos(i * 1.57) * 0.12, { mat: 'metal' });
    k.hull(y, [[-0.4, 0.2, -0.18], [0.4, 0.2, -0.18], [-0.4, 0.2, 0.2], [0.4, 0.2, 0.2], [-0.4, 0.34, -0.1], [0.4, 0.34, -0.1], [-0.4, 0.32, 0.1], [0.4, 0.32, 0.1]], ux, 0, uz);
    k.lathe(C.black, [[0.06, -0.38], [0.06, 0.38]], ux, 0.06, uz - 0.22, { seg: 6, rz: PI / 2 });
    k.tube(C.steelD, [ux * 0.5, 0.5, uz - 0.6], [ux, 0.3, uz - 0.1], 0.03, { seg: 4, mat: 'metal' });
  }
}

def('restaurant', (k) => {
  const white = 0xf3f1ea;
  const clad = 0x8a6748;
  const mull = 0x3a3632;
  const b: Box2 = { x0: -9, x1: 9, z0: -7.4, z1: 2.4 };
  const P = 0.2;
  const H = 4.2;
  const R = P + H;
  k.sec('ground');
  k.tbox(C.stoneL, 19.6, 0.05, 5.4, 0, 0, 5.15, 0.02);
  block(k, b, P, H, white, { plinth: 0x9a958c });
  for (let i = 0; i < 14; i++) for (const s of [-1, 1]) k.box(clad, 0.04, H - 0.1, 0.12, s * (9.02), P + H / 2, -6.9 + i * 0.32, { nb: true });
  k.box(clad, 0.06, H - 0.1, 4.6, -9.0, P + H / 2, -4.75, { nb: true });
  k.box(clad, 0.06, H - 0.1, 4.6, 9.0, P + H / 2, -4.75, { nb: true });
  // glass facade
  k.sec('facade');
  const fz = b.z1 + 0.02;
  k.quad(C.glass, [-8.7, P + 0.05, fz], [8.7, P + 0.05, fz], [8.7, R - 0.05, fz], [-8.7, R - 0.05, fz], { mat: 'glass', up: [0, 0, 1] });
  const nm = 13;
  for (let i = 0; i <= nm; i++) k.box(mull, 0.07, H, 0.12, -8.7 + (i * 17.4) / nm, P + H / 2, fz + 0.04, { nb: true });
  k.box(mull, 17.4, 0.07, 0.12, 0, P + 3.15, fz + 0.04);
  k.box(mull, 17.4, 0.1, 0.12, 0, P + 0.05, fz + 0.04);
  for (const fc of ['l', 'r'] as Face[]) onWall(k, b, fc, 0.4, P, () => {
    k.quad(C.glass, [-1.6, 0.1, 0.02], [1.6, 0.1, 0.02], [1.6, H - 0.2, 0.02], [-1.6, H - 0.2, 0.02], { mat: 'glass', up: [0, 0, 1] });
    for (const u of [-1.6, 0, 1.6]) k.box(mull, 0.07, H - 0.3, 0.1, u, (H - 0.1) / 2, 0.04, { nb: true });
  });
  // roof slab
  k.sec('roof');
  k.boxb(white, 19.0, 0.5, 11.4, 0, R, bcz(b) + 0.5);
  k.box(0x2f2c29, 19.04, 0.08, 11.44, 0, R + 0.06, bcz(b) + 0.5);
  // rooftop pavilion (glass bar)
  const pv: Box2 = { x0: -8.4, x1: -2.0, z0: -7.0, z1: -2.6 };
  const py = R + 0.5;
  k.boxb(white, bw(pv), 0.2, bd(pv), bcx(pv), py, bcz(pv));
  k.quad(C.glass, [pv.x0 + 0.1, py + 0.2, pv.z1], [pv.x1 - 0.1, py + 0.2, pv.z1], [pv.x1 - 0.1, py + 2.8, pv.z1], [pv.x0 + 0.1, py + 2.8, pv.z1], { mat: 'glass', up: [0, 0, 1] });
  k.quad(C.glass, [pv.x1, py + 0.2, pv.z0 + 0.1], [pv.x1, py + 0.2, pv.z1 - 0.1], [pv.x1, py + 2.8, pv.z1 - 0.1], [pv.x1, py + 2.8, pv.z0 + 0.1], { mat: 'glass', up: [1, 0, 0] });
  k.boxb(clad, bw(pv) - 0.1, 2.6, bd(pv) - 0.1, bcx(pv), py + 0.2, bcz(pv), { nb: true });
  for (let i = 0; i <= 5; i++) k.box(mull, 0.07, 2.6, 0.08, pv.x0 + (i * bw(pv)) / 5, py + 1.5, pv.z1 + 0.02, { nb: true });
  k.boxb(white, bw(pv) + 1.0, 0.3, bd(pv) + 1.0, bcx(pv), py + 2.8, bcz(pv) + 0.2);
  // terrace deck + glass balustrade
  k.sec('terrace');
  for (let i = 0; i < 8; i++) k.box(k.jc(0xa77a52, 0.04), 9.6, 0.05, 1.2, 3.8, py - 0.0, -6.6 + i * 1.25, { nb: true });
  railing(k, [-9.3, 3.15], [9.3, 3.15], R + 0.5, 1.05, { col: C.steel, glass: true, post: 2.4, mat: 'metal' });
  for (const s of [-1, 1]) railing(k, [s * 9.3, -7.0], [s * 9.3, 3.15], R + 0.5, 1.05, { col: C.steel, glass: true, post: 2.6, mat: 'metal' });
  railing(k, [-1.5, -7.1], [9.3, -7.1], R + 0.5, 1.05, { col: C.steel, glass: true, post: 2.7, mat: 'metal' });
  for (const [x, z] of [[1.4, -0.4], [5.0, 0.4], [6.6, -4.6], [2.4, -4.4]] as V2[]) k.at(x, py, z, 0, () => cafeTable(k, 2, [C.white, 0xe9e4d8], 0xf4f2ec, 0x3a3632));
  for (const z of [-6.0, 2.4]) planterBox(k, 8.3, z, 1.2, 0.6, 0.55, 0x5f5a54, 'grass');
  planterBox(k, -0.9, 1.6, 0.6, 2.4, 0.55, 0x5f5a54, 'grass');
  // entrance canopy
  k.sec('canopy');
  const ex = 4.6;
  k.boxb(white, 3.6, 0.28, 4.3, ex, 3.3, 4.4);
  k.box(0x2f2c29, 3.64, 0.05, 4.34, ex, 3.35, 4.4);
  for (const s of [-1, 1]) k.cyl(C.steelD, 0.07, 3.3, ex + s * 1.5, 0, 6.2, { seg: 6, mat: 'metal' });
  for (const z of [3.4, 5.4]) k.cyl(C.glow, 0.1, 0.02, ex, 3.28, z, { seg: 8, mat: 'glow' });
  k.at(ex, P, fz + 0.02, 0, () => door(k, 1.8, 2.8, { col: mull, double: true, glazed: true, frame: mull }));
  // brass sign letters on the fascia
  for (let i = 0; i < 10; i++) k.box(C.brass, 0.28, 0.32, 0.04, -7.2 + i * 0.42, R + 0.25, b.z1 + 1.12, { mat: 'metal' });
  // front planters + standard trees + bollards
  k.sec('planting');
  planterBox(k, -4.6, 4.5, 7.4, 0.8, 0.5, 0x8f8a80, 'grass');
  planterBox(k, 8.2, 4.5, 1.4, 0.8, 0.5, 0x8f8a80, 'grass');
  for (const x of [-7.4, -1.8]) {
    k.cyl(C.bark, 0.06, 1.6, x, 0.5, 4.5, { seg: 5, caps: 'none' });
    blob(k, k.jc(0x3f7f2f, 0.08), 0.75, x, 2.4, 4.5, { detail: 1, jit: 0.1 });
  }
  for (const x of [1.0, 2.6]) {
    k.cyl(0x3a3632, 0.09, 0.8, x, 0.05, 6.8, { seg: 6, mat: 'metal' });
    k.cyl(C.glow, 0.08, 0.1, x, 0.65, 6.8, { seg: 6, mat: 'glow', caps: 'none' });
  }
});

def('maintenance', (k) => {
  const clad = 0x86928a;
  const rib = 0x748078;
  const b: Box2 = { x0: -5.4, x1: 2.8, z0: -5.4, z1: 1.2 };
  const P = 0.12;
  const H = 3.8;
  k.sec('shed');
  k.tbox(C.concrete, 11.6, 0.06, 4.6, -0.2, 0, 3.6, 0.02);
  k.tbox(C.concreteD, 8.6, P, 7.0, bcx(b), 0, bcz(b), 0.02);
  const dx = -0.7;
  const dw = 4.2;
  const dh = 3.3;
  // shell with a real door opening + dark interior
  k.boxb(clad, bw(b), H, 0.12, bcx(b), P, b.z0 + 0.06, { nb: true });
  for (const x of [b.x0 + 0.06, b.x1 - 0.06]) k.boxb(clad, 0.12, H, bd(b), x, P, bcz(b), { nb: true });
  const lw = dx - dw / 2 - b.x0;
  const rw = b.x1 - (dx + dw / 2);
  k.boxb(clad, lw, H, 0.12, b.x0 + lw / 2, P, b.z1 - 0.06, { nb: true });
  k.boxb(clad, rw, H, 0.12, b.x1 - rw / 2, P, b.z1 - 0.06, { nb: true });
  k.boxb(clad, dw, H - dh, 0.12, dx, P + dh, b.z1 - 0.06, { nb: true });
  room(k, b.x0 + 0.12, b.x1 - 0.12, P, P + H + 0.6, b.z0 + 0.12, b.z1 - 0.12, 0x4a4f50);
  k.box(0x2d3133, bw(b) - 0.3, 0.02, bd(b) - 0.3, bcx(b), P + 0.01, bcz(b), { nb: true });
  k.tbox(C.timber, 2.4, 0.9, 0.7, -3.4, P, b.z0 + 0.6, 0.02);
  k.box(0x8a3a2e, 0.6, 0.4, 0.4, -3.9, P + 1.1, b.z0 + 0.5);
  for (let i = 0; i < 3; i++) k.box(C.timberL, 2.2, 0.05, 0.45, 1.4, P + 0.8 + i * 0.6, b.z0 + 0.4);
  for (let i = 0; i < 15; i++) k.box(rib, 0.05, H - 0.1, 0.03, b.x0 + 0.25 + i * 0.55, P + H / 2, b.z0 - 0.015, { nb: true });
  for (let i = 0; i < 12; i++) for (const x of [b.x0 - 0.015, b.x1 + 0.015]) k.box(rib, 0.03, H - 0.1, 0.05, x, P + H / 2, b.z0 + 0.3 + i * 0.55, { nb: true });
  k.at(bcx(b), 0, bcz(b), PI / 2, () => gableRoof(k, bd(b), bw(b), P + H, 1.5, { roof: 0xa9b1b6, wall: clad, trim: 0x5b646b, over: 0.35, overX: 0.3, t: 0.12, mat: 'metal', ridge: 0x8d959b }));
  for (const x of [-3.2, 0.6]) {
    const slope = 1.5 / (bw(b) / 2);
    const y = P + H + (bw(b) / 2 - Math.abs(x - bcx(b))) * slope;
    k.box(0xcfe1ea, 1.0, 0.03, 2.2, x, y + 0.13, -2.6, { mat: 'glass', rz: Math.sign(x - bcx(b)) * -Math.atan(slope) });
  }
  // big sliding doors
  k.sec('doors');
  const fz = b.z1;
  for (const [lx, ox] of [[dx - 3.15, 0], [dx + 3.15, 0]] as V2[]) {
    k.box(0xb9c0c4, 2.2, 3.4, 0.08, lx, P + 1.7, fz + 0.1 + ox, { mat: 'metal' });
    for (let i = 0; i < 6; i++) k.box(0xa7aeb2, 0.04, 3.3, 0.03, lx - 0.9 + i * 0.36, P + 1.7, fz + 0.15 + ox, { nb: true, mat: 'metal' });
  }
  k.box(0x3c4248, 8.4, 0.12, 0.12, dx, P + 3.5, fz + 0.12, { mat: 'metal' });
  k.at(dx + 0.3, P, fz - 1.2, 0, () => mowerBody(k));
  k.at(-4.4, P, fz, 0, () => door(k, 0.95, 2.15, { col: 0x3c4248, frame: 0x5b646b }));
  k.at(-3.4, P + 1.3, fz, 0, () => liteWin(k, 0.7, 0.8, { frame: 0x5b646b, sill: null }));
  for (const z of [-4.0, -1.6]) onWall(k, b, 'r', z, P + 1.4, () => liteWin(k, 1.2, 0.9, { frame: 0x5b646b, mull: true }));
  k.box(0x5b646b, 1.0, 0.6, 0.04, bcx(b), P + H + 0.6, fz + 0.37);
  for (let i = 0; i < 4; i++) k.box(0x3c4248, 0.9, 0.04, 0.03, bcx(b), P + H + 0.4 + i * 0.13, fz + 0.4);
  wallLamp(k, dx, P + 3.75, fz + 0.1);
  // fuel tank in a bund
  k.sec('fuel');
  const tx = 4.5;
  const tz = -3.4;
  k.tbox(C.concrete, 2.8, 0.08, 4.2, tx, 0, tz, 0.02);
  for (const s of [-1, 1]) {
    k.tbox(C.concrete, 2.8, 0.45, 0.15, tx, 0, tz + s * 2.03, 0.02);
    k.tbox(C.concrete, 0.15, 0.45, 4.2, tx + s * 1.33, 0, tz, 0.02);
  }
  for (const s of [-1, 1]) k.tbox(C.concreteD, 1.3, 0.6, 0.3, tx, 0.08, tz + s * 0.9, 0.03);
  k.lathe([C.green, C.green, C.green, C.green], [[0, -1.45], [0.45, -1.4], [0.68, -1.25], [0.68, 1.25], [0.45, 1.4], [0, 1.45]].map(([r, y]) => [r, y] as V2), tx, 1.35, tz, { seg: 12, rx: PI / 2 });
  k.box(C.yellow, 0.5, 0.35, 0.02, tx, 1.35, tz + 1.47, { rx: 0 });
  k.cbox(C.red, 0.5, 1.2, 0.35, tx - 0.6, 0.68, -0.6, 0.04);
  k.box(C.white, 0.3, 0.2, 0.02, tx - 0.6, 1.0, -0.42);
  k.tubes(C.black, [[tx - 0.45, 0.9, -0.42], [tx - 0.3, 0.5, -0.3], [tx - 0.1, 0.9, -0.35]], 0.025, { seg: 4 });
  k.tube(C.steelD, [tx, 2.0, tz], [tx, 2.4, tz], 0.05, { seg: 5, mat: 'metal' });
  // sand / top-dressing bay
  k.sec('sand');
  const sx = 4.4;
  const sz = 3.6;
  for (let i = 0; i < 5; i++) k.tbox(k.jc(C.concreteD, 0.04), 0.6, 0.9, 0.6, sx - 1.2 + i * 0.6, 0, sz - 1.7, 0.03);
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) k.tbox(k.jc(C.concreteD, 0.04), 0.6, 0.9, 0.6, sx + s * 1.5, 0, sz - 1.1 + i * 0.6, 0.03);
  const pile: V3[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    pile.push([Math.cos(a) * k.rr(1.0, 1.25), 0, Math.sin(a) * k.rr(1.0, 1.25)]);
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + 0.3;
    pile.push([Math.cos(a) * 0.6, k.rr(0.65, 0.85), Math.sin(a) * 0.6]);
  }
  pile.push([0.1, 1.15, -0.1]);
  k.hull(C.sand, pile, sx, 0, sz + 0.1, { grad: [0.85, 1.05] });
  k.tube(C.timberL, [sx + 0.8, 0.0, sz + 1.3], [sx + 0.3, 1.1, sz + 0.6], 0.025, { seg: 4 });
  k.box(C.steelD, 0.28, 0.02, 0.32, sx + 0.85, 0.06, sz + 1.38, { rx: -0.3, mat: 'metal' });
  // tool rack on the left wall
  k.sec('tools');
  k.at(b.x0, 0, -2.0, -PI / 2, () => {
    k.box(C.timber, 2.6, 0.12, 0.08, 0, 1.7, 0.08);
    k.box(C.timber, 2.6, 0.12, 0.08, 0, 0.5, 0.08);
    for (let i = 0; i < 6; i++) {
      const x = -1.1 + i * 0.44;
      k.tube(C.timberL, [x, 0.05, 0.22], [x, 1.85, 0.14], 0.02, { seg: 4 });
      if (i % 3 === 0) {
        k.box(C.steelD, 0.4, 0.04, 0.05, x, 1.9, 0.14, { mat: 'metal' });
        for (let t = 0; t < 5; t++) k.box(C.steelD, 0.015, 0.1, 0.015, x - 0.16 + t * 0.08, 1.85, 0.14, { mat: 'metal' });
      } else if (i % 3 === 1) k.box(C.steelD, 0.22, 0.3, 0.03, x, 0.12, 0.23, { mat: 'metal' });
      else k.box(0xc49a40, 0.3, 0.08, 0.06, x, 0.1, 0.23);
    }
  });
  // drums, wheelbarrow, pallets
  k.sec('yard');
  for (const [x, z, c] of [[2.0, 2.0, 0x2f63b8], [2.65, 2.35, C.red], [2.05, 2.75, 0x2f63b8]] as [number, number, number][])
    k.lathe([c, shade(c, 0.8), c, shade(c, 0.8), c], [[0, 0], [0.29, 0], [0.29, 0.3], [0.3, 0.33], [0.29, 0.6], [0.29, 0.88], [0, 0.88]], x, 0.06, z, { seg: 10 });
  k.push(-3.2, 0.06, 3.4, 0.5);
  k.hull(C.green, [[-0.35, 0.35, -0.3], [0.35, 0.35, -0.3], [-0.45, 0.62, -0.5], [0.45, 0.62, -0.5], [-0.45, 0.62, 0.45], [0.45, 0.62, 0.45], [-0.3, 0.3, 0.3], [0.3, 0.3, 0.3]], 0, 0, 0);
  k.lathe(C.black, [[0.2, -0.05], [0.2, 0.05]], 0, 0.2, 0.62, { seg: 8, rz: PI / 2 });
  for (const s of [-1, 1]) {
    k.tube(C.steelD, [s * 0.25, 0.5, -0.4], [s * 0.3, 0.55, -1.05], 0.02, { seg: 3 });
    k.tube(C.steelD, [s * 0.25, 0.35, -0.3], [s * 0.25, 0.0, -0.45], 0.02, { seg: 3 });
  }
  k.pop();
  for (let i = 0; i < 3; i++) k.boxb(k.jc(C.timberL, 0.06), 1.2, 0.14, 1.0, -4.7, i * 0.15, 4.9);
  k.boxb(0x8b8a84, 1.1, 0.5, 0.9, -4.7, 0.45, 4.9);
});

def('cart_shed', (k) => {
  const wall = 0xe8dcc0;
  const bat = 0xd6c9aa;
  const trim = C.green;
  const b: Box2 = { x0: -7.6, x1: 7.6, z0: -5.5, z1: 2.3 };
  const P = 0.1;
  const H = 3.3;
  k.sec('shell');
  k.tbox(C.concrete, 15.8, P, 8.4, 0, 0, -1.6, 0.02);
  k.tbox(C.concreteD, 15.0, 0.05, 3.2, 0, 0, 4.1, 0.02);
  k.boxb(wall, 15.2, H, 0.2, 0, P, b.z0 + 0.1, { nb: true });
  for (const s of [-1, 1]) k.boxb(wall, 0.2, H, bd(b), s * 7.5, P, bcz(b), { nb: true });
  for (let i = 0; i < 25; i++) k.box(bat, 0.06, H - 0.1, 0.04, -7.3 + i * 0.61, P + H / 2, b.z0 - 0.01, { nb: true });
  for (const s of [-1, 1]) for (let i = 0; i < 12; i++) k.box(bat, 0.04, H - 0.1, 0.06, s * 7.61, P + H / 2, b.z0 + 0.4 + i * 0.62, { nb: true });
  for (const x of [-7.5, -3.75, 0, 3.75, 7.5]) {
    k.boxb(trim, 0.26, H, 0.26, x, P, b.z1 - 0.1);
    if (Math.abs(x) < 7) for (const s of [-1, 1]) k.tube(trim, [x, P + H - 0.9, b.z1 - 0.1], [x + s * 0.8, P + H - 0.2, b.z1 - 0.1], 0.05, { seg: 4 });
  }
  for (const x of [-7.5, 7.5]) k.tube(trim, [x, P + H - 0.9, b.z1 - 0.1], [x - Math.sign(x) * 0.8, P + H - 0.2, b.z1 - 0.1], 0.05, { seg: 4 });
  k.box(trim, 15.5, 0.36, 0.3, 0, P + H - 0.05, b.z1 - 0.1);
  for (const x of [-7.5, 7.5]) k.boxb(trim, 0.26, H, 0.26, x, P, b.z0 + 0.1);
  // gambrel roof (ridge along X)
  k.sec('roof');
  const zf = b.z1 + 0.35;
  const zb = b.z0 - 0.45;
  const zc = (zf + zb) / 2;
  const hs = (zf - zb) / 2;
  const ye = P + H - 0.05;
  const pts: V2[] = [[zf, ye], [zc + hs * 0.52, ye + 1.85], [zc, ye + 2.75], [zc - hs * 0.52, ye + 1.85], [zb, ye]];
  const L = 16.2;
  const t = 0.16;
  for (let i = 0; i < 4; i++) {
    const [z0, y0] = pts[i];
    const [z1, y1] = pts[i + 1];
    const len = Math.hypot(z1 - z0, y1 - y0);
    const ang = Math.atan2(y1 - y0, z1 - z0);
    const nz = -Math.sin(ang);
    const ny = Math.cos(ang);
    const sgn = i < 2 ? 1 : -1;
    const mz = (z0 + z1) / 2 + nz * (t / 2) * sgn;
    const my = (y0 + y1) / 2 + ny * (t / 2) * sgn;
    k.box(i % 2 ? 0x2f5f44 : 0x285539, L, t, len + 0.04, 0, my, mz, { rx: -ang, mat: 'metal' });
  }
  k.box(0x1f4430, L + 0.02, 0.12, 0.3, 0, ye + 2.75 + 0.14, zc);
  for (const i of [0, 3]) {
    const [z0, y0] = pts[i];
    const [z1, y1] = pts[i + 1];
    const len = Math.hypot(z1 - z0, y1 - y0);
    const ang = Math.atan2(y1 - y0, z1 - z0);
    const sgn = i < 2 ? 1 : -1;
    const mz = (z0 + z1) / 2 - Math.sin(ang) * (t + 0.02) * sgn;
    const my = (y0 + y1) / 2 + Math.cos(ang) * (t + 0.02) * sgn;
    for (let r = 0; r < 14; r++) k.box(0x3a7052, 0.05, 0.04, len, -7.6 + 0.55 + r * 1.07, my, mz, { rx: -ang, mat: 'metal', nb: true });
  }
  const gp: V2[] = [[b.z1 - 0.1, ye], [zc + hs * 0.52 - 0.05, ye + 1.78], [zc, ye + 2.66], [zc - hs * 0.52 + 0.05, ye + 1.78], [b.z0, ye]];
  k.extX(wall, gp, -7.6, 7.6);
  for (const s of [-1, 1]) {
    k.box(trim, 0.05, 0.12, 0.12, s * 7.62, ye + 0.05, b.z1 - 0.1);
    k.at(s * 7.6, ye + 0.6, -1.6, (s * PI) / 2, () => {
      k.box(trim, 1.3, 1.0, 0.06, 0, 0.5, 0.03);
      k.box(0x2a2d2f, 1.1, 0.8, 0.02, 0, 0.5, 0.065);
      for (let i = 0; i < 4; i++) k.box(trim, 1.1, 0.04, 0.03, 0, 0.18 + i * 0.2, 0.08, { rx: 0.4 });
    });
  }
  // cupola + weathervane
  k.sec('cupola');
  const cy = ye + 2.75;
  k.boxb(trim, 1.0, 0.9, 1.0, 0, cy - 0.15, zc);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) k.box(0x2f3236, 0.8, 0.05, 0.03, 0, cy + 0.15 + i * 0.18, zc + s * 0.51);
  k.hull(0x285539, [[-0.7, 0, -0.7], [0.7, 0, -0.7], [-0.7, 0, 0.7], [0.7, 0, 0.7], [0, 0.65, 0]], 0, cy + 0.75, zc);
  k.cyl(C.iron, 0.02, 0.8, 0, cy + 1.35, zc, { seg: 4 });
  k.box(C.iron, 0.7, 0.03, 0.03, 0, cy + 1.9, zc);
  k.hull(C.iron, [[0.3, 0, -0.08], [0.3, 0, 0.08], [0.45, 0, 0], [0.3, 0.03, 0]], 0, cy + 1.885, zc);
  k.box(C.iron, 0.16, 0.12, 0.02, -0.3, cy + 1.95, zc);
  // carts + chargers
  k.sec('carts');
  const bags: Col[][] = [[C.navy, C.red], [C.green, 0x2f2f33], [C.red, C.navy], [0x2f2f33, C.green]];
  [-5.6, -1.9, 1.9, 5.6].forEach((x, i) => {
    k.at(x, P, -1.6, 0, () => golfCart(k, false, bags[i]));
    k.box(0x9aa1a7, 0.35, 0.5, 0.2, x + 0.9, 1.3, b.z0 + 0.3, { mat: 'metal' });
    k.box(C.glow, 0.08, 0.08, 0.02, x + 0.9, 1.45, b.z0 + 0.41, { mat: 'glow' });
    k.tubes(C.black, [[x + 0.9, 1.05, b.z0 + 0.35], [x + 0.75, 0.3, b.z0 + 1.0], [x + 0.5, 0.5, -2.6]], 0.02, { seg: 3 });
  });
  // sign
  k.sec('sign');
  k.box(C.green, 3.2, 0.7, 0.08, 0, P + H + 0.55, b.z1 + 0.25);
  k.box(C.cream, 3.0, 0.55, 0.02, 0, P + H + 0.55, b.z1 + 0.3);
  for (let i = 0; i < 5; i++) k.box(C.green, 0.3, 0.32, 0.02, -0.84 + i * 0.42, P + H + 0.55, b.z1 + 0.32);
  for (const x of [-5.6, 5.6]) wallLamp(k, x, P + H - 0.4, b.z1 + 0.05);
});

def('academy', (k) => {
  const white = 0xf2f0ea;
  const clad = 0x4e3a2a;
  const dark = 0x2a2d30;
  const b: Box2 = { x0: -7.6, x1: 7.6, z0: -7.0, z1: 1.2 };
  const P = 0.15;
  const hB = 3.6;
  const hF = 5.0;
  const wallTop = (z: number): number => P + hB + ((z - b.z0) / bd(b)) * (hF - hB);
  k.sec('shell');
  k.tbox(C.concrete, 15.6, P, 8.6, 0, 0, bcz(b), 0.02);
  k.boxb(white, 15.2, hB, 0.25, 0, P, b.z0 + 0.125, { nb: true });
  for (const [x0, c] of [[b.x0, clad], [b.x1 - 0.25, white]] as [number, Col][]) k.extX(c, [[b.z0, P], [b.z1, P], [b.z1, P + hF], [b.z0, P + hB]], x0, x0 + 0.25);
  k.extX(white, [[b.z0, P], [b.z1 - 0.2, P], [b.z1 - 0.2, wallTop(b.z1 - 0.2)], [b.z0, P + hB]], -0.25, 0.0);
  k.extX(0xe2dfd6, [[b.z0, P], [b.z1 - 0.6, P], [b.z1 - 0.6, wallTop(b.z1 - 0.6)], [b.z0, P + hB]], 3.7, 3.9);
  // reception glass front
  k.sec('glass');
  const fz = b.z1;
  k.quad(C.glass, [-7.4, P, fz], [-0.25, P, fz], [-0.25, P + hF, fz], [-7.4, P + hF, fz], { mat: 'glass', up: [0, 0, 1] });
  for (let i = 0; i <= 6; i++) k.box(dark, 0.08, hF, 0.12, -7.4 + (i * 7.15) / 6, P + hF / 2, fz + 0.04, { nb: true });
  k.box(dark, 7.2, 0.08, 0.12, -3.8, P + 2.9, fz + 0.04);
  k.box(dark, 7.2, 0.1, 0.12, -3.8, P + 0.05, fz + 0.04);
  k.at(-2.6, P, fz + 0.05, 0, () => door(k, 1.6, 2.6, { col: dark, double: true, glazed: true, frame: dark }));
  // simulator bays (open front)
  k.sec('bays');
  for (const cx of [1.85, 5.75]) {
    k.box(0x3d4440, 3.7, 0.03, 7.6, cx, P + 0.015, -2.9, { nb: true });
    k.box(C.black, 3.2, 2.1, 0.08, cx, P + 1.85, b.z0 + 0.3);
    k.box(C.screen, 3.0, 1.9, 0.02, cx, P + 1.85, b.z0 + 0.35, { mat: 'glass' });
    k.box(0x7fbf58, 3.0, 0.5, 0.01, cx, P + 1.1, b.z0 + 0.365, { mat: 'glass' });
    k.tbox(0x2b3a2e, 1.5, 0.025, 1.5, cx, P, -2.2, 0.01);
    k.box(C.turf, 1.3, 0.02, 1.3, cx, P + 0.035, -2.2, { nb: true });
    k.cbox(dark, 0.4, 0.2, 0.5, cx, wallTop(-3.5) - 0.3, -3.5, 0.03);
    k.box(C.glow, 0.25, 0.02, 1.4, cx, wallTop(-1.5) - 0.12, -1.5, { mat: 'glow' });
    ballTray(k, cx - 1.2, -1.2, 0);
  }
  // mono-pitch roof
  k.sec('roof');
  const zr0 = b.z0 - 0.4;
  const zr1 = b.z1 + 1.5;
  const yr0 = wallTop(zr0);
  const yr1 = wallTop(zr1);
  const ang = Math.atan2(yr1 - yr0, zr1 - zr0);
  const len = Math.hypot(zr1 - zr0, yr1 - yr0);
  k.box(0x6b747d, 16.2, 0.32, len, 0, (yr0 + yr1) / 2 + 0.16, (zr0 + zr1) / 2, { rx: -ang });
  k.box(0xb98a5c, 15.9, 0.02, 1.6, 0, wallTop(b.z1 + 0.75) - 0.01, b.z1 + 0.75, { rx: -ang });
  k.box(dark, 16.24, 0.5, 0.08, 0, yr1 + 0.1, zr1 + 0.02);
  for (let i = 0; i < 9; i++) k.box(0x7f8891, 0.05, 0.05, len, -7.2 + i * 1.8, (yr0 + yr1) / 2 + 0.34, (zr0 + zr1) / 2, { rx: -ang });
  // solar panels
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 4; c++) {
      const zz = -5.2 + r * 2.6;
      const yy = wallTop(zz) + 0.45;
      k.box(0x1f3550, 3.0, 0.06, 2.2, -5.0 + c * 3.4, yy, zz, { rx: -ang - 0.12 });
      k.box(0x9aa6b0, 3.04, 0.04, 0.04, -5.0 + c * 3.4, yy + 0.04, zz, { rx: -ang - 0.12 });
    }
  // side wall windows + crest
  onWall(k, b, 'r', -4.6, P + 1.2, () => liteWin(k, 2.2, 1.4, { frame: dark, sill: null }));
  onWall(k, b, 'r', -1.2, P + 1.2, () => liteWin(k, 2.2, 1.4, { frame: dark, sill: null }));
  // sign on fascia
  for (let i = 0; i < 7; i++) k.box(C.white, 0.3, 0.32, 0.03, -5.8 + i * 0.42, yr1 + 0.1, zr1 + 0.07);
  k.at(-6.7, yr1 + 0.1, zr1 + 0.06, 0, () => crest(k, 0.4));
  // putting mat outside
  k.sec('putting');
  const pz = 4.9;
  k.tbox(C.timber, 6.6, 0.08, 3.8, -3.8, 0, pz, 0.02);
  k.box(C.putt, 6.3, 0.03, 3.5, -3.8, 0.08, pz, { nb: true });
  for (const [x, z, c] of [[-5.6, pz - 0.9, C.red], [-2.1, pz + 0.8, C.yellow]] as [number, number, number][]) {
    k.cyl(0x1b1b1b, 0.06, 0.01, x, 0.092, z, { seg: 8 });
    flagPin(k, x, 0.09, z, 0.55, c, 0.2, 0.14, 0.008);
  }
  golfBall(k, -4.4, 0.095, pz + 0.3, 0.03);
  golfBall(k, -3.1, 0.095, pz - 0.5, 0.03);
  golfBall(k, -6.2, 0.095, pz + 0.9, 0.03);
  k.at(3.8, 0, 5.6, PI, () => parkBench(k, 1.6));
  planterBox(k, 3.8, 3.6, 3.6, 0.6, 0.5, 0x5f5a54, 'grass');
});

/** Modern road lamp: pole at origin, head overhanging +Z. */
function streetLampBody(k: Kit, h = 7.0): void {
  const pc = 0x4a5157;
  k.cyl(C.concrete, 0.32, 0.12, 0, 0, 0, { seg: 8 });
  k.lathe(pc, [[0.16, 0.12], [0.16, 0.5], [0.11, 0.6], [0.075, h - 0.4], [0.06, h - 0.3]], 0, 0, 0, { seg: 8, mat: 'metal' });
  const arc: V3[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    arc.push([0, h - 0.7 + Math.sin(t * PI * 0.5) * 0.65, Math.sin(t * PI * 0.55) * 1.6]);
  }
  k.tubes(pc, arc, 0.05, { seg: 6, mat: 'metal' });
  k.cbox(pc, 0.32, 0.12, 0.8, 0, h - 0.08, 1.75, 0.04, { mat: 'metal', rx: 0.05 });
  k.box(C.glow, 0.24, 0.02, 0.62, 0, h - 0.15, 1.77, { mat: 'glow', rx: 0.05 });
  k.box(0x2d3238, 0.22, 0.4, 0.12, 0, 2.2, -0.12);
}

def('carpark', (k) => {
  const asph = C.asphalt;
  const paint = 0xf2f2ee;
  k.sec('surface');
  k.tbox(asph, 23.8, 0.04, 15.0, 0, 0, 0, 0.01);
  k.box(asph, 8.0, 0.04, 0.6, 0, 0.02, 7.7, { nb: true });
  // kerbs
  k.tbox(C.concrete, 24.0, 0.15, 0.2, 0, 0, -7.55, 0.03);
  for (const s of [-1, 1]) {
    k.tbox(C.concrete, 7.8, 0.15, 0.2, s * 8.1, 0, 7.55, 0.03);
    k.tbox(C.concrete, 0.16, 0.15, 15.0, s * 11.92, 0, 0, 0.03);
    k.lathe(C.concrete, [[0.25, 0], [0.25, 0.15], [0, 0.15]], s * 4.15, 0, 7.6, { seg: 8 });
  }
  // planting strips
  k.sec('planting');
  k.box(0x4f8f3a, 24.0, 0.08, 0.36, 0, 0.04, -7.82, { nb: true });
  for (const s of [-1, 1]) k.box(0x4f8f3a, 7.8, 0.08, 0.36, s * 8.1, 0.04, 7.82, { nb: true });
  const hedge = (x0: number, x1: number, z: number) => {
    k.hull(k.jc(0x3a7a2e, 0.05), [[x0, 0.05, z - 0.17], [x1, 0.05, z - 0.17], [x0, 0.05, z + 0.17], [x1, 0.05, z + 0.17], [x0, 0.5, z - 0.12], [x1, 0.5, z - 0.12], [x0, 0.5, z + 0.12], [x1, 0.5, z + 0.12]], 0, 0, 0, { mat: 'foliage', grad: [0.7, 1.08] });
    const n = Math.round((x1 - x0) / 2.6);
    for (let i = 0; i < n; i++) blob(k, k.jc(0x417f30, 0.1), 0.32, x0 + ((i + 0.5) * (x1 - x0)) / n, 0.5, z, { kind: 'dodeca', detail: 0, sy: 0.7 });
  };
  hedge(-11.8, 11.8, -7.82);
  hedge(-11.8, -4.5, 7.82);
  hedge(4.5, 11.8, 7.82);
  for (const s of [-1, 1]) {
    k.tbox(C.concrete, 0.8, 0.15, 3.2, s * 11.6, 0, 0, 0.03);
    k.box(0x4f8f3a, 0.6, 0.04, 3.0, s * 11.6, 0.15, 0, { nb: true });
    blob(k, k.jc(0x3f7d2f, 0.08), 0.45, s * 11.6, 0.45, -1.0, { detail: 0 });
    blob(k, k.jc(0x3f7d2f, 0.08), 0.4, s * 11.6, 0.42, 1.1, { detail: 0 });
    k.at(s * 11.6, 0.15, 0, -s * PI / 2, () => streetLampBody(k, 6.5));
  }
  // markings
  k.sec('lines');
  const line = (x0: number, z0: number, x1: number, z1: number, w = 0.1) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    k.box(paint, L, 0.01, w, (x0 + x1) / 2, 0.043, (z0 + z1) / 2, { ry: yawX(x1 - x0, z1 - z0), nb: true });
  };
  for (const x of [-11.75, -8, -4, 0, 4, 8, 11.75]) {
    line(x, -7.35, x, -2.5);
    line(x - 0.3, -2.5, x + 0.3, -2.5);
  }
  for (const x of [-11.75, -8, -4, 4, 8, 11.75]) {
    line(x, 2.5, x, 7.35);
    line(x - 0.3, 2.5, x + 0.3, 2.5);
  }
  const arrow = (x: number, z: number, ry: number) => {
    k.push(x, 0.043, z, ry);
    k.extY(paint, [[-0.12, -0.9], [0.12, -0.9], [0.12, 0.2], [0.35, 0.2], [0, 0.85], [-0.35, 0.2], [-0.12, 0.2]], 0, 0.006, { noBottom: true });
    k.pop();
  };
  arrow(-7, 0, -PI / 2);
  arrow(7, 0, PI / 2);
  arrow(0, 0.8, PI);
  for (let i = 0; i < 5; i++) k.box(paint, 0.45, 0.01, 1.3, -2.8 + i * 1.4, 0.043, 6.75, { nb: true });
  // entrance signs
  k.sec('signs');
  k.boxb(C.steelD, 0.08, 2.2, 0.08, -4.7, 0, 7.8, { mat: 'metal' });
  k.box(0x2457a8, 0.7, 0.7, 0.05, -4.7, 2.0, 7.85);
  pixelText(k, 'P', -4.87, 2.2, 7.88, 0.08, C.white);
  k.cbox(0x8d969c, 0.5, 1.5, 0.35, 4.7, 0.75, 7.8, 0.04, { mat: 'metal' });
  k.box(C.yellow, 0.52, 0.18, 0.37, 4.7, 1.45, 7.8);
  k.box(C.screen, 0.24, 0.16, 0.02, 4.7, 1.15, 7.98, { mat: 'glass' });
});

def('grandstand', (k) => {
  const conc = 0xc9c6bd;
  const seatG = 0x1f6b42;
  const seatW = 0xf3f1ea;
  const steel = 0x7d868d;
  const rows = 6;
  const tread = 0.9;
  const rise = 0.42;
  const zF = 3.3;
  const y0 = 0.55;
  k.sec('tiers');
  const prof: V2[] = [[zF, 0], [zF, y0]];
  for (let i = 0; i < rows; i++) {
    const zb = zF - (i + 1) * tread;
    prof.push([zb, y0 + i * rise]);
    if (i < rows - 1) prof.push([zb, y0 + (i + 1) * rise]);
  }
  const zBack = zF - rows * tread;
  const yTop = y0 + (rows - 1) * rise;
  prof.push([zBack, 0]);
  k.extX(conc, prof, -11.9, 11.9);
  // aisles with intermediate steps + yellow nosings
  const aisles = [-4.0, 4.0];
  for (const ax of aisles) {
    for (let i = 0; i < rows; i++) {
      const zf = zF - i * tread;
      k.tbox(0xbdb9ae, 1.1, y0 + i * rise + rise / 2 - (y0 + i * rise) + 0.0 + rise / 2, tread / 2, ax, y0 + i * rise - rise / 2 + 0.0, zf - tread / 4, 0.01);
      k.box(C.yellow, 1.1, 0.012, 0.06, ax, y0 + i * rise + 0.006, zf - 0.03, { nb: true });
    }
    for (let i = 0; i < 2; i++) k.tbox(0xbdb9ae, 1.3, y0 - (i + 1) * (y0 / 3) + y0 / 3, 0.4, ax, 0, zF + 0.2 + i * 0.4, 0.01);
  }
  // seats (L-profile prisms)
  k.sec('seats');
  const sp: V2[] = [[0.2, 0.3], [0.2, 0.4], [-0.12, 0.42], [-0.19, 0.8], [-0.26, 0.8], [-0.24, 0.3]];
  const sections: [number, number][] = [[-11.6, -4.65], [-3.35, 3.35], [4.65, 11.6]];
  sections.forEach(([sx0, sx1], si) => {
    const n = Math.floor((sx1 - sx0) / 0.6);
    const w = (sx1 - sx0) / n;
    for (let r = 0; r < rows; r++) {
      const zc = zF - r * tread - tread * 0.5;
      const yy = y0 + r * rise;
      k.box(0x5d646a, sx1 - sx0, 0.22, 0.12, (sx0 + sx1) / 2, yy + 0.15, zc - 0.05, { nb: true, mat: 'metal' });
      for (let c = 0; c < n; c++) {
        const cx = sx0 + (c + 0.5) * w;
        const diamond = si === 1 && Math.abs(c - (n - 1) / 2) + Math.abs(r - 2.5) * 1.3 <= 3.2;
        const edge = c === 0 || c === n - 1;
        const colr = diamond || (edge && r % 2 === 0) ? seatW : seatG;
        k.push(cx, yy, zc, 0);
        k.extX(colr, sp, -w / 2 + 0.04, w / 2 - 0.04);
        k.pop();
      }
    }
  });
  // front wall rail + back wall cladding
  k.sec('frame');
  for (let i = 0; i <= 12; i++) {
    const x = -11.8 + (i * 23.6) / 12;
    if (aisles.some((a) => Math.abs(a - x) < 0.7)) continue;
    k.tube(steel, [x, y0, zF - 0.05], [x, y0 + 0.95, zF - 0.05], 0.03, { seg: 4, mat: 'metal' });
  }
  for (const [a, b2] of [[-11.9, -4.6], [-3.4, 3.4], [4.6, 11.9]] as V2[]) k.tube(steel, [a, y0 + 0.95, zF - 0.05], [b2, y0 + 0.95, zF - 0.05], 0.035, { seg: 5, mat: 'metal' });
  k.boxb(seatG, 23.8, yTop + 1.2, 0.15, 0, 0, zBack - 0.08, { nb: true });
  for (let i = 0; i < 24; i++) k.box(shade(seatG, 0.8), 0.06, yTop + 1.1, 0.04, -11.5 + i * 1.0, (yTop + 1.2) / 2, zBack - 0.17, { nb: true });
  k.box(C.white, 23.8, 0.12, 0.2, 0, yTop + 1.2, zBack - 0.08);
  for (const s of [-1, 1]) {
    const sideProf: V2[] = [[zF, 0], [zF, y0 + 1.0], [zBack, yTop + 1.2], [zBack, 0]];
    k.extX(C.white, sideProf, s * 11.95 - 0.05, s * 11.95 + 0.05);
  }
  // roof canopy on rear columns with cantilever trusses
  k.sec('roof');
  const ry0 = 7.4;
  const zc0 = zBack - 0.35;
  for (const x of [-11.7, -5.85, 0, 5.85, 11.7]) {
    k.boxb(steel, 0.3, ry0, 0.3, x, 0, zc0, { mat: 'metal' });
    k.tube(steel, [x, ry0, zc0], [x, ry0 + 0.35, zF - 0.6], 0.09, { seg: 5, mat: 'metal' });
    k.tube(steel, [x, ry0 - 2.4, zc0], [x, ry0 + 0.3, 0.9], 0.07, { seg: 5, mat: 'metal' });
    k.tube(steel, [x, ry0 - 1.0, zc0 + 0.1], [x, ry0 + 0.2, -0.6], 0.05, { seg: 4, mat: 'metal' });
  }
  const ang = Math.atan2(0.35, zF - 0.6 - zc0);
  const rl = Math.hypot(0.35, zF - 0.6 - zc0) + 0.6;
  k.box(0xe9e7e1, 24.2, 0.14, rl, 0, ry0 + 0.32, (zc0 + zF - 0.6) / 2, { rx: -ang });
  k.box(seatG, 24.3, 0.4, 0.1, 0, ry0 + 0.4, zF - 0.32);
  k.box(C.cream, 24.32, 0.06, 0.02, 0, ry0 + 0.45, zF - 0.26);
  for (let i = 0; i < 8; i++) k.box(0xd6d3cc, 0.06, 0.06, rl, -10.5 + i * 3.0, ry0 + 0.42, (zc0 + zF - 0.6) / 2, { rx: -ang });
  for (const s of [-1, 1]) {
    k.cyl(C.white, 0.03, 1.8, s * 10.8, ry0 + 0.5, zF - 0.45, { seg: 5 });
    k.flag(s < 0 ? [C.green, C.cream] : [C.cream, C.green], 1.0, 0.6, s * 10.8 + 0.02, ry0 + 1.65, zF - 0.45, 5, { mat: 'std' });
  }
  for (const x of [-8, 0, 8]) k.box(C.glow, 1.2, 0.04, 0.2, x, ry0 + 0.18, 1.2, { mat: 'glow', rx: -ang });
});

def('helipad', (k) => {
  k.sec('pad');
  k.lathe(C.gravel, [[7.9, 0], [7.9, 0.03], [0, 0.03]], 0, 0, 0, { seg: 8, phase: PI / 8 });
  k.lathe([0xbcb8ae, 0xc9c5bb, 0xc9c5bb], [[7.25, 0], [7.15, 0.07], [7.05, 0.08], [0, 0.08]], 0, 0, 0, { seg: 8, phase: PI / 8 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + PI / 8 + PI / 8;
    const r = 6.55 * Math.cos(PI / 8);
    k.box(C.white, 2 * 6.55 * Math.sin(PI / 8) - 0.6, 0.012, 0.22, Math.sin(a) * r, 0.084, Math.cos(a) * r, { ry: a, nb: true });
  }
  k.lathe(C.yellow, [[5.55, 0.087], [5.1, 0.087]], 0, 0, 0, { seg: 32 });
  k.box(C.white, 0.75, 0.012, 4.2, -1.3, 0.085, 0, { nb: true });
  k.box(C.white, 0.75, 0.012, 4.2, 1.3, 0.085, 0, { nb: true });
  k.box(C.white, 1.9, 0.012, 0.75, 0, 0.085, 0, { nb: true });
  // perimeter lights
  k.sec('lights');
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    const r = 7.45;
    k.cyl(0x55595d, 0.1, 0.12, Math.sin(a) * r, 0, Math.cos(a) * r, { seg: 6, caps: 'none' });
    k.lathe(i % 2 ? 0x8fe08a : C.glow, [[0.09, 0.12], [0.06, 0.2], [0, 0.22]], Math.sin(a) * r, 0, Math.cos(a) * r, { seg: 6, mat: 'glow' });
  }
  // windsock
  k.sec('windsock');
  const wx = 0.0;
  const wz = -7.65;
  k.tbox(C.concrete, 0.6, 0.12, 0.6, wx, 0, wz, 0.03);
  k.lathe([C.red, C.white, C.red, C.white, C.red], [[0.07, 0.12], [0.065, 1.0], [0.06, 1.9], [0.055, 2.8], [0.05, 3.6], [0.045, 4.4]], wx, 0, wz, { seg: 6 });
  k.ball(C.red, 0.08, wx, 4.45, wz, { detail: 0 });
  k.lathe(C.steelD, [[0.34, -0.03], [0.34, 0.03]], wx + 0.36, 4.25, wz, { seg: 10, rz: -PI / 2, mat: 'metal' });
  k.tube(C.steelD, [wx, 4.25, wz], [wx + 0.36, 4.25, wz], 0.02, { seg: 3, mat: 'metal' });
  const sock: V2[] = [];
  const sc: Col[] = [];
  for (let i = 0; i <= 5; i++) {
    sock.push([0.33 - i * 0.04, i * 0.36]);
    if (i < 5) sc.push(i % 2 ? C.white : 0xf26b1d);
  }
  k.lathe(sc, sock, wx + 0.36, 4.25, wz, { seg: 10, rz: -PI / 2, mat: flagMat(wx) });
  k.lathe(sc, sock.map(([r, y]) => [r * 0.96, y] as V2).reverse(), wx + 0.36, 4.25, wz, { seg: 10, rz: -PI / 2, mat: flagMat(wx) });
  // equipment cabinet
  k.sec('kit');
  k.cbox(C.red, 0.8, 1.1, 0.5, -7.0, 0.55, -7.0, 0.04);
  k.box(C.white, 0.4, 0.25, 0.02, -7.0, 0.8, -6.74);
  k.lathe(C.red, [[0, 0], [0.09, 0], [0.09, 0.5], [0.05, 0.58], [0, 0.6]], -6.4, 0, -7.0, { seg: 6 });
  k.boxb(C.steelD, 0.08, 1.4, 0.08, -7.0, 0, 7.0, { mat: 'metal' });
  k.box(C.yellow, 0.7, 0.7, 0.04, -7.0, 1.5, 7.05, { rz: PI / 4 });
  pixelText(k, 'H', -7.12, 1.62, 7.08, 0.08, C.black);
});

def('hotel', (k) => {
  const wall = 0xecdcbc;
  const stone = 0xd5c09a;
  const trim = C.trim;
  const roof = C.slate;
  const P = 0.6;
  const G = 4.2;
  const U = 3.2;
  const mainH = G + U * 4;
  const towH = G + U * 5;
  const wingH = G + U * 3;
  const main: Box2 = { x0: -11, x1: 11, z0: -11, z1: -1.5 };
  const bay: Box2 = { x0: -4.2, x1: 4.2, z0: -1.6, z1: 0.4 };
  const towers: Box2[] = [{ x0: -15.6, x1: -11, z0: -5.0, z1: 1.4 }, { x0: 11, x1: 15.6, z0: -5.0, z1: 1.4 }];
  const wings: Box2[] = [{ x0: -15.2, x1: -11, z0: -11, z1: -5.0 }, { x0: 11, x1: 15.2, z0: -11, z1: -5.0 }];
  const glassC = C.glass;
  // ---- grounds
  k.sec('grounds');
  k.tbox(C.asphalt, 31.8, 0.04, 6.4, 0, 0, 5.4, 0.01);
  k.tbox(C.stoneL, 22.0, 0.06, 1.8, 0, 0, 1.3, 0.02);
  for (const s of [-1, 1]) k.tbox(C.stoneL, 4.6, 0.06, 0.8, s * 13.3, 0, 1.8, 0.02);
  k.tbox(C.concrete, 31.8, 0.14, 0.2, 0, 0, 8.7, 0.03);
  k.tbox(C.concrete, 31.8, 0.14, 0.2, 0, 0, 2.15, 0.03);
  for (let i = 0; i < 6; i++) k.box(0xf2f2ee, 1.2, 0.01, 0.12, -12.5 + i * 5, 0.043, 5.4, { nb: true });
  const hedgeRow = (x0: number, x1: number, z: number) =>
    k.hull(k.jc(0x356b2b, 0.04), [[x0, 0, z - 0.4], [x1, 0, z - 0.4], [x0, 0, z + 0.4], [x1, 0, z + 0.4], [x0, 0.75, z - 0.3], [x1, 0.75, z - 0.3], [x0, 0.75, z + 0.3], [x1, 0.75, z + 0.3]], 0, 0, 0, { mat: 'foliage', grad: [0.65, 1.08] });
  hedgeRow(-15.6, -6.0, 9.4);
  hedgeRow(6.0, 15.6, 9.4);
  hedgeRow(-15.6, -6.0, 11.6);
  hedgeRow(6.0, 15.6, 11.6);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) flowerClump(k, s * (7.2 + i * 2.3), 0, 10.5, 0.55, [0xd8322e, 0xf6f1ea, 0xf3c632, 0x9466c6], 3);
  }
  // central flag bed
  k.lathe([C.stoneL, C.stoneL, 0x4f8f3a], [[4.4, 0], [4.4, 0.3], [4.1, 0.3], [0, 0.3]], 0, 0, 10.4, { seg: 16, sz: 0.36 });
  for (const x of [-2.6, 0, 2.6]) {
    k.lathe(C.white, [[0.06, 0.3], [0.035, 7.6], [0, 7.6]], x, 0, 10.4, { seg: 6 });
    k.ball(C.brass, 0.08, x, 7.66, 10.4, { detail: 0, mat: 'metal' });
  }
  k.flag([C.green, C.cream, C.green], 1.5, 1.0, -2.57, 6.45, 10.4, 5, { mat: 'std' });
  k.flag([C.navy, C.white, C.red], 1.5, 1.0, 0.03, 6.45, 10.4, 5);
  k.flag([0xf3c632, C.green], 1.5, 1.0, 2.63, 6.45, 10.4, 5, { mat: 'std' });
  for (let i = 0; i < 7; i++) flowerClump(k, -3.3 + i * 1.1, 0.28, 10.4 + (i % 2 ? 0.5 : -0.5), 0.42, [0xd8322e, 0xf6f1ea], 2);
  for (const s of [-1, 1]) vicLamp(k, s * 5.4, 9.0, 3.8);
  // ---- main block
  k.sec('main');
  block(k, main, P, mainH, wall, { plinth: stone, band: stone, bandY: [P + G - 0.18] });
  k.boxb(stone, bw(main) + 0.4, 0.45, bd(main) + 0.4, 0, P + mainH - 0.45, bcz(main));
  k.at(0, 0, bcz(main), 0, () => hipRoof(k, bw(main), bd(main), P + mainH, 3.6, { roof, over: 0.5, trim: stone }));
  // central bay
  block(k, bay, P, mainH, wall, { plinth: stone, quoin: stone });
  k.boxb(stone, bw(bay) + 0.4, 0.45, bd(bay) + 0.4, 0, P + mainH - 0.45, bcz(bay));
  k.at(0, 0, -1.4, PI / 2, () => gableRoof(k, 4.0, bw(bay), P + mainH, 2.8, { roof, wall: stone, trim: stone, over: 0.4, overX: 0.3 }));
  k.at(0, P + mainH + 1.0, 0.62, 0, () => crest(k, 1.2));
  k.cyl(C.white, 0.04, 2.8, 0, P + mainH + 2.9, -1.4, { seg: 5 });
  k.flag([C.green, C.cream, C.green], 1.2, 0.8, 0.03, P + mainH + 4.85, -1.4, 5);
  // towers + wings
  k.sec('towers');
  for (const t of towers) {
    block(k, t, P, towH, wall, { plinth: stone, quoin: stone, band: stone, bandY: [P + G - 0.18, P + G + U * 4 - 0.1] });
    k.boxb(stone, bw(t) + 0.45, 0.5, bd(t) + 0.45, bcx(t), P + towH - 0.5, bcz(t));
    k.at(bcx(t), 0, bcz(t), 0, () => hipRoof(k, bw(t), bd(t), P + towH, 4.6, { roof, over: 0.45, trim: stone, ridgeFrac: 0.15 }));
    k.cyl(C.brass, 0.05, 1.4, bcx(t), P + towH + 4.4, bcz(t), { seg: 4, mat: 'metal', rt: 0.01 });
    k.ball(C.brass, 0.14, bcx(t), P + towH + 4.6, bcz(t), { detail: 0, mat: 'metal' });
  }
  for (const w of wings) {
    block(k, w, P, wingH, wall, { plinth: stone, band: stone, bandY: [P + G - 0.18] });
    k.boxb(stone, bw(w) + 0.3, 0.4, bd(w) + 0.3, bcx(w), P + wingH - 0.4, bcz(w));
    k.at(bcx(w), 0, bcz(w), 0, () => hipRoof(k, bw(w), bd(w), P + wingH, 2.2, { roof, over: 0.4, trim: stone }));
  }
  // ---- windows
  k.sec('windows');
  const fw = (face: Face, b: Box2, us: number[], floors: number[], o: { sill?: boolean; tall?: boolean } = {}) => {
    for (const f of floors) {
      const y = f === 0 ? P + 0.9 : P + G + (f - 1) * U + 0.55;
      const h = f === 0 ? 2.4 : o.tall ? 2.3 : 1.8;
      for (const u of us) onWall(k, b, face, u, y, () => liteWin(k, 1.1, h, { frame: trim, sill: o.sill ? stone : null, glass: glassC }));
    }
  };
  const up = [1, 2, 3, 4];
  fw('f', main, [-9.6, -7.6, -5.6, 5.6, 7.6, 9.6], [0], { sill: true });
  fw('f', main, [-9.6, -7.6, -5.6, 5.6, 7.6, 9.6], up, { tall: true });
  fw('b', main, [-9.6, -7.2, -4.8, -2.4, 0, 2.4, 4.8, 7.2, 9.6], [0, 1, 2, 3, 4]);
  fw('f', bay, [-2.6, 0, 2.6], up, { sill: true });
  for (const t of towers) {
    const s = Math.sign(bcx(t));
    fw('f', t, [bcx(t) - 1.1, bcx(t) + 1.1], [0, 1, 2, 3, 4, 5], { sill: true });
    fw(s > 0 ? 'r' : 'l', t, [-3.4, -0.6], [0, 1, 2, 3, 4, 5], { sill: true });
    fw(s > 0 ? 'l' : 'r', t, [0.0], [1, 2, 3, 4, 5]);
  }
  for (const w of wings) {
    const s = Math.sign(bcx(w));
    fw(s > 0 ? 'r' : 'l', w, [-9.4, -6.6], [0, 1, 2, 3]);
    fw('b', w, [bcx(w) - 1.0, bcx(w) + 1.0], [0, 1, 2, 3]);
  }
  // balconies on the main front
  k.sec('balconies');
  for (const s of [-1, 1])
    for (const f of up) {
      const y = P + G + (f - 1) * U + 0.05;
      const cx = s * 7.6;
      k.box(stone, 6.4, 0.16, 1.1, cx, y, main.z1 + 0.55);
      k.box(C.trim, 6.4, 0.07, 0.08, cx, y + 1.05, main.z1 + 1.06);
      k.box(C.glass, 6.3, 0.85, 0.03, cx, y + 0.55, main.z1 + 1.06, { mat: 'glass' });
      for (let p2 = 0; p2 <= 4; p2++) k.box(C.trim, 0.06, 0.95, 0.06, cx - 3.15 + p2 * 1.575, y + 0.55, main.z1 + 1.08, { nb: true });
      for (const e of [-1, 1]) k.box(C.trim, 0.05, 1.0, 1.0, cx + e * 3.18, y + 0.55, main.z1 + 0.55, { nb: true });
    }
  // dormers
  k.sec('dormers');
  for (const x of [-8.4, -6.0, 6.0, 8.4]) k.at(x, P + mainH + 0.15, main.z1 - 0.25, 0, () => dormer(k, 1.3, 1.5, 2.2, wall, roof, trim));
  for (const x of [-5, 0, 5]) k.at(x, P + mainH + 0.15, main.z0 + 0.25, PI, () => dormer(k, 1.3, 1.5, 2.2, wall, roof, trim));
  for (const x of [-7.5, -2.5, 2.5, 7.5]) chimney(k, x, P + mainH + 2.0, -7.6, 2.4, 0.9, 0.6);
  // ---- porte-cochere + entrance
  k.sec('porte');
  const cz0 = 0.4;
  const cz1 = 7.8;
  k.boxb(stone, 10.4, 0.85, cz1 - cz0, 0, 4.45, (cz0 + cz1) / 2);
  k.boxb(trim, 10.6, 0.14, cz1 - cz0 + 0.2, 0, 5.3, (cz0 + cz1) / 2 + 0.1);
  k.box(0x8f8a82, 9.8, 0.02, cz1 - cz0 - 0.6, 0, 5.45, (cz0 + cz1) / 2 + 0.2, { nb: true });
  for (const x of [-3.6, 3.6]) for (const z of [2.2, 6.6]) {
    k.tbox(C.stoneL, 0.9, 0.5, 0.9, x, 5.44, z, 0.04);
    blob(k, k.jc(0x2f6a2d, 0.08), 0.5, x, 6.2, z, { detail: 0 });
  }
  railing(k, [-5.1, cz1 + 0.05], [5.1, cz1 + 0.05], 5.44, 0.7, { col: stone, panel: stone, post: 1.7 });
  for (const s of [-1, 1]) railing(k, [s * 5.1, cz0 + 0.3], [s * 5.1, cz1 + 0.05], 5.44, 0.7, { col: stone, panel: stone, post: 2.4 });
  for (const s of [-1, 1])
    for (const z of [3.8, 7.3]) {
      k.tbox(stone, 0.8, 0.5, 0.8, s * 4.6, 0, z, 0.04);
      k.boxb(trim, 0.55, 3.5, 0.55, s * 4.6, 0.5, z);
      k.boxb(stone, 0.75, 0.45, 0.75, s * 4.6, 4.0, z);
    }
  for (let i = 0; i < 7; i++) k.box(C.brass, 0.42, 0.45, 0.04, -1.5 + i * 0.5, 4.9, cz1 + 0.04, { mat: 'metal' });
  for (const z of [2.0, 4.0, 6.0]) for (const x of [-2.5, 2.5]) k.cyl(C.glow, 0.15, 0.03, x, 4.42, z, { seg: 8, mat: 'glow' });
  for (const x of [-2.6, 0, 2.6]) onWall(k, bay, 'f', x, P, () => door(k, 1.7, 2.9, { col: 0x2f3a33, double: true, glazed: true, frame: stone }));
  for (let i = 0; i < 3; i++) k.tbox(C.stoneL, 9.6, P - i * 0.2, 0.45, 0, 0, cz0 + 0.22 + i * 0.45, 0.02);
  k.box(0x9b2230, 1.6, 0.02, 1.6, 0, P + 0.01, cz0 + 0.7, { rx: 0.3 });
  for (const s of [-1, 1]) {
    k.lathe([0x3b3f42, 0x3b3f42], [[0.25, 0], [0.32, 0.55], [0.28, 0.55]], s * 5.6, 0.06, 1.2, { seg: 8 });
    blob(k, 0x2f6a2d, 0.4, s * 5.6, 1.1, 1.2, { detail: 1, jit: 0.08 });
  }
});

// ================================================================================================
// COURSE PROPS
// ================================================================================================
def('ball_washer', (k) => {
  k.tbox(C.stone, 0.9, 0.05, 0.9, 0, 0, 0, 0.02);
  k.boxb(C.green, 0.1, 0.92, 0.1, 0, 0.05, 0);
  k.box(C.brass, 0.07, 0.1, 0.01, 0, 0.55, 0.055, { mat: 'metal' });
  // washer housing
  k.cbox(C.green, 0.36, 0.34, 0.2, 0, 1.12, 0, 0.04);
  k.cbox(C.greenL, 0.3, 0.28, 0.22, 0, 1.12, 0, 0.03);
  k.box(C.white, 0.14, 0.1, 0.012, 0, 1.15, 0.115);
  // plunger handle
  k.cyl(C.steel, 0.018, 0.32, 0, 1.29, 0, { seg: 5, mat: 'metal' });
  k.box(0x2b2b2b, 0.2, 0.05, 0.05, 0, 1.63, 0);
  // towel on a hook
  k.tube(C.steelD, [0.19, 1.05, 0], [0.26, 1.05, 0], 0.01, { seg: 3, mat: 'metal' });
  k.box(C.white, 0.03, 0.26, 0.14, 0.27, 0.95, 0.0, { rz: 0.05 });
  k.box(C.white, 0.03, 0.2, 0.14, 0.24, 0.98, 0.0, { rz: -0.05 });
  // small tee-box bin
  k.cbox(0x2b2b2b, 0.22, 0.26, 0.18, -0.24, 0.55, 0, 0.03);
  k.box(C.green, 0.08, 0.03, 0.1, -0.13, 0.62, 0);
});

def('tee_sign', (k) => {
  k.tbox(C.stone, 1.5, 0.06, 0.7, 0, 0, 0, 0.02);
  for (const x of [-0.48, 0.48]) {
    k.boxb(C.timberD, 0.12, 1.15, 0.12, x, 0.06, -0.05);
    k.hull(C.timberD, [[-0.07, 0, -0.07], [0.07, 0, -0.07], [-0.07, 0, 0.07], [0.07, 0, 0.07], [0, 0.08, 0]], x, 1.21, -0.05);
  }
  k.push(0, 0.95, 0.0, 0, 1, -0.38);
  k.cbox(C.timber, 1.0, 0.68, 0.07, 0, 0, 0, 0.02);
  k.box(C.green, 0.88, 0.56, 0.02, 0, 0, 0.04);
  // hole layout
  k.extZ(0x5fae46, [[-0.08, -0.22], [0.04, -0.22], [0.1, -0.05], [0.2, 0.1], [0.24, 0.2], [0.14, 0.22], [0.06, 0.08], [-0.06, -0.06]], 0.05, 0.056);
  k.lathe(0x7fca5e, [[0.065, 0], [0, 0.002]], 0.2, 0.2, 0.058, { seg: 8, rx: PI / 2 });
  k.lathe(C.sand, [[0.035, 0], [0, 0.002]], 0.12, 0.05, 0.058, { seg: 6, rx: PI / 2 });
  k.lathe(C.sand, [[0.03, 0], [0, 0.002]], 0.25, 0.08, 0.058, { seg: 6, rx: PI / 2 });
  k.lathe(C.water, [[0.06, 0], [0, 0.002]], -0.16, 0.0, 0.058, { seg: 6, rx: PI / 2, sx: 1.4 });
  k.box(C.white, 0.05, 0.03, 0.006, -0.02, -0.2, 0.058);
  k.box(C.brass, 0.22, 0.14, 0.012, -0.28, 0.17, 0.056, { mat: 'metal' });
  k.box(C.cream, 0.22, 0.03, 0.006, -0.28, -0.12, 0.056);
  k.box(C.cream, 0.18, 0.03, 0.006, -0.3, -0.18, 0.056);
  k.pop();
  // little roof cap
  k.box(C.timberD, 1.2, 0.05, 0.42, 0, 1.36, -0.1, { rx: -0.2 });
  for (let i = 0; i < 3; i++) flowerClump(k, -0.4 + i * 0.4, 0.04, 0.25, 0.16, [0xd8322e, 0xf6f1ea, 0xf3c632], 2);
});

def('yardage_post', (k) => {
  k.lathe(C.concrete, [[0.2, 0], [0.2, 0.06], [0, 0.06]], 0, 0, 0, { seg: 8 });
  k.boxb(C.white, 0.12, 0.7, 0.12, 0, 0.06, 0);
  for (const [y, c] of [[0.35, C.red], [0.5, C.white], [0.6, 0x2f63b8]] as [number, number][]) k.boxb(c, 0.135, 0.08, 0.135, 0, y, 0);
  k.hull(C.red, [[-0.08, 0, -0.08], [0.08, 0, -0.08], [-0.08, 0, 0.08], [0.08, 0, 0.08], [0, 0.09, 0]], 0, 0.76, 0);
});

def('drinking_fountain', (k) => {
  k.tbox(C.stone, 1.8, 0.05, 1.1, 0.25, 0, 0, 0.02);
  // stone pedestal fountain
  k.lathe([C.stoneD, C.stone, C.stone, C.stone, C.stone, C.stoneL], [[0.28, 0.05], [0.28, 0.16], [0.2, 0.22], [0.16, 0.6], [0.22, 0.75], [0.3, 0.86], [0.3, 0.92]], -0.25, 0, 0, { seg: 8 });
  k.lathe([C.steel, C.steel], [[0.28, 0.92], [0.26, 0.97], [0.05, 0.9], [0, 0.9]], -0.25, 0, 0, { seg: 10, mat: 'metal' });
  k.lathe(C.water, [[0.22, 0.94], [0, 0.94]], -0.25, 0, 0, { seg: 10, mat: 'water' });
  k.tube(C.steel, [-0.25, 0.92, -0.18], [-0.25, 1.05, -0.12], 0.02, { seg: 4, mat: 'metal' });
  k.tube(C.steel, [-0.25, 1.05, -0.12], [-0.25, 1.02, -0.05], 0.015, { seg: 4, mat: 'metal' });
  k.box(C.brass, 0.08, 0.05, 0.05, -0.25, 0.86, 0.3, { mat: 'metal' });
  // water cooler on a stand
  k.tbox(C.timberD, 0.4, 0.55, 0.38, 0.6, 0.05, 0, 0.02);
  k.cbox(0xeeeeea, 0.34, 0.6, 0.32, 0.6, 0.9, 0, 0.03);
  k.box(0x2f63b8, 0.04, 0.06, 0.04, 0.53, 0.86, 0.17);
  k.box(C.red, 0.04, 0.06, 0.04, 0.67, 0.86, 0.17);
  k.box(0x9aa1a7, 0.2, 0.02, 0.1, 0.6, 0.74, 0.14);
  k.lathe([0x7ab4e0, 0x7ab4e0, 0x7ab4e0], [[0.04, 1.2], [0.15, 1.27], [0.15, 1.55], [0.04, 1.62]], 0.6, 0, 0, { seg: 10, mat: 'water' });
  k.cyl(0xf3f1ea, 0.04, 0.3, 0.84, 0.75, 0.0, { seg: 6 });
});

def('shelter', (k) => {
  const wood = 0x9a6b42;
  const dark = 0x6b4628;
  const roof = 0x24563a;
  k.tbox(C.stone, 6.6, 0.16, 5.0, 0, 0, -0.3, 0.03);
  k.tbox(C.stoneL, 2.0, 0.08, 0.5, 0, 0, 2.45, 0.02);
  const posts: V2[] = [[-2.9, 1.9], [0, 1.9], [2.9, 1.9], [-2.9, -2.5], [0, -2.5], [2.9, -2.5]];
  for (const [x, z] of posts) {
    k.boxb(dark, 0.22, 2.5, 0.22, x, 0.16, z);
    k.tbox(C.stoneD, 0.32, 0.12, 0.32, x, 0.16, z, 0.02);
  }
  for (const z of [1.9, -2.5]) {
    k.box(dark, 6.2, 0.24, 0.2, 0, 2.74, z);
    for (const x of [-2.9, 0, 2.9])
      for (const sd of [-1, 1]) if (Math.abs(x + sd * 0.6) < 3.0) k.tube(dark, [x, 2.15, z], [x + sd * 0.6, 2.66, z], 0.05, { seg: 4 });
  }
  for (const x of [-2.9, 2.9]) k.box(dark, 0.18, 0.2, 4.6, x, 2.74, -0.3);
  // back wall (planks) + side half walls
  for (let i = 0; i < 9; i++) k.box(k.jc(wood, 0.05), 5.8, 0.22, 0.06, 0, 0.32 + i * 0.25, -2.5);
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) k.box(k.jc(wood, 0.05), 0.06, 0.22, 4.2, s * 2.9, 0.32 + i * 0.25, -0.3);
  // roof
  k.at(0, 0, -0.3, 0, () => gableRoof(k, 6.0, 4.4, 2.86, 1.7, { roof, wall: wood, trim: C.cream, over: 0.55, overX: 0.45, ridge: shade(roof, 0.8), courses: 4 }));
  // benches
  k.at(0, 0.16, -2.05, 0, () => parkBench(k, 4.6, 0xb5814f));
  k.at(-2.45, 0.16, -0.1, PI / 2, () => parkBench(k, 2.4, 0xb5814f));
  k.at(2.45, 0.16, -0.1, -PI / 2, () => parkBench(k, 2.4, 0xb5814f));
  // notice board + bell
  k.box(C.green, 1.0, 0.7, 0.05, 1.5, 1.7, -2.44);
  k.box(C.cream, 0.36, 0.46, 0.01, 1.3, 1.7, -2.41);
  k.box(0xf2e6a8, 0.3, 0.3, 0.01, 1.75, 1.75, -2.41);
  k.lathe(C.brass, [[0.0, 0], [0.13, 0], [0.1, 0.12], [0.06, 0.2], [0, 0.22]], 2.9, 2.2, 2.18, { seg: 8, mat: 'metal' });
  k.tube(C.iron, [2.9, 2.62, 2.0], [2.9, 2.42, 2.18], 0.02, { seg: 3 });
  // sign over the front
  k.box(C.green, 1.6, 0.36, 0.05, 0, 3.15, 2.15);
  k.box(C.cream, 1.3, 0.06, 0.01, 0, 3.15, 2.18);
  k.lathe(C.green, [[0, 0], [0.2, 0], [0.22, 0.75], [0.23, 0.82], [0, 0.84]], 3.4, 0, 1.4, { seg: 10 });
});

def('halfway_house', (k) => {
  const wall = C.cream;
  const trim = C.trim;
  const roof = 0x24563a;
  const b: Box2 = { x0: -3.6, x1: 3.6, z0: -4.6, z1: 0.6 };
  const P = 0.25;
  const H = 2.9;
  k.sec('house');
  block(k, b, P, H, wall, { plinth: C.stone, quoin: C.timberD });
  k.boxb(C.timberD, bw(b) + 0.08, 0.14, bd(b) + 0.08, 0, P + H - 0.14, bcz(b));
  k.at(0, 0, bcz(b), 0, () => gableRoof(k, bw(b), bd(b), P + H, 2.1, { roof, wall: 0xe5d6b4, trim, over: 0.5, overX: 0.45, ridge: shade(roof, 0.8), courses: 4 }));
  chimney(k, -2.6, P + H + 0.4, -3.2, 2.2, 0.6, 0.5);
  // serving hatch with counter + awning
  k.sec('hatch');
  const fz = b.z1;
  k.box(0x3a2a20, 2.4, 1.2, 0.04, 0.9, P + 1.65, fz + 0.005);
  room(k, -0.3, 2.1, P + 1.05, P + 2.25, fz - 1.2, fz - 0.05, 0x8a6a4a);
  k.boxb(trim, 2.6, 0.12, 0.12, 0.9, P + 2.25, fz + 0.06);
  for (const x of [-0.36, 2.16]) k.boxb(trim, 0.12, 1.2, 0.12, x, P + 1.05, fz + 0.06);
  k.box(C.timber, 2.7, 0.08, 0.5, 0.9, P + 1.05, fz + 0.2);
  for (const x of [0.0, 1.8]) k.tube(C.iron, [x, P + 0.7, fz], [x, P + 1.0, fz + 0.35], 0.02, { seg: 3 });
  k.box(0x6b4a30, 2.4, 0.05, 0.2, 0.9, P + 2.1, fz - 0.6);
  for (let i = 0; i < 4; i++) {
    k.lathe(i % 2 ? 0xc0392b : 0x2f63b8, [[0, 0], [0.035, 0], [0.035, 0.12], [0, 0.12]], 0.3 + i * 0.35, P + 1.09, fz + 0.2, { seg: 6 });
  }
  k.lathe(0xd8c08a, [[0, 0], [0.12, 0], [0.13, 0.05], [0, 0.06]], 1.75, P + 1.09, fz + 0.15, { seg: 6 });
  k.at(0.9, 0, fz + 0.06, 0, () => awning(k, 2.9, P + 2.75, 0.95, 0.4, C.green, C.cream, 7));
  // door, windows, menu board
  onWall(k, b, 'f', -2.3, P, () => door(k, 0.95, 2.1, { col: C.green, frame: trim, glazed: true }));
  wallLamp(k, -1.55, P + 2.2, fz);
  k.box(0x2a2e2b, 0.7, 0.9, 0.04, 2.95, P + 1.55, fz + 0.04);
  k.box(C.timber, 0.78, 0.98, 0.03, 2.95, P + 1.55, fz + 0.02);
  for (let i = 0; i < 4; i++) k.box(C.white, 0.45 - (i % 2) * 0.12, 0.03, 0.005, 2.95, P + 1.85 - i * 0.16, fz + 0.065);
  for (const fc of ['l', 'r'] as Face[]) onWall(k, b, fc, -2.0, P + 0.9, () => win(k, 0.9, 1.2, { frame: trim, cols: 2, rows: 2, shutters: C.green, box: [0xd8322e, 0xf6f1ea, 0xf3c632] }));
  onWall(k, b, 'b', 1.2, P + 0.9, () => liteWin(k, 0.9, 1.2, { frame: trim, mull: true }));
  // picnic tables + bin + path
  k.sec('yard');
  for (let i = 0; i < 4; i++) k.tbox(k.jc(C.stone, 0.06), 0.9, 0.05, 0.65, 0.9 + (i % 2) * 0.2, 0, 1.2 + i * 0.95, 0.02);
  k.at(-2.6, 0, 3.4, 0.15, () => picnicTable(k));
  k.at(3.4, 0, 3.6, -0.2, () => picnicTable(k));
  k.cyl(C.white, 0.03, 2.2, 3.4, 0.78, 3.6, { seg: 4 });
  k.lathe([C.green], [[0, 2.85], [1.35, 2.35]], 3.4, 0, 3.6, { seg: 8, flat: true });
  k.lathe([C.cream], [[1.35, 2.35], [0, 2.8]], 3.4, 0, 3.6, { seg: 8, flat: true });
  k.lathe([C.green, C.green, C.black], [[0, 0], [0.2, 0], [0.22, 0.8], [0.23, 0.86], [0, 0.88]], 4.6, 0, 1.2, { seg: 10 });
  flowerClump(k, -3.9, 0, 1.2, 0.5, [0xd8322e, 0xf6f1ea, 0xf3c632], 4);
  flowerClump(k, 4.5, 0, -0.5, 0.5, [0xd8322e, 0xf6f1ea, 0xe77fa8], 4);
});

// ================================================================================================
// SCENERY FEATURES
// ================================================================================================
def('fountain', (k) => {
  const st = C.stone;
  const stL = C.stoneL;
  k.lathe(C.stoneD, [[3.75, 0], [3.75, 0.03], [0, 0.03]], 0, 0, 0, { seg: 24 });
  // basin
  k.lathe([st, stL, stL, st], [[3.5, 0.0], [3.5, 0.55], [3.55, 0.6], [3.25, 0.68], [3.15, 0.55]], 0, 0, 0, { seg: 28 });
  k.lathe(C.waterD, [[3.18, 0.1], [0, 0.1]], 0, 0, 0, { seg: 24 });
  k.lathe(C.water, [[3.2, 0.45], [0, 0.45]], 0, 0, 0, { seg: 28, mat: 'water' });
  // central column with tiers
  k.lathe([st, stL, st, stL, st], [[0.55, 0.05], [0.55, 0.7], [0.4, 0.8], [0.32, 1.3], [0.42, 1.45], [0.25, 1.55]], 0, 0, 0, { seg: 10 });
  const bowl = (y: number, R: number, depth: number, seg: number) => {
    k.lathe([stL, st, st, stL], [[0.25, y - depth], [R * 0.7, y - depth * 0.5], [R, y - 0.05], [R, y + 0.08], [R * 0.93, y + 0.1]], 0, 0, 0, { seg });
    k.lathe(C.water, [[R * 0.93, y + 0.04], [0, y + 0.04]], 0, 0, 0, { seg, mat: 'water' });
  };
  bowl(1.95, 1.6, 0.4, 20);
  k.lathe([st, stL, st], [[0.24, 1.95], [0.2, 2.5], [0.3, 2.62], [0.16, 2.75]], 0, 0, 0, { seg: 8 });
  bowl(3.0, 0.85, 0.28, 14);
  k.lathe([st, stL, st, stL], [[0.14, 3.0], [0.12, 3.35], [0.2, 3.42], [0.08, 3.6], [0, 3.75]], 0, 0, 0, { seg: 8 });
  // water curtains
  k.lathe(C.water, [[1.62, 1.98], [1.75, 1.2], [1.95, 0.48]], 0, 0, 0, { seg: 20, mat: 'water' });
  k.lathe(C.water, [[0.87, 3.03], [0.93, 2.5], [1.05, 2.0]], 0, 0, 0, { seg: 14, mat: 'water' });
  k.lathe(C.water, [[0.03, 3.75], [0.1, 4.05], [0.16, 3.75], [0.3, 3.2]], 0, 0, 0, { seg: 6, mat: 'water' });
  // lily pads + rim planters
  for (const a of [0.6, 2.4, 4.1]) {
    k.cyl(0x4f8e3a, 0.25, 0.01, Math.sin(a) * 2.5, 0.45, Math.cos(a) * 2.5, { seg: 7, caps: 'top' });
  }
});

def('gazebo', (k) => {
  const white = 0xf6f4ee;
  const roof = 0x24563a;
  const R = 4.2;
  const P = 0.45;
  k.lathe([C.stone, C.stoneL, C.stoneL], [[R + 0.2, 0], [R + 0.2, P - 0.05], [R + 0.15, P], [0, P]], 0, 0, 0, { seg: 8, phase: PI / 8 });
  for (let i = 0; i < 3; i++) k.tbox(C.stoneL, 2.4, P - i * 0.15, 0.36, 0, 0, R * Math.cos(PI / 8) + 0.3 + i * 0.34, 0.02);
  const H = 2.9;
  const cols: V3[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + PI / 8;
    const p: V3 = [Math.sin(a) * (R - 0.25), P, Math.cos(a) * (R - 0.25)];
    cols.push(p);
    column(k, p[0], P, p[2], H, white, 0.12, 6);
  }
  // balustrades between columns, front (+Z) left open
  for (let i = 0; i < 8; i++) {
    const a = cols[i];
    const b2 = cols[(i + 1) % 8];
    const mid = (Math.atan2((a[0] + b2[0]) / 2, (a[2] + b2[2]) / 2) + TAU) % TAU;
    if (mid < 0.3 || mid > TAU - 0.3) continue;
    railing(k, [a[0], a[2]], [b2[0], b2[2]], P, 0.85, { col: white, baluster: 0.22, post: 9 });
  }
  // ring beam + roof
  k.lathe([white, white], [[R + 0.05, P + H], [R + 0.05, P + H + 0.3], [R - 0.4, P + H + 0.3]], 0, 0, 0, { seg: 8, phase: PI / 8 });
  k.lathe(white, [[R - 0.45, P + H + 0.0], [R + 0.05, P + H]], 0, 0, 0, { seg: 8, phase: PI / 8 });
  k.lathe([roof, roof, roof], [[R + 0.55, P + H + 0.2], [R + 0.5, P + H + 0.36], [1.0, P + H + 2.5], [0.55, P + H + 2.75]], 0, 0, 0, { seg: 8, phase: PI / 8, flat: true });
  k.lathe(0xe9e2cf, [[0.8, P + H + 2.45], [R + 0.45, P + H + 0.22]], 0, 0, 0, { seg: 8, phase: PI / 8, flat: true });
  // brackets
  for (const p of cols) k.tube(white, [p[0] * 0.94, P + H - 0.5, p[2] * 0.94], [p[0] * 1.06, P + H + 0.05, p[2] * 1.06], 0.04, { seg: 4 });
  // cupola + finial
  const cy = P + H + 2.7;
  k.cyl(white, 0.5, 0.6, 0, cy, 0, { seg: 8, phase: PI / 8 });
  k.lathe(roof, [[0.75, cy + 0.6], [0.12, cy + 1.2], [0, cy + 1.25]], 0, 0, 0, { seg: 8, phase: PI / 8, flat: true });
  k.lathe(C.brass, [[0, cy + 1.2], [0.08, cy + 1.3], [0, cy + 1.6]], 0, 0, 0, { seg: 6, mat: 'metal' });
  // bench inside + lantern
  k.at(0, P, -2.4, 0, () => parkBench(k, 2.2, 0xb5814f));
  k.cyl(C.iron, 0.01, 0.6, 0, P + H + 0.0, 0, { seg: 3 });
  k.lathe(C.glow, [[0.12, P + H - 0.3], [0.15, P + H - 0.05], [0, P + H]], 0, 0, 0, { seg: 6, mat: 'glow' });
  for (const s of [-1, 1]) flowerClump(k, s * 1.8, 0, R + 0.5, 0.55, [0xd8322e, 0xf6f1ea, 0xe77fa8, 0x9466c6], 4);
});

def('statue', (k) => {
  const bronze = 0x8c6a3c;
  const bm = { mat: 'metal' as const };
  // stepped plinth with plaque
  k.tbox(C.stoneD, 1.8, 0.2, 1.8, 0, 0, 0, 0.03);
  k.tbox(C.stone, 1.4, 1.05, 1.4, 0, 0.2, 0, 0.04);
  k.tbox(C.stoneL, 1.56, 0.15, 1.56, 0, 1.25, 0, 0.04);
  k.box(C.brass, 0.66, 0.3, 0.03, 0, 0.75, 0.715, { mat: 'metal' });
  k.box(0x6b5a2e, 0.5, 0.035, 0.01, 0, 0.8, 0.732);
  k.box(0x6b5a2e, 0.36, 0.035, 0.01, 0, 0.71, 0.732);
  const B = 1.4;
  k.cyl(bronze, 0.5, 0.06, 0, B, 0, { seg: 10, ...bm });
  // golfer holding the finish of a swing: faces +Z at address, target is +X
  const y0 = B + 0.06;
  const hipY = y0 + 0.88;
  const lHip: V3 = [0.11, hipY, 0.0];
  const rHip: V3 = [-0.11, hipY, 0.0];
  const lKnee: V3 = [0.15, y0 + 0.47, 0.06];
  const rKnee: V3 = [0.02, y0 + 0.44, 0.1];
  const lAnk: V3 = [0.17, y0 + 0.07, 0.04];
  const rAnk: V3 = [-0.12, y0 + 0.1, -0.02];
  k.tube(bronze, lHip, lKnee, 0.1, { seg: 6, r1: 0.075, ...bm });
  k.tube(bronze, lKnee, lAnk, 0.075, { seg: 6, r1: 0.055, ...bm });
  k.tube(bronze, rHip, rKnee, 0.1, { seg: 6, r1: 0.075, ...bm });
  k.tube(bronze, rKnee, rAnk, 0.075, { seg: 6, r1: 0.055, ...bm });
  k.box(bronze, 0.13, 0.08, 0.28, lAnk[0] + 0.02, y0 + 0.04, lAnk[2] + 0.07, { ...bm, ry: 0.5 });
  k.box(bronze, 0.11, 0.08, 0.26, rAnk[0] + 0.02, y0 + 0.09, rAnk[2] + 0.02, { ...bm, rx: -0.75, ry: 0.9 });
  k.hull(bronze, [[-0.17, -0.08, -0.11], [0.17, -0.08, -0.11], [-0.17, -0.08, 0.11], [0.17, -0.08, 0.11], [-0.16, 0.12, -0.12], [0.16, 0.12, -0.12], [-0.16, 0.12, 0.12], [0.16, 0.12, 0.12]], 0, hipY, 0, { ...bm, ry: 0.6 });
  // torso turned to face the target, leaning back slightly
  k.push(0, hipY + 0.08, 0, 1.25, 1, -0.16);
  k.hull(bronze, [
    [-0.15, 0, -0.1], [0.15, 0, -0.1], [-0.15, 0, 0.1], [0.15, 0, 0.1],
    [-0.21, 0.42, -0.12], [0.21, 0.42, -0.12], [-0.21, 0.42, 0.12], [0.21, 0.42, 0.12],
    [-0.15, 0.56, -0.08], [0.15, 0.56, -0.08], [-0.15, 0.56, 0.08], [0.15, 0.56, 0.08],
  ], 0, 0, 0, bm);
  k.cyl(bronze, 0.055, 0.1, 0, 0.55, 0, { seg: 6, ...bm });
  k.ball(bronze, 0.115, 0.0, 0.76, 0.01, { detail: 1, smooth: true, sy: 1.1, ...bm });
  k.lathe(bronze, [[0.125, 0.8], [0.115, 0.86], [0.06, 0.9], [0, 0.91]], 0, 0, 0, { seg: 8, ...bm });
  k.box(bronze, 0.15, 0.02, 0.12, 0, 0.81, 0.13, { ...bm, rx: 0.15 });
  // arms up over the lead (left) shoulder; club wraps behind the head
  const lSh: V3 = [0.21, 0.46, 0.0];
  const rSh: V3 = [-0.21, 0.46, 0.0];
  const hands: V3 = [0.18, 0.86, -0.12];
  const lEl: V3 = [0.4, 0.62, -0.08];
  const rEl: V3 = [0.02, 0.62, 0.22];
  k.tube(bronze, lSh, lEl, 0.065, { seg: 6, r1: 0.055, ...bm });
  k.tube(bronze, lEl, hands, 0.055, { seg: 6, r1: 0.045, ...bm });
  k.tube(bronze, rSh, rEl, 0.065, { seg: 6, r1: 0.055, ...bm });
  k.tube(bronze, rEl, hands, 0.055, { seg: 6, r1: 0.045, ...bm });
  k.ball(bronze, 0.06, hands[0], hands[1], hands[2], { detail: 0, ...bm });
  const clubEnd: V3 = [-0.55, 0.5, -0.62];
  k.tube(bronze, hands, clubEnd, 0.018, { seg: 4, r1: 0.012, ...bm });
  k.box(bronze, 0.18, 0.06, 0.09, clubEnd[0] - 0.05, clubEnd[1] - 0.02, clubEnd[2] - 0.02, { ...bm, ry: 0.7 });
  k.pop();
  for (const s2 of [-1, 1]) flowerClump(k, s2 * 0.7, 0.2, 0.85, 0.22, [0xd8322e, 0xf6f1ea], 2);
});
def('windmill', (k) => {
  const white = 0xf3efe6;
  const cap = 0x4b3424;
  k.tbox(C.stoneD, 6.4, 0.5, 6.4, 0, 0, 0, 0.05);
  const H = 9.4;
  k.lathe([white, white], [[2.8, 0.5], [2.45, 4.5], [1.75, H]], 0, 0, 0, { seg: 8, phase: PI / 8, flat: true });
  k.lathe(0x8f8679, [[2.85, 0.5], [2.85, 1.1], [2.8, 1.15]], 0, 0, 0, { seg: 8, phase: PI / 8, flat: true });
  // stage (gallery) with railing
  const sy = 3.1;
  k.lathe([C.timberD, C.timberD], [[3.65, sy], [3.65, sy + 0.18], [0, sy + 0.18]], 0, 0, 0, { seg: 8, phase: PI / 8, flat: true });
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * TAU + PI / 8;
    const a1 = ((i + 1) / 8) * TAU + PI / 8;
    const r = 3.55;
    railing(k, [Math.sin(a0) * r, Math.cos(a0) * r], [Math.sin(a1) * r, Math.cos(a1) * r], sy + 0.18, 0.9, { col: C.timberD, baluster: 0.45, post: 9 });
    k.tube(C.timberD, [Math.sin(a0) * 2.7, sy - 1.2, Math.cos(a0) * 2.7], [Math.sin(a0) * 3.5, sy, Math.cos(a0) * 3.5], 0.06, { seg: 4 });
  }
  // door + windows
  k.at(0, 0.5, 2.78, 0.0, () => {
    k.push(0, 0, 0, 0, 1, -0.08);
    door(k, 1.1, 2.1, { col: C.green, frame: C.timberD });
    k.pop();
  });
  for (const [a, y] of [[0, 4.6], [PI / 2, 5.6], [-PI / 2, 2.0], [PI, 6.6], [0, 7.0]] as V2[]) {
    const t = (y - 0.5) / (H - 0.5);
    const r = (2.8 + (1.75 - 2.8) * t) * Math.cos(PI / 8) - 0.02;
    k.push(Math.sin(a) * r, y, Math.cos(a) * r, a, 1, -0.08);
    liteWin(k, 0.55, 0.75, { frame: C.timberD, mull: true, sill: null });
    k.pop();
  }
  // cap (boat-shaped) + finial
  const cy = H;
  k.lathe(cap, [[1.95, cy], [1.95, cy + 0.25], [0, cy + 0.25]], 0, 0, 0, { seg: 8, phase: PI / 8, flat: true });
  k.hull(cap, [
    [-1.75, cy + 0.2, -2.1], [1.75, cy + 0.2, -2.1], [-1.75, cy + 0.2, 2.1], [1.75, cy + 0.2, 2.1],
    [-1.45, cy + 1.4, -1.9], [1.45, cy + 1.4, -1.9], [-1.45, cy + 1.4, 1.9], [1.45, cy + 1.4, 1.9],
    [-0.5, cy + 2.3, -1.6], [0.5, cy + 2.3, -1.6], [-0.5, cy + 2.3, 1.6], [0.5, cy + 2.3, 1.6],
  ], 0, 0, 0, { grad: [0.85, 1.1] });
  k.box(0x3a281b, 1.1, 0.12, 3.4, 0, cy + 2.32, 0);
  k.ball(C.brass, 0.14, 0, cy + 2.55, 0, { detail: 0, mat: 'metal' });
  // windshaft boss at the front
  const [rx, ry2, rz] = WINDMILL_ROTOR_POS;
  k.tube(0x3a281b, [rx, ry2, rz - 0.6], [rx, ry2, rz - 0.05], 0.28, { seg: 8, r1: 0.24 });
  // fantail at the back
  k.tube(C.timberD, [0, cy + 0.6, -2.0], [0, cy + 0.3, -3.2], 0.08, { seg: 4 });
  k.tube(C.timberD, [0, cy + 1.6, -1.9], [0, cy + 0.9, -3.2], 0.06, { seg: 4 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    k.box(white, 0.05, 0.12, 0.6, 0, cy + 0.9 + Math.cos(a) * 0.32, -3.25 + 0, { rx: a, sz: 1 });
  }
  for (const s of [-1, 1]) flowerClump(k, s * 2.0, 0.5, 2.6, 0.45, [0xd8322e, 0xf3c632, 0xf6f1ea], 3);
});

def('windmill_rotor', (k) => {
  const stock = 0x4b3424;
  const lat = 0xf1ece0;
  k.lathe([stock, stock, C.iron], [[0.32, -0.25], [0.32, 0.15], [0.2, 0.3], [0, 0.32]], 0, 0, 0, { seg: 8, rx: PI / 2 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + PI / 4;
    k.push(0, 0, 0.12, 0, 1, 0, a);
    // stock (spar) along +Y
    k.box(stock, 0.2, 5.6, 0.16, 0, 2.8, 0);
    // lattice frame on one side of the stock
    const w = 1.3;
    const y0 = 1.1;
    const y1 = 5.5;
    k.box(lat, 0.07, y1 - y0, 0.07, w, (y0 + y1) / 2, 0.02);
    k.box(lat, 0.05, y1 - y0, 0.05, w * 0.5, (y0 + y1) / 2, 0.02);
    const n = 12;
    for (let j = 0; j <= n; j++) k.box(lat, w + 0.1, 0.045, 0.045, w / 2 + 0.05, y0 + ((y1 - y0) * j) / n, 0.02);
    // leading-edge board on the other side
    k.box(lat, 0.3, y1 - y0 - 0.2, 0.04, -0.25, (y0 + y1) / 2 + 0.1, 0.0);
    k.pop();
  }
});

def('entrance_sign', (k) => {
  const st = 0xb3a994;
  k.sec('wall');
  k.tbox(C.stoneD, 8.4, 0.2, 1.1, 0, 0, -0.4, 0.03);
  k.boxb(st, 7.8, 1.5, 0.7, 0, 0.2, -0.4);
  // stone courses
  for (let r = 0; r < 4; r++)
    for (let i = 0; i < 9; i++) {
      const off = r % 2 ? 0.45 : 0;
      const x = -3.6 + i * 0.9 + off;
      if (x > 3.7) continue;
      k.box(k.jc(st, 0.08), 0.84, 0.32, 0.04, x, 0.4 + r * 0.36, -0.03);
    }
  k.tbox(C.stoneL, 8.0, 0.18, 0.86, 0, 1.7, -0.4, 0.04);
  for (const s of [-1, 1]) {
    k.tbox(st, 1.1, 2.3, 1.1, s * 4.3, 0.0, -0.4, 0.04);
    k.tbox(C.stoneL, 1.25, 0.18, 1.25, s * 4.3, 2.3, -0.4, 0.04);
    k.cyl(C.iron, 0.12, 0.2, s * 4.3, 2.48, -0.4, { seg: 6 });
    k.lathe(C.glow, [[0.16, 2.68], [0.2, 3.05], [0, 3.05]], s * 4.3, 0, -0.4, { seg: 4, phase: PI / 4, mat: 'glow', flat: true });
    k.lathe(C.iron, [[0.27, 3.05], [0.05, 3.3], [0, 3.38]], s * 4.3, 0, -0.4, { seg: 4, phase: PI / 4, flat: true });
    for (let i = 0; i < 4; i++) {
      const a = PI / 4 + (i * PI) / 2;
      k.tube(C.iron, [s * 4.3 + Math.sin(a) * 0.17, 2.68, -0.4 + Math.cos(a) * 0.17], [s * 4.3 + Math.sin(a) * 0.21, 3.05, -0.4 + Math.cos(a) * 0.21], 0.015, { seg: 3 });
    }
  }
  // plaque
  k.sec('plaque');
  k.box(C.brass, 4.3, 1.15, 0.08, 0, 1.05, -0.02, { mat: 'metal' });
  k.box(C.green, 4.1, 0.95, 0.06, 0, 1.05, 0.02);
  for (let i = 0; i < 9; i++) k.box(C.brass, 0.3, 0.34, 0.02, -1.6 + i * 0.4, 1.18, 0.055, { mat: 'metal' });
  k.box(C.brass, 2.6, 0.05, 0.02, 0, 0.82, 0.055, { mat: 'metal' });
  k.at(-1.95, 1.05, 0.05, 0, () => crest(k, 0.55));
  k.at(1.95, 1.05, 0.05, 0, () => crest(k, 0.55));
  // flower beds either side
  k.sec('beds');
  for (const s of [-1, 1]) {
    const pts: V2[] = smoothLoop([[s * 4.9, 0.2], [s * 5.9, -0.6], [s * 5.8, 1.3], [s * 4.6, 1.6], [s * 3.4, 1.2], [s * 3.6, 0.5]], 18);
    k.extY(C.stoneL, offsetLoop(pts, 0.15), 0, 0.22, { noBottom: true });
    k.extY(C.soil, pts, 0, 0.24, { noBottom: true });
    flowerClump(k, s * 4.7, 0.22, 0.85, 0.55, [0xd8322e, 0xf6f1ea, 0xf3c632], 5);
    flowerClump(k, s * 5.3, 0.22, 0.2, 0.45, [0x9466c6, 0xf6f1ea], 4);
    flowerClump(k, s * 4.0, 0.22, 1.05, 0.45, [0xd8322e, 0xf3c632], 4);
  }
  k.sec('lawn');
  k.tbox(0x4f9a3a, 8.0, 0.03, 0.9, 0, 0, 0.6, 0.01);
});

// ================================================================================================
// VEHICLES
// ================================================================================================
def('golf_cart', (k) => golfCart(k, true));

def('mower', (k) => mowerBody(k));

def('car', (k) => {
  const body = 0xf2f2f0;
  const T = { tint: true };
  const W = 0.88;
  // lower body
  k.hull(body, [
    [-0.8, 0.32, 2.15], [0.8, 0.32, 2.15], [-0.84, 0.66, 2.12], [0.84, 0.66, 2.12],
    [-0.8, 0.86, 1.9], [0.8, 0.86, 1.9], [-W, 1.0, 0.9], [W, 1.0, 0.9],
    [-W, 1.02, -1.75], [W, 1.02, -1.75], [-0.84, 0.98, -2.12], [0.84, 0.98, -2.12],
    [-0.82, 0.34, -2.15], [0.82, 0.34, -2.15], [-W, 0.3, 1.5], [W, 0.3, 1.5], [-W, 0.3, -1.6], [W, 0.3, -1.6],
  ], 0, 0, 0, T);
  // cabin glass + roof + pillars
  k.hull(C.glass, [
    [-0.82, 0.99, 0.92], [0.82, 0.99, 0.92], [-0.82, 1.01, -1.72], [0.82, 1.01, -1.72],
    [-0.68, 1.5, 0.1], [0.68, 1.5, 0.1], [-0.68, 1.5, -1.42], [0.68, 1.5, -1.42],
  ], 0, 0, 0, { mat: 'glass' });
  k.hull(body, [[-0.7, 1.49, 0.14], [0.7, 1.49, 0.14], [-0.7, 1.49, -1.46], [0.7, 1.49, -1.46], [-0.64, 1.55, 0.06], [0.64, 1.55, 0.06], [-0.64, 1.55, -1.38], [0.64, 1.55, -1.38]], 0, 0, 0, T);
  for (const s of [-1, 1]) {
    k.tube(body, [s * 0.83, 0.99, 0.93], [s * 0.69, 1.51, 0.12], 0.05, { seg: 4, ...T });
    k.tube(body, [s * 0.8, 1.0, -0.5], [s * 0.69, 1.51, -0.55], 0.06, { seg: 4, ...T });
    k.tube(body, [s * 0.83, 1.01, -1.74], [s * 0.69, 1.51, -1.44], 0.07, { seg: 4, ...T });
    k.box(0x1d1e20, 0.02, 0.03, 3.2, s * 0.885, 0.62, 0.0);
    k.box(body, 0.12, 0.09, 0.14, s * 0.92, 1.05, 0.85, T);
    k.box(0x2a2c30, 0.03, 0.03, 0.14, s * 0.89, 0.86, 0.1);
    k.box(0x2a2c30, 0.03, 0.03, 0.14, s * 0.89, 0.86, -1.0);
  }
  // bumpers, grille, plates, lights
  k.cbox(0x2a2c30, 1.72, 0.2, 0.18, 0, 0.42, 2.12, 0.05);
  k.cbox(0x2a2c30, 1.72, 0.2, 0.18, 0, 0.44, -2.12, 0.05);
  k.box(0x1d1e20, 0.9, 0.16, 0.04, 0, 0.66, 2.13);
  k.box(0xf4f4ef, 0.5, 0.11, 0.02, 0, 0.42, 2.22);
  k.box(0xf2d23c, 0.5, 0.11, 0.02, 0, 0.5, -2.22);
  for (const s of [-1, 1]) {
    k.box(C.glow, 0.34, 0.1, 0.05, s * 0.56, 0.76, 2.07, { mat: 'glow', rx: 0.5 });
    k.box(0xd8242b, 0.3, 0.14, 0.04, s * 0.62, 0.9, -2.13, { mat: 'glow' });
  }
  // wheels
  for (const sx of [-1, 1])
    for (const sz of [-1.38, 1.36]) {
      k.cyl([C.black, C.black, C.black], 0.32, 0.22, sx * 0.66, 0.32, sz, { seg: 12, rz: -sx * PI / 2 });
      k.cyl(0xb9bec3, 0.19, 0.02, sx * 0.88, 0.32, sz, { seg: 8, rz: -sx * PI / 2, mat: 'metal' });
    }
});

def('ball_picker', (k) => {
  const body = 0xe46b23;
  const cage = 0x3b4046;
  // ---- tractor (front)
  k.sec('tractor');
  k.cbox(0x2f3236, 0.8, 0.3, 2.3, 0, 0.55, 1.0, 0.05);
  k.hull(body, [[-0.42, 0.62, 1.1], [0.42, 0.62, 1.1], [-0.42, 0.62, 2.2], [0.42, 0.62, 2.2], [-0.38, 1.18, 1.15], [0.38, 1.18, 1.15], [-0.34, 1.05, 2.15], [0.34, 1.05, 2.15]]);
  k.box(0x2a2c30, 0.55, 0.3, 0.04, 0, 0.82, 2.2);
  for (const s of [-1, 1]) k.box(C.glow, 0.12, 0.08, 0.03, s * 0.24, 1.0, 2.17, { mat: 'glow' });
  k.cbox(body, 1.1, 0.12, 1.0, 0, 0.92, 0.3, 0.03);
  for (const s of [-1, 1]) k.hull(body, [[s * 0.45, 0.85, -0.25], [s * 0.85, 0.85, -0.25], [s * 0.45, 0.85, 0.85], [s * 0.85, 0.85, 0.85], [s * 0.45, 1.1, -0.1], [s * 0.85, 1.1, -0.1], [s * 0.45, 1.1, 0.7], [s * 0.85, 1.1, 0.7]]);
  k.cbox(C.black, 0.5, 0.12, 0.45, 0, 1.08, 0.2, 0.04);
  k.cbox(C.black, 0.5, 0.4, 0.1, 0, 1.3, -0.02, 0.04, { rx: -0.12 });
  k.tube(C.black, [0, 1.0, 0.95], [0, 1.4, 0.75], 0.03, { seg: 4 });
  k.lathe(C.black, [[0.17, -0.02], [0.17, 0.02]], 0, 1.42, 0.74, { seg: 10, rx: -1.0 });
  for (const s of [-1, 1]) {
    k.cyl([C.black, C.black, C.yellow], 0.5, 0.32, s * 0.72 - s * 0.16, 0.5, 0.3, { seg: 10, rz: -s * PI / 2 });
    k.cyl([C.black, C.black, C.yellow], 0.32, 0.22, s * 0.58 - s * 0.11, 0.32, 1.75, { seg: 10, rz: -s * PI / 2 });
  }
  // ball-proof cage
  k.sec('cage');
  const cy0 = 0.95;
  const cy1 = 2.35;
  const cx = 0.62;
  const cz0 = -0.35;
  const cz1 = 0.95;
  for (const x of [-cx, cx]) for (const z of [cz0, cz1]) k.tube(cage, [x, cy0, z], [x, cy1, z], 0.035, { seg: 4, mat: 'metal' });
  k.cbox(cage, 1.4, 0.08, 1.5, 0, cy1 + 0.04, (cz0 + cz1) / 2, 0.03, { mat: 'metal' });
  for (let i = 1; i < 4; i++) {
    const y = cy0 + ((cy1 - cy0) * i) / 4;
    for (const x of [-cx, cx]) k.box(cage, 0.02, 0.02, cz1 - cz0, x, y, (cz0 + cz1) / 2, { mat: 'metal' });
    k.box(cage, cx * 2, 0.02, 0.02, 0, y, cz1);
    k.box(cage, cx * 2, 0.02, 0.02, 0, y, cz0);
  }
  for (let i = 1; i < 5; i++) {
    const x = -cx + (2 * cx * i) / 5;
    k.box(cage, 0.02, cy1 - cy0, 0.02, x, (cy0 + cy1) / 2, cz1, { mat: 'metal', nb: true });
    const z = cz0 + ((cz1 - cz0) * i) / 5;
    for (const xx of [-cx, cx]) k.box(cage, 0.02, cy1 - cy0, 0.02, xx, (cy0 + cy1) / 2, z, { mat: 'metal', nb: true });
  }
  k.box(C.glow, 0.15, 0.08, 0.1, 0, cy1 + 0.12, cz1 - 0.1, { mat: 'glow' });
  // ---- picker gang (towed behind, -Z)
  k.sec('gang');
  k.tube(C.steelD, [0, 0.45, -0.25], [0, 0.45, -1.0], 0.04, { seg: 4, mat: 'metal' });
  k.box(C.steelD, 2.9, 0.08, 0.08, 0, 0.45, -1.0, { mat: 'metal' });
  for (const sx of [-0.95, 0, 0.95]) {
    k.tube(C.steelD, [sx, 0.45, -1.0], [sx, 0.32, -1.5], 0.03, { seg: 4, mat: 'metal' });
    k.box(C.yellow, 0.86, 0.06, 0.6, sx, 0.42, -1.8, { mat: 'metal' });
    for (let d = 0; d < 5; d++) k.cyl(0x2a2c30, 0.2, 0.06, sx - 0.34 + d * 0.17, 0.2, -1.8, { seg: 6, rz: PI / 2 });
    k.cyl(C.steel, 0.03, 0.82, sx - 0.41, 0.2, -1.8, { seg: 4, rz: -PI / 2, mat: 'metal', caps: 'none' });
    // basket
    k.box(C.steelD, 0.8, 0.03, 0.4, sx, 0.25, -2.3, { mat: 'metal' });
    for (const s of [-1, 1]) {
      k.box(C.steelD, 0.8, 0.28, 0.02, sx, 0.38, -2.3 + s * 0.2, { mat: 'metal', nb: true });
      k.box(C.steelD, 0.02, 0.28, 0.4, sx + s * 0.4, 0.38, -2.3, { mat: 'metal', nb: true });
    }
    for (let i = 0; i < 3; i++) golfBall(k, sx - 0.2 + i * 0.2, 0.27, -2.32 + (i % 2) * 0.1, 0.03);
  }
});

def('helicopter', (k) => {
  const white = 0xf4f5f6;
  const navy = 0x1f2e4e;
  // fuselage (lathe along +Z)
  k.lathe([white, white, white, white, white, navy, navy], [[0, -2.5], [0.5, -2.25], [0.86, -1.5], [0.95, -0.3], [0.92, 0.7], [0.78, 1.5], [0.48, 2.15], [0, 2.45]], 0, 1.35, 0, { seg: 10, rx: PI / 2, sx: 0.88 });
  k.box(navy, 0.03, 0.22, 3.6, 0.83, 1.15, -0.2);
  k.box(navy, 0.03, 0.22, 3.6, -0.83, 1.15, -0.2);
  k.box(C.brass, 0.03, 0.05, 3.6, 0.835, 1.3, -0.2);
  k.box(C.brass, 0.03, 0.05, 3.6, -0.835, 1.3, -0.2);
  // canopy glass + side windows
  k.ball(C.glass, 1, 0, 1.55, 1.15, { detail: 1, smooth: true, sx: 0.78, sy: 0.62, sz: 1.15, mat: 'glass' });
  for (const s of [-1, 1]) k.box(C.glass, 0.04, 0.5, 1.1, s * 0.8, 1.6, -0.45, { mat: 'glass', rz: s * 0.12 });
  k.box(0x2a2c30, 0.03, 1.0, 0.03, 0.82, 1.3, -1.05);
  k.box(0x2a2c30, 0.03, 1.0, 0.03, -0.82, 1.3, -1.05);
  // engine cowling + mast + main rotor
  k.cbox(navy, 1.05, 0.55, 2.1, 0, 2.2, -0.75, 0.15);
  k.tube(0x2a2c30, [0.3, 2.1, -1.7], [0.42, 2.15, -2.0], 0.11, { seg: 6 });
  k.cyl(0x3a3d40, 0.12, 0.45, 0, 2.45, -0.5, { seg: 6, mat: 'metal' });
  k.cyl(0x3a3d40, 0.22, 0.14, 0, 2.88, -0.5, { seg: 8, mat: 'metal' });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.3;
    k.push(0, 2.98, -0.5, a);
    k.box(0x2f3236, 0.3, 0.05, 5.2, 0, 0, 2.7, { rz: 0.04 });
    k.box(C.yellow, 0.3, 0.052, 0.25, 0, 0, 5.2);
    k.pop();
  }
  // tail boom, fin, stabiliser, tail rotor
  k.tube([navy], [0, 1.65, -2.1], [0, 1.85, -6.0], 0.36, { seg: 8, r1: 0.14 });
  k.hull(navy, [[0, 1.75, -5.4], [0, 1.75, -6.3], [0, 3.0, -6.55], [0, 3.0, -6.15], [0.06, 1.8, -5.9], [-0.06, 1.8, -5.9]]);
  k.hull(navy, [[0, 1.85, -5.9], [0, 1.2, -6.2], [0, 1.25, -6.45], [0.05, 1.6, -6.1], [-0.05, 1.6, -6.1]]);
  k.box(white, 1.5, 0.05, 0.42, 0, 1.85, -5.25);
  k.box(0xe03b2f, 0.05, 0.12, 0.3, -0.76, 1.88, -5.25, { mat: 'glow' });
  k.box(0x3ccf5a, 0.05, 0.12, 0.3, 0.76, 1.88, -5.25, { mat: 'glow' });
  k.cyl(0x3a3d40, 0.1, 0.2, 0.08, 2.55, -6.35, { seg: 6, rz: -PI / 2, mat: 'metal' });
  for (const a of [0.4, 0.4 + PI / 2]) k.box(0x2f3236, 0.04, 1.4, 0.14, 0.24, 2.55, -6.35, { rx: a });
  // skids
  for (const s of [-1, 1]) {
    k.tubes(0x3a3d40, [[s * 0.95, 0.1, -1.8], [s * 0.95, 0.1, 1.5], [s * 0.95, 0.25, 1.85]], 0.05, { seg: 5, mat: 'metal' });
    for (const z of [-1.1, 0.9]) k.tube(0x3a3d40, [s * 0.95, 0.1, z], [s * 0.55, 0.75, z], 0.04, { seg: 4, mat: 'metal' });
  }
  k.box(0xe03b2f, 0.12, 0.08, 0.12, 0, 2.48, -1.6, { mat: 'glow' });
  // registration
  for (let i = 0; i < 4; i++) k.box(navy, 0.02, 0.2, 0.14, 0.82, 0.88, -1.4 + i * 0.2);
});

// @@MORE_MODELS@@

// ================================================================================================
// EXPORTS
// ================================================================================================
/** Local position on `windmill` where the `windmill_rotor` hub attaches. */
export const WINDMILL_ROTOR_POS: [number, number, number] = [0, 10.4, 2.2];

/** Car park slot centres (rot = yaw the parked car faces; car front is +Z at rot 0). */
export const CARPARK_SLOTS: { x: number; z: number; rot: number }[] = [
  ...[-10, -6, -2, 2, 6, 10].map((x) => ({ x, z: -5, rot: Math.PI })),
  ...[-10, -6, 6, 10].map((x) => ({ x, z: 5, rot: 0 })),
];

export const MODEL_KEYS: string[] = Object.keys(DEFS);

const cache = new Map<string, ModelData>();

function fallback(): ModelData {
  const k = new Kit('fallback');
  k.cbox(0xb8b2a6, 2, 2, 2, 0, 1, 0, 0.1);
  return k.build();
}

/** Debug: per-section triangle counts of a model (fresh build, not cached). */
export function modelStats(key: string): Record<string, number> {
  const fn = DEFS[key];
  if (!fn) return {};
  const k = new Kit(key);
  fn(k);
  return k.stats;
}

/** Build (or fetch from cache) the model for `key`. Geometries are shared: callers must not mutate them. */
export function buildModel(key: string): ModelData {
  let m = cache.get(key);
  if (m) return m;
  const fn = DEFS[key];
  if (!fn) {
    m = cache.get('__fallback') ?? fallback();
    cache.set('__fallback', m);
    return m;
  }
  try {
    const k = new Kit(key);
    const opts = fn(k) || undefined;
    m = k.build({ ao: 0.32, aoH: 0.8, ...(opts ?? {}) });
  } catch (e) {
    console.error('buildModel failed for', key, e);
    m = fallback();
  }
  cache.set(key, m);
  return m;
}
