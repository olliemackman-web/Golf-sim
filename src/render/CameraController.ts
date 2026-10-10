// RTS-style orbit camera: pan (WASD / drag), rotate (Q/E / right-drag), zoom (wheel / pinch).
import { listen } from '../core/listeners';
import * as THREE from 'three';
import { WORLD } from '../core/constants';
import type { World } from '../world/World';

export class CameraController {
  target = new THREE.Vector3(WORLD / 2, 0, WORLD * 0.82);
  yaw = 0; // radians, 0 = looking north (-Z)
  pitch = 0.82; // radians above horizon
  dist = 150;
  private goal = { target: this.target.clone(), yaw: 0, pitch: 0.82, dist: 150 };
  enabled = true;
  keys = new Set<string>();
  minDist = 12;
  maxDist = 520;
  private drag: { mode: 'pan' | 'rotate'; x: number; y: number; ground: THREE.Vector3 | null } | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; a: number; cx: number; cy: number; d0: number; sa: { x: number; y: number }; sb: { x: number; y: number }; mode: 'pinch' | 'tilt' | null } | null = null;
  /** Called with screen coords; returns ground point under cursor. */
  pickGround: ((x: number, y: number) => THREE.Vector3 | null) | null = null;
  bounds = { x0: -100, z0: -100, x1: WORLD + 100, z1: WORLD + 60 };
  /** When true, left-drag pans (no build tool active). */
  leftPans = true;
  /** When true, a one-finger drag pans. Painting tools turn this off so one finger paints and two fingers move the camera. */
  touchPans = true;

  constructor(public camera: THREE.PerspectiveCamera, private dom: HTMLElement, private world: World) {
    listen(dom, 'contextmenu', (e) => e.preventDefault());
    listen(dom, 'pointerdown', (e) => this.onDown(e));
    listen(window, 'pointermove', (e) => this.onMove(e));
    listen(window, 'pointerup', (e) => this.onUp(e));
    listen(window, 'pointercancel', (e) => this.onUp(e));
    listen(dom, 'wheel', (e) => this.onWheel(e), { passive: false });
    listen(window, 'keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
    });
    listen(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    listen(window, 'blur', () => this.keys.clear());
    this.goal.yaw = this.yaw;
    this.goal.pitch = this.pitch;
  }

  setView(x: number, z: number, dist?: number, yaw?: number, pitch?: number, instant = false): void {
    this.goal.target.set(x, this.world.heightAt(x, z), z);
    if (dist !== undefined) this.goal.dist = dist;
    if (yaw !== undefined) this.goal.yaw = yaw;
    if (pitch !== undefined) this.goal.pitch = pitch;
    if (instant) {
      this.target.copy(this.goal.target);
      this.dist = this.goal.dist;
      this.yaw = this.goal.yaw;
      this.pitch = this.goal.pitch;
    }
  }

  get goalState() {
    return this.goal;
  }

  private onDown(e: PointerEvent): void {
    if (!this.enabled) return;
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        const [a, b] = Array.from(this.touches.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.pinch = { d, a: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d0: d, sa: { ...a }, sb: { ...b }, mode: null };
        this.drag = null;
        return;
      }
      if (this.touches.size > 2) return;
      if (this.touchPans) {
        const g = this.pickGround?.(e.clientX, e.clientY) ?? null;
        this.drag = { mode: 'pan', x: e.clientX, y: e.clientY, ground: g };
      }
      return;
    }
    if (e.button === 2 || (e.button === 0 && e.altKey)) {
      this.drag = { mode: 'rotate', x: e.clientX, y: e.clientY, ground: null };
    } else if (e.button === 1 || (e.button === 0 && this.leftPans)) {
      const g = this.pickGround?.(e.clientX, e.clientY) ?? null;
      this.drag = { mode: 'pan', x: e.clientX, y: e.clientY, ground: g };
    }
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.touches.size === 2) {
        const [a, b] = Array.from(this.touches.values());
        const p = this.pinch;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        if (!p.mode) {
          // decide once the fingers have moved: both sliding up or down side by side tilts, anything else pinches
          const da = { x: a.x - p.sa.x, y: a.y - p.sa.y }, db = { x: b.x - p.sb.x, y: b.y - p.sb.y };
          if (Math.max(Math.hypot(da.x, da.y), Math.hypot(db.x, db.y)) > 14) {
            const vertical = Math.abs(da.y) > 2 * Math.abs(da.x) && Math.abs(db.y) > 2 * Math.abs(db.x) && da.y * db.y > 0;
            const sideBySide = Math.abs(p.sb.x - p.sa.x) > Math.abs(p.sb.y - p.sa.y);
            p.mode = vertical && sideBySide && Math.abs(d - p.d0) < 30 ? 'tilt' : 'pinch';
          }
        } else if (p.mode === 'tilt') {
          this.goal.pitch = THREE.MathUtils.clamp(this.goal.pitch + (cy - p.cy) * 0.005, 0.25, 1.45);
        } else {
          this.goal.dist = THREE.MathUtils.clamp(this.goal.dist * (p.d / d), this.minDist, this.maxDist);
          let da = ang - p.a;
          if (da > Math.PI) da -= Math.PI * 2;
          if (da < -Math.PI) da += Math.PI * 2;
          this.goal.yaw -= da;
          this.panPixels(cx - p.cx, cy - p.cy);
        }
        p.d = d;
        p.a = ang;
        p.cx = cx;
        p.cy = cy;
        return;
      }
    }
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    if (this.drag.mode === 'rotate') {
      this.goal.yaw -= dx * 0.006;
      this.goal.pitch = THREE.MathUtils.clamp(this.goal.pitch + dy * 0.004, 0.25, 1.45);
    } else {
      this.panPixels(dx, dy);
    }
  }

  private panPixels(dx: number, dy: number): void {
    const s = (this.goal.dist / this.dom.clientHeight) * 1.15;
    const fx = Math.sin(this.goal.yaw), fz = -Math.cos(this.goal.yaw);
    const rx = Math.cos(this.goal.yaw), rz = Math.sin(this.goal.yaw);
    const k = 1 / Math.max(0.35, Math.sin(this.goal.pitch));
    this.goal.target.x -= rx * dx * s - fx * dy * s * k;
    this.goal.target.z -= rz * dx * s - fz * dy * s * k;
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      if (!this.touches.delete(e.pointerId)) return;
      if (this.touches.size < 2) this.pinch = null;
    }
    this.drag = null;
  }

  isDragging(): boolean {
    return !!this.drag || !!this.pinch;
  }

  private onWheel(e: WheelEvent): void {
    if (!this.enabled) return;
    e.preventDefault();
    const f = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0016);
    const nd = THREE.MathUtils.clamp(this.goal.dist * f, this.minDist, this.maxDist);
    // zoom towards cursor
    const g = this.pickGround?.(e.clientX, e.clientY);
    if (g && f < 1) {
      const k = 1 - nd / this.goal.dist;
      this.goal.target.x += (g.x - this.goal.target.x) * k * 0.6;
      this.goal.target.z += (g.z - this.goal.target.z) * k * 0.6;
    }
    this.goal.dist = nd;
  }

  update(dt: number): void {
    if (this.enabled) {
      const k = this.keys;
      const sp = this.goal.dist * 1.1 * dt * (k.has('shift') ? 2.5 : 1);
      const fx = Math.sin(this.goal.yaw), fz = -Math.cos(this.goal.yaw);
      const rx = Math.cos(this.goal.yaw), rz = Math.sin(this.goal.yaw);
      if (k.has('w') || k.has('arrowup')) { this.goal.target.x += fx * sp; this.goal.target.z += fz * sp; }
      if (k.has('s') || k.has('arrowdown')) { this.goal.target.x -= fx * sp; this.goal.target.z -= fz * sp; }
      if (k.has('a') || k.has('arrowleft')) { this.goal.target.x -= rx * sp; this.goal.target.z -= rz * sp; }
      if (k.has('d') || k.has('arrowright')) { this.goal.target.x += rx * sp; this.goal.target.z += rz * sp; }
      if (k.has('q')) this.goal.yaw += dt * 1.6;
      if (k.has('e')) this.goal.yaw -= dt * 1.6;
      if (k.has('=') || k.has('+')) this.goal.dist = Math.max(this.minDist, this.goal.dist * (1 - dt * 1.5));
      if (k.has('-') || k.has('_')) this.goal.dist = Math.min(this.maxDist, this.goal.dist * (1 + dt * 1.5));
    }
    const b = this.bounds;
    this.goal.target.x = THREE.MathUtils.clamp(this.goal.target.x, b.x0, b.x1);
    this.goal.target.z = THREE.MathUtils.clamp(this.goal.target.z, b.z0, b.z1);
    this.goal.target.y = this.world.heightAt(this.goal.target.x, this.goal.target.z);
    const s = 1 - Math.exp(-dt * 9);
    this.target.lerp(this.goal.target, s);
    this.yaw += (this.goal.yaw - this.yaw) * s;
    this.pitch += (this.goal.pitch - this.pitch) * s;
    this.dist += (this.goal.dist - this.dist) * s;
    const cp = Math.cos(this.pitch);
    const off = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.dist);
    this.camera.position.copy(this.target).add(off);
    // keep above ground
    const gy = this.world.heightAt(this.camera.position.x, this.camera.position.z) + 2;
    if (this.camera.position.y < gy) this.camera.position.y = gy;
    this.camera.lookAt(this.target);
  }
}
