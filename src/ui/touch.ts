// Input mode: tracks whether the player is using a touch screen so hints and controls can adapt,
// and whether the screen is small enough for the compact phone layout.

/** Same breakpoint as the compact layout in styles.css. */
export const COMPACT_QUERY = '(max-width: 760px), (max-height: 520px)';

export const input = { touch: false };

export function isCompact(): boolean {
  return window.matchMedia(COMPACT_QUERY).matches;
}

let started = false;

/** Call once at startup. Sets `body.touch` while the last pointer used was a finger. */
export function initInputMode(): void {
  if (started) return;
  started = true;
  input.touch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && !window.matchMedia('(pointer: fine)').matches;
  document.body.classList.toggle('touch', input.touch);
  window.addEventListener(
    'pointerdown',
    (e) => {
      const t = e.pointerType === 'touch';
      if (t === input.touch) return;
      input.touch = t;
      document.body.classList.toggle('touch', t);
    },
    { capture: true, passive: true },
  );
}

/** Pick the keyboard/mouse or touch wording for a hint. */
export function hint(mouse: string, touch: string): string {
  return input.touch ? touch : mouse;
}

export function canFullscreen(): boolean {
  return !!document.fullscreenEnabled;
}

export function toggleFullscreen(): void {
  try {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  } catch {
    /* not allowed here */
  }
}
