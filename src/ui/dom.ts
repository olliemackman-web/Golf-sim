// Small DOM helpers.
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Delegate clicks on [data-act] elements inside root. */
export function delegate(root: HTMLElement, handler: (act: string, arg: string, target: HTMLElement, e: MouseEvent) => void): void {
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t || !root.contains(t)) return;
    if ((t as HTMLButtonElement).disabled) return;
    handler(t.dataset.act!, t.dataset.arg ?? '', t, e);
  });
}

export function money(n: number, cents = false): string {
  const neg = n < 0;
  const v = Math.abs(n);
  let s: string;
  if (v >= 1e7) s = (v / 1e6).toFixed(1) + 'M';
  else if (v >= 1e6) s = (v / 1e6).toFixed(2) + 'M';
  else s = v.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return (neg ? '−$' : '$') + s;
}

export function starsHtml(rep: number): string {
  const s = rep / 20;
  let out = '';
  for (let i = 1; i <= 5; i++) {
    if (s >= i - 0.25) out += '★';
    else if (s >= i - 0.75) out += '<span style="position:relative;display:inline-block"><span class="off">★</span><span style="position:absolute;left:0;top:0;width:50%;overflow:hidden">★</span></span>';
    else out += '<span class="off">★</span>';
  }
  return `<span class="stars">${out}</span>`;
}

export function bar(frac: number, cls = ''): string {
  return `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(1, frac)) * 100}%"></i></div>`;
}

export function safeStorage(): Storage | null {
  try {
    const s = window.localStorage;
    const k = '__fe_test__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}
