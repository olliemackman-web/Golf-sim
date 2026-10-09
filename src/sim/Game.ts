// Central game controller: time, economy, reputation, construction, staff, research, goals, tournaments.
import {
  CLOSE_HOUR, DAYS_PER_SEASON, GAME_MIN_PER_SEC, MAINTAINED, MAP, OPEN_HOUR, PARCEL, PARCELS, ROAD_ROW, SEASONS, SURF_NAMES,
  Surf, TILE, inMap, tileIndex,
} from '../core/constants';
import { Emitter } from '../core/events';
import { RNG } from '../core/rng';
import { MARKETING_BY_ID, TOURNAMENT_BY_ID, TournamentDef, WeatherKind } from '../data/events';
import { CHAPTERS } from '../data/goals';
import { ITEMS, ItemDef, SURF_COST } from '../data/items';
import { RESEARCH_BY_ID } from '../data/research';
import { MAX_STAFF_LEVEL, STAFF_ROLES, StaffRole, staffWage, trainCost } from '../data/staff';
import { FIRST_NAMES, LAST_NAMES, VISITOR_TYPES } from '../data/visitors';
import { xpForLevel } from '../data/clubs';
import { Course } from '../world/Course';
import { Pathfinder } from '../world/Pathfinder';
import { PlacedObject, World, footprint } from '../world/World';
import { Colors, Person } from './agents';
import { pickVisitorType, spawnParty } from './behaviors';
import { Sim } from './Sim';
import { cleanerLife, greenkeeperLife, marshalLife, proLife, rangeAssistantLife } from './staffAI';
import { DayRecord, ExpenseKey, GameState, IncomeKey, StaffSave, emptyDay, newGameState } from './state';
import { TournamentRunner } from './tournament';

export type NotifyKind = 'info' | 'good' | 'bad' | 'goal' | 'money';

export type GameEvents = {
  money: { amount: number; x?: number; z?: number };
  notify: { text: string; kind: NotifyKind; x?: number; z?: number };
  sound: { name: string; x?: number; z?: number };
  hit: { x: number; z: number; kind: string; near: boolean };
  rangeHit: { x: number; z: number };
  splash: { x: number; z: number; small: boolean };
  sparkle: { x: number; z: number };
  cheer: { x: number; z: number; big: boolean };
  chapter: { num: number };
  goal: { id: string; name: string };
  research: { id: string };
  day: { day: number; record: DayRecord };
  victory: void;
  tournamentEnd: { id: string; results: { name: string; score: number; toPar: number; you?: boolean }[]; revenue: number; repGain: number };
  changed: void;
  autosave: void;
};

export interface ActionResult {
  ok: boolean;
  reason?: string;
  cost?: number;
}

/** Tunable economy numbers. */
export const BAL = {
  rangeBase: 1.6,
  rangePerBay: 0.7,
  courseBase: 0.45,
  coursePerHole: 0.3,
  fairBucket: 12,
  fairGreen9Base: 20,
  fairCart: 16,
  fairLesson: 45,
  fairMembership: 220,
  fairHotel: 150,
  loanRate: 0.002,
  maintenanceDecay: 9, // per day, condition points (0..255)
  wearMul: 1,
  memberCap: [0, 120, 400, 1500],
};

export class Game {
  state: GameState;
  world: World;
  pf: Pathfinder;
  course: Course;
  sim: Sim;
  events = new Emitter<GameEvents>();
  rng = new RNG((Date.now() & 0xffff) + 99);
  speed = 1;
  paused = false;
  /** True while the player is playing golf themselves. */
  frozen = false;
  lostBallsToday = 0;
  tournament: TournamentRunner | null = null;
  private arrivalAcc = { range: 0, course: 0 };
  private minuteAcc = 0;
  private lastHour = -1;
  private goalTimer = 0;
  private parkingNoteT = 0;
  private ballsNoteT = 0;
  private conditionTimer = 0;
  private roundsToday = 0;
  private happyLeftToday = 0;
  /** staff id -> person */
  staffPeople = new Map<number, Person>();
  prestigeCache = 0;

  constructor(state: GameState, world: World) {
    this.state = state;
    this.world = world;
    this.pf = new Pathfinder(world);
    this.course = new Course(world, this.pf, state.holes);
    this.sim = new Sim(this);
    this.applyResearchEffects();
    this.course.update();
    for (const s of state.staff) this.spawnStaff(s);
    this.prestigeCache = this.prestige();
    this.lastHour = Math.floor(state.minute / 60);
    this.checkTournament();
    world.on('objectAdded', () => this.events.emit('changed', undefined));
    world.on('objectRemoved', () => this.events.emit('changed', undefined));
  }

  static newGame(clubName: string, sandbox: boolean, seed = (Date.now() % 100000) + 7): Game {
    const state = newGameState(clubName, sandbox);
    const world = new World(seed);
    world.generate();
    const g = new Game(state, world);
    g.setupStart();
    return g;
  }

  static load(state: GameState): Game {
    const world = World.load(state.world!);
    const g = new Game(state, world);
    const rf = state.rangeField ?? [];
    for (let i = 0; i + 1 < rf.length; i += 2) g.sim.addFieldBall(rf[i] / 10, rf[i + 1] / 10);
    return g;
  }

  private setupStart(): void {
    const w = this.world;
    const cx = MAP / 2;
    // entrance sign by the road and a starter car park
    const sy = ROAD_ROW - 1;
    const signX = cx + 2;
    this.clearArea(signX - 1, sy - 6, signX + 12, sy);
    const h = w.avgBaseHeight(signX - 8, sy - 5, signX + 4, sy);
    w.flattenRect(signX - 8, sy - 4, signX + 4, sy, h, 2);
    w.addObject('entrance_sign', signX, sy, 0);
    const cpX = signX - 7;
    w.addObject('carpark', cpX, ROAD_ROW - 4, 0);
    // paved entrance plaza and path heading into the property
    for (let y = sy - 4; y <= sy; y++) for (let x = signX + 3; x <= signX + 5; x++) w.setSurf(x, y, Surf.Paving);
    for (let y = sy - 9; y < sy - 4; y++) w.setSurf(signX + 4, y, Surf.Path);
    w.commitSurf({ x0: signX - 2, y0: sy - 12, x1: signX + 8, y1: sy + 1 });
    this.state.world = null;
    this.state.flags.tutorial = 0;
  }

