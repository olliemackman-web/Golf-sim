// Instanced, procedurally animated people (visitors, staff, the player golfer).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Person } from '../sim/agents';

const MAXP = 900;

function colored(g: THREE.BufferGeometry, fn: (y: number) => [number, number, number]): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const pos = ng.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getY(i));
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  ng.computeVertexNormals();
  return ng;
}

const white = (): [number, number, number] => [1, 1, 1];

function makeParts() {
  // torso: pivot at hips, extends up ~0.62
  const torso = colored(new THREE.CapsuleGeometry(0.17, 0.3, 3, 10).scale(1.15, 1, 0.72).translate(0, 0.33, 0), (y) => (y < 0.06 ? [0.85, 0.85, 0.85] : [1, 1, 1]));
  const collar = colored(new THREE.CylinderGeometry(0.075, 0.09, 0.06, 8).translate(0, 0.6, 0), white);
  const torsoG = mergeGeometries([torso, collar])!;
  const head = colored(new THREE.SphereGeometry(0.115, 12, 9).scale(0.95, 1.08, 1).translate(0, 0.13, 0), white);
  const nose = colored(new THREE.ConeGeometry(0.02, 0.05, 4).rotateX(Math.PI / 2).translate(0, 0.12, 0.115), () => [0.95, 0.85, 0.82]);
  const headG = mergeGeometries([head, nose])!;
  const hair = colored(new THREE.SphereGeometry(0.122, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 0.145, -0.01), white);
  const brim = colored(new THREE.BoxGeometry(0.2, 0.018, 0.13).translate(0, 0.17, 0.11), white);
  const leg = colored(new THREE.CapsuleGeometry(0.068, 0.72, 3, 8).translate(0, -0.42, 0), (y) => (y < -0.74 ? [0.18, 0.18, 0.2] : [1, 1, 1]));
  const shoe = colored(new THREE.BoxGeometry(0.1, 0.07, 0.22).translate(0, -0.84, 0.05), () => [0.95, 0.95, 0.95]);
  const legG = mergeGeometries([leg, shoe])!;
  const sleeve = colored(new THREE.CapsuleGeometry(0.06, 0.16, 3, 8).translate(0, -0.1, 0), white);
  const forearm = colored(new THREE.CapsuleGeometry(0.045, 0.34, 3, 8).translate(0, -0.33, 0), white);
  const hand = colored(new THREE.SphereGeometry(0.05, 8, 6).translate(0, -0.53, 0), white);
  const armSkin = mergeGeometries([forearm, hand])!;
  const shaft = colored(new THREE.CylinderGeometry(0.009, 0.007, 1.0, 5).translate(0, -0.5, 0), () => [0.75, 0.76, 0.78]);
  const grip = colored(new THREE.CylinderGeometry(0.014, 0.012, 0.25, 6).translate(0, -0.1, 0), () => [0.08, 0.08, 0.08]);
  const clubHead = colored(new THREE.BoxGeometry(0.1, 0.04, 0.05).translate(0.03, -1.0, 0.0), () => [0.55, 0.56, 0.6]);
  const clubG = mergeGeometries([shaft, grip, clubHead])!;
  const bag = colored(new THREE.CylinderGeometry(0.11, 0.1, 0.82, 10).translate(0, 0, 0), (y) => (y > 0.36 ? [0.2, 0.2, 0.2] : [1, 1, 1]));
  const heads = colored(new THREE.CylinderGeometry(0.1, 0.1, 0.14, 8).translate(0, 0.46, 0), () => [0.7, 0.7, 0.72]);
  const bagG = mergeGeometries([bag, heads])!;
  return { torsoG, headG, hair, brim, legG, sleeve, armSkin, clubG, bagG };
}

interface Pose {
  bob: number;
  hipDrop: number;
  lean: number;
  twist: number;
  legL: number;
  legR: number;
  armL: number;
  armR: number;
  inL: number;
  inR: number;
  club: number;
  showClub: boolean;
  showBag: boolean;
}

