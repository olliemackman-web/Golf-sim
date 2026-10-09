// Main in-game interface: top bar, goals, build dock, palettes, inspector, toasts and windows.
import { PARCEL, PARCELS, SURF_NAMES, Surf, TILE } from '../core/constants';
import type { AppApi } from '../app';
import { CHAPTERS } from '../data/goals';
import { ITEMS, ITEM_LIST, ItemDef, PAINT_TOOLS, SURF_COST, itemModel } from '../data/items';
import { STAFF_ROLES, staffWage, trainCost } from '../data/staff';
import { VISITOR_TYPES } from '../data/visitors';
import { CARPARK_SLOTS } from '../data/layout';
import type { NotifyKind } from '../sim/Game';
import type { Person } from '../sim/agents';
import { bar, delegate, el, esc, money, starsHtml } from './dom';
import { crest, icon } from './icons';
import { Minimap } from './Minimap';
import { openPanel, PanelId } from './panels';
import { thumbnail } from './Thumbs';
import { TerraMode, ToolHost } from './Tools';
import { terrainUniforms } from '../render/TerrainRenderer';

type Category = 'range' | 'course' | 'buildings' | 'scenery' | 'trees' | 'landscape' | 'land' | 'bulldoze' | null;

const SURF_SWATCH: Record<number, string> = {
  [Surf.Fairway]: 'linear-gradient(135deg,#79b84b 0 50%,#6aa840 50% 100%)',
  [Surf.Green]: 'repeating-linear-gradient(45deg,#8ccd5e 0 8px,#7fc152 8px 16px)',
  [Surf.Tee]: 'repeating-linear-gradient(0deg,#7cbd50 0 7px,#70b046 7px 14px)',
  [Surf.Bunker]: 'radial-gradient(circle at 40% 40%,#f3e6bd,#d9c48f)',
  [Surf.Water]: 'linear-gradient(180deg,#5aa7c9,#1f5f7a)',
  [Surf.Path]: 'linear-gradient(180deg,#b9b5aa,#8d897e)',
  [Surf.Paving]: 'repeating-linear-gradient(0deg,#d8cdb4 0 9px,#a99d84 9px 10px)',
  [Surf.Rough]: 'radial-gradient(circle at 40% 40%,#68973f,#4b7a2e)',
  [Surf.DeepRough]: 'radial-gradient(circle at 40% 40%,#9b9b52,#5f6f2c)',
};

export class UI implements ToolHost {
  root: HTMLDivElement;
  private top: HTMLDivElement;
  private goalsEl: HTMLDivElement;
  private dockWrap: HTMLDivElement;
  private dock: HTMLDivElement;
  private palette: HTMLDivElement;
  private mgmt: HTMLDivElement;
  private toasts: HTMLDivElement;
  private inspector: HTMLDivElement;
  private overlay: HTMLDivElement;
  minimap: Minimap;
  cat: Category = null;
  private inspecting: { kind: 'object' | 'person' | 'hole'; id: number } | null = null;
  private refreshT = 0;
  private goalsKey = '';
  private openWindow: { id: PanelId; refresh: () => void; close: () => void } | null = null;
  private holeLabels = new Map<number, HTMLDivElement>();
  private parcelLabels: HTMLDivElement[] = [];
  private goalsMin = false;

