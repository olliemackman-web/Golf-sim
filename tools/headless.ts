// Headless simulation smoke test / balance harness. Bundle with esbuild and run in node.
import { Game, dayProfit, fmt } from '../src/sim/Game';
import { MAP, ROAD_ROW, Surf } from '../src/core/constants';

const g = Game.newGame('Test Club', false, 1234);
g.state.money = 60000;
const log = (s: string) => console.log(s);
g.events.on('notify', (n) => { if (n.kind !== 'info') log(`  [${g.state.day} ${g.timeString()}] ${n.text}`); });

// build a small range north of the entrance
const cx = MAP / 2;
let r = 0;
for (let i = 0; i < 6; i++) {
  const res = g.placeItem('bay_basic', cx - 10 + i, ROAD_ROW - 22, 0);
  if (!res.ok) log('bay fail ' + res.reason);
}
log('dispenser ' + JSON.stringify(g.placeItem('dispenser', cx - 12, ROAD_ROW - 20, 0)));
log('cafe ' + JSON.stringify(g.placeItem('cafe', cx + 8, ROAD_ROW - 14, 0)));
log('toilets ' + JSON.stringify(g.placeItem('toilets', cx + 12, ROAD_ROW - 13, 0)));
log('target ' + JSON.stringify(g.placeItem('target_flag', cx - 8, ROAD_ROW - 40, 0)));
log('hire ' + JSON.stringify(g.hire('range')));

g.events.on('day', (d) => {
  const th = Array.from(g.sim.thoughts.values()).sort((a, b) => b.count - a.count).slice(0, 8);
  log(`-- end of day ${d.day}: weather ${g.state.weather.kind} lost ${g.lostBallsToday} owned ${g.state.ballsOwned} field ${g.sim.field.n}`);
  for (const t of th) log(`    ${t.count}x ${t.good ? '+' : '-'} ${t.text}`);
});
function rect(x0: number, y0: number, x1: number, y1: number) {
  const t: { x: number; y: number }[] = [];
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) t.push({ x, y });
  return t;
}
function makeHole(tx: number, ty: number, px: number, py: number) {
  // fairway corridor along the line
  const n = Math.max(Math.abs(px - tx), Math.abs(py - ty));
  const fw: { x: number; y: number }[] = [];
  for (let i = 4; i <= n - 3; i++) {
    const x = Math.round(tx + ((px - tx) * i) / n), y = Math.round(ty + ((py - ty) * i) / n);
    fw.push(...rect(x - 2, y - 2, x + 2, y + 2));
  }
  g.paint(fw, Surf.Fairway);
  g.paint(rect(tx - 1, ty - 1, tx + 1, ty + 1), Surf.Tee);
  g.paint(rect(px - 2, py - 2, px + 2, py + 2), Surf.Green);
  g.paint(rect(px + 3, py - 1, px + 3, py + 1), Surf.Bunker);
  const r = g.createHole({ x: tx, y: ty }, { x: px, y: py });
  const h = g.course.holes[g.course.holes.length - 1];
  log(`hole ${h.num}: ${r.ok} valid=${h.valid} par ${h.par} ${h.yards}yds rating ${h.rating.toFixed(0)} issues=${h.issues.join('; ')}`);
}
if (process.argv[3] === 'course') {
  g.state.money = 400000;
  g.state.chapter = 3;
  log('clubhouse ' + JSON.stringify(g.placeItem('clubhouse', cx + 14, ROAD_ROW - 24, 0)));
  makeHole(cx + 26, ROAD_ROW - 8, cx + 28, ROAD_ROW - 40);
  makeHole(cx + 30, ROAD_ROW - 44, cx + 20, ROAD_ROW - 60);
  makeHole(cx + 15, ROAD_ROW - 60, cx - 20, ROAD_ROW - 62);
  log('hire gk ' + JSON.stringify(g.hire('greenkeeper')));
}
const days = +(process.argv[2] ?? 3);
const t0 = Date.now();
let frames = 0;
while (g.state.day <= days) {
  g.speed = 4;
  g.update(1 / 30);
  frames++;
  if (frames % 3000 === 0 && process.argv[4] === 'staff') for (const p of g.sim.people) if (p.kind === 'staff') log(`     ${g.timeString()} ${p.role} ${p.activity} @${p.x.toFixed(0)},${p.z.toFixed(0)} moving=${p.moving} carry=${p.carry} veh=${!!p.vehicle}`);
  if (frames % 20000 === 0) log(`   day ${g.state.day} ${g.timeString()} people=${g.sim.people.length} groups=${g.sim.groups.length} field=${g.sim.field.n} avail=${g.sim.ballsAvailable()}`);
}
for (const d of g.state.stats.history) {
  log(`Day ${d.day}: visitors ${d.visitors} profit ${fmt(dayProfit(d))} income ${JSON.stringify(d.income)} exp ${JSON.stringify(d.expense)} rep ${d.rep.toFixed(1)} happy ${(d.happiness / Math.max(1, d.happyCount)).toFixed(1)}`);
}
log(`money ${fmt(g.state.money)} rep ${g.state.reputation.toFixed(1)} ms ${Date.now() - t0}`);
const th = Array.from(g.sim.thoughts.values()).sort((a, b) => b.count - a.count).slice(0, 12);
for (const t of th) log(`  ${t.count}x ${t.good ? '+' : '-'} ${t.text}`);
void r; void Surf;
