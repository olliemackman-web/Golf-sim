// Vehicles, golf balls (in flight, on the range field), litter and hole markers.
import * as THREE from 'three';
import type { Sim } from '../sim/Sim';
import type { Course } from '../world/Course';
import type { World } from '../world/World';
import { InstancedModel } from './ObjectRenderer';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const col = new THREE.Color();

const TRAIL_N = 24;

export class EntityRenderer {
  group = new THREE.Group();
  private vehicles = new Map<string, InstancedModel>();
  private ballMesh: THREE.InstancedMesh;
  private fieldMesh: THREE.InstancedMesh;
  private fieldVersion = -1;
  private litter: InstancedModel;
  private litterVersion = -1;
  private flags: InstancedModel;
  private tees: InstancedModel;
  private holeVersion = '';
  private trails = new Map<number, { pts: THREE.Vector3[]; age: number }>();
  private trailGeo: THREE.BufferGeometry;
  private trailLines: THREE.LineSegments;
  ballScale = 1;
  hideBalls = false;

  constructor(private world: World) {
    const bg = new THREE.SphereGeometry(0.11, 10, 8);
    const bm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 0.25 });
    this.ballMesh = new THREE.InstancedMesh(bg, bm, 512);
    this.ballMesh.count = 0;
    this.ballMesh.frustumCulled = false;
    this.ballMesh.castShadow = true;
    this.group.add(this.ballMesh);
    const fg = new THREE.SphereGeometry(0.09, 6, 4);
    const fm = new THREE.MeshStandardMaterial({ color: 0xf6f6f0, roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.12 });
    this.fieldMesh = new THREE.InstancedMesh(fg, fm, 12000);
    this.fieldMesh.count = 0;
    this.fieldMesh.frustumCulled = false;
    this.group.add(this.fieldMesh);
    this.litter = new InstancedModel('litter', this.group, 64, false);
    this.flags = new InstancedModel('flagstick', this.group, 18, true);
    this.tees = new InstancedModel('tee_markers', this.group, 18, true);

    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * TRAIL_N * 2 * 3), 3));
    this.trailGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(64 * TRAIL_N * 2 * 4), 4));
    this.trailLines = new THREE.LineSegments(this.trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    this.trailLines.frustumCulled = false;
    this.group.add(this.trailLines);
  }

  private vbatch(type: string): InstancedModel {
    let b = this.vehicles.get(type);
    if (!b) {
      b = new InstancedModel(type, this.group, 16, true);
      this.vehicles.set(type, b);
    }
    return b;
  }

  update(sim: Sim, course: Course, dt: number, camDist: number): void {
    // vehicles
    const seen = new Map<string, Set<number>>();
    for (const v of sim.vehicles) {
      if (v.removed || !v.visible) continue;
      const b = this.vbatch(v.type);
      tmpP.set(v.x, v.y + (v.lift ?? 0), v.z);
      tmpQ.setFromAxisAngle(UP, v.heading);
      tmpM.compose(tmpP, tmpQ, tmpS);
      b.set(v.id, tmpM, col.setHex(v.color));
      let s = seen.get(v.type);
      if (!s) seen.set(v.type, (s = new Set()));
      s.add(v.id);
    }
    for (const [type, b] of this.vehicles) {
      const s = seen.get(type);
      // remove instances no longer present
      const ids = b.idList();
      for (const id of ids) if (!s || !s.has(id)) b.remove(id);
    }

    // golf balls (in flight / at rest on the course)
    const bscale = this.ballScale * Math.max(1, Math.min(4, camDist / 60));
    let n = 0;
    const live = new Set<number>();
    for (const b of sim.balls) {
      if (b.removed || b.state === 'hidden' || this.hideBalls) continue;
      if (n >= 512) break;
      tmpP.set(b.x, b.y + 0.05 * bscale, b.z);
      tmpM.makeScale(bscale * b.size, bscale * b.size, bscale * b.size).setPosition(tmpP);
      this.ballMesh.setMatrixAt(n++, tmpM);
      if (b.state === 'flying' && b.trail) {
        live.add(b.id);
        let tr = this.trails.get(b.id);
        if (!tr) this.trails.set(b.id, (tr = { pts: [], age: 0 }));
        tr.pts.push(new THREE.Vector3(b.x, b.y, b.z));
        if (tr.pts.length > TRAIL_N) tr.pts.shift();
        tr.age = 0;
      }
    }
    this.ballMesh.count = n;
    this.ballMesh.instanceMatrix.needsUpdate = true;
    // trails fade after the ball lands
    const pos = this.trailGeo.getAttribute('position') as THREE.BufferAttribute;
    const cl = this.trailGeo.getAttribute('color') as THREE.BufferAttribute;
    let seg = 0;
    for (const [id, tr] of this.trails) {
      if (!live.has(id)) {
        tr.age += dt;
        if (tr.age > 1.2) {
          this.trails.delete(id);
          continue;
        }
      }
      const fade = 1 - tr.age / 1.2;
      for (let i = 1; i < tr.pts.length && seg < 64 * TRAIL_N; i++) {
        const a = tr.pts[i - 1], c = tr.pts[i];
        pos.setXYZ(seg * 2, a.x, a.y, a.z);
        pos.setXYZ(seg * 2 + 1, c.x, c.y, c.z);
        const al = (i / tr.pts.length) * 0.75 * fade;
        cl.setXYZW(seg * 2, 1, 1, 1, al * 0.8);
        cl.setXYZW(seg * 2 + 1, 1, 1, 1, al);
        seg++;
      }
    }
    this.trailGeo.setDrawRange(0, seg * 2);
    pos.needsUpdate = true;
    cl.needsUpdate = true;

    // range field balls
    if (sim.field.version !== this.fieldVersion) {
      this.fieldVersion = sim.field.version;
      const f = sim.field;
      const w = this.world;
      for (let i = 0; i < f.n; i++) {
        tmpM.makeTranslation(f.x[i], w.heightAt(f.x[i], f.z[i]) + 0.07, f.z[i]);
        this.fieldMesh.setMatrixAt(i, tmpM);
      }
      this.fieldMesh.count = f.n;
      this.fieldMesh.instanceMatrix.needsUpdate = true;
    }
    const fs = Math.max(1, Math.min(3.2, camDist / 70));
    this.fieldMesh.scale.set(1, 1, 1);
    (this.fieldMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.12 + (fs - 1) * 0.2;

    // litter
    if (sim.litterVersion !== this.litterVersion) {
      this.litterVersion = sim.litterVersion;
      this.litter.clear();
      for (const l of sim.litter) {
        tmpP.set(l.x, this.world.heightAt(l.x, l.z), l.z);
        tmpQ.setFromAxisAngle(UP, l.rot);
        tmpM.compose(tmpP, tmpQ, tmpS);
        this.litter.set(l.id, tmpM);
      }
    }

    // hole flags and tee markers
    const key = course.holes.map((h) => `${h.save.id}:${h.save.tee.x},${h.save.tee.y},${h.save.pin.x},${h.save.pin.y},${h.valid},${h.route.length}`).join('|') + ':' + this.heightStamp;
    if (key !== this.holeVersion) {
      this.holeVersion = key;
      this.flags.clear();
      this.tees.clear();
      for (const h of course.holes) {
        const p = h.pinWorld, t = h.teeWorld;
        tmpP.set(p.x, this.world.heightAt(p.x, p.z), p.z);
        tmpQ.setFromAxisAngle(UP, 0);
        tmpM.compose(tmpP, tmpQ, new THREE.Vector3(1.6, 1.6, 1.6));
        this.flags.set(h.save.id, tmpM);
        const next = h.route[1] ?? p;
        const ang = Math.atan2(next.x - t.x, next.z - t.z);
        tmpP.set(t.x, this.world.heightAt(t.x, t.z), t.z);
        tmpQ.setFromAxisAngle(UP, ang);
        tmpM.compose(tmpP, tmpQ, new THREE.Vector3(1.3, 1.3, 1.3));
        this.tees.set(h.save.id, tmpM, col.setHex(h.valid ? 0x2f6fd8 : 0xd83a2f));
      }
    }
  }

  heightStamp = 0;
}
