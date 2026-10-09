// Dev page for manually testing the procedural audio engine (open /audio-test.html with `npx vite`).
import { audio, type AmbienceParams, type SfxName } from '../audio/Audio';

const GROUPS = {
  UI: ['click', 'hover', 'open', 'close', 'error', 'notify'],
  'Build & economy': ['build', 'bulldoze', 'paint', 'cash', 'goal', 'unlock', 'levelup'],
  Golf: ['swing', 'hit_driver', 'hit_iron', 'hit_wedge', 'putt', 'cup', 'bounce', 'land_sand', 'splash', 'tree_hit', 'range_hit'],
  Crowd: ['applause', 'cheer', 'groan'],
  World: ['car_door', 'car_pass', 'whoosh'],
} as const satisfies Record<string, readonly SfxName[]>;

// Compile-time check that every SfxName has a button.
type Listed = (typeof GROUPS)[keyof typeof GROUPS][number];
const ALL_SFX: SfxName[] = Object.values(GROUPS).flat();
type _Exhaustive = Exclude<SfxName, Listed> extends never ? true : never;
const _exhaustive: _Exhaustive = true;
void _exhaustive;

(window as unknown as { fxAudio: typeof audio; fxSfx: SfxName[] }).fxAudio = audio;
(window as unknown as { fxSfx: SfxName[] }).fxSfx = ALL_SFX;

const app = document.getElementById('app') ?? document.body;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const k of kids) e.append(k);
  return e;
}

function slider(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void): { row: HTMLElement; input: HTMLInputElement } {
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  const out = el('output', { textContent: value.toFixed(2) });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = v.toFixed(2);
    onInput(v);
  });
  return { row: el('div', { className: 'row' }, el('span', { textContent: label }), input, out), input };
}

function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = el('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { className: 'chk' }, input, label);
}

function panel(title: string, ...kids: (Node | string)[]): HTMLElement {
  return el('section', { className: 'panel' }, el('h2', { textContent: title }), ...kids);
}

// ── play options ──
const opts = { volume: 1, pitch: 1, pan: 0, delay: 0, randomPan: false, burst: false, hover: false };

function fire(name: SfxName): void {
  audio.unlock();
  const n = opts.burst ? 10 : 1;
  for (let i = 0; i < n; i++) {
    audio.play(name, {
      volume: opts.volume,
      pitch: opts.pitch,
      pan: opts.randomPan ? Math.random() * 2 - 1 : opts.pan,
      delay: opts.delay + (opts.burst ? i * 0.05 : 0),
    });
  }
}

const status = el('div', { id: 'status', textContent: 'Audio locked: click anything to unlock.' });
app.append(el('h1', { textContent: 'Fairway Empire: audio test bench' }), status);

const grid = el('div', { className: 'grid' });
app.append(grid);

// Sound buttons
for (const [group, names] of Object.entries(GROUPS)) {
  const btns = el('div', { className: 'btns' });
  for (const name of names) {
    const b = el('button', { textContent: name });
    b.addEventListener('click', () => fire(name));
    b.addEventListener('pointerenter', () => { if (opts.hover) audio.play('hover'); });
    btns.append(b);
  }
  grid.append(panel(group, btns));
}

// Play options
grid.append(panel('Play options',
  slider('volume', 0, 2, 0.01, opts.volume, (v) => { opts.volume = v; }).row,
  slider('pitch', 0.5, 2, 0.01, opts.pitch, (v) => { opts.pitch = v; }).row,
  slider('pan', -1, 1, 0.01, opts.pan, (v) => { opts.pan = v; }).row,
  slider('delay', 0, 1, 0.01, opts.delay, (v) => { opts.delay = v; }).row,
  el('div', {},
    checkbox('random pan', false, (v) => { opts.randomPan = v; }),
    checkbox('burst ×10 (rate limit)', false, (v) => { opts.burst = v; }),
    checkbox('hover sounds', false, (v) => { opts.hover = v; })),
));

