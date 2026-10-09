import { World } from '../src/world/World';
import { BallPhysics } from '../src/play/BallPhysics';
import { CLUBS } from '../src/data/clubs';
import { Surf, YARDS_PER_WORLD } from '../src/core/constants';
const w = new World(1);
w.generate();
w.final.fill(0);
w.surf.fill(Surf.Fairway);
w.owned.fill(1);
const mul = +(process.argv[2] ?? 1);
for (const c of CLUBS) {
  if (c.putter) continue;
  const b = new BallPhysics(w);
  b.place(300, 500);
  b.launch({ speed: c.speed * mul, launchDeg: c.launch, yaw: Math.PI, spinRpm: c.spin * (0.7 + 0.3 * mul), tilt: 0 });
  let t = 0;
  while (b.moving && t < 30) { b.step(1 / 60); t += 1 / 60; }
  console.log(`${c.short.padEnd(3)} carry ${Math.round(b.stats.carry * YARDS_PER_WORLD)} total ${Math.round(b.stats.total * YARDS_PER_WORLD)} yds apex ${Math.round(b.stats.apex * 3.28)} ft hang ${b.stats.hang.toFixed(1)}s (ref ${c.carry})`);
}
// slice test
const b = new BallPhysics(w);
b.place(300, 500);
b.launch({ speed: 70, launchDeg: 11, yaw: Math.PI, spinRpm: 2700, tilt: 0.25 });
let t = 0; while (b.moving && t < 30) { b.step(1 / 60); t += 1 / 60; }
console.log('slice offline yds', Math.round(b.stats.offline * YARDS_PER_WORLD));
// putt test: 5m real putt on flat green
w.surf.fill(Surf.Green);
for (const sp of [1, 2, 3, 4]) {
  const p = new BallPhysics(w);
  p.place(300, 500);
  p.putt(sp, 0);
  let tt = 0; while (p.moving && tt < 30) { p.step(1 / 60); tt += 1 / 60; }
  console.log(`putt ${sp} m/s rolls ${(p.stats.total * 1.65).toFixed(1)} m real`);
}