  private clearArea(x0: number, y0: number, x1: number, y1: number): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = this.world.treeAtTile(x, y);
      if (t) this.world.removeTree(t.id);
    }
  }

  // ---------------------------------------------------------------- time
  get hour(): number {
    return this.state.minute / 60;
  }
  get dayOfWeek(): number {
    return (this.state.day - 1) % 7;
  }
  get season(): number {
    return Math.floor((this.state.day - 1) / DAYS_PER_SEASON) % 4;
  }
  get seasonName(): string {
    return SEASONS[this.season];
  }
  get year(): number {
    return Math.floor((this.state.day - 1) / (DAYS_PER_SEASON * 4)) + 1;
  }
  isOpen(): boolean {
    const h = this.hour;
    const close = this.hasResearch('night_golf') ? 23 : CLOSE_HOUR;
    return h >= OPEN_HOUR && h < close;
  }
  /** 0 at night .. 1 midday. */
  daylight(): number {
    const h = this.hour;
    const sunrise = 5.4, sunset = 20.8;
    if (h < sunrise - 0.75 || h > sunset + 0.75) return 0;
    if (h < sunrise + 0.75) return (h - (sunrise - 0.75)) / 1.5;
    if (h > sunset - 0.75) return 1 - (h - (sunset - 0.75)) / 1.5;
    return 1;
  }
  isDaytime(): boolean {
    return this.daylight() > 0.35;
  }
  rangeOpen(): boolean {
    const h = this.hour;
    if (h < OPEN_HOUR) return false;
    if (this.isDaytime() && h < CLOSE_HOUR) return true;
    return h < 23 && this.world.objectsOfKind('floodlight').length > 0;
  }
  courseClosed(): boolean {
    if (this.tournament) return true;
    const sch = this.state.tournaments.scheduled;
    if (sch && sch.day === this.state.day) return true;
    const h = this.hour;
    const close = this.hasResearch('night_golf') ? 23 : CLOSE_HOUR + 0.5;
    return h >= close || h < OPEN_HOUR - 1;
  }
  isLitAt(p: { x: number; z: number }): boolean {
    for (const o of this.world.objectsOfKind('floodlight')) {
      const c = this.world.objectCenter(o);
      if (Math.hypot(c.x - p.x, c.z - p.z) < 70) return true;
    }
    return false;
  }
  timeString(): string {
    const m = Math.floor(this.state.minute) % 1440;
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  dayName(): string {
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][this.dayOfWeek];
  }

  update(realDt: number): void {
    if (this.paused || this.frozen) return;
    const dtReal = Math.min(realDt, 0.1);
    let speed = this.speed;
    // fast-forward empty nights
    const h = this.hour;
    const night = h >= 22 || h < OPEN_HOUR - 0.5;
    if (night && this.sim.visitorCount() === 0 && !this.tournament) speed = Math.max(speed, 14);
    let dt = dtReal * speed;
    // substep for stability at high speed
    const steps = Math.ceil(dt / 0.12);
    dt /= steps;
    for (let i = 0; i < steps; i++) this.step(dt);
  }

  private step(dt: number): void {
    const st = this.state;
    st.minute += dt * GAME_MIN_PER_SEC;
    if (st.minute >= 1440) {
      st.minute -= 1440;
      this.endOfDay();
    }
    const hourNow = Math.floor(st.minute / 60);
    if (hourNow !== this.lastHour) {
      this.lastHour = hourNow;
      this.onHour(hourNow);
    }
    this.minuteAcc += dt * GAME_MIN_PER_SEC;
    if (this.minuteAcc >= 1) {
      const mins = Math.floor(this.minuteAcc);
      this.minuteAcc -= mins;
      this.onMinutes(mins);
    }
    this.spawnArrivals(dt);
    this.sim.update(dt);
    this.tournament?.update(dt);
    // visitor needs
    for (const p of this.sim.people) {
      if (p.kind !== 'visitor' || p.removed) continue;
      p.hunger += dt * 0.09;
      p.thirst += dt * (this.season === 1 ? 0.14 : 0.1);
      p.bladder += dt * 0.07;
      if (p.visible && p.moving && this.rng.chance(dt * 0.5)) {
        const tx = Math.floor(p.x / TILE), ty = Math.floor(p.z / TILE);
        p.sceneSum += this.world.sceneryAt(tx, ty);
        p.sceneN++;
        if (this.sim.litter.length && this.rng.chance(0.2) && this.sim.litterNear(p.x, p.z, 10) >= 3) p.think('litter', 'There is litter everywhere!', -3);
      }
    }
    this.goalTimer -= dt;
    if (this.goalTimer <= 0) {
      this.goalTimer = 1.5;
      this.checkGoals();
      this.course.update();
    }
    this.conditionTimer -= dt;
    if (this.conditionTimer <= 0) {
      this.conditionTimer = 4;
      this.course.updateCondition();
    }
    this.parkingNoteT -= dt;
    this.ballsNoteT -= dt;
  }

  private onMinutes(mins: number): void {
    // research progress
    const r = this.state.research;
    if (r.current) {
      r.progress += mins / 60;
      const def = RESEARCH_BY_ID[r.current];
      if (def && r.progress >= def.hours) {
        r.done.push(r.current);
        const id = r.current;
        r.current = null;
        r.progress = 0;
        this.applyResearchEffects();
        this.events.emit('research', { id });
        this.notify(`Research complete: ${def.name}`, 'good');
        this.sound('unlock');
        const next = r.queue.shift();
        if (next) this.startResearch(next, true);
      }
    }
  }

  private onHour(h: number): void {
    if (h === OPEN_HOUR && this.state.day === 1 && !this.state.flags.welcomed) {
      this.state.flags.welcomed = 1;
    }
    if (h === OPEN_HOUR) this.notify(`${this.dayName()} morning — the club is open. ${this.weatherLabel()}.`, 'info');
    this.checkTournament();
  }

  // ---------------------------------------------------------------- arrivals
  timeCurve(h: number): number {
    const t = [0, 0, 0, 0, 0, 0, 0.2, 0.6, 0.95, 1.15, 1.2, 1.1, 1.0, 1.0, 1.0, 1.05, 1.15, 1.2, 1.05, 0.75, 0.45, 0.25, 0.1, 0];
    const i = Math.floor(h);
    const f = h - i;
    return t[i % 24] * (1 - f) + t[(i + 1) % 24] * f;
  }

  seasonMul(): number {
    return [1.0, 1.25, 0.95, 0.6][this.season];
  }

  weatherMul(): number {
    const k = this.state.weather.kind;
    const ws = this.hasResearch('weather_station');
    switch (k) {
      case 'sunny': return 1.12;
      case 'partly': return 1.0;
      case 'overcast': return 0.86;
      case 'rain': return ws ? 0.72 : 0.45;
      case 'storm': return ws ? 0.4 : 0.15;
    }
  }

  repFactor(): number {
    return 0.45 + (this.state.reputation / 100) * 1.4;
  }

  marketingBoost(): { all: number; types: Record<string, number> } {
    let all = 0;
    const types: Record<string, number> = {};
    for (const m of this.state.marketing) {
      const d = MARKETING_BY_ID[m.id];
      if (!d) continue;
      if (d.targets) for (const t of d.targets) types[t] = (types[t] ?? 0) + d.boost * 4;
      all += d.boost;
    }
    return { all, types };
  }

  priceFactor(price: number, fair: number): number {
    return Math.max(0.2, Math.min(1.3, 1.7 - 0.7 * (price / Math.max(1, fair))));
  }

  /** Expected parties per game hour for each stream. */
  arrivalRates(): { range: number; course: number } {
    const w = this.world;
    if (!this.isOpen() || this.hour > (this.hasResearch('night_golf') ? 21.5 : CLOSE_HOUR - 1.2)) return { range: 0, course: 0 };
    const common = this.repFactor() * this.seasonMul() * this.weatherMul() * this.timeCurve(this.hour) * (1 + this.marketingBoost().all) * (this.dayOfWeek >= 5 ? 1.3 : 1);
    const bays = w.objectsOfKind('bay').length;
    const disp = w.objectsOfKind('dispenser').length;
    let range = 0;
    if (bays > 0 && disp > 0 && this.rangeOpen()) {
      range = (BAL.rangeBase + bays * BAL.rangePerBay) * common * this.priceFactor(this.state.prices.bucket, BAL.fairBucket * (this.hasResearch('premium_balls') ? 1.1 : 1));
      const targets = w.objectsOfKind('target').length;
      range *= 1 + Math.min(0.3, targets * 0.06);
    }
    let course = 0;
    const holes = this.course.validHoles().length;
    if (holes > 0 && w.objectsOfKind('clubhouse').length > 0 && !this.courseClosed() && this.hour < 17.5) {
      const avg = this.course.averageRating();
      course = (BAL.courseBase + holes * BAL.coursePerHole) * (0.45 + avg / 100) * (1 + this.course.variety() * 0.15) * common;
      course *= this.priceFactor(this.state.prices.green9, this.fairGreenFee(9));
      if (this.hasResearch('online_booking')) course *= 1.15;
      // members and hotel guests
      course += (this.state.members * 0.006 + this.hotelGuests() * 0.012) * this.timeCurve(this.hour) * this.weatherMul();
    }
    return { range, course };
  }

  private spawnArrivals(dt: number): void {
    const rates = this.arrivalRates();
    const hours = (dt * GAME_MIN_PER_SEC) / 60;
    this.arrivalAcc.range += rates.range * hours;
    this.arrivalAcc.course += rates.course * hours;
    if (this.arrivalAcc.range >= 1) {
      this.arrivalAcc.range -= 1;
      if (this.rng.chance(0.85)) this.spawnVisitorParty('range');
    }
    if (this.arrivalAcc.course >= 1) {
      this.arrivalAcc.course -= 1;
      if (this.rng.chance(0.85)) this.spawnVisitorParty('course');
    }
  }

  spawnVisitorParty(stream: 'range' | 'course'): void {
    const t = pickVisitorType(this.sim, this.marketingBoost().types);
    if (!t) return;
    const vt = VISITOR_TYPES[t];
    const canRange = this.world.objectsOfKind('bay').length > 0 && this.world.objectsOfKind('dispenser').length > 0 && this.rangeOpen();
    const valid = this.course.validHoles();
    const canCourse = valid.length > 0 && this.world.objectsOfKind('clubhouse').length > 0 && !this.courseClosed() && this.hour < 17.5;
    let wantRange = false, wantCourse = false;
    if (stream === 'range') {
      if (!canRange) return;
      wantRange = true;
      wantCourse = canCourse && this.rng.chance(vt.course * 0.25);
    } else {
      if (!canCourse) return;
      wantCourse = true;
      wantRange = canRange && this.rng.chance(vt.range * 0.3);
    }
    let holes: number[] = [];
    if (wantCourse) {
      const ids = valid.map((h) => h.save.id);
      if (ids.length <= 9) holes = ids;
      else {
        const eighteen = this.hour < 12 && this.rng.chance(t === 'pro' || t === 'enthusiast' ? 0.7 : 0.5);
        if (eighteen) holes = ids.slice(0, 18);
        else holes = this.rng.chance(0.5) ? ids.slice(0, 9) : ids.slice(9, 18);
        if (holes.length < 5) holes = ids.slice(0, 9);
      }
      if (this.hour >= 15 && holes.length > 9) holes = holes.slice(0, 9);
    }
    const member = wantCourse && this.state.members > 0 && this.rng.chance(Math.min(0.5, this.state.members / 400));
    const heli = t === 'vip' && this.world.objectsOfKind('helipad').length > 0;
    spawnParty(this.sim, t, wantRange, wantCourse, holes, { member, helicopter: heli });
  }

  noteParkingFull(): void {
    this.state.flags.parkingFull = (this.state.flags.parkingFull ?? 0) + 1;
    if (this.parkingNoteT <= 0) {
      this.parkingNoteT = 120;
      this.notify('Visitors drove away — the car park is full! Build another car park by the road.', 'bad');
    }
  }
  noteNoBalls(): void {
    if (this.ballsNoteT <= 0) {
      this.ballsNoteT = 300;
      const ra = this.staffOfRole('range').length;
      this.notify(ra ? 'The dispensers are empty! Buy more range balls or hire more Range Assistants.' : 'The dispensers are empty! Hire a Range Assistant to collect balls from the range.', 'bad');
    }
  }

  // ---------------------------------------------------------------- visitors
  onVisitorArrived(p: Person): void {
    this.state.stats.totalVisitors++;
    this.state.stats.today.visitors++;
  }

  onVisitorLeft(p: Person): void {
    if (p.kind !== 'visitor') return;
    // scenery impression
    if (p.sceneN > 0) {
      const avg = p.sceneSum / p.sceneN;
      const eco = this.hasResearch('eco_cert') ? 1.2 : 1;
      const d = Math.max(-5, Math.min(7, (avg * eco - 18) * 0.2));
      if (d > 3) p.think('scenery', 'Such a beautiful place', d);
      else if (d < -2) p.think('ugly', 'The grounds are a bit bare and ugly', d);
      else p.happiness += d;
    }
    if (p.bladder > 85 && this.world.objectsOfKind('toilet').length === 0) p.happiness -= 4;
    p.happiness = Math.max(0, Math.min(100, p.happiness));
    for (const t of p.thoughts) this.sim.tallyThought(t.key, t.text, t.good);
    const td = this.state.stats.today;
    td.happiness += p.happiness;
    td.happyCount++;
    if (p.happiness >= 70) this.happyLeftToday++;
    // reputation drifts towards visitor experience blended with club prestige
    const mapped = Math.max(0, Math.min(100, (p.happiness - 35) * 1.6));
    const target = 0.55 * mapped + 0.45 * this.prestigeCache;
    this.state.reputation += (target - this.state.reputation) * 0.0035;
    this.state.reputation = Math.max(0, Math.min(100, this.state.reputation));
  }

  reputationBoost(x: number): void {
    this.state.reputation = Math.min(100, this.state.reputation + x);
  }

  /** Club prestige 0..100 from facilities and achievements. */
  prestige(): number {
    const w = this.world;
    let p = 0;
    const ch = w.objectsOfKind('clubhouse')[0];
    if (ch) p += [0, 8, 14, 20][ch.level] ?? 8;
    const holes = this.course.validHoles().length;
    p += (Math.min(18, holes) / 18) * 25 * Math.min(1.15, this.course.averageRating() / 65);
    const am: [string, number][] = [['toilets', 2], ['cafe', 3], ['pro_shop', 3], ['bar', 3], ['restaurant', 4], ['academy', 3], ['practice_green', 2], ['cart_shed', 2], ['halfway_house', 2], ['chipping_area', 1]];
    for (const [t, v] of am) if (w.objectsOfType(t).length) p += v;
    p += Math.min(1, w.objectsOfKind('bay').length / 12) * 6 + (w.objectsOfType('bay_premium').length ? 2 : 0);
    const hosted = new Set(this.state.tournaments.history.map((t) => t.id));
    p += (hosted.has('club_championship') ? 3 : 0) + (hosted.has('regional_open') ? 5 : 0) + (hosted.has('national_championship') ? 7 : 0) + (hosted.has('grand_open') ? 10 : 0);
    if (w.objectsOfKind('hotel').length) p += 8;
    if (w.objectsOfKind('helipad').length) p += 2;
    if (this.hasResearch('eco_cert')) p += 5;
    // scenery around the clubhouse
    if (ch) {
      const c = w.objectCenter(ch);
      p += Math.min(6, w.sceneryAt(Math.floor(c.x / TILE), Math.floor(c.z / TILE)) / 8);
    }
    return Math.min(100, p);
  }

  // ---------------------------------------------------------------- prices & spending
  bucketPrice(tier: number): number {
    return Math.round(this.state.prices.bucket * [1, 1, 1.3, 2.1][tier] * 100) / 100;
  }
  fairBucketPrice(tier: number): number {
    return BAL.fairBucket * [1, 1, 1.3, 2.1][tier] * (this.hasResearch('premium_balls') ? 1.1 : 1) * (0.9 + this.state.reputation / 500);
  }
  greenFee(holes: number): number {
    return Math.round(this.state.prices.green9 * (holes / 9) * 100) / 100;
  }
  fairGreenFee(holes: number): number {
    const avg = this.course.averageRating();
    const ch = this.world.objectsOfKind('clubhouse')[0];
    return (BAL.fairGreen9Base + avg * 0.42 + this.state.reputation * 0.32 + (ch ? (ch.level - 1) * 6 : 0)) * (holes / 9);
  }
  cartPrice(): number {
    return this.state.prices.cart;
  }
  fairCartPrice(): number {
    return BAL.fairCart * (this.hasResearch('gps_carts') ? 1.2 : 1);
  }
  fairLessonPrice(): number {
    return BAL.fairLesson + this.state.reputation * 0.35;
  }

  priceCheck(p: Person, price: number, fair: number): 'cheap' | 'ok' | 'refuse' {
    const vt = VISITOR_TYPES[p.vtype];
    if (price > p.cash) return 'refuse';
    const wealth = Math.min(1.7, 0.85 + p.cash / 600);
    const willing = fair * (1.6 - vt.priceSens * 0.6) * wealth * this.rng.range(0.85, 1.15);
    if (price > willing) return 'refuse';
    if (price < fair * 0.72) return 'cheap';
    return 'ok';
  }

  foodSpend(p: Person, base: number): number {
    const lvl = this.state.prices.food;
    const vt = VISITOR_TYPES[p.vtype];
    const willing = 1 + (1 - vt.priceSens) * 0.9;
    if (lvl > willing * this.rng.range(0.85, 1.2)) return 0;
    const amt = base * lvl * this.rng.range(0.7, 1.3) * (this.hasResearch('gourmet_kitchen') ? 1.15 : 1) * Math.min(2, Math.max(0.7, p.cash / 150));
    return Math.min(p.cash, Math.round(amt * 100) / 100);
  }

  shopSpend(p: Person, level: number): number {
    const lvl = this.state.prices.shop;
    const vt = VISITOR_TYPES[p.vtype];
    const willing = 1 + (1 - vt.priceSens) * 0.8;
    if (lvl > willing * this.rng.range(0.85, 1.2)) return 0;
    const base = (ITEMS.pro_shop.spend ?? 28) * (level >= 2 ? 1.6 : 1) * (this.hasResearch('merchandise') ? 1.25 : 1);
    const amt = base * lvl * this.rng.range(0.4, 1.6) * Math.min(2.5, Math.max(0.6, p.cash / 200));
    return Math.min(p.cash * 0.7, Math.round(amt * 100) / 100);
  }

  hotelGuests(): number {
    if (!this.world.objectsOfKind('hotel').length) return 0;
    const occ = Math.min(0.95, 0.2 + (this.state.reputation / 100) * 0.75) * this.priceFactor(this.state.prices.hotel, BAL.fairHotel + this.state.reputation * 1.5);
    return Math.round(80 * occ);
  }

  // ---------------------------------------------------------------- money
  earn(cat: IncomeKey, amount: number, at?: { x: number; z: number }): void {
    if (amount <= 0) return;
    this.state.money += amount;
    const td = this.state.stats.today;
    td.income[cat] = (td.income[cat] ?? 0) + amount;
    this.state.stats.totalRevenue += amount;
    this.events.emit('money', { amount, x: at?.x, z: at?.z });
  }

  /** Spend money; returns false if not affordable (unless forced). */
  spend(cat: ExpenseKey, amount: number, force = false, at?: { x: number; z: number }): boolean {
    if (amount <= 0) return true;
    if (!force && !this.canAfford(amount)) return false;
    this.state.money -= amount;
    const td = this.state.stats.today;
    td.expense[cat] = (td.expense[cat] ?? 0) + amount;
    if (at) this.events.emit('money', { amount: -amount, x: at.x, z: at.z });
    return true;
  }

  canAfford(n: number): boolean {
    return this.state.sandbox || this.state.money >= n;
  }

  maxLoan(): number {
    return Math.min(3_000_000, Math.round((60000 + this.assetValue() * 0.35) / 1000) * 1000);
  }

  takeLoan(amount: number): ActionResult {
    const room = this.maxLoan() - this.state.loan;
    if (amount > room) return { ok: false, reason: 'The bank will not lend you that much' };
    this.state.loan += amount;
    this.state.money += amount;
    this.notify(`Borrowed ${fmt(amount)} from the bank`, 'info');
    return { ok: true };
  }

  repayLoan(amount: number): ActionResult {
    amount = Math.min(amount, this.state.loan);
    if (this.state.money < amount) return { ok: false, reason: 'Not enough money' };
    this.state.loan -= amount;
    this.state.money -= amount;
    return { ok: true };
  }

  assetValue(): number {
    let v = 0;
    for (const o of this.world.objects.values()) {
      const def = ITEMS[o.type];
      v += def.cost * 0.6;
      if (def.upgrades) for (let l = 1; l < o.level; l++) v += (def.upgrades[l - 1]?.cost ?? 0) * 0.6;
    }
    v += this.world.ownedCount() * 7000;
    for (const h of this.course.validHoles()) v += 9000 * (0.5 + h.rating / 100);
    v += this.state.reputation * 3000;
    v += this.state.members * 1500;
    return v;
  }

  clubValue(): number {
    const hist = this.state.stats.history.slice(-5);
    const avgProfit = hist.length ? hist.reduce((s, d) => s + dayProfit(d), 0) / hist.length : 0;
    return Math.max(0, this.state.money - this.state.loan + this.assetValue() + Math.max(0, avgProfit) * 40);
  }

  // ---------------------------------------------------------------- day end
  private endOfDay(): void {
    const st = this.state;
    const w = this.world;
    // costs
    let wages = 0;
    for (const s of st.staff) wages += staffWage(s.role, s.level);
    this.spend('wages', wages, true);
    let upkeep = 0;
    for (const o of w.objects.values()) {
      const def = ITEMS[o.type];
      upkeep += o.level > 1 && def.upgrades ? def.upgrades[o.level - 2]?.upkeep ?? def.upkeep : def.upkeep;
    }
    upkeep += this.course.validHoles().length * 25;
    this.spend('upkeep', upkeep, true);
    if (st.loan > 0) this.spend('interest', Math.round(st.loan * BAL.loanRate), true);
    // members
    if (this.hasResearch('loyalty_program') && w.objectsOfKind('clubhouse').length) {
      const ch = w.objectsOfKind('clubhouse')[0];
      const cap = BAL.memberCap[ch.level] ?? 120;
      const pf = this.priceFactor(st.prices.membership, BAL.fairMembership + st.reputation * 2.5);
      const joiners = this.happyLeftToday * 0.06 * pf * (0.4 + st.reputation / 100) * (this.course.validHoles().length >= 9 ? 1 : 0.5);
      const churn = st.members * (0.012 + Math.max(0, 0.6 - pf) * 0.05 + (st.reputation < 40 ? 0.02 : 0));
      st.members = Math.max(0, Math.min(cap, st.members + joiners - churn));
      const dues = Math.floor(st.members) * st.prices.membership / 10;
      this.earn('members', dues);
    }
    // hotel
    const guests = this.hotelGuests();
    if (guests > 0) this.earn('hotel', guests * st.prices.hotel);
    // turf growth / wear overnight
    const robo = this.hasResearch('robotic_mowers');
    const decay = BAL.maintenanceDecay * [1, 1.3, 0.9, 0.4][this.season] * (this.hasResearch('irrigation') ? 0.7 : 1);
    const cond = w.condition;
    for (let i = 0; i < MAP * MAP; i++) {
      if (!MAINTAINED.has(w.surf[i] as Surf)) continue;
      let c = cond[i] - decay * this.rng.range(0.6, 1.4);
      if (robo) c += (this.maxCondition() - c) * 0.5;
      cond[i] = Math.max(20, Math.min(this.maxCondition(), c));
    }
    // marketing countdown
    st.marketing = st.marketing.filter((m) => --m.daysLeft > 0);
    // record the day
    const rec = st.stats.today;
    rec.rep = st.reputation;
    const profit = dayProfit(rec);
    st.stats.bestDayProfit = Math.max(st.stats.bestDayProfit, profit);
    st.stats.history.push(rec);
    if (st.stats.history.length > 120) st.stats.history.shift();
    this.events.emit('day', { day: st.day, record: rec });
    // new day
    st.day++;
    st.stats.today = emptyDay(st.day);
    this.sim.thoughts.clear();
    if (this.lostBallsToday >= 60) this.notify(`${this.lostBallsToday} range balls were lost today — they flew off your land or into water. Face bays towards open land you own.`, 'bad');
    this.happyLeftToday = 0;
    this.roundsToday = 0;
    this.lostBallsToday = 0;
    this.rollWeather();
    this.prestigeCache = this.prestige();
    if (st.day % DAYS_PER_SEASON === 1 && st.day > 1) this.notify(`${this.seasonName} has arrived.`, 'info');
    if (st.money < 0 && st.loan >= this.maxLoan()) this.notify('You are in debt and the bank will lend no more. Cut costs fast!', 'bad');
    this.events.emit('autosave', undefined);
  }

  maxCondition(): number {
    return this.hasResearch('championship_greens') ? 255 : 240;
  }

  rollWeather(): void {
    const s = this.season;
    const w = this.state.weather;
    w.kind = w.tomorrow;
    const r = this.rng.next();
    const rainy = [0.18, 0.1, 0.22, 0.28][s];
    let k: WeatherKind;
    if (r < rainy * 0.15) k = 'storm';
    else if (r < rainy) k = 'rain';
    else if (r < rainy + 0.15) k = 'overcast';
    else if (r < rainy + 0.4) k = 'partly';
    else k = 'sunny';
    w.tomorrow = k;
    w.wind = Math.round(this.rng.range(0, 1) ** 1.6 * (k === 'storm' ? 30 : 20) + 2);
    w.windDir = this.rng.range(0, Math.PI * 2);
  }

  weatherRain(): boolean {
    return this.state.weather.kind === 'rain' || this.state.weather.kind === 'storm';
  }

  weatherLabel(): string {
    const k = this.state.weather.kind;
    const names: Record<WeatherKind, string> = { sunny: 'Sunny', partly: 'Partly cloudy', overcast: 'Overcast', rain: 'Rain', storm: 'Thunderstorms' };
    return `${names[k]}, wind ${this.state.weather.wind} mph`;
  }

  // ---------------------------------------------------------------- sim helpers
  patienceMul(): number {
    return (this.hasResearch('online_booking') ? 1.3 : 1) * (1 + this.staffOfRole('marshal').length * 0.06);
  }
  preShotTime(): number {
    const marshals = this.staffOfRole('marshal').length;
    return 0.4 * (1 - Math.min(0.45, marshals * 0.12)) * (this.hasResearch('online_booking') ? 0.9 : 1);
  }
  greenSpeed(): number {
    return this.hasResearch('championship_greens') ? 1.15 : 1;
  }
  targetNear(x: number, z: number): boolean {
    for (const o of this.world.objectsOfKind('target')) {
      const c = this.world.objectCenter(o);
      const def = ITEMS[o.type];
      const r = def.w * TILE * 0.45;
      if ((c.x - x) ** 2 + (c.z - z) ** 2 < r * r) return true;
    }
    return false;
  }
  wearTile(x: number, z: number, amt: number): void {
    const tx = Math.floor(x / TILE), ty = Math.floor(z / TILE);
    if (!inMap(tx, ty)) return;
    const i = tileIndex(tx, ty);
    if (!MAINTAINED.has(this.world.surf[i] as Surf)) return;
    const m = this.hasResearch('irrigation') ? 0.7 : 1;
    this.world.condition[i] = Math.max(15, this.world.condition[i] - amt * m * BAL.wearMul);
    this.conditionDirty = true;
  }
  conditionDirty = false;
  mowRate(p: Person): number {
    const hasShed = this.world.objectsOfKind('maintenance').length > 0;
    return 26 * this.staffSpeed(p) * (hasShed ? 1.3 : 1) * (this.hasResearch('pro_mowers') ? 1.4 : 1);
  }
  mowAt(x: number, z: number, amt: number): void {
    const w = this.world;
    const tx0 = Math.floor(x / TILE);
    const ty0 = Math.floor(z / TILE);
    const max = this.maxCondition();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const tx = tx0 + dx, ty = ty0 + dy;
      if (!inMap(tx, ty)) continue;
      const i = tileIndex(tx, ty);
      if (!MAINTAINED.has(w.surf[i] as Surf)) continue;
      const f = dx === 0 && dy === 0 ? 1 : 0.5;
      w.condition[i] = Math.min(max, w.condition[i] + amt * f);
    }
    this.conditionDirty = true;
  }
  staffSpeed(p: Person): number {
    const s = this.state.staff.find((x) => x.id === p.staffId);
    return 1 + ((s?.level ?? 1) - 1) * 0.18;
  }
  freePros(): number {
    return this.staffOfRole('pro').length - this.sim.lessonsActive;
  }
  recordRound(holes: number, players: number): void {
    this.roundsToday += players;
  }

  // ---------------------------------------------------------------- unlocks
  hasResearch(id: string): boolean {
    return this.state.sandbox || this.state.research.done.includes(id);
  }

  isUnlocked(def: { chapter?: number; research?: string }): { ok: boolean; reason?: string } {
    if (this.state.sandbox) return { ok: true };
    if (def.chapter && this.state.chapter < def.chapter) return { ok: false, reason: `Unlocks in Chapter ${def.chapter}` };
    if (def.research && !this.hasResearch(def.research)) return { ok: false, reason: `Requires research: ${RESEARCH_BY_ID[def.research]?.name ?? def.research}` };
    return { ok: true };
  }

  // ---------------------------------------------------------------- construction
  placeItem(type: string, x: number, y: number, rot: number): ActionResult {
    const def = ITEMS[type];
    if (!def) return { ok: false, reason: 'Unknown item' };
    const u = this.isUnlocked(def);
    if (!u.ok) return { ok: false, reason: u.reason };
    if (def.max && this.world.objectsOfType(type).length >= def.max) return { ok: false, reason: `You can only build ${def.max}` };
    const can = this.world.canPlace(def, x, y, rot);
    if (!can.ok) return { ok: false, reason: can.reason };
    const cost = def.cost + can.treeCost;
    if (!this.canAfford(cost)) return { ok: false, reason: 'Not enough money' };
    const f = footprint(def, rot);
    // level the ground under buildings
    if (def.kind !== 'tree' && (f.w * f.h >= 2 || def.kind === 'bay')) {
      const h = this.world.avgBaseHeight(x, y, x + f.w - 1, y + f.h - 1);
      this.world.flattenRect(x, y, x + f.w - 1, y + f.h - 1, h, f.w * f.h >= 6 ? 2 : 1);
    }
    const o = this.world.addObject(type, x, y, rot, 1);
    if (def.kind === 'bay') o.data = { num: this.world.objectsOfKind('bay').length };
    const c = this.world.objectCenter(o);
    this.spend('construction', cost, false, c);
    this.sound('build');
    this.course.markDirty();
    this.prestigeCache = this.prestige();
    return { ok: true, cost };
  }

  /** Remove whatever is on a tile. */
  bulldoze(x: number, y: number): ActionResult {
    const w = this.world;
    if (!w.isOwnedTile(x, y)) return { ok: false, reason: 'You do not own this land' };
    const o = w.objectAtTile(x, y);
    if (o) {
      const def = ITEMS[o.type];
      if (def.fixed) return { ok: false, reason: 'This cannot be removed' };
      const refund = Math.round(def.cost * 0.4);
      const c = w.objectCenter(o);
      w.removeObject(o.id);
      if (refund) {
        // a refund reduces today's construction spending rather than counting as income
        this.state.money += refund;
        const td = this.state.stats.today;
        td.expense.construction = (td.expense.construction ?? 0) - refund;
        this.events.emit('money', { amount: refund, x: c.x, z: c.z });
      }
      this.sound('bulldoze');
      this.course.markDirty();
      this.prestigeCache = this.prestige();
      return { ok: true, cost: -refund };
    }
    const t = w.treeAtTile(x, y);
    if (t) {
      const cost = t.nat ? 60 : 20;
      if (!this.canAfford(cost)) return { ok: false, reason: 'Not enough money' };
      w.removeTree(t.id);
      this.spend('construction', cost, false, { x: t.x, z: t.z });
      this.sound('bulldoze');
      return { ok: true, cost };
    }
    return { ok: false, reason: 'Nothing to remove' };
  }

  upgradeObject(id: number): ActionResult {
    const o = this.world.objects.get(id);
    if (!o) return { ok: false, reason: 'Gone' };
    const def = ITEMS[o.type];
    const up = def.upgrades?.[o.level - 1];
    if (!up) return { ok: false, reason: 'Fully upgraded' };
    const u = this.isUnlocked(up);
    if (!u.ok) return { ok: false, reason: u.reason };
    if (!this.canAfford(up.cost)) return { ok: false, reason: 'Not enough money' };
    this.spend('construction', up.cost, false, this.world.objectCenter(o));
    o.level++;
    this.world.emit('objectChanged', o);
    this.world.sceneryDirty = true;
    this.sound('build');
    this.notify(`${def.name} upgraded: ${up.name}`, 'good');
    this.prestigeCache = this.prestige();
    return { ok: true, cost: up.cost };
  }

  rotateObject(id: number): ActionResult {
    const o = this.world.objects.get(id);
    if (!o) return { ok: false };
    const def = ITEMS[o.type];
    if (def.w !== def.h || def.place === 'roadside') return { ok: false, reason: 'Only square items can be rotated in place' };
    o.rot = (o.rot + 1) % 4;
    this.world.emit('objectChanged', o);
    return { ok: true };
  }

  /** Paint a set of tiles. Returns cost charged. */
  paint(tiles: { x: number; y: number }[], surf: Surf): ActionResult {
    const w = this.world;
    const unit = SURF_COST[surf] ?? 10;
    const todo: { x: number; y: number }[] = [];
    let treeCost = 0;
    for (const t of tiles) {
      if (!inMap(t.x, t.y) || !w.isOwnedTile(t.x, t.y)) continue;
      const i = tileIndex(t.x, t.y);
      if (w.occ[i] !== 0) continue;
      if (w.surf[i] === surf) continue;
      const clearsTrees = surf !== Surf.Rough && surf !== Surf.DeepRough;
      if (clearsTrees && w.treeAt[i]) treeCost += 30;
      todo.push(t);
    }
    if (!todo.length) return { ok: false, reason: 'Nothing to change' };
    const cost = todo.length * unit + treeCost;
    if (!this.canAfford(cost)) return { ok: false, reason: 'Not enough money' };
    let x0 = MAP, y0 = MAP, x1 = 0, y1 = 0;
    for (const t of todo) {
      const i = tileIndex(t.x, t.y);
      if (surf !== Surf.Rough && surf !== Surf.DeepRough && w.treeAt[i]) w.removeTree(w.treeAt[i]);
      w.setSurf(t.x, t.y, surf);
      x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); x1 = Math.max(x1, t.x); y1 = Math.max(y1, t.y);
    }
    w.commitSurf({ x0, y0, x1, y1 });
    this.spend('construction', cost);
    this.course.markDirty();
    return { ok: true, cost };
  }

  paintCost(tiles: { x: number; y: number }[], surf: Surf): number {
    const w = this.world;
    const unit = SURF_COST[surf] ?? 10;
    let n = 0;
    for (const t of tiles) {
      if (!inMap(t.x, t.y) || !w.isOwnedTile(t.x, t.y)) continue;
      const i = tileIndex(t.x, t.y);
      if (w.occ[i] !== 0 || w.surf[i] === surf) continue;
      n += unit + (w.treeAt[i] && surf !== Surf.Rough && surf !== Surf.DeepRough ? 30 : 0);
    }
    return n;
  }

  placeTree(type: string, wx: number, wz: number): ActionResult {
    const def = ITEMS[type];
    const u = this.isUnlocked(def);
    if (!u.ok) return { ok: false, reason: u.reason };
    const tx = Math.floor(wx / TILE), ty = Math.floor(wz / TILE);
    if (!this.world.isOwnedTile(tx, ty)) return { ok: false, reason: 'You do not own this land' };
    const s = this.world.surfAtTile(tx, ty);
    if (s === Surf.Water || s === Surf.Green || s === Surf.Tee || s === Surf.Bunker || s === Surf.Path || s === Surf.Road || s === Surf.Paving) return { ok: false, reason: `Trees cannot grow on ${SURF_NAMES[s]}` };
    if (!this.canAfford(def.cost)) return { ok: false, reason: 'Not enough money' };
    const t = this.world.addTree(type, wx, wz, this.rng.range(0.85, 1.15), this.rng.range(0, Math.PI * 2));
    if (!t) return { ok: false, reason: 'No room here' };
    this.spend('construction', def.cost);
    this.course.markDirty();
    return { ok: true, cost: def.cost };
  }

  terraform(wx: number, wz: number, radius: number, mode: 'raise' | 'lower' | 'flatten' | 'smooth', target: number): ActionResult {
    const cost = 15;
    if (!this.world.isOwnedWorld(wx, wz)) return { ok: false, reason: 'You do not own this land' };
    if (!this.canAfford(cost)) return { ok: false, reason: 'Not enough money' };
    const amt = mode === 'raise' || mode === 'lower' ? 0.35 : 0.5;
    // keep buildings level: skip vertices under objects
    this.world.terraform(wx, wz, radius, amt, mode, target);
    this.spend('construction', cost);
    this.course.markDirty();
    return { ok: true, cost };
  }

  buyParcel(px: number, py: number): ActionResult {
    const w = this.world;
    if (!w.canBuyParcel(px, py)) return { ok: false, reason: 'You can only buy land next to land you own' };
    const price = w.parcelPrice(px, py);
    if (!this.canAfford(price)) return { ok: false, reason: 'Not enough money' };
    this.spend('land', price, false, { x: (px + 0.5) * PARCEL * TILE, z: (py + 0.5) * PARCEL * TILE });
    w.buyParcel(px, py);
    this.pf.invalidate();
    this.course.markDirty();
    this.sound('cash');
    return { ok: true, cost: price };
  }

  createHole(tee: { x: number; y: number }, pin: { x: number; y: number }): ActionResult {
    if (this.course.holes.length >= 18) return { ok: false, reason: 'A course can have at most 18 holes' };
    const cost = 500;
    if (!this.canAfford(cost)) return { ok: false, reason: 'Not enough money' };
    this.spend('construction', cost);
    const h = this.course.addHole(tee, pin);
    this.course.update();
    this.state.holes = this.course.saves();
    if (h.valid) this.notify(`Hole ${h.num} is open! Par ${h.par}, ${h.yards} yards.`, 'good');
    else this.notify(`Hole ${h.num} placed, but it is not playable yet: ${h.issues[0]}`, 'bad');
    this.sound('build');
    return { ok: true, cost };
  }

  // ---------------------------------------------------------------- staff
  staffOfRole(role: StaffRole): StaffSave[] {
    return this.state.staff.filter((s) => s.role === role);
  }

  hire(role: StaffRole): ActionResult {
    const def = STAFF_ROLES[role];
    const u = this.isUnlocked(def);
    if (!u.ok) return { ok: false, reason: u.reason };
    if (def.needs && this.world.objectsOfKind(def.needs).length === 0) return { ok: false, reason: `Build a ${ITEMS[def.needs]?.name ?? 'Golf Academy'} first` };
    if (!this.canAfford(def.hire)) return { ok: false, reason: 'Not enough money' };
    this.spend('staffing', def.hire);
    const s: StaffSave = { id: this.state.nextStaffId++, role, name: `${this.rng.pick(FIRST_NAMES)} ${this.rng.pick(LAST_NAMES)}`, level: 1, hiredDay: this.state.day };
    this.state.staff.push(s);
    this.spawnStaff(s);
    this.notify(`Hired ${s.name} as a ${def.name}`, 'good');
    this.sound('cash');
    return { ok: true, cost: def.hire };
  }

  fire(id: number): void {
    const i = this.state.staff.findIndex((s) => s.id === id);
    if (i < 0) return;
    this.state.staff.splice(i, 1);
    const p = this.staffPeople.get(id);
    if (p) {
      p.co?.return(undefined);
      this.sim.removePerson(p);
    }
    this.staffPeople.delete(id);
  }

  train(id: number): ActionResult {
    const s = this.state.staff.find((x) => x.id === id);
    if (!s) return { ok: false };
    if (s.level >= MAX_STAFF_LEVEL) return { ok: false, reason: 'Already fully trained' };
    const cost = trainCost(s.level);
    if (!this.canAfford(cost)) return { ok: false, reason: 'Not enough money' };
    this.spend('staffing', cost);
    s.level++;
    this.notify(`${s.name} trained to level ${s.level}`, 'good');
    return { ok: true, cost };
  }

  private spawnStaff(s: StaffSave): void {
    const def = STAFF_ROLES[s.role];
    const colors: Colors = { shirt: def.shirt, pants: def.pants, skin: this.rng.pick([0xf1c9a5, 0xe0ac86, 0xc68a62, 0x9b6440, 0x6b4428]), hair: 0x3a2a1a, hat: def.shirt, hatType: s.role === 'greenkeeper' || s.role === 'range' ? 1 : s.role === 'pro' ? 2 : 0 };
    const start = this.sim.entranceSpot();
    const p = this.sim.addPerson(colors, start.x + this.rng.range(-3, 3), start.z - 2);
    p.kind = 'staff';
    p.role = s.role;
    p.staffId = s.id;
    p.name = s.name;
    p.bag = s.role === 'pro';
    p.speed *= 1.05;
    switch (s.role) {
      case 'greenkeeper': p.co = greenkeeperLife(this.sim, p); break;
      case 'range': p.co = rangeAssistantLife(this.sim, p); break;
      case 'cleaner': p.co = cleanerLife(this.sim, p); break;
      case 'marshal': p.co = marshalLife(this.sim, p); break;
      case 'pro': p.co = proLife(this.sim, p); break;
    }
    this.staffPeople.set(s.id, p);
  }

  dailyWages(): number {
    return this.state.staff.reduce((s, x) => s + staffWage(x.role, x.level), 0);
  }

  // ---------------------------------------------------------------- research
  startResearch(id: string, auto = false): ActionResult {
    const r = this.state.research;
    const def = RESEARCH_BY_ID[id];
    if (!def || r.done.includes(id)) return { ok: false, reason: 'Already researched' };
    if (this.state.chapter < def.chapter && !this.state.sandbox) return { ok: false, reason: `Available from Chapter ${def.chapter}` };
    if (def.req && def.req.some((q) => !r.done.includes(q))) return { ok: false, reason: 'Research the prerequisites first' };
    if (r.current) {
      if (!r.queue.includes(id) && r.current !== id) {
        if (!this.canAfford(def.cost)) return { ok: false, reason: 'Not enough money' };
        this.spend('research', def.cost);
        r.queue.push(id);
        return { ok: true, cost: def.cost };
      }
      return { ok: false, reason: 'Already queued' };
    }
    if (!auto) {
      if (!this.canAfford(def.cost)) return { ok: false, reason: 'Not enough money' };
      this.spend('research', def.cost);
    }
    r.current = id;
    r.progress = 0;
    return { ok: true, cost: def.cost };
  }

  applyResearchEffects(): void {
    this.course.extraBeauty = this.hasResearch('eco_cert') ? 1.2 : 1;
    this.course.championshipGreens = this.hasResearch('championship_greens');
    this.course.markDirty();
  }

  // ---------------------------------------------------------------- marketing
  launchCampaign(id: string): ActionResult {
    const d = MARKETING_BY_ID[id];
    if (!d) return { ok: false };
    if (this.state.chapter < d.chapter && !this.state.sandbox) return { ok: false, reason: `Available from Chapter ${d.chapter}` };
    if (this.state.marketing.some((m) => m.id === id)) return { ok: false, reason: 'Already running' };
    const social = this.hasResearch('social_media');
    const cost = Math.round(d.cost * (social ? 0.7 : 1));
    if (!this.canAfford(cost)) return { ok: false, reason: 'Not enough money' };
    this.spend('marketing', cost);
    this.state.marketing.push({ id, daysLeft: d.days + (social ? 2 : 0) });
    this.notify(`${d.name} campaign launched`, 'good');
    return { ok: true, cost };
  }

  // ---------------------------------------------------------------- range balls
  buyBalls(n: number): ActionResult {
    const cost = Math.round(n * 0.6);
    if (!this.canAfford(cost)) return { ok: false, reason: 'Not enough money' };
    this.spend('supplies', cost);
    this.state.ballsOwned += n;
    return { ok: true, cost };
  }

  // ---------------------------------------------------------------- tournaments
  tournamentEligibility(def: TournamentDef): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const w = this.world;
    if (def.research && !this.hasResearch(def.research)) reasons.push(`Research ${RESEARCH_BY_ID[def.research].name}`);
    if (this.course.validHoles().length < def.minHoles) reasons.push(`${def.minHoles} playable holes`);
    if (this.state.reputation < def.minRep) reasons.push(`${(def.minRep / 20).toFixed(1)}★ reputation`);
    if (this.course.averageRating() < def.minRating) reasons.push(`Average hole rating ${def.minRating}+`);
    const ch = w.objectsOfKind('clubhouse')[0];
    if (!ch || ch.level < def.clubhouseLevel) reasons.push(def.clubhouseLevel > 1 ? `Clubhouse level ${def.clubhouseLevel}` : 'A clubhouse');
    if (w.objectsOfKind('grandstand').length < def.grandstands) reasons.push(`${def.grandstands} grandstand${def.grandstands > 1 ? 's' : ''}`);
    if (def.hotel && !w.objectsOfKind('hotel').length) reasons.push('The Grand Hotel');
    return { ok: reasons.length === 0, reasons };
  }

  scheduleTournament(id: string): ActionResult {
    const def = TOURNAMENT_BY_ID[id];
    if (!def) return { ok: false };
    if (this.state.tournaments.scheduled) return { ok: false, reason: 'A tournament is already scheduled' };
    const el = this.tournamentEligibility(def);
    if (!el.ok) return { ok: false, reason: 'Requires: ' + el.reasons.join(', ') };
    const last = this.state.tournaments.history.filter((t) => t.id === id).pop();
    if (last && this.state.day - last.day < 8) return { ok: false, reason: `Can host again on day ${last.day + 8}` };
    if (!this.canAfford(def.purse)) return { ok: false, reason: `You need ${fmt(def.purse)} for the prize purse` };
    this.spend('tournament', def.purse);
    const day = this.state.day + (this.hour >= 8 ? 2 : 1);
    this.state.tournaments.scheduled = { id, day, playerEntered: false };
    this.notify(`${def.name} scheduled for day ${day}. The course will be closed to the public that day.`, 'good');
    return { ok: true, cost: def.purse };
  }

  /** Start, resume or resolve the scheduled tournament depending on the clock. Safe to call any time. */
  checkTournament(): void {
    const sch = this.state.tournaments.scheduled;
    if (!sch || this.tournament) return;
    const def = TOURNAMENT_BY_ID[sch.id];
    if (!def) {
      this.state.tournaments.scheduled = null;
      return;
    }
    const h = this.hour;
    if (sch.day < this.state.day || (sch.day === this.state.day && h >= 20)) {
      // the day has passed (e.g. loaded from a save): settle the event without visible play
      new TournamentRunner(this, def).finishOffline(!!sch.started);
      return;
    }
    if (sch.day === this.state.day && h >= 8) {
      this.tournament = new TournamentRunner(this, def);
      this.tournament.start(!!sch.started);
    }
  }

  endTournament(results: { name: string; score: number; toPar: number; you?: boolean }[], revenue: number, repGain: number): void {
    const sch = this.state.tournaments.scheduled;
    this.tournament = null;
    if (!sch) return;
    const def = TOURNAMENT_BY_ID[sch.id];
    const you = results.findIndex((r) => r.you);
    this.state.tournaments.history.push({ id: sch.id, day: this.state.day, winner: results[0]?.name ?? '-', score: results[0]?.toPar ?? 0, revenue, playerPos: you >= 0 ? you + 1 : undefined });
    this.state.tournaments.scheduled = null;
    this.tournament = null;
    this.reputationBoost(repGain);
    this.prestigeCache = this.prestige();
    this.events.emit('tournamentEnd', { id: def.id, results, revenue, repGain });
    this.notify(`${def.name} complete! ${results[0]?.name} wins at ${fmtPar(results[0]?.toPar ?? 0)}.`, 'goal');
  }

  // ---------------------------------------------------------------- player golfer
  addPlayerXp(xp: number): void {
    const pl = this.state.player;
    pl.xp += Math.round(xp);
    while (pl.xp >= xpForLevel(pl.level)) {
      pl.xp -= xpForLevel(pl.level);
      pl.level++;
      pl.points += 2;
      this.notify(`Your golfer reached level ${pl.level}! +2 skill points.`, 'goal');
      this.sound('levelup');
    }
  }

  // ---------------------------------------------------------------- goals
  checkGoals(): void {
    const st = this.state;
    if (st.sandbox) return;
    const ch = CHAPTERS[st.chapter - 1];
    if (!ch) return;
    let all = true;
    for (const g of ch.goals) {
      if (st.goalsDone.includes(g.id)) continue;
      const s = g.check(this);
      if (s.done) {
        st.goalsDone.push(g.id);
        this.events.emit('goal', { id: g.id, name: g.name });
        this.notify(`Goal complete: ${g.name}`, 'goal');
        this.sound('goal');
      } else all = false;
    }
    if (all) {
      this.earn('other', ch.reward);
      this.notify(`Chapter ${ch.num} complete: ${ch.title}! Reward ${fmt(ch.reward)}`, 'goal');
      if (st.chapter >= CHAPTERS.length) {
        if (!st.victory) {
          st.victory = true;
          this.events.emit('victory', undefined);
        }
        st.chapter = CHAPTERS.length + 1;
      } else {
        st.chapter++;
        this.events.emit('chapter', { num: st.chapter });
      }
      this.sound('levelup');
    }
  }

  // ---------------------------------------------------------------- utils
  notify(text: string, kind: NotifyKind = 'info', at?: { x: number; z: number }): void {
    this.events.emit('notify', { text, kind, x: at?.x, z: at?.z });
  }
  sound(name: string, at?: { x: number; z: number }): void {
    this.events.emit('sound', { name, x: at?.x, z: at?.z });
  }

  serialize(): GameState {
    this.state.holes = this.course.saves();
    const f = this.sim.field;
    const field: number[] = [];
    for (let i = 0; i < f.n; i++) field.push(Math.round(f.x[i] * 10), Math.round(f.z[i] * 10));
    this.state.rangeField = field;
    const s: GameState = JSON.parse(JSON.stringify({ ...this.state, world: null }));
    s.world = this.world.serialize();
    return s;
  }

  objectAt(x: number, y: number): PlacedObject | undefined {
    return this.world.objectAtTile(x, y);
  }

  ownedParcelsBounds(): { x0: number; y0: number; x1: number; y1: number } {
    let x0 = PARCELS, y0 = PARCELS, x1 = 0, y1 = 0;
    for (let py = 0; py < PARCELS; py++) for (let px = 0; px < PARCELS; px++) if (this.world.owned[py * PARCELS + px]) {
      x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
    }
    return { x0: x0 * PARCEL, y0: y0 * PARCEL, x1: (x1 + 1) * PARCEL - 1, y1: (y1 + 1) * PARCEL - 1 };
  }
}

export function dayProfit(d: DayRecord): number {
  const inc = Object.values(d.income).reduce((a, b) => a + (b ?? 0), 0);
  const exp = Object.values(d.expense).reduce((a, b) => a + (b ?? 0), 0);
  return inc - exp;
}

export function fmt(n: number): string {
  return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
}
export function fmtPar(n: number): string {
  return n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`;
}

export type { ItemDef };
