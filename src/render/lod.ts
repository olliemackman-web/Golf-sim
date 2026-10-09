// Cheap stand-in models for distant trees, derived from the detailed model's bounds and colours.
import * as THREE from 'three';
import { buildModel } from './Models';
import type { ModelData, ModelPart } from './modelTypes';

const cache = new Map<string, ModelData>();

function avgColor(g: THREE.BufferGeometry): THREE.Color {
  const c = g.getAttribute('color');
  const col = new THREE.Color(0, 0, 0);
  if (!c) return new THREE.Color(0.3, 0.5, 0.2);
  const n = c.count;
  const step = Math.max(1, Math.floor(n / 400));
  let k = 0;
  for (let i = 0; i < n; i += step) {
    col.r += c.getX(i);
    col.g += c.getY(i);
    col.b += c.getZ(i);
    k++;
  }
  return col.multiplyScalar(1 / Math.max(1, k));
}

function paint(g: THREE.BufferGeometry, base: THREE.Color, shade = 0.25): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  const pos = ng.getAttribute('position');
  const box = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute);
  const h = Math.max(0.01, box.max.y - box.min.y);
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - box.min.y) / h;
    const f = 1 - shade + shade * 2 * t * 0.8;
    col[i * 3] = base.r * f;
    col[i * 3 + 1] = base.g * f;
    col[i * 3 + 2] = base.b * f;
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  ng.deleteAttribute('uv');
  return ng;
}

/** Low-poly version of a tree model (~60-100 triangles). */
export function lodModel(key: string): ModelData {
  const hit = cache.get(key);
  if (hit) return hit;
  const full = buildModel(key);
  const parts: ModelPart[] = [];
  let height = full.height;
  for (const p of full.parts) {
    const box = new THREE.Box3().setFromBufferAttribute(p.geometry.getAttribute('position') as THREE.BufferAttribute);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const color = avgColor(p.geometry);
    height = Math.max(height, box.max.y);
    if (p.mat === 'foliage') {
      const tall = size.y > Math.max(size.x, size.z) * 1.6;
      let g: THREE.BufferGeometry;
      if (tall) {
        g = new THREE.ConeGeometry(0.5, 1, 7, 1).scale(size.x * 0.95, size.y, size.z * 0.95).translate(c.x, c.y, c.z);
      } else {
        g = new THREE.IcosahedronGeometry(0.5, 1).scale(size.x * 0.92, size.y * 0.92, size.z * 0.92).translate(c.x, c.y, c.z);
      }
      parts.push({ geometry: paint(g, color, 0.3), mat: 'foliage' });
    } else {
      // trunk: a thin tapered cylinder up to where the canopy begins
      const g = new THREE.CylinderGeometry(Math.max(0.08, size.x * 0.06), Math.max(0.12, size.x * 0.1), size.y, 5, 1).translate(c.x, c.y, c.z);
      parts.push({ geometry: paint(g, color, 0.1), mat: p.mat });
    }
  }
  const data = { parts, height };
  cache.set(key, data);
  return data;
}
