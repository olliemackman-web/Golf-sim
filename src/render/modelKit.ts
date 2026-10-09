// Procedural modelling kit: tiny immediate-mode geometry builder used by Models.ts.
// Every primitive is emitted as a triangle soup (non-indexed) straight into one accumulator per
// material slot, so each finished model has at most one geometry per MatKey (+ tinted variants).
import * as THREE from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import type { MatKey, ModelData, ModelPart } from './modelTypes';

export type V2 = [number, number];
export type V3 = [number, number, number];
export type Col = number | THREE.Color;

/** Piece options: transform (applied about the piece anchor) + material slot. */
export interface PO {
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  mat?: MatKey;
  tint?: boolean;
  /** Vertical colour gradient over the piece's own height: [bottom multiplier, top multiplier]. */
  grad?: [number, number];
  /** Force faceted normals. */
  flat?: boolean;
  /** Force smooth (radial) normals on polyhedra. */
  smooth?: boolean;
}
export interface BoxO extends PO {
  /** Skip the bottom face (things resting on something). */
  nb?: boolean;
}
export interface LatheO extends PO {
  seg?: number;
  phase?: number;
}
export interface BallO extends PO {
  detail?: number;
  kind?: 'ico' | 'dodeca' | 'octa' | 'tetra';
  jit?: number;
  seed?: number;
}
export interface TubeO extends PO {
  r1?: number;
  seg?: number;
  caps?: boolean;
  phase?: number;
}

