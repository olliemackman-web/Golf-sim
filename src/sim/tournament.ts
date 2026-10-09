// Running a tournament day: pro groups on the course, spectators, results.
import { TILE } from '../core/constants';
import type { TournamentDef } from '../data/events';
import { FIRST_NAMES, LAST_NAMES } from '../data/visitors';
import { Co, Group, Person, randomColors } from './agents';
import { playHole, walkTo } from './behaviors';
import { wait } from './co';
import type { Game } from './Game';

export interface LeaderRow {
  name: string;
  score: number;
  toPar: number;
  you?: boolean;
}

export class TournamentRunner {
  isPro = true;
  groups: Group[] = [];
  spectators: Person[] = [];
  revenue = 0;
  playerScore: { strokes: number; toPar: number } | null = null;
  done = false;
  private names: string[] = [];
  private finishedGroups = 0;
  private time = 0;

  constructor(private game: Game, public def: TournamentDef) {}

  /** Ticket and sponsorship income for the event. */
  private earnRevenue(): number {
    const g = this.game;
    const def = this.def;
    const tv = g.hasResearch('tv_broadcast') ? 1.75 : 1;
    const stands = g.world.objectsOfKind('grandstand').length;
    const capacity = 300 + stands * 400 + (g.world.objectsOfKind('hotel').length ? 500 : 0);
    const spectators = Math.round(Math.min(def.spectators * (0.6 + g.state.reputation / 160), Math.max(def.spectators * 0.4, capacity)));
    const tickets = spectators * def.ticket * tv;
    g.earn('tournament', def.sponsorship * tv);
    g.earn('tournament', tickets);
    this.revenue = def.sponsorship * tv + tickets;
    return spectators;
  }

  private makeNames(): void {
    const sim = this.game.sim;
    const used = new Set<string>();
    this.names = [];
    for (let i = 0; i < this.def.field; i++) {
      let n = '';
      do n = `${sim.rng.pick(FIRST_NAMES)} ${sim.rng.pick(LAST_NAMES)}`;
      while (used.has(n));
      used.add(n);
      this.names.push(n);
    }
  }

  /** Resolve the whole event without visible play (used after loading a save). */
  finishOffline(revenueAlreadyEarned: boolean): void {
    if (!revenueAlreadyEarned) this.earnRevenue();
    else this.revenue = this.def.sponsorship * (this.game.hasResearch('tv_broadcast') ? 1.75 : 1);
    this.makeNames();
    this.finish();
  }

  /** Begin the event. `resume` skips the income (already earned before a save/load). */
  start(resume = false): void {
    const g = this.game;
    const sim = g.sim;
    const def = this.def;
    const sch = g.state.tournaments.scheduled;
    if (!resume) {
      const spectators = this.earnRevenue();
      if (sch) sch.started = true;
      g.notify(`${def.name} begins! ${spectators.toLocaleString()} spectators have arrived.`, 'goal');
      g.sound('applause');
    } else this.revenue = def.sponsorship * (g.hasResearch('tv_broadcast') ? 1.75 : 1);
    this.makeNames();

    // visible pro groups
    const holes = g.course.validHoles().slice(0, 18).map((h) => h.save.id);
    const club = g.world.objectsOfKind('clubhouse')[0];
    const start = club ? sim.entrancePoint(club) : sim.entranceSpot();
    const nGroups = Math.min(8, Math.ceil(def.field / 3));
    for (let gi = 0; gi < nGroups; gi++) {
      const grp = new Group();
      grp.isTournament = true;
      grp.plan = { range: false, course: true, holes };
      for (let k = 0; k < 3; k++) {
        const p = sim.addPerson(randomColors(sim.rng), start.x + k, start.z);
        p.kind = 'tourpro';
        p.vtype = 'pro';
        p.name = this.names[gi * 3 + k] ?? 'Pro';
        p.skill = Math.min(1, def.strength + sim.rng.gauss() * 0.04);
        p.speed = 7.8;
        p.colors.hatType = 1;
        p.group = grp;
        p.visible = false;
        grp.members.push(p);
      }
      grp.co = this.proRound(grp, gi * 18);
      sim.groups.push(grp);
      this.groups.push(grp);
    }

    // spectators
    const nSpec = Math.min(110, 30 + Math.round(def.spectators / 60));
    const spots = this.spectatorSpots(nSpec);
    for (const s of spots) {
      const p = sim.addPerson(randomColors(sim.rng), s.x, s.z);
      p.kind = 'spectator';
      p.bag = false;
      p.heading = s.face;
      p.co = this.spectatorLife(p);
      this.spectators.push(p);
    }
  }

