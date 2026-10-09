// Terrain mesh with a splat-map surface shader (fairways, greens, sand, paths...).
import * as THREE from 'three';
import { HN, MAP, PARCEL, ROAD_ROW, SUB, Surf, TILE, WORLD } from '../core/constants';
import type { Region, World } from '../world/World';
import { shared } from './Materials';

export const terrainUniforms = {
  uSplatA: { value: null as THREE.Texture | null },
  uSplatB: { value: null as THREE.Texture | null },
  uInfo: { value: null as THREE.Texture | null },
  uWorld: { value: WORLD },
  uGrid: { value: 0 },
  uHighlight: { value: new THREE.Vector4(-1, -1, -1, -1) },
  uHighlightColor: { value: new THREE.Color(0x66ff88) },
  uOverlay: { value: 0 },
  uOwnership: { value: 0.35 },
  uCloud: { value: 0.3 },
  uSeason: { value: new THREE.Vector4(1, 1, 1, 0) },
  uWet: { value: 0 },
  uSnow: { value: 0 },
};

const GLSL_NOISE = /* glsl */ `
float th(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  float a = th(i), b = th(i+vec2(1,0)), c = th(i+vec2(0,1)), d = th(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
float tfbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * tnoise(p); p *= 2.03; a *= 0.5; } return s; }
vec3 s2l(vec3 c){ return pow(c, vec3(2.2)); }
`;

export class TerrainRenderer {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  private splatA: THREE.DataTexture;
  private splatB: THREE.DataTexture;
  private info: THREE.DataTexture;
  private pos: Float32Array;
  private nrm: Float32Array;
  private pendingHeight: Region | null = null;

  constructor(private world: World) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(HN * HN * 3);
    this.nrm = new Float32Array(HN * HN * 3);
    const step = TILE / SUB;
    for (let vy = 0; vy < HN; vy++) {
      for (let vx = 0; vx < HN; vx++) {
        const i = (vy * HN + vx) * 3;
        this.pos[i] = vx * step;
        this.pos[i + 2] = vy * step;
      }
    }
    const idx = new Uint32Array((HN - 1) * (HN - 1) * 6);
    let k = 0;
    for (let vy = 0; vy < HN - 1; vy++) {
      for (let vx = 0; vx < HN - 1; vx++) {
        const a = vy * HN + vx; // h00
        const b = a + 1; // h10
        const c = a + HN; // h01
        const d = c + 1; // h11
        // (00, 01, 11) and (00, 11, 10) — matches World.heightAt
        idx[k++] = a; idx[k++] = c; idx[k++] = d;
        idx[k++] = a; idx[k++] = d; idx[k++] = b;
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geometry = g;
    this.updateHeights({ x0: 0, y0: 0, x1: MAP - 1, y1: MAP - 1 });
    g.computeBoundingSphere();
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, -30, 0), new THREE.Vector3(WORLD, 60, WORLD));

    const mk = () => {
      const t = new THREE.DataTexture(new Uint8Array(MAP * MAP * 4), MAP, MAP, THREE.RGBAFormat);
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = false;
      return t;
    };
    this.splatA = mk();
    this.splatB = mk();
    this.info = mk();
    terrainUniforms.uSplatA.value = this.splatA;
    terrainUniforms.uSplatB.value = this.splatB;
    terrainUniforms.uInfo.value = this.info;
    this.updateSurfaces();
    this.updateInfo();

    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, terrainUniforms, { uTime: shared.time });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
varying vec3 vWPos;`)
        .replace('#include <fog_vertex>', `#include <fog_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vWPos;