// Ambience
const amb: AmbienceParams = { daylight: 1, rain: 0, wind: 0, crowd: 0, water: 0 };
const ambInputs: Partial<Record<keyof AmbienceParams, HTMLInputElement>> = {};
const ambPanel = panel('Ambience');
for (const key of Object.keys(amb) as (keyof AmbienceParams)[]) {
  const s = slider(key, 0, 1, 0.01, amb[key], (v) => { amb[key] = v; audio.setAmbience({ [key]: v }); });
  ambInputs[key] = s.input;
  ambPanel.append(s.row);
}
const PRESETS: Record<string, AmbienceParams> = {
  'Sunny day': { daylight: 1, rain: 0, wind: 0.15, crowd: 0, water: 0 },
  Night: { daylight: 0, rain: 0, wind: 0.1, crowd: 0, water: 0 },
  Storm: { daylight: 0.6, rain: 1, wind: 0.9, crowd: 0, water: 0 },
  Tournament: { daylight: 1, rain: 0, wind: 0.2, crowd: 0.9, water: 0 },
  'Pond side': { daylight: 0.8, rain: 0, wind: 0.1, crowd: 0, water: 0.8 },
  Silence: { daylight: 0.5, rain: 0, wind: 0, crowd: 0, water: 0 },
};
const presetBtns = el('div', { className: 'btns' });
for (const [label, p] of Object.entries(PRESETS)) {
  const b = el('button', { textContent: label });
  b.addEventListener('click', () => {
    audio.unlock();
    Object.assign(amb, p);
    audio.setAmbience(p);
    for (const k of Object.keys(p) as (keyof AmbienceParams)[]) {
      const inp = ambInputs[k];
      if (inp) { inp.value = String(p[k]); inp.dispatchEvent(new Event('input')); }
    }
  });
  presetBtns.append(b);
}
ambPanel.append(presetBtns);
grid.append(ambPanel);
audio.setAmbience(amb);

// Mix
const v0 = audio.getVolumes();
grid.append(panel('Mix',
  slider('master', 0, 1, 0.01, v0.master, (v) => audio.setVolumes({ master: v })).row,
  slider('sfx', 0, 1, 0.01, v0.sfx, (v) => audio.setVolumes({ sfx: v })).row,
  slider('ambience', 0, 1, 0.01, v0.ambience, (v) => audio.setVolumes({ ambience: v })).row,
  slider('music', 0, 1, 0.01, v0.music, (v) => audio.setVolumes({ music: v })).row,
  slider('focus', 0, 1, 0.01, 0, (v) => audio.setFocus(v)).row,
  el('div', {},
    checkbox('music', true, (v) => { audio.unlock(); audio.setMusicEnabled(v); }),
    checkbox('paused', false, (v) => audio.setPaused(v))),
));

// Scenarios
type Step = [SfxName, number, { volume?: number; pan?: number; pitch?: number }?];
const SCENARIOS: Record<string, Step[]> = {
  'Drive down the middle': [['swing', 0], ['hit_driver', 0.3], ['bounce', 3.2, { volume: 0.8 }], ['bounce', 3.65, { volume: 0.45 }], ['bounce', 3.95, { volume: 0.25 }], ['applause', 4.2, { volume: 0.6 }]],
  'Holed putt': [['putt', 0], ['cup', 1.6], ['cheer', 1.9]],
  'Into the water': [['swing', 0], ['hit_iron', 0.3], ['splash', 2.6], ['groan', 2.8]],
  'Bunker then tree': [['swing', 0], ['hit_wedge', 0.3], ['tree_hit', 1.2], ['land_sand', 1.9]],
  'Car park': [['car_pass', 0, { pan: -1 }], ['car_door', 2.5, { pan: 0.4 }], ['car_door', 3.1, { pan: 0.5 }]],
  'Shop purchase': [['click', 0], ['open', 0.15], ['build', 0.8], ['cash', 1.0], ['close', 1.6]],
};
const scen = el('div', { className: 'btns' });
for (const [label, steps] of Object.entries(SCENARIOS)) {
  const b = el('button', { textContent: label });
  b.addEventListener('click', () => {
    audio.unlock();
    for (const [name, delay, o] of steps) audio.play(name, { ...o, delay });
  });
  scen.append(b);
}
const busyRange = el('button', { textContent: 'Busy range (8 s)' });
busyRange.addEventListener('click', () => {
  audio.unlock();
  const start = performance.now();
  const id = setInterval(() => {
    if (performance.now() - start > 8000) { clearInterval(id); return; }
    if (Math.random() < 0.5) audio.play('range_hit', { pan: Math.random() * 2 - 1, volume: 0.4 + Math.random() * 0.5 });
  }, 60);
});
const stress = el('button', { textContent: 'Stress: 300 random sounds in 1 s' });
stress.addEventListener('click', () => {
  audio.unlock();
  for (let i = 0; i < 300; i++) {
    audio.play(ALL_SFX[Math.floor(Math.random() * ALL_SFX.length)], { delay: Math.random(), pan: Math.random() * 2 - 1, volume: 0.5 });
  }
});
scen.append(busyRange, stress);
grid.append(panel('Scenarios', scen));

// Status line
setInterval(() => {
  const d = audio.debugInfo();
  status.textContent = `ready=${audio.ready} state=${d.state} t=${d.time.toFixed(1)}s voices=${d.voices} music=${d.music} layers=[${d.layers.join(' ')}]`;
}, 250);