  private spectatorSpots(n: number): { x: number; z: number; face: number }[] {
    const g = this.game;
    const w = g.world;
    const r = g.sim.rng;
    const out: { x: number; z: number; face: number }[] = [];
    // grandstand seats
    for (const st of w.objectsOfKind('grandstand')) {
      for (let row = 0; row < 3; row++) for (let k = 0; k < 10 && out.length < n * 0.5; k++) {
        const lx = -10 + k * 2.2 + r.range(-0.3, 0.3);
        const lz = 1.5 - row * 2;
        const p = w.localToWorld(st, lx, lz);
        out.push({ x: p.x, z: p.z, face: Math.atan2(w.objectFront(st).x, w.objectFront(st).z) });
      }
    }
    // around the last greens
    const holes = g.course.validHoles();
    const finals = holes.slice(-4);
    let i = 0;
    while (out.length < n && finals.length) {
      const h = finals[i++ % finals.length];
      const a = r.range(0, Math.PI * 2);
      const d = r.range(13, 19);
      const x = h.pinWorld.x + Math.cos(a) * d, z = h.pinWorld.z + Math.sin(a) * d;
      if (!g.pf.passable(Math.floor(x / TILE), Math.floor(z / TILE), 'walk')) {
        if (i > n * 4) break;
        continue;
      }
      out.push({ x, z, face: Math.atan2(h.pinWorld.x - x, h.pinWorld.z - z) });
    }
    return out;
  }

  private *spectatorLife(p: Person): Co {
    const r = this.game.sim.rng;
    for (;;) {
      p.setAnim(r.chance(0.25) ? 'clap' : 'idle', 1);
      yield* wait(r.range(2, 6));
    }
  }

  private *proRound(g: Group, delay: number): Co {
    const sim = this.game.sim;
    yield* wait(delay);
    for (const m of g.members) m.visible = true;
    const players = g.members;
    for (const m of players) g.scores.set(m.id, []);
    for (const hid of g.plan.holes) {
      const hole = this.game.course.byId(hid);
      if (!hole || !hole.valid) continue;
      yield* playHole(sim, g, hole, players, new Map());
      if (this.done) return;
    }
    const club = this.game.world.objectsOfKind('clubhouse')[0];
    if (club) {
      const e = sim.entrancePoint(club);
      for (const m of players) m.activity = 'Signing the scorecard';
      yield* (function* () {
        for (const m of players) sim.walkTo(m, e.x, e.z);
        let t = 0;
        while (players.some((m) => m.moving) && t < 60) t += yield;
      })();
    }
    this.finishedGroups++;
    for (const m of players) m.visible = false;
    void walkTo;
  }

  submitPlayer(strokes: number, toPar: number): void {
    this.playerScore = { strokes, toPar };
  }

  update(dt: number): void {
    if (this.done) return;
    this.time += dt;
    if (this.finishedGroups >= this.groups.length || this.game.hour >= 20) this.finish();
  }

  finish(): void {
    if (this.done) return;
    this.done = true;
    const g = this.game;
    const holes = g.course.validHoles().slice(0, 18);
    const par = holes.reduce((s, h) => s + h.par, 0);
    const rows: LeaderRow[] = [];
    const visible = new Map<string, number>();
    for (const grp of this.groups) for (const m of grp.members) {
      const sc = grp.scores.get(m.id);
      if (sc && sc.length === holes.length) visible.set(m.name, sc.reduce((a, b) => a + b, 0));
    }
    for (let i = 0; i < this.names.length; i++) {
      const name = this.names[i];
      let strokes = visible.get(name);
      if (strokes === undefined) {
        const skill = Math.min(1, this.def.strength + g.sim.rng.gauss() * 0.045);
        strokes = 0;
        for (const h of holes) {
          const exp = -0.12 + h.difficulty * 0.55 + (0.9 - skill) * 1.7;
          strokes += Math.max(2, h.par + Math.round(exp + g.sim.rng.gauss() * 0.75));
        }
      }
      rows.push({ name, score: strokes, toPar: strokes - par });
    }
    if (this.playerScore) rows.push({ name: g.state.player.name + ' (You)', score: this.playerScore.strokes, toPar: this.playerScore.toPar, you: true });
    rows.sort((a, b) => a.score - b.score || (a.you ? -1 : 0));
    for (const grp of this.groups) if (!grp.removed) g.sim.disbandGroup(grp);
    for (const s of this.spectators) g.sim.removePerson(s);
    const avgCond = holes.reduce((s, h) => s + h.condition, 0) / Math.max(1, holes.length);
    const repGain = this.def.repGain * (0.6 + g.course.averageRating() / 120) * (0.7 + avgCond / 330);
    // player reward
    const you = rows.findIndex((r) => r.you);
    if (you === 0) {
      g.earn('other', Math.round(this.def.purse * 0.18));
      g.addPlayerXp(800);
      g.notify(`YOU WON the ${this.def.name}! Sponsors pay a winner's bonus.`, 'goal');
    } else if (you > 0 && you < 10) {
      g.earn('other', Math.round(this.def.purse * 0.04));
      g.addPlayerXp(300);
    }
    g.endTournament(rows, this.revenue, Math.round(repGain * 10) / 10);
  }
}
