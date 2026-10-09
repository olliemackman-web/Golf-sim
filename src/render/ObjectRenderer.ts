// Instanced rendering of placed objects, trees, hole markers and litter.
import * as THREE from 'three';
import { TILE } from '../core/constants';
import { ITEMS, itemModel } from '../data/items';
import type { PlacedObject, Tree, World } from '../world/World';
import { EVERGREEN, getMaterial } from './Materials';
import { MODEL_KEYS, WINDMILL_ROTOR_POS, buildModel } from './Models';
import type { ModelData } from './modelTypes';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** One instanced batch per model key (one InstancedMesh per material part). */
export class InstancedModel {
  parts: { mesh: THREE.InstancedMesh; tint: boolean }[] = [];
  count = 0;
  private capacity: number;
  private ids: number[] = [];
  private index = new Map<number, number>();
  constructor(public key: string, private parent: THREE.Object3D, capacity = 32, public shadows = true) {
    this.capacity = capacity;
    this.build();
  }

  private build(): void {
    const data: ModelData = buildModel(this.key);
    const old = this.parts;
    this.parts = [];
    for (const p of data.parts) {
      const matKey = p.mat === 'foliage' && EVERGREEN.has(this.key) ? 'foliage_ever' : p.mat;
      const mesh = new THREE.InstancedMesh(p.geometry, getMaterial(matKey), this.capacity);
      mesh.castShadow = this.shadows && p.mat !== 'glass' && p.mat !== 'water' && p.mat !== 'glow';
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = this.count;
      if (p.tint) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3).fill(1), 3);
      }
      if (p.mat === 'water') mesh.renderOrder = 3;
      this.parts.push({ mesh, tint: !!p.tint });
      this.parent.add(mesh);
    }
    // copy existing instance data
    if (old.length) {
      for (let k = 0; k < this.parts.length && k < old.length; k++) {
        const src = old[k].mesh, dst = this.parts[k].mesh;
        for (let i = 0; i < this.count; i++) {
          src.getMatrixAt(i, tmpM);
          dst.setMatrixAt(i, tmpM);
          if (src.instanceColor && dst.instanceColor) {
            const c = new THREE.Color();
            src.getColorAt(i, c);
            dst.setColorAt(i, c);
          }
        }
      }
      for (const o of old) {
        this.parent.remove(o.mesh);
        o.mesh.dispose();
      }
    }
  }

  private grow(): void {
    this.capacity *= 2;
    this.build();
  }

  set(id: number, m: THREE.Matrix4, color?: THREE.Color): void {
    let i = this.index.get(id);
    if (i === undefined) {
      if (this.count >= this.capacity) this.grow();
      i = this.count++;
      this.index.set(id, i);
      this.ids[i] = id;
      for (const p of this.parts) p.mesh.count = this.count;
    }
    for (const p of this.parts) {
      p.mesh.setMatrixAt(i, m);
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.tint && color) {
        p.mesh.setColorAt(i, color);
        if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  remove(id: number): void {
    const i = this.index.get(id);
    if (i === undefined) return;
    const last = this.count - 1;
    if (i !== last) {
      const lastId = this.ids[last];
      for (const p of this.parts) {
        p.mesh.getMatrixAt(last, tmpM);
        p.mesh.setMatrixAt(i, tmpM);
        if (p.tint && p.mesh.instanceColor) {
          const c = new THREE.Color();
          p.mesh.getColorAt(last, c);
          p.mesh.setColorAt(i, c);
          p.mesh.instanceColor.needsUpdate = true;
        }
      }
      this.ids[i] = lastId;
      this.index.set(lastId, i);
    }
    this.index.delete(id);
    this.count--;
    for (const p of this.parts) {
      p.mesh.count = this.count;
      p.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  idList(): number[] {
    return this.ids.slice(0, this.count);
  }

  has(id: number): boolean {
    return this.index.has(id);
  }

  clear(): void {
    this.index.clear();
    this.ids = [];
    this.count = 0;
    for (const p of this.parts) p.mesh.count = 0;
  }

  setVisible(v: boolean): void {
    for (const p of this.parts) p.mesh.visible = v;
  }
}

export function modelKeyFor(o: PlacedObject): string {
  const def = ITEMS[o.type];
  const base = itemModel(def);
  if (o.level > 1 && def.upgrades) {
    const k = `${base}_${o.level}`;
    if (MODEL_KEYS.includes(k)) return k;
    if (o.level > 2 && MODEL_KEYS.includes(`${base}_2`)) return `${base}_2`;
  }
  return base;
}

export class ObjectRenderer {
  group = new THREE.Group();
  private batches = new Map<string, InstancedModel>();
  private objKey = new Map<number, string>();
  private treeKey = new Map<number, string>();
  private rotors: { id: number; o: PlacedObject }[] = [];
  private rotorAngle = 0;

  constructor(private world: World) {
    world.on('objectAdded', (o) => this.addObject(o));
    world.on('objectRemoved', (o) => this.removeObject(o));
    world.on('objectChanged', (o) => {
      this.removeObject(o);
      this.addObject(o);
    });
    world.on('treeAdded', (t) => this.addTree(t));
    world.on('treeRemoved', (t) => this.removeTree(t));
    world.on('height', () => this.refreshHeights());
    for (const o of world.objects.values()) this.addObject(o);
    for (const t of world.trees.values()) this.addTree(t);
  }

  batch(key: string, shadows = true): InstancedModel {
    let b = this.batches.get(key);
    if (!b) {
      b = new InstancedModel(key, this.group, 16, shadows);
      this.batches.set(key, b);
    }
    return b;
  }

  objectMatrix(o: PlacedObject, out: THREE.Matrix4): THREE.Matrix4 {
    const c = this.world.objectCenter(o);
    const y = this.world.objectBaseHeight(o);
    tmpP.set(c.x, y, c.z);
    tmpQ.setFromAxisAngle(UP, (o.rot * Math.PI) / 2);
    tmpS.set(1, 1, 1);
    return out.compose(tmpP, tmpQ, tmpS);
  }

  addObject(o: PlacedObject): void {
    const key = modelKeyFor(o);
    this.objKey.set(o.id, key);
    this.batch(key).set(o.id, this.objectMatrix(o, tmpM));
    if (o.type === 'windmill') this.rotors.push({ id: o.id, o });
  }

  removeObject(o: PlacedObject): void {
    const key = this.objKey.get(o.id);
    if (key) this.batches.get(key)?.remove(o.id);
    this.objKey.delete(o.id);
    const ri = this.rotors.findIndex((r) => r.id === o.id);
    if (ri >= 0) {
      this.rotors.splice(ri, 1);
      this.batches.get('windmill_rotor')?.remove(o.id);
    }
  }

  treeMatrix(t: Tree, out: THREE.Matrix4): THREE.Matrix4 {
    tmpP.set(t.x, this.world.heightAt(t.x, t.z) - 0.15, t.z);
    tmpQ.setFromAxisAngle(UP, t.r);
    tmpS.setScalar(t.s);
    return out.compose(tmpP, tmpQ, tmpS);
  }

  addTree(t: Tree): void {
    this.treeKey.set(t.id, t.type);
    this.batch(t.type).set(t.id, this.treeMatrix(t, tmpM));
  }

  removeTree(t: Tree): void {
    this.batches.get(t.type)?.remove(t.id);
    this.treeKey.delete(t.id);
  }

  refreshHeights(): void {
    for (const o of this.world.objects.values()) {
      const key = this.objKey.get(o.id);
      if (key) this.batch(key).set(o.id, this.objectMatrix(o, tmpM));
    }
    for (const t of this.world.trees.values()) this.batch(t.type).set(t.id, this.treeMatrix(t, tmpM));
  }

  update(dt: number): void {
    if (!this.rotors.length) return;
    this.rotorAngle += dt * 0.8;
    const b = this.batch('windmill_rotor');
    const off = new THREE.Vector3(...WINDMILL_ROTOR_POS);
    for (const r of this.rotors) {
      const base = this.objectMatrix(r.o, new THREE.Matrix4());
      const local = new THREE.Matrix4().makeTranslation(off.x, off.y, off.z).multiply(new THREE.Matrix4().makeRotationZ(this.rotorAngle));
      b.set(r.id, base.multiply(local));
    }
  }

  /** Build a ghost preview group for a model key. */
  static ghost(key: string): THREE.Group {
    const g = new THREE.Group();
    const data = buildModel(key);
    for (const p of data.parts) {
      const m = new THREE.Mesh(p.geometry, getMaterial('ghost'));
      m.renderOrder = 5;
      g.add(m);
    }
    return g;
  }
}

export { TILE };
