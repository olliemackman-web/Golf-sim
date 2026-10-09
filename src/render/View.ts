// Ties the renderers to a Game: per-frame sync, picking, effects from game events.
import * as THREE from 'three';
import { TILE, WORLD } from '../core/constants';
import type { Game } from '../sim/Game';
import { CameraController } from './CameraController';
import { CrowdRenderer } from './CrowdRenderer';
import { Effects } from './Effects';
import { EntityRenderer } from './EntityRenderer';
import { shared } from './Materials';
import { ObjectRenderer } from './ObjectRenderer';
import { Quality, Renderer } from './Renderer';
import { Surroundings } from './Surroundings';
import { TerrainRenderer, terrainUniforms } from './TerrainRenderer';
import { WaterRenderer } from './WaterRenderer';

export class View {
  r: Renderer;
  terrain: TerrainRenderer;
  water: WaterRenderer;
  objects: ObjectRenderer;
  crowd: CrowdRenderer;
  entities: EntityRenderer;
  effects: Effects;
  surroundings: Surroundings;
  cam: CameraController;
  private raycaster = new THREE.Raycaster();
  private time = 0;
  private condTimer = 0;
  private cloud = 0.3;
  private rain = 0;
  private envTimer = 0;
  fountainT = 0;
  /** When set, the play mode drives the camera. */
  externalCamera = false;
  hideCrowd = false;
  hideSimBalls = false;
  extraPeople: import('../sim/agents').Person[] = [];

  constructor(public container: HTMLElement, public game: Game, quality: Quality) {
    this.r = new Renderer(container, quality);
    const s = this.r.scene;
    this.terrain = new TerrainRenderer(game.world);
    s.add(this.terrain.mesh);
    this.water = new WaterRenderer(game.world);
    s.add(this.water.group);
    this.objects = new ObjectRenderer(game.world);
    s.add(this.objects.group);
    this.crowd = new CrowdRenderer();
    s.add(this.crowd.group);
    this.entities = new EntityRenderer(game.world);
    s.add(this.entities.group);
    this.effects = new Effects(container);
    s.add(this.effects.group);
    this.surroundings = new Surroundings(game.world);
    s.add(this.surroundings.group);
    this.cam = new CameraController(this.r.camera, this.r.renderer.domElement, game.world);
    this.cam.pickGround = (x, y) => this.pickGround(x, y);
    // start looking at the entrance
    const e = game.sim.entranceSpot();
    this.cam.setView(e.x, e.z - 70, 170, 0, 0.78, true);
    game.world.on('height', () => this.entities.heightStamp++);
    this.hookEvents();
  }

  private hookEvents(): void {
    const g = this.game;
    g.events.on('money', (m) => {
      if (m.x === undefined || m.z === undefined) return;
      const d = this.r.camera.position.distanceTo(new THREE.Vector3(m.x, 0, m.z));
      if (d > 420) return;
      const y = g.world.heightAt(m.x, m.z) + 3;
      this.effects.floatText((m.amount > 0 ? '+$' : '-$') + Math.abs(m.amount).toFixed(m.amount % 1 ? 2 : 0).replace(/\.00$/, ''), m.x, y, m.z, m.amount > 0 ? 'pos' : 'neg');
    });
    g.events.on('splash', (s) => this.effects.spawn(s.small ? 'splash_small' : 'splash', s.x, g.world.heightAt(s.x, s.z) + 0.3, s.z));
    g.events.on('sparkle', (s) => this.effects.spawn('sparkle', s.x, g.world.heightAt(s.x, s.z) + 0.5, s.z));
    g.events.on('cheer', (c) => {
      if (c.big) this.effects.spawn('confetti', c.x, g.world.heightAt(c.x, c.z) + 2, c.z, 80);
      for (const p of g.sim.people) {
        if (!p.visible || p.vehicle) continue;
        if ((p.x - c.x) ** 2 + (p.z - c.z) ** 2 < (c.big ? 3600 : 900) && (p.anim === 'idle' || p.anim === 'clap')) p.restartAnim('cheer', 2);
      }
    });
  }

