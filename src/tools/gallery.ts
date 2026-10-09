// Dev gallery for the procedural model library.
//   gallery.html                 -> every model in a labelled grid
//   gallery.html?key=clubhouse   -> one model, large
//   gallery.html?keys=a,b,c      -> a subset
// Extra params: angle=<yaw deg> (default 35), elev=<deg> (default 38), zoom=<factor>, night=1,
//               grid=0 (hide footprint grid), cols=<n>, cat=<range|course|buildings|scenery|trees|misc>
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildModel, MODEL_KEYS, modelStats, WINDMILL_ROTOR_POS, CARPARK_SLOTS } from '../render/Models';
import type { MatKey, ModelData } from '../render/modelTypes';

/** Footprints in tiles (w along X, h along Z) for the grid overlay; anything missing = 1x1. */
const FOOT: Record<string, [number, number]> = {
  bay_basic: [1, 2], bay_covered: [1, 2], bay_premium: [1, 2], dispenser: [1, 1], target_flag: [2, 2],
  target_ring: [3, 3], target_island: [4, 4], picker_shed: [2, 2], floodlight: [1, 1], practice_green: [4, 4],
  chipping_area: [4, 3], yardage_board: [1, 1], ball_washer: [1, 1], tee_sign: [1, 1], yardage_post: [1, 1],
  drinking_fountain: [1, 1], shelter: [2, 2], halfway_house: [3, 3], clubhouse: [6, 5], clubhouse_2: [6, 5],
  clubhouse_3: [6, 5], pro_shop: [3, 3], pro_shop_2: [3, 3], cafe: [3, 3], cafe_2: [3, 3], toilets: [2, 2],
  bar: [4, 3], restaurant: [5, 4], maintenance: [3, 3], cart_shed: [4, 3], academy: [4, 4], carpark: [6, 4],
  grandstand: [6, 2], helipad: [4, 4], hotel: [8, 6], fountain: [2, 2], gazebo: [3, 3], windmill: [2, 2],
  entrance_sign: [3, 1],
};
/** Rough budgets for flagging. */
const SMALL_PROPS = ['ball_washer', 'tee_sign', 'yardage_post', 'drinking_fountain', 'bench', 'bin', 'lamp', 'flowers_red', 'flowers_yellow', 'flowers_purple', 'bush', 'hedge', 'rock', 'topiary', 'flag_pole', 'flagstick', 'tee_markers', 'fence', 'streetlamp', 'litter', 'bucket', 'yardage_board'];
function budget(key: string): number {
  if (key.startsWith('tree_')) return 700;
  if (key.startsWith('bay_')) return 1800;
  if (['golf_cart', 'car', 'mower', 'ball_picker', 'helicopter'].includes(key)) return 1500;
  if (key === 'hotel') return 12000;
  if (SMALL_PROPS.includes(key)) return 500;
  return 7000;
}

const CATS: Record<string, string[]> = {
  range: ['bay_basic', 'bay_covered', 'bay_premium', 'dispenser', 'target_flag', 'target_ring', 'target_island', 'picker_shed', 'floodlight', 'practice_green', 'chipping_area', 'yardage_board'],
  course: ['ball_washer', 'tee_sign', 'yardage_post', 'drinking_fountain', 'shelter', 'halfway_house', 'flagstick', 'tee_markers'],
  buildings: ['clubhouse', 'clubhouse_2', 'clubhouse_3', 'pro_shop', 'pro_shop_2', 'cafe', 'cafe_2', 'toilets', 'bar', 'restaurant', 'maintenance', 'cart_shed', 'academy', 'carpark', 'grandstand', 'helipad', 'hotel'],
  scenery: ['bench', 'bin', 'lamp', 'flowers_red', 'flowers_yellow', 'flowers_purple', 'bush', 'hedge', 'rock', 'topiary', 'flag_pole', 'fountain', 'gazebo', 'statue', 'windmill', 'windmill_rotor', 'entrance_sign'],
  trees: ['tree_oak', 'tree_pine', 'tree_birch', 'tree_cypress', 'tree_maple', 'tree_willow', 'tree_cherry', 'tree_palm'],
  misc: ['golf_cart', 'car', 'mower', 'ball_picker', 'helicopter', 'fence', 'streetlamp', 'litter', 'bucket'],
};

