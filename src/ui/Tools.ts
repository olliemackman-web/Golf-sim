// Build tools: placing items, painting surfaces, trees, holes, bulldozing, terraforming and buying land.
import * as THREE from 'three';
import { MAP, PARCEL, PARCELS, SURF_NAMES, Surf, TILE, YARDS_PER_WORLD, inMap, tileIndex } from '../core/constants';
import { ITEMS, SURF_COST } from '../data/items';
import { modelKeyFor, ObjectRenderer } from '../render/ObjectRenderer';
import { terrainUniforms } from '../render/TerrainRenderer';
import type { View } from '../render/View';
import type { Game } from '../sim/Game';
import { parFor } from '../world/Course';
import { footprint } from '../world/World';
import { esc, money } from './dom';

export type ToolKind = 'select' | 'place' | 'paint' | 'tree' | 'hole' | 'bulldoze' | 'terraform' | 'land';
export type TerraMode = 'raise' | 'lower' | 'flatten' | 'smooth';

export interface ToolHost {
  inspectObject(id: number): void;
  inspectPerson(id: number): void;
  inspectHole(id: number): void;
  confirm(title: string, body: string, ok: string, cb: () => void): void;
  toast(text: string, kind: 'info' | 'good' | 'bad'): void;
  onToolChanged(): void;
  sfx(name: string): void;
}

export class Tools {
  kind: ToolKind = 'select';
  item: string | null = null;
  rot = 0;
  surf: Surf = Surf.Fairway;
  brush = 3;
  circle = true;
  terra: TerraMode = 'raise';
  treeType = 'tree_oak';
  treeDensity = 0.35;
  holeTee: { x: number; y: number } | null = null;
  editHole: { id: number; which: 'tee' | 'pin' } | null = null;
  private ghost: THREE.Group | null = null;
  private ghostKey = '';
  private hover: { x: number; y: number; wx: number; wz: number } | null = null;
  private down: { x: number; y: number; t: number; moved: boolean } | null = null;
  private lastPaintTile: { x: number; y: number } | null = null;
  private placedThisDrag = new Set<string>();
  private terraT = 0;
  private flattenH = 0;
  private holeLine: THREE.Line;
  private tip: HTMLDivElement;
  private mouse = { x: 0, y: 0 };
  private canvas: HTMLCanvasElement;
  showCondition = false;

