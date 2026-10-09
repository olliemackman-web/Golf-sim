// Golf clubs, equipment sets and player progression data.

export interface ClubDef {
  id: string;
  name: string;
  short: string;
  /** Ball speed (m/s) for a full shot by a strong player. */
  speed: number;
  /** Launch angle (degrees). */
  launch: number;
  /** Backspin (rpm). */
  spin: number;
  /** Typical carry in yards for a tour-level player (used by AI golfers). */
  carry: number;
  putter?: boolean;
}

export const CLUBS: ClubDef[] = [
  { id: 'dr', name: 'Driver', short: 'DR', speed: 74, launch: 11.5, spin: 2600, carry: 280 },
  { id: '3w', name: '3 Wood', short: '3W', speed: 68, launch: 12.5, spin: 3500, carry: 250 },
  { id: '5w', name: '5 Wood', short: '5W', speed: 64, launch: 13.5, spin: 4300, carry: 232 },
  { id: '4i', name: '4 Iron', short: '4i', speed: 60, launch: 14.5, spin: 4600, carry: 212 },
  { id: '5i', name: '5 Iron', short: '5i', speed: 57.5, launch: 15.5, spin: 5300, carry: 200 },
  { id: '6i', name: '6 Iron', short: '6i', speed: 55, launch: 17, spin: 6200, carry: 188 },
  { id: '7i', name: '7 Iron', short: '7i', speed: 52.5, launch: 19, spin: 7000, carry: 175 },
  { id: '8i', name: '8 Iron', short: '8i', speed: 50, launch: 21, spin: 7900, carry: 162 },
  { id: '9i', name: '9 Iron', short: '9i', speed: 47, launch: 23.5, spin: 8600, carry: 150 },
  { id: 'pw', name: 'Pitching Wedge', short: 'PW', speed: 44, launch: 26, spin: 9300, carry: 138 },
  { id: 'gw', name: 'Gap Wedge', short: 'GW', speed: 40, launch: 29, spin: 9800, carry: 122 },
  { id: 'sw', name: 'Sand Wedge', short: 'SW', speed: 35.5, launch: 33, spin: 10200, carry: 100 },
  { id: 'lw', name: 'Lob Wedge', short: 'LW', speed: 30, launch: 38, spin: 10500, carry: 78 },
  { id: 'pt', name: 'Putter', short: 'PT', speed: 9, launch: 1.5, spin: 0, carry: 0, putter: true },
];
export const CLUB_BY_ID: Record<string, ClubDef> = Object.fromEntries(CLUBS.map((c) => [c.id, c]));

export interface EquipmentSet {
  id: string;
  name: string;
  desc: string;
  cost: number;
  /** Ball speed multiplier. */
  distance: number;
  /** Widens the sweet spot / reduces dispersion. */
  forgiveness: number;
  needsShop: boolean;
}

export const EQUIPMENT: EquipmentSet[] = [
  { id: 'starter', name: 'Starter Set', desc: 'Second-hand clubs from the lost property box.', cost: 0, distance: 0.86, forgiveness: 0.85, needsShop: false },
  { id: 'forged', name: 'Club Forged Irons', desc: 'A proper fitted set. Noticeably longer and more consistent.', cost: 6000, distance: 0.92, forgiveness: 1.0, needsShop: true },
  { id: 'tour', name: 'Tour Pro Bag', desc: 'The same gear the touring pros use.', cost: 30000, distance: 0.97, forgiveness: 1.15, needsShop: true },
  { id: 'legend', name: 'Legend Custom', desc: 'Hand-ground custom clubs. Absurdly good.', cost: 120000, distance: 1.02, forgiveness: 1.35, needsShop: true },
];

export type PlayerStat = 'power' | 'accuracy' | 'short' | 'putting';
export const PLAYER_STAT_NAMES: Record<PlayerStat, string> = {
  power: 'Power',
  accuracy: 'Accuracy',
  short: 'Short Game',
  putting: 'Putting',
};
export const MAX_STAT = 10;

/** XP needed to reach the next golfer level. */
export function xpForLevel(level: number): number {
  return Math.round(120 * Math.pow(level, 1.45));
}

/** AI carry (world metres) for a club and skill 0..1. */
export function aiCarryYards(club: ClubDef, skill: number): number {
  return club.carry * (0.56 + 0.44 * skill);
}
