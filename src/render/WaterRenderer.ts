// Animated water surfaces for ponds and lakes.
import * as THREE from 'three';
import { MAP, SUB, Surf, TILE, inMap } from '../core/constants';
import type { World } from '../world/World';
import { shared } from './Materials';

export const waterUniforms = {
  uTime: shared.time,
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
  uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
  uSky: { value: new THREE.Color(0.35, 0.55, 0.85) },
  uHorizon: { value: new THREE.Color(0.75, 0.82, 0.9) },
  uDeep: { value: new THREE.Color(0x1d5d6e) },
  uShallow: { value: new THREE.Color(0x5aa89a) },
  uNight: { value: 0 },
  uRain: { value: 0 },
};

const vert = /* glsl */ `
attribute float shore;
varying float vShore;
varying vec3 vW;
#include <common>
#include <fog_pars_vertex>
void main() {
  vShore = shore;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSky; uniform vec3 uHorizon;
uniform vec3 uDeep; uniform vec3 uShallow; uniform float uNight; uniform float uRain;
varying float vShore; varying vec3 vW;
#include <common>
#include <fog_pars_fragment>
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float waves(vec2 p){
  float t = uTime;
  float h = 0.0;
  h += vn(p * 0.35 + vec2(t * 0.25, t * 0.18)) * 0.5;
  h += vn(p * 0.9 - vec2(t * 0.35, -t * 0.2)) * 0.25;
  h += vn(p * 2.3 + vec2(-t * 0.6, t * 0.45)) * 0.12;
  h += vn(p * 5.1 + vec2(t * 0.9, t * 0.7)) * 0.05 * (1.0 + uRain * 4.0);
  return h;
}
void main() {
  vec2 p = vW.xz;
  float e = 0.15;
  float h0 = waves(p);
  float hx = waves(p + vec2(e, 0.0));
  float hz = waves(p + vec2(0.0, e));
  vec3 N = normalize(vec3((h0 - hx) * 1.6, e, (h0 - hz) * 1.6));
  vec3 V = normalize(cameraPosition - vW);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  vec3 refl = mix(uHorizon, uSky, clamp(R.y * 1.6, 0.0, 1.0));
  float depth = clamp(vShore, 0.0, 1.0);
  vec3 base = mix(uShallow, uDeep, smoothstep(0.0, 1.0, depth));
  vec3 col = mix(base, refl, clamp(0.12 + fres * 0.85, 0.0, 1.0));
  col += vec3(0.02, 0.05, 0.06) * (h0 - 0.4);
  float spec = pow(max(dot(R, normalize(uSunDir)), 0.0), 220.0) * 3.0 + pow(max(dot(R, normalize(uSunDir)), 0.0), 30.0) * 0.18;
  col += uSunColor * spec * (1.0 - uNight * 0.85);
  // shoreline foam
  float foam = (1.0 - smoothstep(0.0, 0.22, depth)) * smoothstep(0.45, 0.75, vn(p * 1.5 + uTime * 0.3) + 0.3 * sin(uTime * 1.5 + depth * 20.0));
  col = mix(col, vec3(0.9, 0.95, 0.95), foam * 0.45);
  col *= 1.0 - uNight * 0.75;
  float alpha = mix(0.55, 0.92, smoothstep(0.0, 0.6, depth)) + fres * 0.1;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class WaterRenderer {
  group = new THREE.Group();
  material: THREE.ShaderMaterial;
  private dirty = true;

  constructor(private world: World) {
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      fog: true,
      depthWrite: false,
    });
    Object.assign(this.material.uniforms, waterUniforms);
    world.on('water', () => (this.dirty = true));
    world.on('height', () => (this.dirty = true));
  }

  update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    for (const c of this.group.children) (c as THREE.Mesh).geometry.dispose();
    this.group.clear();
    const w = this.world;
    const step = TILE / SUB;
    for (const body of w.waterBodies) {
      // half-tile cells covering water tiles plus a half-tile margin around them
      const cells = new Set<number>();
      const HC = MAP * SUB;
      for (const t of body.tiles) {
        const tx = t % MAP, ty = (t / MAP) | 0;
        for (let cy = ty * SUB - 1; cy < ty * SUB + SUB + 1; cy++) {
          for (let cx = tx * SUB - 1; cx < tx * SUB + SUB + 1; cx++) {
            if (cx < 0 || cy < 0 || cx >= HC || cy >= HC) continue;
            cells.add(cy * HC + cx);
          }
        }
      }
      // distance-to-shore per vertex: BFS over tiles
      const dist = new Map<number, number>();
      const q: number[] = [];
      for (const t of body.tiles) {
        const tx = t % MAP, ty = (t / MAP) | 0;
        let edge = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = tx + dx, ny = ty + dy;
          if (!inMap(nx, ny) || w.surf[ny * MAP + nx] !== Surf.Water) edge = true;
        }
        if (edge) {
          dist.set(t, 1);
          q.push(t);
        }
      }
      for (let qi = 0; qi < q.length; qi++) {
        const t = q[qi];
        const d = dist.get(t)!;
        const tx = t % MAP, ty = (t / MAP) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = tx + dx, ny = ty + dy;
          if (!inMap(nx, ny)) continue;
          const ni = ny * MAP + nx;
          if (w.surf[ni] !== Surf.Water || dist.has(ni)) continue;
          dist.set(ni, d + 1);
          q.push(ni);
        }
      }
      const vmap = new Map<number, number>();
      const pos: number[] = [];
      const shore: number[] = [];
      const idx: number[] = [];
      const HV = HC + 1;
      const vert = (vx: number, vy: number): number => {
        const k = vy * HV + vx;
        let id = vmap.get(k);
        if (id !== undefined) return id;
        id = pos.length / 3;
        pos.push(vx * step, body.level, vy * step);
        // shore depth from the tile distance
        const tx = Math.min(MAP - 1, Math.floor((vx - 0.5) / SUB + 0.5));
        const ty = Math.min(MAP - 1, Math.floor((vy - 0.5) / SUB + 0.5));
        let dd = 0;
        for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
          const sx = Math.floor((vx + ox * 0.999) / SUB), sy = Math.floor((vy + oy * 0.999) / SUB);
          if (!inMap(sx, sy)) continue;
          dd = Math.max(dd, dist.get(sy * MAP + sx) ?? 0);
        }
        void tx;
        void ty;
        shore.push(Math.min(1, Math.max(0, (dd - 0.6) / 3.5)));
        vmap.set(k, id);
        return id;
      };
      for (const c of cells) {
        const cx = c % HC, cy = (c / HC) | 0;
        const a = vert(cx, cy), b = vert(cx + 1, cy), cc = vert(cx, cy + 1), d = vert(cx + 1, cy + 1);
        idx.push(a, cc, d, a, d, b);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('shore', new THREE.Float32BufferAttribute(shore, 1));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, this.material);
      m.renderOrder = 2;
      this.group.add(m);
    }
  }
}