  constructor(private view: View, private game: Game, private host: ToolHost) {
    this.canvas = view.r.renderer.domElement;
    this.tip = document.createElement('div');
    this.tip.className = 'cursor-tip';
    this.tip.hidden = true;
    view.container.appendChild(this.tip);
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.holeLine = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.85, depthTest: false }));
    this.holeLine.visible = false;
    this.holeLine.renderOrder = 10;
    view.r.scene.add(this.holeLine);
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('pointerleave', () => {
      this.tip.hidden = true;
      this.hover = null;
      this.clearHighlight();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  setTool(kind: ToolKind, opts: { item?: string; surf?: Surf; tree?: string; editHole?: { id: number; which: 'tee' | 'pin' } } = {}): void {
    this.kind = kind;
    this.item = opts.item ?? null;
    if (opts.surf !== undefined) this.surf = opts.surf;
    if (opts.tree) this.treeType = opts.tree;
    this.editHole = opts.editHole ?? null;
    this.holeTee = null;
    this.holeLine.visible = false;
    this.removeGhost();
    this.view.cam.leftPans = kind === 'select';
    terrainUniforms.uGrid.value = kind === 'select' ? 0 : 1;
    terrainUniforms.uOwnership.value = kind === 'land' ? 1 : kind === 'select' ? 0.35 : 0.7;
    this.clearHighlight();
    this.host.onToolChanged();
  }

  cancel(): void {
    if (this.kind === 'hole' && this.holeTee) {
      this.holeTee = null;
      this.holeLine.visible = false;
      return;
    }
    this.setTool('select');
  }

  private onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.key === 'r' || e.key === 'R') {
      if (this.kind === 'place') {
        this.rot = (this.rot + 1) % 4;
        this.removeGhost();
        this.refreshHover();
      }
    } else if (e.key === 'Escape') this.cancel();
    else if (e.key === '[') this.brush = Math.max(1, this.brush - 1);
    else if (e.key === ']') this.brush = Math.min(9, this.brush + 1);
  }

  private removeGhost(): void {
    if (this.ghost) {
      this.view.r.scene.remove(this.ghost);
      this.ghost = null;
      this.ghostKey = '';
    }
  }

  private clearHighlight(): void {
    terrainUniforms.uHighlight.value.set(-1, -1, -1, -1);
  }

  private setHighlight(x0: number, y0: number, x1: number, y1: number, ok: boolean): void {
    terrainUniforms.uHighlight.value.set(x0 * TILE, y0 * TILE, (x1 + 1) * TILE, (y1 + 1) * TILE);
    terrainUniforms.uHighlightColor.value.set(ok ? 0x7dffa0 : 0xff6b5a);
  }

  private brushTiles(cx: number, cy: number, size = this.brush): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    const r = (size - 1) / 2;
    const x0 = Math.round(cx - r), y0 = Math.round(cy - r);
    for (let y = y0; y < y0 + size; y++) {
      for (let x = x0; x < x0 + size; x++) {
        if (!inMap(x, y)) continue;
        if (this.circle && size > 2) {
          const dx = x - (x0 + r), dy = y - (y0 + r);
          if (dx * dx + dy * dy > (r + 0.5) * (r + 0.5)) continue;
        }
        out.push({ x, y });
      }
    }
    return out;
  }

  private showTip(html: string | null): void {
    if (!html) {
      this.tip.hidden = true;
      return;
    }
    this.tip.hidden = false;
    this.tip.innerHTML = html;
    const rect = this.view.container.getBoundingClientRect();
    this.tip.style.left = `${this.mouse.x - rect.left}px`;
    this.tip.style.top = `${this.mouse.y - rect.top}px`;
  }

  private onMove(e: PointerEvent): void {
    this.mouse = { x: e.clientX, y: e.clientY };
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 6) this.down.moved = true;
    this.hover = this.view.pickTile(e.clientX, e.clientY);
    this.refreshHover();
    if (this.down && e.buttons & 1) this.dragAction();
  }

  refreshHover(): void {
    const hv = this.hover;
    if (!hv) {
      this.showTip(null);
      return;
    }
    const g = this.game;
    switch (this.kind) {
      case 'select': {
        this.clearHighlight();
        const p = this.view.pickPerson(this.mouse.x, this.mouse.y);
        if (p) this.showTip(`${esc(p.name)} <span class="muted">· ${esc(p.activity)}</span>`);
        else {
          const o = g.world.objectAtTile(hv.x, hv.y);
          if (o) this.showTip(esc(ITEMS[o.type].name) + (o.level > 1 ? ` <span class="muted">Lv ${o.level}</span>` : ''));
          else this.showTip(null);
        }
        break;
      }
      case 'place': {
        const def = ITEMS[this.item!];
        const f = footprint(def, this.rot);
        const x = hv.x - Math.floor((f.w - 1) / 2), y = hv.y - Math.floor((f.h - 1) / 2);
        const can = g.world.canPlace(def, x, y, this.rot);
        const unlocked = g.isUnlocked(def);
        const cost = def.cost + can.treeCost;
        const ok = can.ok && unlocked.ok && g.canAfford(cost);
        this.setHighlight(x, y, x + f.w - 1, y + f.h - 1, ok);
        const key = modelKeyFor({ id: 0, type: def.id, x, y, rot: this.rot, level: 1 });
        if (this.ghostKey !== key) {
          this.removeGhost();
          this.ghost = ObjectRenderer.ghost(key);
          this.ghostKey = key;
          this.view.r.scene.add(this.ghost);
        }
        if (this.ghost) {
          const cx = (x + f.w / 2) * TILE, cz = (y + f.h / 2) * TILE;
          let hs = 0, hn = 0;
          for (let j = 0; j <= f.h; j++) for (let i = 0; i <= f.w; i++) {
            hs += g.world.h((x + i) * 2, (y + j) * 2);
            hn++;
          }
          this.ghost.position.set(cx, hs / hn + 0.05, cz);
          this.ghost.rotation.y = (this.rot * Math.PI) / 2;
          const mat = (this.ghost.children[0] as THREE.Mesh)?.material as THREE.MeshStandardMaterial;
          if (mat) {
            mat.color.set(ok ? 0x88ffaa : 0xff7766);
            mat.emissive.set(ok ? 0x2a8a4a : 0x8a2a1a);
          }
        }
        let reason = can.reason ?? unlocked.reason ?? (!g.canAfford(cost) ? 'Not enough money' : '');
        if (def.kind === 'bay' && ok) reason = '';
        const facing = def.kind === 'bay' ? ` <span class="muted">· hits ${['north', 'west', 'south', 'east'][this.rot]}</span>` : '';
        this.showTip(`<b>${esc(def.name)}</b> <span class="cost">${money(cost)}</span>${facing}${reason ? `<br><span class="bad">${esc(reason)}</span>` : ''}<br><span class="muted">R to rotate · Esc to cancel</span>`);
        break;
      }
      case 'paint': {
        const tiles = this.brushTiles(hv.x, hv.y);
        const cost = g.paintCost(tiles, this.surf);
        const xs = tiles.map((t) => t.x), ys = tiles.map((t) => t.y);
        this.setHighlight(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), g.canAfford(cost) && g.world.isOwnedTile(hv.x, hv.y));
        const owned = g.world.isOwnedTile(hv.x, hv.y);
        this.showTip(`<b>${SURF_NAMES[this.surf]}</b> <span class="cost">${money(SURF_COST[this.surf] ?? 0)}/tile</span>${cost ? ` · ${money(cost)}` : ''}${owned ? '' : '<br><span class="bad">You do not own this land</span>'}<br><span class="muted">[ ] brush size · ${this.brush}×${this.brush}</span>`);
        break;
      }
      case 'tree': {
        const tiles = this.brushTiles(hv.x, hv.y);
        const xs = tiles.map((t) => t.x), ys = tiles.map((t) => t.y);
        this.setHighlight(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), g.world.isOwnedTile(hv.x, hv.y));
        const def = ITEMS[this.treeType];
        this.showTip(`<b>${esc(def.name)}</b> <span class="cost">${money(def.cost)}</span> each`);
        break;
      }
      case 'bulldoze': {
        const tiles = this.brushTiles(hv.x, hv.y, Math.min(this.brush, 5));
        const xs = tiles.map((t) => t.x), ys = tiles.map((t) => t.y);
        this.setHighlight(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), false);
        const o = g.world.objectAtTile(hv.x, hv.y);
        const t = g.world.treeAtTile(hv.x, hv.y);
        this.showTip(o ? `Remove <b>${esc(ITEMS[o.type].name)}</b> <span class="pos">(refund ${money(Math.round(ITEMS[o.type].cost * 0.4))})</span>` : t ? `Clear tree <span class="cost">${money(t.nat ? 60 : 20)}</span>` : 'Bulldoze');
        break;
      }
      case 'terraform': {
        const tiles = this.brushTiles(hv.x, hv.y);
        const xs = tiles.map((t) => t.x), ys = tiles.map((t) => t.y);
        this.setHighlight(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), g.world.isOwnedTile(hv.x, hv.y));
        this.showTip(`<b>${this.terra[0].toUpperCase() + this.terra.slice(1)} land</b> <span class="cost">$15</span> per dab · height ${g.world.heightAt(hv.wx, hv.wz).toFixed(1)}m<br><span class="muted">Hold to apply · [ ] brush size</span>`);
        break;
      }
      case 'land': {
        const px = Math.floor(hv.x / PARCEL), py = Math.floor(hv.y / PARCEL);
        if (px < 0 || py < 0 || px >= PARCELS || py >= PARCELS) break;
        const owned = g.world.owned[py * PARCELS + px] === 1;
        const can = g.world.canBuyParcel(px, py);
        this.setHighlight(px * PARCEL, py * PARCEL, px * PARCEL + PARCEL - 1, py * PARCEL + PARCEL - 1, can);
        if (owned) this.showTip('You own this land');
        else this.showTip(can ? `Buy this land for <span class="cost">${money(g.world.parcelPrice(px, py))}</span>` : '<span class="bad">Only land next to yours is for sale</span>');
        break;
      }
      case 'hole': {
        const s = g.world.surfAtTile(hv.x, hv.y);
        this.setHighlight(hv.x, hv.y, hv.x, hv.y, true);
        if (this.editHole) {
          const need = this.editHole.which === 'tee' ? Surf.Tee : Surf.Green;
          this.showTip(`Move ${this.editHole.which} here${s !== need ? `<br><span class="bad">Must be on a ${SURF_NAMES[need]}</span>` : ''}`);
          break;
        }
        if (!this.holeTee) {
          this.showTip(s === Surf.Tee ? 'Click to place the <b>tee markers</b>' : '<b>Step 1:</b> click a <b>Tee Box</b> tile<br><span class="muted">Paint one with the Course tab first</span>');
        } else {
          const tx = (this.holeTee.x + 0.5) * TILE, tz = (this.holeTee.y + 0.5) * TILE;
          const px = (hv.x + 0.5) * TILE, pz = (hv.y + 0.5) * TILE;
          const yds = Math.round(Math.hypot(px - tx, pz - tz) * YARDS_PER_WORLD);
          const pos = this.holeLine.geometry.getAttribute('position') as THREE.BufferAttribute;
          pos.setXYZ(0, tx, g.world.heightAt(tx, tz) + 1, tz);
          pos.setXYZ(1, px, g.world.heightAt(px, pz) + 1, pz);
          pos.needsUpdate = true;
          this.holeLine.computeLineDistances();
          this.holeLine.visible = true;
          this.showTip(`<b>Step 2:</b> click a <b>Green</b> tile for the pin<br>${yds} yds straight line · about par ${parFor(yds)}${s !== Surf.Green ? '<br><span class="bad">The pin must be on a Green</span>' : ''}`);
        }
        break;
      }
    }
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    this.lastPaintTile = null;
    this.placedThisDrag.clear();
    if (!this.hover) return;
    if (this.kind === 'terraform') {
      this.flattenH = this.game.world.heightAt(this.hover.wx, this.hover.wz);
      this.terraT = 0;
    }
    if (this.kind === 'paint' || this.kind === 'tree' || this.kind === 'bulldoze' || this.kind === 'place') this.dragAction(true);
  }

  private onUp(e: PointerEvent): void {
    if (e.button !== 0 || !this.down) return;
    const click = !this.down.moved;
    this.down = null;
    if (!this.hover) return;
    if (click) this.clickAction();
  }

  private dragAction(first = false): void {
    const hv = this.hover;
    if (!hv) return;
    const g = this.game;
    if (this.kind === 'paint') {
      // interpolate from the previous tile so fast strokes have no gaps
      const from = this.lastPaintTile ?? { x: hv.x, y: hv.y };
      const n = Math.max(Math.abs(hv.x - from.x), Math.abs(hv.y - from.y));
      const tiles = new Map<number, { x: number; y: number }>();
      for (let i = 0; i <= n; i++) {
        const cx = Math.round(from.x + ((hv.x - from.x) * i) / Math.max(1, n));
        const cy = Math.round(from.y + ((hv.y - from.y) * i) / Math.max(1, n));
        for (const t of this.brushTiles(cx, cy)) tiles.set(tileIndex(t.x, t.y), t);
      }
      this.lastPaintTile = { x: hv.x, y: hv.y };
      const r = g.paint(Array.from(tiles.values()), this.surf);
      if (r.ok) this.host.sfx('paint');
      else if (first && r.reason === 'Not enough money') this.host.toast('Not enough money', 'bad');
    } else if (this.kind === 'tree') {
      if (!first && this.lastPaintTile && this.lastPaintTile.x === hv.x && this.lastPaintTile.y === hv.y) return;
      this.lastPaintTile = { x: hv.x, y: hv.y };
      const tiles = this.brushTiles(hv.x, hv.y);
      let placed = 0;
      for (const t of tiles) {
        if (tiles.length > 1 && Math.random() > this.treeDensity) continue;
        const wx = (t.x + 0.5 + (Math.random() - 0.5) * 0.6) * TILE;
        const wz = (t.y + 0.5 + (Math.random() - 0.5) * 0.6) * TILE;
        const r = g.placeTree(this.treeType, wx, wz);
        if (r.ok) placed++;
        else if (r.reason === 'Not enough money') break;
      }
      if (placed) this.host.sfx('build');
    } else if (this.kind === 'bulldoze') {
      if (!first && this.lastPaintTile && this.lastPaintTile.x === hv.x && this.lastPaintTile.y === hv.y) return;
      this.lastPaintTile = { x: hv.x, y: hv.y };
      for (const t of this.brushTiles(hv.x, hv.y, Math.min(this.brush, 5))) {
        if (g.world.objectAtTile(t.x, t.y) || g.world.treeAtTile(t.x, t.y)) {
          const r = g.bulldoze(t.x, t.y);
          if (!r.ok && first && r.reason) this.host.toast(r.reason, 'bad');
        }
      }
    } else if (this.kind === 'place' && this.item) {
      const def = ITEMS[this.item];
      // drag-to-repeat for small items (bays, hedges, benches, lamps...)
      if (def.w * def.h > 2 && !first) return;
      const f = footprint(def, this.rot);
      const x = hv.x - Math.floor((f.w - 1) / 2), y = hv.y - Math.floor((f.h - 1) / 2);
      const key = `${x},${y}`;
      if (this.placedThisDrag.has(key)) return;
      if (!first && !this.down?.moved) return;
      if (!g.world.canPlace(def, x, y, this.rot).ok) {
        if (first) {
          const r = g.placeItem(this.item, x, y, this.rot);
          if (!r.ok && r.reason) this.host.toast(r.reason, 'bad');
          this.placedThisDrag.add(key);
        }
        return;
      }
      this.placedThisDrag.add(key);
      const r = g.placeItem(this.item, x, y, this.rot);
      if (!r.ok && r.reason) this.host.toast(r.reason, 'bad');
      this.refreshHover();
    }
  }

  private clickAction(): void {
    const hv = this.hover!;
    const g = this.game;
    switch (this.kind) {
      case 'select': {
        const p = this.view.pickPerson(this.mouse.x, this.mouse.y);
        if (p) {
          this.host.inspectPerson(p.id);
          return;
        }
        const o = g.world.objectAtTile(hv.x, hv.y);
        if (o) {
          this.host.inspectObject(o.id);
          return;
        }
        // holes: clicking near a pin or tee
        for (const h of g.course.holes) {
          if (Math.hypot(h.pinWorld.x - hv.wx, h.pinWorld.z - hv.wz) < 6 || Math.hypot(h.teeWorld.x - hv.wx, h.teeWorld.z - hv.wz) < 6) {
            this.host.inspectHole(h.save.id);
            return;
          }
        }
        break;
      }
      case 'land': {
        const px = Math.floor(hv.x / PARCEL), py = Math.floor(hv.y / PARCEL);
        if (!g.world.canBuyParcel(px, py)) {
          if (g.world.owned[py * PARCELS + px] !== 1) this.host.toast('You can only buy land next to land you already own', 'bad');
          return;
        }
        const price = g.world.parcelPrice(px, py);
        this.host.confirm('Buy land', `Buy this ${PARCEL * TILE}m × ${PARCEL * TILE}m parcel for <b>${money(price)}</b>?`, 'Buy land', () => {
          const r = g.buyParcel(px, py);
          if (!r.ok) this.host.toast(r.reason ?? 'Cannot buy', 'bad');
          else this.host.toast('Land purchased', 'good');
        });
        break;
      }
      case 'hole': {
        const s = g.world.surfAtTile(hv.x, hv.y);
        if (this.editHole) {
          const need = this.editHole.which === 'tee' ? Surf.Tee : Surf.Green;
          if (s !== need) {
            this.host.toast(`Must be on a ${SURF_NAMES[need]}`, 'bad');
            return;
          }
          if (this.editHole.which === 'tee') g.course.setTee(this.editHole.id, { x: hv.x, y: hv.y });
          else g.course.setPin(this.editHole.id, { x: hv.x, y: hv.y });
          g.course.update();
          g.state.holes = g.course.saves();
          const id = this.editHole.id;
          this.setTool('select');
          this.host.inspectHole(id);
          return;
        }
        if (!this.holeTee) {
          if (s !== Surf.Tee) {
            this.host.toast('Click on a Tee Box tile (paint one first)', 'bad');
            return;
          }
          this.holeTee = { x: hv.x, y: hv.y };
          this.host.sfx('click');
        } else {
          if (s !== Surf.Green) {
            this.host.toast('The pin must go on a Green tile', 'bad');
            return;
          }
          const r = g.createHole(this.holeTee, { x: hv.x, y: hv.y });
          if (!r.ok) this.host.toast(r.reason ?? 'Cannot create hole', 'bad');
          this.holeTee = null;
          this.holeLine.visible = false;
          const h = g.course.holes[g.course.holes.length - 1];
          if (r.ok && h) this.host.inspectHole(h.save.id);
        }
        break;
      }
    }
  }

  update(dt: number): void {
    if (this.kind === 'terraform' && this.down && this.hover) {
      this.terraT -= dt;
      if (this.terraT <= 0) {
        this.terraT = 0.09;
        const r = this.game.terraform(this.hover.wx, this.hover.wz, this.brush * TILE * 0.55, this.terra, this.flattenH);
        if (!r.ok && r.reason) {
          this.host.toast(r.reason, 'bad');
          this.down = null;
        }
      }
    }
    // keep the ghost/tooltip in sync while the camera moves
    if (this.kind !== 'select' && !this.view.cam.isDragging() && this.mouse.x) {
      const hv = this.view.pickTile(this.mouse.x, this.mouse.y);
      if (hv && (!this.hover || hv.x !== this.hover.x || hv.y !== this.hover.y)) {
        this.hover = hv;
        this.refreshHover();
      }
    }
  }
}

export { MAP };
