// Fairway Empire — application bootstrap, title screen and main loop.
import './styles.css';
import * as THREE from 'three';
import { AppApi, PlayConfig, Settings } from './app';
import { audio, SfxName } from './audio/Audio';
import { Surf, TILE } from './core/constants';
import { resetListeners } from './core/listeners';
import { CLUB_NAME_IDEAS } from './data/visitors';
import { buildDemo } from './demo';
import { PlayMode } from './play/PlayMode';
import { View } from './render/View';
import { loadSettings, loadState, saveGame, saveMeta, storeSettings } from './save';
import { Game } from './sim/Game';
import { delegate, el, esc, money } from './ui/dom';
import { crest, icon } from './ui/icons';
import { Tools } from './ui/Tools';
import { UI } from './ui/UI';

const container = document.getElementById('app')!;
const qs = new URLSearchParams(location.search);

const SFX = new Set<string>(['click', 'hover', 'open', 'close', 'build', 'bulldoze', 'paint', 'error', 'cash', 'notify', 'goal', 'unlock', 'levelup', 'swing', 'hit_driver', 'hit_iron', 'hit_wedge', 'putt', 'cup', 'bounce', 'land_sand', 'splash', 'tree_hit', 'range_hit', 'applause', 'cheer', 'groan', 'car_door', 'car_pass', 'whoosh']);

class App implements AppApi {
  game!: Game;
  view!: View;
  tools!: Tools;
  ui: UI | null = null;
  play: PlayMode | null = null;
  settings: Settings = loadSettings();
  private menuEl: HTMLDivElement | null = null;
  private last = performance.now();
  private demo = false;
  private orbit = 0;
  private paintSfxT = 0;

  constructor() {
    const q = qs.get('q');
    if (q === 'low' || q === 'medium' || q === 'high') this.settings.quality = q;
    this.applyAudioSettings();
    window.addEventListener('beforeunload', () => {
      if (!this.demo && this.game && this.settings.autosave) saveGame(this.game, 'slot1');
    });
    document.addEventListener('visibilitychange', () => audio.setPaused(document.hidden));
  }

  // ---------------------------------------------------------------- lifecycle
  private mount(game: Game, demo: boolean): void {
    this.unmount();
    this.game = game;
    this.demo = demo;
    this.view = new View(container, game, this.settings.quality);
    this.tools = new Tools(this.view, game, {
      inspectObject: (id) => this.ui?.inspectObject(id),
      inspectPerson: (id) => this.ui?.inspectPerson(id),
      inspectHole: (id) => this.ui?.inspectHole(id),
      confirm: (t, b, ok, cb) => this.ui?.confirm(t, b, ok, cb),
      toast: (t, k) => this.ui?.toast(t, k),
      onToolChanged: () => this.ui?.onToolChanged(),
      sfx: (n) => this.sfx(n),
    });
    this.hookSounds();
    if (!demo) {
      this.ui = new UI(this);
      game.events.on('autosave', () => {
        if (this.settings.autosave) saveGame(game, 'slot1');
      });
    } else {
      this.view.cam.enabled = false;
      game.speed = 2;
    }
    (window as unknown as Record<string, unknown>).game = game;
    (window as unknown as Record<string, unknown>).view = this.view;
    (window as unknown as Record<string, unknown>).app = this;
  }

  private unmount(): void {
    if (!this.view) return;
    this.play?.exit();
    this.play = null;
    this.ui?.root.remove();
    this.ui = null;
    resetListeners();
    const r = this.view.r.renderer;
    container.innerHTML = '';
    r.dispose();
    r.forceContextLoss();
  }

