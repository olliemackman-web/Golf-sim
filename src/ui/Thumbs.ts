// Renders small preview images of models for the build menu.
import * as THREE from 'three';
import { getMaterial } from '../render/Materials';
import { buildModel } from '../render/Models';

const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
const queue: { key: string; cb: (url: string) => void }[] = [];
let busy = false;
let disposeTimer = 0;

function setup(): boolean {
  if (renderer) return true;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return false;
  }
  renderer.setSize(192, 144);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x3a4a2a, 1.3));
  const d = new THREE.DirectionalLight(0xfff2dd, 2.4);
  d.position.set(5, 9, 7);
  scene.add(d);
  camera = new THREE.PerspectiveCamera(30, 192 / 144, 0.1, 500);
  return true;
}

function renderOne(key: string): string {
  const g = new THREE.Group();
  const data = buildModel(key);
  for (const p of data.parts) {
    const m = new THREE.Mesh(p.geometry, getMaterial(p.mat === 'foliage' ? 'foliage_ever' : p.mat));
    g.add(m);
  }
  scene!.add(g);
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y * 1.2, size.z) * 0.62 + 0.3;
  const dist = r / Math.tan((camera!.fov * Math.PI) / 360) * 1.05;
  const dir = new THREE.Vector3(0.75, 0.62, 1).normalize();
  camera!.position.copy(center).addScaledVector(dir, dist);
  camera!.lookAt(center);
  renderer!.render(scene!, camera!);
  const url = renderer!.domElement.toDataURL('image/png');
  scene!.remove(g);
  return url;
}

function pump(): void {
  if (busy) return;
  busy = true;
  const step = () => {
    const job = queue.shift();
    if (!job) {
      busy = false;
      clearTimeout(disposeTimer);
      disposeTimer = window.setTimeout(() => {
        renderer?.dispose();
        renderer?.forceContextLoss();
        renderer = null;
      }, 8000);
      return;
    }
    let url = cache.get(job.key);
    if (!url) {
      try {
        if (setup()) url = renderOne(job.key);
      } catch {
        url = '';
      }
      cache.set(job.key, url ?? '');
    }
    job.cb(url ?? '');
    requestAnimationFrame(step);
  };
  step();
}

export function thumbnail(key: string, cb: (url: string) => void): void {
  const c = cache.get(key);
  if (c !== undefined) {
    cb(c);
    return;
  }
  queue.push({ key, cb });
  pump();
}