const qs = new URLSearchParams(location.search);
const night = qs.get('night') === '1';
const yaw = THREE.MathUtils.degToRad(parseFloat(qs.get('angle') ?? '35'));
const elev = THREE.MathUtils.degToRad(parseFloat(qs.get('elev') ?? '38'));
const zoom = parseFloat(qs.get('zoom') ?? '1');
const showGrid = qs.get('grid') !== '0';
let keys: string[] = MODEL_KEYS.slice();
if (qs.get('key')) keys = [qs.get('key')!];
else if (qs.get('keys')) keys = qs.get('keys')!.split(',').map((s) => s.trim()).filter(Boolean);
else if (qs.get('cat')) keys = CATS[qs.get('cat')!] ?? keys;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = night ? 1.1 : 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setScissorTest(true);

const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// Materials mirror the game's material slots (see src/render/Materials.ts) without the wind/cloth shaders.
// ?light=soft gives brighter, flatter studio lighting for inspecting dark corners.
const soft = qs.get('light') === 'soft';
function makeMaterials(): Record<MatKey, THREE.Material> {
  const n = night ? 1 : 0;
  const std = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.75, envMapIntensity: 1.2 });
  const glass = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.06, metalness: 0.2, envMapIntensity: 1.6,
    emissive: 0xffb35a, emissiveIntensity: n * 1.1,
  });
  const glow = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: 0xffe0a0, emissiveIntensity: 0.15 + n * 3.5 });
  const foliage = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const cloth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
  const water = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.78, envMapIntensity: 1.5,
    emissive: 0x0a2a3a, emissiveIntensity: 0.3,
  });
  return { std, metal, glass, glow, foliage, cloth, water };
}
const MATS = makeMaterials();

interface Cell {
  key: string;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  data: ModelData;
  tris: number;
  label: HTMLDivElement;
  center: THREE.Vector3;
  radius: number;
}

function tris(d: ModelData): number {
  let n = 0;
  for (const p of d.parts) n += p.geometry.getAttribute('position').count / 3;
  return n;
}

