// Tiny canvas charts drawn with the UI palette.
export interface Series {
  values: number[];
  color: string;
  kind: 'bar' | 'line';
  label: string;
}

export function drawChart(canvas: HTMLCanvasElement, labels: string[], series: Series[], fmt: (n: number) => string): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth || 600, H = canvas.clientHeight || 190;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const padL = 56, padR = 10, padT = 10, padB = 22;
  const all = series.flatMap((s) => s.values);
  let max = Math.max(0, ...all), min = Math.min(0, ...all);
  if (max === min) max = min + 1;
  const span = max - min;
  const nice = Math.pow(10, Math.floor(Math.log10(span / 4)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * nice).find((s) => span / s <= 5) ?? nice * 10;
  max = Math.ceil(max / step) * step;
  min = Math.floor(min / step) * step;
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const n = Math.max(1, labels.length);
  const bw = (W - padL - padR) / n;
  const x = (i: number) => padL + bw * (i + 0.5);
  ctx.font = '600 10.5px Manrope, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (let v = min; v <= max + 1e-6; v += step) {
    ctx.strokeStyle = v === 0 ? 'rgba(233,222,190,.35)' : 'rgba(233,222,190,.08)';
    ctx.beginPath();
    ctx.moveTo(padL, y(v));
    ctx.lineTo(W - padR, y(v));
    ctx.stroke();
    ctx.fillStyle = 'rgba(201,192,166,.8)';
    ctx.textAlign = 'right';
    ctx.fillText(fmt(v), padL - 6, y(v));
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const every = Math.ceil(n / 10);
  labels.forEach((l, i) => {
    if (i % every === 0 || i === n - 1) ctx.fillText(l, x(i), H - padB + 6);
  });
  for (const s of series) {
    if (s.kind === 'bar') {
      s.values.forEach((v, i) => {
        ctx.fillStyle = v >= 0 ? s.color : '#e5735f';
        const y0 = y(0), y1 = y(v);
        const h = y1 - y0;
        roundRect(ctx, x(i) - bw * 0.32, Math.min(y0, y1), bw * 0.64, Math.abs(h), 3);
      });
    } else {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      s.values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
      ctx.stroke();
      const li = s.values.length - 1;
      if (li >= 0) {
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(x(li), y(s.values[li]), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}
