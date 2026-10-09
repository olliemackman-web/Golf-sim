// Visitor archetypes.

export type VisitorTypeId =
  | 'beginner' | 'casual' | 'junior' | 'senior' | 'regular' | 'enthusiast' | 'business' | 'pro' | 'vip';

export interface VisitorType {
  id: VisitorTypeId;
  name: string;
  skill: [number, number];
  /** Spending money brought along. */
  wealth: [number, number];
  /** 0 = does not care about price, 1 = very price sensitive. */
  priceSens: number;
  /** Chance the visitor wants the driving range. */
  range: number;
  /** Chance the visitor wants to play the course. */
  course: number;
  /** Preferred course difficulty 0 easy .. 1 brutal. */
  hard: number;
  /** Minutes of waiting before getting annoyed. */
  patience: number;
  /** Reputation (0..100) needed before they show up. */
  minRep: number;
  weight: number;
  food: number;
  shop: number;
  cart: number;
  /** Party size range. */
  party: [number, number];
}

export const VISITOR_TYPES: Record<VisitorTypeId, VisitorType> = {
  beginner: { id: 'beginner', name: 'Beginner', skill: [0.05, 0.3], wealth: [40, 120], priceSens: 0.85, range: 0.9, course: 0.25, hard: 0.1, patience: 25, minRep: 0, weight: 3, food: 0.55, shop: 0.25, cart: 0.2, party: [1, 3] },
  casual: { id: 'casual', name: 'Casual Golfer', skill: [0.25, 0.5], wealth: [60, 200], priceSens: 0.65, range: 0.65, course: 0.55, hard: 0.35, patience: 35, minRep: 0, weight: 4, food: 0.6, shop: 0.3, cart: 0.35, party: [1, 4] },
  junior: { id: 'junior', name: 'Junior', skill: [0.15, 0.55], wealth: [20, 70], priceSens: 0.9, range: 0.75, course: 0.4, hard: 0.3, patience: 30, minRep: 15, weight: 1.5, food: 0.7, shop: 0.2, cart: 0.05, party: [1, 3] },
  senior: { id: 'senior', name: 'Senior', skill: [0.3, 0.6], wealth: [80, 250], priceSens: 0.5, range: 0.3, course: 0.85, hard: 0.3, patience: 50, minRep: 20, weight: 2, food: 0.75, shop: 0.3, cart: 0.7, party: [2, 4] },
  regular: { id: 'regular', name: 'Club Regular', skill: [0.45, 0.7], wealth: [120, 300], priceSens: 0.45, range: 0.5, course: 0.85, hard: 0.55, patience: 40, minRep: 30, weight: 3, food: 0.6, shop: 0.4, cart: 0.45, party: [2, 4] },
  enthusiast: { id: 'enthusiast', name: 'Enthusiast', skill: [0.6, 0.85], wealth: [200, 500], priceSens: 0.3, range: 0.6, course: 0.95, hard: 0.75, patience: 45, minRep: 50, weight: 2, food: 0.5, shop: 0.6, cart: 0.4, party: [1, 4] },
  business: { id: 'business', name: 'Business Client', skill: [0.3, 0.7], wealth: [400, 1500], priceSens: 0.12, range: 0.3, course: 0.9, hard: 0.4, patience: 30, minRep: 60, weight: 1.5, food: 0.9, shop: 0.5, cart: 0.9, party: [2, 4] },
  pro: { id: 'pro', name: 'Touring Pro', skill: [0.85, 1.0], wealth: [400, 1200], priceSens: 0.15, range: 0.75, course: 1, hard: 0.95, patience: 50, minRep: 78, weight: 0.8, food: 0.4, shop: 0.5, cart: 0.2, party: [1, 3] },
  vip: { id: 'vip', name: 'VIP', skill: [0.4, 0.8], wealth: [2000, 6000], priceSens: 0.02, range: 0.25, course: 1, hard: 0.5, patience: 25, minRep: 70, weight: 0.35, food: 1, shop: 0.8, cart: 1, party: [2, 4] },
};

export const FIRST_NAMES = [
  'James', 'Oliver', 'Harry', 'Jack', 'George', 'Noah', 'Charlie', 'Jacob', 'Alfie', 'Freddie', 'Oscar', 'Leo', 'Archie', 'Henry',
  'Amelia', 'Olivia', 'Isla', 'Ava', 'Mia', 'Isabella', 'Sophia', 'Grace', 'Lily', 'Freya', 'Emily', 'Ivy', 'Ella', 'Rosie',
  'Mohammed', 'Arjun', 'Priya', 'Aisha', 'Yuki', 'Kenji', 'Chen', 'Mei', 'Lucas', 'Mateo', 'Sofia', 'Lucia', 'Liam', 'Ethan',
  'Sam', 'Alex', 'Jordan', 'Robin', 'Taylor', 'Morgan', 'Rory', 'Seve', 'Bernhard', 'Annika', 'Lexi', 'Nelly', 'Tommy', 'Shane',
];
export const LAST_NAMES = [
  'Smith', 'Jones', 'Taylor', 'Brown', 'Williams', 'Wilson', 'Johnson', 'Davies', 'Patel', 'Wright', 'Walker', 'Thompson', 'Evans',
  'Roberts', 'Green', 'Hall', 'Wood', 'Clarke', 'Hughes', 'Edwards', 'Turner', 'Murphy', 'Kelly', 'Price', 'Bennett', 'Shaw',
  'Fairway', 'Birdie', 'Woods', 'Nicklaus', 'Palmer', 'Faldo', 'Lyle', 'Rose', 'Fleetwood', 'Hatton', 'Fitzpatrick', 'Lowry',
  'Kim', 'Tanaka', 'Garcia', 'Martinez', 'Singh', 'Khan', 'Novak', 'Larsen', 'Moreau', 'Rossi', 'Schmidt', 'Nakamura',
];

export const CLUB_NAME_IDEAS = [
  'Willow Creek Golf Club', 'Pinehurst Fields', 'Oakmere Links', 'Heather Ridge GC', 'Bramble Hollow', 'Silverbirch Park',
  'Kingfisher Lakes', 'Foxglove Downs', 'Larkspur Valley', 'Ashcombe Golf & Country', 'The Meadows at Elmstead',
];
