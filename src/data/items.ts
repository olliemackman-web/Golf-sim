// Catalogue of everything the player can build.
import { Surf } from '../core/constants';

export type ItemCategory = 'range' | 'course' | 'buildings' | 'scenery' | 'trees';

export type ItemKind =
  | 'bay'
  | 'dispenser'
  | 'target'
  | 'picker_shed'
  | 'floodlight'
  | 'practice'
  | 'clubhouse'
  | 'shop'
  | 'food'
  | 'toilet'
  | 'cart_shed'
  | 'academy'
  | 'maintenance'
  | 'carpark'
  | 'hotel'
  | 'grandstand'
  | 'helipad'
  | 'shelter'
  | 'bench'
  | 'bin'
  | 'lamp'
  | 'deco'
  | 'tree'
  | 'course_prop'
  | 'sign';

export interface ItemUpgrade {
  name: string;
  cost: number;
  upkeep: number;
  desc: string;
  research?: string;
  chapter?: number;
}

export interface ItemDef {
  id: string;
  name: string;
  cat: ItemCategory;
  kind: ItemKind;
  desc: string;
  cost: number;
  /** Running cost per in-game day. */
  upkeep: number;
  /** Footprint in tiles (local X by local Z, before rotation). */
  w: number;
  h: number;
  /** Model key in the model library (defaults to id). */
  model?: string;
  /** Career chapter required (1-based). */
  chapter?: number;
  /** Research project required. */
  research?: string;
  /** Beauty value radiated to nearby tiles (0-10). */
  scenery?: number;
  /** Simultaneous users. */
  capacity?: number;
  /** For food/shop: base spend per visit. */
  spend?: number;
  /** Bay tier (1 basic, 2 covered, 3 tracker). */
  tier?: number;
  /** Upgrade levels beyond level 1. */
  upgrades?: ItemUpgrade[];
  /** Placement rule. */
  place?: 'roadside' | 'any';
  /** Cannot be bulldozed (pre-placed). */
  fixed?: boolean;
  /** Hidden from the build menu. */
  hidden?: boolean;
  /** Emits light at night. */
  light?: boolean;
  /** Visitors walk to the front entrance tile. */
  enterable?: boolean;
  /** Maximum count allowed. */
  max?: number;
}

