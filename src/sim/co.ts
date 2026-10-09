// Coroutine helpers. Every `yield` hands control back to the simulation for one frame and resumes with dt (sim seconds).
import type { Co } from './agents';

export function* wait(t: number): Generator<void, void, number> {
  while (t > 0) t -= yield;
}

/** Wait until cond() is true. Returns false on timeout. */
export function* until(cond: () => boolean, timeout = Infinity, onTick?: (dt: number) => void): Generator<void, boolean, number> {
  let t = 0;
  while (!cond()) {
    const dt = yield;
    t += dt;
    onTick?.(dt);
    if (t > timeout) return false;
  }
  return true;
}

/** Run several coroutines in parallel until all have finished. */
export function* all(cos: Co[]): Generator<void, void, number> {
  let live = cos.slice();
  let dt = 0;
  for (;;) {
    live = live.filter((c) => !c.next(dt).done);
    if (!live.length) return;
    dt = yield;
  }
}

/** Run a coroutine to completion (drives it each frame). Use with yield*. */
export function* run<T>(c: Generator<void, T, number>): Generator<void, T, number> {
  return yield* c;
}
