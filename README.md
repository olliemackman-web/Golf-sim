# Fairway Empire

A golf course & driving range tycoon game that runs in the browser. Start with a patch of farmland by the road, build a driving range, lay out holes, keep visitors happy, and grow your club through six career chapters into a championship golf resort. Then step up to the tee and play it yourself.

Built with TypeScript and Three.js. Every model, texture and sound is generated in code, so there are no asset files.

## Play

Play online at **https://olliemackman-web.github.io/Golf-sim/**, on desktop or phone.

To run it locally:

```bash
npm install
npm run dev        # http://localhost:5173
```

`npm run build` produces a static site in `dist/`. `npm run build:single` also writes `dist/fairway-empire.html`, a single self-contained file you can open directly or host anywhere.

## The game

**Build**
- **Driving range:** grass, covered and tracker bays, ball dispensers, target greens, a ball-picker garage and floodlights. Every range ball is tracked. Balls that land off your land or in water are lost, and Range Assistants have to collect the rest.
- **Course design:** paint fairways, greens, tee boxes, bunkers, water, cart paths and long grass, then place a tee and a pin to create a hole. Par comes from the hole's length. Each hole is routed and rated for design, hazards, scenery and turf condition, and gets flagged if it is too close to another hole or in the line of fire from the range.
- **Buildings:** clubhouse (three levels), café, pro shop, restaurant, 19th-hole bar, cart barn, academy, maintenance shed, car parks, grandstands, helipad and a grand hotel.
- **Scenery:** eight tree species, flower beds, hedges, fountains, a gazebo, statues, a windmill and more. Trees change colour with the seasons.
- **Terrain:** raise, lower, flatten and smooth the land. Water levels follow the ground.
- **Land:** buy neighbouring parcels to expand. Prices rise with every purchase.

**Manage**
- **Visitors:** nine visitor types (beginners, juniors, regulars, business clients, touring pros, helicopter VIPs and more), each with their own skill, budget, patience and price sensitivity. They drive in, park, buy buckets, play rounds hole by hole with simulated shots, eat, shop, use the restrooms, drop litter and go home with an opinion.
- **Staff:** greenkeepers mow worn turf, range assistants collect balls, groundskeepers pick up litter, marshals speed up play and golf pros teach paid lessons. Staff can be trained up to level 5.
- **Economy:** set prices for range buckets, green fees, cart hire, lessons, memberships, food, merchandise and hotel rooms, and watch how visitors react. The finance screen tracks every income and expense line, with daily charts. Loans are available.
- **Research:** 24 upgrades, such as irrigation, tracker bays, GPS carts, championship greens, TV rights and robotic mowers.
- **Marketing campaigns, memberships, weather and seasons, reputation stars, and day and night.**
- **Tournaments:** host the Club Championship, Regional Open, National Championship and The Grand Open, with pro groups, spectators, sponsorship, TV money and a live leaderboard.

**Progress**

Six career chapters with 35 goals take you from *Breaking Ground* to *Legend of the Links*, unlocking new buildings and research along the way. Sandbox mode gives unlimited money with everything unlocked.

**Have a Go**
- **Real ball physics:** drag, Magnus lift, spin, wind, bounce, roll, green slopes, tree and building collisions, water hazards and out of bounds.
- **Classic three-click swing meter**, with hooks, slices and overswing.
- **Driving range:** free practice with launch-monitor data, plus Long Drive, Target and Closest-to-the-Pin challenges with prize money.
- **Your own course:** play single holes or full rounds, set course records, and enter your own tournaments against the AI field.
- **Your golfer:** levels up and spends skill points on power, accuracy, short game and putting. Better club sets are sold in your pro shop.

## Controls

| Action | Keys |
| --- | --- |
| Move camera | W A S D / arrow keys, or drag the map |
| Rotate / zoom | Q / E, mouse wheel, right-drag |
| Pause / speed | Space, 1–4 |
| Rotate item | R |
| Brush size | [ and ] |
| Cancel / menu | Esc |
| Golf: aim | A / D or right-drag |
| Golf: change club | W / S or mouse wheel |
| Golf: swing | click or Space (start, power, accuracy) |
| Golf: camera | C |

**On a phone or tablet** the layout switches to a compact version in portrait and landscape:

| Action | Touch |
| --- | --- |
| Move camera | Drag one finger |
| Zoom / rotate | Pinch / twist two fingers |
| Tilt | Slide two fingers up or down together |
| Build | Pick an item, tap the map to position it, then press **Place** (and **Rotate**) in the bar above the dock |
| Paint, trees, terrain, remove | One finger paints; two fingers move the camera |
| Goals and management | **Chapter** and **Manage** buttons under the top bar |
| Golf | Drag to aim, tap to swing, tap again for power and accuracy (you can tap the meter itself) |

The renderer lowers its resolution automatically if the frame rate drops, so it stays smooth on phones.

## Project layout

```
src/
  core/      constants, seeded RNG + noise, events
  data/      items, research, goals, visitors, staff, clubs, tournaments
  world/     tile world, A* pathfinding, hole routing & ratings
  sim/       game state & economy, agents, visitor/staff behaviour, AI golf, tournaments
  render/    Three.js renderer, terrain & water shaders, procedural models, crowds, effects
  play/      ball physics and the play-it-yourself mode
  ui/        HUD, build tools, management windows, minimap
  audio/     procedural Web Audio sound effects, ambience and music
tools/       dev helpers (headless balance harness, physics test, screenshot scripts)
```

Dev pages: `gallery.html` shows every procedural model and `audio-test.html` plays every sound.

## Deploying

`.github/workflows/deploy.yml` builds the game and publishes it to GitHub Pages on pushes to `main`. To turn it on, set **Settings → Pages → Source** to **GitHub Actions**.
