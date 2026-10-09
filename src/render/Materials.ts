// Shared materials for procedural models, with wind / flag shader injections.
import * as THREE from 'three';
import type { MatKey } from './modelTypes';

export const shared = {
  time: { value: 0 },
  windStrength: { value: 0.6 },
  night: { value: 0 },
  /** rgb multiplier for deciduous foliage */
  seasonTint: { value: new THREE.Color(1, 1, 1) },
  autumn: { value: 0 },
};

function injectWind(mat: THREE.MeshStandardMaterial, evergreen: boolean): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.uniforms.uWind = shared.windStrength;
    sh.uniforms.uTint = shared.seasonTint;
    sh.uniforms.uAutumn = shared.autumn;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uWind;
varying float vAutumnMix;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
float ph = 0.0;
#ifdef USE_INSTANCING
ph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.17;
#endif
float hgt = max(0.0, position.y);
float sway = (sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.25) * uWind;
transformed.x += sway * 0.012 * hgt * hgt * 0.1 + sin(uTime * 4.0 + position.x * 2.0 + ph) * 0.03 * uWind;
transformed.z += sway * 0.008 * hgt * hgt * 0.1 + cos(uTime * 3.6 + position.z * 2.0 + ph) * 0.03 * uWind;
vAutumnMix = fract(sin(ph * 12.9898) * 43758.5453);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uTint; uniform float uAutumn;
varying float vAutumnMix;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${evergreen ? '' : `
{
  vec3 c = diffuseColor.rgb;
  float greenness = clamp((c.g - max(c.r, c.b)) * 6.0, 0.0, 1.0);
  vec3 aut = mix(vec3(0.62, 0.22, 0.04), vec3(0.75, 0.48, 0.05), vAutumnMix) * (0.6 + c.g * 1.2);
  c = mix(c, aut, uAutumn * greenness * (0.55 + 0.45 * vAutumnMix));
  diffuseColor.rgb = c * uTint;
}`}`);
  };
  mat.customProgramCacheKey = () => (evergreen ? 'foliage-ever' : 'foliage');
}

function injectCloth(mat: THREE.MeshStandardMaterial): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.uniforms.uWind = shared.windStrength;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uWind;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
float ph = 0.0;
#ifdef USE_INSTANCING
ph = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.23;
#endif
float fx = max(0.0, position.x);
transformed.z += sin(uTime * 7.0 - fx * 6.0 + ph) * fx * 0.22 * (0.4 + uWind);
transformed.y += sin(uTime * 5.0 - fx * 4.0 + ph) * fx * 0.05;`);
  };
  mat.customProgramCacheKey = () => 'cloth';
}

const cache = new Map<string, THREE.Material>();

export function getMaterial(key: MatKey | 'foliage_ever' | 'ghost', opts: { tinted?: boolean } = {}): THREE.Material {
  const k = key + (opts.tinted ? ':t' : '');
  let m = cache.get(k);
  if (m) return m;
  switch (key) {
    case 'std':
      m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
      break;
    case 'metal':
      m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.75, envMapIntensity: 1.2 });
      break;
    case 'glass': {
      const g = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.06, metalness: 0.2, envMapIntensity: 1.6, emissive: new THREE.Color(0xffb35a), emissiveIntensity: 0 });
      m = g;
      break;
    }
    case 'glow':
      m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: new THREE.Color(0xffe0a0), emissiveIntensity: 0.1 });
      break;
    case 'foliage': {
      const f = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
      injectWind(f, false);
      m = f;
      break;
    }
    case 'foliage_ever': {
      const f = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
      injectWind(f, true);
      m = f;
      break;
    }
    case 'cloth': {
      const c = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
      injectCloth(c);
      m = c;
      break;
    }
    case 'water':
      m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.78, envMapIntensity: 1.5, emissive: new THREE.Color(0x0a2a3a), emissiveIntensity: 0.3 });
      break;
    case 'ghost':
      m = new THREE.MeshStandardMaterial({ color: 0x66ff88, transparent: true, opacity: 0.5, roughness: 0.5, emissive: new THREE.Color(0x33aa55), emissiveIntensity: 0.4, depthWrite: false });
      break;
  }
  cache.set(k, m!);
  return m!;
}

/** Update night-dependent emissive intensities. */
export function setNight(n: number): void {
  shared.night.value = n;
  const glass = cache.get('glass') as THREE.MeshStandardMaterial | undefined;
  if (glass) glass.emissiveIntensity = n * 1.1;
  const glow = cache.get('glow') as THREE.MeshStandardMaterial | undefined;
  if (glow) glow.emissiveIntensity = 0.15 + n * 3.5;
}

export const EVERGREEN = new Set(['tree_pine', 'tree_cypress', 'tree_palm', 'bush', 'hedge', 'topiary']);
