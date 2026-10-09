// Serializable game state and defaults.
import { WeatherKind } from '../data/events';
import { PlayerStat } from '../data/clubs';
import { StaffRole } from '../data/staff';
import type { HoleSave } from '../world/Course';
import type { WorldSave } from '../world/World';

export type IncomeKey = 'range' | 'greenfees' | 'carts' | 'food' | 'shop' | 'lessons' | 'members' | 'hotel' | 'tournament' | 'other';
export type ExpenseKey = 'wages' | 'upkeep' | 'construction' | 'land' | 'research' | 'marketing' | 'interest' | 'tournament' | 'staffing' | 'supplies';

export const INCOME_NAMES: Record<IncomeKey, string> = {
  range: 'Range buckets', greenfees: 'Green fees', carts: 'Cart rental', food: 'Food & drink', shop: 'Pro shop',
  lessons: 'Lessons', members: 'Membership dues', hotel: 'Hotel rooms', tournament: 'Tournaments', other: 'Prizes & bonuses',
};
export const EXPENSE_NAMES: Record<ExpenseKey, string> = {
  wages: 'Staff wages', upkeep: 'Upkeep', construction: 'Construction', land: 'Land', research: 'Research',
  marketing: 'Marketing', interest: 'Loan interest', tournament: 'Tournament purses', staffing: 'Hiring & training', supplies: 'Supplies',
};

export interface Prices {
  bucket: number;
  green9: number;
  cart: number;
  lesson: number;
  membership: number;
  food: number; // price level multiplier
  shop: number; // price level multiplier
  hotel: number;
}

export const DEFAULT_PRICES: Prices = {
  bucket: 12, green9: 28, cart: 15, lesson: 45, membership: 220, food: 1, shop: 1, hotel: 180,
};

export interface StaffSave {
  id: number;
  role: StaffRole;
  name: string;
  level: number;
  hiredDay: number;
}

export interface DayRecord {
  day: number;
  income: Partial<Record<IncomeKey, number>>;
  expense: Partial<Record<ExpenseKey, number>>;
  visitors: number;
  rep: number;
  happiness: number;
  happyCount: number;
}

export interface PlayerProfile {
  name: string;
  level: number;
  xp: number;
  points: number;
  stats: Record<PlayerStat, number>;
  equipment: string;
  owned: string[];
  rangeBalls: number;
  holesPlayed: number;
  parsOrBetter: number;
  birdies: number;
  eagles: number;
  holeInOnes: number;
  longestDrive: number;
  bestRound: { holes: number; strokes: number; toPar: number } | null;
  challenges: Record<string, number>;
  lessons: number;
}

export interface TournamentRecord {
  id: string;
  day: number;
  winner: string;
  score: number;
  revenue: number;
  playerPos?: number;
}

export interface GameState {
  version: number;
  clubName: string;
  money: number;
  loan: number;
  day: number;
  minute: number;
  reputation: number;
  members: number;
  ballsOwned: number;
  prices: Prices;
  holes: HoleSave[];
  staff: StaffSave[];
  nextStaffId: number;
  research: { done: string[]; current: string | null; progress: number; queue: string[] };
  chapter: number;
  goalsDone: string[];
  marketing: { id: string; daysLeft: number }[];
  tournaments: { scheduled: { id: string; day: number; playerEntered: boolean } | null; history: TournamentRecord[] };
  weather: { kind: WeatherKind; wind: number; windDir: number; tomorrow: WeatherKind };
  stats: {
    totalVisitors: number;
    totalRevenue: number;
    bestDayProfit: number;
    history: DayRecord[];
    today: DayRecord;
  };
  player: PlayerProfile;
  flags: Record<string, number>;
  victory: boolean;
  sandbox: boolean;
  world: WorldSave | null;
}

export function emptyDay(day: number): DayRecord {
  return { day, income: {}, expense: {}, visitors: 0, rep: 0, happiness: 0, happyCount: 0 };
}

export function newPlayer(name = 'You'): PlayerProfile {
  return {
    name, level: 1, xp: 0, points: 0,
    stats: { power: 1, accuracy: 1, short: 1, putting: 1 },
    equipment: 'starter', owned: ['starter'],
    rangeBalls: 0, holesPlayed: 0, parsOrBetter: 0, birdies: 0, eagles: 0, holeInOnes: 0, longestDrive: 0,
    bestRound: null, challenges: {}, lessons: 0,
  };
}

export function newGameState(clubName: string, sandbox: boolean): GameState {
  return {
    version: 1,
    clubName,
    money: sandbox ? 5_000_000 : 40_000,
    loan: 0,
    day: 1,
    minute: 7 * 60 + 15,
    reputation: 18,
    members: 0,
    ballsOwned: 2500,
    prices: { ...DEFAULT_PRICES },
    holes: [],
    staff: [],
    nextStaffId: 1,
    research: { done: [], current: null, progress: 0, queue: [] },
    chapter: sandbox ? 6 : 1,
    goalsDone: [],
    marketing: [],
    tournaments: { scheduled: null, history: [] },
    weather: { kind: 'sunny', wind: 6, windDir: 0.7, tomorrow: 'partly' },
    stats: { totalVisitors: 0, totalRevenue: 0, bestDayProfit: 0, history: [], today: emptyDay(1) },
    player: newPlayer(),
    flags: {},
    victory: false,
    sandbox,
    world: null,
  };
}
