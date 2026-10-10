// On-screen error and notice box. Phones have no console, so problems (shader errors, a lost 3D view,
// script errors) are shown here where the player can read them or take a screenshot.

let box: HTMLDivElement | null = null;
let list: HTMLDivElement | null = null;
const seen = new Set<string>();

function ensureBox(): void {
  if (box) return;
  box = document.createElement('div');
  box.className = 'err-box';
  box.innerHTML = `<div class="eh"><b>Something went wrong</b><span class="eb"><button type="button" data-e="reload">Reload</button><button type="button" data-e="close" aria-label="Close">✕</button></span></div><div class="el"></div>`;
  list = box.querySelector('.el');
  box.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest('[data-e]')?.getAttribute('data-e');
    if (act === 'close') box!.hidden = true;
    else if (act === 'reload') location.reload();
  });
  document.body.appendChild(box);
}

function text(err: unknown): string {
  let s = err instanceof Error ? err.message : typeof err === 'string' ? err : (() => {
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  })();
  // three.js shader errors carry the whole shader source; keep the material type and the ERROR lines
  if (s.includes('ERROR:')) {
    const mat = /Material Type: (\w+)/.exec(s)?.[1];
    const lines = s.split('\n').filter((l) => /ERROR:/.test(l)).slice(0, 3);
    s = `Shader error${mat ? ` (${mat})` : ''}: ${lines.join(' ')}`;
  }
  return s.replace(/\s+/g, ' ').trim().slice(0, 400);
}

/** Show an error once (repeats of the same message are ignored). */
export function reportError(where: string, err: unknown): void {
  const msg = text(err);
  const key = where + '|' + msg;
  if (seen.has(key) || seen.size > 40) return;
  seen.add(key);
  ensureBox();
  box!.hidden = false;
  box!.classList.remove('info-only');
  const line = document.createElement('div');
  line.textContent = `${where}: ${msg}`;
  list!.appendChild(line);
}

/** A non-error notice in the same place (e.g. "switched to Low graphics"). */
export function notice(msg: string): void {
  if (seen.has('notice|' + msg)) return;
  seen.add('notice|' + msg);
  ensureBox();
  const fresh = box!.hidden || !list!.children.length;
  box!.hidden = false;
  if (fresh) box!.classList.add('info-only');
  const head = box!.querySelector('.eh b') as HTMLElement;
  if (box!.classList.contains('info-only')) head.textContent = 'Heads up';
  const line = document.createElement('div');
  line.textContent = msg;
  list!.appendChild(line);
}

let installed = false;

export function installErrorHandlers(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => reportError('Script error', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => reportError('Script error', e.reason));
  // three.js reports shader and framebuffer problems through console.error
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    orig(...args);
    const s = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
    if (/THREE|WebGL|shader|framebuffer/i.test(s)) reportError('Graphics', s);
  };
}
