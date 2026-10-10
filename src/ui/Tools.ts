// Build tools: placing items, painting surfaces, trees, holes, bulldozing, terraforming and buying land.
import { listen } from '../core/listeners';
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
import { input } from './touch';

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
  /** Touch screens: show tool info and buttons in a bar above the dock (null hides it). */
  touchBar(html: string | null): void;
}

const STROKE_TOOLS: ToolKind[] = ['paint', 'tree', 'bulldoze', 'terraform'];

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
  // touch: strokes wait a moment so a two-finger camera gesture never paints
  private touches = new Set<number>();
  private multiTouch = false;
  private pending: { t: number } | null = null;
  private downHover: { x: number; y: number; wx: number; wz: number } | null = null;

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
    listen(this.canvas, 'pointermove', (e) => this.onMove(e));
    listen(this.canvas, 'pointerdown', (e) => this.onDown(e));
    listen(window, 'pointerup', (e) => this.onUp(e));
    listen(window, 'pointercancel', (e) => {
      if (e.pointerType !== 'touch') return;
      this.touches.delete(e.pointerId);
      if (!this.touches.size) this.multiTouch = false;
      this.down = null;
      this.pending = null;
    });
    listen(this.canvas, 'pointerleave', (e) => {
      if (e.pointerType === 'touch') return; // keep the ghost where the finger left it
      this.tip.hidden = true;
      this.hover = null;
      this.clearHighlight();
    });
    listen(window, 'keydown', (e) => this.onKey(e));
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
    if (input.touch) this.hover = null;
    this.view.cam.leftPans = kind === 'select';
    this.view.cam.touchPans = !STROKE_TOOLS.includes(kind);
    terrainUniforms.uGrid.value = kind === 'select' ? 0 : 1;
    terrainUniforms.uOwnership.value = kind === 'land' ? 1 : kind === 'select' ? 0.35 : 0.7;
    this.clearHighlight();
    this.host.onToolChanged();
    this.updateTouchBar(null);
  }

  private isStroke(): boolean {
    return STROKE_TOOLS.includes(this.kind);
  }

  /** Buttons in the touch bar. */
  touchAction(act: string): void {
    if (act === 'rotate' && this.kind === 'place') {
      this.rot = (this.rot + 1) % 4;
      this.removeGhost();
      this.refreshHover();
    } else if (act === 'place') this.placeAtHover();
    else if (act === 'canceltee') this.cancel();
    else if (act === 'done') this.setTool('select');
    this.host.sfx('click');
  }

  /** Touch: place the item under the ghost, then move the ghost along so repeated taps build a row. */
  private placeAtHover(): void {
    const hv = this.hover;
    if (!hv || this.kind !== 'place' || !this.item) return;
    const def = ITEMS[this.item];
    const f = footprint(def, this.rot);
    const x = hv.x - Math.floor((f.w - 1) / 2), y = hv.y - Math.floor((f.h - 1) / 2);
    const r = this.game.placeItem(this.item, x, y, this.rot);
    if (!r.ok) {
      if (r.reason) this.host.toast(r.reason, 'bad');
      return;
    }
    if (def.w * def.h <= 2) {
      const nx = this.rot % 2 === 0 ? hv.x + f.w : hv.x, ny = this.rot % 2 === 0 ? hv.y : hv.y + f.h;
      if (inMap(nx, ny)) this.hover = { x: nx, y: ny, wx: (nx + 0.5) * TILE, wz: (ny + 0.5) * TILE };
    }
    this.refreshHover();
  }

  /** What the touch bar says before the player has tapped the map. */
  private touchIdle(): string | null {
    switch (this.kind) {
      case 'place':
        return this.item ? `<b>${esc(ITEMS[this.item].name)}</b> <span class="cost">${money(ITEMS[this.item].cost)}</span><br><span class="muted">Tap the map to position it</span>` : null;
      case 'paint':
        return `<b>${SURF_NAMES[this.surf]}</b> <span class="cost">${money(SURF_COST[this.surf] ?? 0)}/tile</span><br><span class="muted">Drag one finger to paint · two fingers move the camera</span>`;
      case 'tree':
        return `<b>${esc(ITEMS[this.treeType].name)}</b> <span class="cost">${money(ITEMS[this.treeType].cost)}</span> each<br><span class="muted">Tap or drag one finger to plant · two fingers move the camera</span>`;
      case 'bulldoze':
        return '<b>Remove</b><br><span class="muted">Tap or drag one finger to remove · two fingers move the camera</span>';
      case 'terraform':
        return `<b>${this.terra[0].toUpperCase() + this.terra.slice(1)} land</b> <span class="cost">$15</span> per dab<br><span class="muted">Hold one finger to shape · two fingers move the camera</span>`;
      case 'land':
        return '<b>Buy land</b><br><span class="muted">Tap a highlighted parcel next to your land</span>';
      case 'hole':
        return this.editHole ? `Tap a <b>${this.editHole.which === 'tee' ? 'Tee Box' : 'Green'}</b> tile for the new ${this.editHole.which}` : '<b>Step 1:</b> tap a <b>Tee Box</b> tile<br><span class="muted">Paint one with the Course tools first</span>';
      default:
        return null;
    }
  }

  private updateTouchBar(info: string | null): void {
    if (!input.touch || this.kind === 'select') {
      this.host.touchBar(null);
      return;
    }
    const html = info ?? this.touchIdle();
    let btns = '';
    if (this.kind === 'place') {
      btns = `<button class="btn small" data-act="tt" data-arg="rotate">Rotate</button>`;
      if (this.hover) btns += `<button class="btn small primary" data-act="tt" data-arg="place" ${this.placeOk ? '' : 'disabled'}>Place</button>`;
    } else if (this.kind === 'hole' && this.holeTee) btns = '<button class="btn small" data-act="tt" data-arg="canceltee">Undo tee</button>';
    this.host.touchBar(html || btns ? `<div class="tb-info">${html ?? ''}</div>${btns ? `<div class="tb-btns">${btns}</div>` : ''}` : null);
  }
  private placeOk = false;

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
    if (input.touch) {
      this.tip.hidden = true;
      this.updateTouchBar(html);
      return;
    }
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
    if (e.pointerType === 'touch') {
      if (this.multiTouch || !this.down) return;
      this.mouse = { x: e.clientX, y: e.clientY };
      if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 8) this.down.moved = true;
      if (!this.isStroke()) return; // one-finger drags pan the camera
      this.hover = this.view.pickTile(e.clientX, e.clientY);
      if (this.pending) {
        if (this.down.moved) this.beginStroke();
        return;
      }
      this.refreshHover();
      this.dragAction();
      return;
    }
    if (input.touch && e.pointerType === 'mouse') {
      // a mouse on a touch laptop: switch hints back
      input.touch = false;
      document.body.classList.remove('touch');
      this.host.touchBar(null);
    }
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
    this.placeOk = false;
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
        this.placeOk = ok;
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
        this.showTip(`<b>${esc(def.name)}</b> <span class="cost">${money(cost)}</span>${facing}${reason ? `<br><span class="bad">${esc(reason)}</span>` : ''}<span class="kb-only"><br><span class="muted">R to rotate · Esc to cancel</span></span>`);
        break;
      }
      case 'paint': {
        const tiles = this.brushTiles(hv.x, hv.y);
        const cost = g.paintCost(tiles, this.surf);
        const xs = tiles.map((t) => t.x), ys = tiles.map((t) => t.y);
        this.setHighlight(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), g.canAfford(cost) && g.world.isOwnedTile(hv.x, hv.y));
        const owned = g.world.isOwnedTile(hv.x, hv.y);
        this.showTip(`<b>${SURF_NAMES[this.surf]}</b> <span class="cost">${money(SURF_COST[this.surf] ?? 0)}/tile</span>${cost ? ` · ${money(cost)}` : ''}${owned ? '' : '<br><span class="bad">You do not own this land</span>'}<span class="kb-only"><br><span class="muted">[ ] brush size · ${this.brush}×${this.brush}</span></span>`);
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
        this.showTip(`<b>${this.terra[0].toUpperCase() + this.terra.slice(1)} land</b> <span class="cost">$15</span> per dab · height ${g.world.heightAt(hv.wx, hv.wz).toFixed(1)}m<span class="kb-only"><br><span class="muted">Hold to apply · [ ] brush size</span></span>`);
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
          this.showTip(s === Surf.Tee ? `${input.touch ? 'Tap' : 'Click'} to place the <b>tee markers</b>` : `<b>Step 1:</b> ${input.touch ? 'tap' : 'click'} a <b>Tee Box</b> tile<br><span class="muted">Paint one with the Course tools first</span>`);
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
          this.showTip(`<b>Step 2:</b> ${input.touch ? 'tap' : 'click'} a <b>Green</b> tile for the pin<br>${yds} yds straight line · about par ${parFor(yds)}${s !== Surf.Green ? '<br><span class="bad">The pin must be on a Green</span>' : ''}`);
        }
        break;
      }
    }
  }

  private onDown(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      this.touches.add(e.pointerId);
      if (this.touches.size > 1) {
        // a second finger: this is a camera gesture, so drop whatever the first finger started
        this.multiTouch = true;
        this.down = null;
        this.pending = null;
        return;
      }
      this.multiTouch = false;
      this.mouse = { x: e.clientX, y: e.clientY };
      this.down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      this.downHover = this.view.pickTile(e.clientX, e.clientY);
      this.lastPaintTile = null;
      this.placedThisDrag.clear();
      if (this.isStroke() && this.downHover) {
        this.hover = this.downHover;
        this.pending = { t: performance.now() };
        this.refreshHover();
      }
      return;
    }
    if (e.button !== 0) return;
    this.mouse = { x: e.clientX, y: e.clientY };
    this.hover = this.view.pickTile(e.clientX, e.clientY) ?? this.hover;
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

  /** Touch: the finger stayed down long enough (or moved) without a second finger joining, so start painting. */
  private beginStroke(): void {
    this.pending = null;
    if (!this.down || !this.downHover) return;
    const cur = this.hover;
    this.hover = this.downHover;
    if (this.kind === 'terraform') {
      this.flattenH = this.game.world.heightAt(this.downHover.wx, this.downHover.wz);
      this.terraT = 0;
    } else {
      this.dragAction(true);
      if (cur && (cur.x !== this.downHover.x || cur.y !== this.downHover.y)) {
        this.hover = cur;
        this.dragAction();
      }
    }
    this.hover = cur ?? this.downHover;
    this.refreshHover();
  }

  private onTouchUp(e: PointerEvent): void {
    if (!this.touches.delete(e.pointerId)) return;
    if (this.multiTouch) {
      if (!this.touches.size) this.multiTouch = false;
      this.down = null;
      return;
    }
    if (!this.down) return;
    const tap = !this.down.moved;
    this.down = null;
    if (!tap) {
      this.pending = null;
      return;
    }
    this.hover = this.downHover;
    if (!this.hover) return;
    if (this.pending) {
      // a quick tap with a painting tool: one dab
      this.pending = null;
      if (this.kind === 'terraform') {
        const h = this.hover;
        const r = this.game.terraform(h.wx, h.wz, this.brush * TILE * 0.55, this.terra, this.game.world.heightAt(h.wx, h.wz));
        if (!r.ok && r.reason) this.host.toast(r.reason, 'bad');
      } else this.dragAction(true);
      this.refreshHover();
      return;
    }
    this.refreshHover();
    if (this.kind !== 'place') this.clickAction();
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      this.onTouchUp(e);
      return;
    }
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
    if (this.pending && this.down && !this.multiTouch && performance.now() - this.pending.t > 140) this.beginStroke();
    if (this.kind === 'terraform' && this.down && this.hover && !this.pending) {
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
    if (!input.touch && this.kind !== 'select' && !this.view.cam.isDragging() && this.mouse.x) {
      const hv = this.view.pickTile(this.mouse.x, this.mouse.y);
      if (hv && (!this.hover || hv.x !== this.hover.x || hv.y !== this.hover.y)) {
        this.hover = hv;
        this.refreshHover();
      }
    }
  }
}

export { MAP };
