/**
 * Fairway Empire — procedural audio engine.
 *
 * There are no audio assets: every sound is synthesised at runtime with the Web Audio API
 * (oscillators, filtered noise, envelopes, a generated convolution reverb), plus a handful of
 * small textures that are pre-rendered once in plain JS (applause, rain drops, water trickle,
 * crowd babble) and then looped / re-used cheaply.
 *
 * Graph:
 *   sfx voices ──┐   bus.dry ─────────────────────────┐
 *   ambience  ───┼─▶                                   ├─▶ master ─▶ HP ─▶ compressor ─▶ limiter ─▶ out
 *   music     ───┘   bus.wet ─▶ HP ─▶ convolver ─▶ ────┘
 *
 * Every public method is wrapped so that it never throws; if Web Audio is missing or blocked the
 * engine silently becomes a no-op.
 */

export type SfxName =
  | 'click' | 'hover' | 'open' | 'close'          // UI
  | 'build' | 'bulldoze' | 'paint' | 'error' | 'cash' | 'notify' | 'goal' | 'unlock' | 'levelup'
  | 'swing'            // club whoosh
  | 'hit_driver' | 'hit_iron' | 'hit_wedge' | 'putt' // ball strikes
  | 'cup'              // ball dropping in the cup (rattle)
  | 'bounce' | 'land_sand' | 'splash' | 'tree_hit'
  | 'range_hit'        // distant soft strike from other golfers on the range
  | 'applause' | 'cheer' | 'groan'
  | 'car_door' | 'car_pass'
  | 'whoosh';          // camera / transitions

export interface PlayOpts { volume?: number; pitch?: number; pan?: number; /* -1..1 */ delay?: number; }

export interface AmbienceParams {
  daylight: number;   // 0 night .. 1 day (birdsong by day, crickets at night)
  rain: number;       // 0..1
  wind: number;       // 0..1
  crowd: number;      // 0..1 (murmur of a tournament crowd / busy club)
  water: number;      // 0..1 (nearby pond/fountain trickle)
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Small helpers
// ───────────────────────────────────────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const rint = (a: number, b: number): number => Math.floor(rnd(a, b + 1));
function pick<T>(a: readonly T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Percussive envelope: 0 → peak (linear, `a` s) → ~0 (exponential, `d` s). */
function perc(p: AudioParam, t: number, peak: number, a: number, d: number): void {
  const pk = Math.max(peak, 1e-4);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(pk, t + a);
  p.exponentialRampToValueAtTime(pk * 1e-3, t + a + d);
  p.linearRampToValueAtTime(0, t + a + d + 0.004);
}

/** Attack / hold / smooth release envelope. */
function swell(p: AudioParam, t: number, a: number, peak: number, hold: number, r: number): void {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setValueAtTime(peak, t + a + hold);
  p.setTargetAtTime(0, t + a + hold, Math.max(0.01, r / 5));
}

/** Tiny JS biquad used for offline texture rendering (RBJ cookbook). */
class JBiquad {
  private b0 = 0; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  bp(f: number, q: number, sr: number): void {
    const w = (TAU * f) / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
    this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0;
    this.a1 = (-2 * Math.cos(w)) / a0; this.a2 = (1 - al) / a0;
  }
  reset(): void { this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

function normalize(b: AudioBuffer, peak: number): void {
  let m = 1e-9;
  for (let ch = 0; ch < b.numberOfChannels; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > m) m = a; }
  }
  const k = peak / m;
  for (let ch = 0; ch < b.numberOfChannels; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
}

function rmsNormalize(d: Float32Array, rms: number): void {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  const k = rms / Math.sqrt(s / d.length + 1e-12);
  for (let i = 0; i < d.length; i++) d[i] *= k;
}

type NoiseKind = 'white' | 'pink' | 'brown';

/** Mono noise buffers (loop-safe), RMS-normalised to ~0.3. */
function noiseBuffer(c: BaseAudioContext, secs: number, kind: NoiseKind): AudioBuffer {
  const sr = c.sampleRate, n = Math.floor(sr * secs);
  const b = c.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  if (kind === 'white') {
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  } else if (kind === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = b0 + b1 + b2 + w * 0.1848;
    }
  } else {
    let last = 0;
    for (let i = 0; i < n; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last;
    }
    // detrend so the loop point is continuous, then remove DC
    const a = d[0], z = d[n - 1];
    let mean = 0;
    for (let i = 0; i < n; i++) { d[i] -= a + ((z - a) * i) / (n - 1); mean += d[i]; }
    mean /= n;
    for (let i = 0; i < n; i++) d[i] -= mean;
  }
  rmsNormalize(d, 0.3);
  return b;
}

/** Generated stereo impulse response: pre-delay, a few early reflections, darkening diffuse tail. */
function makeImpulse(c: BaseAudioContext, secs: number, decayPow: number): AudioBuffer {
  const sr = c.sampleRate, n = Math.floor(sr * secs);
  const b = c.createBuffer(2, n, sr);
  const pre = Math.floor(sr * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const x = i / n;
      const a = 0.85 - 0.72 * x; // one-pole coefficient: bright early, dark late
      lp += ((Math.random() * 2 - 1) - lp) * a;
      d[i] = lp * Math.pow(1 - x, decayPow);
    }
    for (let k = 0; k < 6; k++) {
      const i = pre + Math.floor(sr * rnd(0.005, 0.07));
      if (i < n) d[i] += rnd(-0.6, 0.6) * (1 - k * 0.12);
    }
    rmsNormalize(d, 1 / Math.sqrt(n)); // unit energy → reverb output ≈ input level for noisy input
  }
  return b;
}

/** Many-hands applause: ~70 individual clappers with their own timbre, rate, pan and start/stop. */
function renderApplause(c: BaseAudioContext, secs: number): AudioBuffer {
  const sr = 32000, n = Math.floor(secs * sr);
  const b = c.createBuffer(2, n, sr);
  const L = b.getChannelData(0), R = b.getChannelData(1);
  const bq = new JBiquad();
  const clappers = 70;
  for (let k = 0; k < clappers; k++) {
    const near = k < 22;
    const amp = near ? rnd(0.45, 1) : rnd(0.1, 0.32);
    const pan = rnd(-1, 1);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4), gr = Math.sin(((pan + 1) * Math.PI) / 4);
    bq.bp(rnd(near ? 900 : 650, near ? 2600 : 1800), rnd(0.8, 1.8), sr);
    const rate = rnd(3.4, 5.6);
    const t0 = rnd(0, 0.3) + (near ? 0 : rnd(0, 0.25));
    const t1 = secs - rnd(0.25, secs * 0.5);
    const decay = rnd(160, 320);
    const crack = near ? rnd(0.15, 0.35) : 0.05;
    let t = t0;
    while (t < t1) {
      const ramp = Math.min(1, (t - t0) / 0.25 + 0.3) * Math.min(1, (t1 - t) / 0.5 + 0.2);
      const a = amp * ramp * rnd(0.7, 1.1);
      const i0 = Math.floor(t * sr), len = Math.floor(sr * rnd(0.014, 0.028));
      bq.reset();
      for (let i = 0; i < len && i0 + i < n; i++) {
        const env = i < 32 ? i / 32 : Math.exp(-(i / sr) * decay);
        const x = (Math.random() * 2 - 1) * env;
        const y = (bq.run(x) * 2.2 + x * crack) * a;
        L[i0 + i] += y * gl; R[i0 + i] += y * gr;
      }
      t += (1 / rate) * rnd(0.85, 1.15);
    }
  }
  normalize(b, 0.9);
  return b;
}

/** Loopable rain-drop texture: dense tiny ticks plus a few "plinks". */
function renderDrops(c: BaseAudioContext, secs: number): AudioBuffer {
  const sr = 32000, n = Math.floor(secs * sr);
  const b = c.createBuffer(2, n, sr);
  const L = b.getChannelData(0), R = b.getChannelData(1);
  const count = Math.floor(secs * 55);
  for (let e = 0; e < count; e++) {
    const i0 = Math.floor(Math.random() * n);
    const pan = rnd(-1, 1);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4), gr = Math.sin(((pan + 1) * Math.PI) / 4);
    const amp = 0.05 + Math.pow(Math.random(), 3) * 0.6;
    let ph = 0;
    if (Math.random() < 0.8) {
      const f = rnd(1800, 7000), tau = rnd(0.0006, 0.002) * sr, len = Math.floor(tau * 6);
      for (let i = 0; i < len; i++) {
        const y = (Math.sin(ph) * 0.7 + (Math.random() * 2 - 1) * 0.3) * Math.exp(-i / tau) * amp;
        ph += (TAU * f) / sr;
        const j = (i0 + i) % n; L[j] += y * gl; R[j] += y * gr;
      }
    } else {
      const f0 = rnd(900, 2800), tau = rnd(0.004, 0.012) * sr, len = Math.floor(tau * 5);
      for (let i = 0; i < len; i++) {
        ph += (TAU * f0 * (1 + (0.6 * i) / len)) / sr;
        const y = Math.sin(ph) * Math.exp(-i / tau) * amp * 0.7 * Math.min(1, i / 16);
        const j = (i0 + i) % n; L[j] += y * gl; R[j] += y * gr;
      }
    }
  }
  normalize(b, 0.8);
  return b;
}

/** Loopable water trickle: clusters of rising-pitch bubbles (van den Doel style) over a soft bed. */
function renderWater(c: BaseAudioContext, secs: number): AudioBuffer {
  const sr = 24000, n = Math.floor(secs * sr);
  const b = c.createBuffer(2, n, sr);
  const L = b.getChannelData(0), R = b.getChannelData(1);
  let t = 0;
  while (t < secs) {
    const pan0 = rnd(-0.7, 0.7);
    for (let k = rint(2, 9); k > 0; k--) {
      const tb = t + rnd(0, 0.08);
      const f0 = 350 * Math.pow(2, Math.pow(Math.random(), 0.8) * 2.6);
      const tau = rnd(0.004, 0.012) * Math.sqrt(1000 / f0);
      const rise = rnd(6, 25);
      const amp = Math.min(1.2, (0.15 + Math.pow(Math.random(), 2) * 0.85) * Math.sqrt(800 / f0));
      const pan = clamp(pan0 + rnd(-0.25, 0.25), -1, 1);
      const gl = Math.cos(((pan + 1) * Math.PI) / 4), gr = Math.sin(((pan + 1) * Math.PI) / 4);
      const i0 = Math.floor(tb * sr), len = Math.floor(tau * 6 * sr);
      let ph = 0;
      for (let i = 0; i < len; i++) {
        const tt = i / sr;
        ph += (TAU * f0 * (1 + rise * tt)) / sr;
        const y = Math.sin(ph) * (i < 8 ? i / 8 : 1) * Math.exp(-tt / tau) * amp;
        const j = (i0 + i) % n; L[j] += y * gl; R[j] += y * gr;
      }
    }
    t += rnd(0.03, 0.14);
  }
  for (const d of [L, R]) {
    let a = 0, z = 0;
    for (let i = 0; i < n; i++) {
      a += (Math.random() * 2 - 1 - a) * 0.25;
      z += (a - z) * 0.02;
      d[i] += (a - z) * 0.09;
    }
  }
  normalize(b, 0.85);
  return b;
}

/** Loopable crowd babble: ~10 synthetic talkers (glottal saw → moving vowel formants). */
function renderBabble(c: BaseAudioContext, secs: number): AudioBuffer {
  const sr = 16000, n = Math.floor(secs * sr);
  const b = c.createBuffer(2, n, sr);
  const L = b.getChannelData(0), R = b.getChannelData(1);
  const VOW: readonly (readonly [number, number])[] = [
    [270, 2290], [390, 1990], [530, 1840], [660, 1720], [730, 1090],
    [570, 840], [440, 1020], [300, 870], [640, 1190], [490, 1350],
  ];
  const f1 = new JBiquad(), f2 = new JBiquad(), f3 = new JBiquad();
  for (let k = 0; k < 10; k++) {
    const fem = Math.random() < 0.45;
    const f0 = fem ? rnd(180, 235) : rnd(98, 135);
    const fs = fem ? 1.15 : 1;
    const pan = rnd(-0.85, 0.85);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4), gr = Math.sin(((pan + 1) * Math.PI) / 4);
    const amp = rnd(0.35, 1);
    const off = Math.floor(Math.random() * n);
    f1.reset(); f2.reset(); f3.reset();
    f3.bp(2500 * fs, 10, sr);
    let i = 0, phase = 0, soft = 0;
    while (i < n) {
      const phraseEnd = Math.min(n, i + Math.floor(rnd(0.8, 2.6) * sr));
      let pitch = f0 * rnd(1.05, 1.2);
      while (i < phraseEnd) {
        const syl = Math.floor(rnd(0.11, 0.24) * sr);
        const v = pick(VOW);
        f1.bp(v[0] * fs, 5, sr); f2.bp(v[1] * fs, 8, sr);
        const stress = rnd(0.55, 1);
        const p0 = pitch * rnd(0.97, 1.06), p1 = pitch * rnd(0.9, 1.0);
        const fric = Math.random() < 0.4 ? Math.floor(rnd(0.02, 0.05) * sr) : 0;
        for (let j = 0; j < syl && i < n; j++, i++) {
          const x = j / syl;
          phase += (p0 + (p1 - p0) * x) / sr;
          if (phase >= 1) phase -= 1;
          soft += (2 * phase - 1 - soft) * 0.5;
          let y = (f1.run(soft) + 0.6 * f2.run(soft) + 0.25 * f3.run(soft)) * Math.sin(Math.PI * x) * stress;
          if (j < fric) y += (Math.random() * 2 - 1) * 0.06 * (1 - j / fric);
          y *= amp;
          const idx = (i + off) % n;
          L[idx] += y * gl; R[idx] += y * gr;
        }
        pitch *= 0.985;
      }
      i += Math.floor(rnd(0.15, 1.0) * sr);
    }
  }
  normalize(b, 0.9);
  return b;
}