  constructor(private app: AppApi) {
    const game = app.game;
    this.root = el('div', 'ui');
    app.view.container.appendChild(this.root);
    this.overlay = el('div', 'fx-layer');
    this.root.appendChild(this.overlay);

    // ---------------------------------------------------- top bar
    this.top = el('div', 'topbar');
    this.top.innerHTML = `
      <div class="crest glass"><div class="badge">${crest()}</div><div style="min-width:0"><div class="name" data-k="club"></div><div class="sub" data-k="chapter"></div></div></div>
      <div class="stats glass">
        <div class="stat clickable" data-act="panel" data-arg="finance"><span class="k">Balance</span><span class="v money" data-k="money"></span></div>
        <div class="stat"><span class="k" data-k="date"></span><span class="v" data-k="time"></span></div>
        <div class="stat hide-sm"><span class="k">Weather</span><span class="v" data-k="weather"></span></div>
        <div class="stat clickable" data-act="panel" data-arg="visitors"><span class="k">Reputation</span><span class="v" data-k="rep"></span></div>
        <div class="stat clickable hide-sm" data-act="panel" data-arg="visitors"><span class="k">On site</span><span class="v" data-k="guests"></span></div>
      </div>
      <div class="spacer"></div>
      <div class="speed glass">
        <button data-act="speed" data-arg="0" title="Pause (Space)">${icon('pause')}</button>
        <button data-act="speed" data-arg="1" title="Normal speed (1)">1×</button>
        <button data-act="speed" data-arg="2" title="Fast (2)">2×</button>
        <button data-act="speed" data-arg="4" title="Faster (3)">4×</button>
        <button data-act="speed" data-arg="8" title="Fastest (4)">8×</button>
        <button data-act="panel" data-arg="menu" title="Menu (Esc)">${icon('menu')}</button>
      </div>`;
    this.root.appendChild(this.top);
    delegate(this.top, (act, arg) => this.action(act, arg));

    // ---------------------------------------------------- goals
    this.goalsEl = el('div', 'goals glass');
    this.root.appendChild(this.goalsEl);
    delegate(this.goalsEl, (act) => {
      if (act === 'goalsmin') {
        this.goalsMin = !this.goalsMin;
        this.goalsEl.classList.toggle('min', this.goalsMin);
        this.goalsKey = '';
      }
    });

    // ---------------------------------------------------- dock + palette
    this.dockWrap = el('div', 'dock-wrap');
    this.palette = el('div', 'palette glass');
    this.palette.hidden = true;
    this.dock = el('div', 'dock glass');
    const cats: [Category, string, string][] = [
      ['range', 'range', 'Range'], ['course', 'course', 'Course'], ['buildings', 'building', 'Build'], ['scenery', 'scenery', 'Decor'],
      ['trees', 'tree', 'Trees'], ['landscape', 'landscape', 'Terrain'], ['land', 'land', 'Land'], ['bulldoze', 'bulldoze', 'Remove'],
    ];
    this.dock.innerHTML = cats.map(([c, ic, label]) => `<button data-act="cat" data-arg="${c}" title="${label}">${icon(ic)}<span>${label}</span></button>`).join('') +
      `<div class="sep"></div><button class="play" data-act="panel" data-arg="golfer" title="Have a go yourself">${icon('golfer')}<span>Have a Go</span></button>`;
    this.dockWrap.append(this.palette, this.dock);
    this.root.appendChild(this.dockWrap);
    delegate(this.dock, (act, arg) => this.action(act, arg));
    delegate(this.palette, (act, arg) => this.action(act, arg));

    // ---------------------------------------------------- management
    this.mgmt = el('div', 'mgmt glass');
    const mg: [PanelId, string, string][] = [
      ['finance', 'finance', 'Finances'], ['visitors', 'visitors', 'Visitors'], ['staff', 'staff', 'Staff'], ['research', 'research', 'Research'],
      ['marketing', 'marketing', 'Marketing'], ['prices', 'prices', 'Prices'], ['holes', 'hole', 'Holes'], ['tournaments', 'trophy', 'Tournaments'],
    ];
    this.mgmt.innerHTML = mg.map(([id, ic, label]) => `<button data-act="panel" data-arg="${id}">${icon(ic)}<span class="tip">${label}</span></button>`).join('');
    this.root.appendChild(this.mgmt);
    delegate(this.mgmt, (act, arg) => this.action(act, arg));

    // ---------------------------------------------------- toasts, inspector, minimap
    this.toasts = el('div', 'toasts');
    this.root.appendChild(this.toasts);
    this.inspector = el('div', 'inspector glass');
    this.inspector.hidden = true;
    this.root.appendChild(this.inspector);
    delegate(this.inspector, (act, arg) => this.inspectorAction(act, arg));
    this.minimap = new Minimap(game, app.view);
    this.root.appendChild(this.minimap.root);

    // game events
    game.events.on('notify', (n) => this.toast(n.text, n.kind, n.x !== undefined ? { x: n.x, z: n.z! } : undefined));
    game.events.on('chapter', (c) => this.chapterSplash(c.num));
    game.events.on('victory', () => this.victory());
    game.events.on('day', (d) => {
      const inc = Object.values(d.record.income).reduce((a, b) => a + (b ?? 0), 0);
      const exp = Object.values(d.record.expense).reduce((a, b) => a + (b ?? 0), 0);
      this.toast(`Day ${d.day} closed: ${d.record.visitors} visitors · income ${money(inc)} · profit <b class="${inc - exp >= 0 ? 'pos' : 'neg'}">${money(inc - exp)}</b>`, inc - exp >= 0 ? 'good' : 'bad');
    });
    game.events.on('tournamentEnd', (t) => openPanel(this.app, this, 'tournamentResult', t));

    window.addEventListener('keydown', (e) => this.onKey(e));
    this.refresh(true);
  }

  // ---------------------------------------------------------------- ToolHost
  inspectObject(id: number): void {
    this.inspecting = { kind: 'object', id };
    this.renderInspector();
  }
  inspectPerson(id: number): void {
    this.inspecting = { kind: 'person', id };
    this.renderInspector();
  }
  inspectHole(id: number): void {
    this.inspecting = { kind: 'hole', id };
    this.renderInspector();
  }
  onToolChanged(): void {
    this.renderPalette();
  }
  sfx(name: string): void {
    this.app.sfx(name);
  }

  confirm(title: string, body: string, ok: string, cb: () => void, danger = false): void {
    const back = el('div', 'modal-back');
    back.innerHTML = `<div class="window narrow"><div class="whead"><div class="wic">${icon('info')}</div><h2>${esc(title)}</h2></div>
      <div class="wbody"><p style="margin:0 0 16px;line-height:1.5">${body}</p><div class="flex" style="justify-content:flex-end">
      <button class="btn" data-act="no">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-act="yes">${esc(ok)}</button></div></div></div>`;
    this.root.appendChild(back);
    const close = () => back.remove();
    delegate(back, (act) => {
      if (act === 'yes') cb();
      close();
      this.app.sfx('click');
    });
    back.addEventListener('pointerdown', (e) => {
      if (e.target === back) close();
    });
  }