const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _f = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _eu = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _nm = new THREE.Matrix3();

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hash3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.round(x * 1000);
  const yi = Math.round(y * 1000);
  const zi = Math.round(z * 1000);
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ xi, 0x85ebca6b);
  h = Math.imul(h ^ yi, 0xc2b2ae35);
  h = Math.imul(h ^ zi, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

const colCache = new Map<number, THREE.Color>();
export function col(c: Col): THREE.Color {
  if (typeof c !== 'number') return c;
  let r = colCache.get(c);
  if (!r) {
    r = new THREE.Color(c);
    colCache.set(c, r);
  }
  return r;
}

/** Multiply a colour's brightness. */
export function shade(c: Col, k: number): THREE.Color {
  return col(c).clone().multiplyScalar(k);
}

/** Linear blend between two colours. */
export function mix(a: Col, b: Col, t: number): THREE.Color {
  return col(a).clone().lerp(col(b), t);
}

// ---------------------------------------------------------------- unit polyhedra (triangle soups)
const polyCache = new Map<string, Float32Array>();
function unitPoly(kind: string, detail: number): Float32Array {
  const key = kind + detail;
  let p = polyCache.get(key);
  if (!p) {
    let g: THREE.BufferGeometry;
    if (kind === 'dodeca') g = new THREE.DodecahedronGeometry(1, detail);
    else if (kind === 'octa') g = new THREE.OctahedronGeometry(1, detail);
    else if (kind === 'tetra') g = new THREE.TetrahedronGeometry(1, detail);
    else g = new THREE.IcosahedronGeometry(1, detail);
    const ng = g.index ? g.toNonIndexed() : g;
    p = new Float32Array(ng.getAttribute('position').array);
    polyCache.set(key, p);
  }
  return p;
}

class Acc {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
}

interface PieceBuf {
  p: number[];
  n: number[];
  c?: number[]; // optional per-vertex colours (linear rgb)
}

export interface BuildOpts {
  /** Fake contact ambient-occlusion: darken vertical faces near the ground. */
  ao?: number;
  aoH?: number;
}

export class Kit {
  private accs = new Map<string, Acc>();
  private m = new THREE.Matrix4();
  private stack: THREE.Matrix4[] = [];
  readonly r: () => number;
  /** Debug: triangles emitted per section label (see `sec`). */
  readonly stats: Record<string, number> = {};
  private label = 'misc';

  /** Debug helper: attribute subsequently emitted triangles to `name`. */
  sec(name: string): void {
    this.label = name;
  }

  constructor(seed: number | string) {
    this.r = rng(typeof seed === 'string' ? hashStr(seed) : seed);
  }

  // ------------------------------------------------------------ randomness
  rr(a: number, b: number): number {
    return a + (b - a) * this.r();
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.r() * arr.length) % arr.length];
  }
  /** Colour jitter: brightness +-amt and a small hue/saturation wobble. */
  jc(c: Col, amt = 0.08, hue = 0.012): THREE.Color {
    const o = col(c).clone();
    const hsl = { h: 0, s: 0, l: 0 };
    o.getHSL(hsl);
    hsl.h = (hsl.h + (this.r() - 0.5) * 2 * hue + 1) % 1;
    hsl.s = Math.min(1, Math.max(0, hsl.s * (1 + (this.r() - 0.5) * amt)));
    o.setHSL(hsl.h, hsl.s, hsl.l);
    return o.multiplyScalar(1 + (this.r() - 0.5) * 2 * amt);
  }

  // ------------------------------------------------------------ transform stack
  push(x = 0, y = 0, z = 0, ry = 0, s = 1, rx = 0, rz = 0): void {
    this.stack.push(this.m.clone());
    const t = new THREE.Matrix4();
    _eu.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_eu);
    t.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
    this.m.multiply(t);
  }
  pushM(mat: THREE.Matrix4): void {
    this.stack.push(this.m.clone());
    this.m.multiply(mat);
  }
  pop(): void {
    const m = this.stack.pop();
    if (m) this.m = m;
  }
  /** Run `fn` inside a translated / yawed (and optionally uniformly scaled) frame. */
  at(x: number, y: number, z: number, ry: number, fn: () => void, s = 1): void {
    this.push(x, y, z, ry, s);
    fn();
    this.pop();
  }
  /** Mirror across the X=0 plane (fn is run twice: as-is and mirrored). */
  mirrorX(fn: (side: number) => void): void {
    fn(1);
    this.stack.push(this.m.clone());
    this.m.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
    fn(-1);
    this.pop();
  }

  private pieceMatrix(x: number, y: number, z: number, o?: PO, pre?: THREE.Matrix4): THREE.Matrix4 {
    const t = new THREE.Matrix4();
    _eu.set(o?.rx ?? 0, o?.ry ?? 0, o?.rz ?? 0, 'YXZ');
    _q.setFromEuler(_eu);
    t.compose(_p.set(x, y, z), _q, _s.set(o?.sx ?? 1, o?.sy ?? 1, o?.sz ?? 1));
    const m = this.m.clone().multiply(t);
    if (pre) m.multiply(pre);
    return m;
  }

  private acc(o?: PO): Acc {
    const key = (o?.mat ?? 'std') + (o?.tint ? '|t' : '');
    let a = this.accs.get(key);
    if (!a) {
      a = new Acc();
      this.accs.set(key, a);
    }
    return a;
  }

  /** Core emitter: transforms a local triangle soup and appends it to the slot accumulator. */
  emit(buf: PieceBuf, c: Col, M: THREE.Matrix4, o?: PO, flat = false): void {
    const acc = this.acc(o);
    const color = col(c);
    _nm.getNormalMatrix(M);
    const start = acc.pos.length;
    const { p, n } = buf;
    const vs = [_a, _b, _c];
    const ns = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const cs: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < p.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const j = i + k * 3;
        vs[k].set(p[j], p[j + 1], p[j + 2]).applyMatrix4(M);
        ns[k].set(n[j], n[j + 1], n[j + 2]).applyMatrix3(_nm).normalize();
        if (buf.c) {
          cs[k][0] = buf.c[j];
          cs[k][1] = buf.c[j + 1];
          cs[k][2] = buf.c[j + 2];
        } else {
          cs[k][0] = color.r;
          cs[k][1] = color.g;
          cs[k][2] = color.b;
        }
      }
      _e1.subVectors(_b, _a);
      _e2.subVectors(_c, _a);
      _f.crossVectors(_e1, _e2);
      const len = _f.length();
      if (len < 1e-10) continue;
      _f.multiplyScalar(1 / len);
      _n.copy(ns[0]).add(ns[1]).add(ns[2]);
      let order = [0, 1, 2];
      if (_f.dot(_n) < 0) {
        order = [0, 2, 1];
        _f.negate();
      }
      for (const k of order) {
        const v = vs[k];
        acc.pos.push(v.x, v.y, v.z);
        const nn = flat ? _f : ns[k];
        acc.nrm.push(nn.x, nn.y, nn.z);
        acc.col.push(cs[k][0], cs[k][1], cs[k][2]);
      }
    }
    this.stats[this.label] = (this.stats[this.label] ?? 0) + (acc.pos.length - start) / 9;
    if (o?.grad) {
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let i = start + 1; i < acc.pos.length; i += 3) {
        y0 = Math.min(y0, acc.pos[i]);
        y1 = Math.max(y1, acc.pos[i]);
      }
      const span = Math.max(1e-6, y1 - y0);
      const [g0, g1] = o.grad;
      for (let i = start; i < acc.pos.length; i += 3) {
        const t = (acc.pos[i + 1] - y0) / span;
        const g = g0 + (g1 - g0) * t;
        acc.col[i] *= g;
        acc.col[i + 1] *= g;
        acc.col[i + 2] *= g;
      }
    }
  }

  // ------------------------------------------------------------ primitives
  /** Axis-aligned box centred at (x,y,z). */
  box(c: Col, w: number, h: number, d: number, x: number, y: number, z: number, o?: BoxO): void {
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;
    const p: number[] = [];
    const n: number[] = [];
    const face = (nx: number, ny: number, nz: number, a: V3, b: V3, cc: V3, dd: V3) => {
      p.push(...a, ...b, ...cc, ...a, ...cc, ...dd);
      for (let i = 0; i < 6; i++) n.push(nx, ny, nz);
    };
    face(0, 0, 1, [-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd]);
    face(0, 0, -1, [hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd]);
    face(1, 0, 0, [hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd]);
    face(-1, 0, 0, [-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd]);
    face(0, 1, 0, [-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd]);
    if (!o?.nb) face(0, -1, 0, [-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd]);
    this.emit({ p, n }, c, this.pieceMatrix(x, y, z, o), o, true);
  }

  /** Box resting on y (bottom-anchored); rotations pivot about the bottom centre. */
  boxb(c: Col, w: number, h: number, d: number, x: number, y: number, z: number, o?: BoxO): void {
    const hw = w / 2;
    const hd = d / 2;
    const p: number[] = [];
    const n: number[] = [];
    const face = (nx: number, ny: number, nz: number, a: V3, b: V3, cc: V3, dd: V3) => {
      p.push(...a, ...b, ...cc, ...a, ...cc, ...dd);
      for (let i = 0; i < 6; i++) n.push(nx, ny, nz);
    };
    face(0, 0, 1, [-hw, 0, hd], [hw, 0, hd], [hw, h, hd], [-hw, h, hd]);
    face(0, 0, -1, [hw, 0, -hd], [-hw, 0, -hd], [-hw, h, -hd], [hw, h, -hd]);
    face(1, 0, 0, [hw, 0, hd], [hw, 0, -hd], [hw, h, -hd], [hw, h, hd]);
    face(-1, 0, 0, [-hw, 0, -hd], [-hw, 0, hd], [-hw, h, hd], [-hw, h, -hd]);
    face(0, 1, 0, [-hw, h, hd], [hw, h, hd], [hw, h, -hd], [-hw, h, -hd]);
    if (!o?.nb) face(0, -1, 0, [-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd]);
    this.emit({ p, n }, c, this.pieceMatrix(x, y, z, o), o, true);
  }

  /** Box with chamfered edges (bevel-look), centred. */
  cbox(c: Col, w: number, h: number, d: number, x: number, y: number, z: number, bev: number, o?: PO): void {
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;
    const b = Math.min(bev, hw * 0.95, hh * 0.95, hd * 0.95);
    const pts: V3[] = [];
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          pts.push([sx * (hw - b), sy * hh, sz * (hd - b)]);
          pts.push([sx * hw, sy * (hh - b), sz * (hd - b)]);
          pts.push([sx * (hw - b), sy * (hh - b), sz * hd]);
        }
    this.hull(c, pts, x, y, z, o);
  }

  /** Bottom-anchored box with only its top edges bevelled (kerbs, steps, slabs, plinths). ~20 tris. */
  tbox(c: Col, w: number, h: number, d: number, x: number, y: number, z: number, bev: number, o?: PO): void {
    const hw = w / 2;
    const hd = d / 2;
    const b = Math.min(bev, hw * 0.9, hd * 0.9, h * 0.9);
    const pts: V3[] = [];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        pts.push([sx * hw, 0, sz * hd], [sx * hw, h - b, sz * hd], [sx * (hw - b), h, sz * (hd - b)]);
      }
    this.hull(c, pts, x, y, z, o);
  }

  /** Convex hull of points (local), placed at (x,y,z). */
  hull(c: Col, pts: V3[], x = 0, y = 0, z = 0, o?: PO): void {
    const hull = new ConvexHull().setFromPoints(pts.map((q) => new THREE.Vector3(q[0], q[1], q[2])));
    const p: number[] = [];
    const n: number[] = [];
    for (const face of hull.faces) {
      const verts: THREE.Vector3[] = [];
      let e = face.edge;
      do {
        verts.push(e.head().point);
        e = e.next;
      } while (e !== face.edge);
      for (let i = 1; i + 1 < verts.length; i++) {
        for (const v of [verts[0], verts[i], verts[i + 1]]) {
          p.push(v.x, v.y, v.z);
          n.push(face.normal.x, face.normal.y, face.normal.z);
        }
      }
    }
    this.emit({ p, n }, c, this.pieceMatrix(x, y, z, o), o, true);
  }

  /**
   * Surface of revolution around local Y. profile = [radius, y][], listed bottom -> outside -> top so
   * normals face outwards. `cols` may be one colour or one colour per profile segment.
   * Normals are smooth around the axis and hard between profile segments (turned look).
   */
  lathe(cols: Col | Col[], prof: V2[], x: number, y: number, z: number, o?: LatheO): void {
    const seg = o?.seg ?? 12;
    const ph = o?.phase ?? 0;
    const p: number[] = [];
    const n: number[] = [];
    const cc: number[] = [];
    const multi = Array.isArray(cols);
    for (let i = 0; i < prof.length - 1; i++) {
      const [r0, y0] = prof[i];
      const [r1, y1] = prof[i + 1];
      let nx = y1 - y0;
      let ny = -(r1 - r0);
      const nl = Math.hypot(nx, ny);
      if (nl < 1e-9) continue;
      nx /= nl;
      ny /= nl;
      const cl = col(multi ? (cols as Col[])[Math.min(i, (cols as Col[]).length - 1)] : (cols as Col));
      for (let j = 0; j < seg; j++) {
        const a0 = ph + (j / seg) * Math.PI * 2;
        const a1 = ph + ((j + 1) / seg) * Math.PI * 2;
        const s0 = Math.sin(a0);
        const c0 = Math.cos(a0);
        const s1 = Math.sin(a1);
        const c1 = Math.cos(a1);
        const A: V3 = [r0 * s0, y0, r0 * c0];
        const B: V3 = [r0 * s1, y0, r0 * c1];
        const C: V3 = [r1 * s1, y1, r1 * c1];
        const D: V3 = [r1 * s0, y1, r1 * c0];
        const nA: V3 = [nx * s0, ny, nx * c0];
        const nB: V3 = [nx * s1, ny, nx * c1];
        if (r0 > 1e-7) {
          p.push(...A, ...B, ...C);
          n.push(...nA, ...nB, ...nB);
          for (let k = 0; k < 3; k++) cc.push(cl.r, cl.g, cl.b);
        }
        if (r1 > 1e-7) {
          p.push(...A, ...C, ...D);
          n.push(...nA, ...nB, ...nA);
          for (let k = 0; k < 3; k++) cc.push(cl.r, cl.g, cl.b);
        }
      }
    }
    this.emit({ p, n, c: cc }, 0xffffff, this.pieceMatrix(x, y, z, o), o, !!o?.flat);
  }

  /** Cylinder / frustum standing on (x,y,z). caps: both | top | none. */
  cyl(
    c: Col | Col[],
    r: number,
    h: number,
    x: number,
    y: number,
    z: number,
    o?: LatheO & { rt?: number; caps?: 'both' | 'top' | 'none' },
  ): void {
    const rt = o?.rt ?? r;
    const caps = o?.caps ?? 'both';
    const prof: V2[] = [];
    if (caps === 'both') prof.push([0, 0]);
    prof.push([r, 0], [rt, h]);
    if (caps !== 'none') prof.push([0, h]);
    let cols = c;
    if (!Array.isArray(c) && caps === 'both') cols = c;
    this.lathe(cols, prof, x, y, z, { seg: 10, ...o });
  }

  /** Polyhedron blob (icosphere / dodecahedron ...) with optional deterministic vertex jitter. */
  ball(c: Col, r: number, x: number, y: number, z: number, o?: BallO): void {
    const src = unitPoly(o?.kind ?? 'ico', o?.detail ?? 1);
    const jit = o?.jit ?? 0;
    const seed = o?.seed ?? Math.floor(this.r() * 1e9);
    const p: number[] = new Array(src.length);
    const n: number[] = new Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      const ux = src[i];
      const uy = src[i + 1];
      const uz = src[i + 2];
      const k = jit ? 1 + (hash3(ux, uy, uz, seed) - 0.5) * 2 * jit : 1;
      p[i] = ux * k * r;
      p[i + 1] = uy * k * r;
      p[i + 2] = uz * k * r;
      n[i] = ux;
      n[i + 1] = uy;
      n[i + 2] = uz;
    }
    const flat = o?.smooth ? false : true;
    this.emit({ p, n }, c, this.pieceMatrix(x, y, z, o), o, flat);
  }

  /** Tube (frustum) from point a to point b. */
  tube(c: Col | Col[], a: V3, b: V3, r: number, o?: TubeO): void {
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = dir.length();
    if (len < 1e-6) return;
    dir.divideScalar(len);
    const r1 = o?.r1 ?? r;
    const prof: V2[] = [];
    if (o?.caps) prof.push([0, 0]);
    prof.push([r, 0], [r1, len]);
    if (o?.caps) prof.push([0, len]);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const pre = new THREE.Matrix4().compose(new THREE.Vector3(a[0], a[1], a[2]), q, new THREE.Vector3(1, 1, 1));
    const m = this.m.clone().multiply(pre);
    this.pushM(new THREE.Matrix4());
    this.m.copy(m);
    this.lathe(c, prof, 0, 0, 0, { seg: o?.seg ?? 6, phase: o?.phase, mat: o?.mat, tint: o?.tint, grad: o?.grad, flat: o?.flat });
    this.pop();
  }

  /** Seamless tube swept along a polyline with per-point radii (parallel-transport frames). */
  sweep(c: Col, pts: V3[], radii: number[], o?: TubeO): void {
    const seg = o?.seg ?? 6;
    const P = pts.map((q) => new THREE.Vector3(q[0], q[1], q[2]));
    const n = P.length;
    if (n < 2) return;
    const T: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)];
      const b = P[Math.min(n - 1, i + 1)];
      T.push(new THREE.Vector3().subVectors(b, a).normalize());
    }
    let N = new THREE.Vector3(0, 1, 0);
    if (Math.abs(N.dot(T[0])) > 0.9) N.set(1, 0, 0);
    N = N.sub(T[0].clone().multiplyScalar(N.dot(T[0]))).normalize();
    const Ns: THREE.Vector3[] = [N.clone()];
    for (let i = 1; i < n; i++) {
      const q = new THREE.Quaternion().setFromUnitVectors(T[i - 1], T[i]);
      N = N.clone().applyQuaternion(q);
      Ns.push(N.clone());
    }
    const ring = (i: number, j: number): [THREE.Vector3, THREE.Vector3] => {
      const a = (j / seg) * Math.PI * 2;
      const B = new THREE.Vector3().crossVectors(T[i], Ns[i]);
      const d = Ns[i].clone().multiplyScalar(Math.cos(a)).add(B.multiplyScalar(Math.sin(a)));
      return [P[i].clone().addScaledVector(d, radii[Math.min(i, radii.length - 1)]), d];
    };
    const p: number[] = [];
    const nn: number[] = [];
    for (let i = 0; i < n - 1; i++)
      for (let j = 0; j < seg; j++) {
        const [a0, na0] = ring(i, j);
        const [a1, na1] = ring(i, j + 1);
        const [b0, nb0] = ring(i + 1, j);
        const [b1, nb1] = ring(i + 1, j + 1);
        p.push(a0.x, a0.y, a0.z, b0.x, b0.y, b0.z, b1.x, b1.y, b1.z, a0.x, a0.y, a0.z, b1.x, b1.y, b1.z, a1.x, a1.y, a1.z);
        nn.push(na0.x, na0.y, na0.z, nb0.x, nb0.y, nb0.z, nb1.x, nb1.y, nb1.z, na0.x, na0.y, na0.z, nb1.x, nb1.y, nb1.z, na1.x, na1.y, na1.z);
      }
    this.emit({ p, n: nn }, c, this.pieceMatrix(0, 0, 0, o), o, !!o?.flat);
  }

  /** Polyline of tubes. */
  tubes(c: Col, pts: V3[], r: number, o?: TubeO): void {
    for (let i = 0; i < pts.length - 1; i++) this.tube(c, pts[i], pts[i + 1], r, o);
  }

  /**
   * Generic prism: 2D polygon (u,v) extruded along w from w0 to w1, mapped to 3D via `map`.
   */
  private prism(c: Col, pts: V2[], w0: number, w1: number, map: (u: number, v: number, w: number) => V3, o?: PO & { noBottom?: boolean; noTop?: boolean }): void {
    let poly = pts.slice();
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % poly.length];
      area += x0 * y1 - x1 * y0;
    }
    if (area < 0) poly = poly.reverse();
    const v2 = poly.map((q) => new THREE.Vector2(q[0], q[1]));
    const tris = THREE.ShapeUtils.triangulateShape(v2, []);
    const p: number[] = [];
    const n: number[] = [];
    // normal mapping uses the same linear map (applied to directions)
    const o0 = map(0, 0, 0);
    const dirOf = (u: number, v: number, w: number): V3 => {
      const q = map(u, v, w);
      return [q[0] - o0[0], q[1] - o0[1], q[2] - o0[2]];
    };
    const capN1 = dirOf(0, 0, 1);
    const capN0 = dirOf(0, 0, -1);
    for (const t of tris) {
      const [i0, i1, i2] = t;
      if (!o?.noTop)
        for (const i of [i0, i1, i2]) {
          p.push(...map(poly[i][0], poly[i][1], w1));
          n.push(...capN1);
        }
      if (!o?.noBottom)
        for (const i of [i0, i2, i1]) {
          p.push(...map(poly[i][0], poly[i][1], w0));
          n.push(...capN0);
        }
    }
    for (let i = 0; i < poly.length; i++) {
      const [ua, va] = poly[i];
      const [ub, vb] = poly[(i + 1) % poly.length];
      const du = ub - ua;
      const dv = vb - va;
      const l = Math.hypot(du, dv);
      if (l < 1e-9) continue;
      const nn = dirOf(dv / l, -du / l, 0);
      const A = map(ua, va, w0);
      const B = map(ub, vb, w0);
      const C = map(ub, vb, w1);
      const D = map(ua, va, w1);
      p.push(...A, ...B, ...C, ...A, ...C, ...D);
      for (let k = 0; k < 6; k++) n.push(...nn);
    }
    this.emit({ p, n }, c, this.pieceMatrix(0, 0, 0, o), o, true);
  }

  /** Polygon in the XZ plane ([x,z] points) extruded vertically from y0 to y1. */
  extY(c: Col, pts: V2[], y0: number, y1: number, o?: PO & { noBottom?: boolean; noTop?: boolean }): void {
    this.prism(c, pts, y0, y1, (u, v, w) => [u, w, v], o);
  }
  /** Polygon in the XY plane ([x,y] points) extruded along Z from z0 to z1. */
  extZ(c: Col, pts: V2[], z0: number, z1: number, o?: PO): void {
    this.prism(c, pts, z0, z1, (u, v, w) => [u, v, w], o);
  }
  /** Polygon in the ZY plane ([z,y] points) extruded along X from x0 to x1. */
  extX(c: Col, pts: V2[], x0: number, x1: number, o?: PO): void {
    this.prism(c, pts, x0, x1, (u, v, w) => [w, v, u], o);
  }

  /** Raw triangle (local coords, current frame). Normal is derived; winding is irrelevant. */
  tri(c: Col, a: V3, b: V3, cc: V3, o?: PO & { up?: V3 }): void {
    _e1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _e2.set(cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]);
    _f.crossVectors(_e1, _e2).normalize();
    if (o?.up && _f.x * o.up[0] + _f.y * o.up[1] + _f.z * o.up[2] < 0) _f.negate();
    const n: number[] = [];
    for (let i = 0; i < 3; i++) n.push(_f.x, _f.y, _f.z);
    this.emit({ p: [...a, ...b, ...cc], n }, c, this.pieceMatrix(0, 0, 0, o), o, true);
  }
  /** Raw quad a-b-c-d, facing `up` direction (defaults to the derived normal). */
  quad(c: Col, a: V3, b: V3, cc: V3, d: V3, o?: PO & { up?: V3 }): void {
    _e1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _e2.set(cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]);
    _f.crossVectors(_e1, _e2).normalize();
    if (o?.up && _f.x * o.up[0] + _f.y * o.up[1] + _f.z * o.up[2] < 0) _f.negate();
    const n: number[] = [];
    for (let i = 0; i < 6; i++) n.push(_f.x, _f.y, _f.z);
    this.emit({ p: [...a, ...b, ...cc, ...a, ...cc, ...d], n }, c, this.pieceMatrix(0, 0, 0, o), o, true);
  }
  /** Double-sided quad (two faces offset by `eps` along its normal). */
  quad2(c: Col, a: V3, b: V3, cc: V3, d: V3, eps = 0.006, o?: PO): void {
    _e1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _e2.set(cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]);
    const f = new THREE.Vector3().crossVectors(_e1, _e2).normalize();
    const off = (q: V3, s: number): V3 => [q[0] + f.x * eps * s, q[1] + f.y * eps * s, q[2] + f.z * eps * s];
    const up: V3 = [f.x, f.y, f.z];
    const dn: V3 = [-f.x, -f.y, -f.z];
    this.quad(c, off(a, 1), off(b, 1), off(cc, 1), off(d, 1), { ...o, up });
    this.quad(c, off(a, -1), off(b, -1), off(cc, -1), off(d, -1), { ...o, up: dn });
  }

  /**
   * Waving flag (cloth) attached to a pole at (x, y..y+h, z) extending in +X by w.
   * Subdivided along X so the cloth shader can ripple it. `stripes` optionally colours
   * horizontal bands (top -> bottom).
   */
  flag(c: Col | Col[], w: number, h: number, x: number, y: number, z: number, nx = 6, o?: PO & { taper?: number; vStripes?: boolean }): void {
    const cols = Array.isArray(c) ? c : [c];
    const taper = o?.taper ?? 0;
    const eps = 0.008;
    const ny = cols.length;
    for (let i = 0; i < nx; i++) {
      const u0 = i / nx;
      const u1 = (i + 1) / nx;
      const h0 = h * (1 - taper * u0);
      const h1 = h * (1 - taper * u1);
      for (let j = 0; j < ny; j++) {
        const cl = o?.vStripes ? cols[Math.floor(u0 * cols.length)] : cols[j];
        const vt0 = 1 - j / ny;
        const vt1 = 1 - (j + 1) / ny;
        const yy = (hh: number, v: number) => y + h / 2 + (v - 0.5) * hh;
        const A: V3 = [x + u0 * w, yy(h0, vt1), z];
        const B: V3 = [x + u1 * w, yy(h1, vt1), z];
        const C: V3 = [x + u1 * w, yy(h1, vt0), z];
        const D: V3 = [x + u0 * w, yy(h0, vt0), z];
        this.quad2(cl, A, B, C, D, eps, { ...o, mat: o?.mat ?? 'cloth' });
      }
    }
  }

  // ------------------------------------------------------------ output
  build(opts?: BuildOpts): ModelData {
    const parts: ModelPart[] = [];
    let maxY = 0;
    const ao = opts?.ao ?? 0;
    const aoH = opts?.aoH ?? 0.9;
    const order: MatKey[] = ['std', 'metal', 'glass', 'glow', 'foliage', 'cloth', 'water'];
    const keys = [...this.accs.keys()].sort((a, b) => {
      const ka = order.indexOf(a.split('|')[0] as MatKey);
      const kb = order.indexOf(b.split('|')[0] as MatKey);
      return ka - kb || a.localeCompare(b);
    });
    for (const key of keys) {
      const a = this.accs.get(key)!;
      if (a.pos.length === 0) continue;
      const [mat, t] = key.split('|');
      const pos = new Float32Array(a.pos);
      const nrm = new Float32Array(a.nrm);
      const cl = new Float32Array(a.col);
      if (ao > 0 && (mat === 'std' || mat === 'foliage' || mat === 'metal')) {
        for (let i = 0; i < pos.length; i += 3) {
          const y = pos[i + 1];
          if (y > aoH) continue;
          const vert = 1 - Math.abs(nrm[i + 1]);
          const s = Math.max(0, Math.min(1, y / aoH));
          const sm = s * s * (3 - 2 * s);
          const f = 1 - ao * vert * (1 - sm);
          cl[i] *= f;
          cl[i + 1] *= f;
          cl[i + 2] *= f;
        }
      }
      for (let i = 1; i < pos.length; i += 3) maxY = Math.max(maxY, pos[i]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      g.setAttribute('color', new THREE.BufferAttribute(cl, 3));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      const part: ModelPart = { geometry: g, mat: mat as MatKey };
      if (t) part.tint = true;
      parts.push(part);
    }
    return { parts, height: maxY };
  }
}

export function triCount(d: ModelData): number {
  let n = 0;
  for (const p of d.parts) n += p.geometry.getAttribute('position').count / 3;
  return n;
}