/** Shared, lazily-built buffers and waves. */
class Kit {
  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly brown: AudioBuffer;
  readonly warm: PeriodicWave;
  private _drops: AudioBuffer | null = null;
  private _water: AudioBuffer | null = null;
  private _babble: AudioBuffer | null = null;
  private _applause: AudioBuffer[] = [];

  constructor(readonly c: AudioContext) {
    this.white = noiseBuffer(c, 3, 'white');
    this.pink = noiseBuffer(c, 6, 'pink');
    this.brown = noiseBuffer(c, 5, 'brown');
    const N = 16, re = new Float32Array(N), im = new Float32Array(N);
    for (let i = 1; i < N; i++) im[i] = (1 / Math.pow(i, 1.7)) * (i % 2 ? 1 : 0.6);
    this.warm = c.createPeriodicWave(re, im);
  }
  drops(): AudioBuffer { return (this._drops ??= renderDrops(this.c, 6)); }
  water(): AudioBuffer { return (this._water ??= renderWater(this.c, 7)); }
  babble(): AudioBuffer { return (this._babble ??= renderBabble(this.c, 9)); }
  applause(): AudioBuffer {
    while (this._applause.length < 2) this._applause.push(renderApplause(this.c, 3.6));
    return pick(this._applause);
  }
  /** Render the textures in the background, one per timer slot, so first use never hitches. */
  prewarm(): void {
    const jobs = [(): unknown => this.applause(), (): unknown => this.drops(), (): unknown => this.water(), (): unknown => this.babble()];
    let i = 0;
    const next = (): void => {
      if (i >= jobs.length) return;
      try { jobs[i++](); } catch { /* ignore */ }
      setTimeout(next, 350);
    };
    setTimeout(next, 900);
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Node bags: every node created for a voice / layer / note is tracked so it can be torn down.
// ───────────────────────────────────────────────────────────────────────────────────────────────

class Bag {
  readonly nodes: AudioNode[] = [];
  readonly srcs: AudioScheduledSourceNode[] = [];
  constructor(readonly c: AudioContext, readonly k: Kit) {}

  add<T extends AudioNode>(n: T): T { this.nodes.push(n); return n; }

  gain(v = 0): GainNode {
    const g = this.add(this.c.createGain());
    g.gain.value = v;
    return g;
  }

  filt(type: BiquadFilterType, f: number, q = 0.707): BiquadFilterNode {
    const b = this.add(this.c.createBiquadFilter());
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  /** Oscillator started at t0 (and stopped at t1 if given). 'custom' uses the warm pad wave. */
  osc(type: OscillatorType, f: number, t0: number, t1?: number): OscillatorNode {
    const o = this.add(this.c.createOscillator());
    if (type === 'custom') o.setPeriodicWave(this.k.warm); else o.type = type;
    o.frequency.setValueAtTime(f, t0);
    o.start(t0);
    if (t1 !== undefined) o.stop(t1);
    this.srcs.push(o);
    return o;
  }

  /** Buffer source at a random offset (unless given). Loops automatically if the span is too long. */
  src(buf: AudioBuffer, t0: number, t1?: number, rate = 1, loop = false, offset?: number): AudioBufferSourceNode {
    const s = this.add(this.c.createBufferSource());
    s.buffer = buf;
    s.playbackRate.value = rate;
    const need = t1 === undefined ? Infinity : (t1 - t0) * rate;
    s.loop = loop || need > buf.duration - 0.05;
    let off = offset;
    if (off === undefined) {
      const span = s.loop ? buf.duration : buf.duration - need - 0.01;
      off = Math.random() * Math.max(0, span);
    }
    s.start(t0, Math.max(0, off));
    if (t1 !== undefined) s.stop(t1);
    this.srcs.push(s);
    return s;
  }

  panner(v = 0): StereoPannerNode | null {
    if (typeof this.c.createStereoPanner !== 'function') return null;
    const p = this.add(this.c.createStereoPanner());
    p.pan.value = clamp(v, -1, 1);
    return p;
  }

  pan(v: number): AudioNode { return this.panner(v) ?? this.gain(1); }

  delay(s: number): DelayNode {
    const d = this.add(this.c.createDelay(1));
    d.delayTime.value = s;
    return d;
  }

  /** Decorrelated stereo noise bed from a mono buffer (two looping reads half a buffer apart). */
  stereo(buf: AudioBuffer, t0: number): AudioNode {
    const m = this.add(this.c.createChannelMerger(2));
    const o = Math.random() * buf.duration;
    this.src(buf, t0, undefined, 1, true, o).connect(m, 0, 0);
    this.src(buf, t0, undefined, 1, true, (o + buf.duration / 2) % buf.duration).connect(m, 0, 1);
    return m;
  }

  dispose(): void {
    for (const s of this.srcs) { try { s.stop(); } catch { /* already stopped */ } }
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* ignore */ } }
    this.nodes.length = 0;
    this.srcs.length = 0;
  }
}

/** One playing sound effect: a bag plus its start time, pitch multiplier and output. */
class Voice extends Bag {
  constructor(c: AudioContext, k: Kit, readonly t: number, readonly p: number, readonly out: GainNode) {
    super(c, k);
  }

  /** Enveloped oscillator, optionally gliding f0 → f1. */
  tone(type: OscillatorType, f0: number, f1: number | null, t: number, peak: number, a: number, d: number,
    dest: AudioNode = this.out): { o: OscillatorNode; g: GainNode } {
    const o = this.osc(type, f0, t, t + a + d + 0.03);
    if (f1 !== null) o.frequency.exponentialRampToValueAtTime(f1, t + a + d * 0.7);
    const g = this.gain(0);
    perc(g.gain, t, peak, a, d);
    o.connect(g).connect(dest);
    return { o, g };
  }

  /** Enveloped filtered noise burst. */
  noiseHit(kind: NoiseKind, type: BiquadFilterType, f: number, q: number, t: number, peak: number, a: number, d: number,
    dest: AudioNode = this.out): { s: AudioBufferSourceNode; f: BiquadFilterNode; g: GainNode } {
    const s = this.src(this.k[kind], t, t + a + d + 0.03);
    const fl = this.filt(type, f, q);
    fl.frequency.setValueAtTime(f, t);
    const g = this.gain(0);
    perc(g.gain, t, peak, a, d);
    s.connect(fl).connect(g).connect(dest);
    return { s, f: fl, g };
  }

  /** Soft sine pluck with a quieter octave partial. */
  pluck(f: number, t: number, peak: number, d: number): void {
    this.tone('sine', f, null, t, peak, 0.003, d);
    this.tone('sine', f * 2, null, t, peak * 0.22, 0.002, d * 0.45);
  }

  /** Inharmonic bell (coin / chime). */
  bell(f: number, t: number, peak: number, d: number): void {
    const R = [1, 2.76, 5.4, 8.93], A = [1, 0.35, 0.12, 0.05], D = [1, 0.45, 0.22, 0.1];
    const lim = this.c.sampleRate * 0.42;
    for (let i = 0; i < R.length; i++) {
      if (f * R[i] < lim) this.tone('sine', f * R[i] * rnd(0.999, 1.001), null, t, peak * A[i], 0.0015, d * D[i]);
    }
  }

  /** Marimba-ish: fundamental + ~4th partial that dies quickly. */
  marimba(f: number, t: number, peak: number, d: number): void {
    this.tone('sine', f, null, t, peak, 0.002, d);
    if (f * 3.93 < this.c.sampleRate * 0.42) this.tone('sine', f * 3.93, null, t, peak * 0.22, 0.001, d * 0.15);
  }

  /** Short slapback echo bus (outdoor reflections off the clubhouse / tree line). */
  echoMix(level: number, time: number): GainNode {
    const mix = this.gain(1);
    mix.connect(this.out);
    const dl = this.delay(time), lp = this.filt('lowpass', 1800, 0.7), g = this.gain(level);
    mix.connect(dl).connect(lp).connect(g).connect(this.out);
    return mix;
  }

  /** Pre-rendered applause texture with per-play rate / EQ variation. Returns duration. */
  applause(t: number, p: number, level: number): number {
    const buf = this.k.applause();
    const rate = rnd(0.94, 1.06) * p;
    const dur = buf.duration / rate;
    const s = this.src(buf, t, undefined, rate, false, 0);
    s.stop(t + dur + 0.02);
    const pk = this.filt('peaking', rnd(900, 2200), 0.8);
    pk.gain.value = rnd(-4, 4);
    const lp = this.filt('lowpass', rnd(6500, 11000), 0.5);
    const g = this.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.1);
    s.connect(pk).connect(lp).connect(g).connect(this.out);
    return dur + 0.05;
  }