  toast(text: string, kind: NotifyKind | 'info' | 'good' | 'bad' = 'info', at?: { x: number; z: number }): void {
    const ic = kind === 'good' ? 'check' : kind === 'bad' ? 'warn' : kind === 'goal' ? 'trophy' : kind === 'money' ? 'coin' : 'info';
    const t = el('div', `toast glass ${kind}`, `<div class="ic">${icon(ic)}</div><div>${text}</div>`);
    if (at) t.title = 'Click to view';
    t.addEventListener('click', () => {
      if (at) this.app.view.cam.setView(at.x, at.z, 90);
      t.remove();
    });
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 5) this.toasts.firstElementChild?.remove();
    const life = kind === 'goal' ? 9000 : kind === 'bad' ? 7000 : 5000;
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 320);
    }, life);
    if (kind === 'goal') this.app.sfx('goal');
    else if (kind === 'bad') this.app.sfx('error', { volume: 0.5 });
    else if (kind === 'good') this.app.sfx('notify', { volume: 0.6 });
  }

  // ---------------------------------------------------------------- actions
  private action(act: string, arg: string): void {
    const app = this.app;
    const game = app.game;
    app.sfx('click');
    switch (act) {
      case 'speed': {
        const s = +arg;
        if (s === 0) game.paused = !game.paused;
        else {
          game.paused = false;
          game.speed = s;
        }
        this.refresh(true);
        break;
      }
      case 'panel':
        this.openPanel(arg as PanelId);
        break;
      case 'cat':
        this.setCategory(this.cat === arg ? null : (arg as Category));
        break;
      case 'item':
        app.tools.setTool('place', { item: arg });
        break;
      case 'paint':
        app.tools.setTool('paint', { surf: +arg as Surf });
        break;
      case 'holetool':
        app.tools.setTool('hole');
        break;
      case 'tree':
        app.tools.setTool('tree', { tree: arg });
        break;
      case 'terra':
        app.tools.terra = arg as TerraMode;
        app.tools.setTool('terraform');
        break;
      case 'brush':
        app.tools.brush = +arg;
        this.renderPalette();
        break;
      case 'shape':
        app.tools.circle = arg === 'circle';
        this.renderPalette();
        break;
      case 'rotate':
        app.tools.rot = (app.tools.rot + 1) % 4;
        app.tools.refreshHover();
        break;
      case 'density':
        app.tools.treeDensity = +arg;
        this.renderPalette();
        break;
      case 'overlay':
        terrainUniforms.uOverlay.value = terrainUniforms.uOverlay.value > 0.5 ? 0 : 1;
        this.renderPalette();
        break;
      case 'closepal':
        this.setCategory(null);
        break;
    }
  }

  setCategory(c: Category): void {
    this.cat = c;
    const t = this.app.tools;
    if (c === 'land') t.setTool('land');
    else if (c === 'bulldoze') t.setTool('bulldoze');
    else if (c === 'landscape') t.setTool('terraform');
    else if (c === null) t.setTool('select');
    else if (t.kind !== 'select') t.setTool('select');
    for (const b of Array.from(this.dock.querySelectorAll('button[data-act="cat"]'))) b.classList.toggle('on', (b as HTMLElement).dataset.arg === c);
    this.renderPalette();
  }

  openPanel(id: PanelId): void {
    this.openWindow?.close();
    this.openWindow = openPanel(this.app, this, id);
    for (const b of Array.from(this.mgmt.querySelectorAll('button'))) b.classList.toggle('on', (b as HTMLElement).dataset.arg === id);
  }

  panelClosed(): void {
    this.openWindow = null;
    for (const b of Array.from(this.mgmt.querySelectorAll('button'))) b.classList.remove('on');
  }

  // ---------------------------------------------------------------- palette
  private itemCard(def: ItemDef, active: boolean): string {
    const g = this.app.game;
    const u = g.isUnlocked(def);
    const max = def.max && g.world.objectsOfType(def.id).length >= def.max;
    const locked = !u.ok || !!max;
    const thumbId = `th-${def.id}`;
    return `<button class="card ${active ? 'on' : ''} ${locked ? 'locked' : ''}" ${locked ? '' : `data-act="${def.kind === 'tree' ? 'tree' : 'item'}" data-arg="${def.id}"`} title="${esc(def.desc + (u.reason ? ' — ' + u.reason : max ? ' — Maximum built' : ''))}">
      <div class="thumb" id="${thumbId}" data-model="${itemModel(def)}">${locked ? `<div class="lock">${icon('lock')}</div>` : ''}</div>
      <div class="meta"><div class="nm">${esc(def.name)}</div><div class="pr">${locked ? `<span class="muted" style="font-size:10.5px">${esc(u.reason ?? 'Max built')}</span>` : money(def.cost)}</div></div></button>`;
  }

  private brushOpts(sizes = [1, 2, 3, 5, 7, 9]): string {
    const t = this.app.tools;
    return `<span class="label">Brush</span><div class="seg">${sizes.map((s) => `<button class="${t.brush === s ? 'on' : ''}" data-act="brush" data-arg="${s}">${s}</button>`).join('')}</div>
      <div class="seg"><button class="${!t.circle ? 'on' : ''}" data-act="shape" data-arg="square">Square</button><button class="${t.circle ? 'on' : ''}" data-act="shape" data-arg="circle">Round</button></div>`;
  }

  renderPalette(): void {
    const c = this.cat;
    const p = this.palette;
    if (!c) {
      p.hidden = true;
      return;
    }
    p.hidden = false;
    const t = this.app.tools;
    const g = this.app.game;
    let title = '';
    let items = '';
    let opts = '';
    switch (c) {
      case 'range':
        title = 'Driving Range';
        items = ITEM_LIST.filter((d) => d.cat === 'range' && !d.hidden).map((d) => this.itemCard(d, t.kind === 'place' && t.item === d.id)).join('');
        opts = t.kind === 'place' ? `<button class="btn small" data-act="rotate">${icon('rotate')} Rotate (R)</button><span class="muted">Bays hit balls away from their back bench. Drag to place a row.</span>` : '<span class="muted">Build bays facing open land you own. Balls landing off your property are lost.</span>';
        break;
      case 'course': {
        title = 'Course Design';
        items = PAINT_TOOLS.map((pt) => {
          const u = g.isUnlocked({ chapter: pt.chapter });
          const on = t.kind === 'paint' && t.surf === pt.surf;
          return `<button class="card ${on ? 'on' : ''}" data-act="paint" data-arg="${pt.surf}" title="${esc(pt.desc)}"><div class="thumb"><div class="swatch" style="background:${SURF_SWATCH[pt.surf]}"></div></div>
            <div class="meta"><div class="nm">${esc(pt.name)}</div><div class="pr">${money(SURF_COST[pt.surf] ?? 0)}<span class="muted" style="font-size:10px">/tile</span></div></div></button>` + (u.ok ? '' : '');
        }).join('');
        items = `<button class="card ${t.kind === 'hole' ? 'on' : ''}" data-act="holetool" title="Place a tee and a pin to create a hole"><div class="thumb" style="color:var(--brass-2)">${icon('hole', '')}</div><div class="meta"><div class="nm">New Hole</div><div class="pr">$500</div></div></button>` + items;
        items += ITEM_LIST.filter((d) => d.cat === 'course' && !d.hidden).map((d) => this.itemCard(d, t.kind === 'place' && t.item === d.id)).join('');
        if (t.kind === 'paint') opts = this.brushOpts() + `<button class="btn small" data-act="overlay">${icon('eye')} ${terrainUniforms.uOverlay.value > 0.5 ? 'Hide' : 'Show'} turf condition</button>`;
        else if (t.kind === 'hole') opts = '<span class="muted">Click a <b>Tee Box</b> tile, then a <b>Green</b> tile. Par is set by the length.</span>';
        else opts = '<span class="muted">Paint a tee box, fairway and green, then use <b>New Hole</b> to place the tee markers and pin.</span>';
        break;
      }
      case 'buildings':
        title = 'Buildings';
        items = ITEM_LIST.filter((d) => d.cat === 'buildings' && !d.hidden).map((d) => this.itemCard(d, t.kind === 'place' && t.item === d.id)).join('');
        opts = t.kind === 'place' ? `<button class="btn small" data-act="rotate">${icon('rotate')} Rotate (R)</button><span class="muted">Entrances face the arrow side. Visitors walk to the front door.</span>` : '';
        break;
      case 'scenery':
        title = 'Decoration';
        items = ITEM_LIST.filter((d) => d.cat === 'scenery' && !d.hidden).map((d) => this.itemCard(d, t.kind === 'place' && t.item === d.id)).join('');
        opts = '<span class="muted">Scenery raises visitor happiness and hole ratings nearby. Drag to place rows of small items.</span>';
        break;
      case 'trees':
        title = 'Trees';
        items = ITEM_LIST.filter((d) => d.cat === 'trees').map((d) => this.itemCard(d, t.kind === 'tree' && t.treeType === d.id)).join('');
        if (t.kind === 'tree') opts = this.brushOpts([1, 3, 5, 7]) + `<span class="label">Density</span><div class="seg">${[0.15, 0.35, 0.6].map((d, i) => `<button class="${Math.abs(t.treeDensity - d) < 0.01 ? 'on' : ''}" data-act="density" data-arg="${d}">${['Sparse', 'Medium', 'Dense'][i]}</button>`).join('')}</div>`;
        break;
      case 'landscape': {
        title = 'Terrain';
        const modes: [TerraMode, string, string][] = [['raise', 'raise', 'Raise'], ['lower', 'lower', 'Lower'], ['flatten', 'flatten', 'Flatten'], ['smooth', 'smooth', 'Smooth']];
        items = modes.map(([m, ic, n]) => `<button class="card ${t.kind === 'terraform' && t.terra === m ? 'on' : ''}" data-act="terra" data-arg="${m}"><div class="thumb" style="color:var(--brass-2)">${icon(ic)}</div><div class="meta"><div class="nm">${n}</div><div class="pr">$15 per dab</div></div></button>`).join('');
        opts = this.brushOpts([2, 3, 5, 7, 9]) + '<span class="muted">Hold the mouse to shape the land. Water levels follow the terrain.</span>';
        break;
      }
      case 'land': {
        title = 'Buy Land';
        const owned = g.world.ownedCount();
        items = '';
        opts = `<span class="muted">You own <b>${owned}</b> of ${PARCELS * PARCELS} parcels. Click a highlighted parcel next to your land to buy it. Prices rise with every purchase.</span>`;
        break;
      }
      case 'bulldoze':
        title = 'Remove';
        items = '';
        opts = this.brushOpts([1, 2, 3, 5]) + '<span class="muted">Remove buildings (40% refund), items and trees. Paint Rough to erase course surfaces.</span>';
        break;
    }
    p.innerHTML = `<div class="ptitle"><h4>${title}</h4><button class="close" data-act="closepal" title="Close">${icon('close')}</button></div>
      ${items ? `<div class="items">${items}</div>` : ''}${opts ? `<div class="toolopts">${opts}</div>` : ''}`;
    // thumbnails
    for (const th of Array.from(p.querySelectorAll('.thumb[data-model]'))) {
      const key = (th as HTMLElement).dataset.model!;
      thumbnail(key, (url) => {
        if (!url || !th.isConnected) return;
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        th.prepend(img);
      });
    }
  }

  // ---------------------------------------------------------------- inspector
  private renderInspector(): void {
    const ins = this.inspecting;
    const g = this.app.game;
    if (!ins) {
      this.inspector.hidden = true;
      return;
    }
    let html = '';
    if (ins.kind === 'object') {
      const o = g.world.objects.get(ins.id);
      if (!o) {
        this.inspecting = null;
        this.inspector.hidden = true;
        return;
      }
      const def = ITEMS[o.type];
      const up = def.upgrades?.[o.level - 1];
      const upkeep = o.level > 1 && def.upgrades ? def.upgrades[o.level - 2].upkeep : def.upkeep;
      const rows: [string, string][] = [];
      if (def.upgrades) rows.push(['Level', `${o.level} / ${def.upgrades.length + 1}${o.level > 1 ? ' · ' + esc(def.upgrades[o.level - 2].name) : ''}`]);
      rows.push(['Upkeep', `${money(upkeep)} / day`]);
      if (def.kind === 'bay') {
        const user = g.sim.bayUser.get(o.id);
        rows.push(['Status', user ? 'In use' : 'Free']);
        rows.push(['Bucket price', money(g.bucketPrice(def.tier ?? 1), true)]);
        rows.push(['Hits towards', ['North', 'West', 'South', 'East'][o.rot]]);
      }
      if (def.kind === 'dispenser') {
        rows.push(['Balls available', Math.max(0, g.sim.ballsAvailable()).toLocaleString()]);
        rows.push(['Balls on the range', (g.sim.field.n * 5).toLocaleString()]);
      }
      if (def.kind === 'carpark') {
        const s = g.sim.slotsFor(o);
        rows.push(['Spaces used', `${s.filter((v) => v).length} / ${CARPARK_SLOTS.length}`]);
      }
      if (def.capacity && def.enterable) rows.push(['Inside', `${g.sim.occupancy.get(o.id) ?? 0} / ${(def.capacity ?? 0) * (o.level || 1)}`]);
      if (def.spend) rows.push(['Typical spend', money(def.spend * g.state.prices.food * (o.level > 1 ? 1.25 : 1), true)]);
      html = `<div class="head"><div><div class="label">${esc(def.cat)}</div><h3>${esc(def.name)}</h3></div><button class="close" data-act="close">${icon('close')}</button></div>
        <p class="muted" style="font-size:12.5px;line-height:1.45;margin:8px 0 0">${esc(def.desc)}</p>
        <div class="rows">${rows.map(([k, v]) => `<div class="row"><span>${k}</span><span class="num">${v}</span></div>`).join('')}</div>
        ${up ? `<div class="tile" style="margin-top:12px"><div class="label">Upgrade available</div><h4 style="margin-top:4px">${esc(up.name)}</h4><p>${esc(up.desc)}</p>
          <div class="tfoot"><span class="muted">Upkeep ${money(up.upkeep)}/day</span><button class="btn small primary" data-act="upgrade" data-arg="${o.id}" ${g.isUnlocked(up).ok ? '' : 'disabled'}>${icon('up')} ${g.isUnlocked(up).ok ? money(up.cost) : esc(g.isUnlocked(up).reason ?? '')}</button></div></div>` : ''}
        <div class="actions">
          ${def.kind === 'bay' ? `<button class="btn small primary" data-act="practice" data-arg="${o.id}">${icon('golfer')} Practise here</button>` : ''}
          ${def.w === def.h && !def.fixed && def.place !== 'roadside' ? `<button class="btn small" data-act="rotateobj" data-arg="${o.id}">${icon('rotate')} Rotate</button>` : ''}
          ${def.fixed ? '' : `<button class="btn small danger" data-act="remove" data-arg="${o.id}">${icon('trash')} Remove (+${money(Math.round(def.cost * 0.4))})</button>`}
        </div>`;
    } else if (ins.kind === 'person') {
      const p = g.sim.people.find((x) => x.id === ins.id);
      if (!p || p.removed) {
        this.inspecting = null;
        this.inspector.hidden = true;
        return;
      }
      html = this.personHtml(p);
    } else {
      const h = g.course.byId(ins.id);
      if (!h) {
        this.inspecting = null;
        this.inspector.hidden = true;
        return;
      }
      const avg = h.roundsPlayed ? (h.totalStrokes / h.roundsPlayed).toFixed(2) : '—';
      html = `<div class="head"><div><div class="label">Hole ${h.num}</div><h3>${h.valid ? `Par ${h.par} · ${h.yards} yds` : 'Not playable'}</h3></div><button class="close" data-act="close">${icon('close')}</button></div>
        <div class="rows">
          <div class="row"><span>Hole rating</span><span class="num"><b>${h.rating.toFixed(0)}</b> / 100</span></div>
          ${bar(h.rating / 100, 'brass')}
          <div class="row"><span>Design</span><span class="num">${h.design.toFixed(0)}</span></div>
          <div class="row"><span>Scenery</span><span class="num">${h.beauty.toFixed(0)}</span></div>
          <div class="row"><span>Turf condition</span><span class="num">${h.condition.toFixed(0)}%</span></div>
          <div class="row"><span>Difficulty</span><span>${difficultyLabel(h.difficulty)}</span></div>
          <div class="row"><span>Groups played</span><span class="num">${h.roundsPlayed}</span></div>
          <div class="row"><span>Scoring average</span><span class="num">${avg}</span></div>
          ${h.save.record ? `<div class="row"><span>Course record</span><span>${h.save.record.strokes} by ${esc(h.save.record.by)}</span></div>` : ''}
        </div>
        ${h.issues.length ? `<div class="thoughts">${h.issues.map((i) => `<div class="thought ${h.valid ? '' : 'bad'}" style="${h.valid ? 'border-left-color:var(--amber)' : ''}">${esc(i)}</div>`).join('')}</div>` : ''}
        <div class="actions">
          ${h.valid ? `<button class="btn small primary" data-act="playhole" data-arg="${h.save.id}">${icon('golfer')} Play this hole</button>` : ''}
          <button class="btn small" data-act="movetee" data-arg="${h.save.id}">${icon('tee')} Move tee</button>
          <button class="btn small" data-act="movepin" data-arg="${h.save.id}">${icon('flag')} Move pin</button>
          <button class="btn small danger" data-act="delhole" data-arg="${h.save.id}">${icon('trash')} Delete</button>
        </div>`;
    }
    this.inspector.innerHTML = html;
    this.inspector.hidden = false;
  }

  private personHtml(p: Person): string {
    const g = this.app.game;
    if (p.kind === 'staff') {
      const s = g.state.staff.find((x) => x.id === p.staffId);
      const role = p.role ? STAFF_ROLES[p.role] : null;
      return `<div class="head"><div><div class="label">${esc(role?.name ?? 'Staff')}</div><h3>${esc(p.name)}</h3></div><button class="close" data-act="close">${icon('close')}</button></div>
        <div class="rows"><div class="row"><span>Doing</span><span>${esc(p.activity)}</span></div>
        <div class="row"><span>Level</span><span>${s?.level ?? 1} / 5</span></div>
        <div class="row"><span>Wage</span><span>${s ? money(staffWage(s.role, s.level)) : '-'} / day</span></div></div>
        <div class="actions">${s && s.level < 5 ? `<button class="btn small primary" data-act="train" data-arg="${s.id}">${icon('up')} Train ${money(trainCost(s.level))}</button>` : ''}
        <button class="btn small" data-act="follow" data-arg="${p.id}">${icon('camera')} Follow</button>
        ${s ? `<button class="btn small danger" data-act="fire" data-arg="${s.id}">Dismiss</button>` : ''}</div>`;
    }
    const vt = VISITOR_TYPES[p.vtype];
    const mood = p.happiness >= 80 ? 'Delighted' : p.happiness >= 65 ? 'Happy' : p.happiness >= 45 ? 'Content' : p.happiness >= 30 ? 'Unhappy' : 'Furious';
    return `<div class="head"><div><div class="label">${p.kind === 'tourpro' ? 'Tour Professional' : esc(vt.name)}${p.member ? ' · Member' : ''}</div><h3>${esc(p.name)}</h3></div><button class="close" data-act="close">${icon('close')}</button></div>
      <div class="rows">
        <div class="row"><span>Mood</span><span>${mood}</span></div>${bar(p.happiness / 100, p.happiness < 40 ? 'red' : '')}
        <div class="row"><span>Doing</span><span style="text-align:right">${esc(p.activity)}</span></div>
        <div class="row"><span>Handicap</span><span class="num">${Math.max(0, Math.round((1 - p.skill) * 36))}</span></div>
        <div class="row"><span>Cash</span><span class="num">${money(p.cash)}</span></div>
        <div class="row"><span>Spent here</span><span class="num">${money(p.spent)}</span></div>
        <div class="row"><span>Hunger · Thirst</span><span class="num">${Math.round(p.hunger)}% · ${Math.round(p.thirst)}%</span></div>
      </div>
      <div class="thoughts">${p.thoughts.length ? p.thoughts.map((t) => `<div class="thought ${t.good ? '' : 'bad'}">“${esc(t.text)}”</div>`).join('') : '<div class="muted" style="font-size:12px">No thoughts yet.</div>'}</div>
      <div class="actions"><button class="btn small" data-act="follow" data-arg="${p.id}">${icon('camera')} Follow</button></div>`;
  }

  private following = 0;

  private inspectorAction(act: string, arg: string): void {
    const g = this.app.game;
    const id = +arg;
    this.app.sfx('click');
    switch (act) {
      case 'close':
        this.inspecting = null;
        this.following = 0;
        this.inspector.hidden = true;
        return;
      case 'upgrade': {
        const r = g.upgradeObject(id);
        if (!r.ok) this.toast(r.reason ?? 'Cannot upgrade', 'bad');
        break;
      }
      case 'remove': {
        const o = g.world.objects.get(id);
        if (!o) return;
        this.confirm('Remove building', `Remove the <b>${esc(ITEMS[o.type].name)}</b>? You get 40% of its price back.`, 'Remove', () => {
          g.bulldoze(o.x, o.y);
          this.inspecting = null;
          this.inspector.hidden = true;
        }, true);
        return;
      }
      case 'rotateobj': {
        const r = g.rotateObject(id);
        if (!r.ok && r.reason) this.toast(r.reason, 'bad');
        break;
      }
      case 'practice':
        this.app.startPlay({ mode: 'range', bayId: id, challenge: 'free' });
        return;
      case 'train': {
        const r = g.train(id);
        if (!r.ok) this.toast(r.reason ?? 'Cannot train', 'bad');
        break;
      }
      case 'fire': {
        const s = g.state.staff.find((x) => x.id === id);
        if (!s) return;
        this.confirm('Dismiss staff', `Let <b>${esc(s.name)}</b> go?`, 'Dismiss', () => {
          g.fire(id);
          this.inspecting = null;
          this.inspector.hidden = true;
        }, true);
        return;
      }
      case 'follow':
        this.following = this.following === id ? 0 : id;
        break;
      case 'playhole':
        this.app.startPlay({ mode: 'course', holes: [id] });
        return;
      case 'movetee':
        this.setCategory(null);
        this.app.tools.setTool('hole', { editHole: { id, which: 'tee' } });
        this.toast('Click a Tee Box tile for the new tee position', 'info');
        break;
      case 'movepin':
        this.setCategory(null);
        this.app.tools.setTool('hole', { editHole: { id, which: 'pin' } });
        this.toast('Click a Green tile for the new pin position', 'info');
        break;
      case 'delhole':
        this.confirm('Delete hole', 'Delete this hole? Later holes will be renumbered.', 'Delete', () => {
          g.course.removeHole(id);
          g.course.update();
          g.state.holes = g.course.saves();
          this.inspecting = null;
          this.inspector.hidden = true;
        }, true);
        return;
    }
    this.renderInspector();
  }

  // ---------------------------------------------------------------- goals / splash
  private renderGoals(): void {
    const g = this.app.game;
    const st = g.state;
    if (st.sandbox) {
      this.goalsEl.innerHTML = `<div class="chap"><span class="label">Sandbox</span></div><h3>Free Play</h3><div class="intro">Unlimited money, everything unlocked. Build the course of your dreams.</div>`;
      return;
    }
    const ch = CHAPTERS[Math.min(st.chapter, CHAPTERS.length) - 1];
    if (!ch) return;
    const done = st.chapter > CHAPTERS.length;
    const statuses = ch.goals.map((goal) => ({ goal, s: st.goalsDone.includes(goal.id) ? { done: true, frac: 1, text: 'Done' } : goal.check(g) }));
    const key = JSON.stringify([st.chapter, this.goalsMin, statuses.map((x) => [x.s.done, x.s.text])]);
    if (key === this.goalsKey) return;
    this.goalsKey = key;
    this.goalsEl.innerHTML = `<div class="chap"><span class="label">Chapter ${ch.num} of ${CHAPTERS.length}</span><button class="collapse" data-act="goalsmin" title="Collapse">${this.goalsMin ? '▾' : '▴'}</button></div>
      <h3>${done ? 'Career complete' : esc(ch.title)}</h3>
      <div class="intro">${esc(ch.intro)}</div>
      <ul>${statuses.map(({ goal, s }) => `<li class="${s.done ? 'done' : ''}"><span class="tick">${s.done ? icon('check') : ''}</span><div><div class="gname">${esc(goal.name)}</div>${s.done ? '' : `<div class="prog">${bar(s.frac)}<span class="num">${esc(s.text)}</span></div>`}</div></li>`).join('')}</ul>
      <div class="reward" style="margin-top:10px">Chapter reward: ${money(ch.reward)}</div>`;
  }

  private chapterSplash(num: number): void {
    const ch = CHAPTERS[num - 1];
    if (!ch) return;
    const back = el('div', 'modal-back');
    back.innerHTML = `<div class="window narrow" style="text-align:center"><div class="wbody" style="padding:28px 26px">
      <div style="width:72px;height:72px;margin:0 auto 6px">${crest()}</div>
      <div class="label">Chapter ${num} unlocked</div>
      <h2 class="serif" style="font-size:38px;margin:6px 0 10px">${esc(ch.title)}</h2>
      <p style="line-height:1.55;color:var(--cream-dim)">${esc(ch.intro)}</p>
      <p class="muted" style="font-size:12.5px">New buildings, items and research are now available.</p>
      <button class="btn primary" data-act="ok" style="margin-top:8px;min-width:160px">Let's go</button></div></div>`;
    this.root.appendChild(back);
    delegate(back, () => back.remove());
    this.app.sfx('levelup');
    this.app.view.effects.spawn('confetti', this.app.view.cam.target.x, this.app.view.cam.target.y + 20, this.app.view.cam.target.z, 200);
  }

  private victory(): void {
    const g = this.app.game;
    const back = el('div', 'modal-back');
    back.innerHTML = `<div class="window narrow" style="text-align:center"><div class="wbody" style="padding:30px 26px">
      <div style="width:84px;height:84px;margin:0 auto 6px">${crest()}</div>
      <div class="label">Career complete</div>
      <h2 class="serif" style="font-size:40px;margin:6px 0 10px">Legend of the Links</h2>
      <p style="line-height:1.55;color:var(--cream-dim)">${esc(g.state.clubName)} is now one of the most celebrated golf resorts in the world. You built it from a muddy field in ${g.state.day} days.</p>
      <div class="kpis" style="margin-top:14px"><div class="kpi"><div class="k">Club value</div><div class="v">${money(g.clubValue())}</div></div><div class="kpi"><div class="k">Visitors</div><div class="v">${g.state.stats.totalVisitors.toLocaleString()}</div></div></div>
      <p class="muted" style="font-size:12.5px">Keep playing as long as you like — there is always another tournament to host and another birdie to chase.</p>
      <button class="btn primary" data-act="ok" style="margin-top:8px;min-width:160px">Keep playing</button></div></div>`;
    this.root.appendChild(back);
    delegate(back, () => back.remove());
    this.app.sfx('cheer');
    this.app.view.effects.spawn('confetti', this.app.view.cam.target.x, this.app.view.cam.target.y + 20, this.app.view.cam.target.z, 400);
  }

  // ---------------------------------------------------------------- per-frame
  private onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (this.app.game.frozen) return;
    const g = this.app.game;
    if (e.key === ' ') {
      e.preventDefault();
      g.paused = !g.paused;
      this.refresh(true);
    } else if (e.key >= '1' && e.key <= '4') {
      g.paused = false;
      g.speed = [1, 2, 4, 8][+e.key - 1];
      this.refresh(true);
    } else if (e.key === 'Escape') {
      if (this.app.tools.kind === 'select' && !this.cat && !this.inspecting && !this.openWindow) this.openPanel('menu');
      else if (this.inspecting) {
        this.inspecting = null;
        this.inspector.hidden = true;
      } else if (this.cat) this.setCategory(null);
    } else if (e.key === 'b' || e.key === 'B') this.setCategory(this.cat === 'buildings' ? null : 'buildings');
    else if (e.key === 'c' || e.key === 'C') this.setCategory(this.cat === 'course' ? null : 'course');
    else if (e.key === 'x' || e.key === 'X') this.setCategory(this.cat === 'bulldoze' ? null : 'bulldoze');
    else if (e.key === 'h' || e.key === 'H') this.openPanel('holes');
    else if (e.key === 'f' || e.key === 'F') this.openPanel('finance');
  }

  refresh(force = false): void {
    const g = this.app.game;
    const st = g.state;
    const q = (k: string) => this.top.querySelector(`[data-k="${k}"]`) as HTMLElement;
    q('club').textContent = st.clubName;
    q('chapter').textContent = st.sandbox ? 'Sandbox' : st.chapter > CHAPTERS.length ? 'Career complete' : `Chapter ${st.chapter} · ${CHAPTERS[st.chapter - 1].title}`;
    const m = q('money');
    m.textContent = money(st.money);
    m.style.color = st.money < 0 ? 'var(--red)' : '';
    q('date').textContent = `${g.dayName()} · Day ${st.day} · ${g.seasonName}`;
    q('time').innerHTML = `${g.timeString()}${g.paused ? ' <small>paused</small>' : ''}`;
    const wk = st.weather.kind;
    q('weather').innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:18px;height:18px;display:inline-block">${icon(wk)}</span><small>${st.weather.wind} mph</small></span>`;
    q('rep').innerHTML = `${starsHtml(st.reputation)}`;
    q('guests').textContent = String(g.sim.visitorCount());
    for (const b of Array.from(this.top.querySelectorAll('.speed button[data-act="speed"]'))) {
      const s = +(b as HTMLElement).dataset.arg!;
      b.classList.toggle('on', s === 0 ? g.paused : !g.paused && g.speed === s);
    }
    this.renderGoals();
    if (force) this.renderPalette();
  }

  update(dt: number): void {
    this.refreshT -= dt;
    if (this.refreshT <= 0) {
      this.refreshT = 0.25;
      this.refresh();
      if (this.inspecting && this.inspecting.kind !== 'hole') this.renderInspector();
      this.openWindow?.refresh();
    }
    this.minimap.update(dt);
    if (this.following) {
      const p = this.app.game.sim.people.find((x) => x.id === this.following);
      if (p && !p.removed) this.app.view.cam.setView(p.x, p.z);
      else this.following = 0;
    }
    this.updateLabels();
  }

  private updateLabels(): void {
    const g = this.app.game;
    const v = this.app.view;
    const showHoles = this.cat === 'course' || this.app.tools.kind === 'hole' || this.openWindow?.id === 'holes';
    const seen = new Set<number>();
    if (showHoles) {
      for (const h of g.course.holes) {
        seen.add(h.save.id);
        let lab = this.holeLabels.get(h.save.id);
        if (!lab) {
          lab = el('div', 'hole-label');
          lab.addEventListener('click', () => this.inspectHole(h.save.id));
          this.overlay.appendChild(lab);
          this.holeLabels.set(h.save.id, lab);
        }
        const s = v.worldToScreen(h.teeWorld.x, g.world.heightAt(h.teeWorld.x, h.teeWorld.z) + 4, h.teeWorld.z);
        lab.hidden = !s.visible;
        lab.className = 'hole-label' + (h.valid ? '' : ' bad');
        lab.innerHTML = `<b>${h.num}</b>${h.valid ? `Par ${h.par} · ${h.yards}y` : 'Invalid'}`;
        lab.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      }
    }
    for (const [id, lab] of this.holeLabels) if (!seen.has(id)) {
      lab.remove();
      this.holeLabels.delete(id);
    }
    // parcel prices in land mode
    if (this.app.tools.kind === 'land') {
      let i = 0;
      for (let py = 0; py < PARCELS; py++) for (let px = 0; px < PARCELS; px++) {
        if (!g.world.canBuyParcel(px, py)) continue;
        let lab = this.parcelLabels[i];
        if (!lab) {
          lab = el('div', 'parcel-label');
          this.overlay.appendChild(lab);
          this.parcelLabels[i] = lab;
        }
        i++;
        const cx = (px + 0.5) * PARCEL * TILE, cz = (py + 0.5) * PARCEL * TILE;
        const s = v.worldToScreen(cx, g.world.heightAt(cx, cz) + 2, cz);
        lab.hidden = !s.visible;
        lab.textContent = money(g.world.parcelPrice(px, py));
        lab.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
      }
      for (let k = i; k < this.parcelLabels.length; k++) this.parcelLabels[k].hidden = true;
    } else for (const l of this.parcelLabels) l.hidden = true;
  }

  setVisible(v: boolean): void {
    this.root.hidden = !v;
  }
}

function difficultyLabel(d: number): string {
  return d < 0.25 ? 'Easy' : d < 0.42 ? 'Moderate' : d < 0.6 ? 'Challenging' : d < 0.78 ? 'Hard' : 'Brutal';
}

export { SURF_NAMES };