  private hookSounds(): void {
    const g = this.game;
    const v = this.view;
    const spatial = (x?: number, z?: number): { volume: number; pan: number } | null => {
      if (x === undefined || z === undefined) return { volume: 1, pan: 0 };
      const cam = v.r.camera.position;
      const d = Math.hypot(cam.x - x, cam.z - z);
      if (d > 380) return null;
      const s = v.worldToScreen(x, g.world.heightAt(x, z), z);
      const pan = Math.max(-1, Math.min(1, (s.x / window.innerWidth) * 2 - 1)) * 0.8;
      return { volume: Math.max(0.05, 1 - d / 380) ** 1.5, pan };
    };
    g.events.on('sound', (s) => {
      const sp = spatial(s.x, s.z);
      if (sp) this.sfx(s.name, { volume: sp.volume, pan: sp.pan });
    });
    g.events.on('hit', (h) => {
      const sp = spatial(h.x, h.z);
      if (!sp || this.play) return;
      this.sfx(h.kind === 'driver' ? 'hit_driver' : h.kind === 'putt' ? 'putt' : h.kind === 'wedge' ? 'hit_wedge' : 'hit_iron', { volume: sp.volume * 0.55, pan: sp.pan });
    });
    g.events.on('rangeHit', (h) => {
      const sp = spatial(h.x, h.z);
      if (sp && !this.play) this.sfx('range_hit', { volume: sp.volume * 0.6, pan: sp.pan });
    });
    g.events.on('splash', (s) => {
      const sp = spatial(s.x, s.z);
      if (sp && !this.play) this.sfx('splash', { volume: sp.volume * (s.small ? 0.4 : 0.8), pan: sp.pan });
    });
    g.events.on('cheer', (c) => {
      const sp = spatial(c.x, c.z);
      if (sp && !this.play) this.sfx(c.big ? 'cheer' : 'applause', { volume: sp.volume * (c.big ? 1 : 0.6), pan: sp.pan });
    });
    g.events.on('money', (m) => {
      if (this.demo || this.play || m.amount < 20) return;
      const sp = spatial(m.x, m.z);
      if (sp) this.sfx('cash', { volume: sp.volume * 0.35, pan: sp.pan });
    });
  }

  // ---------------------------------------------------------------- AppApi
  sfx(name: string, opts?: { volume?: number; pitch?: number; pan?: number }): void {
    if (name === 'paint') {
      const now = performance.now();
      if (now - this.paintSfxT < 90) return;
      this.paintSfxT = now;
    }
    if (!SFX.has(name)) return;
    try {
      audio.play(name as SfxName, opts);
    } catch {
      /* audio is optional */
    }
  }

  saveGame(slot: string): boolean {
    if (this.demo) return false;
    return saveGame(this.game, slot);
  }

  loadSlot(slot: string): void {
    const st = loadState(slot);
    if (!st) return;
    this.hideMenu();
    const g = Game.load(st);
    this.mount(g, false);
    this.view.cam.setView(g.sim.entranceSpot().x, g.sim.entranceSpot().z - 70, 170, 0, 0.8, true);
  }

  quitToMenu(): void {
    this.showTitle();
  }

  startPlay(cfg: PlayConfig): void {
    if (this.play || this.demo) return;
    this.ui?.setCategory(null);
    this.tools.setTool('select');
    this.ui?.setVisible(false);
    this.play = new PlayMode(this, cfg, () => {
      this.play = null;
      this.ui?.setVisible(true);
      this.ui?.refresh(true);
    });
    this.play.start();
  }

  applySettings(): void {
    storeSettings(this.settings);
    this.applyAudioSettings();
    if (this.view && this.view.r.quality !== this.settings.quality) this.view.setQuality(this.settings.quality);
  }

