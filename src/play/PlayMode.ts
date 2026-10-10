// "Have a Go": the player plays golf themselves on their own range or course.
import * as THREE from 'three';
import { COURSE_SCALE, SURF_NAMES, Surf, TILE, WORLD, YARDS_PER_WORLD } from '../core/constants';
import type { AppApi, PlayConfig } from '../app';
import { CLUBS, ClubDef, EQUIPMENT } from '../data/clubs';
import { BAY_BALL } from '../data/layout';
import { ITEMS } from '../data/items';
import { Person } from '../sim/agents';
import { planShot } from '../sim/golfAI';
import { fmtPar } from '../sim/Game';
import type { HoleInfo } from '../world/Course';
import type { PlacedObject } from '../world/World';
import { delegate, el, esc, money } from '../ui/dom';
import { icon } from '../ui/icons';
import { hint, input } from '../ui/touch';
import { BallPhysics, Launch } from './BallPhysics';

type Phase = 'aim' | 'power' | 'accuracy' | 'swing' | 'flight' | 'result' | 'between' | 'done';
type CamMode = 'behind' | 'overhead';

const FULL = CLUBS.filter((c) => !c.putter);
const PUTTER = CLUBS[CLUBS.length - 1];
const LIE_NAMES: Partial<Record<Surf, string>> = { [Surf.Tee]: 'Tee', [Surf.Fairway]: 'Fairway', [Surf.Green]: 'Green', [Surf.Rough]: 'Rough', [Surf.DeepRough]: 'Long grass', [Surf.Bunker]: 'Bunker', [Surf.Path]: 'Cart path', [Surf.Paving]: 'Paving' };

interface VirtualTarget {
  x: number;
  z: number;
  r: number; // world radius for scoring
}