function makeCell(key: string): Cell {
  const data = buildModel(key);
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  for (const part of data.parts) {
    let mat = MATS[part.mat];
    if (part.tint) {
      const m = (mat as THREE.MeshStandardMaterial).clone();
      m.color.set(key === 'car' ? 0xb8322a : key === 'tee_markers' ? 0x2f6fd6 : 0xffffff);
      mat = m;
    }
    const mesh = new THREE.Mesh(part.geometry, mat);
    mesh.castShadow = part.mat !== 'water' && part.mat !== 'glow';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  scene.add(group);
  // ?repeat=n tiles the model n times along X (checks that bays / hedges / fences join up)
  const rep = parseInt(qs.get('repeat') ?? '1', 10);
  if (rep > 1) {
    const fw0 = (FOOT[key] ?? [1, 1])[0] * 4;
    const orig = group.children.slice();
    for (let r = 1; r < rep; r++) {
      for (const ch of orig) {
        const cl = ch.clone();
        cl.position.x += r * fw0;
        group.add(cl);
      }
    }
    group.position.x = (-(rep - 1) * fw0) / 2;
  }
  // attach the rotor to the windmill (and lift the lone rotor) so they can be inspected
  if (key === 'windmill' || key === 'windmill_rotor') {
    const rot = buildModel('windmill_rotor');
    const rg = key === 'windmill' ? new THREE.Group() : group;
    if (key === 'windmill') {
      for (const part of rot.parts) {
        const m = new THREE.Mesh(part.geometry, MATS[part.mat]);
        m.castShadow = true;
        rg.add(m);
      }
      rg.position.set(...WINDMILL_ROTOR_POS);
      rg.rotation.z = 0.35;
      group.add(rg);
    } else group.position.y = 5.8;
  }
  // show parked cars in the car park slots
  if (key === 'carpark' && qs.get('cars') !== '0') {
    const car = buildModel('car');
    const tints = [0xb8322a, 0x2f5fa8, 0xe8e8e8, 0x2f2f33, 0x3f7f4f, 0xd8b03a];
    CARPARK_SLOTS.forEach((s, i) => {
      if (i % 3 === 2) return;
      const cg = new THREE.Group();
      for (const part of car.parts) {
        let mat = MATS[part.mat];
        if (part.tint) {
          const m = (mat as THREE.MeshStandardMaterial).clone();
          m.color.set(tints[i % tints.length]);
          mat = m;
        }
        const mesh = new THREE.Mesh(part.geometry, mat);
        mesh.castShadow = true;
        cg.add(mesh);
      }
      cg.position.set(s.x, 0, s.z);
      cg.rotation.y = s.rot;
      group.add(cg);
    });
  }

  const box = new THREE.Box3().setFromObject(group);
  const [fw, fh] = FOOT[key] ?? [1, 1];
  const W = fw * 4;
  const H = fh * 4;
  const modelSphere = box.getBoundingSphere(new THREE.Sphere());
  const footR = Math.hypot(W, H) / 2;
  if (qs.get('fit') === 'foot' || footR < modelSphere.radius * 1.7) {
    box.expandByPoint(new THREE.Vector3(-W / 2, 0, -H / 2));
    box.expandByPoint(new THREE.Vector3(W / 2, 0, H / 2));
  }
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  sphere.radius = Math.max(sphere.radius, 0.3);

  // ground
  const gsize = Math.max(W, H, sphere.radius * 2) * 1.6 + 4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(gsize, gsize),
    new THREE.MeshStandardMaterial({ color: night ? 0x2a3a24 : 0x5f9a45, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  if (showGrid) {
    const pts: number[] = [];
    for (let i = 0; i <= fw; i++) pts.push(-W / 2 + i * 4, 0.006, -H / 2, -W / 2 + i * 4, 0.006, H / 2);
    for (let j = 0; j <= fh; j++) pts.push(-W / 2, 0.006, -H / 2 + j * 4, W / 2, 0.006, -H / 2 + j * 4);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2c5a22, transparent: true, opacity: 0.55 })));
    // +Z (front) marker arrow
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.25, 0.6, 3),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    arrow.rotation.x = Math.PI / 2;
    arrow.position.set(0, 0.02, H / 2 + 0.7);
    scene.add(arrow);
  }

  const hemi = new THREE.HemisphereLight(night ? 0x3a4a6a : 0xbfd8ff, night ? 0x1a2010 : 0x4a5a2a, night ? 0.25 : soft ? 1.25 : 0.63);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(night ? 0x8090c0 : 0xfff1dc, night ? 0.3 : 2.6);
  scene.environment = envTex;
  scene.environmentIntensity = night ? 0.05 : soft ? 0.5 : 0.3;
  const r = sphere.radius;
  sun.position.set(sphere.center.x + r * 1.2, r * 2.2 + 4, sphere.center.z + r * 0.9);
  sun.target.position.copy(sphere.center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -r * 1.3; sc.right = r * 1.3; sc.top = r * 1.3; sc.bottom = -r * 1.3;
  sc.near = 0.1; sc.far = r * 8 + 20;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02 + r * 0.0015;
  scene.add(sun, sun.target);
  if (night) {
    // fake lamp light so night shots show something
    const pl = new THREE.PointLight(0xffd29a, 30, r * 3, 1.2);
    pl.position.set(sphere.center.x, sphere.center.y + r * 0.6, sphere.center.z + r * 0.6);
    scene.add(pl);
  }

  scene.background = new THREE.Color(night ? 0x0d1424 : 0xbcd6e6);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 2000);
  const label = document.createElement('div');
  label.className = 'lbl';
  document.body.appendChild(label);
  const t = tris(data);
  const b = budget(key);
  label.innerHTML = `<b>${key}</b> &nbsp;${t} tris${t > b ? ` <span class="over">&gt; ${b}</span>` : ''} &nbsp;h=${data.height.toFixed(1)}m &nbsp;${fw}x${fh}`;
  return { key, scene, camera, data, tris: t, label, center: sphere.center.clone(), radius: sphere.radius };
}

