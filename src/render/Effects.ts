// Particles, rain, birds and floating money text.
import * as THREE from 'three';
import { WORLD } from '../core/constants';
import { shared } from './Materials';

const MAXPART = 3000;

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  r: number; g: number; b: number;
  size: number;
  grav: number;
  drag: number;
}

const pvert = /* glsl */ `
attribute vec4 pcolor;
attribute float psize;
varying vec4 vC;
#include <common>
#include <fog_pars_vertex>
void main(){
  vC = pcolor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = psize * (300.0 / -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const pfrag = /* glsl */ `
varying vec4 vC;
#include <common>
#include <fog_pars_fragment>
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.2, length(d)) * vC.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vC.rgb, a);
  #include <fog_fragment>
}`;

export class Effects {
  group = new THREE.Group();
  private parts: Particle[] = [];
  private pgeo: THREE.BufferGeometry;
  private points: THREE.Points;
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private birds: THREE.InstancedMesh;
  private flocks: { cx: number; cz: number; r: number; h: number; speed: number; phase: number; n: number }[] = [];
  private texts: { el: HTMLDivElement; x: number; y: number; z: number; t: number }[] = [];
  private textLayer: HTMLDivElement;
  private v = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.pgeo = new THREE.BufferGeometry();
    this.pgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXPART * 3), 3));
    this.pgeo.setAttribute('pcolor', new THREE.BufferAttribute(new Float32Array(MAXPART * 4), 4));
    this.pgeo.setAttribute('psize', new THREE.BufferAttribute(new Float32Array(MAXPART), 1));
    const pm = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: pvert, fragmentShader: pfrag, transparent: true, depthWrite: false, fog: true,
    });
    this.points = new THREE.Points(this.pgeo, pm);
    this.points.frustumCulled = false;
    this.group.add(this.points);

    // rain streaks
    const RN = 2200;
    this.rainPos = new Float32Array(RN * 6);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaabbcc, transparent: true, opacity: 0.35, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.group.add(this.rain);

    // birds
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0.35, -0.9, 0, -0.1, 0, 0, -0.25,
      0, 0, 0.35, 0, 0, -0.25, 0.9, 0, -0.1,
    ], 3));
    bg.computeVertexNormals();
    const bm = new THREE.MeshBasicMaterial({ color: 0x1d1d22, side: THREE.DoubleSide });
    bm.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = shared.time;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
float ph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.3;
transformed.y += abs(position.x) * sin(uTime * 9.0 + ph) * 0.7;`);
    };
    const NB = 36;
    this.birds = new THREE.InstancedMesh(bg, bm, NB);
    this.birds.frustumCulled = false;
    this.group.add(this.birds);
    for (let i = 0; i < 3; i++) this.flocks.push({ cx: WORLD * (0.2 + Math.random() * 0.6), cz: WORLD * (0.2 + Math.random() * 0.6), r: 120 + Math.random() * 160, h: 45 + Math.random() * 35, speed: 0.05 + Math.random() * 0.04, phase: Math.random() * 6, n: 12 });

    this.textLayer = document.createElement('div');
    this.textLayer.className = 'fx-layer';
    container.appendChild(this.textLayer);
  }

  spawn(kind: 'splash' | 'splash_small' | 'sparkle' | 'confetti' | 'dust' | 'sand' | 'leaves' | 'fountain', x: number, y: number, z: number, count?: number): void {
    const add = (p: Partial<Particle>) => {
      if (this.parts.length >= MAXPART) return;
      this.parts.push({ x, y, z, vx: 0, vy: 0, vz: 0, life: 0, max: 1, r: 1, g: 1, b: 1, size: 0.4, grav: 9.8, drag: 0.5, ...p });
    };
    const R = Math.random;
    switch (kind) {
      case 'splash':
      case 'splash_small': {
        const n = count ?? (kind === 'splash' ? 60 : 14);
        const k = kind === 'splash' ? 1 : 0.5;
        for (let i = 0; i < n; i++) {
          const a = R() * Math.PI * 2, s = R() * 2.5 * k;
          add({ vx: Math.cos(a) * s, vy: (3 + R() * 5) * k, vz: Math.sin(a) * s, max: 0.7 + R() * 0.6, r: 0.85, g: 0.93, b: 1, size: 0.35 + R() * 0.3, grav: 12 });
        }
        break;
      }
      case 'sparkle':
        for (let i = 0; i < (count ?? 18); i++) {
          const a = R() * Math.PI * 2, s = 1 + R() * 2.5;
          add({ vx: Math.cos(a) * s, vy: 2 + R() * 3, vz: Math.sin(a) * s, max: 0.8 + R() * 0.6, r: 1, g: 0.85, b: 0.3, size: 0.5 + R() * 0.4, grav: 3 });
        }
        break;
      case 'confetti':
        for (let i = 0; i < (count ?? 160); i++) {
          const a = R() * Math.PI * 2, s = 2 + R() * 6;
          const c = new THREE.Color().setHSL(R(), 0.85, 0.6);
          add({ vx: Math.cos(a) * s, vy: 8 + R() * 10, vz: Math.sin(a) * s, max: 2.5 + R() * 1.5, r: c.r, g: c.g, b: c.b, size: 0.6 + R() * 0.5, grav: 6, drag: 1.2 });
        }
        break;
      case 'dust':
      case 'sand':
        for (let i = 0; i < (count ?? 20); i++) {
          const a = R() * Math.PI * 2, s = R() * 2;
          const sand = kind === 'sand';
          add({ vx: Math.cos(a) * s, vy: 1 + R() * 2, vz: Math.sin(a) * s, max: 0.8 + R(), r: sand ? 0.92 : 0.6, g: sand ? 0.85 : 0.55, b: sand ? 0.65 : 0.45, size: 0.5 + R() * 0.6, grav: 2, drag: 1.5 });
        }
        break;
      case 'leaves':
        for (let i = 0; i < (count ?? 12); i++) {
          add({ vx: (R() - 0.5) * 2, vy: R() * 1.5, vz: (R() - 0.5) * 2, max: 1.5 + R(), r: 0.3, g: 0.55, b: 0.2, size: 0.35, grav: 2.5, drag: 2 });
        }
        break;
      case 'fountain':
        for (let i = 0; i < (count ?? 3); i++) {
          const a = R() * Math.PI * 2, s = 0.3 + R() * 0.4;
          add({ vx: Math.cos(a) * s, vy: 3.2 + R() * 0.8, vz: Math.sin(a) * s, max: 0.9, r: 0.8, g: 0.9, b: 1, size: 0.18, grav: 9 });
        }
        break;
    }
  }

  floatText(text: string, x: number, y: number, z: number, cls = ''): void {
    if (this.texts.length > 45) {
      const old = this.texts.shift()!;
      old.el.remove();
    }
    const el = document.createElement('div');
    el.className = 'fx-text ' + cls;
    el.textContent = text;
    this.textLayer.appendChild(el);
    this.texts.push({ el, x, y, z, t: 0 });
  }

  update(dt: number, camera: THREE.PerspectiveCamera, rain: number, wind: { x: number; z: number }, showBirds: boolean): void {
    // particles
    const pos = this.pgeo.getAttribute('position') as THREE.BufferAttribute;
    const colA = this.pgeo.getAttribute('pcolor') as THREE.BufferAttribute;
    const sz = this.pgeo.getAttribute('psize') as THREE.BufferAttribute;
    let n = 0;
    const keep: Particle[] = [];
    for (const p of this.parts) {
      p.life += dt;
      if (p.life >= p.max) continue;
      p.vy -= p.grav * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      keep.push(p);
      const a = 1 - p.life / p.max;
      pos.setXYZ(n, p.x, p.y, p.z);
      colA.setXYZW(n, p.r, p.g, p.b, Math.min(1, a * 1.5));
      sz.setX(n, p.size);
      n++;
    }
    this.parts = keep;
    this.pgeo.setDrawRange(0, n);
    pos.needsUpdate = true;
    colA.needsUpdate = true;
    sz.needsUpdate = true;

    // rain around the camera
    this.rain.visible = rain > 0.02;
    if (this.rain.visible) {
      const rp = this.rainPos;
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      const N = Math.floor((rp.length / 6) * Math.min(1, rain));
      const fall = 38 * dt;
      for (let i = 0; i < rp.length / 6; i++) {
        const o = i * 6;
        if (i >= N) {
          rp[o + 1] = rp[o + 4] = -9999;
          continue;
        }
        let x = rp[o], y = rp[o + 1], z = rp[o + 2];
        y -= fall;
        x += wind.x * dt;
        z += wind.z * dt;
        if (y < cy - 60 || Math.abs(x - cx) > 70 || Math.abs(z - cz) > 70 || y < -9000) {
          x = cx + (Math.random() - 0.5) * 140;
          z = cz + (Math.random() - 0.5) * 140;
          y = cy + Math.random() * 60 - 10;
        }
        rp[o] = x; rp[o + 1] = y; rp[o + 2] = z;
        rp[o + 3] = x + wind.x * 0.03; rp[o + 4] = y + 1.2; rp[o + 5] = z + wind.z * 0.03;
      }
      (this.rain.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.rain.material as THREE.LineBasicMaterial).opacity = 0.22 + rain * 0.2;
    }

    // birds
    this.birds.visible = showBirds;
    if (showBirds) {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3(1.4, 1.4, 1.4);
      let k = 0;
      const t = shared.time.value;
      for (const f of this.flocks) {
        const a = t * f.speed + f.phase;
        const fx = f.cx + Math.cos(a) * f.r, fz = f.cz + Math.sin(a) * f.r;
        const heading = Math.atan2(-Math.sin(a), Math.cos(a));
        for (let i = 0; i < f.n && k < this.birds.count; i++) {
          const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
          const ox = side * row * 2.2, oz = -row * 2.6;
          const c = Math.cos(heading), sn = Math.sin(heading);
          const px = fx + ox * c + oz * sn + Math.sin(t * 0.7 + i) * 0.6;
          const pz = fz - ox * sn + oz * c;
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
          m.compose(new THREE.Vector3(px, f.h + Math.sin(t * 0.9 + i * 0.5) * 1.2, pz), q, s);
          this.birds.setMatrixAt(k++, m);
        }
      }
      this.birds.instanceMatrix.needsUpdate = true;
    }

    // floating text
    const w = window.innerWidth, h = window.innerHeight;
    const keepT: typeof this.texts = [];
    for (const ft of this.texts) {
      ft.t += dt;
      if (ft.t > 1.6) {
        ft.el.remove();
        continue;
      }
      this.v.set(ft.x, ft.y + ft.t * 3, ft.z).project(camera);
      if (this.v.z > 1) {
        ft.el.style.opacity = '0';
      } else {
        const sx = (this.v.x * 0.5 + 0.5) * w, sy = (-this.v.y * 0.5 + 0.5) * h;
        ft.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
        ft.el.style.opacity = String(Math.min(1, (1.6 - ft.t) * 1.6));
      }
      keepT.push(ft);
    }
    this.texts = keepT;
  }
}
