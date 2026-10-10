// Renders small preview images of models for the build menu.
// They are drawn with the game's own WebGL context at the start of a frame (in a corner that the main
// render then paints over), because phones drop the main context when a page opens a second one.
import * as THREE from 'three';
import { getMaterial } from '../render/Materials';
import { buildModel } from '../render/Models';

const W = 192, H = 144;
const SS = 2; // drawn at twice the size and averaged down, which gives smooth edges and soft alpha
const KEY = new THREE.Color(1, 0, 1); // background colour that is keyed out to transparent

const cache = new Map<string, string>();
const queue: { key: string; cb: (url: string) => void }[] = [];
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let out: HTMLCanvasElement | null = null;
const tmp = new THREE.Vector2();
const tmpColor = new THREE.Color();

function setup(): void {
  if (scene) return;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x3a4a2a, 1.3));
  const d = new THREE.DirectionalLight(0xfff2dd, 2.4);
  d.position.set(5, 9, 7);
  scene.add(d);
  camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 500);
  out = document.createElement('canvas');
  out.width = W;
  out.height = H;
}

function renderOne(r: THREE.WebGLRenderer, key: string): string {
  const g = new THREE.Group();
  const data = buildModel(key);
  for (const p of data.parts) g.add(new THREE.Mesh(p.geometry, getMaterial(p.mat === 'foliage' ? 'foliage_ever' : p.mat)));
  scene!.add(g);
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const rad = Math.max(size.x, size.y * 1.2, size.z) * 0.62 + 0.3;
  const dist = (rad / Math.tan((camera!.fov * Math.PI) / 360)) * 1.05;
  camera!.position.copy(center).addScaledVector(new THREE.Vector3(0.75, 0.62, 1).normalize(), dist);
  camera!.lookAt(center);
  r.render(scene!, camera!);
  scene!.remove(g);

  const w = W * SS, h = H * SS;
  const gl = r.getContext();
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  // the bottom-left corner is always background: use it as the exact key colour
  const kr = px[0], kg = px[1], kb = px[2];
  const ctx = out!.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let n = 0, sr = 0, sg = 0, sb = 0;
      for (let sy = 0; sy < SS; sy++) {
        const row = h - 1 - (y * SS + sy); // WebGL rows start at the bottom
        for (let sx = 0; sx < SS; sx++) {
          const i = (row * w + x * SS + sx) * 4;
          const pr = px[i], pg = px[i + 1], pb = px[i + 2];
          if (Math.abs(pr - kr) + Math.abs(pg - kg) + Math.abs(pb - kb) <= 6) continue;
          n++;
          sr += pr;
          sg += pg;
          sb += pb;
        }
      }
      const o = (y * W + x) * 4;
      if (n) {
        img.data[o] = sr / n;
        img.data[o + 1] = sg / n;
        img.data[o + 2] = sb / n;
        img.data[o + 3] = (n * 255) / (SS * SS);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return out!.toDataURL('image/png');
}

/** Called by the renderer at the start of a frame, before the main scene is drawn. */
export function drawPendingThumbnails(r: THREE.WebGLRenderer): void {
  if (!queue.length) return;
  const buf = r.getDrawingBufferSize(tmp);
  if (buf.x < W * SS || buf.y < H * SS) {
    // a tiny window: skip previews rather than draw them badly
    for (const job of queue.splice(0)) job.cb('');
    return;
  }
  setup();
  const pr = r.getPixelRatio();
  const css = r.getSize(new THREE.Vector2());
  const exposure = r.toneMappingExposure;
  const clear = r.getClearColor(tmpColor).clone();
  const clearA = r.getClearAlpha();
  r.setRenderTarget(null);
  r.setViewport(0, 0, (W * SS) / pr, (H * SS) / pr);
  r.setScissor(0, 0, (W * SS) / pr, (H * SS) / pr);
  r.setScissorTest(true);
  r.setClearColor(KEY, 1);
  r.toneMappingExposure = 1.05;
  try {
    let drawn = 0;
    while (queue.length && drawn < 2) {
      const job = queue.shift()!;
      let url = cache.get(job.key);
      if (url === undefined) {
        try {
          url = renderOne(r, job.key);
        } catch {
          url = '';
        }
        cache.set(job.key, url);
        drawn++;
      }
      job.cb(url);
    }
  } finally {
    r.setScissorTest(false);
    r.setViewport(0, 0, css.x, css.y);
    r.setClearColor(clear, clearA);
    r.toneMappingExposure = exposure;
  }
}

export function thumbnail(key: string, cb: (url: string) => void): void {
  const c = cache.get(key);
  if (c !== undefined) {
    cb(c);
    return;
  }
  queue.push({ key, cb });
}