const KEYS_SWING: [number, number, number, number, number][] = [
  // u, twist, arms, lean, club
  [0.0, 0.0, -0.32, 0.38, -0.55],
  [0.12, 0.0, -0.32, 0.38, -0.55],
  [0.42, -1.45, -2.35, 0.32, -2.1],
  [0.5, 0.15, -0.35, 0.36, -0.5],
  [0.6, 1.2, -1.9, 0.22, -1.4],
  [0.74, 1.6, -2.75, 0.08, -2.3],
  [1.0, 1.6, -2.75, 0.08, -2.3],
];
const KEYS_CHIP: [number, number, number, number, number][] = [
  [0.0, 0.0, -0.35, 0.42, -0.5],
  [0.15, 0.0, -0.35, 0.42, -0.5],
  [0.42, -0.6, -1.05, 0.4, -1.0],
  [0.5, 0.05, -0.36, 0.42, -0.5],
  [0.72, 0.7, -1.2, 0.36, -1.0],
  [1.0, 0.7, -1.2, 0.36, -1.0],
];
const KEYS_PUTT: [number, number, number, number, number][] = [
  [0.0, 0.0, -0.42, 0.55, -0.35],
  [0.2, 0.0, -0.42, 0.55, -0.35],
  [0.42, -0.12, -0.62, 0.55, -0.35],
  [0.5, 0.0, -0.42, 0.55, -0.35],
  [0.7, 0.12, -0.25, 0.55, -0.35],
  [1.0, 0.12, -0.25, 0.55, -0.35],
];

function sampleKeys(keys: [number, number, number, number, number][], u: number): [number, number, number, number] {
  u = Math.max(0, Math.min(1, u));
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i];
      let t = (u - a[0]) / Math.max(1e-6, b[0] - a[0]);
      t = t * t * (3 - 2 * t);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, a[4] + (b[4] - a[4]) * t];
    }
  }
  const l = keys[keys.length - 1];
  return [l[1], l[2], l[3], l[4]];
}

export class CrowdRenderer {
  group = new THREE.Group();
  private torso: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private hair: THREE.InstancedMesh;
  private brim: THREE.InstancedMesh;
  private legs: THREE.InstancedMesh;
  private sleeves: THREE.InstancedMesh;
  private arms: THREE.InstancedMesh;
  private clubs: THREE.InstancedMesh;
  private bags: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private root = new THREE.Matrix4();
  private hips = new THREE.Matrix4();
  private chest = new THREE.Matrix4();
  private tmp = new THREE.Matrix4();
  private tmp2 = new THREE.Matrix4();
  private col = new THREE.Color();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  /** People drawn last frame (for picking). */
  drawn: Person[] = [];

  constructor() {
    const P = makeParts();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    const mk = (g: THREE.BufferGeometry, n: number, shadow = true) => {
      const im = new THREE.InstancedMesh(g, mat, n);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      im.castShadow = shadow;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.count = 0;
      this.group.add(im);
      return im;
    };
    this.torso = mk(P.torsoG, MAXP);
    this.head = mk(P.headG, MAXP);
    this.hair = mk(P.hair, MAXP, false);
    this.brim = mk(P.brim, MAXP, false);
    this.legs = mk(P.legG, MAXP * 2);
    this.sleeves = mk(P.sleeve, MAXP * 2, false);
    this.arms = mk(P.armSkin, MAXP * 2);
    this.clubs = mk(P.clubG, MAXP, false);
    this.bags = mk(P.bagG, MAXP);
  }

