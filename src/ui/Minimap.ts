// Top-down overview map with the camera view, holes and visitors.
import { MAP, PARCEL, Surf, TILE } from '../core/constants';
import { ITEMS } from '../data/items';
import type { View } from '../render/View';
import type { Game } from '../sim/Game';

const COLORS: Record<number, [number, number, number]> = {
  [Surf.Rough]: [86, 128, 52],
  [Surf.Fairway]: [118, 178, 70],
  [Surf.Green]: [140, 205, 95],
  [Surf.Tee]: [125, 185, 80],
  [Surf.Bunker]: [232, 216, 160],
  [Surf.Water]: [52, 112, 140],
  [Surf.Path]: [175, 172, 165],
  [Surf.DeepRough]: [120, 120, 62],
  [Surf.Road]: [60, 62, 66],
  [Surf.Paving]: [200, 190, 170],
};

export class Minimap {
  root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private base: HTMLCanvasElement;
  private dirty = true;
  private t = 0;

  constructor(private game: Game, private view: View) {
    this.root = document.createElement('div');
    this.root.className = 'minimap glass';
    this.canvas = document.createElement('canvas');
    this.canvas.width = MAP * 2;
    this.canvas.height = MAP * 2;
    this.root.appendChild(this.canvas);
    this.base = document.createElement('canvas');
    this.base.width = MAP;
    this.base.height = MAP;
    const mark = () => (this.dirty = true);
    game.world.on('surf', mark);
    game.world.on('owned', mark);
    game.world.on('objectAdded', mark);
    game.world.on('objectRemoved', mark);
    game.world.on('treeAdded', mark);
    game.world.on('treeRemoved', mark);
    const go = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * MAP * TILE;
      const z = ((e.clientY - r.top) / r.height) * MAP * TILE;
      this.view.cam.setView(x, z);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      go(e);
      const mv = (ev: PointerEvent) => go(ev);
      const up = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    });
  }

  private drawBase(): void {
    const w = this.game.world;
    const ctx = this.base.getContext('2d')!;
    const img = ctx.createImageData(MAP, MAP);
    for (let y = 0; y < MAP; y++) {
      for (let x = 0; x < MAP; x++) {
        const i = y * MAP + x;
        let c = COLORS[w.surf[i]] ?? COLORS[0];
        if (w.treeAt[i]) c = [44, 84, 40];
        const o = w.occ[i] > 0 ? w.objects.get(w.occ[i]) : undefined;
        if (o) {
          const k = ITEMS[o.type].kind;
          c = k === 'bay' ? [214, 178, 94] : k === 'carpark' ? [90, 92, 96] : k === 'target' ? [230, 90, 70] : [236, 228, 208];
        }
        const own = w.isOwnedTile(x, y) || w.surf[i] === Surf.Road;
        const f = own ? 1 : 0.55;
        const p = i * 4;
        img.data[p] = c[0] * f;
        img.data[p + 1] = c[1] * f;
        img.data[p + 2] = c[2] * f;
        img.data[p + 3] = 255;
        // parcel lines
        if (!own && (x % PARCEL === 0 || y % PARCEL === 0)) {
          img.data[p] *= 0.8;
          img.data[p + 1] *= 0.8;
          img.data[p + 2] *= 0.8;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  update(dt: number): void {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    if (this.dirty) {
      this.dirty = false;
      this.drawBase();
    }
    const ctx = this.canvas.getContext('2d')!;
    const S = 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0, MAP * S, MAP * S);
    // holes
    ctx.lineWidth = 1;
    for (const h of this.game.course.holes) {
      ctx.strokeStyle = h.valid ? 'rgba(255,255,255,.7)' : 'rgba(255,120,100,.8)';
      ctx.beginPath();
      h.route.forEach((p, i) => {
        const x = (p.x / TILE) * S, y = (p.z / TILE) * S;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = '#f0d48a';
      ctx.font = 'bold 9px Manrope, sans-serif';
      ctx.fillText(String(h.num), (h.teeWorld.x / TILE) * S + 2, (h.teeWorld.z / TILE) * S - 2);
    }
    // people
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    for (const p of this.game.sim.people) {
      if (!p.visible || p.removed) continue;
      ctx.fillRect((p.x / TILE) * S - 0.5, (p.z / TILE) * S - 0.5, 1.5, 1.5);
    }
    // camera footprint
    const c = this.view.cam;
    const cx = (c.target.x / TILE) * S, cz = (c.target.z / TILE) * S;
    const r = (c.dist / TILE) * S * 0.6;
    ctx.save();
    ctx.translate(cx, cz);
    ctx.rotate(c.yaw);
    ctx.strokeStyle = '#f0d48a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, r * 0.35);
    ctx.lineTo(r * 0.6, r * 0.35);
    ctx.lineTo(r * 1.1, -r * 0.9);
    ctx.lineTo(-r * 1.1, -r * 0.9);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}
