// Career chapters and their goals.
import type { Game } from '../sim/Game';

export interface GoalStatus {
  done: boolean;
  /** 0..1 */
  frac: number;
  text: string;
}

export interface GoalDef {
  id: string;
  name: string;
  check: (g: Game) => GoalStatus;
}

export interface ChapterDef {
  num: number;
  title: string;
  intro: string;
  reward: number;
  goals: GoalDef[];
}

function count(cur: number, target: number, fmt: (n: number) => string = (n) => n.toLocaleString()): GoalStatus {
  return { done: cur >= target, frac: Math.max(0, Math.min(1, cur / target)), text: `${fmt(Math.min(cur, target))} / ${fmt(target)}` };
}
function bool(v: boolean): GoalStatus {
  return { done: v, frac: v ? 1 : 0, text: v ? 'Done' : 'Not yet' };
}
const money = (n: number) => '$' + Math.round(n).toLocaleString();
const stars = (rep: number) => (rep / 20).toFixed(1) + '★';

export const CHAPTERS: ChapterDef[] = [
  {
    num: 1,
    title: 'Breaking Ground',
    intro: 'You have bought a patch of farmland by the main road. Every great club starts somewhere — build a driving range to get money coming in.',
    reward: 6000,
    goals: [
      { id: 'c1_bays', name: 'Build 4 driving range bays', check: (g) => count(g.world.objectsOfKind('bay').length, 4) },
      { id: 'c1_dispenser', name: 'Build a ball dispenser', check: (g) => bool(g.world.objectsOfKind('dispenser').length > 0) },
      { id: 'c1_visitors', name: 'Welcome 30 visitors', check: (g) => count(g.state.stats.totalVisitors, 30) },
      { id: 'c1_play', name: 'Have a go: hit 10 balls on your range', check: (g) => count(g.state.player.rangeBalls, 10) },
      { id: 'c1_revenue', name: 'Earn $2,500 in revenue', check: (g) => count(g.state.stats.totalRevenue, 2500, money) },
    ],
  },
  {
    num: 2,
    title: 'Pitch & Putt',
    intro: 'Range regulars keep asking where they can play a real hole. Build a clubhouse and lay out your first holes. Paint a tee box, a fairway and a green, then use the Hole tool to place the tee and pin.',
    reward: 15000,
    goals: [
      { id: 'c2_clubhouse', name: 'Build a clubhouse', check: (g) => bool(g.world.objectsOfKind('clubhouse').length > 0) },
      { id: 'c2_holes', name: 'Open 3 playable holes', check: (g) => count(g.course.validHoles().length, 3) },
      { id: 'c2_greenkeeper', name: 'Hire a greenkeeper', check: (g) => count(g.staffOfRole('greenkeeper').length, 1) },
      { id: 'c2_cafe', name: 'Build a café', check: (g) => bool(g.world.objectsOfType('cafe').length > 0) },
      { id: 'c2_rep', name: 'Reach a 2★ reputation', check: (g) => ({ ...count(g.state.reputation, 40, stars) }) },
      { id: 'c2_play', name: 'Have a go: play a hole on your course', check: (g) => count(g.state.player.holesPlayed, 1) },
    ],
  },
  {
    num: 3,
    title: 'The Front Nine',
    intro: 'Word is spreading. Golfers want a proper nine-hole loop with somewhere to shop and somewhere to eat.',
    reward: 40000,
    goals: [
      { id: 'c3_holes', name: 'Open 9 playable holes', check: (g) => count(g.course.validHoles().length, 9) },
      { id: 'c3_rating', name: 'Average hole rating of 50', check: (g) => count(Math.round(g.course.averageRating()), 50) },
      { id: 'c3_shop', name: 'Build a pro shop', check: (g) => bool(g.world.objectsOfType('pro_shop').length > 0) },
      { id: 'c3_visitors', name: 'Welcome 1,000 visitors in total', check: (g) => count(g.state.stats.totalVisitors, 1000) },
      { id: 'c3_staff', name: 'Employ 8 staff', check: (g) => count(g.state.staff.length, 8) },
      { id: 'c3_par', name: 'Have a go: make par or better on one of your holes', check: (g) => count(g.state.player.parsOrBetter, 1) },
    ],
  },
  {
    num: 4,
    title: 'Country Club',
    intro: 'Time to become a real country club: a full eighteen, a thriving membership and a clubhouse to match.',
    reward: 100000,
    goals: [
      { id: 'c4_holes', name: 'Open 18 playable holes', check: (g) => count(g.course.validHoles().length, 18) },
      { id: 'c4_rep', name: 'Reach a 3.5★ reputation', check: (g) => count(g.state.reputation, 70, stars) },
      { id: 'c4_members', name: 'Have 80 members', check: (g) => count(Math.floor(g.state.members), 80) },
      { id: 'c4_profit', name: 'Make $6,000 profit in a single day', check: (g) => count(g.state.stats.bestDayProfit, 6000, money) },
      { id: 'c4_land', name: 'Own 30 land parcels', check: (g) => count(g.world.ownedCount(), 30) },
      { id: 'c4_lounge', name: 'Upgrade the clubhouse to a Members Lounge', check: (g) => bool(g.world.objectsOfKind('clubhouse').some((o) => o.level >= 2)) },
    ],
  },
  {
    num: 5,
    title: 'Championship Venue',
    intro: 'The governing bodies have noticed. Prove your course can host the best players in the world.',
    reward: 250000,
    goals: [
      { id: 'c5_regional', name: 'Host the Regional Open', check: (g) => bool(g.state.tournaments.history.some((t) => t.id === 'regional_open')) },
      { id: 'c5_rating', name: 'Average hole rating of 68', check: (g) => count(Math.round(g.course.averageRating()), 68) },
      { id: 'c5_rep', name: 'Reach a 4.25★ reputation', check: (g) => count(g.state.reputation, 85, stars) },
      { id: 'c5_stands', name: 'Build 2 grandstands', check: (g) => count(g.world.objectsOfKind('grandstand').length, 2) },
      { id: 'c5_value', name: 'Reach a club value of $2,000,000', check: (g) => count(g.clubValue(), 2_000_000, money) },
      { id: 'c5_drive', name: 'Have a go: hit a 300-yard drive', check: (g) => count(g.state.player.longestDrive, 300, (n) => n + ' yds') },
    ],
  },
  {
    num: 6,
    title: 'Legend of the Links',
    intro: 'One final step: build a world-famous golf resort and host The Grand Open.',
    reward: 1000000,
    goals: [
      { id: 'c6_hotel', name: 'Build the Grand Hotel', check: (g) => bool(g.world.objectsOfKind('hotel').length > 0) },
      { id: 'c6_grand', name: 'Upgrade to the Grand Clubhouse', check: (g) => bool(g.world.objectsOfKind('clubhouse').some((o) => o.level >= 3)) },
      { id: 'c6_rep', name: 'Reach a 4.8★ reputation', check: (g) => count(g.state.reputation, 96, stars) },
      { id: 'c6_open', name: 'Host The Grand Open', check: (g) => bool(g.state.tournaments.history.some((t) => t.id === 'grand_open')) },
      { id: 'c6_value', name: 'Reach a club value of $8,000,000', check: (g) => count(g.clubValue(), 8_000_000, money) },
      { id: 'c6_visitors', name: 'Welcome 20,000 visitors in total', check: (g) => count(g.state.stats.totalVisitors, 20000) },
    ],
  },
];