const cells = keys.map(makeCell);
const summary: Record<string, number> = {};
for (const c of cells) summary[c.key] = c.tris;
console.log('TRIS ' + JSON.stringify(summary));
// ?check=1: validate geometry (NaNs, attribute layout) and footprint overhang for every model key
if (qs.get('check') === '1') {
  const issues: string[] = [];
  for (const key of MODEL_KEYS) {
    const d = buildModel(key);
    const bb = new THREE.Box3();
    const mats = new Set<string>();
    for (const p of d.parts) {
      const g = p.geometry;
      if (g.index) issues.push(`${key}: indexed geometry`);
      for (const att of ['position', 'normal', 'color']) if (!g.getAttribute(att)) issues.push(`${key}: missing ${att}`);
      const pos = g.getAttribute('position').array as Float32Array;
      const nrm = g.getAttribute('normal').array as Float32Array;
      for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i]) || !Number.isFinite(nrm[i])) { issues.push(`${key}: NaN`); break; }
      g.computeBoundingBox();
      bb.union(g.boundingBox!);
      const mk = p.mat + (p.tint ? '+t' : '');
      if (mats.has(mk)) issues.push(`${key}: duplicate part ${mk}`);
      mats.add(mk);
    }
    const [fw, fh] = FOOT[key] ?? [1, 1];
    const tol = 0.35;
    const ox = Math.max(-bb.min.x - fw * 2, bb.max.x - fw * 2);
    const oz = Math.max(-bb.min.z - fh * 2, bb.max.z - fh * 2);
    if ((ox > tol || oz > tol) && key !== 'windmill_rotor') issues.push(`${key}: overhang x=${ox.toFixed(2)} z=${oz.toFixed(2)} (bbox ${bb.min.x.toFixed(1)}..${bb.max.x.toFixed(1)}, ${bb.min.z.toFixed(1)}..${bb.max.z.toFixed(1)})`);
    if (bb.min.y < -0.05) issues.push(`${key}: below ground ${bb.min.y.toFixed(2)}`);
  }
  const fb = buildModel('__nope__');
  if (!fb.parts.length) issues.push('fallback empty');
  console.log('CHECK ' + (issues.length ? issues.join(' | ') : 'all ok') + ` (${MODEL_KEYS.length} keys)`);
}
if (qs.get('stats') === '1') for (const c of cells) console.log('STATS ' + c.key + ' ' + JSON.stringify(modelStats(c.key)));
(window as unknown as { __tris: Record<string, number> }).__tris = summary;
document.getElementById('info')!.textContent = `${cells.length} models · total ${Object.values(summary).reduce((a, b) => a + b, 0)} tris`;

function layout(): { cols: number; rows: number; cw: number; ch: number } {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const n = cells.length;
  let cols = parseInt(qs.get('cols') ?? '0', 10);
  if (!cols) cols = Math.max(1, Math.round(Math.sqrt((n * W) / H)));
  cols = Math.min(cols, n);
  const rows = Math.ceil(n / cols);
  return { cols, rows, cw: W / cols, ch: H / rows };
}

function render(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const { cols, cw, ch } = layout();
  const H = window.innerHeight;
  cells.forEach((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * cw;
    const y = row * ch;
    const aspect = cw / ch;
    c.camera.aspect = aspect;
    const fov = THREE.MathUtils.degToRad(c.camera.fov);
    const fitH = c.radius / Math.sin(fov / 2);
    const fitW = c.radius / Math.sin(Math.atan(Math.tan(fov / 2) * aspect));
    const dist = (Math.max(fitH, fitW) * 0.92) / zoom;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev));
    c.camera.position.copy(c.center).addScaledVector(dir, dist);
    c.camera.lookAt(c.center);
    c.camera.near = Math.max(0.02, dist - c.radius * 3);
    c.camera.far = dist + c.radius * 4;
    c.camera.updateProjectionMatrix();
    const gy = H - y - ch;
    renderer.setViewport(x, gy, cw, ch);
    renderer.setScissor(x, gy, cw, ch);
    renderer.render(c.scene, c.camera);
    c.label.style.left = `${x + 4}px`;
    c.label.style.top = `${y + 4}px`;
  });
}

render();
window.addEventListener('resize', render);