  /** Voiced crowd: several sawtooth "voices" with pitch contours through shared formant banks. */
  crowdVoices(t: number, p: number, kind: 'cheer' | 'groan'): number {
    const cheer = kind === 'cheer';
    const span = cheer ? 1.9 : 1.7;
    const hp = this.filt('highpass', cheer ? 150 : 80, 0.7);
    const lp = this.filt('lowpass', cheer ? 4200 : 2600, 0.6);
    const outG = this.gain(cheer ? 2.2 : 2.6);
    hp.connect(lp).connect(outG).connect(this.out);
    const mkBank = (F: readonly (readonly [number, number])[]): GainNode => {
      const inp = this.gain(1);
      const Q = [6, 9, 12], A = [1, 0.7, 0.25];
      F.forEach(([a, b], i) => {
        const f = this.filt('bandpass', a, Q[i]);
        f.frequency.setValueAtTime(a, t);
        f.frequency.linearRampToValueAtTime(b, t + span);
        const fg = this.gain(A[i]);
        inp.connect(f).connect(fg).connect(hp);
      });
      return inp;
    };
    const banks = cheer
      ? [mkBank([[300, 380], [760, 900], [2300, 2400]]), mkBank([[480, 720], [1850, 1450], [2500, 2550]])]
      : [mkBank([[620, 460], [920, 800], [2450, 2400]])];
    const vib1 = this.osc('sine', rnd(5, 6.2), t, t + span + 0.6);
    const vg1 = this.gain(cheer ? 40 : 20);
    vib1.connect(vg1);
    const vib2 = this.osc('sine', rnd(4.2, 5.2), t, t + span + 0.6);
    const vg2 = this.gain(cheer ? 30 : 15);
    vib2.connect(vg2);
    const n = cheer ? rint(7, 10) : rint(6, 9);
    for (let i = 0; i < n; i++) {
      const high = Math.random() < (cheer ? 0.5 : 0.3);
      const f0 = (cheer ? (high ? rnd(330, 520) : rnd(170, 290)) : high ? rnd(170, 240) : rnd(92, 150)) * p;
      const ts = t + rnd(0, cheer ? 0.4 : 0.25);
      const len = cheer ? rnd(0.7, 1.4) : rnd(1.0, 1.45);
      const o = this.osc('sawtooth', f0, ts, ts + len + 0.05);
      const fr = o.frequency;
      if (cheer) {
        fr.setValueAtTime(f0 * 0.7, ts);
        fr.exponentialRampToValueAtTime(f0 * 1.12, ts + 0.2);
        fr.linearRampToValueAtTime(f0 * 1.04, ts + len * 0.75);
        fr.exponentialRampToValueAtTime(f0 * 0.78, ts + len);
      } else {
        fr.setValueAtTime(f0 * 1.06, ts);
        fr.linearRampToValueAtTime(f0 * 1.12, ts + 0.15);
        fr.exponentialRampToValueAtTime(f0 * 0.68, ts + len);
      }
      (i % 2 ? vg1 : vg2).connect(o.detune);
      const amp = rnd(0.5, 1) / Math.sqrt(n);
      const g = this.gain(0);
      g.gain.setValueAtTime(0, ts);
      g.gain.linearRampToValueAtTime(amp, ts + (cheer ? 0.06 : 0.18));
      g.gain.setValueAtTime(amp, ts + len * 0.6);
      g.gain.linearRampToValueAtTime(0, ts + len);
      o.connect(g).connect(this.pan(rnd(-0.75, 0.75))).connect(banks[i % banks.length]);
    }
    // breath / aspiration through the same formants
    const br = this.src(this.k.pink, t, t + span + 0.3);
    const bg = this.gain(0);
    swell(bg.gain, t, 0.15, cheer ? 0.5 : 0.4, span * 0.5, span * 0.5);
    br.connect(bg);
    for (const bk of banks) bg.connect(bk);
    return span + 0.45;
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Sound effect table
// ───────────────────────────────────────────────────────────────────────────────────────────────

interface SfxCfg {
  gain: number;   // base output level
  max: number;    // max concurrent voices of this sound
  gap: number;    // min seconds between starts of this sound
  rev: number;    // reverb send
  vary: number;   // random pitch variation (± fraction)
  ownPan?: boolean;
}

const SFX: Record<SfxName, SfxCfg> = {
  click:      { gain: 0.55, max: 4, gap: 0.025, rev: 0.02, vary: 0.04 },
  hover:      { gain: 0.4,  max: 3, gap: 0.04,  rev: 0,    vary: 0.03 },
  open:       { gain: 0.5,  max: 2, gap: 0.06,  rev: 0.08, vary: 0.01 },
  close:      { gain: 0.5,  max: 2, gap: 0.06,  rev: 0.08, vary: 0.01 },
  build:      { gain: 0.75, max: 4, gap: 0.04,  rev: 0.08, vary: 0.06 },
  bulldoze:   { gain: 0.7,  max: 3, gap: 0.08,  rev: 0.05, vary: 0.08 },
  paint:      { gain: 0.8,  max: 4, gap: 0.035, rev: 0.02, vary: 0.1 },
  error:      { gain: 0.6,  max: 2, gap: 0.15,  rev: 0.05, vary: 0 },
  cash:       { gain: 0.65, max: 4, gap: 0.06,  rev: 0.12, vary: 0.02 },
  notify:     { gain: 0.6,  max: 2, gap: 0.15,  rev: 0.15, vary: 0 },
  goal:       { gain: 0.7,  max: 2, gap: 0.3,   rev: 0.25, vary: 0 },
  unlock:     { gain: 0.7,  max: 2, gap: 0.3,   rev: 0.25, vary: 0 },
  levelup:    { gain: 0.75, max: 1, gap: 0.5,   rev: 0.3,  vary: 0 },
  swing:      { gain: 0.65, max: 4, gap: 0.05,  rev: 0.04, vary: 0.08 },
  hit_driver: { gain: 0.85, max: 4, gap: 0.03,  rev: 0.12, vary: 0.04 },
  hit_iron:   { gain: 0.8,  max: 4, gap: 0.03,  rev: 0.1,  vary: 0.05 },
  hit_wedge:  { gain: 0.75, max: 4, gap: 0.03,  rev: 0.08, vary: 0.05 },
  putt:       { gain: 0.75, max: 4, gap: 0.03,  rev: 0.05, vary: 0.04 },
  cup:        { gain: 0.75, max: 2, gap: 0.2,   rev: 0.08, vary: 0.04 },
  bounce:     { gain: 0.6,  max: 5, gap: 0.025, rev: 0.05, vary: 0.12 },
  land_sand:  { gain: 0.65, max: 4, gap: 0.04,  rev: 0.05, vary: 0.1 },
  splash:     { gain: 0.75, max: 3, gap: 0.08,  rev: 0.12, vary: 0.08 },
  tree_hit:   { gain: 0.7,  max: 3, gap: 0.06,  rev: 0.1,  vary: 0.1 },
  range_hit:  { gain: 0.45, max: 6, gap: 0.035, rev: 0.3,  vary: 0.08 },
  applause:   { gain: 0.6,  max: 3, gap: 0.25,  rev: 0.18, vary: 0.04 },
  cheer:      { gain: 0.65, max: 2, gap: 0.4,   rev: 0.2,  vary: 0.04 },
  groan:      { gain: 0.6,  max: 2, gap: 0.4,   rev: 0.18, vary: 0.05 },
  car_door:   { gain: 0.65, max: 3, gap: 0.08,  rev: 0.1,  vary: 0.06 },
  car_pass:   { gain: 0.55, max: 3, gap: 0.4,   rev: 0.08, vary: 0.06, ownPan: true },
  whoosh:     { gain: 0.7,  max: 3, gap: 0.08,  rev: 0.1,  vary: 0.08 },
};

const MAX_GLOBAL_VOICES = 24;

/** Each synth builds its graph into `v.out` starting at `v.t` and returns its duration (s). */
type Synth = (v: Voice, pan: number) => number;

const SYNTHS: Record<SfxName, Synth> = {
  // ── UI ────────────────────────────────────────────────────────────────────────────────────
  click(v) {
    const { t, p } = v;
    v.tone('triangle', 1250 * p, 820 * p, t, 0.32, 0.001, 0.045);
    v.noiseHit('white', 'bandpass', 4200 * p, 1.4, t, 0.22, 0.0005, 0.012);
    return 0.08;
  },
  hover(v) {
    const { t, p } = v;
    v.tone('sine', 2300 * p, null, t, 0.12, 0.003, 0.035);
    v.tone('sine', 4600 * p, null, t, 0.02, 0.002, 0.015);
    return 0.06;
  },
  open(v) {
    const { t, p } = v;
    v.pluck(880 * p, t, 0.22, 0.18);
    v.pluck(1320 * p, t + 0.06, 0.2, 0.22);
    const n = v.noiseHit('pink', 'bandpass', 2500 * p, 0.8, t, 0.06, 0.05, 0.08);
    n.f.frequency.exponentialRampToValueAtTime(5000 * p, t + 0.12);
    return 0.4;
  },
  close(v) {
    const { t, p } = v;
    v.pluck(1320 * p, t, 0.18, 0.15);
    v.pluck(880 * p, t + 0.055, 0.17, 0.2);
    const n = v.noiseHit('pink', 'bandpass', 4000 * p, 0.8, t, 0.05, 0.04, 0.08);
    n.f.frequency.exponentialRampToValueAtTime(1800 * p, t + 0.12);
    return 0.35;
  },

  // ── Building / economy ─────────────────────────────────────────────────────────────────────
  build(v) {
    const { t, p } = v;
    v.tone('sine', 170 * p, 70 * p, t, 0.55, 0.002, 0.16);
    v.noiseHit('white', 'bandpass', 520 * p, 5, t, 1.4, 0.001, 0.07);
    v.noiseHit('pink', 'lowpass', 900 * p, 0.7, t, 0.35, 0.001, 0.08);
    v.tone('sine', 1650 * p * rnd(0.97, 1.03), null, t + 0.025, 0.05, 0.002, 0.06);
    return 0.3;
  },
  bulldoze(v) {
    const { t, p } = v;
    const dur = 0.5;
    // chugging low rumble
    const r = v.src(v.k.brown, t, t + dur + 0.05);
    const lp = v.filt('lowpass', 320 * p, 0.9);
    const am = v.gain(0.55);
    const lfo = v.osc('square', 13 * p, t, t + dur);
    const lg = v.gain(0.45);
    lfo.connect(lg).connect(am.gain);
    const env = v.gain(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1.1, t + 0.02);
    env.gain.setValueAtTime(1.1, t + 0.25);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    r.connect(lp).connect(am).connect(env).connect(v.out);
    // crunchy debris grains
    const cr = v.src(v.k.white, t, t + dur);
    const bp = v.filt('bandpass', 1500 * p, 0.9);
    const cg = v.gain(0);
    cg.gain.setValueAtTime(0, t);
    for (let tt = t + 0.01; tt < t + dur - 0.05; tt += rnd(0.02, 0.05)) {
      cg.gain.setValueAtTime(rnd(0.1, 0.35) * (1 - (tt - t) / dur), tt);
      cg.gain.setTargetAtTime(0, tt + 0.004, 0.01);
    }
    cr.connect(bp).connect(cg).connect(v.out);
    v.tone('sine', 95 * p, 42 * p, t, 0.45, 0.01, 0.4);
    return dur + 0.1;
  },
  paint(v) {
    const { t, p } = v;
    const f0 = rnd(1800, 2600) * p;
    const n = v.noiseHit('pink', 'bandpass', f0, 1.1, t, 0.32, 0.025, 0.11);
    n.f.frequency.exponentialRampToValueAtTime(f0 * rnd(1.6, 2.1), t + 0.12);
    return 0.17;
  },
  error(v) {
    const { t, p } = v;
    const note = (f: number, tt: number): void => {
      const lp = v.filt('lowpass', 1300, 0.7);
      lp.connect(v.out);
      v.tone('triangle', f, f * 0.985, tt, 0.32, 0.006, 0.16, lp);
      v.tone('sine', f / 2, null, tt, 0.18, 0.006, 0.14, lp);
    };
    note(311 * p, t);
    note(262 * p, t + 0.13);
    return 0.4;
  },
  cash(v) {
    const { t, p } = v;
    v.noiseHit('white', 'highpass', 3500, 0.7, t, 0.18, 0.0005, 0.018);
    const base = pick([1568, 1661, 1760]) * p;
    v.bell(base, t + 0.012, 0.13, 0.3);
    v.bell(base * 1.335, t + 0.065, 0.12, 0.4);
    return 0.55;
  },
  notify(v) {
    const { t, p } = v;
    v.marimba(784 * p, t, 0.28, 0.45);
    v.marimba(1175 * p, t + 0.11, 0.25, 0.55);
    return 0.75;
  },
  goal(v) {
    const { t, p } = v;
    [1047, 1319, 1568, 2093].forEach((f, i) => v.marimba(f * p, t + i * 0.085, 0.22, 0.6 + i * 0.1));
    v.bell(4186 * p, t + 0.34, 0.035, 0.8);
    for (const f of [523, 659, 784]) v.tone('sine', f * p, null, t + 0.25, 0.06, 0.08, 1.0);
    v.noiseHit('white', 'highpass', 7000, 0.7, t + 0.25, 0.035, 0.1, 0.6);
    return 1.4;
  },
  unlock(v) {
    const { t, p } = v;
    [1047, 1175, 1319, 1568, 1760, 2093, 2349, 2637].forEach((f, i) => v.pluck(f * p, t + i * 0.045, 0.1 + i * 0.008, 0.3));
    const r = v.noiseHit('white', 'bandpass', 1200, 2, t, 0.08, 0.3, 0.12);
    r.f.frequency.exponentialRampToValueAtTime(7000, t + 0.36);
    v.bell(2093 * p, t + 0.4, 0.12, 0.9);
    v.bell(3136 * p, t + 0.4, 0.05, 0.9);
    return 1.4;
  },
  levelup(v) {
    const { t, p } = v;
    [523, 659, 784].forEach((f, i) => v.marimba(f * p, t + i * 0.09, 0.22, 0.4));
    const t2 = t + 0.3;
    const lp = v.filt('lowpass', 700, 0.8);
    lp.frequency.setValueAtTime(700, t2);
    lp.frequency.exponentialRampToValueAtTime(3200, t2 + 0.25);
    lp.frequency.exponentialRampToValueAtTime(1200, t2 + 1.6);
    const g = v.gain(0);
    swell(g.gain, t2, 0.03, 0.09, 0.25, 1.2);
    for (const f of [523, 659, 784, 1047]) {
      for (const dt of [-8, 8]) {
        const o = v.osc('custom', f * p, t2, t2 + 2);
        o.detune.value = dt;
        o.connect(lp);
      }
    }
    lp.connect(g).connect(v.out);
    v.bell(2093 * p, t2, 0.08, 1.2);
    v.marimba(1568 * p, t2, 0.16, 0.8);
    v.noiseHit('white', 'highpass', 8000, 0.7, t2, 0.03, 0.05, 0.8);
    return 2.2;
  },

  // ── Golf ──────────────────────────────────────────────────────────────────────────────────
  swing(v) {
    const { t, p } = v;
    const T = 0.34 / rnd(0.9, 1.1);
    const src = v.src(v.k.pink, t, t + T + 0.05);
    const mk = (f0: number, f1: number, f2: number, q: number, lvl: number): void => {
      const bp = v.filt('bandpass', f0, q);
      bp.frequency.setValueAtTime(f0, t);
      bp.frequency.exponentialRampToValueAtTime(f1, t + T * 0.62);
      bp.frequency.exponentialRampToValueAtTime(f2, t + T);
      const g = v.gain(0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(lvl, t + T * 0.62);
      g.gain.exponentialRampToValueAtTime(0.0001, t + T);
      src.connect(bp).connect(g).connect(v.out);
    };
    mk(450 * p, 2300 * p, 700 * p, 1.3, 1.0);
    mk(1500 * p, 4200 * p, 1800 * p, 2.5, 0.3);
    return T + 0.08;
  },
  hit_driver(v) {
    const { t, p } = v;
    const mix = v.echoMix(0.13, rnd(0.14, 0.2));
    v.noiseHit('white', 'highpass', 2500, 0.7, t, 0.55, 0.0004, 0.012, mix);   // crack
    v.noiseHit('white', 'bandpass', 950 * p, 1.1, t, 0.9, 0.0006, 0.045, mix); // thwack body
    v.tone('sine', 1720 * p, 1640 * p, t, 0.22, 0.0008, 0.11, mix);           // hollow ring
    v.tone('sine', 2980 * p, 2900 * p, t, 0.12, 0.0008, 0.06, mix);
    v.tone('sine', 4400 * p, null, t, 0.05, 0.0005, 0.03, mix);
    v.tone('sine', 230 * p, 140 * p, t, 0.35, 0.001, 0.07, mix);              // thump
    return 0.5;
  },
  hit_iron(v) {
    const { t, p } = v;
    const mix = v.echoMix(0.08, rnd(0.12, 0.18));
    v.noiseHit('white', 'highpass', 3200, 0.7, t, 0.6, 0.0003, 0.007, mix);    // click
    v.noiseHit('white', 'bandpass', 1700 * p, 1.4, t, 0.6, 0.0004, 0.022, mix); // compression "thock"
    v.tone('sine', 3300 * p, null, t, 0.16, 0.0004, 0.028, mix);
    v.tone('sine', 5200 * p, null, t, 0.06, 0.0003, 0.016, mix);
    v.noiseHit('pink', 'lowpass', 750, 0.7, t + 0.004, 0.45, 0.003, 0.1, mix);   // turf
    return 0.4;
  },
  hit_wedge(v) {
    const { t, p } = v;
    const mix = v.echoMix(0.06, rnd(0.12, 0.18));
    v.noiseHit('white', 'highpass', 2500, 0.7, t, 0.25, 0.0004, 0.006, mix);
    v.noiseHit('white', 'bandpass', 1200 * p, 1.2, t, 0.4, 0.0005, 0.026, mix);
    v.tone('sine', 2400 * p, null, t, 0.08, 0.0005, 0.02, mix);
    v.noiseHit('pink', 'lowpass', 900, 0.7, t + 0.003, 0.55, 0.004, 0.14, mix);   // more turf
    return 0.4;
  },
  putt(v) {
    const { t, p } = v;
    v.tone('sine', 1080 * p, 1010 * p, t, 0.38, 0.0007, 0.045);
    v.tone('sine', 2650 * p, null, t, 0.08, 0.0005, 0.014);
    v.noiseHit('white', 'bandpass', 2200 * p, 1.6, t, 0.25, 0.0004, 0.008);
    return 0.12;
  },
  cup(v) {
    const { t, p } = v;
    v.noiseHit('white', 'bandpass', 1300 * p, 3, t, 1.2, 0.0005, 0.03);
    v.tone('sine', 640 * p, 620 * p, t, 0.14, 0.001, 0.22);
    v.tone('sine', 1490 * p, null, t, 0.06, 0.001, 0.14);
    // rattles: one noise source + filter and one osc, re-triggered with sequential envelopes
    const src = v.src(v.k.white, t, t + 0.8);
    const bp = v.filt('bandpass', 1400 * p, 4);
    const g = v.gain(0);
    src.connect(bp).connect(g).connect(v.out);
    const o = v.osc('sine', 900 * p, t, t + 0.8);
    const og = v.gain(0);
    o.connect(og).connect(v.out);
    g.gain.setValueAtTime(0, t);
    og.gain.setValueAtTime(0, t);
    let tt = t, gap = rnd(0.085, 0.11), amp = 1.1;
    for (let i = 0, n = rint(5, 7); i < n; i++) {
      tt += gap;
      amp *= rnd(0.55, 0.75);
      gap *= rnd(0.62, 0.78);
      const d = Math.min(0.03, gap * 0.85);
      bp.frequency.setValueAtTime(rnd(1100, 1600) * p, tt);
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(amp, tt + 0.0005);
      g.gain.exponentialRampToValueAtTime(amp * 0.001, tt + d);
      o.frequency.setValueAtTime(rnd(800, 1000) * p, tt);
      og.gain.setValueAtTime(0, tt);
      og.gain.linearRampToValueAtTime(amp * 0.12, tt + 0.0005);
      og.gain.exponentialRampToValueAtTime(amp * 0.00012, tt + d);
    }
    v.tone('sine', 320 * p, 260 * p, tt + gap + 0.01, 0.12, 0.001, 0.06); // final settle
    return tt - t + gap + 0.15;
  },
  bounce(v) {
    const { t, p } = v;
    v.tone('sine', 170 * p, 95 * p, t, 0.4, 0.001, 0.055);
    v.noiseHit('white', 'bandpass', 1900 * p, 1.4, t, 0.22, 0.0005, 0.012);
    v.noiseHit('pink', 'lowpass', 1100, 0.7, t, 0.18, 0.001, 0.04);
    return 0.12;
  },
  land_sand(v) {
    const { t, p } = v;
    v.noiseHit('pink', 'lowpass', 420 * p, 0.8, t, 0.5, 0.002, 0.07);
    const n = v.noiseHit('white', 'bandpass', 2800 * p, 0.8, t, 0.4, 0.004, 0.2);
    n.f.frequency.exponentialRampToValueAtTime(1800 * p, t + 0.2);
    const src = v.src(v.k.white, t, t + 0.3);
    const hp = v.filt('highpass', 4500, 0.7);
    const g = v.gain(0);
    g.gain.setValueAtTime(0, t);
    for (let tt = t + 0.005; tt < t + 0.22; tt += rnd(0.008, 0.025)) {
      g.gain.setValueAtTime(rnd(0.05, 0.25) * (1 - (tt - t) / 0.25), tt);
      g.gain.setTargetAtTime(0, tt + 0.002, 0.004);
    }
    src.connect(hp).connect(g).connect(v.out);
    return 0.32;
  },
  splash(v) {
    const { t, p } = v;
    const n = v.noiseHit('white', 'lowpass', 6000 * p, 0.9, t, 0.55, 0.004, 0.55);
    n.f.frequency.exponentialRampToValueAtTime(700 * p, t + 0.5);
    v.noiseHit('brown', 'lowpass', 500, 0.7, t, 0.6, 0.003, 0.25);
    v.tone('sine', 160 * p, 520 * p, t + 0.01, 0.28, 0.003, 0.09); // plop
    // bubbles (one oscillator re-triggered)
    const o = v.osc('sine', 600, t, t + 1.0);
    const og = v.gain(0);
    og.gain.setValueAtTime(0, t);
    o.connect(og).connect(v.out);
    let tt = t + rnd(0.08, 0.14);
    for (let i = 0, k = rint(5, 9); i < k && tt < t + 0.85; i++) {
      const f = rnd(450, 1400) * p, a = rnd(0.04, 0.12);
      o.frequency.setValueAtTime(f, tt);
      o.frequency.exponentialRampToValueAtTime(f * rnd(1.4, 1.9), tt + 0.035);
      og.gain.setValueAtTime(0, tt);
      og.gain.linearRampToValueAtTime(a, tt + 0.003);
      og.gain.exponentialRampToValueAtTime(a * 0.002, tt + 0.04);
      og.gain.setValueAtTime(0, tt + 0.041);
      tt += rnd(0.045, 0.12);
    }
    // droplets falling back
    const ds = v.src(v.k.white, t, t + 1.0);
    const dbp = v.filt('bandpass', 4000, 3);
    const dg = v.gain(0);
    dg.gain.setValueAtTime(0, t);
    ds.connect(dbp).connect(dg).connect(v.out);
    tt = t + rnd(0.22, 0.3);
    for (let i = 0, k = rint(3, 6); i < k && tt < t + 0.95; i++) {
      const a = rnd(0.06, 0.18);
      dbp.frequency.setValueAtTime(rnd(2800, 5200), tt);
      dg.gain.setValueAtTime(0, tt);
      dg.gain.linearRampToValueAtTime(a, tt + 0.001);
      dg.gain.exponentialRampToValueAtTime(a * 0.002, tt + 0.02);
      tt += rnd(0.06, 0.16);
    }
    return 1.05;
  },
  tree_hit(v) {
    const { t, p } = v;
    const knock = (tt: number, lvl: number, fp: number): void => {
      v.noiseHit('white', 'bandpass', 720 * fp, 5, tt, 1.3 * lvl, 0.0008, 0.05);
      v.tone('sine', 390 * fp, 360 * fp, tt, 0.25 * lvl, 0.001, 0.06);
      v.noiseHit('white', 'highpass', 3000, 0.7, tt, 0.15 * lvl, 0.0004, 0.008);
    };
    knock(t, 1, p);
    if (Math.random() < 0.5) knock(t + rnd(0.1, 0.25), rnd(0.3, 0.5), p * rnd(0.85, 1.2));
    // leaf rustle
    const end = t + rnd(0.5, 0.75);
    const src = v.src(v.k.white, t, end + 0.05);
    const bp = v.filt('bandpass', 4200, 0.6);
    const g = v.gain(0);
    g.gain.setValueAtTime(0, t);
    for (let tt = t + 0.01; tt < end; tt += rnd(0.008, 0.022)) {
      const k = 1 - (tt - t) / (end - t);
      g.gain.linearRampToValueAtTime(rnd(0.02, 0.2) * k * k, tt);
    }
    g.gain.linearRampToValueAtTime(0, end + 0.02);
    src.connect(bp).connect(g).connect(v.out);
    return end - t + 0.1;
  },
  range_hit(v) {
    const { t, p } = v;
    const lp = v.filt('lowpass', rnd(2800, 5000), 0.7);
    lp.connect(v.out);
    const driver = Math.random() < 0.3;
    const f = (driver ? rnd(900, 1100) : rnd(1500, 2100)) * p;
    v.noiseHit('white', 'bandpass', f, 1.3, t, 0.7, 0.0005, driver ? 0.03 : 0.016, lp);
    if (driver) v.tone('sine', rnd(1600, 1850) * p, null, t, 0.12, 0.0006, 0.05, lp);
    else v.tone('sine', rnd(2800, 3600) * p, null, t, 0.06, 0.0004, 0.02, lp);
    return 0.12;
  },

  // ── Crowd ─────────────────────────────────────────────────────────────────────────────────
  applause(v) {
    return v.applause(v.t, v.p, 1);
  },
  cheer(v) {
    const d = v.applause(v.t, v.p, 0.7);
    return Math.max(d, v.crowdVoices(v.t + 0.05, v.p, 'cheer'));
  },
  groan(v) {
    return v.crowdVoices(v.t, v.p, 'groan');
  },

  // ── World ─────────────────────────────────────────────────────────────────────────────────
  car_door(v) {
    const { t, p } = v;
    v.noiseHit('white', 'bandpass', 2500, 2, t, 0.35, 0.0005, 0.012);             // latch
    const s = t + 0.012;
    v.tone('sine', 85 * p, 60 * p, s, 0.7, 0.002, 0.16);                          // thump
    v.noiseHit('pink', 'lowpass', 500 * p, 0.7, s, 0.6, 0.001, 0.12);
    v.noiseHit('white', 'bandpass', 320 * p, 6, s, 1.0, 0.001, 0.15);             // panel
    v.tone('sine', 1150 * p, null, s, 0.04, 0.001, 0.08);                         // metal
    return 0.45;
  },
  car_pass(v, pan) {
    const { t, p } = v;
    const D = rnd(3.0, 4.2);
    const dir = pan < 0 ? -1 : pan > 0 ? 1 : Math.random() < 0.5 ? -1 : 1;
    const mid = t + D * 0.5;
    const sum = v.gain(1);
    const pn = v.panner();
    if (pn) {
      pn.pan.setValueAtTime(-0.95 * dir, t);
      pn.pan.linearRampToValueAtTime(-0.35 * dir, mid - D * 0.08);
      pn.pan.linearRampToValueAtTime(0.35 * dir, mid + D * 0.08);
      pn.pan.linearRampToValueAtTime(0.95 * dir, t + D);
      sum.connect(pn).connect(v.out);
    } else sum.connect(v.out);
    const env = v.gain(0);
    const eg = env.gain;
    eg.setValueAtTime(0.0001, t);
    eg.exponentialRampToValueAtTime(0.25, mid - D * 0.15);
    eg.exponentialRampToValueAtTime(1, mid);
    eg.exponentialRampToValueAtTime(0.22, mid + D * 0.17);
    eg.exponentialRampToValueAtTime(0.0001, t + D);
    env.connect(sum);
    // tyre roar
    const s = v.src(v.k.pink, t, t + D + 0.05);
    const bp = v.filt('bandpass', 600 * p, 0.6);
    const lp = v.filt('lowpass', 900, 0.7);
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(4200, mid);
    lp.frequency.exponentialRampToValueAtTime(800, t + D);
    s.connect(bp).connect(lp).connect(v.gain(0.9)).connect(env);
    // engine hum with a Doppler drop as it passes
    const f = rnd(68, 95) * p, shift = 1.07;
    const elp = v.filt('lowpass', 380, 1.2);
    for (const base of [f, f * 2 * 1.004]) {
      const o = v.osc('sawtooth', base * shift, t, t + D + 0.05);
      o.frequency.setValueAtTime(base * shift, mid - D * 0.06);
      o.frequency.linearRampToValueAtTime(base / shift, mid + D * 0.06);
      o.connect(elp);
    }
    elp.connect(v.gain(0.22)).connect(env);
    return D + 0.1;
  },
  whoosh(v) {
    const { t, p } = v;
    const T = rnd(0.5, 0.65);
    const s = v.src(v.k.pink, t, t + T + 0.05);
    const bp = v.filt('bandpass', 300 * p, 0.9);
    bp.frequency.setValueAtTime(300 * p, t);
    bp.frequency.exponentialRampToValueAtTime(1500 * p, t + T * 0.55);
    bp.frequency.exponentialRampToValueAtTime(500 * p, t + T);
    const g = v.gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + T * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + T);
    s.connect(bp).connect(g);
    const pn = v.panner();
    const d = Math.random() < 0.5 ? -1 : 1;
    if (pn) {
      pn.pan.setValueAtTime(-0.45 * d, t);
      pn.pan.linearRampToValueAtTime(0.45 * d, t + T);
      g.connect(pn).connect(v.out);
    } else g.connect(v.out);
    return T + 0.05;
  },
};

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Generative music: lush pad, FM electric-piano arpeggio motifs, soft bass, vibraphone melody,
// light shaker. Markov-ish progression choice, occasional key changes, sections of varying density.
// ───────────────────────────────────────────────────────────────────────────────────────────────

interface Bus { dry: GainNode; wet: GainNode; }
interface Chord { r: number; iv: readonly number[]; }

const CHORDS: Record<string, Chord> = {
  I: { r: 0, iv: [0, 4, 7, 11, 14] },
  Iadd9: { r: 0, iv: [0, 4, 7, 14] },
  ii: { r: 2, iv: [0, 3, 7, 10, 14] },
  iii: { r: 4, iv: [0, 3, 7, 10] },
  IV: { r: 5, iv: [0, 4, 7, 11, 14] },
  iv: { r: 5, iv: [0, 3, 7, 9] },
  V: { r: 7, iv: [0, 5, 7, 10, 14] },
  vi: { r: 9, iv: [0, 3, 7, 10, 14] },
  II: { r: 2, iv: [0, 4, 7, 9] },
  bVII: { r: 10, iv: [0, 4, 7, 14] },
};
const PROGRESSIONS: readonly (readonly string[])[] = [
  ['I', 'IV', 'I', 'IV'],
  ['I', 'vi', 'ii', 'V'],
  ['IV', 'V', 'iii', 'vi'],
  ['I', 'II', 'I', 'II'],
  ['vi', 'IV', 'Iadd9', 'V'],
  ['I', 'iii', 'IV', 'iv'],
  ['Iadd9', 'bVII', 'IV', 'I'],
  ['ii', 'V', 'I', 'vi'],
  ['IV', 'I', 'II', 'IV'],
];
const PENTA = [0, 2, 4, 7, 9];
const RHYTHMS: readonly (readonly number[])[] = [
  [1, 0, 1, 0, 1, 0, 1, 0], [1, 0, 0, 1, 0, 0, 1, 0], [1, 0, 1, 1, 0, 1, 0, 0], [0, 0, 1, 0, 1, 0, 1, 1],
  [1, 0, 0, 0, 1, 0, 1, 0], [1, 1, 0, 1, 0, 0, 1, 0], [1, 0, 0, 1, 0, 1, 0, 0], [0, 1, 0, 1, 0, 1, 0, 1],
];

class Music {
  active = false;
  stopAt = 0;
  private readonly bpm = rnd(70, 80);
  private readonly e8 = 60 / this.bpm / 2;
  private next = 0;
  private step = 0;
  private key = pick([57, 60, 62, 64, 65, 67]);
  private prog: readonly string[] = [];
  private progIdx = 0;
  private progRep = 0;
  private chord: Chord = CHORDS.I;
  private pcs: number[] = [];
  private chordBars = 0;
  private newChord = false;
  private intensity = 0;
  private section = 4;
  private motif: (number | null)[] = [];
  private motifBar = 1;
  private pool: number[] = [];
  private mel: number[] = [];
  private melOn = false;
  private melWait = 0;
  private melNote = 76;
  private melPhrase = 4;
  private padCenter = 64;

  constructor(private readonly c: AudioContext, private readonly k: Kit, private readonly bus: Bus) {}

  start(t: number): void {
    this.active = true;
    this.next = t;
    this.step = 0;
    this.chordBars = 0;
    this.progIdx = 1e9;
    this.intensity = 0;
    this.section = 4;
    this.melOn = false;
    this.motifBar = 1;
    this.newMotif();
  }

  tick(now: number, lookahead: number): void {
    if (!this.active) return;
    if (this.next < now - 0.2) { // timer starved (background tab): skip, resync at a bar line
      this.next = now + 0.08;
      this.step = 0;
      this.chordBars = 0;
    }
    while (this.next < now + lookahead) {
      this.doStep(this.next);
      this.next += this.e8;
    }
  }

  private doStep(t: number): void {
    const s = this.step;
    if (s === 0) this.onBar(t);
    const tt = (s & 1 ? t + this.e8 * 0.14 : t) + rnd(-0.004, 0.004); // light swing + humanise
    const idx = this.motif[this.motifBar * 8 + s];
    if (idx !== null && idx !== undefined && this.pool.length && Math.random() < [0.5, 0.85, 0.92][this.intensity]) {
      this.ep(tt, this.pool[clamp(idx, 0, this.pool.length - 1)], (s % 4 === 0 ? 0.75 : 0.58) + rnd(-0.08, 0.08));
    }
    if (s === 0 && (this.intensity >= 1 || this.newChord)) this.bass(t, this.root(), this.intensity >= 1 ? 0.8 : 0.6);
    else if (s === 4 && this.intensity >= 1 && Math.random() < 0.55) this.bass(t, this.root() + (Math.random() < 0.6 ? 7 : 12), 0.6);
    if (this.intensity >= 2) this.shaker(tt, s & 1 ? 0.035 : 0.02);
    if (this.melOn) this.melodyStep(t, s);
    this.step = (s + 1) % 8;
  }

  private onBar(t: number): void {
    if (--this.section <= 0) {
      const r = Math.random();
      this.intensity = clamp(this.intensity + (r < 0.3 ? -1 : r < 0.62 ? 0 : 1), 0, 2);
      if (Math.random() < 0.1) this.intensity = 0; // occasional breather
      this.melOn = this.intensity >= 1 && Math.random() < 0.6;
      this.section = pick([4, 8, 8, 8, 12]);
    }
    this.motifBar ^= 1;
    if (this.motifBar === 0) {
      const r = Math.random();
      if (r < 0.22) this.newMotif(); else if (r < 0.7) this.mutateMotif();
    }
    this.newChord = false;
    if (this.chordBars <= 0) {
      this.nextChord();
      this.pad(t, this.e8 * 16);
      this.chordBars = 2;
      this.newChord = true;
    }
    this.chordBars--;
  }

  private root(): number {
    let m = this.key + this.chord.r;
    while (m >= 48) m -= 12;
    while (m < 36) m += 12;
    return m;
  }

  private nextChord(): void {
    if (this.progIdx >= this.prog.length) {
      if (this.prog.length && this.progRep < 1 && Math.random() < 0.4) this.progRep++;
      else {
        let p = pick(PROGRESSIONS);
        for (let g = 0; p === this.prog && g < 5; g++) p = pick(PROGRESSIONS);
        this.prog = p;
        this.progRep = 0;
        if (Math.random() < 0.2) {
          this.key += pick([5, -5, 7, -7, 2, -2]);
          while (this.key > 67) this.key -= 12;
          while (this.key < 56) this.key += 12;
        }
      }
      this.progIdx = 0;
    }
    this.chord = CHORDS[this.prog[this.progIdx++]] ?? CHORDS.I;
    const rootPc = (this.key + this.chord.r) % 12;
    this.pcs = this.chord.iv.map((i) => (rootPc + i) % 12);
    this.pool = [];
    for (let m = 60; m < 86; m++) if (this.pcs.includes(m % 12)) this.pool.push(m);
    const keyPc = this.key % 12;
    const ok = PENTA.map((d) => (keyPc + d) % 12).filter((pc) => !this.pcs.some((ct) => (pc - ct + 12) % 12 === 1));
    this.mel = [];
    for (let m = 67; m <= 86; m++) if (ok.includes(m % 12)) this.mel.push(m);
    this.padCenter = clamp(this.padCenter + rnd(-1.5, 1.5), 61, 67);
  }

  /** Close voicing: try each inversion, pick the one centred nearest padCenter (avoid a low m2). */
  private padNotes(): number[] {
    const rootPc = (this.key + this.chord.r) % 12;
    const pcs = this.chord.iv.filter((i) => i < 12).map((i) => (rootPc + i) % 12);
    let best: number[] = [], bestScore = Infinity;
    for (let r = 0; r < pcs.length; r++) {
      const v: number[] = [];
      let m = Math.round(this.padCenter - 7);
      for (let j = 0; j < pcs.length; j++) {
        const pc = pcs[(r + j) % pcs.length];
        while (m % 12 !== pc) m++;
        v.push(m);
        m++;
      }
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      const score = Math.abs(mean - this.padCenter) + (v.length > 1 && v[1] - v[0] <= 2 ? 4 : 0);
      if (score < bestScore) { bestScore = score; best = v; }
    }
    return best;
  }

  private newMotif(): void {
    const m1 = pick(RHYTHMS), m2 = Math.random() < 0.55 ? m1 : pick(RHYTHMS);
    const shape = rint(0, 4);
    let idx = rint(1, 3), k = 0;
    const out: (number | null)[] = [];
    for (let s = 0; s < 16; s++) {
      if (!(s < 8 ? m1 : m2)[s % 8]) { out.push(null); continue; }
      out.push(idx);
      switch (shape) {
        case 0: idx += pick([1, 1, 2]); break;
        case 1: idx -= pick([1, 1, 2]); break;
        case 2: idx += k % 4 < 2 ? 1 : -1; break;
        case 3: idx += k % 2 ? -2 : 3; break;
        default: idx += pick([-2, -1, 1, 1, 2]); break;
      }
      k++;
      if (idx > 7) idx -= 4;
      if (idx < 0) idx += 4;
    }
    this.motif = out;
  }

  private mutateMotif(): void {
    const m = this.motif.slice();
    for (let n = rint(1, 2); n > 0; n--) {
      const i = rint(0, 15), cur = m[i];
      if (cur === null || cur === undefined) m[i] = rint(0, 6);
      else if (Math.random() < 0.4) m[i] = null;
      else m[i] = clamp(cur + pick([-1, 1]), 0, 8);
    }
    this.motif = m;
  }

  private melodyStep(t: number, s: number): void {
    if (this.melWait > 0) { this.melWait--; return; }
    if (!this.mel.length || (s & 1 && Math.random() < 0.7)) return;
    let i = 0, bd = Infinity;
    this.mel.forEach((m, j) => { const d = Math.abs(m - this.melNote); if (d < bd) { bd = d; i = j; } });
    i = clamp(i + pick([-2, -1, -1, 0, 1, 1, 2]), 0, this.mel.length - 1);
    let note = this.mel[i];
    if (s % 4 === 0 && !this.pcs.includes(note % 12)) {
      for (const m of this.mel) if (this.pcs.includes(m % 12) && Math.abs(m - note) <= 2) { note = m; break; }
    }
    this.melNote = note;
    const len = pick([2, 3, 4, 4, 6]);
    this.vibes(t, note, len * this.e8, rnd(0.55, 0.8));
    this.melWait = len - 1;
    if (--this.melPhrase <= 0) { this.melWait += rint(4, 12); this.melPhrase = rint(3, 7); }
  }

  // ── instruments ──

  private send(b: Bag, node: AudioNode, wet: number): void {
    node.connect(this.bus.dry);
    if (wet > 0) node.connect(b.gain(wet)).connect(this.bus.wet);
  }

  /** FM electric piano (1:1 carrier/modulator with decaying index) plus a short tine partial. */
  private ep(t: number, midi: number, vel: number): void {
    const b = new Bag(this.c, this.k);
    const f = mtof(midi);
    const dur = clamp(2.6 - (midi - 60) * 0.05, 1.1, 2.8);
    const end = t + dur + 0.05;
    const car = b.osc('sine', f, t, end);
    const mod = b.osc('sine', f, t, end);
    const mg = b.gain(0);
    const ix = clamp(1.5 - (midi - 60) / 30, 0.5, 1.5) * (0.8 + vel);
    mg.gain.setValueAtTime(f * ix * 1.6, t);
    mg.gain.exponentialRampToValueAtTime(f * ix * 0.1, t + 0.8);
    mod.connect(mg).connect(car.frequency);
    const amp = b.gain(0);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.12 * vel, t + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.055 * vel, t + 0.3);
    amp.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    car.connect(amp);
    const tine = b.osc('sine', f * 4, t, t + 0.2);
    const tg = b.gain(0);
    perc(tg.gain, t, 0.15 * vel, 0.001, 0.12);
    tine.connect(tg).connect(amp);
    const pn = b.pan(clamp((midi - 72) / 28 + rnd(-0.15, 0.15), -0.6, 0.6));
    amp.connect(pn);
    this.send(b, pn, 0.35);
    car.onended = () => b.dispose();
  }

  /** Warm detuned pad, left/right oscillator pairs merged to stereo, slow filter swell. */
  private pad(t: number, len: number): void {
    const b = new Bag(this.c, this.k);
    const notes = this.padNotes();
    const end = t + len + 4;
    const m = b.add(this.c.createChannelMerger(2));
    for (const n of notes) {
      for (let side = 0; side < 2; side++) {
        const o = b.osc('custom', mtof(n), t, end);
        o.detune.value = (side ? 1 : -1) * rnd(4, 9);
        o.connect(m, 0, side);
      }
    }
    const lp = b.filt('lowpass', 450, 0.5);
    lp.frequency.setValueAtTime(450, t);
    lp.frequency.linearRampToValueAtTime(rnd(1000, 1700), t + len * 0.55);
    lp.frequency.linearRampToValueAtTime(500, t + len + 3);
    const lvl = 0.05;
    const g = b.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(lvl, t + 1.8);
    g.gain.setValueAtTime(lvl, t + len);
    g.gain.setTargetAtTime(0, t + len, 0.7);
    m.connect(lp).connect(g);
    this.send(b, g, 0.55);
    b.srcs[0].onended = () => b.dispose();
  }

  private bass(t: number, midi: number, vel: number): void {
    const b = new Bag(this.c, this.k);
    const f = mtof(midi), end = t + 1.8;
    const o = b.osc('sine', f, t, end);
    const o2 = b.osc('triangle', f * 2, t, end);
    const g = b.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22 * vel, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.08 * vel, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 1.7);
    o.connect(g);
    o2.connect(b.gain(0.15)).connect(g);
    const lp = b.filt('lowpass', 900, 0.7);
    g.connect(lp);
    this.send(b, lp, 0.05);
    o.onended = () => b.dispose();
  }