  private pose(p: Person): Pose {
    const t = p.animT;
    const ps: Pose = { bob: 0, hipDrop: 0, lean: 0.03, twist: 0, legL: 0, legR: 0, armL: -0.05, armR: -0.05, inL: -0.08, inR: 0.08, club: 0, showClub: false, showBag: p.bag };
    switch (p.anim) {
      case 'walk': {
        const ph = t * (p.speed * 1.55);
        const s = Math.sin(ph);
        ps.legL = s * 0.55;
        ps.legR = -s * 0.55;
        ps.armL = -s * 0.42 - 0.05;
        ps.armR = s * 0.42 - 0.05;
        ps.bob = Math.abs(Math.cos(ph)) * 0.045;
        ps.lean = 0.07;
        break;
      }
      case 'swing':
      case 'chip':
      case 'putt': {
        const keys = p.anim === 'swing' ? KEYS_SWING : p.anim === 'chip' ? KEYS_CHIP : KEYS_PUTT;
        const [tw, arms, lean, club] = sampleKeys(keys, t / p.animDur);
        ps.twist = tw;
        ps.armL = arms;
        ps.armR = arms;
        ps.inL = -0.32;
        ps.inR = 0.32;
        ps.lean = lean;
        ps.club = club;
        ps.showClub = true;
        ps.showBag = false;
        ps.legL = -0.08;
        ps.legR = 0.08;
        ps.hipDrop = 0.04;
        break;
      }
      case 'sit':
      case 'ride':
      case 'drive':
        ps.hipDrop = 0.42;
        ps.legL = -1.45;
        ps.legR = -1.45;
        ps.lean = -0.12;
        ps.armL = p.anim === 'drive' ? -1.0 : -0.5;
        ps.armR = p.anim === 'drive' ? -1.0 : -0.5;
        ps.inL = p.anim === 'drive' ? -0.25 : -0.1;
        ps.inR = p.anim === 'drive' ? 0.25 : 0.1;
        ps.showBag = false;
        break;
      case 'clap': {
        const c = Math.sin(t * 16) * 0.22;
        ps.armL = -1.25;
        ps.armR = -1.25;
        ps.inL = -0.45 + c;
        ps.inR = 0.45 - c;
        ps.showBag = false;
        break;
      }
      case 'cheer':
        ps.armL = -2.85 + Math.sin(t * 9) * 0.15;
        ps.armR = -2.85 - Math.sin(t * 9) * 0.15;
        ps.inL = 0.25;
        ps.inR = -0.25;
        ps.bob = Math.max(0, Math.sin(t * 8)) * 0.12;
        break;
      case 'pick':
        ps.lean = 1.05;
        ps.armL = -1.4 + Math.sin(t * 5) * 0.15;
        ps.armR = -0.9;
        ps.hipDrop = 0.06;
        ps.legL = 0.15;
        ps.legR = -0.15;
        break;
      case 'wave':
        ps.armR = -2.7;
        ps.inR = 0.2 + Math.sin(t * 9) * 0.35;
        break;
      case 'think':
        ps.armR = -1.9;
        ps.inR = 0.7;
        break;
      default: {
        // idle: subtle breathing and weight shifts
        const b = Math.sin(t * 1.8 + p.id) * 0.02;
        ps.armL = -0.06 + b;
        ps.armR = -0.06 - b;
        ps.lean = 0.02;
      }
    }
    return ps;
  }