const D: ItemDef[] = [
  // ---------------------------------------------------------------- RANGE
  {
    id: 'bay_basic', name: 'Grass Tee Bay', cat: 'range', kind: 'bay', tier: 1,
    desc: 'A simple hitting mat with a divider. Golfers hit balls towards the open field in front of the bay.',
    cost: 1200, upkeep: 4, w: 1, h: 2, capacity: 1, chapter: 1,
  },
  {
    id: 'bay_covered', name: 'Covered Bay', cat: 'range', kind: 'bay', tier: 2,
    desc: 'Roofed hitting bay with a bench. Usable in the rain and preferred by regulars.',
    cost: 3500, upkeep: 8, w: 1, h: 2, capacity: 1, research: 'covered_bays',
  },
  {
    id: 'bay_premium', name: 'Tracker Bay', cat: 'range', kind: 'bay', tier: 3,
    desc: 'Heated premium bay with ball-tracking screen and lounge seating. Golfers happily pay top prices.',
    cost: 9000, upkeep: 18, w: 1, h: 2, capacity: 1, research: 'ball_tracking',
  },
  {
    id: 'dispenser', name: 'Ball Dispenser', cat: 'range', kind: 'dispenser',
    desc: 'Sells buckets of range balls. Every driving range needs at least one.',
    cost: 2500, upkeep: 6, w: 1, h: 1, capacity: 2, chapter: 1, enterable: true,
  },
  {
    id: 'target_flag', name: 'Target Flag', cat: 'range', kind: 'target',
    desc: 'A small target green with a flag. Golfers love aiming at something.',
    cost: 600, upkeep: 1, w: 2, h: 2, scenery: 1, chapter: 1,
  },
  {
    id: 'target_ring', name: 'Ring Target', cat: 'range', kind: 'target',
    desc: 'Large bullseye target with scoring rings. Great fun for range visitors.',
    cost: 1800, upkeep: 2, w: 3, h: 3, scenery: 2, chapter: 2,
  },
  {
    id: 'target_island', name: 'Island Target', cat: 'range', kind: 'target',
    desc: 'A floating island green surrounded by a moat. Spectacular when you hit it.',
    cost: 4500, upkeep: 4, w: 4, h: 4, scenery: 4, chapter: 3,
  },
  {
    id: 'picker_shed', name: 'Ball Picker Garage', cat: 'range', kind: 'picker_shed',
    desc: 'Houses a ball picker tractor so Range Assistants collect balls much faster.',
    cost: 6000, upkeep: 10, w: 2, h: 2, chapter: 1,
  },
  {
    id: 'floodlight', name: 'Floodlight Tower', cat: 'range', kind: 'floodlight', light: true,
    desc: 'Lights the range at night so bays stay open until late.',
    cost: 4000, upkeep: 10, w: 1, h: 1, research: 'floodlights',
  },
  {
    id: 'practice_green', name: 'Practice Putting Green', cat: 'range', kind: 'practice',
    desc: 'Golfers warm up here before rounds. Raises satisfaction and pace of play.',
    cost: 5000, upkeep: 8, w: 4, h: 4, capacity: 4, scenery: 2, chapter: 2,
  },
  {
    id: 'chipping_area', name: 'Chipping Area', cat: 'range', kind: 'practice',
    desc: 'Short game area with a bunker and target green.',
    cost: 4000, upkeep: 6, w: 4, h: 3, capacity: 3, scenery: 1, chapter: 2,
  },
  {
    id: 'yardage_board', name: 'Yardage Board', cat: 'range', kind: 'deco',
    desc: 'Big distance board for the range.', cost: 250, upkeep: 0, w: 1, h: 1, scenery: 1, chapter: 1,
  },

  // ---------------------------------------------------------------- COURSE PROPS
  {
    id: 'ball_washer', name: 'Ball Washer', cat: 'course', kind: 'course_prop',
    desc: 'Classic tee-side ball washer. Small boost to hole appeal.', cost: 300, upkeep: 1, w: 1, h: 1, scenery: 1, chapter: 2,
  },
  {
    id: 'tee_sign', name: 'Hole Sign', cat: 'course', kind: 'course_prop',
    desc: 'Shows the hole layout, par and yardage. Golfers appreciate the information.', cost: 350, upkeep: 0, w: 1, h: 1, scenery: 1, chapter: 2,
  },
  {
    id: 'yardage_post', name: 'Yardage Post', cat: 'course', kind: 'course_prop',
    desc: '150-yard marker post.', cost: 150, upkeep: 0, w: 1, h: 1, chapter: 2,
  },
  {
    id: 'drinking_fountain', name: 'Water Station', cat: 'course', kind: 'course_prop',
    desc: 'Free cool water for thirsty golfers out on the course.', cost: 800, upkeep: 3, w: 1, h: 1, chapter: 2,
  },
  {
    id: 'shelter', name: 'Rain Shelter', cat: 'course', kind: 'shelter',
    desc: 'Timber shelter to wait out the rain.', cost: 3000, upkeep: 4, w: 2, h: 2, scenery: 2, chapter: 3,
  },
  {
    id: 'halfway_house', name: 'Halfway House', cat: 'course', kind: 'food', enterable: true,
    desc: 'Snack hut out on the course. Golfers grab a drink and a bite between nines.',
    cost: 14000, upkeep: 30, w: 3, h: 3, spend: 9, capacity: 6, scenery: 1, chapter: 3,
  },

  // ---------------------------------------------------------------- BUILDINGS
  {
    id: 'clubhouse', name: 'Clubhouse', cat: 'buildings', kind: 'clubhouse', enterable: true,
    desc: 'The heart of the club. Golfers check in here before a round. Required for course play.',
    cost: 25000, upkeep: 60, w: 6, h: 5, capacity: 40, spend: 6, scenery: 3, chapter: 1, max: 1,
    upgrades: [
      { name: 'Members Lounge', cost: 55000, upkeep: 110, desc: 'Locker rooms and a members lounge. Needed for memberships over 100 and regional tournaments.', chapter: 3 },
      { name: 'Grand Clubhouse', cost: 140000, upkeep: 220, desc: 'A landmark clubhouse fit for champions. Big reputation boost.', chapter: 5 },
    ],
  },
  {
    id: 'pro_shop', name: 'Pro Shop', cat: 'buildings', kind: 'shop', enterable: true,
    desc: 'Sells clubs, balls, gloves and apparel. Also where you buy your own better clubs.',
    cost: 12000, upkeep: 30, w: 3, h: 3, spend: 28, capacity: 8, scenery: 1, chapter: 2,
    upgrades: [
      { name: 'Custom Fitting Studio', cost: 30000, upkeep: 55, desc: 'Launch monitor fitting bay. Golfers spend far more.', chapter: 4 },
    ],
  },
  {
    id: 'cafe', name: 'Café', cat: 'buildings', kind: 'food', enterable: true,
    desc: 'Coffee, sandwiches and cold drinks.', cost: 9000, upkeep: 25, w: 3, h: 3, spend: 8, capacity: 12, scenery: 1, chapter: 1,
    upgrades: [
      { name: 'Terrace Seating', cost: 15000, upkeep: 35, desc: 'Outdoor terrace with parasols. More seats and happier customers.', chapter: 3 },
    ],
  },
  {
    id: 'toilets', name: 'Restrooms', cat: 'buildings', kind: 'toilet', enterable: true,
    desc: 'Nobody enjoys a course without restrooms.', cost: 3500, upkeep: 12, w: 2, h: 2, capacity: 4, chapter: 1,
  },
  {
    id: 'bar', name: '19th Hole Bar', cat: 'buildings', kind: 'food', enterable: true,
    desc: 'Post-round drinks and stories about the one that got away.', cost: 22000, upkeep: 45, w: 4, h: 3, spend: 16, capacity: 16, scenery: 2, chapter: 3,
  },
  {
    id: 'restaurant', name: 'Restaurant', cat: 'buildings', kind: 'food', enterable: true,
    desc: 'Fine dining overlooking the course. Wealthy visitors spend big here.', cost: 45000, upkeep: 90, w: 5, h: 4, spend: 38, capacity: 24, scenery: 3, research: 'gourmet_kitchen',
  },
  {
    id: 'maintenance', name: 'Maintenance Shed', cat: 'buildings', kind: 'maintenance',
    desc: 'Workshop and mower storage. Greenkeepers work 30% faster with one on site.', cost: 8000, upkeep: 15, w: 3, h: 3, chapter: 2,
  },
  {
    id: 'cart_shed', name: 'Cart Barn', cat: 'buildings', kind: 'cart_shed', enterable: true,
    desc: 'Golf cart rental. Golfers ride the course faster and pay a rental fee.', cost: 18000, upkeep: 35, w: 4, h: 3, research: 'golf_carts',
  },
  {
    id: 'academy', name: 'Golf Academy', cat: 'buildings', kind: 'academy', enterable: true,
    desc: 'Teaching studio. Hire Golf Pros to give paid lessons. You can take lessons here too.', cost: 30000, upkeep: 50, w: 4, h: 4, capacity: 6, scenery: 1, research: 'golf_academy',
  },
  {
    id: 'carpark', name: 'Car Park', cat: 'buildings', kind: 'carpark', place: 'roadside',
    desc: 'Ten parking spaces. Must touch the road. Visitors drive away if they cannot park.', cost: 5000, upkeep: 5, w: 6, h: 4, capacity: 10, chapter: 1,
    upgrades: [
      { name: 'Overflow Field', cost: 7000, upkeep: 10, desc: 'Marshalled overflow parking on the field behind. Doubles the spaces to 20.', chapter: 2 },
      { name: 'Valet Parking', cost: 18000, upkeep: 30, desc: 'Valets park cars off-site. Thirty spaces in total.', chapter: 3 },
    ],
  },
  {
    id: 'grandstand', name: 'Grandstand', cat: 'buildings', kind: 'grandstand',
    desc: 'Seating for tournament spectators. Each grandstand adds 400 ticket sales per event.', cost: 40000, upkeep: 40, w: 6, h: 2, capacity: 400, research: 'tournament_licensing',
  },
  {
    id: 'helipad', name: 'Helipad', cat: 'buildings', kind: 'helipad',
    desc: 'Attracts wealthy VIP golfers who arrive by helicopter.', cost: 90000, upkeep: 80, w: 4, h: 4, research: 'helipad', max: 1,
  },
  {
    id: 'hotel', name: 'Grand Hotel', cat: 'buildings', kind: 'hotel', enterable: true,
    desc: 'Luxury resort hotel. Guests pay for rooms every night and play golf all day.', cost: 350000, upkeep: 500, w: 8, h: 6, capacity: 80, scenery: 4, research: 'luxury_hotel', max: 1,
  },

  // ---------------------------------------------------------------- SCENERY
  { id: 'bench', name: 'Bench', cat: 'scenery', kind: 'bench', desc: 'Somewhere to sit while waiting.', cost: 150, upkeep: 0, w: 1, h: 1, scenery: 1, chapter: 1 },
  { id: 'bin', name: 'Litter Bin', cat: 'scenery', kind: 'bin', desc: 'Keeps the grounds tidy.', cost: 80, upkeep: 0, w: 1, h: 1, chapter: 1 },
  { id: 'lamp', name: 'Lamp Post', cat: 'scenery', kind: 'lamp', light: true, desc: 'Victorian lamp post. Lights paths at night.', cost: 350, upkeep: 1, w: 1, h: 1, scenery: 1, chapter: 1 },
  { id: 'flowers_red', name: 'Rose Bed', cat: 'scenery', kind: 'deco', desc: 'Red roses.', cost: 120, upkeep: 1, w: 1, h: 1, scenery: 3, chapter: 1 },
  { id: 'flowers_yellow', name: 'Daffodil Bed', cat: 'scenery', kind: 'deco', desc: 'Cheerful yellow daffodils.', cost: 120, upkeep: 1, w: 1, h: 1, scenery: 3, chapter: 1 },
  { id: 'flowers_purple', name: 'Lavender Bed', cat: 'scenery', kind: 'deco', desc: 'Fragrant lavender.', cost: 140, upkeep: 1, w: 1, h: 1, scenery: 3, chapter: 2 },
  { id: 'bush', name: 'Shrub', cat: 'scenery', kind: 'deco', desc: 'A rounded evergreen shrub.', cost: 60, upkeep: 0, w: 1, h: 1, scenery: 1, chapter: 1 },
  { id: 'hedge', name: 'Hedge', cat: 'scenery', kind: 'deco', desc: 'Neatly clipped hedge section.', cost: 90, upkeep: 0, w: 1, h: 1, scenery: 1, chapter: 1 },
  { id: 'rock', name: 'Boulder', cat: 'scenery', kind: 'deco', desc: 'A weathered granite boulder.', cost: 80, upkeep: 0, w: 1, h: 1, scenery: 1, chapter: 1 },
  { id: 'topiary', name: 'Topiary', cat: 'scenery', kind: 'deco', desc: 'Spiral-clipped box topiary in a planter.', cost: 400, upkeep: 1, w: 1, h: 1, scenery: 3, chapter: 2 },
  { id: 'flag_pole', name: 'Flag Pole', cat: 'scenery', kind: 'deco', desc: 'Flies the club colours.', cost: 900, upkeep: 0, w: 1, h: 1, scenery: 2, chapter: 2 },
  { id: 'fountain', name: 'Fountain', cat: 'scenery', kind: 'deco', desc: 'Three-tier stone fountain.', cost: 6000, upkeep: 5, w: 2, h: 2, scenery: 7, chapter: 2 },
  { id: 'gazebo', name: 'Gazebo', cat: 'scenery', kind: 'deco', desc: 'White timber gazebo. A lovely spot to rest.', cost: 7500, upkeep: 3, w: 3, h: 3, scenery: 6, chapter: 3 },
  { id: 'statue', name: 'Champion Statue', cat: 'scenery', kind: 'deco', desc: 'Bronze statue of a golfer mid-swing on a stone plinth.', cost: 4000, upkeep: 0, w: 1, h: 1, scenery: 6, chapter: 3 },
  { id: 'windmill', name: 'Windmill', cat: 'scenery', kind: 'deco', desc: 'Traditional windmill with turning sails.', cost: 12000, upkeep: 4, w: 2, h: 2, scenery: 8, chapter: 4 },

  // ---------------------------------------------------------------- TREES
  { id: 'tree_oak', name: 'Oak', cat: 'trees', kind: 'tree', desc: 'Broad, leafy oak.', cost: 120, upkeep: 0, w: 1, h: 1, scenery: 2, chapter: 1 },
  { id: 'tree_pine', name: 'Scots Pine', cat: 'trees', kind: 'tree', desc: 'Tall evergreen pine.', cost: 120, upkeep: 0, w: 1, h: 1, scenery: 2, chapter: 1 },
  { id: 'tree_birch', name: 'Silver Birch', cat: 'trees', kind: 'tree', desc: 'Slender white-barked birch.', cost: 150, upkeep: 0, w: 1, h: 1, scenery: 2, chapter: 1 },
  { id: 'tree_cypress', name: 'Cypress', cat: 'trees', kind: 'tree', desc: 'Narrow columnar cypress.', cost: 160, upkeep: 0, w: 1, h: 1, scenery: 2, chapter: 2 },
  { id: 'tree_maple', name: 'Red Maple', cat: 'trees', kind: 'tree', desc: 'Striking red foliage.', cost: 180, upkeep: 0, w: 1, h: 1, scenery: 3, chapter: 2 },
  { id: 'tree_willow', name: 'Weeping Willow', cat: 'trees', kind: 'tree', desc: 'Graceful willow, perfect by the water.', cost: 220, upkeep: 0, w: 1, h: 1, scenery: 4, chapter: 3 },
  { id: 'tree_cherry', name: 'Cherry Blossom', cat: 'trees', kind: 'tree', desc: 'Clouds of pink blossom.', cost: 260, upkeep: 0, w: 1, h: 1, scenery: 5, research: 'exotic_trees' },
  { id: 'tree_palm', name: 'Palm', cat: 'trees', kind: 'tree', desc: 'Resort-style palm tree.', cost: 300, upkeep: 0, w: 1, h: 1, scenery: 4, research: 'exotic_trees' },

  // ---------------------------------------------------------------- FIXED / HIDDEN
  { id: 'entrance_sign', name: 'Club Entrance', cat: 'scenery', kind: 'sign', desc: 'Your club entrance sign.', cost: 0, upkeep: 0, w: 3, h: 1, scenery: 2, fixed: true, hidden: true },
];

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(D.map((d) => [d.id, d]));
export const ITEM_LIST = D;