  private shaker(t: number, vel: number): void {
    const b = new Bag(this.c, this.k);
    const s = b.src(this.k.white, t, t + 0.09);
    const hp = b.filt('highpass', 6500, 0.7);
    const g = b.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.012);
    g.gain.exponentialRampToValueAtTime(vel * 0.01, t + 0.08);
    const pn = b.pan(0.35);
    s.connect(hp).connect(g).connect(pn);
    this.send(b, pn, 0.2);
    s.onended = () => b.dispose();
  }

  /** Vibraphone-ish: sine + 4th partial, motor tremolo. */
  private vibes(t: number, midi: number, len: number, vel: number): void {
    const b = new Bag(this.c, this.k);
    const f = mtof(midi);
    const dur = Math.min(len + 1.4, 3.2), end = t + dur + 0.05;
    const o = b.osc('sine', f, t, end);
    const o4 = b.osc('sine', f * 4, t, t + 0.6);
    const g4 = b.gain(0);
    perc(g4.gain, t, 0.18, 0.002, 0.35);
    const trem = b.gain(0.75);
    const lfo = b.osc('sine', rnd(4.8, 5.6), t, end);
    lfo.connect(b.gain(0.25)).connect(trem.gain);
    const g = b.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.085 * vel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(trem);
    o4.connect(g4).connect(trem);
    trem.connect(g);
    const pn = b.pan(rnd(-0.35, 0.35));
    g.connect(pn);
    this.send(b, pn, 0.5);
    o.onended = () => b.dispose();
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Ambience: continuous layers (created lazily, torn down after being silent for a while) plus
// event-driven birdsong, crickets, rain drips and the odd owl.
// ───────────────────────────────────────────────────────────────────────────────────────────────

type LayerName = 'wind' | 'rain' | 'crowd' | 'water' | 'night';
const LAYER_NAMES: readonly LayerName[] = ['wind', 'rain', 'crowd', 'water', 'night'];

interface Layer {
  bag: Bag;
  cur: number;
  zeroAt: number;
  apply(v: number, t: number): void;
  mod?(t: number, v: number): void;
}

type Species = 'chirp' | 'tweet' | 'trill' | 'song' | 'feebee' | 'warble' | 'dove';
interface Bird { sp: Species; pan: number; dist: number; base: number; motif: [number, number][]; next: number; left: number; }
const SPECIES: readonly Species[] = ['chirp', 'chirp', 'tweet', 'trill', 'song', 'song', 'feebee', 'warble', 'dove'];
const BIRD_BASE: Record<Species, [number, number]> = {
  chirp: [3000, 4200], tweet: [2500, 3500], trill: [3000, 4400], song: [1700, 2900],
  feebee: [3300, 4000], warble: [2400, 3400], dove: [470, 600],
};
const BIRD_GAP: Record<Species, [number, number]> = {
  chirp: [2, 5], tweet: [1.5, 4], trill: [3, 8], song: [2.5, 6], feebee: [4, 9], warble: [3, 7], dove: [6, 12],
};
const MOTIF_RATIOS = [0.8, 0.9, 1, 1, 1.12, 1.25, 1.33, 1.5];

class Ambience {
  readonly target: AmbienceParams = { daylight: 1, rain: 0, wind: 0, crowd: 0, water: 0 };
  private readonly layers: Partial<Record<LayerName, Layer>> = {};
  private readonly birds: Bird[] = [];
  private readonly birdBus: GainNode;
  private birdLv = -1;
  private last = -1;

  constructor(private readonly c: AudioContext, private readonly k: Kit, private readonly bus: Bus) {
    this.birdBus = c.createGain();
    this.birdBus.gain.value = 0;
    this.birdBus.connect(bus.dry);
    const s = c.createGain();
    s.gain.value = 0.3;
    this.birdBus.connect(s).connect(bus.wet);
  }

  activeLayers(): string[] {
    return LAYER_NAMES.filter((n) => this.layers[n]).map((n) => `${n}:${(this.layers[n]?.cur ?? 0).toFixed(2)}`);
  }

  tick(now: number): void {
    const dt = this.last < 0 ? 0.05 : clamp(now - this.last, 0, 0.5);
    this.last = now;
    const P = this.target;
    const vals: Record<LayerName, number> = {
      wind: P.wind, rain: P.rain, crowd: P.crowd, water: P.water,
      night: (1 - smooth(0.12, 0.5, P.daylight)) * (1 - 0.75 * P.rain) * (1 - 0.5 * P.wind),
    };
    for (const name of LAYER_NAMES) {
      const v = vals[name];
      let L = this.layers[name];
      try {
        if (v > 0.002) {
          if (!L) { L = this.build(name, now); this.layers[name] = L; }
          if (Math.abs(v - L.cur) > 0.002) { L.apply(v, now); L.cur = v; }
          L.zeroAt = -1;
          L.mod?.(now, v);
        } else if (L) {
          if (L.cur !== 0) { L.apply(0, now); L.cur = 0; L.zeroAt = now; }
          else if (now - L.zeroAt > 6) { L.bag.dispose(); this.layers[name] = undefined; }
        }
      } catch { /* one broken layer must not stop the rest */ }
    }
    const birds = smooth(0.3, 0.75, P.daylight) * (1 - 0.9 * P.rain) * (1 - 0.55 * P.wind);
    if (Math.abs(birds - this.birdLv) > 0.005) {
      this.birdBus.gain.setTargetAtTime(Math.sqrt(birds), now, 0.8);
      this.birdLv = birds;
    }
    this.birdTick(now, birds);
    if (P.rain > 0.05 && Math.random() < dt * (0.3 + 2.2 * P.rain)) this.drip(now + rnd(0.01, 0.06), P.rain);
    if (vals.night > 0.5 && Math.random() < dt / 50) this.owl(now + 0.05);
  }

  private out(b: Bag, wet: number): GainNode {
    const o = b.gain(0);
    o.connect(this.bus.dry);
    if (wet > 0) o.connect(b.gain(wet)).connect(this.bus.wet);
    return o;
  }

  private build(name: LayerName, now: number): Layer {
    switch (name) {
      case 'wind': return this.buildWind(now);
      case 'rain': return this.buildRain(now);
      case 'crowd': return this.buildCrowd(now);
      case 'water': return this.buildWater(now);
      default: return this.buildNight(now);
    }
  }

  private buildWind(now: number): Layer {
    const b = new Bag(this.c, this.k);
    const out = this.out(b, 0);
    const sides = [-0.7, 0.7].map((pv) => {
      const bp = b.filt('bandpass', 500, 0.8);
      const g = b.gain(0.5);
      b.src(this.k.pink, now, undefined, 1, true).connect(bp).connect(g).connect(b.pan(pv)).connect(out);
      return { bp, g, gust: Math.random(), vel: 0 };
    });
    const lp = b.filt('lowpass', 180, 0.7);
    const lg = b.gain(0);
    b.src(this.k.brown, now, undefined, 1, true).connect(lp).connect(lg).connect(out);
    const whf = b.filt('bandpass', 1400, 9);
    const whg = b.gain(0);
    b.src(this.k.pink, now, undefined, 1, true).connect(whf).connect(whg).connect(out);
    let w = 0, nextMod = 0;
    return {
      bag: b, cur: -1, zeroAt: -1,
      apply: (v, t) => {
        w = v;
        out.gain.setTargetAtTime(v * 0.6, t, 0.8);
        lg.gain.setTargetAtTime(smooth(0.4, 1, v) * 0.8, t, 1);
      },
      mod: (t) => {
        if (t < nextMod) return;
        nextMod = t + rnd(0.25, 0.5);
        for (const s of sides) { // gusts: damped random walk with momentum
          s.vel = s.vel * 0.85 + rnd(-0.07, 0.07);
          s.gust += s.vel;
          if (s.gust < 0) { s.gust = 0; s.vel = Math.abs(s.vel); }
          if (s.gust > 1) { s.gust = 1; s.vel = -Math.abs(s.vel); }
          s.bp.frequency.setTargetAtTime(280 + 500 * w + 700 * s.gust * (0.5 + w), t, 0.7);
          s.g.gain.setTargetAtTime(0.25 + 0.75 * s.gust, t, 0.6);
        }
        whf.frequency.setTargetAtTime(1100 + 900 * sides[0].gust, t, 0.8);
        whg.gain.setTargetAtTime(smooth(0.55, 1, w) * sides[1].gust * 0.25, t, 0.8);
      },
    };
  }

  private buildRain(now: number): Layer {
    const b = new Bag(this.c, this.k);
    const out = this.out(b, 0.15);
    const hp = b.filt('highpass', 600, 0.6), lp = b.filt('lowpass', 6000, 0.5), hg = b.gain(0);
    b.stereo(this.k.white, now).connect(hp).connect(lp).connect(hg).connect(out);
    const blp = b.filt('lowpass', 1000, 0.6), bg = b.gain(0);
    b.stereo(this.k.pink, now).connect(blp).connect(bg).connect(out);
    const dg = b.gain(0);
    b.src(this.k.drops(), now, undefined, 1, true).connect(dg).connect(out);
    let r = 0, nextMod = 0;
    return {
      bag: b, cur: -1, zeroAt: -1,
      apply: (v, t) => {
        r = v;
        out.gain.setTargetAtTime(Math.min(1, v * 4), t, 0.8);
        bg.gain.setTargetAtTime(smooth(0.3, 1, v) * 0.45, t, 1);
        dg.gain.setTargetAtTime(Math.pow(v, 0.7) * 0.4 * (1 - 0.35 * v), t, 1);
        lp.frequency.setTargetAtTime(3500 + 5000 * v, t, 1);
      },
      mod: (t) => {
        if (t < nextMod) return;
        nextMod = t + rnd(0.6, 1.4);
        hg.gain.setTargetAtTime(Math.pow(r, 1.1) * 0.3 * rnd(0.85, 1.12), t, 0.9);
      },
    };
  }

  private buildCrowd(now: number): Layer {
    const b = new Bag(this.c, this.k);
    const out = this.out(b, 0.25);
    const swellG = b.gain(1);
    const hp = b.filt('highpass', 140, 0.7);
    const lp = b.filt('lowpass', 2600, 0.6);
    lp.connect(hp).connect(swellG).connect(out);
    const bab = this.k.babble();
    b.src(bab, now, undefined, 1, true).connect(lp);
    b.src(bab, now, undefined, 0.92, true).connect(b.gain(0.8)).connect(lp);
    const walla = b.stereo(this.k.pink, now);
    for (const [f, q, rate] of [[380, 1.6, 3.1], [850, 2.2, 4.3], [1700, 2.6, 5.7]] as const) {
      const bp = b.filt('bandpass', f, q);
      const g = b.gain(0.35);
      b.osc('sine', rate * rnd(0.9, 1.1), now).connect(b.gain(0.22)).connect(g.gain); // syllabic flutter
      walla.connect(bp).connect(g).connect(lp);
    }
    let nextMod = 0;
    return {
      bag: b, cur: -1, zeroAt: -1,
      apply: (v, t) => {
        out.gain.setTargetAtTime(Math.pow(v, 1.1) * 0.55, t, 0.8);
        lp.frequency.setTargetAtTime(1800 + 1600 * v, t, 1);
      },
      mod: (t) => {
        if (t < nextMod) return;
        nextMod = t + rnd(0.6, 1.4);
        swellG.gain.setTargetAtTime(rnd(0.75, 1.15), t, 1.2);
      },
    };
  }

  private buildWater(now: number): Layer {
    const b = new Bag(this.c, this.k);
    const out = this.out(b, 0.2);
    const hp = b.filt('highpass', 250, 0.7);
    const wg = b.gain(1);
    const tex = this.k.water();
    b.src(tex, now, undefined, 1, true).connect(hp);
    b.src(tex, now, undefined, 0.83, true).connect(b.gain(0.6)).connect(hp);
    hp.connect(wg).connect(out);
    const bp = b.filt('bandpass', 900, 0.5);
    const bedG = b.gain(0.12);
    b.stereo(this.k.pink, now).connect(bp).connect(bedG).connect(out);
    let nextMod = 0;
    return {
      bag: b, cur: -1, zeroAt: -1,
      apply: (v, t) => out.gain.setTargetAtTime(v * 0.6, t, 0.8),
      mod: (t) => {
        if (t < nextMod) return;
        nextMod = t + rnd(0.8, 2);
        wg.gain.setTargetAtTime(rnd(0.8, 1.1), t, 1);
        bp.frequency.setTargetAtTime(rnd(700, 1300), t, 1.5);
      },
    };
  }

  private buildNight(now: number): Layer {
    const b = new Bag(this.c, this.k);
    const out = this.out(b, 0.3);
    const crickets = Array.from({ length: rint(3, 4) }, () => {
      const cg = b.gain(0);
      b.osc('sine', rnd(4300, 5200), now).connect(cg).connect(b.pan(rnd(-0.85, 0.85))).connect(out);
      return {
        cg, amp: rnd(0.25, 0.6), period: rnd(0.45, 0.9), pulses: rint(2, 4), pgap: rnd(0.022, 0.034),
        next: now + rnd(0, 1), restUntil: 0,
      };
    });
    // distant insect chorus: narrow-band noise pulsing at ~23 Hz
    const bp = b.filt('bandpass', rnd(5200, 6200), 6);
    const am = b.gain(0.5);
    b.osc('sine', rnd(20, 26), now).connect(b.gain(0.5)).connect(am.gain);
    b.stereo(this.k.white, now).connect(bp).connect(am).connect(b.gain(1.2)).connect(out);
    return {
      bag: b, cur: -1, zeroAt: -1,
      apply: (v, t) => out.gain.setTargetAtTime(v * 0.3, t, 0.8),
      mod: (t) => {
        for (const cr of crickets) {
          if (cr.next < t) cr.next = t + 0.02;
          while (cr.next < t + 0.4) {
            const tt = cr.next;
            if (tt >= cr.restUntil) {
              for (let i = 0; i < cr.pulses; i++) {
                const tp = tt + i * cr.pgap;
                cr.cg.gain.setValueAtTime(0, tp);
                cr.cg.gain.linearRampToValueAtTime(cr.amp, tp + 0.004);
                cr.cg.gain.linearRampToValueAtTime(0, tp + cr.pgap * 0.65);
              }
              if (Math.random() < 0.025) cr.restUntil = tt + rnd(2, 7);
            }
            cr.next += cr.period * rnd(0.96, 1.04);
          }
        }
      },
    };
  }

  // ── birds ──

  private newBird(now: number): Bird {
    const sp = pick(SPECIES);
    const [a, b] = BIRD_BASE[sp];
    const motif: [number, number][] = [];
    for (let i = rint(3, 6); i > 0; i--) motif.push([pick(MOTIF_RATIOS), rnd(0.07, 0.2)]);
    return { sp, pan: rnd(-0.9, 0.9), dist: rnd(0.1, 1), base: rnd(a, b), motif, next: now + rnd(0.3, 4), left: rint(3, 9) };
  }

  private birdTick(now: number, lv: number): void {
    const want = lv < 0.03 ? 0 : Math.max(1, Math.round(lv * 5));
    while (this.birds.length < want) this.birds.push(this.newBird(now));
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const bd = this.birds[i];
      if (now < bd.next) continue;
      if (this.birds.length > want) { this.birds.splice(i, 1); continue; }
      if (bd.next > now - 1) { try { this.sing(bd, Math.max(now + 0.02, bd.next)); } catch { /* ignore */ } }
      if (--bd.left <= 0) { this.birds[i] = this.newBird(now); continue; }
      const [g0, g1] = BIRD_GAP[bd.sp];
      bd.next = now + rnd(g0, g1) * (1.4 - 0.6 * lv);
    }
  }

  private sing(bd: Bird, t: number): void {
    const b = new Bag(this.c, this.k);
    const o = b.osc('sine', bd.base, t);
    const am = b.gain(1);
    const env = b.gain(0);
    const lp = b.filt('lowpass', bd.sp === 'dove' ? 1400 : 9000 - 5000 * bd.dist, 0.7);
    o.connect(am).connect(env).connect(lp).connect(b.pan(bd.pan)).connect(this.birdBus);
    const A = (bd.sp === 'dove' ? 0.14 : 0.09) * (1 - 0.65 * bd.dist) * rnd(0.8, 1.1);
    const F = o.frequency, G = env.gain, B = bd.base;
    G.setValueAtTime(0, t);
    let end = t;
    switch (bd.sp) {
      case 'chirp': {
        let tt = t;
        for (let i = rint(3, 6); i > 0; i--) {
          F.setValueAtTime(B * rnd(1.15, 1.3), tt);
          F.exponentialRampToValueAtTime(B * rnd(0.7, 0.8), tt + 0.045);
          G.setValueAtTime(0, tt);
          G.linearRampToValueAtTime(A, tt + 0.006);
          G.linearRampToValueAtTime(0, tt + 0.05);
          tt += rnd(0.075, 0.11);
        }
        end = tt;
        break;
      }
      case 'tweet': {
        let tt = t;
        for (let i = rint(1, 3); i > 0; i--) {
          F.setValueAtTime(B * 0.62, tt);
          F.exponentialRampToValueAtTime(B * 1.3, tt + 0.085);
          G.setValueAtTime(0, tt);
          G.linearRampToValueAtTime(A, tt + 0.02);
          G.linearRampToValueAtTime(0, tt + 0.09);
          tt += rnd(0.12, 0.16);
        }
        end = tt;
        break;
      }
      case 'trill': {
        const d = rnd(0.5, 1.1);
        const m = b.osc('triangle', rnd(18, 30), t, t + d + 0.05);
        m.connect(b.gain(B * rnd(0.06, 0.12))).connect(F);
        am.gain.value = 0.6;
        m.connect(b.gain(0.4)).connect(am.gain);
        F.setValueAtTime(B, t);
        F.linearRampToValueAtTime(B * rnd(0.88, 1.08), t + d);
        G.linearRampToValueAtTime(A, t + 0.08);
        G.setValueAtTime(A, t + d - 0.12);
        G.linearRampToValueAtTime(0, t + d);
        end = t + d;
        break;
      }
      case 'song': {
        if (Math.random() < 0.3) bd.motif[rint(0, bd.motif.length - 1)] = [pick(MOTIF_RATIOS), rnd(0.07, 0.2)];
        const notes = Math.random() < 0.25 ? bd.motif.slice(0, Math.max(2, bd.motif.length - 2)) : bd.motif;
        let tt = t;
        F.setValueAtTime(B * notes[0][0], tt);
        for (const [r, d] of notes) {
          F.linearRampToValueAtTime(B * r, tt + 0.02);
          F.setValueAtTime(B * r, tt + d * 0.7);
          F.linearRampToValueAtTime(B * r * rnd(0.94, 1.06), tt + d);
          G.setValueAtTime(0, tt);
          G.linearRampToValueAtTime(A, tt + 0.015);
          G.setValueAtTime(A, tt + d - 0.02);
          G.linearRampToValueAtTime(0, tt + d);
          tt += d + rnd(0.025, 0.07);
        }
        if (bd.base > 2300) b.osc('sine', rnd(25, 40), t, tt).connect(b.gain(B * 0.015)).connect(F);
        end = tt;
        break;
      }
      case 'feebee': {
        F.setValueAtTime(B, t);
        F.linearRampToValueAtTime(B * 0.98, t + 0.28);
        G.linearRampToValueAtTime(A, t + 0.03);
        G.setValueAtTime(A, t + 0.24);
        G.linearRampToValueAtTime(0, t + 0.28);
        const t2 = t + 0.36;
        F.setValueAtTime(B * 0.84, t2);
        F.linearRampToValueAtTime(B * 0.82, t2 + 0.32);
        G.setValueAtTime(0, t2);
        G.linearRampToValueAtTime(A * 0.9, t2 + 0.03);
        G.setValueAtTime(A * 0.9, t2 + 0.27);
        G.linearRampToValueAtTime(0, t2 + 0.32);
        end = t2 + 0.32;
        break;
      }
      case 'warble': {
        let tt = t;
        G.linearRampToValueAtTime(A, t + 0.02);
        for (let i = rint(8, 14); i > 0; i--) {
          const d = rnd(0.03, 0.05);
          F.linearRampToValueAtTime(B * rnd(0.8, 1.5), tt + d * 0.5);
          G.linearRampToValueAtTime(A * rnd(0.4, 1), tt + d * 0.5);
          tt += d;
        }
        G.linearRampToValueAtTime(0, tt + 0.03);
        end = tt + 0.03;
        break;
      }
      default: { // dove: soft distant coo
        let tt = t;
        for (const [r, d] of [[0.92, 0.22], [1.05, 0.42], [0.98, 0.26], [0.94, 0.3]] as const) {
          F.setValueAtTime(B * r, tt);
          F.linearRampToValueAtTime(B * r * 0.96, tt + d);
          G.setValueAtTime(0, tt);
          G.linearRampToValueAtTime(A, tt + 0.05);
          G.setValueAtTime(A, tt + d - 0.08);
          G.linearRampToValueAtTime(0, tt + d);
          tt += d + 0.09;
        }
        end = tt;
        break;
      }
    }
    o.stop(end + 0.05);
    o.onended = () => b.dispose();
  }

  private drip(t: number, r: number): void {
    const b = new Bag(this.c, this.k);
    const f0 = rnd(900, 2600);
    const o = b.osc('sine', f0, t, t + 0.09);
    o.frequency.exponentialRampToValueAtTime(f0 * rnd(1.3, 1.8), t + 0.03);
    const e = b.gain(0);
    perc(e.gain, t, rnd(0.015, 0.05) * (0.6 + r * 0.4), 0.001, 0.05);
    const pn = b.pan(rnd(-0.9, 0.9));
    o.connect(e).connect(pn).connect(this.bus.dry);
    pn.connect(b.gain(0.4)).connect(this.bus.wet);
    o.onended = () => b.dispose();
  }

  private owl(t: number): void {
    const b = new Bag(this.c, this.k);
    const B = rnd(360, 420);
    const o = b.osc('triangle', B, t, t + 1.9);
    const e = b.gain(0);
    const pn = b.pan(rnd(-0.8, 0.8));
    o.connect(e).connect(b.filt('lowpass', 900, 0.7)).connect(pn).connect(this.bus.dry);
    pn.connect(b.gain(0.6)).connect(this.bus.wet);
    const A = rnd(0.05, 0.09), G = e.gain;
    G.setValueAtTime(0, t);
    for (const [dt, d] of [[0, 0.34], [0.62, 0.16], [0.86, 0.2], [1.2, 0.55]] as const) {
      const tt = t + dt;
      o.frequency.setValueAtTime(B * (dt === 0 ? 1.02 : 1), tt);
      o.frequency.linearRampToValueAtTime(B * 0.93, tt + d);
      G.setValueAtTime(0, tt);
      G.linearRampToValueAtTime(A, tt + 0.06);
      G.setValueAtTime(A * 0.85, tt + d - 0.08);
      G.linearRampToValueAtTime(0, tt + d);
    }
    o.onended = () => b.dispose();
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Engine
// ───────────────────────────────────────────────────────────────────────────────────────────────

interface Graph {
  c: AudioContext;
  master: GainNode;
  limiter: DynamicsCompressorNode;
  sfx: Bus;
  amb: Bus;
  mus: Bus;
  kit: Kit;
  ambience: Ambience;
  music: Music;
}

type Volumes = { master: number; sfx: number; ambience: number; music: number };
type ACCtor = new (opts?: AudioContextOptions) => AudioContext;

export class AudioEngine {
  private g: Graph | null = null;
  private dead = false;
  private paused = false;
  private unlockAt = -1e9;
  private timer: ReturnType<typeof setInterval> | null = null;
  private warned = false;
  private vol: Volumes = { master: 0.8, sfx: 0.9, ambience: 0.7, music: 0.5 };
  private focus = 0;
  private musicOn = true;
  private readonly pendingAmb: Partial<AmbienceParams> = {};
  private readonly lastLv = new Map<AudioParam, number>();
  private readonly active = new Map<SfxName, number>();
  private readonly lastStart = new Map<SfxName, number>();
  private voices = 0;

  constructor() {
    // Convenience: unlock on the first user gesture even if the integrator forgets to.
    try {
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        const h = (): void => this.unlock();
        for (const ev of ['pointerdown', 'mousedown', 'touchend', 'keydown']) {
          window.addEventListener(ev, h, { capture: true, passive: true });
        }
      }
    } catch { /* ignore */ }
  }

  /** True once the AudioContext exists and is running (sound is actually audible). */
  get ready(): boolean {
    return !!this.g && this.g.c.state === 'running';
  }

  /** Call from a user gesture (click/keydown). Safe to call repeatedly. */
  unlock(): void {
    if (this.dead) return;
    try {
      if (!this.g && !this.init()) return;
      const c = this.g!.c;
      this.unlockAt = nowMs();
      if (!this.paused && c.state !== 'running' && c.state !== 'closed') {
        const r = c.resume() as Promise<void> | undefined;
        if (r && typeof r.catch === 'function') r.catch(() => { /* ignore */ });
      }
    } catch (e) {
      this.fail(e);
    }
  }

  play(name: SfxName, opts?: PlayOpts): void {
    const g = this.g;
    if (!g || this.paused || this.dead) return;
    try {
      const c = g.c;
      if (c.state !== 'running' && (c.state === 'closed' || nowMs() - this.unlockAt > 1000)) return;
      const cfg = SFX[name], synth = SYNTHS[name];
      if (!cfg || !synth) return;
      const vol = clamp(num(opts?.volume, 1), 0, 4);
      if (vol < 0.001) return;
      const now = c.currentTime;
      const t = now + clamp(num(opts?.delay, 0), 0, 30);
      const act = this.active.get(name) ?? 0;
      if (act >= cfg.max || this.voices >= MAX_GLOBAL_VOICES) return;
      const last = this.lastStart.get(name);
      if (last !== undefined && Math.abs(t - last) < cfg.gap) return;

      const pitch = clamp(num(opts?.pitch, 1), 0.25, 4) * (1 + (Math.random() * 2 - 1) * cfg.vary);
      const pan = clamp(num(opts?.pan, 0), -1, 1);
      const out = c.createGain();
      out.gain.value = vol * cfg.gain;
      let tail: AudioNode = out;
      let pn: StereoPannerNode | null = null;
      if (!cfg.ownPan && pan !== 0 && typeof c.createStereoPanner === 'function') {
        pn = c.createStereoPanner();
        pn.pan.value = pan;
        out.connect(pn);
        tail = pn;
      }
      tail.connect(g.sfx.dry);
      let send: GainNode | null = null;
      if (cfg.rev > 0) {
        send = c.createGain();
        send.gain.value = cfg.rev;
        tail.connect(send).connect(g.sfx.wet);
      }
      const v = new Voice(c, g.kit, t, pitch, out);
      const teardown = (): void => {
        v.dispose();
        try { out.disconnect(); pn?.disconnect(); send?.disconnect(); } catch { /* ignore */ }
      };
      let dur: number;
      try {
        dur = synth(v, pan);
      } catch (e) {
        teardown();
        throw e;
      }
      this.active.set(name, act + 1);
      this.voices++;
      this.lastStart.set(name, t);
      const end = t + dur + 0.05;
      const cleanup = (): void => {
        const rem = c.state === 'closed' ? 0 : end - c.currentTime;
        if (rem > 0.02) { setTimeout(cleanup, rem * 1000 + 30); return; } // still playing (or paused)
        teardown();
        this.active.set(name, Math.max(0, (this.active.get(name) ?? 1) - 1));
        this.voices = Math.max(0, this.voices - 1);
      };
      setTimeout(cleanup, (end - now) * 1000 + 30);
    } catch (e) {
      this.warn(e);
    }
  }

  /** Smoothly ramps ambience layers (call every frame or so, cheap). */
  setAmbience(p: Partial<AmbienceParams>): void {
    if (!p) return;
    try {
      const dst = this.g ? this.g.ambience.target : this.pendingAmb;
      for (const k of ['daylight', 'rain', 'wind', 'crowd', 'water'] as const) {
        const v = p[k];
        if (typeof v === 'number' && Number.isFinite(v)) dst[k] = clamp01(v);
      }
    } catch { /* ignore */ }
  }

  setVolumes(v: { master?: number; sfx?: number; ambience?: number; music?: number }): void {
    if (!v) return;
    const o = this.vol;
    o.master = clamp01(num(v.master, o.master));
    o.sfx = clamp01(num(v.sfx, o.sfx));
    o.ambience = clamp01(num(v.ambience, o.ambience));
    o.music = clamp01(num(v.music, o.music));
    this.applyLevels(0.05);
  }

  getVolumes(): { master: number; sfx: number; ambience: number; music: number } {
    return { ...this.vol };
  }

  /** Gentle generative background music. Fades in/out. */
  setMusicEnabled(on: boolean): void {
    this.musicOn = !!on;
    const g = this.g;
    if (!g) return;
    try {
      this.applyLevels(0.05, on ? 1.2 : 0.6);
      const now = g.c.currentTime;
      if (on && !g.music.active) g.music.start(now + 0.15);
      if (!on) g.music.stopAt = now + 4;
    } catch (e) {
      this.warn(e);
    }
  }

  /** Duck music/ambience (e.g. while the player is swinging), 0..1 */
  setFocus(f: number): void {
    this.focus = clamp01(num(f, 0));
    this.applyLevels(0.15);
  }

  /** Suspend/resume everything (e.g. when tab hidden or game paused menu). */
  setPaused(p: boolean): void {
    this.paused = !!p;
    const g = this.g;
    if (!g) return;
    try {
      const c = g.c;
      if (c.state === 'closed') return;
      const r = (this.paused ? c.suspend() : c.resume()) as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => { /* ignore */ });
    } catch { /* ignore */ }
  }

  /** @internal Debug snapshot for the dev test page. */
  debugInfo(): { state: string; voices: number; time: number; music: boolean; layers: string[] } {
    const g = this.g;
    return {
      state: this.dead ? 'unavailable' : g ? g.c.state : 'locked',
      voices: this.voices,
      time: g ? g.c.currentTime : 0,
      music: !!g && g.music.active,
      layers: g ? g.ambience.activeLayers() : [],
    };
  }

  // ── internals ──

  private init(): boolean {
    const w = (typeof window !== 'undefined' ? window : undefined) as
      | (Window & { webkitAudioContext?: ACCtor; AudioContext?: ACCtor })
      | undefined;
    const AC: ACCtor | undefined = w?.AudioContext ?? w?.webkitAudioContext;
    if (!AC) { this.dead = true; return false; }
    let c: AudioContext;
    try { c = new AC({ latencyHint: 'interactive' }); } catch { c = new AC(); }

    const master = c.createGain();
    master.gain.value = 0;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 28;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3;
    comp.attack.value = 0.005; comp.release.value = 0.25;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -2.5; lim.knee.value = 0; lim.ratio.value = 20;
    lim.attack.value = 0.002; lim.release.value = 0.1;
    master.connect(hp).connect(comp).connect(lim).connect(c.destination);

    const revIn = c.createBiquadFilter();
    revIn.type = 'highpass';
    revIn.frequency.value = 220;
    const conv = c.createConvolver();
    conv.normalize = false;
    conv.buffer = makeImpulse(c, 2.4, 3);
    const revOut = c.createGain();
    revOut.gain.value = 0.5;
    revIn.connect(conv).connect(revOut).connect(master);

    const bus = (): Bus => {
      const dry = c.createGain(), wet = c.createGain();
      dry.gain.value = 0; wet.gain.value = 0;
      dry.connect(master); wet.connect(revIn);
      return { dry, wet };
    };
    const sfx = bus(), amb = bus(), mus = bus();
    const kit = new Kit(c);
    const ambience = new Ambience(c, kit, amb);
    Object.assign(ambience.target, this.pendingAmb);
    const music = new Music(c, kit, mus);
    this.g = { c, master, limiter: lim, sfx, amb, mus, kit, ambience, music };

    // iOS: play a silent buffer inside the gesture to fully unlock output.
    try {
      const s = c.createBufferSource();
      s.buffer = c.createBuffer(1, 1, 22050);
      s.connect(c.destination);
      s.start(0);
    } catch { /* ignore */ }

    this.applyLevels(0.02, 1.5);
    master.gain.setTargetAtTime(this.levels().master, c.currentTime, 0.3);
    if (this.musicOn) music.start(c.currentTime + 0.4);
    if (this.paused) { try { void c.suspend().catch(() => { /* ignore */ }); } catch { /* ignore */ } }
    this.timer = setInterval(() => this.tick(), 50);
    kit.prewarm();
    return true;
  }

  private levels(): { master: number; sfx: number; amb: number; mus: number } {
    const v = this.vol, f = this.focus, sq = (x: number): number => x * x;
    return {
      master: sq(v.master),
      sfx: sq(v.sfx),
      amb: sq(v.ambience) * (1 - 0.5 * f),
      mus: sq(v.music) * 2.0 * (this.musicOn ? 1 : 0) * (1 - 0.7 * f),
    };
  }

  private applyLevels(tc: number, musicTc = tc): void {
    const g = this.g;
    if (!g) return;
    try {
      const now = g.c.currentTime, lv = this.levels();
      const set = (p: AudioParam, val: number, k: number): void => {
        const prev = this.lastLv.get(p);
        if (prev !== undefined && Math.abs(prev - val) < 1e-4) return;
        this.lastLv.set(p, val);
        p.setTargetAtTime(val, now, Math.max(0.005, k));
      };
      set(g.master.gain, lv.master, tc);
      set(g.sfx.dry.gain, lv.sfx, tc); set(g.sfx.wet.gain, lv.sfx, tc);
      set(g.amb.dry.gain, lv.amb, tc); set(g.amb.wet.gain, lv.amb, tc);
      set(g.mus.dry.gain, lv.mus, musicTc); set(g.mus.wet.gain, lv.mus, musicTc);
    } catch (e) {
      this.warn(e);
    }
  }

  private tick(): void {
    const g = this.g;
    if (!g || g.c.state !== 'running') return;
    const now = g.c.currentTime;
    try { g.ambience.tick(now); } catch (e) { this.warn(e); }
    try {
      if (!this.musicOn && g.music.active && now > g.music.stopAt) g.music.active = false;
      const hidden = typeof document !== 'undefined' && document.hidden;
      g.music.tick(now, hidden ? 1.2 : 0.3);
    } catch (e) { this.warn(e); }
  }

  private warn(e: unknown): void {
    if (this.warned) return;
    this.warned = true;
    try { console.warn('[audio] suppressed error:', e); } catch { /* ignore */ }
  }

  private fail(e: unknown): void {
    this.warn(e);
    this.dead = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    try { this.g?.c.close().catch(() => { /* ignore */ }); } catch { /* ignore */ }
    this.g = null;
  }
}

/** Singleton used by the game. */
export const audio: AudioEngine = new AudioEngine();