  update(people: Person[], camPos: THREE.Vector3, maxDist = 900): void {
    let n = 0;
    const m = this.m, root = this.root, hips = this.hips, chest = this.chest, tmp = this.tmp, tmp2 = this.tmp2;
    const col = this.col;
    this.drawn.length = 0;
    const md2 = maxDist * maxDist;
    for (const p of people) {
      if (!p.visible || p.removed) continue;
      if (n >= MAXP) break;
      const dx = p.x - camPos.x, dz = p.z - camPos.z;
      if (dx * dx + dz * dz > md2) continue;
      this.drawn.push(p);
      const ps = this.pose(p);
      let px = p.x, py = p.y, pz = p.z, heading = p.heading;
      if (p.vehicle) {
        const v = p.vehicle;
        const seat = v.type === 'golf_cart' ? [-0.35, 0.42, -0.15] : v.type === 'mower' ? [0, 0.62, -0.35] : v.type === 'ball_picker' ? [0, 0.85, 0.5] : [0, 0.4, 0];
        const c = Math.cos(v.heading), s = Math.sin(v.heading);
        px = v.x + seat[0] * c + seat[2] * s;
        pz = v.z - seat[0] * s + seat[2] * c;
        py = v.y + seat[1];
        heading = v.heading;
      }
      const sc = p.scale;
      root.makeRotationY(heading).scale(new THREE.Vector3(sc, sc, sc)).setPosition(px, py + ps.bob, pz);
      // hips
      hips.copy(root).multiply(tmp.makeTranslation(0, 0.92 - ps.hipDrop, 0));
      chest.copy(hips).multiply(tmp.makeRotationY(ps.twist)).multiply(tmp2.makeRotationX(ps.lean));
      // torso
      this.torso.setMatrixAt(n, chest);
      this.torso.setColorAt(n, col.setHex(p.colors.shirt));
      // head
      m.copy(chest).multiply(tmp.makeTranslation(0, 0.6, 0)).multiply(tmp2.makeRotationX(-ps.lean * 0.6));
      this.head.setMatrixAt(n, m);
      this.head.setColorAt(n, col.setHex(p.colors.skin));
      this.hair.setMatrixAt(n, m);
      const hatOn = p.colors.hatType > 0;
      this.hair.setColorAt(n, col.setHex(hatOn ? p.colors.hat : p.colors.hair));
      if (hatOn && p.colors.hatType !== 3) {
        this.brim.setMatrixAt(n, m);
        this.brim.setColorAt(n, col.setHex(p.colors.hat));
      } else this.brim.setMatrixAt(n, this.zero);
      // legs
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? 1 : -1;
        m.copy(hips).multiply(tmp.makeTranslation(side * 0.1, 0, 0)).multiply(tmp2.makeRotationX(k === 0 ? ps.legL : ps.legR));
        this.legs.setMatrixAt(n * 2 + k, m);
        this.legs.setColorAt(n * 2 + k, col.setHex(p.colors.pants));
      }
      // arms (left arm on +X)
      let handM: THREE.Matrix4 | null = null;
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? 1 : -1;
        m.copy(chest).multiply(tmp.makeTranslation(side * 0.215, 0.52, 0)).multiply(tmp2.makeRotationX(k === 0 ? ps.armL : ps.armR));
        m.multiply(tmp.makeRotationZ(k === 0 ? ps.inL : ps.inR));
        this.sleeves.setMatrixAt(n * 2 + k, m);
        this.sleeves.setColorAt(n * 2 + k, col.setHex(p.colors.shirt));
        this.arms.setMatrixAt(n * 2 + k, m);
        this.arms.setColorAt(n * 2 + k, col.setHex(p.colors.skin));
        if (k === 0) handM = m.clone();
      }
      // club in the hands
      if (ps.showClub && handM) {
        m.copy(handM).multiply(tmp.makeTranslation(-0.02, -0.52, 0)).multiply(tmp2.makeRotationX(ps.club - (ps.armL + 0.0) * 0.0));
        this.clubs.setMatrixAt(n, m);
        this.clubs.setColorAt(n, col.setHex(0xffffff));
      } else this.clubs.setMatrixAt(n, this.zero);
      // golf bag on the back
      if (ps.showBag && !p.vehicle) {
        m.copy(chest).multiply(tmp.makeTranslation(0.05, 0.25, -0.2)).multiply(tmp2.makeRotationZ(0.45));
        this.bags.setMatrixAt(n, m);
        this.bags.setColorAt(n, col.setHex(bagColor(p.id)));
      } else this.bags.setMatrixAt(n, this.zero);
      n++;
    }
    for (const im of [this.torso, this.head, this.hair, this.brim, this.clubs, this.bags]) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    for (const im of [this.legs, this.sleeves, this.arms]) {
      im.count = n * 2;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}

const BAGS = [0x1f3b6b, 0xb22222, 0x111111, 0xffffff, 0x1f7a4d, 0xd4a017, 0x6b2d6b, 0x2a7ab0];
function bagColor(id: number): number {
  return BAGS[id % BAGS.length];
}