  /** Ray-march the heightfield. */
  pickGround(sx: number, sy: number): THREE.Vector3 | null {
    const rect = this.r.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((sx - rect.left) / rect.width) * 2 - 1, -((sy - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.r.camera);
    const o = this.raycaster.ray.origin, d = this.raycaster.ray.direction;
    const w = this.game.world;
    let t = 0;
    let prevT = 0;
    const maxT = 4000;
    let step = 2;
    const p = new THREE.Vector3();
    while (t < maxT) {
      p.copy(o).addScaledVector(d, t);
      const inMap = p.x >= 0 && p.z >= 0 && p.x < WORLD && p.z < WORLD;
      const h = inMap ? w.heightAt(p.x, p.z) : -1e9;
      if (p.y <= h) {
        // bisect
        let a = prevT, b = t;
        for (let i = 0; i < 16; i++) {
          const m = (a + b) / 2;
          p.copy(o).addScaledVector(d, m);
          if (p.y <= w.heightAt(p.x, p.z)) b = m;
          else a = m;
        }
        p.copy(o).addScaledVector(d, b);
        return p;
      }
      if (p.y < -50 && d.y < 0) break;
      prevT = t;
      step = Math.max(1, Math.min(8, (p.y - Math.max(h, 0)) * 0.5));
      t += step;
    }
    // fall back to a plane at y=0
    if (d.y < 0) {
      const tt = -o.y / d.y;
      p.copy(o).addScaledVector(d, tt);
      return p;
    }
    return null;
  }

  pickTile(sx: number, sy: number): { x: number; y: number; wx: number; wz: number } | null {
    const p = this.pickGround(sx, sy);
    if (!p) return null;
    return { x: Math.floor(p.x / TILE), y: Math.floor(p.z / TILE), wx: p.x, wz: p.z };
  }

  pickPerson(sx: number, sy: number): import('../sim/agents').Person | null {
    const rect = this.r.renderer.domElement.getBoundingClientRect();
    let best: import('../sim/agents').Person | null = null;
    let bd = 22 * 22;
    const v = new THREE.Vector3();
    for (const p of this.crowd.drawn) {
      v.set(p.x, p.y + 1, p.z).project(this.r.camera);
      if (v.z > 1) continue;
      const x = (v.x * 0.5 + 0.5) * rect.width + rect.left;
      const y = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  worldToScreen(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.r.camera);
    const rect = this.r.renderer.domElement.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * rect.width + rect.left, y: (-v.y * 0.5 + 0.5) * rect.height + rect.top, visible: v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2 };
  }

  frame(dt: number): void {
    const g = this.game;
    this.time += dt;
    shared.time.value = this.time;
    if (!this.externalCamera) this.cam.update(dt);
    // environment
    const wk = g.state.weather.kind;
    const cloudTarget = wk === 'sunny' ? 0.12 : wk === 'partly' ? 0.4 : wk === 'overcast' ? 0.78 : wk === 'rain' ? 0.88 : 1;
    const rainTarget = g.isOpen() || g.hour > 5 ? (wk === 'rain' ? 0.7 : wk === 'storm' ? 1 : 0) : wk === 'rain' || wk === 'storm' ? 0.6 : 0;
    this.cloud += (cloudTarget - this.cloud) * Math.min(1, dt * 0.3);
    this.rain += (rainTarget - this.rain) * Math.min(1, dt * 0.4);
    const season = g.season;
    const sv = terrainUniforms.uSeason.value;
    const seasonTints: [number, number, number][] = [[1.02, 1.06, 0.95], [1.0, 1.0, 1.0], [1.08, 0.98, 0.82], [0.92, 0.94, 0.9]];
    const st = seasonTints[season];
    sv.x += (st[0] - sv.x) * Math.min(1, dt * 0.5);
    sv.y += (st[1] - sv.y) * Math.min(1, dt * 0.5);
    sv.z += (st[2] - sv.z) * Math.min(1, dt * 0.5);
    const autumnT = season === 2 ? 1 : season === 3 ? 0.35 : 0;
    shared.autumn.value += (autumnT - shared.autumn.value) * Math.min(1, dt * 0.5);
    const foliage = season === 0 ? [1.05, 1.08, 0.95] : season === 3 ? [0.85, 0.88, 0.85] : [1, 1, 1];
    shared.seasonTint.value.setRGB(foliage[0], foliage[1], foliage[2]);
    terrainUniforms.uSnow.value += ((season === 3 && g.hour < 10 ? 0.6 : season === 3 ? 0.25 : 0) - terrainUniforms.uSnow.value) * Math.min(1, dt * 0.2);
    this.r.focus.copy(this.externalCamera ? this.r.camera.position : this.cam.target);
    if (this.externalCamera) {
      const dir = new THREE.Vector3();
      this.r.camera.getWorldDirection(dir);
      this.r.focus.addScaledVector(dir, 60);
    }
    this.r.shadowSpan = THREE.MathUtils.clamp((this.externalCamera ? 90 : this.cam.dist) * 1.1, 60, 380);
    this.envTimer -= dt;
    this.r.updateEnvironment({ hour: g.hour, dayOfYear: g.state.day, cloud: this.cloud, rain: this.rain, season, wind: g.state.weather.wind }, dt);

    this.terrain.flush();
    this.condTimer -= dt;
    if (this.condTimer <= 0 && g.conditionDirty) {
      this.condTimer = 0.5;
      g.conditionDirty = false;
      this.terrain.updateCondition();
    }
    this.water.update();
    this.objects.update(dt * (g.paused ? 0 : 1));
    this.crowd.update(this.hideCrowd ? this.extraPeople : this.extraPeople.length ? g.sim.people.concat(this.extraPeople) : g.sim.people, this.r.camera.position);
    this.entities.hideBalls = this.hideSimBalls;
    this.entities.update(g.sim, g.course, dt, this.externalCamera ? 30 : this.cam.dist);
    const wd = g.state.weather.windDir, ws = g.state.weather.wind;
    this.effects.update(dt, this.r.camera, this.rain, { x: Math.sin(wd) * ws * 0.4, z: Math.cos(wd) * ws * 0.4 }, g.isDaytime() && wk !== 'storm');
    // fountains splash
    this.fountainT -= dt;
    if (this.fountainT <= 0) {
      this.fountainT = 0.12;
      for (const o of g.world.objectsOfType('fountain')) {
        const c = g.world.objectCenter(o);
        if (this.r.camera.position.distanceTo(new THREE.Vector3(c.x, 0, c.z)) < 250) this.effects.spawn('fountain', c.x, g.world.objectBaseHeight(o) + 2.4, c.z, 4);
      }
    }
    this.r.render();
  }

  setQuality(q: Quality): void {
    this.r.setQuality(q);
  }
}