export class PlayMode {
  private hud: HTMLDivElement;
  private ball: BallPhysics;
  private ballMesh: THREE.Mesh;
  private trail: THREE.Line;
  private trailPts: THREE.Vector3[] = [];
  private aimLine: THREE.Line;
  private aimRing: THREE.Mesh;
  private group = new THREE.Group();
  private arrows: THREE.InstancedMesh;
  private player: Person;
  private phase: Phase = 'aim';
  private camMode: CamMode = 'behind';
  private clubIdx = 0;
  private aimYaw = 0;
  private meter = 0;
  private power = 0;
  private accuracy = 0;
  private swingT = 0;
  private swingDur = 1.3;
  private launched = false;
  private resultT = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private keys = new Set<string>();
  private drag: { x: number } | null = null;
  private wind = { x: 0, z: 0, mph: 0, dir: 0 };
  private flightCamStart = new THREE.Vector3();
  private bannerT = 0;
  private message = '';
  private lastShot: { carry: number; total: number; offline: number; speed: number; launch: number; spin: number; apex: number; hang: number; club: string } | null = null;
  // course
  private holes: HoleInfo[] = [];
  private holeIdx = 0;
  private strokes = 0;
  private scores: number[] = [];
  private shotFrom = { x: 0, z: 0 };
  private onTee = true;
  // range
  private bay: PlacedObject | null = null;
  private tee = { x: 0, z: 0, yaw: 0 };
  private shotsLeft = Infinity;
  private challengeBest = 0;
  private challengeScore = 0;
  private targets: VirtualTarget[] = [];
  private flag: { x: number; z: number } | null = null;
  private rangeXp = 0;
  private ended = false;
  private pinTag: HTMLDivElement | null = null;
  private onKeyDown = (e: KeyboardEvent) => this.keyDown(e);
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private onPointerDown = (e: PointerEvent) => this.pointerDown(e);
  private onPointerMove = (e: PointerEvent) => this.pointerMove(e);
  private onPointerUp = (e: PointerEvent) => {
    // touch: a tap (not a drag) starts the swing
    if (this.touchStart && e.pointerType === 'touch') {
      const moved = Math.abs(e.clientX - this.touchStart.x) > 10;
      this.touchStart = null;
      if (!moved && this.phase === 'aim') this.click();
    }
    this.drag = null;
  };
  private touchStart: { x: number } | null = null;
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.changeClub(e.deltaY > 0 ? 1 : -1);
  };

  constructor(private app: AppApi, private cfg: PlayConfig, private onExit: () => void) {
    const g = app.game;
    this.ball = new BallPhysics(g.world);
    const bm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 0.35 });
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), bm);
    this.ballMesh.castShadow = true;
    this.group.add(this.ballMesh);
    this.trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    this.trail.frustumCulled = false;
    this.group.add(this.trail);
    this.aimLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xfff1b8, dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0.9, depthTest: false }));
    this.aimLine.renderOrder = 20;
    this.aimLine.frustumCulled = false;
    this.group.add(this.aimLine);
    this.aimRing = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.85, depthTest: false }));
    this.aimRing.renderOrder = 21;
    this.group.add(this.aimRing);
    const ag = new THREE.ConeGeometry(0.09, 0.32, 5).rotateX(Math.PI / 2);
    this.arrows = new THREE.InstancedMesh(ag, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }), 400);
    this.arrows.count = 0;
    this.arrows.frustumCulled = false;
    this.group.add(this.arrows);
    app.view.r.scene.add(this.group);

    this.player = new Person({ shirt: 0x1f5135, pants: 0xe8e0c8, skin: 0xe0ac86, hair: 0x3a2a1a, hat: 0xf3ead3, hatType: 1 });
    this.player.kind = 'player';
    this.player.name = g.state.player.name;
    this.player.bag = false;

    this.hud = el('div', 'hud');
    app.view.container.appendChild(this.hud);
    delegate(this.hud, (act) => this.hudAction(act));
    // touch screens: tapping the swing meter itself works like tapping the course
    this.hud.addEventListener('pointerdown', (e) => {
      if (!(e.target as HTMLElement).closest('.meter') || e.button > 0) return;
      e.preventDefault();
      this.click();
    });
  }

  // ---------------------------------------------------------------- lifecycle
  start(): void {
    const g = this.app.game;
    const v = this.app.view;
    g.frozen = true;
    v.externalCamera = true;
    v.hideCrowd = true;
    v.extraPeople = [this.player];
    v.hideSimBalls = true;
    const ws = g.state.weather;
    this.wind = { mph: ws.wind, dir: ws.windDir, x: Math.sin(ws.windDir) * ws.wind * 0.447, z: Math.cos(ws.windDir) * ws.wind * 0.447 };
    this.ball.wind = { x: this.wind.x, z: this.wind.z };
    this.ball.greenSpeed = g.greenSpeed();
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp);
    v.r.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    v.r.renderer.domElement.addEventListener('wheel', this.onWheel, { passive: false });
    this.app.sfx('whoosh');

    if (this.cfg.mode === 'range') this.setupRange();
    else this.setupCourse();
    this.camPos.copy(v.r.camera.position);
    this.camLook.copy(v.cam.target);
    this.updateCamera(10);
  }

  private cleanup(): void {
    const g = this.app.game;
    const v = this.app.view;
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp);
    v.r.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    v.r.renderer.domElement.removeEventListener('wheel', this.onWheel);
    v.r.scene.remove(this.group);
    this.hud.remove();
    v.externalCamera = false;
    v.hideCrowd = false;
    v.extraPeople = [];
    v.hideSimBalls = false;
    g.frozen = false;
    // put the strategy camera near where we were playing
    v.cam.setView(this.ball.x, this.ball.z, 120);
  }

  exit(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.cfg.mode === 'range' && this.rangeXp > 0) this.app.game.addPlayerXp(this.rangeXp);
    this.cleanup();
    this.onExit();
  }

  // ---------------------------------------------------------------- setup
  private setupRange(): void {
    const g = this.app.game;
    const cfg = this.cfg as Extract<PlayConfig, { mode: 'range' }>;
    let bay: PlacedObject | null = null;
    if (cfg.bayId) bay = g.world.objects.get(cfg.bayId) ?? null;
    if (!bay) {
      // best bay: the one with the most owned land in front of it
      let best = -1;
      for (const b of g.world.objectsOfKind('bay')) {
        const f = g.world.objectFront(b);
        const c = g.world.objectCenter(b);
        let s = 0;
        for (let d = 10; d < 200; d += 10) if (g.world.isOwnedWorld(c.x - f.x * d, c.z - f.z * d)) s++;
        if (s > best) {
          best = s;
          bay = b;
        }
      }
    }
    this.bay = bay;
    if (bay) {
      const p = g.world.localToWorld(bay, BAY_BALL.x, BAY_BALL.z);
      const f = g.world.objectFront(bay);
      this.tee = { x: p.x, z: p.z, yaw: Math.atan2(-f.x, -f.z) };
    } else {
      // practice tee near the entrance looking north
      const e = g.sim.entranceSpot();
      this.tee = { x: e.x - 12, z: e.z - 20, yaw: Math.PI };
    }
    this.aimYaw = this.tee.yaw;
    this.ball.place(this.tee.x, this.tee.z);
    this.ball.cup = null;
    this.ball.gatherTrees(this.tee.x, this.tee.z, 400);
    const pl = g.state.player;
    switch (cfg.challenge) {
      case 'longdrive':
        this.shotsLeft = 5;
        this.clubIdx = 0;
        this.message = 'Long drive: five balls. Your longest drive that stays on your land counts.';
        break;
      case 'target': {
        this.shotsLeft = 10;
        this.makeTargets();
        this.message = 'Target challenge: ten balls. Land close to a target ring for points.';
        break;
      }
      case 'closest': {
        this.shotsLeft = 5;
        this.makeFlag();
        this.message = `Closest to the pin: five balls at the flag ${Math.round(Math.hypot(this.flag!.x - this.tee.x, this.flag!.z - this.tee.z) * YARDS_PER_WORLD)} yards away.`;
        break;
      }
      default:
        this.message = 'Free practice. Pick any club and hit away.';
        this.clubIdx = FULL.findIndex((c) => c.id === '7i');
    }
    void pl;
    this.challengeBest = cfg.challenge === 'closest' ? Infinity : 0;
    this.newShot();
  }

  private rangeDir(): { x: number; z: number } {
    return { x: Math.sin(this.tee.yaw), z: Math.cos(this.tee.yaw) };
  }

  private makeTargets(): void {
    const g = this.app.game;
    const d = this.rangeDir();
    this.targets = [];
    for (const yds of [70, 110, 150, 190]) {
      const dist = yds / YARDS_PER_WORLD;
      const side = (this.targets.length % 2 ? 1 : -1) * 6;
      const x = this.tee.x + d.x * dist - d.z * side, z = this.tee.z + d.z * dist + d.x * side;
      if (!g.world.isOwnedWorld(x, z) || g.world.surfAt(x, z) === Surf.Water) continue;
      this.targets.push({ x, z, r: 5 });
    }
    for (const o of g.world.objectsOfKind('target')) {
      const c = g.world.objectCenter(o);
      this.targets.push({ x: c.x, z: c.z, r: ITEMS[o.type].w * TILE * 0.45 });
    }
    if (!this.targets.length) {
      const x = this.tee.x + d.x * 25, z = this.tee.z + d.z * 25;
      this.targets.push({ x, z, r: 5 });
    }
    // draw rings
    for (const t of this.targets) {
      for (const [r, c] of [[t.r, 0xffffff], [t.r * 0.6, 0xe5735f], [t.r * 0.25, 0xf0d48a]] as [number, number][]) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.18, r, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85 }));
        ring.position.set(t.x, g.world.heightAt(t.x, t.z) + 0.06, t.z);
        this.group.add(ring);
      }
    }
  }

  private makeFlag(): void {
    const g = this.app.game;
    const d = this.rangeDir();
    let dist = 0;
    for (let k = 0; k < 30; k++) {
      const yds = 90 + Math.random() * 80;
      dist = yds / YARDS_PER_WORLD;
      const x = this.tee.x + d.x * dist, z = this.tee.z + d.z * dist;
      if (g.world.isOwnedWorld(x, z) && g.world.surfAt(x, z) !== Surf.Water) break;
      if (k === 29) dist = 40;
    }
    this.flag = { x: this.tee.x + d.x * dist, z: this.tee.z + d.z * dist };
    // flagstick + small green disc
    const disc = new THREE.Mesh(new THREE.CircleGeometry(4, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x86c95c, roughness: 0.8 }));
    disc.position.set(this.flag.x, g.world.heightAt(this.flag.x, this.flag.z) + 0.04, this.flag.z);
    disc.receiveShadow = true;
    this.group.add(disc);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.6, 6), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    pole.position.set(this.flag.x, disc.position.y + 1.8, this.flag.z);
    this.group.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshStandardMaterial({ color: 0xe5432f, side: THREE.DoubleSide }));
    cloth.position.set(this.flag.x + 0.45, disc.position.y + 3.25, this.flag.z);
    this.group.add(cloth);
    this.ball.cup = { ...this.flag };
  }

  private setupCourse(): void {
    const g = this.app.game;
    const cfg = this.cfg as Extract<PlayConfig, { mode: 'course' }>;
    this.holes = cfg.holes.map((id) => g.course.byId(id)).filter((h): h is HoleInfo => !!h && h.valid);
    if (!this.holes.length) {
      this.message = 'No playable holes.';
      this.exit();
      return;
    }
    this.holeIdx = 0;
    this.startHole();
  }

  private get hole(): HoleInfo {
    return this.holes[this.holeIdx];
  }

  private startHole(): void {
    const h = this.hole;
    this.strokes = 0;
    this.onTee = true;
    this.ball.place(h.teeWorld.x, h.teeWorld.z);
    this.ball.cup = { ...h.pinWorld };
    this.ball.gatherTrees((h.teeWorld.x + h.pinWorld.x) / 2, (h.teeWorld.z + h.pinWorld.z) / 2, h.length / 2 + 120);
    this.message = `Hole ${h.num} · Par ${h.par} · ${h.yards} yards`;
    this.banner(`Hole ${h.num}`, `Par ${h.par} · ${h.yards} yards`);
    this.newShot();
  }

  // ---------------------------------------------------------------- shots
  private get club(): ClubDef {
    return this.onGreen() ? PUTTER : FULL[this.clubIdx];
  }

  private onGreen(): boolean {
    return this.cfg.mode === 'course' && this.app.game.world.surfAt(this.ball.x, this.ball.z) === Surf.Green;
  }

  private equipment() {
    const id = this.app.game.state.player.equipment;
    return EQUIPMENT.find((e) => e.id === id) ?? EQUIPMENT[0];
  }

  private speedMul(): number {
    const st = this.app.game.state.player.stats;
    return (0.88 + 0.014 * (st.power - 1)) * this.equipment().distance;
  }

  private target(): { x: number; z: number } | null {
    if (this.cfg.mode === 'course') return this.hole.pinWorld;
    return this.flag;
  }

  private newShot(): void {
    const g = this.app.game;
    this.phase = 'aim';
    this.meter = 0;
    this.launched = false;
    this.trailPts = [];
    this.shotFrom = { x: this.ball.x, z: this.ball.z };
    if (this.cfg.mode === 'course') {
      const h = this.hole;
      if (this.onGreen()) {
        this.aimYaw = Math.atan2(h.pinWorld.x - this.ball.x, h.pinWorld.z - this.ball.z);
      } else {
        // aim like a good player would and pick a club for the distance
        const plan = planShot(g.world, g.course, h, { x: this.ball.x, z: this.ball.z }, 0.85, this.onTee);
        this.aimYaw = Math.atan2(plan.target.x - this.ball.x, plan.target.z - this.ball.z);
        this.autoClub(Math.hypot(plan.target.x - this.ball.x, plan.target.z - this.ball.z));
      }
    } else if (this.flag && this.cfg.mode === 'range' && (this.cfg as { challenge: string }).challenge === 'closest') {
      this.aimYaw = Math.atan2(this.flag.x - this.ball.x, this.flag.z - this.ball.z);
      this.autoClub(Math.hypot(this.flag.x - this.ball.x, this.flag.z - this.ball.z));
    }
    this.placePlayer();
    this.updateAimGuide();
    this.renderHud();
    this.updatePuttGrid();
  }

  private autoClub(dist: number): void {
    const mul = this.speedMul();
    let best = 0;
    for (let i = 0; i < FULL.length; i++) {
      if (!this.onTee && FULL[i].id === 'dr') continue;
      const carry = this.estCarry(FULL[i], mul);
      if (carry >= dist * 0.97) best = i;
    }
    if (!this.onTee && best === 0) best = 1;
    this.clubIdx = best;
  }

  private carryCache = new Map<string, number>();
  private estCarry(c: ClubDef, mul: number): number {
    const k = c.id + ':' + mul.toFixed(3);
    let v = this.carryCache.get(k);
    if (v === undefined) {
      const r = BallPhysics.predict(this.app.game.world, { x: this.ball.x, y: this.ball.y, z: this.ball.z }, { speed: c.speed * mul, launchDeg: c.launch, yaw: 0, spinRpm: c.spin, tilt: 0 });
      v = r.carry;
      this.carryCache.set(k, v);
    }
    return v;
  }

  private changeClub(d: number): void {
    if (this.phase !== 'aim' || this.onGreen()) return;
    const cfg = this.cfg;
    if (cfg.mode === 'range' && cfg.challenge === 'longdrive') return;
    this.clubIdx = Math.max(0, Math.min(FULL.length - 1, this.clubIdx + d));
    if (this.cfg.mode === 'course' && !this.onTee && this.clubIdx === 0) this.clubIdx = 1;
    this.app.sfx('click', { volume: 0.5 });
    this.updateAimGuide();
    this.renderHud();
  }

  private facing(): { x: number; z: number } {
    const dx = Math.sin(this.aimYaw), dz = Math.cos(this.aimYaw);
    return { x: -dz, z: dx };
  }

  private placePlayer(): void {
    const f = this.facing();
    const back = this.club.putter ? 0.55 : 0.75;
    this.player.x = this.ball.x - f.x * back;
    this.player.z = this.ball.z - f.z * back;
    this.player.y = this.app.game.world.heightAt(this.player.x, this.player.z);
    this.player.heading = Math.atan2(f.x, f.z);
    this.player.targetHeading = null;
    this.player.setAnim('idle');
    this.player.visible = true;
  }

  private lie(): Surf {
    if (this.cfg.mode === 'range' && Math.hypot(this.ball.x - this.tee.x, this.ball.z - this.tee.z) < 0.5) return Surf.Tee;
    return this.app.game.world.surfAt(this.ball.x, this.ball.z);
  }

  private lieMods(): { speed: number; spin: number; zone: number; launch: number } {
    const s = this.lie();
    const c = this.club;
    const wedge = ['sw', 'lw', 'gw', 'pw'].includes(c.id);
    const short = this.app.game.state.player.stats.short;
    switch (s) {
      case Surf.Rough: return { speed: 0.9, spin: 0.6, zone: 0.85, launch: 1 };
      case Surf.DeepRough: return { speed: 0.72, spin: 0.4, zone: 0.65, launch: 3 };
      case Surf.Bunker: return wedge ? { speed: 0.82 + short * 0.008, spin: 0.55, zone: 0.65 + short * 0.03, launch: 4 } : { speed: 0.62, spin: 0.5, zone: 0.5, launch: 0 };
      case Surf.Fairway: case Surf.Path: case Surf.Paving: return { speed: c.id === 'dr' ? 0.93 : 1, spin: 1, zone: 1, launch: 0 };
      default: return { speed: 1, spin: 1, zone: 1, launch: 0 };
    }
  }

  private zoneWidth(): number {
    const pl = this.app.game.state.player;
    let z = 0.032 * this.equipment().forgiveness * (1 + (pl.stats.accuracy - 1) * 0.09) * this.lieMods().zone;
    if (this.club.putter) z *= 1.9 * (1 + (pl.stats.putting - 1) * 0.07);
    else if (['sw', 'lw', 'gw', 'pw'].includes(this.club.id)) z *= 1 + (pl.stats.short - 1) * 0.05;
    return z;
  }

  /** Launch parameters for the current club at a given power (no error). */
  private launchFor(power: number, accErr: number): Launch {
    const c = this.club;
    const lm = this.lieMods();
    const p = Math.min(1.1, power);
    const over = Math.max(0, p - 1);
    const base = Math.pow(Math.min(1, p), 0.85) * (1 + over * 0.5);
    const forg = this.equipment().forgiveness;
    const dirErr = (accErr * 0.26) / forg;
    const tilt = (accErr * 3.4) / forg;
    const mishit = Math.abs(accErr) > 0.08 ? 1 - Math.min(0.18, (Math.abs(accErr) - 0.08) * 1.5) : 1;
    return {
      speed: c.speed * this.speedMul() * base * lm.speed * mishit,
      launchDeg: c.launch * (0.85 + 0.15 * Math.min(1, p)) + lm.launch,
      yaw: this.aimYaw + dirErr,
      spinRpm: c.spin * (0.6 + 0.4 * Math.min(1, p)) * lm.spin,
      tilt,
    };
  }

  private puttScale(): number {
    // meter 100% = speed to roll 1.5x the distance to the hole on flat ground
    const t = this.target();
    const d = t ? Math.max(2.5, Math.hypot(t.x - this.ball.x, t.z - this.ball.z) * COURSE_SCALE) : 6;
    return Math.sqrt(2 * 0.058 / this.ball.greenSpeed * 9.81 * d * 1.5);
  }

  private updateAimGuide(): void {
    const g = this.app.game;
    const pts: THREE.Vector3[] = [];
    if (this.club.putter) {
      const t = this.target()!;
      const d = Math.hypot(t.x - this.ball.x, t.z - this.ball.z) * 1.15 + 1;
      for (let i = 0; i <= 30; i++) {
        const s = (d * i) / 30;
        const x = this.ball.x + Math.sin(this.aimYaw) * s, z = this.ball.z + Math.cos(this.aimYaw) * s;
        pts.push(new THREE.Vector3(x, g.world.heightAt(x, z) + 0.05, z));
      }
      this.aimRing.visible = false;
    } else {
      const pred = BallPhysics.predict(g.world, { x: this.ball.x, y: this.ball.y + (this.onTee ? 0.04 : 0), z: this.ball.z }, this.launchFor(1, 0));
      const N = pred.pts.length;
      for (let i = 0; i < N; i += Math.max(1, Math.floor(N / 40))) pts.push(new THREE.Vector3(pred.pts[i].x, pred.pts[i].y, pred.pts[i].z));
      pts.push(new THREE.Vector3(pred.x, g.world.heightAt(pred.x, pred.z) + 0.1, pred.z));
      this.aimRing.visible = true;
      this.aimRing.position.set(pred.x, g.world.heightAt(pred.x, pred.z) + 0.15, pred.z);
      const sc = Math.max(0.6, pred.carry / 60);
      this.aimRing.scale.set(sc, 1, sc);
      this.predCarry = pred.carry;
    }
    this.aimLine.geometry.dispose();
    this.aimLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.aimLine.computeLineDistances();
    this.aimLine.visible = this.phase === 'aim' || this.phase === 'power' || this.phase === 'accuracy';
  }
  private predCarry = 0;

  private updatePuttGrid(): void {
    const g = this.app.game;
    if (!this.onGreen()) {
      this.arrows.count = 0;
      return;
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let n = 0;
    const cx = this.ball.x, cz = this.ball.z;
    const t = this.target()!;
    const span = Math.min(26, Math.hypot(t.x - cx, t.z - cz) + 6);
    const mx = (cx + t.x) / 2, mz = (cz + t.z) / 2;
    const step = 1.4;
    for (let dz = -span / 2; dz <= span / 2; dz += step) {
      for (let dx = -span / 2; dx <= span / 2; dx += step) {
        const x = mx + dx, z = mz + dz;
        if (g.world.surfAt(x, z) !== Surf.Green || n >= 400) continue;
        const nr = g.world.normalAt(x, z);
        const sl = Math.hypot(nr.x, nr.z);
        const yaw = Math.atan2(nr.x, nr.z);
        q.setFromEuler(new THREE.Euler(0, yaw, 0));
        const s = 0.6 + Math.min(2.5, sl * 25);
        m.compose(new THREE.Vector3(x, g.world.heightAt(x, z) + 0.06, z), q, new THREE.Vector3(s, s, s));
        this.arrows.setMatrixAt(n++, m);
      }
    }
    this.arrows.count = n;
    this.arrows.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- input
  private keyDown(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      e.stopPropagation();
      e.preventDefault();
      this.pauseMenu();
      return;
    }
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    e.stopPropagation();
    if (this.paused) return;
    this.keys.add(k);
    if (k === ' ' || k === 'enter') {
      e.preventDefault();
      this.click();
    } else if (k === 'w' || k === 'arrowup' || k === 'e') this.changeClub(-1);
    else if (k === 's' || k === 'arrowdown' || k === 'q') this.changeClub(1);
    else if (k === 'c' || k === 'v') {
      this.camMode = this.camMode === 'behind' ? 'overhead' : 'behind';
      this.renderHud();
    }
  }

  private pointerDown(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      if (this.phase === 'aim') {
        this.touchStart = { x: e.clientX };
        this.drag = { x: e.clientX };
      } else this.click();
      return;
    }
    if (e.button === 2) {
      this.drag = { x: e.clientX };
      return;
    }
    if (e.button !== 0) return;
    this.click();
  }

  private pointerMove(e: PointerEvent): void {
    if (!this.drag || this.phase !== 'aim') return;
    const dx = e.clientX - this.drag.x;
    this.drag.x = e.clientX;
    this.aimYaw -= dx * (this.club.putter ? 0.0012 : 0.0025);
    this.placePlayer();
    this.updateAimGuide();
  }

  private click(): void {
    if (this.ended || this.paused) return;
    switch (this.phase) {
      case 'aim':
        this.phase = 'power';
        this.meter = 0;
        this.player.restartAnim(this.club.putter ? 'putt' : this.power < 0.6 && ['sw', 'lw', 'gw'].includes(this.club.id) ? 'chip' : 'swing', this.club.putter ? 1.1 : 1.3);
        this.app.sfx('click', { volume: 0.4 });
        break;
      case 'power':
        this.power = this.meter;
        this.phase = 'accuracy';
        this.app.sfx('click', { volume: 0.4, pitch: 1.2 });
        break;
      case 'accuracy':
        this.accuracy = this.meter;
        this.beginSwing();
        break;
      case 'result':
        if (this.resultT > 0.5) this.resultT = 99;
        break;
      case 'between':
        this.resultT = 99;
        break;
    }
  }

  private hudAction(act: string): void {
    this.app.sfx('click');
    if (act === 'quit') this.pauseMenu();
    else if (act === 'cam') this.camMode = this.camMode === 'behind' ? 'overhead' : 'behind';
    else if (act === 'clubup') this.changeClub(-1);
    else if (act === 'clubdown') this.changeClub(1);
    else if (act === 'aiml' || act === 'aimr') {
      if (this.phase !== 'aim') return;
      this.aimYaw += (act === 'aiml' ? 1 : -1) * (this.club.putter ? 0.01 : 0.025);
      this.placePlayer();
      this.updateAimGuide();
    }
    this.renderHud();
  }

  private paused = false;
  private pauseEl: HTMLDivElement | null = null;

  private pauseMenu(): void {
    if (this.paused) {
      // Escape again resumes
      this.pauseEl?.remove();
      this.pauseEl = null;
      this.paused = false;
      return;
    }
    this.paused = true;
    const back = el('div', 'modal-back');
    this.pauseEl = back;
    const course = this.cfg.mode === 'course';
    back.innerHTML = `<div class="window narrow"><div class="whead"><div class="wic">${icon('golfer')}</div><h2>Paused</h2></div><div class="wbody" style="display:grid;gap:8px">
      <button class="btn primary" data-act="resume">Keep playing</button>
      <button class="btn danger" data-act="quit">${course ? 'Abandon round' : 'Leave the range'}</button></div></div>`;
    this.hud.appendChild(back);
    delegate(back, (act) => {
      back.remove();
      this.pauseEl = null;
      this.paused = false;
      if (act === 'quit') this.exit();
    });
  }

  // ---------------------------------------------------------------- swing & flight
  private beginSwing(): void {
    let acc = this.accuracy;
    const zone = this.zoneWidth() * (this.power > 1 ? 0.55 : 1);
    const perfect = Math.abs(acc) <= zone;
    if (perfect) acc = (Math.random() - 0.5) * zone * 0.15;
    this.perfect = perfect;
    this.accErr = acc;
    this.phase = 'swing';
    this.swingT = this.player.animT;
    this.player.restartAnim(this.club.putter ? 'putt' : this.club.id === 'sw' || this.club.id === 'lw' ? (this.power < 0.6 ? 'chip' : 'swing') : 'swing', this.club.putter ? 1.1 : 1.3);
    this.player.animT = (this.club.putter ? 0.42 : 0.42) * this.player.animDur;
    this.swingDur = this.player.animDur;
    this.launched = false;
    this.aimLine.visible = false;
    this.aimRing.visible = false;
    this.arrows.count = 0;
  }
  private perfect = false;
  private accErr = 0;

  private launchBall(): void {
    const g = this.app.game;
    const c = this.club;
    this.strokes++;
    this.ball.gatherTrees(this.ball.x, this.ball.z, 260);
    if (c.putter) {
      const sp = this.puttScale() * Math.min(1.1, this.power);
      const dirErr = (this.accErr * 0.11) / (1 + (g.state.player.stats.putting - 1) * 0.08);
      this.ball.putt(sp, this.aimYaw + dirErr);
      this.app.sfx('putt');
      this.lastShot = null;
    } else {
      const l = this.launchFor(this.power, this.accErr);
      if (this.perfect) l.speed *= 1.02;
      this.ball.launch(l, this.onTee ? 0.04 : 0.02);
      this.lastShotLaunch = l;
      this.app.sfx(c.id === 'dr' || c.id === '3w' || c.id === '5w' ? 'hit_driver' : ['sw', 'lw', 'gw'].includes(c.id) ? 'hit_wedge' : 'hit_iron', { volume: 0.9 + this.power * 0.2 });
      const surf = this.lie();
      if (surf === Surf.Bunker) this.app.view.effects.spawn('sand', this.ball.x, this.ball.y + 0.2, this.ball.z, 30);
      else if (surf !== Surf.Tee) this.app.view.effects.spawn('dust', this.ball.x, this.ball.y + 0.1, this.ball.z, 8);
      if (this.perfect) this.flash('Perfect strike!');
      else if (Math.abs(this.accErr) > 0.08) this.flash(this.accErr > 0 ? 'Sliced it!' : 'Hooked it!');
    }
    this.onTee = false;
    this.launched = true;
    this.phase = 'flight';
    this.flightCamStart.copy(this.app.view.r.camera.position);
    this.trailPts = [];
    this.flightT = 0;
    this.bounceSfx = 0;
  }
  private lastShotLaunch: Launch | null = null;
  private flightT = 0;
  private bounceSfx = 0;

  private flash(text: string): void {
    this.message = text;
    this.renderHud();
  }

  private banner(big: string, small = ''): void {
    const b = this.hud.querySelector('.banner');
    b?.remove();
    const d = el('div', 'banner', `${esc(big)}${small ? `<small>${esc(small)}</small>` : ''}`);
    this.hud.appendChild(d);
    this.bannerT = 2.4;
  }

  private shotFinished(): void {
    const g = this.app.game;
    const st = this.ball.state;
    const pl = g.state.player;
    const totalYds = Math.round(this.ball.stats.total * YARDS_PER_WORLD);
    const carryYds = Math.round(this.ball.stats.carry * YARDS_PER_WORLD);
    if (this.lastShotLaunch) {
      const l = this.lastShotLaunch;
      this.lastShot = { carry: carryYds, total: totalYds, offline: Math.round(this.ball.stats.offline * YARDS_PER_WORLD), speed: Math.round(l.speed * 2.237), launch: l.launchDeg, spin: Math.round(l.spinRpm), apex: Math.round(this.ball.stats.apex * 3.28), hang: this.ball.stats.hang, club: this.club.name };
      this.lastShotLaunch = null;
    }
    if (st === 'water') {
      this.app.view.effects.spawn('splash', this.ball.x, this.ball.y + 0.2, this.ball.z);
      this.app.sfx('splash');
    }
    if (this.cfg.mode === 'range') {
      this.rangeShotDone(st, totalYds);
      return;
    }
    // ---- course
    const h = this.hole;
    let text = '';
    if (st === 'holed') {
      this.holeDone();
      return;
    }
    if (st === 'water') {
      this.strokes++;
      const d = this.ball.lastDry;
      this.ball.place(d.x, d.z);
      text = 'In the water · penalty stroke, drop';
    } else if (st === 'ob') {
      this.strokes++;
      this.ball.place(this.shotFrom.x, this.shotFrom.z);
      text = 'Out of bounds · stroke and distance';
    } else {
      const s = g.world.surfAt(this.ball.x, this.ball.z);
      const toPin = Math.round(Math.hypot(h.pinWorld.x - this.ball.x, h.pinWorld.z - this.ball.z) * YARDS_PER_WORLD);
      text = this.club.putter ? `${Math.round(Math.hypot(h.pinWorld.x - this.ball.x, h.pinWorld.z - this.ball.z) * COURSE_SCALE * 3.28)} ft left` : `${LIE_NAMES[s] ?? SURF_NAMES[s]} · ${totalYds} yds · ${toPin} to the pin`;
      if (this.ball.stats.hitTree) text = 'Clipped a tree! ' + text;
      if (s === Surf.Bunker) this.app.sfx('land_sand');
      if (this.onTeeShotWasDriver() && s !== Surf.Water) {
        if (totalYds > pl.longestDrive && (s === Surf.Fairway || s === Surf.Rough || s === Surf.Green)) pl.longestDrive = totalYds;
      }
    }
    if (this.strokes >= h.par + 6) {
      this.message = 'Picked up — maximum score';
      this.strokes = h.par + 6;
      this.holeDone(true);
      return;
    }
    this.message = text;
    this.phase = 'result';
    this.resultT = 0;
    this.renderHud();
  }

  private onTeeShotWasDriver(): boolean {
    return this.lastShot?.club === 'Driver' && this.strokes === 1;
  }

  private rangeShotDone(st: string, totalYds: number): void {
    const g = this.app.game;
    const pl = g.state.player;
    const cfg = this.cfg as Extract<PlayConfig, { mode: 'range' }>;
    pl.rangeBalls++;
    if (this.rangeXp < 150) this.rangeXp += 3;
    const valid = st !== 'water' && st !== 'ob';
    let text = valid ? `${this.lastShot?.carry ?? 0} carry · ${totalYds} total` : st === 'water' ? 'Splash! Ball in the water' : 'Off your land — ball lost';
    if (cfg.challenge === 'free' && this.club.id === 'dr' && valid && totalYds > pl.longestDrive) {
      pl.longestDrive = totalYds;
      text += ' · New personal best!';
    }
    if (cfg.challenge === 'longdrive') {
      this.shotsLeft--;
      if (valid && totalYds > this.challengeBest) this.challengeBest = totalYds;
      if (valid && totalYds > pl.longestDrive) pl.longestDrive = totalYds;
      text += ` · best ${this.challengeBest} yds · ${this.shotsLeft} left`;
    } else if (cfg.challenge === 'target') {
      this.shotsLeft--;
      let pts = 0;
      if (valid) {
        let best = Infinity;
        for (const t of this.targets) best = Math.min(best, Math.hypot(this.ball.x - t.x, this.ball.z - t.z) / t.r);
        pts = best <= 0.25 ? 10 : best <= 0.6 ? 6 : best <= 1 ? 3 : best <= 1.6 ? 1 : 0;
        if (pts >= 6) {
          this.app.view.effects.spawn('sparkle', this.ball.x, this.ball.y + 0.5, this.ball.z, 30);
          this.app.sfx('cash', { volume: 0.6 });
        }
      }
      this.challengeScore += pts;
      text = `${pts} points · total ${this.challengeScore} · ${this.shotsLeft} left`;
    } else if (cfg.challenge === 'closest') {
      this.shotsLeft--;
      const ft = valid ? Math.hypot(this.ball.x - this.flag!.x, this.ball.z - this.flag!.z) * COURSE_SCALE * 3.28 : Infinity;
      if (st === 'holed') {
        this.challengeBest = 0;
        this.banner('HOLE IN ONE!', 'Unbelievable');
        this.app.sfx('cheer');
        this.app.view.effects.spawn('confetti', this.ball.x, this.ball.y + 2, this.ball.z, 200);
        text = 'HOLE IN ONE!';
      } else {
        if (ft < this.challengeBest) this.challengeBest = ft;
        text = valid ? `${ft.toFixed(1)} ft from the pin · best ${this.challengeBest.toFixed(1)} ft · ${this.shotsLeft} left` : `${text} · ${this.shotsLeft} left`;
      }
    }
    this.message = text;
    this.phase = 'result';
    this.resultT = 0;
    this.renderHud();
  }

  private finishChallenge(): void {
    const g = this.app.game;
    const pl = g.state.player;
    const cfg = this.cfg as Extract<PlayConfig, { mode: 'range' }>;
    const ch = pl.challenges;
    let prize = 0;
    let xp = 60;
    const rows: string[] = [];
    const award = (key: string, amount: number, label: string) => {
      if (ch['won_' + key]) return;
      ch['won_' + key] = 1;
      prize += amount;
      rows.push(`${label}: <b>${money(amount)}</b>`);
    };
    let title = '';
    if (cfg.challenge === 'longdrive') {
      const b = this.challengeBest;
      title = `Longest drive: ${b} yards`;
      ch.longdrive = Math.max(ch.longdrive ?? 0, b);
      if (b >= 250) award('ld250', 500, '250 yards');
      if (b >= 280) award('ld280', 1500, '280 yards');
      if (b >= 300) award('ld300', 4000, '300 yards');
      if (b >= 330) award('ld330', 10000, '330 yards');
      xp += Math.max(0, b - 150);
    } else if (cfg.challenge === 'target') {
      const s = this.challengeScore;
      title = `Target score: ${s} points`;
      ch.target = Math.max(ch.target ?? 0, s);
      if (s >= 25) award('t25', 800, '25 points');
      if (s >= 45) award('t45', 2500, '45 points');
      if (s >= 65) award('t65', 8000, '65 points');
      xp += s * 3;
    } else if (cfg.challenge === 'closest') {
      const b = this.challengeBest;
      title = b === 0 ? 'Hole in one!' : Number.isFinite(b) ? `Closest: ${b.toFixed(1)} feet` : 'No ball found the target area';
      if (Number.isFinite(b)) ch.closest = ch.closest ? Math.min(ch.closest, b) : b;
      if (b <= 20) award('c20', 600, 'Inside 20 feet');
      if (b <= 10) award('c10', 2000, 'Inside 10 feet');
      if (b <= 3) award('c3', 6000, 'Inside 3 feet');
      if (b === 0) award('ace', 25000, 'Hole in one');
      xp += Number.isFinite(b) ? Math.max(0, 150 - b * 3) : 0;
    }
    if (prize) g.earn('other', prize);
    g.addPlayerXp(xp + this.rangeXp);
    this.rangeXp = 0;
    this.phase = 'done';
    const back = el('div', 'modal-back');
    back.innerHTML = `<div class="window narrow" style="text-align:center"><div class="wbody" style="padding:26px">
      <div class="label">Challenge complete</div><h2 class="serif" style="font-size:32px;margin:8px 0">${esc(title)}</h2>
      ${rows.length ? `<p>Prize money won:<br>${rows.join('<br>')}</p>` : '<p class="muted">No new prizes this time — beat your best to win more.</p>'}
      <p class="muted">+${Math.round(xp)} golfer XP</p>
      <div class="flex" style="justify-content:center;margin-top:10px"><button class="btn" data-act="again">Try again</button><button class="btn primary" data-act="done">Back to the club</button></div></div></div>`;
    this.hud.appendChild(back);
    if (prize) this.app.sfx('cash');
    delegate(back, (act) => {
      back.remove();
      if (act === 'again') {
        const cfgCopy = { ...cfg };
        const app = this.app;
        this.exit();
        app.startPlay(cfgCopy);
      } else this.exit();
    });
  }

  private holeDone(pickedUp = false): void {
    const g = this.app.game;
    const pl = g.state.player;
    const h = this.hole;
    const toPar = this.strokes - h.par;
    this.scores.push(this.strokes);
    pl.holesPlayed++;
    let xp = 25;
    let name = toPar === 0 ? 'Par' : toPar === 1 ? 'Bogey' : toPar === 2 ? 'Double Bogey' : toPar > 2 ? `+${toPar}` : toPar === -1 ? 'Birdie!' : toPar === -2 ? 'Eagle!' : 'Albatross!!';
    if (this.strokes === 1) name = 'HOLE IN ONE!';
    if (!pickedUp) {
      this.app.sfx('cup');
      if (toPar <= 0) pl.parsOrBetter++;
      if (toPar === -1) { pl.birdies++; xp += 80; }
      if (toPar <= -2) { pl.eagles++; xp += 200; }
      if (this.strokes === 1) { pl.holeInOnes++; xp += 500; }
      if (toPar === 0) xp += 30;
      if (toPar <= -1) {
        this.app.sfx(toPar <= -2 ? 'cheer' : 'applause');
        this.app.view.effects.spawn('confetti', h.pinWorld.x, g.world.heightAt(h.pinWorld.x, h.pinWorld.z) + 2, h.pinWorld.z, toPar <= -2 ? 220 : 90);
      }
      // course record
      const rec = h.save.record;
      if (!rec || this.strokes < rec.strokes) {
        h.save.record = { strokes: this.strokes, by: pl.name, day: g.state.day };
        if (rec) name += ' · Course record!';
      }
    }
    g.addPlayerXp(xp);
    this.banner(name, `${this.strokes} strokes · ${fmtPar(toPar)}`);
    this.phase = 'between';
    this.resultT = 0;
    this.message = `${hint('Click', 'Tap')} ${this.holeIdx < this.holes.length - 1 ? 'to continue to the next hole' : 'to see your scorecard'}`;
    this.renderHud();
  }

  private nextHoleOrFinish(): void {
    if (this.holeIdx < this.holes.length - 1) {
      this.holeIdx++;
      this.startHole();
    } else this.finishRound();
  }

  private finishRound(): void {
    const g = this.app.game;
    const pl = g.state.player;
    const total = this.scores.reduce((a, b) => a + b, 0);
    const par = this.holes.reduce((a, h) => a + h.par, 0);
    const toPar = total - par;
    const n = this.holes.length;
    if (n >= 3 && (!pl.bestRound || (pl.bestRound.holes <= n && toPar < pl.bestRound.toPar))) pl.bestRound = { holes: n, strokes: total, toPar };
    let prize = 0;
    if (n >= 9 && toPar <= 0) prize = n >= 18 ? 5000 : 2000;
    if (prize) g.earn('other', prize);
    if (n >= 9) g.addPlayerXp(n * 10);
    const cfg = this.cfg as Extract<PlayConfig, { mode: 'course' }>;
    if (cfg.tournament && g.tournament && !g.tournament.playerScore) g.tournament.submitPlayer(total, toPar);
    this.phase = 'done';
    const back = el('div', 'modal-back');
    back.innerHTML = `<div class="window"><div class="whead"><div class="wic">${icon('flag')}</div><h2>Scorecard</h2></div><div class="wbody">
      <div class="tablewrap"><table class="t"><thead><tr><th>Hole</th>${this.holes.map((h) => `<th class="r">${h.num}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>
      <tr><td>Par</td>${this.holes.map((h) => `<td class="r">${h.par}</td>`).join('')}<td class="r">${par}</td></tr>
      <tr class="hl"><td><b>You</b></td>${this.scores.map((s, i) => `<td class="r ${s < this.holes[i].par ? 'pos' : s > this.holes[i].par ? 'neg' : ''}"><b>${s}</b></td>`).join('')}<td class="r"><b>${total}</b></td></tr></tbody></table></div>
      <h3 class="serif" style="font-size:30px;margin:16px 0 4px">${total} · ${fmtPar(toPar)}</h3>
      ${prize ? `<p>Sponsors pay a <b>${money(prize)}</b> bonus for breaking par!</p>` : ''}
      ${cfg.tournament ? '<p>Your score has been posted to the tournament leaderboard.</p>' : ''}
      <div class="flex" style="justify-content:flex-end"><button class="btn primary" data-act="done">Back to the club</button></div></div></div>`;
    this.hud.appendChild(back);
    delegate(back, () => {
      back.remove();
      this.exit();
    });
  }

  // ---------------------------------------------------------------- per frame
  update(dt: number): void {
    if (this.ended) return;
    const g = this.app.game;
    const v = this.app.view;
    if (this.paused) {
      this.updateCamera(dt);
      return;
    }
    // aim keys
    if (this.phase === 'aim') {
      const rate = this.club.putter ? 0.35 : 0.8;
      let d = 0;
      if (this.keys.has('a') || this.keys.has('arrowleft')) d += 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) d -= 1;
      if (d) {
        this.aimYaw += d * rate * dt * (this.keys.has('shift') ? 0.25 : 1);
        this.placePlayer();
        this.updateAimGuide();
      }
    }
    // meter
    if (this.phase === 'power') {
      this.meter += dt * 0.95;
      this.player.animT = Math.min(0.42, (this.meter / 1.1) * 0.42) * this.player.animDur;
      if (this.meter >= 1.12) {
        this.power = 1.12;
        this.meter = 1.12;
        this.phase = 'accuracy';
      }
    } else if (this.phase === 'accuracy') {
      this.meter -= dt * (1.1 + this.power * 0.9) * (this.power > 1 ? 1.25 : 1);
      this.player.animT = 0.42 * this.player.animDur;
      if (this.meter <= -0.16) {
        this.accuracy = -0.16;
        this.beginSwing();
      }
    } else if (this.phase === 'swing') {
      this.player.animT += dt;
      if (!this.launched && this.player.animT >= this.player.animDur * 0.5) this.launchBall();
    } else if (this.phase === 'flight') {
      this.player.animT += dt;
      this.flightT += dt;
      const prevState = this.ball.state;
      const prevBounces = this.ball.bounces;
      this.ball.step(dt);
      if (this.ball.bounces > prevBounces && this.bounceSfx < 3) {
        this.bounceSfx++;
        const s = g.world.surfAt(this.ball.x, this.ball.z);
        if (s !== Surf.Bunker && s !== Surf.Water) this.app.sfx('bounce', { volume: 0.5 });
      }
      if (this.ball.stats.hitTree && !this.treeSfx) {
        this.treeSfx = true;
        this.app.sfx('tree_hit');
        this.app.view.effects.spawn('leaves', this.ball.x, this.ball.y, this.ball.z, 14);
      }
      if (this.ball.state === 'air') this.trailPts.push(new THREE.Vector3(this.ball.x, this.ball.y, this.ball.z));
      void prevState;
      if (!this.ball.moving) {
        this.treeSfx = false;
        this.shotFinished();
      } else if (this.flightT > 25) {
        this.ball.state = 'rest';
        this.shotFinished();
      }
    } else if (this.phase === 'result' || this.phase === 'between') {
      this.resultT += dt;
      this.player.animT += dt;
      const wait = this.phase === 'between' ? 6 : 2.2;
      if (this.resultT > wait) {
        if (this.phase === 'between') this.nextHoleOrFinish();
        else if (this.cfg.mode === 'range') {
          const cfg = this.cfg as Extract<PlayConfig, { mode: 'range' }>;
          if (cfg.challenge !== 'free' && this.shotsLeft <= 0) this.finishChallenge();
          else {
            this.ball.place(this.tee.x, this.tee.z);
            this.onTee = true;
            this.newShot();
          }
        } else this.newShot();
      }
    }
    this.bannerT -= dt;
    if (this.bannerT <= 0) this.hud.querySelector('.banner')?.remove();

    // ball visuals
    const camD = v.r.camera.position.distanceTo(this.ballMesh.position);
    const rad = Math.max(0.035, Math.min(0.5, camD * 0.0045));
    this.ballMesh.scale.setScalar(rad);
    this.ballMesh.position.set(this.ball.x, this.ball.y + rad * 0.9, this.ball.z);
    this.ballMesh.visible = this.ball.state !== 'holed' && this.ball.state !== 'water' && this.ball.state !== 'ob';
    if (this.trailPts.length > 1) {
      const pts = this.trailPts.length > 400 ? this.trailPts.filter((_, i) => i % 2 === 0) : this.trailPts;
      this.trail.geometry.dispose();
      this.trail.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      this.trail.visible = true;
    } else this.trail.visible = this.phase === 'result';
    if (this.phase === 'aim') this.trail.visible = false;

    this.updateCamera(dt);
    this.updateMeterUi();
    this.updatePinTag();
    v.r.focus.copy(this.ballMesh.position);
  }
  private treeSfx = false;

  private updateCamera(dt: number): void {
    const v = this.app.view;
    const cam = v.r.camera;
    const g = this.app.game;
    const bx = this.ball.x, by = this.ball.y, bz = this.ball.z;
    const dirx = Math.sin(this.aimYaw), dirz = Math.cos(this.aimYaw);
    const wantPos = new THREE.Vector3();
    const wantLook = new THREE.Vector3();
    let k = 4;
    if (this.camMode === 'overhead' && (this.phase === 'aim' || this.phase === 'power' || this.phase === 'accuracy')) {
      const reach = this.club.putter ? 12 : Math.max(40, this.predCarry * 0.9);
      const mx = bx + dirx * reach * 0.5, mz = bz + dirz * reach * 0.5;
      wantPos.set(mx - dirx * reach * 0.25, g.world.heightAt(mx, mz) + reach * 1.15, mz - dirz * reach * 0.25);
      wantLook.set(mx, g.world.heightAt(mx, mz), mz);
    } else if (this.phase === 'flight' || this.phase === 'result' || this.phase === 'between') {
      const vx = this.ball.vx, vz = this.ball.vz;
      const sp = Math.hypot(vx, vz);
      const hx = sp > 0.5 ? vx / sp : dirx, hz = sp > 0.5 ? vz / sp : dirz;
      if (this.club.putter) {
        wantPos.set(bx - hx * 4 + hz * 1.5, by + 2.2, bz - hz * 4 - hx * 1.5);
        k = 3;
      } else if (this.ball.state === 'air' && this.flightT < 0.7) {
        wantPos.copy(this.flightCamStart);
        k = 2;
      } else {
        const dist = this.ball.state === 'air' ? 16 : 11;
        wantPos.set(bx - hx * dist + hz * 4, Math.max(by + 4, g.world.heightAt(bx - hx * dist, bz - hz * dist) + 3), bz - hz * dist - hx * 4);
        k = this.ball.state === 'air' ? 2.2 : 1.6;
      }
      wantLook.set(bx, by + 0.5, bz);
    } else {
      // behind the golfer
      const putt = this.club.putter;
      const back = putt ? 3.4 : 7.5;
      const up = putt ? 1.6 : 2.7;
      // stand a little to the right of the line so the golfer does not block the view
      const rx = -dirz, rz = dirx;
      const side = putt ? 0.3 : -0.9;
      wantPos.set(bx - dirx * back + rx * side, by + up, bz - dirz * back + rz * side);
      const ahead = putt ? Math.min(14, Math.hypot(this.target()!.x - bx, this.target()!.z - bz)) : 34;
      wantLook.set(bx + dirx * ahead, by + (putt ? -0.3 : 0.8), bz + dirz * ahead);
      const gy = g.world.heightAt(wantPos.x, wantPos.z) + 1;
      if (wantPos.y < gy) wantPos.y = gy;
      k = 5;
    }
    const s = 1 - Math.exp(-dt * k);
    this.camPos.lerp(wantPos, s);
    this.camLook.lerp(wantLook, Math.min(1, s * 1.5));
    const minY = g.world.heightAt(this.camPos.x, this.camPos.z) + 0.8;
    if (this.camPos.y < minY) this.camPos.y = minY;
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    void WORLD;
  }

  private updatePinTag(): void {
    const t = this.target();
    if (!t || this.phase === 'done') {
      this.pinTag?.remove();
      this.pinTag = null;
      return;
    }
    if (!this.pinTag || !this.pinTag.isConnected) {
      this.pinTag = el('div', 'hole-label');
      this.hud.appendChild(this.pinTag);
    }
    const g = this.app.game;
    const sc = this.app.view.worldToScreen(t.x, g.world.heightAt(t.x, t.z) + 4.5, t.z);
    this.pinTag.hidden = !sc.visible;
    const yds = Math.round(Math.hypot(t.x - this.ball.x, t.z - this.ball.z) * YARDS_PER_WORLD);
    this.pinTag.innerHTML = `<b>${icon('flag')}</b>${yds} yds`;
    this.pinTag.style.transform = `translate(${sc.x}px, ${sc.y}px) translate(-50%, -100%)`;
  }

  // ---------------------------------------------------------------- HUD
  private renderHud(): void {
    const g = this.app.game;
    const course = this.cfg.mode === 'course';
    const c = this.club;
    const s = this.lie();
    const t = this.target();
    const toT = t ? Math.round(Math.hypot(t.x - this.ball.x, t.z - this.ball.z) * YARDS_PER_WORLD) : 0;
    const windRel = this.wind.dir - this.aimYaw;
    let headline = '';
    if (course) {
      const h = this.hole;
      const total = this.scores.reduce((a, b) => a + b, 0) + this.strokes;
      const parSoFar = this.holes.slice(0, this.holeIdx).reduce((a, x) => a + x.par, 0);
      headline = `<div class="holecard glass"><div class="label">Hole ${this.holeIdx + 1} of ${this.holes.length}</div><div class="hn">Hole ${h.num}</div>
        <div class="meta"><span>Par ${h.par}</span><span>${h.yards} yds</span><span>Stroke ${this.strokes + 1}</span></div>
        <div class="score">${this.holes.length > 1 ? `Round: ${fmtPar(this.scores.reduce((a, b) => a + b, 0) - parSoFar)} thru ${this.holeIdx}` : `Strokes: ${total}`}</div></div>`;
    } else {
      const cfg = this.cfg as Extract<PlayConfig, { mode: 'range' }>;
      const names = { free: 'Free Practice', longdrive: 'Long Drive', target: 'Target Challenge', closest: 'Closest to the Pin' };
      headline = `<div class="holecard glass"><div class="label">${this.bay ? 'Your driving range' : 'Practice tee'}</div><div class="hn">${names[cfg.challenge]}</div>
        <div class="meta">${cfg.challenge === 'free' ? `<span>Balls hit: ${g.state.player.rangeBalls}</span>` : `<span>${this.shotsLeft} balls left</span>`}${cfg.challenge === 'target' ? `<span>${this.challengeScore} pts</span>` : ''}${cfg.challenge === 'longdrive' ? `<span>Best ${this.challengeBest} yds</span>` : ''}</div></div>`;
    }
    const data = this.lastShot && !c.putter ? `<div class="data glass"><span class="k x">Club</span><span class="v x">${esc(this.lastShot.club)}</span>
      <span class="k">Ball speed</span><span class="v">${this.lastShot.speed} mph</span><span class="k x">Launch</span><span class="v x">${this.lastShot.launch.toFixed(1)}°</span>
      <span class="k x">Spin</span><span class="v x">${this.lastShot.spin} rpm</span><span class="k x">Apex</span><span class="v x">${this.lastShot.apex} ft</span>
      <span class="k">Carry</span><span class="v">${this.lastShot.carry} yds</span><span class="k">Total</span><span class="v">${this.lastShot.total} yds</span>
      <span class="k">Offline</span><span class="v">${Math.abs(this.lastShot.offline)} ${this.lastShot.offline > 0 ? 'R' : this.lastShot.offline < 0 ? 'L' : ''}</span></div>` : '';
    this.hud.innerHTML = `${headline}
      <div class="hud-tr"><div class="wind glass"><div class="arrow"><span style="display:block;transform:rotate(${(-windRel * 180) / Math.PI}deg)">${icon('arrow')}</span></div><div><div class="label">Wind</div><div class="wv">${this.wind.mph} mph</div></div></div>
      <div class="topright-btns"><button class="btn small" data-act="cam" title="${this.camMode === 'behind' ? 'Overhead' : 'Behind'} view">${icon('camera')}<span class="long"> ${this.camMode === 'behind' ? 'Overhead' : 'Behind'}<span class="kb-only"> (C)</span></span></button><button class="btn small" data-act="quit" title="Pause menu">${icon('menu')}<span class="long"> Menu</span></button></div></div>
      ${this.message ? `<div class="help glass">${esc(this.message)}</div>` : ''}
      <div class="shotinfo glass">
        <div class="club"><button class="btn small icon-btn" data-act="clubup" title="Longer club (W)">▲</button><div><div class="cn">${esc(c.name)}</div><div class="cd">${c.putter ? `${Math.round((t ? Math.hypot(t.x - this.ball.x, t.z - this.ball.z) : 0) * COURSE_SCALE * 3.28)} ft to the hole` : `Full carry ≈ ${Math.round(this.predCarry * YARDS_PER_WORLD)} yds`}</div></div><button class="btn small icon-btn" data-act="clubdown" title="Shorter club (S)">▼</button></div>
        <div class="flex"><button class="btn small" data-act="aiml" title="Aim left (A)">◀ Aim</button><button class="btn small" data-act="aimr" title="Aim right (D)">Aim ▶</button></div>
        <div class="lie">Lie: <b>${LIE_NAMES[s] ?? SURF_NAMES[s]}</b>${t ? ` · ${toT} yds to ${course ? 'the pin' : 'the flag'}` : ''}</div>
      </div>
      <div class="meter glass"><div class="track"><div class="fill"></div><div class="sweet"></div><div class="full"></div><div class="mark"></div>${c.putter ? '<div class="full putt-tick" style="background:#f0d48a;width:3px"></div>' : ''}</div><div class="hint"></div></div>
      ${data}`;
    if (this.bannerT > 0) {
      // keep banner on top
    }
    this.updateMeterUi();
  }

  private updateMeterUi(): void {
    const tr = this.hud.querySelector('.meter .track') as HTMLElement | null;
    if (!tr) return;
    const pos = (v: number) => `${((v + 0.16) / 1.3) * 100}%`;
    const fill = tr.querySelector('.fill') as HTMLElement;
    const mark = tr.querySelector('.mark') as HTMLElement;
    const sweet = tr.querySelector('.sweet') as HTMLElement;
    const full = tr.querySelector('.full') as HTMLElement;
    const hint = this.hud.querySelector('.meter .hint') as HTMLElement;
    const zone = this.zoneWidth() * (this.power > 1 && this.phase === 'accuracy' ? 0.55 : 1);
    sweet.style.left = pos(-zone);
    sweet.style.width = `${((zone * 2) / 1.3) * 100}%`;
    full.style.left = pos(1);
    const putt = tr.querySelector('.putt-tick') as HTMLElement | null;
    if (putt) putt.style.left = pos(Math.sqrt(1 / 1.5));
    const showPower = this.phase === 'accuracy' || this.phase === 'swing' ? this.power : this.meter;
    fill.style.left = pos(0);
    fill.style.width = this.phase === 'aim' ? '0%' : `${(Math.max(0, showPower) / 1.3) * 100}%`;
    mark.style.left = pos(this.phase === 'aim' ? 0 : this.meter);
    mark.style.display = this.phase === 'power' || this.phase === 'accuracy' ? 'block' : 'none';
    const msg: Record<Phase, string> = input.touch
      ? {
          aim: this.club.putter ? 'Drag to aim · Tap to start the putt' : 'Drag to aim · Tap to swing',
          power: 'Tap to set power',
          accuracy: 'Tap as the marker crosses the line',
          swing: '', flight: '', result: 'Tap to continue', between: 'Tap to continue', done: '',
        }
      : {
          aim: this.club.putter ? 'Aim with A/D or right-drag · Click or Space to start the putt' : 'Aim with A/D or right-drag · W/S or wheel to change club · Click or Space to swing',
          power: 'Click to set power',
          accuracy: 'Click as the marker crosses the line',
          swing: '', flight: '', result: 'Click to continue', between: 'Click to continue', done: '',
        };
    hint.textContent = msg[this.phase];
  }
}
