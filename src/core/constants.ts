// Core world constants shared by simulation and rendering.

/** Size of one grid tile in world metres. */
export const TILE = 4;
/** Tiles per map side. */
export const MAP = 160;
/** Tiles per land parcel side. */
export const PARCEL = 16;
/** Parcels per map side. */
export const PARCELS = MAP / PARCEL;
/** Height samples per tile side (terrain vertices are at half-tile spacing). */
export const SUB = 2;
/** Height grid dimension (vertices per side). */
export const HN = MAP * SUB + 1;
/** World size in metres. */
export const WORLD = MAP * TILE;

/** Golf distances are compressed so full courses fit on the map: real metres = world metres * COURSE_SCALE. */
export const COURSE_SCALE = 1.65;
/** World metres -> displayed yards. */
export const YARDS_PER_WORLD = COURSE_SCALE * 1.0936;

/** Tiles on the south edge reserved for the public road. */
export const ROAD_ROW = MAP - 3; // road occupies rows ROAD_ROW .. MAP-1
export const ROAD_ROWS = 3;

/** Opening hours (game hours). */
export const OPEN_HOUR = 7;
export const CLOSE_HOUR = 21;
export const LAST_ROUND_HOUR = 17;

/** Game minutes that pass per real second at 1x speed. */
export const GAME_MIN_PER_SEC = 0.8;

export const DAYS_PER_SEASON = 10;
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
export type SeasonName = (typeof SEASONS)[number];

export enum Surf {
  Rough = 0,
  Fairway = 1,
  Green = 2,
  Tee = 3,
  Bunker = 4,
  Water = 5,
  Path = 6,
  DeepRough = 7,
  Road = 8,
  Paving = 9,
}

export const SURF_NAMES: Record<Surf, string> = {
  [Surf.Rough]: 'Rough',
  [Surf.Fairway]: 'Fairway',
  [Surf.Green]: 'Green',
  [Surf.Tee]: 'Tee Box',
  [Surf.Bunker]: 'Bunker',
  [Surf.Water]: 'Water',
  [Surf.Path]: 'Cart Path',
  [Surf.DeepRough]: 'Long Grass',
  [Surf.Road]: 'Road',
  [Surf.Paving]: 'Paving',
};

/** Surfaces that make up a golf course (subject to wear and maintenance). */
export const MAINTAINED = new Set<Surf>([Surf.Fairway, Surf.Green, Surf.Tee]);

export function tileIndex(x: number, y: number): number {
  return y * MAP + x;
}

export function inMap(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < MAP && y < MAP;
}

/** World position (metres) of the centre of tile (x,y). Tile x maps to world X, tile y maps to world Z. */
export function tileCenter(x: number, y: number): { x: number; z: number } {
  return { x: (x + 0.5) * TILE, z: (y + 0.5) * TILE };
}

export function worldToTile(wx: number, wz: number): { x: number; y: number } {
  return { x: Math.floor(wx / TILE), y: Math.floor(wz / TILE) };
}

export function yards(worldDist: number): number {
  return Math.round(worldDist * YARDS_PER_WORLD);
}

export function fmtMoney(n: number, decimals = 0): string {
  const neg = n < 0;
  const v = Math.abs(n);
  let s: string;
  if (v >= 1e9) s = (v / 1e9).toFixed(2) + 'B';
  else if (v >= 1e6) s = (v / 1e6).toFixed(2) + 'M';
  else s = v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (neg ? '-$' : '$') + s;
}