export function itemModel(def: ItemDef): string {
  return def.model ?? def.id;
}

export const TREE_TYPES = D.filter((d) => d.kind === 'tree').map((d) => d.id);

/** Painting costs per tile for each surface. */
export const SURF_COST: Partial<Record<Surf, number>> = {
  [Surf.Fairway]: 15,
  [Surf.Green]: 60,
  [Surf.Tee]: 40,
  [Surf.Bunker]: 30,
  [Surf.Water]: 45,
  [Surf.Path]: 25,
  [Surf.Rough]: 4,
  [Surf.DeepRough]: 6,
  [Surf.Paving]: 30,
};

export interface PaintTool {
  surf: Surf;
  name: string;
  desc: string;
  chapter: number;
}

export const PAINT_TOOLS: PaintTool[] = [
  { surf: Surf.Fairway, name: 'Fairway', desc: 'Short mown grass. Golfers aim for it.', chapter: 1 },
  { surf: Surf.Green, name: 'Green', desc: 'Putting surface. Every hole needs a green for its pin.', chapter: 1 },
  { surf: Surf.Tee, name: 'Tee Box', desc: 'Flat teeing ground. Every hole starts on a tee box.', chapter: 1 },
  { surf: Surf.Bunker, name: 'Bunker', desc: 'Sand trap. Adds challenge and character.', chapter: 1 },
  { surf: Surf.Water, name: 'Water', desc: 'Ponds and lakes. Beautiful and dangerous.', chapter: 1 },
  { surf: Surf.Path, name: 'Cart Path', desc: 'Visitors walk faster on paths, and carts use them.', chapter: 1 },
  { surf: Surf.Paving, name: 'Paving', desc: 'Stone paving for plazas around buildings.', chapter: 1 },
  { surf: Surf.Rough, name: 'Rough', desc: 'Regular grass. Use it to erase.', chapter: 1 },
  { surf: Surf.DeepRough, name: 'Long Grass', desc: 'Natural wild grass and wildflowers. Punishing, but pretty.', chapter: 1 },
];
