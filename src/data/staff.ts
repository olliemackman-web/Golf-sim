// Staff roles.

export type StaffRole = 'greenkeeper' | 'range' | 'cleaner' | 'marshal' | 'pro';

export interface StaffRoleDef {
  id: StaffRole;
  name: string;
  plural: string;
  desc: string;
  wage: number; // per day at level 1
  hire: number; // one-off hiring fee
  chapter?: number;
  research?: string;
  needs?: string; // item kind required on site
  shirt: number;
  pants: number;
}

export const STAFF_ROLES: Record<StaffRole, StaffRoleDef> = {
  greenkeeper: {
    id: 'greenkeeper', name: 'Greenkeeper', plural: 'Greenkeepers',
    desc: 'Mows fairways, greens and tees to keep the course in top condition. Worn turf makes golfers unhappy.',
    wage: 90, hire: 300, chapter: 2, shirt: 0x3d6b35, pants: 0x4a4636,
  },
  range: {
    id: 'range', name: 'Range Assistant', plural: 'Range Assistants',
    desc: 'Collects balls from the range and refills the dispensers. Much faster with a Ball Picker Garage.',
    wage: 75, hire: 250, chapter: 1, shirt: 0xd99a2b, pants: 0x2f3b4a,
  },
  cleaner: {
    id: 'cleaner', name: 'Groundskeeper', plural: 'Groundskeepers',
    desc: 'Picks up litter, empties bins and keeps the restrooms clean.',
    wage: 65, hire: 200, chapter: 1, shirt: 0x4f7fb8, pants: 0x2b3340,
  },
  marshal: {
    id: 'marshal', name: 'Course Marshal', plural: 'Course Marshals',
    desc: 'Patrols the course in a cart, keeping groups moving. Reduces waiting at tees.',
    wage: 85, hire: 300, chapter: 3, shirt: 0xb23a3a, pants: 0x2b2b2b,
  },
  pro: {
    id: 'pro', name: 'Golf Pro', plural: 'Golf Pros',
    desc: 'Gives paid lessons at the Golf Academy. Visitors love improving their game.',
    wage: 160, hire: 1500, research: 'golf_academy', needs: 'academy', shirt: 0x1c2a44, pants: 0xe9e3d0,
  },
};

export const STAFF_LIST = Object.values(STAFF_ROLES);
export const MAX_STAFF_LEVEL = 5;
export function trainCost(level: number): number {
  return 600 * level * level;
}
export function staffWage(role: StaffRole, level: number): number {
  return Math.round(STAFF_ROLES[role].wage * (1 + 0.18 * (level - 1)));
}
