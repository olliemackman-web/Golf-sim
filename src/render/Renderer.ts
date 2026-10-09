// Scene setup: renderer, sky, lighting, day/night, post-processing.
import { listen } from '../core/listeners';
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { WORLD } from '../core/constants';
import { setNight, shared } from './Materials';
import { terrainUniforms } from './TerrainRenderer';
import { waterUniforms } from './WaterRenderer';

export type Quality = 'low' | 'medium' | 'high';

export interface EnvState {
  hour: number;
  dayOfYear: number;
  cloud: number; // 0..1
  rain: number; // 0..1
  season: number;
  wind: number; // mph
}

export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: Sky;
  composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  quality: Quality;
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envSky: Sky;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private lastEnvKey = '';
  private stars: THREE.Points;
  night = 0;
  sunDir = new THREE.Vector3();
  focus = new THREE.Vector3(WORLD / 2, 0, WORLD / 2);
  shadowSpan = 160;
  envScale = 1;

  constructor(private container: HTMLElement, quality: Quality) {
    this.quality = quality;
    const r = new THREE.WebGLRenderer({ antialias: quality === 'low', powerPreference: 'high-performance', preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1));
    r.setSize(container.clientWidth, container.clientHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(r.domElement);
    r.domElement.style.display = 'block';
    r.domElement.classList.add('gl');
    this.renderer = r;

    this.camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.3, 6000);

    // sky
    this.sky = new Sky();
    this.sky.scale.setScalar(5000);
    const su = this.sky.material.uniforms;
    su.turbidity.value = 3.2;
    su.rayleigh.value = 1.6;
    su.mieCoefficient.value = 0.004;
    su.mieDirectionalG.value = 0.82;
    if (su.cloudCoverage) {
      su.cloudCoverage.value = 0.35;
      su.cloudDensity.value = 0.45;
      su.cloudScale.value = 0.00025;
      su.cloudSpeed.value = 0.00003;
    }
    this.scene.add(this.sky);
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(r);

    // stars
    const sg = new THREE.BufferGeometry();
    const sp: number[] = [];
    for (let i = 0; i < 1600; i++) {
      const u = Math.random(), v = Math.random() * 0.9 + 0.08;
      const th = u * Math.PI * 2, ph = Math.acos(v);
      sp.push(Math.sin(ph) * Math.cos(th) * 4000, Math.cos(ph) * 4000, Math.sin(ph) * Math.sin(th) * 4000);
    }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    // lights
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a5a2a, 0.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = true;
    const ss = quality === 'high' ? 4096 : quality === 'medium' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(ss, ss);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 1200;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.scene.fog = new THREE.Fog(0xcfe0ee, 500, 2600);

    this.setupPost();
    listen(window, 'resize', () => this.resize());
  }

  private setupPost(): void {
    const r = this.renderer;
    if (this.quality === 'low') {
      this.composer = null;
      return;
    }
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.quality === 'high' ? 4 : 0 });
    const comp = new EffectComposer(r, rt);
    comp.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.15, 0.4, 1.1);
    comp.addPass(this.bloom);
    comp.addPass(new OutputPass());
    if (this.quality === 'medium') comp.addPass(new SMAAPass());
    this.composer = comp;
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1));
    const ss = q === 'high' ? 4096 : q === 'medium' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(ss, ss);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.composer?.dispose();
    this.bloom = null;
    this.setupPost();
    this.resize();
  }

  resize(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.composer.setSize(w, h);
    }
  }

  /** Update sun, sky, fog and lights from time of day and weather. */
  updateEnvironment(env: EnvState, dt: number): void {
    const h = env.hour;
    // sun path: rises east (+X), sets west (-X), tilted south (+Z)
    const t = (h - 5.4) / 15.4; // 0 sunrise .. 1 sunset
    const elev = Math.sin(Math.PI * THREE.MathUtils.clamp(t, -0.15, 1.15)) * 0.95 - (t < 0 || t > 1 ? 0.25 : 0);
    const az = THREE.MathUtils.lerp(-1.25, 1.25, t);
    const sunEl = THREE.MathUtils.clamp(elev, -0.5, 1.2);
    const dir = new THREE.Vector3(Math.cos(az + Math.PI / 2) * -1, Math.sin(sunEl) * 1.0, 0.45).normalize();
    dir.x = -Math.sin(az) * Math.cos(sunEl);
    dir.y = Math.sin(sunEl);
    dir.z = Math.cos(az) * Math.cos(sunEl) * 0.55 + 0.25;
    dir.normalize();
    this.sunDir.copy(dir);
    const day = THREE.MathUtils.clamp((dir.y + 0.08) / 0.3, 0, 1);
    this.night = 1 - day;
    const golden = THREE.MathUtils.clamp(1 - Math.abs(dir.y - 0.12) / 0.22, 0, 1) * day;

    const su = this.sky.material.uniforms;
    su.sunPosition.value.copy(dir).multiplyScalar(1000);
    su.turbidity.value = 3 + env.cloud * 6;
    su.rayleigh.value = 1.4 + golden * 1.2 - env.cloud * 0.6;
    if (su.cloudCoverage) {
      su.cloudCoverage.value = 0.2 + env.cloud * 0.75;
      su.cloudDensity.value = 0.35 + env.cloud * 0.5;
      su.time.value += dt;
    }
    const cloudDim = 1 - env.cloud * 0.55;
    // sun / moon light
    const sunCol = new THREE.Color().setHSL(0.09 - golden * 0.03, 0.6 + golden * 0.3, 0.92 - golden * 0.18);
    if (day > 0.02) {
      this.sun.color.copy(sunCol);
      this.sun.intensity = (0.4 + 2.5 * Math.min(1, dir.y * 2.4)) * day * cloudDim;
      this.sun.position.copy(this.focus).addScaledVector(dir, 600);
    } else {
      // moonlight from opposite side
      this.sun.color.set(0x8fa6d6);
      this.sun.intensity = 0.28 * cloudDim;
      this.sun.position.copy(this.focus).add(new THREE.Vector3(0.3, 0.8, -0.4).normalize().multiplyScalar(600));
    }
    this.sun.target.position.copy(this.focus);
    const span = this.shadowSpan;
    const sc = this.sun.shadow.camera;
    if (sc.right !== span) {
      sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span;
      sc.updateProjectionMatrix();
    }
    this.hemi.intensity = (0.15 + 0.5 * day) * (1 - env.cloud * 0.2) + 0.08;
    this.hemi.color.setHSL(0.58, 0.45, 0.55 + day * 0.2);
    this.hemi.groundColor.setHSL(0.22, 0.4, 0.12 + day * 0.15);
    // fog colour follows the horizon
    const fogDay = new THREE.Color(0xc9d9e6).lerp(new THREE.Color(0xe8c39a), golden * 0.6).lerp(new THREE.Color(0x9aa4ad), env.cloud * 0.6);
    const fogNight = new THREE.Color(0x0d1626);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(fogNight).lerp(fogDay, day);
    fog.near = 450 - env.rain * 250;
    fog.far = 2600 - env.rain * 1500 - env.cloud * 400;
    this.renderer.toneMappingExposure = 0.88 + this.night * 0.25;
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, this.night - 0.3) * (1 - env.cloud);
    this.stars.position.copy(this.camera.position);
    if (this.bloom) {
      this.bloom.strength = 0.08 + this.night * 0.55;
      this.bloom.threshold = 1.1 - this.night * 0.6;
    }
    setNight(this.night);

    // shared uniforms
    terrainUniforms.uCloud.value = env.cloud;
    terrainUniforms.uWet.value += (env.rain - terrainUniforms.uWet.value) * Math.min(1, dt * 0.2);
    waterUniforms.uSunDir.value.copy(dir.y > 0 ? dir : new THREE.Vector3(0.3, 0.8, -0.4));
    waterUniforms.uSunColor.value.copy(this.sun.color).multiplyScalar(day > 0.02 ? 1 : 0.4);
    waterUniforms.uNight.value = this.night;
    waterUniforms.uRain.value = env.rain;
    waterUniforms.uSky.value.setRGB(0.32 + golden * 0.3, 0.55 + golden * 0.1, 0.9 - golden * 0.25).multiplyScalar(day * (0.6 + cloudDim * 0.4) + 0.04);
    waterUniforms.uHorizon.value.copy(fog.color);
    shared.windStrength.value = 0.3 + env.wind / 18;

    // environment map (rebuild when the sun has moved noticeably)
    const key = `${dir.x.toFixed(2)},${dir.y.toFixed(2)},${env.cloud.toFixed(1)}`;
    if (key !== this.lastEnvKey) {
      this.lastEnvKey = key;
      const eu = this.envSky.material.uniforms;
      eu.sunPosition.value.copy(su.sunPosition.value);
      eu.turbidity.value = su.turbidity.value;
      eu.rayleigh.value = su.rayleigh.value;
      eu.mieCoefficient.value = su.mieCoefficient.value;
      eu.mieDirectionalG.value = su.mieDirectionalG.value;
      if (eu.cloudCoverage) eu.cloudCoverage.value = 0;
      const old = this.envRT;
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = (0.04 + day * 0.1) * this.envScale;
      old?.dispose();
    }
  }

  render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