  private applyAudioSettings(): void {
    try {
      audio.setVolumes({ master: this.settings.master, sfx: this.settings.sfx, ambience: this.settings.ambience, music: this.settings.music });
      audio.setMusicEnabled(this.settings.musicOn);
    } catch {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------- menus
  showTitle(): void {
    this.mount(buildDemo(), true);
    this.view.cam.setView(392, 530, 175, 0.35, 0.52, true);
    this.renderTitle();
  }

  private hideMenu(): void {
    this.menuEl?.remove();
    this.menuEl = null;
  }

  private renderTitle(): void {
    this.hideMenu();
    const meta = saveMeta('slot1');
    const m = el('div', 'menu-screen');
    m.innerHTML = `<div class="menu-card glass">
      <div class="logo">${crest()}</div>
      <h1>Fairway Empire</h1>
      <div class="tag">Build a driving range into a world-famous golf resort — then play it yourself.</div>
      <div class="btns">
        ${meta ? `<button class="btn primary" data-act="continue">${icon('play')} Continue · ${esc(meta.club)} <span style="opacity:.75;font-weight:600">· Day ${meta.day}</span></button>` : ''}
        <button class="btn ${meta ? '' : 'primary'}" data-act="new">${icon('flag')} New career</button>
        <button class="btn" data-act="sandbox">${icon('sparkle')} Sandbox · unlimited money</button>
        <button class="btn" data-act="help">${icon('info')} How to play</button>
        <button class="btn" data-act="settings">${icon('settings')} Settings</button>
      </div>
      <div class="foot">Your progress is saved in this browser.</div></div>`;
    container.appendChild(m);
    this.menuEl = m;
    delegate(m, (act) => {
      this.sfx('click');
      if (act === 'continue') this.loadSlot('slot1');
      else if (act === 'new') this.newGameDialog(false);
      else if (act === 'sandbox') this.newGameDialog(true);
      else if (act === 'help') this.simpleDialog('How to play', HELP_HTML);
      else if (act === 'settings') this.settingsDialog();
    });
  }

  private simpleDialog(title: string, html: string): void {
    const back = el('div', 'modal-back');
    back.innerHTML = `<div class="window"><div class="whead"><div class="wic">${icon('info')}</div><h2>${esc(title)}</h2><button class="close" data-act="close">${icon('close')}</button></div><div class="wbody">${html}</div></div>`;
    container.appendChild(back);
    delegate(back, () => back.remove());
  }

  private settingsDialog(): void {
    const back = el('div', 'modal-back');
    const s = this.settings;
    const render = () => {
      back.innerHTML = `<div class="window narrow"><div class="whead"><div class="wic">${icon('settings')}</div><h2>Settings</h2><button class="close" data-act="close">${icon('close')}</button></div><div class="wbody">
        <div class="field"><span class="label">Graphics quality</span><div class="seg">${(['low', 'medium', 'high'] as const).map((q) => `<button class="${s.quality === q ? 'on' : ''}" data-act="q" data-arg="${q}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}</div></div>
        ${(['master', 'sfx', 'ambience', 'music'] as const).map((k) => `<div class="field"><label class="label" for="ms-${k}">${{ master: 'Master volume', sfx: 'Sound effects', ambience: 'Ambience', music: 'Music' }[k]}</label><input id="ms-${k}" type="range" min="0" max="1" step="0.05" value="${s[k]}" data-set="${k}"></div>`).join('')}
        <div class="flex"><button class="btn small" data-act="music">${s.musicOn ? 'Music on' : 'Music off'}</button></div></div></div>`;
      for (const inp of Array.from(back.querySelectorAll('input[data-set]')) as HTMLInputElement[]) {
        inp.addEventListener('input', () => {
          (s as unknown as Record<string, number>)[inp.dataset.set!] = +inp.value;
          this.applySettings();
        });
      }
    };
    render();
    container.appendChild(back);
    delegate(back, (act, arg) => {
      this.sfx('click');
      if (act === 'close') back.remove();
      else if (act === 'q') {
        s.quality = arg as Settings['quality'];
        this.applySettings();
        render();
      } else if (act === 'music') {
        s.musicOn = !s.musicOn;
        this.applySettings();
        render();
      }
    });
  }

  private newGameDialog(sandbox: boolean): void {
    const back = el('div', 'modal-back');
    const suggestion = CLUB_NAME_IDEAS[Math.floor(Math.random() * CLUB_NAME_IDEAS.length)];
    back.innerHTML = `<div class="window narrow"><div class="whead"><div class="wic">${icon(sandbox ? 'sparkle' : 'flag')}</div><h2>${sandbox ? 'Sandbox' : 'New career'}</h2><button class="close" data-act="close">${icon('close')}</button></div><div class="wbody">
      <p style="margin-top:0;line-height:1.5;color:var(--cream-dim)">${sandbox ? 'Everything unlocked and $5,000,000 to spend. No goals — just build.' : 'You start with $40,000 and a patch of farmland by the road. Build a driving range, lay out holes, and grow your club through six chapters into a championship resort.'}</p>
      <div class="field"><label class="label" for="ng-club">Club name</label><input type="text" id="ng-club" maxlength="40" value="${esc(suggestion)}"></div>
      <div class="field"><label class="label" for="ng-name">Your name</label><input type="text" id="ng-name" maxlength="24" value="You"></div>
      ${!sandbox && saveMeta('slot1') ? '<p class="muted" style="font-size:12px">Starting a new career replaces your current save.</p>' : ''}
      <div class="flex" style="justify-content:flex-end"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="start">Start</button></div></div></div>`;
    container.appendChild(back);
    (back.querySelector('#ng-club') as HTMLInputElement).focus();
    delegate(back, (act) => {
      this.sfx('click');
      if (act === 'close') back.remove();
      else if (act === 'start') {
        const club = (back.querySelector('#ng-club') as HTMLInputElement).value.trim() || suggestion;
        const name = (back.querySelector('#ng-name') as HTMLInputElement).value.trim() || 'You';
        back.remove();
        this.startNew(club, name, sandbox);
      }
    });
  }

  private startNew(club: string, name: string, sandbox: boolean): void {
    this.hideMenu();
    const g = Game.newGame(club, sandbox);
    g.state.player.name = name;
    this.mount(g, false);
    const e = g.sim.entranceSpot();
    this.view.cam.setView(e.x, e.z - 60, 190, 0, 0.85, true);
    this.view.cam.setView(e.x, e.z - 45, 120, 0, 0.75);
    if (!sandbox) this.welcome();
    saveGame(g, 'slot1');
  }

  private welcome(): void {
    const ui = this.ui!;
    const back = el('div', 'modal-back');
    back.innerHTML = `<div class="window narrow"><div class="wbody" style="padding:26px">
      <div style="width:64px;height:64px">${crest()}</div>
      <h2 class="serif" style="font-size:32px;margin:8px 0 6px">Welcome to ${esc(this.game.state.clubName)}</h2>
      <p style="line-height:1.55;color:var(--cream-dim)">The land is yours, the bank balance is ${money(this.game.state.money)}, and the locals want somewhere to hit balls. Here's how to get started:</p>
      <ol style="line-height:1.7;padding-left:20px;margin:6px 0 14px">
        <li>Open <b>Range</b> in the bottom bar and place four <b>Grass Tee Bays</b> in a row. They hit towards the open field (rotate with <span class="kbd">R</span>).</li>
        <li>Add a <b>Ball Dispenser</b> nearby, then hire a <b>Range Assistant</b> from Staff.</li>
        <li>Press <span class="kbd">2</span> or <span class="kbd">4</span> to speed up time and watch the visitors arrive.</li>
        <li>Click <b>Have a Go</b> any time to step up and hit balls yourself.</li>
      </ol>
      <p class="muted" style="font-size:12.5px">Follow the chapter goals on the left to unlock holes, buildings and tournaments.</p>
      <div class="flex" style="justify-content:flex-end"><button class="btn primary" data-act="ok">Let's build</button></div></div></div>`;
    ui.root.appendChild(back);
    delegate(back, () => {
      back.remove();
      ui.setCategory('range');
    });
  }

  // ---------------------------------------------------------------- loop
  frame(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.view) return;
    const g = this.game;
    g.update(dt);
    if (this.demo) {
      this.orbit += dt * 0.025;
      const c = this.view.cam;
      c.setView(392 + Math.cos(this.orbit) * 45, 530 + Math.sin(this.orbit * 0.7) * 35, 175, 0.35 + Math.sin(this.orbit * 0.5) * 0.45, 0.52);
    }
    this.tools?.update(dt);
    this.play?.update(dt);
    this.ui?.update(dt);
    this.view.frame(dt);
    this.ambience(dt);
  }

  private ambT = 0;
  private ambience(dt: number): void {
    this.ambT -= dt;
    if (this.ambT > 0) return;
    this.ambT = 0.25;
    const g = this.game;
    const v = this.view;
    const t = v.externalCamera ? v.r.camera.position : v.cam.target;
    const near = (x: number, z: number) => Math.hypot(x - t.x, z - t.z);
    let crowd = 0;
    for (const p of g.sim.people) if (p.visible && near(p.x, p.z) < 60) crowd++;
    let water = 0;
    const tx = Math.floor(t.x / TILE), tz = Math.floor(t.z / TILE);
    for (let dy = -6; dy <= 6; dy += 2) for (let dx = -6; dx <= 6; dx += 2) if (g.world.surfAtTile(tx + dx, tz + dy) === Surf.Water) water++;
    if (g.world.objectsOfType('fountain').some((o) => near(g.world.objectCenter(o).x, g.world.objectCenter(o).z) < 40)) water += 10;
    const zoomFade = v.externalCamera ? 1 : Math.max(0.25, 1 - v.cam.dist / 600);
    try {
      audio.setAmbience({
        daylight: g.daylight(),
        rain: g.weatherRain() ? (g.state.weather.kind === 'storm' ? 1 : 0.6) : 0,
        wind: Math.min(1, g.state.weather.wind / 25) * 0.7 + (v.externalCamera ? 0 : (v.cam.dist / 520) * 0.3),
        crowd: Math.min(1, (crowd / 30) * zoomFade + (g.tournament ? 0.5 : 0)),
        water: Math.min(1, (water / 20) * zoomFade),
      });
      audio.setFocus(this.play ? 0.6 : 0);
    } catch {
      /* ignore */
    }
  }
}

const HELP_HTML = `<div class="grid2">
  <div class="tile"><h4>Build your range</h4><p>Place hitting bays facing open land you own and a ball dispenser. Visitors buy buckets and hit balls; Range Assistants collect them.</p></div>
  <div class="tile"><h4>Design holes</h4><p>Paint a tee box, fairway and green with the Course tools, then place the tee and pin with New Hole. Ratings improve with bunkers, water, trees and good turf.</p></div>
  <div class="tile"><h4>Run the club</h4><p>Hire staff, set prices, research upgrades, run marketing and keep visitors happy with food, restrooms and scenery.</p></div>
  <div class="tile"><h4>Grow</h4><p>Buy land, upgrade the clubhouse, attract members and host tournaments on your way to a five-star resort.</p></div>
  <div class="tile"><h4>Have a go</h4><p>Play your own range and course: click to start the swing meter, click for power, and click on the line for accuracy. Win challenge prizes and level up your golfer.</p></div>
  <div class="tile"><h4>Controls</h4><p>WASD / arrows move the camera, Q/E rotate, mouse wheel zooms, right-drag orbits. Space pauses, 1–4 change speed.</p></div>
</div>`;

const app = new App();
if (qs.get('autostart') === 'new') {
  (app as unknown as { startNew(c: string, n: string, s: boolean): void }).startNew('Willow Creek Golf Club', 'You', qs.get('sandbox') === '1');
} else app.showTitle();
const loop = (now: number) => {
  try {
    app.frame(now);
  } catch (e) {
    console.error(e);
  }
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
void THREE;
