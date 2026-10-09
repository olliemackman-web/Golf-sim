// A pre-built showcase club used as the living backdrop of the title screen.
import { MAP, ROAD_ROW, Surf } from './core/constants';
import { Game } from './sim/Game';

function rect(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const t: { x: number; y: number }[] = [];
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) t.push({ x, y });
  return t;
}

function blob(cx: number, cy: number, rx: number, ry: number): { x: number; y: number }[] {
  const t: { x: number; y: number }[] = [];
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    if (dx * dx + dy * dy <= 1) t.push({ x, y });
  }
  return t;
}

function corridor(g: Game, ax: number, ay: number, bx: number, by: number, w: number, surf: Surf): void {
  const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
  const tiles: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const x = Math.round(ax + ((bx - ax) * i) / n), y = Math.round(ay + ((by - ay) * i) / n);
    tiles.push(...blob(x, y, w, w));
  }
  g.paint(tiles, surf);
}

export function buildDemo(): Game {
  const g = Game.newGame('Willow Creek Golf Club', true, 4242);
  const cx = MAP / 2;
  const R = ROAD_ROW;
  // more land
  for (let py = 5; py < 10; py++) for (let px = 2; px < 8; px++) if (!g.world.owned[py * 10 + px]) g.world.buyParcel(px, py);
  g.pf.invalidate();
  // clubhouse & amenities around the entrance
  g.placeItem('clubhouse', cx + 6, R - 16, 0);
  g.upgradeObject(g.world.objectsOfType('clubhouse')[0].id);
  g.placeItem('cafe', cx + 13, R - 12, 3);
  g.placeItem('pro_shop', cx - 4, R - 13, 1);
  g.placeItem('toilets', cx + 13, R - 7, 3);
  g.placeItem('carpark', cx - 22, R - 4, 0);
  g.placeItem('fountain', cx + 3, R - 9, 0);
  g.paint(rect(cx + 2, R - 10, cx + 5, R - 2), Surf.Paving);
  for (const [x, y] of [[cx + 1, R - 3], [cx + 6, R - 3], [cx + 1, R - 6], [cx + 6, R - 6]]) g.placeItem('lamp', x, y, 0);
  for (let i = 0; i < 6; i++) g.placeItem(['flowers_red', 'flowers_yellow', 'flowers_purple'][i % 3], cx - 1 + (i % 2) * 8, R - 10 + Math.floor(i / 2) * 2, 0);
  // driving range to the west, hitting north
  for (let i = 0; i < 8; i++) g.placeItem(i < 4 ? 'bay_covered' : 'bay_basic', cx - 30 + i, R - 14, 0);
  g.placeItem('dispenser', cx - 32, R - 13, 0);
  g.placeItem('target_ring', cx - 28, R - 40, 0);
  g.placeItem('target_flag', cx - 33, R - 30, 0);
  g.placeItem('target_flag', cx - 22, R - 50, 0);
  g.placeItem('picker_shed', cx - 36, R - 14, 0);
  // hole 1: par 4 heading north-east with a pond
  g.paint(rect(cx + 18, R - 10, cx + 20, R - 8), Surf.Tee);
  corridor(g, cx + 19, R - 14, cx + 26, R - 46, 2, Surf.Fairway);
  g.paint(blob(cx + 27, R - 51, 3.4, 2.8), Surf.Green);
  g.paint(blob(cx + 31, R - 50, 1.3, 1.6), Surf.Bunker);
  g.paint(blob(cx + 23, R - 54, 1.6, 1.1), Surf.Bunker);
  g.paint(blob(cx + 15, R - 30, 3.5, 4.5), Surf.Water);
  g.createHole({ x: cx + 19, y: R - 9 }, { x: cx + 27, y: R - 51 });
  // hole 2: par 3 over water
  g.paint(rect(cx + 31, R - 58, cx + 33, R - 56), Surf.Tee);
  g.paint(blob(cx + 40, R - 72, 4, 3.4), Surf.Water);
  g.paint(blob(cx + 44, R - 79, 3, 2.8), Surf.Green);
  g.paint(blob(cx + 47, R - 77, 1.2, 1.4), Surf.Bunker);
  g.createHole({ x: cx + 32, y: R - 57 }, { x: cx + 44, y: R - 79 });
  // hole 3: long par 5 back west
  g.paint(rect(cx + 36, R - 86, cx + 38, R - 84), Surf.Tee);
  corridor(g, cx + 33, R - 85, cx - 2, R - 80, 2, Surf.Fairway);
  corridor(g, cx - 2, R - 80, cx - 22, R - 70, 2, Surf.Fairway);
  g.paint(blob(cx - 26, R - 68, 3.2, 3.2), Surf.Green);
  g.paint(blob(cx + 8, R - 84, 1.5, 1.2), Surf.Bunker);
  g.paint(blob(cx - 12, R - 72, 1.6, 1.3), Surf.Bunker);
  g.paint(blob(cx - 29, R - 64, 1.4, 1.2), Surf.Bunker);
  g.createHole({ x: cx + 37, y: R - 85 }, { x: cx - 26, y: R - 68 });
  // paths
  corridor(g, cx + 4, R - 11, cx + 17, R - 12, 0, Surf.Path);
  // trees lining the holes
  const trees = ['tree_oak', 'tree_birch', 'tree_maple', 'tree_pine', 'tree_willow', 'tree_cherry'];
  let k = 0;
  for (const h of g.course.holes) {
    for (let i = 1; i < h.route.length; i++) {
      const a = h.route[i - 1], b = h.route[i];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      for (let d = 20; d < L - 20; d += 18) {
        const t = d / L;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        const nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
        for (const side of [-1, 1]) {
          const off = 30 + (k % 3) * 4;
          g.placeTree(trees[k++ % trees.length], x + nx * off * side, z + nz * off * side);
        }
      }
    }
  }
  for (const t of [['bench', cx + 16, R - 11], ['ball_washer', cx + 21, R - 9], ['tee_sign', cx + 17, R - 9], ['shelter', cx + 34, R - 62]] as [string, number, number][]) g.placeItem(t[0], t[1], t[2], 0);
  // staff
  g.hire('greenkeeper');
  g.hire('greenkeeper');
  g.hire('range');
  g.hire('cleaner');
  g.state.reputation = 72;
  g.state.minute = 9.5 * 60;
  g.state.weather.kind = 'sunny';
  g.state.flags.demo = 1;
  g.prestigeCache = g.prestige();
  return g;
}