uniform sampler2D uSplatA; uniform sampler2D uSplatB; uniform sampler2D uInfo;
uniform float uWorld; uniform float uGrid; uniform vec4 uHighlight; uniform vec3 uHighlightColor;
uniform float uOverlay; uniform float uOwnership; uniform float uCloud; uniform float uTime;
uniform vec4 uSeason; uniform float uWet; uniform float uSnow;
float gRough;
${GLSL_NOISE}
float sharp(float w, float n){ float e = max(0.035, fwidth(w) * 1.2); return smoothstep(0.5 - e, 0.5 + e, w + n); }
`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 uv = vWPos.xz / uWorld;
  vec4 A = texture2D(uSplatA, uv);
  vec4 B = texture2D(uSplatB, uv);
  vec4 I = texture2D(uInfo, uv);
  vec2 wp = vWPos.xz;
  float n1 = tfbm(wp * 0.08);
  float n2 = tnoise(wp * 0.9);
  float n3 = tnoise(wp * 3.7);
  float edgeN = (tnoise(wp * 0.35) - 0.5) * 0.16;

  // base rough grass
  vec3 rough = mix(s2l(vec3(0.29, 0.44, 0.17)), s2l(vec3(0.39, 0.53, 0.21)), n1);
  rough *= 0.92 + 0.14 * n2 + 0.05 * n3;
  rough = mix(rough, s2l(vec3(0.44, 0.5, 0.22)), smoothstep(0.6, 0.82, tnoise(wp * 0.035 + 7.0)) * 0.4);
  rough = mix(rough, s2l(vec3(0.25, 0.4, 0.16)), smoothstep(0.55, 0.85, tnoise(wp * 0.11 - 3.0)) * 0.3);
  vec3 col = rough;
  gRough = 0.95;

  // long grass / wildflowers: soft golden meadow with tufts
  float wDeep = sharp(B.g, edgeN);
  float meadowN = tfbm(wp * 0.12 + 3.0);
  vec3 deep = mix(s2l(vec3(0.42, 0.5, 0.22)), s2l(vec3(0.6, 0.6, 0.3)), smoothstep(0.3, 0.75, meadowN));
  deep *= 0.9 + 0.16 * n3;
  float tuft = smoothstep(0.62, 0.9, tnoise(wp * 2.2));
  deep = mix(deep, s2l(vec3(0.68, 0.64, 0.36)), tuft * 0.35);
  vec2 fc = wp * 3.2;
  float fcell = th(floor(fc));
  float fdist = length(fract(fc) - 0.5);
  float flowers = step(0.965, fcell) * step(0.42, n1) * (1.0 - smoothstep(0.12, 0.2, fdist));
  vec3 fcol = mix(s2l(vec3(0.97, 0.95, 0.97)), mix(s2l(vec3(0.96, 0.8, 0.22)), s2l(vec3(0.72, 0.5, 0.88)), step(0.5, th(floor(fc) + 7.7))), step(0.4, th(floor(fc) + 3.1)));
  deep = mix(deep, fcol, flowers * 0.9);
  col = mix(col, deep, wDeep);

  // condition (worn turf)
  float cond = I.r;
  float wornPatch = smoothstep(cond - 0.1, cond + 0.15, tfbm(wp * 0.22 + 11.0) * 0.6 + 0.25);

  // fairway with mowing stripes
  float wF = sharp(A.r, edgeN);
  float stripe = step(0.5, fract(wp.x / 7.0 + 0.0)) * 0.6 + step(0.5, fract(wp.y / 7.0)) * 0.4;
  vec3 fair = mix(s2l(vec3(0.42, 0.66, 0.24)), s2l(vec3(0.50, 0.74, 0.29)), stripe);
  fair *= 0.95 + 0.07 * n1;
  // collar (first cut) just inside the edge
  float collarF = smoothstep(0.5, 0.62, A.r + edgeN) ;
  fair = mix(s2l(vec3(0.36, 0.58, 0.2)), fair, collarF);
  fair = mix(fair, s2l(vec3(0.62, 0.6, 0.32)), wornPatch * 0.75);
  col = mix(col, fair, wF);

  // tee
  float wT = sharp(A.b, edgeN * 0.5);
  float tstripe = step(0.5, fract(wp.y / 2.0));
  vec3 tee = mix(s2l(vec3(0.44, 0.69, 0.27)), s2l(vec3(0.51, 0.76, 0.31)), tstripe);
  tee = mix(tee, s2l(vec3(0.6, 0.58, 0.3)), wornPatch * 0.75);
  col = mix(col, tee, wT);

  // green: fine stripes and a fringe
  float wG = sharp(A.g, edgeN * 0.6);
  float gstripe = step(0.5, fract((wp.x + wp.y) / 2.4));
  vec3 grn = mix(s2l(vec3(0.42, 0.72, 0.27)), s2l(vec3(0.48, 0.79, 0.32)), gstripe);
  float fringe = smoothstep(0.5, 0.68, A.g + edgeN * 0.6);
  grn = mix(s2l(vec3(0.38, 0.63, 0.24)), grn, fringe);
  grn = mix(grn, s2l(vec3(0.62, 0.62, 0.34)), wornPatch * 0.8);
  col = mix(col, grn, wG);
  gRough = mix(gRough, 0.75, max(wG, wF) * 0.5);

  // bunker sand
  float wBk = sharp(A.a, edgeN * 0.7);
  vec3 sand = mix(s2l(vec3(0.86, 0.79, 0.6)), s2l(vec3(0.93, 0.87, 0.69)), n3);
  sand *= 0.93 + 0.12 * th(floor(wp * 9.0));
  float lip = 1.0 - smoothstep(0.5, 0.62, A.a + edgeN * 0.7);
  sand = mix(sand, s2l(vec3(0.68, 0.6, 0.42)), lip * 0.7);
  col = mix(col, sand, wBk);
  gRough = mix(gRough, 1.0, wBk);

  // water bed
  float wW = sharp(B.b, 0.0);
  col = mix(col, s2l(vec3(0.27, 0.32, 0.2)) * (0.8 + 0.3 * n1), wW);

  // cart path (asphalt with darker edges)
  float wP = sharp(B.r, edgeN * 0.3);
  vec3 path = mix(s2l(vec3(0.62, 0.61, 0.58)), s2l(vec3(0.7, 0.69, 0.66)), n3);
  float pEdge = 1.0 - smoothstep(0.5, 0.6, B.r);
  path = mix(path, s2l(vec3(0.48, 0.47, 0.44)), pEdge * 0.8);
  col = mix(col, path, wP);
  gRough = mix(gRough, 0.7, wP);

  // paving (stone flags) and road
  float wV = sharp(B.a, 0.0);
  vec2 cell = fract(wp / vec2(1.3, 0.9) + vec2(step(0.5, fract(wp.y / 1.8)) * 0.5, 0.0));
  float joint = smoothstep(0.0, 0.06, min(min(cell.x, 1.0 - cell.x), min(cell.y, 1.0 - cell.y)));
  vec3 pav = mix(s2l(vec3(0.74, 0.69, 0.6)), s2l(vec3(0.82, 0.77, 0.68)), th(floor(wp / vec2(1.3, 0.9))));
  pav *= mix(0.72, 1.0, joint);
  float road = I.b;
  vec3 asph = s2l(vec3(0.27, 0.28, 0.3)) * (0.85 + 0.25 * n3);
  float lane = abs(fract((vWPos.z - ${(ROAD_ROW * TILE + 6).toFixed(1)}) / 100.0) * 100.0) ;
  float centre = (1.0 - smoothstep(0.08, 0.16, abs(vWPos.z - ${(ROAD_ROW * TILE + 6).toFixed(1)}))) * step(0.5, fract(vWPos.x / 6.0));
  float edgeL = (1.0 - smoothstep(0.08, 0.16, abs(vWPos.z - ${(ROAD_ROW * TILE + 1.2).toFixed(1)}))) + (1.0 - smoothstep(0.08, 0.16, abs(vWPos.z - ${(ROAD_ROW * TILE + 10.8).toFixed(1)})));
  asph = mix(asph, s2l(vec3(0.9, 0.85, 0.5)), centre * 0.9);
  asph = mix(asph, s2l(vec3(0.85, 0.85, 0.85)), clamp(edgeL, 0.0, 1.0) * 0.85);
  vec3 hard = mix(pav, asph, road);
  col = mix(col, hard, wV);
  gRough = mix(gRough, mix(0.8, 0.6, road), wV);

  // seasons: tint grass, frost in winter
  float grassy = 1.0 - max(max(wBk, wP), max(wV, wW));
  col = mix(col, col * uSeason.rgb, grassy);
  col = mix(col, mix(col, s2l(vec3(0.8, 0.84, 0.82)), 0.55 * smoothstep(0.35, 0.75, n1 + n3 * 0.2)), uSnow * grassy);
  // wet look
  col *= 1.0 - uWet * 0.25;
  gRough = mix(gRough, gRough * 0.55, uWet);

  // cloud shadows
  float cl = smoothstep(0.45, 0.75, tfbm(wp * 0.0035 + vec2(uTime * 0.004, uTime * 0.0025)));
  col *= 1.0 - cl * uCloud * 0.35;

  // ownership: darken land you do not own
  float owned = I.g;
  col = mix(col * vec3(0.72, 0.74, 0.7), col, mix(1.0, owned, uOwnership));

  // parcel boundaries & tile grid in build mode
  if (uGrid > 0.0) {
    vec2 g = abs(fract(wp / ${TILE.toFixed(1)} - 0.5) - 0.5) / fwidth(wp / ${TILE.toFixed(1)});
    float line = 1.0 - min(min(g.x, g.y), 1.0);
    col = mix(col, vec3(1.0), line * 0.18 * uGrid * owned);
    vec2 pg = abs(fract(wp / ${(PARCEL * TILE).toFixed(1)} - 0.5) - 0.5) / fwidth(wp / ${(PARCEL * TILE).toFixed(1)});
    float pline = 1.0 - min(min(pg.x, pg.y) / 2.0, 1.0);
    col = mix(col, vec3(1.0, 0.95, 0.6), pline * 0.55 * uGrid);
  }
  // overlay heatmaps (condition)
  if (uOverlay > 0.5) {
    float c = I.r;
    vec3 heat = c < 0.5 ? mix(vec3(0.8, 0.1, 0.05), vec3(0.9, 0.8, 0.1), c * 2.0) : mix(vec3(0.9, 0.8, 0.1), vec3(0.1, 0.75, 0.2), (c - 0.5) * 2.0);
    float maint = max(max(wF, wG), wT);
    col = mix(col, s2l(heat), maint * 0.75);
  }
  // highlight rectangle (brush / footprint)
  if (uHighlight.x >= 0.0) {
    vec2 a = uHighlight.xy, b = uHighlight.zw;
    float inside = step(a.x, wp.x) * step(wp.x, b.x) * step(a.y, wp.y) * step(wp.y, b.y);
    vec2 d = min(wp - a, b - wp);
    float border = inside * (1.0 - smoothstep(0.0, 0.35, min(d.x, d.y)));
    col = mix(col, uHighlightColor, inside * 0.28 + border * 0.6);
  }
  diffuseColor.rgb = col;
}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = gRough;`);
    };
    m.customProgramCacheKey = () => 'terrain';
    this.material = m;
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;

    world.on('height', (r) => this.markHeight(r));
    world.on('surf', () => this.updateSurfaces());
    world.on('owned', () => this.updateInfo());
  }

  private markHeight(r: Region): void {
    if (!this.pendingHeight) this.pendingHeight = { ...r };
    else {
      const p = this.pendingHeight;
      p.x0 = Math.min(p.x0, r.x0);
      p.y0 = Math.min(p.y0, r.y0);
      p.x1 = Math.max(p.x1, r.x1);
      p.y1 = Math.max(p.y1, r.y1);
    }
  }

  /** Apply pending height edits (call once per frame). */
  flush(): void {
    if (this.pendingHeight) {
      this.updateHeights(this.pendingHeight);
      this.pendingHeight = null;
    }
  }

  updateHeights(r: Region): void {
    const w = this.world;
    const vx0 = Math.max(0, (r.x0 - 1) * SUB), vy0 = Math.max(0, (r.y0 - 1) * SUB);
    const vx1 = Math.min(HN - 1, (r.x1 + 2) * SUB), vy1 = Math.min(HN - 1, (r.y1 + 2) * SUB);
    const step = TILE / SUB;
    for (let vy = vy0; vy <= vy1; vy++) {
      for (let vx = vx0; vx <= vx1; vx++) {
        const i = vy * HN + vx;
        this.pos[i * 3 + 1] = w.final[i];
        const hl = w.h(vx - 1, vy), hr = w.h(vx + 1, vy), hd = w.h(vx, vy - 1), hu = w.h(vx, vy + 1);
        let nx = hl - hr, ny = 2 * step, nz = hd - hu;
        const l = Math.hypot(nx, ny, nz);
        nx /= l; ny /= l; nz /= l;
        this.nrm[i * 3] = nx;
        this.nrm[i * 3 + 1] = ny;
        this.nrm[i * 3 + 2] = nz;
      }
    }
    const pa = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const na = this.geometry.getAttribute('normal') as THREE.BufferAttribute;
    pa.needsUpdate = true;
    na.needsUpdate = true;
  }

  updateSurfaces(): void {
    const w = this.world;
    const a = this.splatA.image.data as Uint8Array;
    const b = this.splatB.image.data as Uint8Array;
    for (let i = 0; i < MAP * MAP; i++) {
      const s = w.surf[i];
      const o = i * 4;
      a[o] = s === Surf.Fairway ? 255 : 0;
      a[o + 1] = s === Surf.Green ? 255 : 0;
      a[o + 2] = s === Surf.Tee ? 255 : 0;
      a[o + 3] = s === Surf.Bunker ? 255 : 0;
      b[o] = s === Surf.Path ? 255 : 0;
      b[o + 1] = s === Surf.DeepRough ? 255 : 0;
      b[o + 2] = s === Surf.Water ? 255 : 0;
      b[o + 3] = s === Surf.Paving || s === Surf.Road ? 255 : 0;
    }
    this.splatA.needsUpdate = true;
    this.splatB.needsUpdate = true;
    this.updateInfo();
  }

  updateInfo(): void {
    const w = this.world;
    const d = this.info.image.data as Uint8Array;
    for (let y = 0; y < MAP; y++) {
      for (let x = 0; x < MAP; x++) {
        const i = y * MAP + x;
        const o = i * 4;
        d[o] = w.condition[i];
        d[o + 1] = w.isOwnedTile(x, y) || w.surf[i] === Surf.Road ? 255 : 0;
        d[o + 2] = w.surf[i] === Surf.Road ? 255 : 0;
        d[o + 3] = 255;
      }
    }
    this.info.needsUpdate = true;
  }

  /** Refresh only turf condition (cheap path). */
  updateCondition(): void {
    const w = this.world;
    const d = this.info.image.data as Uint8Array;
    for (let i = 0; i < MAP * MAP; i++) d[i * 4] = w.condition[i];
    this.info.needsUpdate = true;
  }
}
