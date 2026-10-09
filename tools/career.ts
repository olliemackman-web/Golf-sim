// Headless balance harness: builds a club in stages and reports the economy day by day.
// Usage: esbuild tools/career.ts --bundle --platform=node --outfile=/tmp/career.cjs && node /tmp/career.cjs [days] [stage]
import { MAP, PARCELS, ROAD_ROW, Surf } from '../src/core/constants';
import { Game, dayProfit, fmt } from '../src/sim/Game';

const days = +(process.argv[2] ?? 6);
const stage = +(process.argv[3] ?? 1);
const g = Game.newGame('Harness GC', false, 777);
const log = (s: string) => console.log(s);
let notes = 0;
g.events.on('notify', (n) => {
  if (n.kind === 'goal' || (n.kind === 'bad' && notes++ < 12)) log(`  [d${g.state.day} ${g.timeString()}] ${n.text}`);
});

function rect(x0: number, y0: number, x1: number, y1: number) {
  const t: { x: number; y: number }[] = [];
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) t.push({ x, y });
  return t;
}
function blob(cx: number, cy: number, rx: number, ry: number) {
  const t: { x: number; y: number }[] = [];
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    if (dx * dx + dy * dy <= 1) t.push({ x, y });
  }
  return t;
}
function hole(tx: number, ty: number, px: number, py: number) {
  const n = Math.max(Math.abs(px - tx), Math.abs(py - ty));
  const fw: { x: number; y: number }[] = [];
  for (let i = 4; i <= n - 3; i++) {
    const x = Math.round(tx + ((px - tx) * i) / n), y = Math.round(ty + ((py - ty) * i) / n);
    fw.push(...blob(x, y, 2.4, 2.4));
  }
  g.paint(fw, Surf.Fairway);
  g.paint(rect(tx - 1, ty - 1, tx + 1, ty + 1), Surf.Tee);
  g.paint(blob(px, py, 3, 3), Surf.Green);
  g.paint(blob(px + 4, py, 1.2, 1.5), Surf.Bunker);
  g.paint(blob(px - 3, py + 3, 1.2, 1.2), Surf.Bunker);
  const r = g.createHole({ x: tx, y: ty }, { x: px, y: py });
  if (!r.ok) log('hole fail ' + r.reason);
}

const cx = MAP / 2;
const R = ROAD_ROW;
g.state.money = 40000;
// stage 1: starter range
for (let i = 0; i < 6; i++) g.placeItem('bay_basic', cx - 22 + i, R - 14, 3);
g.placeItem('dispenser', cx - 23, R - 16, 0);
g.placeItem('cafe', cx + 8, R - 10, 0);
g.placeItem('toilets', cx + 12, R - 9, 0);
g.placeItem('target_flag', cx - 2, R - 14, 0);
g.hire('range');
if (stage >= 2) {
  g.state.money += 900000;
  g.state.chapter = 3;
  g.state.reputation = 40;
  for (let i = 6; i < 12; i++) g.placeItem('bay_basic', cx - 22 + (i % 6), R - 16 - Math.floor(i / 6) * 3, 3);
  g.placeItem('picker_shed', cx - 26, R - 14, 0);
  g.placeItem('clubhouse', cx + 14, R - 20, 0);
  g.hire('greenkeeper');
  g.hire('cleaner');
  // buy all land for testing
  for (let py = 0; py < PARCELS; py++) for (let px = 0; px < PARCELS; px++) g.world.owned[py * PARCELS + px] = 1;
  g.world.emit('owned', { px: 0, py: 0 });
  const nHoles = stage >= 3 ? 9 : 3;
  const nh = stage >= 4 ? 18 : nHoles;
  for (let k = 0; k < nh; k++) {
    const col = k % 9, row = Math.floor(k / 9);
    const x = 12 + col * 16;
    const y0 = row === 0 ? 70 : 20;
    if (col % 2 === 0) hole(x, y0 + 40, x + 2, y0);
    else hole(x, y0, x - 2, y0 + 40);
  }
  log(`holes: ${g.course.holes.map((h) => `${h.num}:${h.valid ? 'ok' : h.issues[0]} p${h.par} ${h.yards}y r${h.rating.toFixed(0)}`).join(' | ')}`);
  if (stage >= 3) {
    g.placeItem('pro_shop', cx + 22, R - 12, 0);
    g.placeItem('bar', cx + 26, R - 20, 0);
    g.hire('greenkeeper');
    g.hire('range');
    g.state.research.done.push('loyalty_program', 'golf_carts');
    g.placeItem('cart_shed', cx + 30, R - 10, 0);
    g.placeItem('carpark', cx + 2, R - 4, 0);
    g.state.reputation = 60;
  }
  if (stage >= 4) {
    g.hire('greenkeeper');
    g.hire('marshal');
    g.hire('marshal');
    g.placeItem('carpark', cx + 10, R - 4, 0);
    g.placeItem('carpark', cx + 18, R - 4, 0);
    g.state.reputation = 75;
    g.state.members = 100;
  }
}
log(`start money ${fmt(g.state.money)} prestige ${g.prestige().toFixed(0)}`);

g.events.on('day', (d) => {
  const th = Array.from(g.sim.thoughts.values()).sort((a, b) => b.count - a.count).slice(0, 6);
  const r = d.record;
  const valid = g.course.validHoles();
  log(`Day ${d.day} [${g.state.weather.kind}] visitors ${r.visitors} profit ${fmt(dayProfit(r))} rep ${g.state.reputation.toFixed(1)} happy ${(r.happiness / Math.max(1, r.happyCount)).toFixed(0)} | inc ${Object.entries(r.income).map(([k, v]) => `${k}:${Math.round(v ?? 0)}`).join(' ')} | exp ${Object.entries(r.expense).map(([k, v]) => `${k}:${Math.round(v ?? 0)}`).join(' ')}`);
  log(`   turned away (parking): ${g.state.flags.parkingFull ?? 0}`);
  g.state.flags.parkingFull = 0;
  if (valid.length) log(`   pace: ${valid.map((h) => (h.groupsTimed ? (h.playTime / h.groupsTimed).toFixed(0) : '-')).join(',')} s/hole; walk-in groups ${g.sim.groups.length}`);
  if (valid.length) log(`   course: rounds ${valid.reduce((s, h) => s + h.roundsPlayed, 0)} avgcond ${(valid.reduce((s, h) => s + h.condition, 0) / valid.length).toFixed(0)} queue ${valid.map((h) => h.queue.length).join('')} members ${g.state.members.toFixed(0)}`);
  for (const t of th) log(`     ${t.count}x ${t.good ? '+' : '-'} ${t.text}`);
});

const t0 = Date.now();
let frames = 0;
let maxPeople = 0;
while (g.state.day <= days) {
  g.speed = 8;
  g.update(1 / 30);
  frames++;
  maxPeople = Math.max(maxPeople, g.sim.people.length);
  if (frames % 2000 === 0) {
    // stuck detection: visitors who have been on site for more than a game day
    const stuck = g.sim.people.filter((p) => p.kind === 'visitor' && p.busy > 1500);
    if (stuck.length) log(`   !! ${stuck.length} long-stay visitors e.g. ${stuck[0].activity} moving=${stuck[0].moving}`);
  }
}
log(`money ${fmt(g.state.money)} rep ${g.state.reputation.toFixed(1)} prestige ${g.prestige().toFixed(0)} maxPeople ${maxPeople} ms ${Date.now() - t0}`);
