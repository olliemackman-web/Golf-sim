// Tournaments and marketing campaigns.

export interface TournamentDef {
  id: string;
  name: string;
  desc: string;
  minHoles: number;
  minRep: number;
  minRating: number;
  clubhouseLevel: number;
  grandstands: number;
  hotel?: boolean;
  research?: string;
  purse: number;
  sponsorship: number;
  spectators: number;
  ticket: number;
  repGain: number;
  field: number;
  /** Strength of the field: mean skill of players. */
  strength: number;
}

export const TOURNAMENTS: TournamentDef[] = [
  {
    id: 'club_championship', name: 'Club Championship', desc: 'Your best local amateurs battle for the club trophy.',
    minHoles: 9, minRep: 45, minRating: 40, clubhouseLevel: 1, grandstands: 0,
    purse: 8000, sponsorship: 9000, spectators: 220, ticket: 10, repGain: 3, field: 24, strength: 0.62,
  },
  {
    id: 'regional_open', name: 'Regional Open', desc: 'Up-and-coming professionals from across the region.',
    minHoles: 18, minRep: 68, minRating: 55, clubhouseLevel: 2, grandstands: 1, research: 'tournament_licensing',
    purse: 60000, sponsorship: 70000, spectators: 900, ticket: 25, repGain: 6, field: 48, strength: 0.8,
  },
  {
    id: 'national_championship', name: 'National Championship', desc: 'A televised national title with a top-class field.',
    minHoles: 18, minRep: 82, minRating: 64, clubhouseLevel: 2, grandstands: 2, research: 'tournament_licensing',
    purse: 250000, sponsorship: 300000, spectators: 3000, ticket: 45, repGain: 8, field: 72, strength: 0.88,
  },
  {
    id: 'grand_open', name: 'The Grand Open', desc: 'The most prestigious event in golf. Only legendary venues are chosen.',
    minHoles: 18, minRep: 90, minRating: 70, clubhouseLevel: 3, grandstands: 3, hotel: true, research: 'tournament_licensing',
    purse: 1000000, sponsorship: 1300000, spectators: 9000, ticket: 80, repGain: 12, field: 96, strength: 0.95,
  },
];
export const TOURNAMENT_BY_ID: Record<string, TournamentDef> = Object.fromEntries(TOURNAMENTS.map((t) => [t.id, t]));

export interface MarketingDef {
  id: string;
  name: string;
  desc: string;
  cost: number;
  days: number;
  boost: number;
  /** Extra weighting for these visitor types. */
  targets?: string[];
  chapter: number;
}

export const MARKETING: MarketingDef[] = [
  { id: 'flyers', name: 'Local Flyers', desc: 'Leaflets through letterboxes nearby. Attracts beginners and casual golfers.', cost: 400, days: 3, boost: 0.15, targets: ['beginner', 'casual', 'junior'], chapter: 1 },
  { id: 'radio', name: 'Local Radio', desc: 'Catchy jingle on the morning show.', cost: 2200, days: 5, boost: 0.25, chapter: 1 },
  { id: 'social', name: 'Social Media Ads', desc: 'Targeted ads with slow-motion swing videos. Popular with younger golfers.', cost: 3500, days: 5, boost: 0.3, targets: ['junior', 'casual', 'enthusiast'], chapter: 2 },
  { id: 'magazine', name: 'Golf Magazine Feature', desc: 'A glossy course review. Serious golfers take note.', cost: 11000, days: 7, boost: 0.35, targets: ['enthusiast', 'regular', 'pro'], chapter: 3 },
  { id: 'corporate', name: 'Corporate Golf Days', desc: 'Sell team-building days to local businesses.', cost: 18000, days: 5, boost: 0.25, targets: ['business'], chapter: 4 },
  { id: 'tv', name: 'TV Commercial', desc: 'Prime-time national advertising.', cost: 38000, days: 7, boost: 0.6, chapter: 4 },
];
export const MARKETING_BY_ID: Record<string, MarketingDef> = Object.fromEntries(MARKETING.map((m) => [m.id, m]));

export type WeatherKind = 'sunny' | 'partly' | 'overcast' | 'rain' | 'storm';
export const WEATHER_NAMES: Record<WeatherKind, string> = {
  sunny: 'Sunny', partly: 'Partly Cloudy', overcast: 'Overcast', rain: 'Rain', storm: 'Thunderstorm',
};
