// Research / upgrade projects. Research runs over in-game time and costs money up front.

export interface ResearchDef {
  id: string;
  name: string;
  desc: string;
  cost: number;
  /** Game hours of work required. */
  hours: number;
  chapter: number;
  req?: string[];
  icon: string;
}

export const RESEARCH: ResearchDef[] = [
  { id: 'covered_bays', name: 'Covered Bays', desc: 'Unlocks roofed hitting bays that work in the rain.', cost: 3000, hours: 10, chapter: 1, icon: 'roof' },
  { id: 'premium_balls', name: 'Premium Range Balls', desc: 'Better range balls. Range visitors are happier and accept higher prices (+10%).', cost: 4000, hours: 12, chapter: 1, icon: 'ball' },
  { id: 'floodlights', name: 'Floodlights', desc: 'Unlocks floodlight towers. Lit bays stay open until 23:00.', cost: 12000, hours: 20, chapter: 2, icon: 'light' },
  { id: 'irrigation', name: 'Irrigation System', desc: 'Sprinklers keep turf healthy. Course wear reduced by 30%.', cost: 10000, hours: 20, chapter: 2, icon: 'drop' },
  { id: 'pro_mowers', name: 'Professional Mowers', desc: 'Greenkeepers restore turf 40% faster.', cost: 8000, hours: 16, chapter: 2, icon: 'mower' },
  { id: 'golf_carts', name: 'Golf Carts', desc: 'Unlocks the Cart Barn. Golfers rent carts and play faster.', cost: 15000, hours: 20, chapter: 2, icon: 'cart' },
  { id: 'loyalty_program', name: 'Membership Scheme', desc: 'Happy regulars sign up as members, paying dues every day and visiting more often.', cost: 12000, hours: 20, chapter: 2, icon: 'card' },
  { id: 'online_booking', name: 'Online Tee Booking', desc: '+15% course visitors and golfers tolerate waiting 30% longer.', cost: 18000, hours: 24, chapter: 2, icon: 'calendar' },
  { id: 'ball_tracking', name: 'Ball Tracking Tech', desc: 'Unlocks Tracker Bays with live ball-flight screens.', cost: 25000, hours: 30, chapter: 3, req: ['covered_bays'], icon: 'radar' },
  { id: 'golf_academy', name: 'Golf Academy', desc: 'Unlocks the Golf Academy and Golf Pro staff for paid lessons.', cost: 20000, hours: 30, chapter: 3, icon: 'cap' },
  { id: 'gourmet_kitchen', name: 'Gourmet Kitchen', desc: 'Unlocks the Restaurant. Food spending +15% everywhere.', cost: 22000, hours: 30, chapter: 3, icon: 'chef' },
  { id: 'exotic_trees', name: 'Exotic Trees', desc: 'Unlocks palms and cherry blossom trees.', cost: 9000, hours: 12, chapter: 3, icon: 'palm' },
  { id: 'merchandise', name: 'Club Merchandise', desc: 'Branded apparel line. Pro shop spending +25%.', cost: 16000, hours: 24, chapter: 3, icon: 'shirt' },
  { id: 'social_media', name: 'Social Media Team', desc: 'Marketing campaigns cost 30% less and last 2 days longer.', cost: 20000, hours: 24, chapter: 3, icon: 'phone' },
  { id: 'weather_station', name: 'Weather Station', desc: 'Accurate forecasts. Rain drives away 50% fewer visitors.', cost: 10000, hours: 16, chapter: 3, icon: 'cloud' },
  { id: 'gps_carts', name: 'GPS Carts', desc: 'Cart golfers play 25% faster and pay 20% more for carts.', cost: 30000, hours: 30, chapter: 4, req: ['golf_carts'], icon: 'gps' },
  { id: 'championship_greens', name: 'Championship Greens', desc: 'Bent-grass greens. Max turf condition is higher and serious golfers rate holes better.', cost: 45000, hours: 40, chapter: 4, req: ['irrigation'], icon: 'flag' },
  { id: 'tournament_licensing', name: 'Tournament Licensing', desc: 'Unlocks Grandstands and hosting official tournaments.', cost: 40000, hours: 36, chapter: 4, icon: 'trophy' },
  { id: 'night_golf', name: 'Night Golf', desc: 'Course lighting. Course stays open until 23:00.', cost: 60000, hours: 36, chapter: 4, req: ['floodlights'], icon: 'moon' },
  { id: 'eco_cert', name: 'Eco Certification', desc: 'Wildlife-friendly management. +5 permanent reputation and scenery counts 20% more.', cost: 35000, hours: 36, chapter: 4, icon: 'leaf' },
  { id: 'tv_broadcast', name: 'TV Broadcast Rights', desc: 'Tournament sponsorship and ticket income +75%.', cost: 90000, hours: 48, chapter: 5, req: ['tournament_licensing'], icon: 'tv' },
  { id: 'helipad', name: 'Helipad', desc: 'Unlocks the Helipad. Wealthy VIP golfers start visiting.', cost: 80000, hours: 40, chapter: 5, icon: 'heli' },
  { id: 'luxury_hotel', name: 'Luxury Hotel', desc: 'Unlocks the Grand Hotel.', cost: 150000, hours: 60, chapter: 5, icon: 'hotel' },
  { id: 'robotic_mowers', name: 'Robotic Mowers', desc: 'Autonomous overnight mowing. Turf recovers 50% overnight.', cost: 120000, hours: 60, chapter: 5, req: ['pro_mowers'], icon: 'robot' },
];

export const RESEARCH_BY_ID: Record<string, ResearchDef> = Object.fromEntries(RESEARCH.map((r) => [r.id, r]));
