// Management windows: finances, visitors, staff, research, marketing, prices, holes, tournaments, golfer, menu.
import { listen } from '../core/listeners';
import type { AppApi } from '../app';
import { EQUIPMENT, MAX_STAT, PLAYER_STAT_NAMES, PlayerStat, xpForLevel } from '../data/clubs';
import { MARKETING, TOURNAMENTS, TOURNAMENT_BY_ID } from '../data/events';
import { RESEARCH } from '../data/research';
import { STAFF_LIST, staffWage, trainCost } from '../data/staff';
import { VISITOR_TYPES } from '../data/visitors';
import { BAL, dayProfit, fmtPar } from '../sim/Game';
import { EXPENSE_NAMES, ExpenseKey, INCOME_NAMES, IncomeKey } from '../sim/state';
import { drawChart } from './charts';
import { bar, delegate, el, esc, money, starsHtml } from './dom';
import { icon } from './icons';
import type { UI } from './UI';

export type PanelId = 'finance' | 'visitors' | 'staff' | 'research' | 'marketing' | 'prices' | 'holes' | 'tournaments' | 'golfer' | 'menu' | 'tournamentResult' | 'settings' | 'help';

interface PanelCtx {
  app: AppApi;
  ui: UI;
  body: HTMLDivElement;
  tab: string;
  data?: unknown;
}

interface PanelDef {
  title: string;
  icon: string;
  tabs?: [string, string][];
  narrow?: boolean;
  live?: boolean;
  render: (c: PanelCtx) => string;
  after?: (c: PanelCtx) => void;
  act?: (c: PanelCtx, act: string, arg: string, t: HTMLElement) => void;
}

const sumObj = (o: Partial<Record<string, number>>) => Object.values(o).reduce((a: number, b) => a + (b ?? 0), 0);

const PANELS: Record<PanelId, PanelDef> = {
  // ------------------------------------------------------------------ finance
  finance: {
    title: 'Finances', icon: 'finance', live: true, tabs: [['overview', 'Overview'], ['bank', 'Bank']],
    render: ({ app, tab }) => {
      const g = app.game;
      const st = g.state;
      const today = st.stats.today;
      const yday = st.stats.history[st.stats.history.length - 1];
      if (tab === 'bank') {
        const room = g.maxLoan() - st.loan;
        return `<div class="kpis"><div class="kpi"><div class="k">Cash</div><div class="v">${money(st.money)}</div></div><div class="kpi"><div class="k">Loan</div><div class="v">${money(st.loan)}</div></div><div class="kpi"><div class="k">Credit available</div><div class="v">${money(room)}</div></div><div class="kpi"><div class="k">Daily interest</div><div class="v">${money(st.loan * BAL.loanRate)}</div></div></div>
          <p class="muted" style="line-height:1.5">The bank lends against the value of your club. Interest of ${(BAL.loanRate * 100).toFixed(1)}% is charged every night.</p>
          <div class="section-title">Borrow</div><div class="flex">${[10000, 25000, 50000, 100000, 250000].map((v) => `<button class="btn" data-act="borrow" data-arg="${v}" ${v > room ? 'disabled' : ''}>${money(v)}</button>`).join('')}</div>
          <div class="section-title">Repay</div><div class="flex">${[10000, 25000, 50000, 100000].map((v) => `<button class="btn" data-act="repay" data-arg="${v}" ${st.loan <= 0 ? 'disabled' : ''}>${money(v)}</button>`).join('')}<button class="btn" data-act="repay" data-arg="${st.loan}" ${st.loan <= 0 ? 'disabled' : ''}>Repay all</button></div>`;
      }
      const inc = sumObj(today.income), exp = sumObj(today.expense);
      const keysI = Object.keys(INCOME_NAMES) as IncomeKey[];
      const keysE = Object.keys(EXPENSE_NAMES) as ExpenseKey[];
      const row = (name: string, a: number | undefined, b: number | undefined, neg = false) => (a || b) ? `<tr><td>${name}</td><td class="r ${neg ? 'neg' : ''}">${a ? money(neg ? -a : a) : '—'}</td><td class="r ${neg ? 'neg' : ''}">${b ? money(neg ? -b : b) : '—'}</td></tr>` : '';
      return `<div class="kpis">
          <div class="kpi"><div class="k">Cash</div><div class="v">${money(st.money)}</div></div>
          <div class="kpi"><div class="k">Today's profit</div><div class="v ${inc - exp >= 0 ? 'pos' : 'neg'}">${money(inc - exp)}</div></div>
          <div class="kpi"><div class="k">Daily wages</div><div class="v">${money(g.dailyWages())}</div></div>
          <div class="kpi"><div class="k">Club value</div><div class="v">${money(g.clubValue())}</div></div>
        </div>
        <div class="label">Daily profit · last 30 days</div>
        <canvas class="chart" id="fin-chart"></canvas>
        <div class="grid2" style="margin-top:14px">
          <div class="tablewrap"><table class="t"><thead><tr><th>Income</th><th class="r">Today</th><th class="r">Yesterday</th></tr></thead><tbody>
            ${keysI.map((k) => row(INCOME_NAMES[k], today.income[k], yday?.income[k])).join('') || '<tr><td colspan="3" class="muted">No income yet today</td></tr>'}
            <tr class="hl"><td><b>Total</b></td><td class="r"><b>${money(inc)}</b></td><td class="r"><b>${yday ? money(sumObj(yday.income)) : '—'}</b></td></tr></tbody></table></div>
          <div class="tablewrap"><table class="t"><thead><tr><th>Expenses</th><th class="r">Today</th><th class="r">Yesterday</th></tr></thead><tbody>
            ${keysE.map((k) => row(EXPENSE_NAMES[k], today.expense[k], yday?.expense[k], true)).join('') || '<tr><td colspan="3" class="muted">Wages and upkeep are paid at midnight</td></tr>'}
            <tr class="hl"><td><b>Total</b></td><td class="r neg"><b>${money(-exp)}</b></td><td class="r neg"><b>${yday ? money(-sumObj(yday.expense)) : '—'}</b></td></tr></tbody></table></div>
        </div>`;
    },
    after: ({ app, body, tab }) => {
      if (tab !== 'overview') return;
      const c = body.querySelector('#fin-chart') as HTMLCanvasElement | null;
      if (!c) return;
      const h = app.game.state.stats.history.slice(-30);
      drawChart(c, h.map((d) => String(d.day)), [
        { kind: 'bar', color: '#6fcf74', label: 'Profit', values: h.map((d) => dayProfit(d)) },
        { kind: 'line', color: '#f0d48a', label: 'Income', values: h.map((d) => sumObj(d.income)) },
      ], (n) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n.toFixed(0)}`));
    },
    act: ({ app, ui }, act, arg) => {
      const g = app.game;
      if (act === 'borrow') {
        const r = g.takeLoan(+arg);
        if (!r.ok) ui.toast(r.reason ?? 'Refused', 'bad');
      } else if (act === 'repay') {
        const r = g.repayLoan(+arg);
        if (!r.ok) ui.toast(r.reason ?? 'Cannot repay', 'bad');
      }
    },
  },

  // ------------------------------------------------------------------ visitors
  visitors: {
    title: 'Visitors', icon: 'visitors', live: true, tabs: [['overview', 'Overview'], ['onsite', 'On site']],
    render: ({ app, tab }) => {
      const g = app.game;
      const st = g.state;
      const people = g.sim.people.filter((p) => p.kind === 'visitor' && !p.removed);
      if (tab === 'onsite') {
        return `<div class="tablewrap"><table class="t"><thead><tr><th>Name</th><th>Type</th><th>Doing</th><th class="r">Mood</th><th class="r">Spent</th></tr></thead><tbody>
          ${people.slice(0, 120).map((p) => `<tr data-act="person" data-arg="${p.id}" style="cursor:pointer"><td>${esc(p.name)}${p.member ? ' <span class="chip">Member</span>' : ''}</td><td>${VISITOR_TYPES[p.vtype].name}</td><td>${esc(p.activity)}</td><td class="r">${Math.round(p.happiness)}</td><td class="r">${money(p.spent)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nobody here right now</td></tr>'}
          </tbody></table></div>`;
      }
      const td = st.stats.today;
      const avgHappy = people.length ? people.reduce((s, p) => s + p.happiness, 0) / people.length : 0;
      const thoughts = Array.from(g.sim.thoughts.values()).sort((a, b) => b.count - a.count).slice(0, 14);
      const rates = g.arrivalRates();
      const slots = g.sim.totalSlots();
      return `<div class="kpis">
          <div class="kpi"><div class="k">Reputation</div><div class="v">${starsHtml(st.reputation)} <span style="font-size:14px">${(st.reputation / 20).toFixed(2)}</span></div></div>
          <div class="kpi"><div class="k">On site</div><div class="v">${people.length}</div></div>
          <div class="kpi"><div class="k">Visitors today</div><div class="v">${td.visitors}</div></div>
          <div class="kpi"><div class="k">Average mood</div><div class="v">${people.length ? Math.round(avgHappy) : '—'}</div></div>
          <div class="kpi"><div class="k">Members</div><div class="v">${Math.floor(st.members)}</div></div>
          <div class="kpi"><div class="k">Parking</div><div class="v">${slots.used}/${slots.total}</div></div>
        </div>
        <div class="grid2">
          <div class="tile"><h4>What visitors are saying today</h4>
            ${thoughts.length ? `<table class="t"><tbody>${thoughts.map((t) => `<tr><td style="width:44px" class="r ${t.good ? 'pos' : 'neg'}"><b>${t.count}</b></td><td>${esc(t.text)}</td></tr>`).join('')}</tbody></table>` : '<p>No feedback yet. Visitors share their thoughts as they leave.</p>'}
          </div>
          <div class="tile"><h4>Demand right now</h4>
            <p>Range visitors: <b>${(rates.range * 2.3).toFixed(1)}</b> per hour</p>
            <p>Golfers: <b>${(rates.course * 2.6).toFixed(1)}</b> per hour</p>
            <p>Club prestige: <b>${g.prestigeCache.toFixed(0)}</b> / 100 — facilities, holes and tournaments raise the reputation ceiling.</p>
            <p>Weather today: ${esc(g.weatherLabel())}. Tomorrow: ${esc(st.weather.tomorrow)}.</p>
            <p class="muted">Weekends are 30% busier. Summer is the high season; winter is quiet.</p>
          </div>
        </div>`;
    },
    act: ({ ui, app }, act, arg) => {
      if (act === 'person') {
        const p = app.game.sim.people.find((x) => x.id === +arg);
        if (p) {
          app.view.cam.setView(p.x, p.z, 60);
          ui.inspectPerson(p.id);
        }
      }
    },
  },

  // ------------------------------------------------------------------ staff
  staff: {
    title: 'Staff', icon: 'staff', live: true,
    render: ({ app }) => {
      const g = app.game;
      const st = g.state;
      return `<div class="grid3">${STAFF_LIST.map((r) => {
        const u = g.isUnlocked(r);
        const n = g.staffOfRole(r.id).length;
        return `<div class="tile ${u.ok ? '' : 'locked'}"><div class="flex between"><h4>${r.name}</h4><span class="chip">${n} hired</span></div><p>${esc(r.desc)}</p>
          <div class="tfoot"><span class="muted">${money(r.wage)}/day · hire ${money(r.hire)}</span><button class="btn small primary" data-act="hire" data-arg="${r.id}" ${u.ok ? '' : 'disabled'}>${u.ok ? 'Hire' : esc(u.reason ?? '')}</button></div></div>`;
      }).join('')}</div>
      <div class="section-title">Your team · ${st.staff.length} staff · ${money(g.dailyWages())}/day</div>
      <div class="tablewrap"><table class="t"><thead><tr><th>Name</th><th>Role</th><th>Doing</th><th class="r">Level</th><th class="r">Wage</th><th class="r"></th></tr></thead><tbody>
      ${st.staff.map((s) => {
        const p = g.staffPeople.get(s.id);
        return `<tr><td><a href="#" data-act="view" data-arg="${s.id}" style="color:inherit">${esc(s.name)}</a></td><td>${STAFF_LIST.find((r) => r.id === s.role)!.name}</td><td>${esc(p?.activity ?? '')}</td><td class="r">${'●'.repeat(s.level)}<span class="muted">${'●'.repeat(5 - s.level)}</span></td><td class="r">${money(staffWage(s.role, s.level))}</td>
          <td class="r"><div class="flex" style="justify-content:flex-end">${s.level < 5 ? `<button class="btn small" data-act="train" data-arg="${s.id}">Train ${money(trainCost(s.level))}</button>` : ''}<button class="btn small danger" data-act="fire" data-arg="${s.id}">Dismiss</button></div></td></tr>`;
      }).join('') || '<tr><td colspan="6" class="muted">No staff yet. Range Assistants keep your dispensers full; Greenkeepers keep the course healthy.</td></tr>'}
      </tbody></table></div>`;
    },
    act: ({ app, ui }, act, arg) => {
      const g = app.game;
      if (act === 'hire') {
        const r = g.hire(arg as never);
        if (!r.ok) ui.toast(r.reason ?? 'Cannot hire', 'bad');
      } else if (act === 'train') {
        const r = g.train(+arg);
        if (!r.ok) ui.toast(r.reason ?? 'Cannot train', 'bad');
      } else if (act === 'fire') g.fire(+arg);
      else if (act === 'view') {
        const p = g.staffPeople.get(+arg);
        if (p) {
          app.view.cam.setView(p.x, p.z, 50);
          ui.inspectPerson(p.id);
        }
      }
    },
  },

  // ------------------------------------------------------------------ research
  research: {
    title: 'Research & Upgrades', icon: 'research', live: true,
    render: ({ app }) => {
      const g = app.game;
      const r = g.state.research;
      const cur = r.current ? RESEARCH.find((x) => x.id === r.current) : null;
      return `${cur ? `<div class="tile active" style="margin-bottom:12px"><div class="flex between"><h4>Researching: ${esc(cur.name)}</h4><span class="muted num">${Math.floor(r.progress)} / ${cur.hours} hours</span></div>${bar(r.progress / cur.hours, 'brass')}${r.queue.length ? `<p class="muted">Queued next: ${r.queue.map((q) => esc(RESEARCH.find((x) => x.id === q)?.name ?? q)).join(', ')}</p>` : ''}</div>` : '<p class="muted" style="margin-top:0">Pick a project. Research costs money up front and takes in-game hours to complete. You can queue several.</p>'}
        <div class="grid3">${RESEARCH.map((d) => {
          const done = r.done.includes(d.id);
          const active = r.current === d.id || r.queue.includes(d.id);
          const chapterOk = g.state.chapter >= d.chapter || g.state.sandbox;
          const reqOk = !d.req || d.req.every((q) => r.done.includes(q));
          const avail = !done && !active && chapterOk && reqOk;
          return `<div class="tile ${done ? 'done' : active ? 'active' : avail ? '' : 'locked'}"><div class="flex between"><h4>${esc(d.name)}</h4>${done ? '<span class="chip good">Done</span>' : active ? '<span class="chip warn">In progress</span>' : ''}</div><p>${esc(d.desc)}</p>
            ${d.req ? `<p class="muted" style="font-size:11.5px">Requires ${d.req.map((q) => esc(RESEARCH.find((x) => x.id === q)?.name ?? q)).join(', ')}</p>` : ''}
            <div class="tfoot"><span class="muted">${d.hours} hours</span>${done ? '' : `<button class="btn small ${avail ? 'primary' : ''}" data-act="start" data-arg="${d.id}" ${avail ? '' : 'disabled'}>${!chapterOk ? `Chapter ${d.chapter}` : active ? 'Queued' : money(d.cost)}</button>`}</div></div>`;
        }).join('')}</div>`;
    },
    act: ({ app, ui }, act, arg) => {
      if (act === 'start') {
        const r = app.game.startResearch(arg);
        if (!r.ok) ui.toast(r.reason ?? 'Cannot start', 'bad');
        else ui.toast('Research started', 'good');
      }
    },
  },

  // ------------------------------------------------------------------ marketing
  marketing: {
    title: 'Marketing', icon: 'marketing', live: true,
    render: ({ app }) => {
      const g = app.game;
      const social = g.hasResearch('social_media');
      return `<p class="muted" style="margin-top:0">Campaigns bring extra visitors while they run. Targeted campaigns attract more of particular visitor types.</p>
        <div class="grid3">${MARKETING.map((m) => {
          const run = g.state.marketing.find((x) => x.id === m.id);
          const locked = g.state.chapter < m.chapter && !g.state.sandbox;
          const cost = Math.round(m.cost * (social ? 0.7 : 1));
          return `<div class="tile ${run ? 'active' : locked ? 'locked' : ''}"><div class="flex between"><h4>${esc(m.name)}</h4>${run ? `<span class="chip warn">${run.daysLeft} days left</span>` : ''}</div><p>${esc(m.desc)}</p>
            <p class="muted" style="font-size:11.5px">+${Math.round(m.boost * 100)}% visitors for ${m.days + (social ? 2 : 0)} days${m.targets ? ' · targets ' + m.targets.map((t) => VISITOR_TYPES[t as keyof typeof VISITOR_TYPES]?.name ?? t).join(', ') : ''}</p>
            <div class="tfoot"><span></span><button class="btn small primary" data-act="launch" data-arg="${m.id}" ${run || locked ? 'disabled' : ''}>${locked ? `Chapter ${m.chapter}` : run ? 'Running' : 'Launch ' + money(cost)}</button></div></div>`;
        }).join('')}</div>`;
    },
    act: ({ app, ui }, act, arg) => {
      if (act === 'launch') {
        const r = app.game.launchCampaign(arg);
        if (!r.ok) ui.toast(r.reason ?? 'Cannot launch', 'bad');
      }
    },
  },

  // ------------------------------------------------------------------ prices
  prices: {
    title: 'Prices & Supplies', icon: 'prices',
    render: ({ app }) => {
      const g = app.game;
      const p = g.state.prices;
      const lines: [keyof typeof p, string, number, number, number, number, string][] = [
        ['bucket', 'Range bucket (50 balls)', 2, 40, 0.5, g.fairBucketPrice(1), 'Covered bays ×1.3, Tracker bays ×2.1'],
        ['green9', 'Green fee (per 9 holes)', 5, 250, 1, g.fairGreenFee(9), 'Fewer than 9 holes are charged per hole'],
        ['cart', 'Golf cart hire', 5, 80, 1, g.fairCartPrice(), 'Needs a Cart Barn'],
        ['lesson', 'Golf lesson', 10, 250, 5, g.fairLessonPrice(), 'Needs an Academy and Golf Pros'],
        ['membership', 'Membership (per 10 days)', 50, 3000, 10, BAL.fairMembership + g.state.reputation * 2.5, 'Needs the Membership Scheme'],
        ['hotel', 'Hotel room (per night)', 50, 900, 10, BAL.fairHotel + g.state.reputation * 1.5, 'Needs the Grand Hotel'],
      ];
      const avail = Math.max(0, g.sim.ballsAvailable());
      return `${lines.map(([k, name, min, max, step, fair, hint]) => {
        const v = p[k];
        const ratio = v / fair;
        const verdict = ratio < 0.75 ? '<span class="chip good">Bargain</span>' : ratio < 1.1 ? '<span class="chip">Fair</span>' : ratio < 1.35 ? '<span class="chip warn">Pricey</span>' : '<span class="chip bad">Too high</span>';
        return `<div class="pricerow"><div><b>${name}</b><div class="hint">${hint} · visitors expect about ${money(fair)}</div></div>
          <input type="range" id="price-${k}" min="${min}" max="${max}" step="${step}" value="${v}" data-price="${k}"><div class="pv"><span data-pv="${k}">${money(v, step < 1)}</span><div>${verdict}</div></div></div>`;
      }).join('')}
      ${(['food', 'shop'] as const).map((k) => `<div class="pricerow"><div><b>${k === 'food' ? 'Food & drink prices' : 'Pro shop prices'}</b><div class="hint">Price level compared to normal. Higher earns more per sale but puts people off.</div></div>
        <input type="range" id="price-${k}" min="0.5" max="2.5" step="0.05" value="${p[k]}" data-price="${k}"><div class="pv"><span data-pv="${k}">${Math.round(p[k] * 100)}%</span></div></div>`).join('')}
      <div class="section-title">Range balls</div>
      <div class="flex between"><p style="margin:0">You own <b>${g.state.ballsOwned.toLocaleString()}</b> balls · <b>${avail.toLocaleString()}</b> in the dispensers · <b>${(g.sim.field.n * 5).toLocaleString()}</b> lying on the range · ${g.lostBallsToday} lost today</p>
      <div class="flex"><button class="btn" data-act="balls" data-arg="500">Buy 500 · $300</button><button class="btn" data-act="balls" data-arg="2000">Buy 2,000 · $1,200</button></div></div>`;
    },
    after: ({ app, body }) => {
      for (const inp of Array.from(body.querySelectorAll('input[data-price]')) as HTMLInputElement[]) {
        inp.addEventListener('input', () => {
          const k = inp.dataset.price as keyof typeof app.game.state.prices;
          const v = +inp.value;
          app.game.state.prices[k] = v;
          const lab = body.querySelector(`[data-pv="${k}"]`);
          if (lab) lab.textContent = k === 'food' || k === 'shop' ? `${Math.round(v * 100)}%` : money(v, +inp.step < 1);
        });
        inp.addEventListener('change', () => app.sfx('click'));
      }
    },
    act: ({ app, ui }, act, arg) => {
      if (act === 'balls') {
        const r = app.game.buyBalls(+arg);
        if (!r.ok) ui.toast(r.reason ?? 'Cannot buy', 'bad');
        else ui.toast(`Bought ${(+arg).toLocaleString()} range balls`, 'good');
      }
    },
  },

  // ------------------------------------------------------------------ holes
  holes: {
    title: 'Course & Holes', icon: 'hole', live: true,
    render: ({ app }) => {
      const g = app.game;
      const c = g.course;
      const valid = c.validHoles();
      return `<div class="kpis">
          <div class="kpi"><div class="k">Playable holes</div><div class="v">${valid.length} / ${c.holes.length}</div></div>
          <div class="kpi"><div class="k">Course par</div><div class="v">${c.totalPar() || '—'}</div></div>
          <div class="kpi"><div class="k">Average rating</div><div class="v">${valid.length ? c.averageRating().toFixed(0) : '—'}</div></div>
          <div class="kpi"><div class="k">Difficulty</div><div class="v" style="font-size:16px">${valid.length ? ['Easy', 'Moderate', 'Challenging', 'Hard', 'Brutal'][Math.min(4, Math.floor(c.averageDifficulty() * 5))] : '—'}</div></div>
        </div>
        ${c.holes.length ? '' : `<div class="tile"><h4>How to build a hole</h4><p>1. Open <b>Course</b> in the dock and paint a small <b>Tee Box</b>.<br>2. Paint a <b>Fairway</b> leading away from it, and a <b>Green</b> at the end.<br>3. Choose <b>New Hole</b>, click the tee box, then click the green.<br>Add bunkers, water and trees for a better rating. Par is set by length: up to 250 yards is a par 3, up to 470 a par 4.</p></div>`}
        <div class="tablewrap"><table class="t"><thead><tr><th>#</th><th>Par</th><th class="r">Yards</th><th class="r">Rating</th><th class="r">Turf</th><th>Status</th><th class="r"></th></tr></thead><tbody>
        ${c.holes.map((h) => `<tr><td><b>${h.num}</b></td><td>${h.valid ? h.par : '—'}</td><td class="r">${h.yards}</td><td class="r">${h.valid ? h.rating.toFixed(0) : '—'}</td><td class="r">${h.valid ? h.condition.toFixed(0) + '%' : '—'}</td>
          <td>${h.valid ? (h.issues.length ? `<span class="chip warn" title="${esc(h.issues.join('\n'))}">${esc(h.issues[0])}</span>` : '<span class="chip good">Great</span>') : `<span class="chip bad">${esc(h.issues[0] ?? 'Invalid')}</span>`}</td>
          <td class="r"><div class="flex" style="justify-content:flex-end">
            <button class="btn small" data-act="view" data-arg="${h.save.id}">${icon('eye')}</button>
            <button class="btn small" data-act="up" data-arg="${h.save.id}" title="Move earlier">▲</button>
            <button class="btn small" data-act="down" data-arg="${h.save.id}" title="Move later">▼</button>
            ${h.valid ? `<button class="btn small primary" data-act="play" data-arg="${h.save.id}">Play</button>` : ''}
          </div></td></tr>`).join('')}
        </tbody></table></div>
        ${valid.length >= 2 ? `<div class="flex" style="margin-top:12px"><button class="btn primary" data-act="playall">${icon('golfer')} Play a full round (${valid.length} holes)</button></div>` : ''}`;
    },
    act: ({ app, ui }, act, arg) => {
      const g = app.game;
      const h = g.course.byId(+arg);
      if (act === 'view' && h) {
        const mid = g.course.pointAt(h, h.length / 2);
        app.view.cam.setView(mid.x, mid.z, Math.max(80, h.length * 1.1));
        ui.inspectHole(h.save.id);
      } else if (act === 'up' || act === 'down') {
        g.course.moveHole(+arg, act === 'up' ? -1 : 1);
        g.state.holes = g.course.saves();
      } else if (act === 'play' && h) app.startPlay({ mode: 'course', holes: [h.save.id] });
      else if (act === 'playall') app.startPlay({ mode: 'course', holes: g.course.validHoles().map((x) => x.save.id) });
    },
  },

  // ------------------------------------------------------------------ tournaments
  tournaments: {
    title: 'Tournaments', icon: 'trophy', live: true,
    render: ({ app }) => {
      const g = app.game;
      const sch = g.state.tournaments.scheduled;
      const hist = g.state.tournaments.history.slice().reverse();
      const schDef = sch ? TOURNAMENT_BY_ID[sch.id] : null;
      return `${schDef ? `<div class="tile active" style="margin-bottom:12px"><div class="flex between"><h4>${esc(schDef.name)} · day ${sch!.day}</h4>${g.tournament ? '<span class="chip warn">In progress</span>' : '<span class="chip">Scheduled</span>'}</div>
          <p>The course is closed to the public on tournament day. Tickets and sponsorship are paid when the event starts.</p>
          <div class="tfoot"><span class="muted">${g.tournament?.playerScore ? `Your round: ${g.tournament.playerScore.strokes} (${fmtPar(g.tournament.playerScore.toPar)})` : 'You can enter and play your own round on the day.'}</span>
          ${g.tournament && !g.tournament.playerScore ? `<button class="btn small primary" data-act="enter">${icon('golfer')} Play your round</button>` : ''}</div></div>` : ''}
        <div class="grid2">${TOURNAMENTS.map((t) => {
          const el = g.tournamentEligibility(t);
          const tv = g.hasResearch('tv_broadcast') ? 1.75 : 1;
          return `<div class="tile ${el.ok ? '' : 'locked'}"><div class="flex between"><h4>${esc(t.name)}</h4>${g.state.tournaments.history.some((h) => h.id === t.id) ? '<span class="chip good">Hosted</span>' : ''}</div><p>${esc(t.desc)}</p>
            <p style="font-size:12px">Prize purse <b>${money(t.purse)}</b> · Sponsorship <b>${money(t.sponsorship * tv)}</b> · Up to ${t.spectators.toLocaleString()} spectators at ${money(t.ticket)} · +${t.repGain} reputation</p>
            ${el.ok ? '' : `<p class="muted" style="font-size:11.5px">Requires: ${el.reasons.map(esc).join(' · ')}</p>`}
            <div class="tfoot"><span class="muted">${t.field} players</span><button class="btn small primary" data-act="schedule" data-arg="${t.id}" ${el.ok && !sch ? '' : 'disabled'}>Schedule · ${money(t.purse)}</button></div></div>`;
        }).join('')}</div>
        ${hist.length ? `<div class="section-title">History</div><div class="tablewrap"><table class="t"><thead><tr><th>Day</th><th>Event</th><th>Winner</th><th class="r">Score</th><th class="r">Income</th><th class="r">You</th></tr></thead><tbody>${hist.map((h) => `<tr><td>${h.day}</td><td>${esc(TOURNAMENT_BY_ID[h.id]?.name ?? h.id)}</td><td>${esc(h.winner)}</td><td class="r">${fmtPar(h.score)}</td><td class="r">${money(h.revenue)}</td><td class="r">${h.playerPos ? '#' + h.playerPos : '—'}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
    },
    act: ({ app, ui }, act, arg) => {
      const g = app.game;
      if (act === 'schedule') {
        const r = g.scheduleTournament(arg);
        if (!r.ok) ui.toast(r.reason ?? 'Cannot schedule', 'bad');
      } else if (act === 'enter') {
        app.startPlay({ mode: 'course', holes: g.course.validHoles().slice(0, 18).map((h) => h.save.id), tournament: true });
      }
    },
  },

  // ------------------------------------------------------------------ tournament result
  tournamentResult: {
    title: 'Tournament Result', icon: 'trophy', narrow: true,
    render: ({ data }) => {
      const t = data as { id: string; results: { name: string; score: number; toPar: number; you?: boolean }[]; revenue: number; repGain: number };
      const def = TOURNAMENT_BY_ID[t.id];
      const you = t.results.findIndex((r) => r.you);
      return `<h3 class="serif" style="font-size:28px;margin:0 0 4px">${esc(def.name)}</h3>
        <p class="muted" style="margin:0 0 12px">Champion: <b style="color:var(--brass-2)">${esc(t.results[0]?.name ?? '-')}</b> at ${fmtPar(t.results[0]?.toPar ?? 0)} · Income ${money(t.revenue)} · Reputation +${t.repGain}</p>
        ${you >= 0 ? `<div class="tile active" style="margin-bottom:10px"><b>You finished ${ordinal(you + 1)}</b> of ${t.results.length} with ${t.results[you].score} (${fmtPar(t.results[you].toPar)})</div>` : ''}
        <div class="tablewrap"><table class="t"><thead><tr><th>Pos</th><th>Player</th><th class="r">Score</th><th class="r">To par</th></tr></thead><tbody>
        ${t.results.slice(0, 12).map((r, i) => `<tr class="${r.you ? 'hl' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td class="r">${r.score}</td><td class="r">${fmtPar(r.toPar)}</td></tr>`).join('')}
        ${you >= 12 ? `<tr class="hl"><td>${you + 1}</td><td>${esc(t.results[you].name)}</td><td class="r">${t.results[you].score}</td><td class="r">${fmtPar(t.results[you].toPar)}</td></tr>` : ''}
        </tbody></table></div>`;
    },
  },

  // ------------------------------------------------------------------ golfer
  golfer: {
    title: 'Have a Go', icon: 'golfer', live: true, tabs: [['play', 'Play'], ['profile', 'Your golfer'], ['clubs', 'Equipment']],
    render: ({ app, tab }) => {
      const g = app.game;
      const pl = g.state.player;
      const bays = g.world.objectsOfKind('bay');
      const holes = g.course.validHoles();
      if (tab === 'profile') {
        const need = xpForLevel(pl.level);
        return `<div class="kpis"><div class="kpi"><div class="k">Golfer level</div><div class="v">${pl.level}</div>${bar(pl.xp / need, 'brass')}<div class="muted" style="font-size:11px;margin-top:4px">${pl.xp} / ${need} XP</div></div>
          <div class="kpi"><div class="k">Skill points</div><div class="v">${pl.points}</div></div>
          <div class="kpi"><div class="k">Longest drive</div><div class="v">${pl.longestDrive} yds</div></div>
          <div class="kpi"><div class="k">Holes played</div><div class="v">${pl.holesPlayed}</div></div></div>
          <div class="grid2">${(Object.keys(PLAYER_STAT_NAMES) as PlayerStat[]).map((s) => `<div class="tile"><div class="flex between"><h4>${PLAYER_STAT_NAMES[s]}</h4><span class="num">${pl.stats[s]} / ${MAX_STAT}</span></div>${bar(pl.stats[s] / MAX_STAT)}
            <p>${s === 'power' ? 'Ball speed and distance.' : s === 'accuracy' ? 'A bigger sweet spot on the swing meter.' : s === 'short' ? 'Precision on chips, pitches and bunker shots.' : 'Truer roll and a calmer stroke on the greens.'}</p>
            <div class="tfoot"><span></span><button class="btn small primary" data-act="stat" data-arg="${s}" ${pl.points > 0 && pl.stats[s] < MAX_STAT ? '' : 'disabled'}>+1 point</button></div></div>`).join('')}</div>
          <div class="section-title">Records</div>
          <table class="t"><tbody>
            <tr><td>Birdies / Eagles / Holes-in-one</td><td class="r">${pl.birdies} / ${pl.eagles} / ${pl.holeInOnes}</td></tr>
            <tr><td>Pars or better</td><td class="r">${pl.parsOrBetter}</td></tr>
            <tr><td>Best round</td><td class="r">${pl.bestRound ? `${pl.bestRound.strokes} over ${pl.bestRound.holes} holes (${fmtPar(pl.bestRound.toPar)})` : '—'}</td></tr>
            <tr><td>Long drive best</td><td class="r">${pl.challenges.longdrive ?? 0} yds</td></tr>
            <tr><td>Target challenge best</td><td class="r">${pl.challenges.target ?? 0} pts</td></tr>
            <tr><td>Closest to the pin best</td><td class="r">${pl.challenges.closest ? pl.challenges.closest.toFixed(1) + ' ft' : '—'}</td></tr>
            <tr><td>Range balls hit</td><td class="r">${pl.rangeBalls}</td></tr>
          </tbody></table>`;
      }
      if (tab === 'clubs') {
        const shop = g.world.objectsOfType('pro_shop').length > 0;
        return `<p class="muted" style="margin-top:0">Better clubs hit the ball further and straighter. Clubs are sold in your Pro Shop${shop ? '' : ' — build one to unlock upgrades'}.</p>
          <div class="grid2">${EQUIPMENT.map((e) => {
            const owned = pl.owned.includes(e.id);
            const using = pl.equipment === e.id;
            return `<div class="tile ${using ? 'active' : ''}"><div class="flex between"><h4>${esc(e.name)}</h4>${using ? '<span class="chip good">In your bag</span>' : owned ? '<span class="chip">Owned</span>' : ''}</div><p>${esc(e.desc)}</p>
              <p style="font-size:12px">Distance ${Math.round(e.distance * 100)}% · Forgiveness ${Math.round(e.forgiveness * 100)}%</p>
              <div class="tfoot"><span></span>${using ? '' : owned ? `<button class="btn small" data-act="equip" data-arg="${e.id}">Use</button>` : `<button class="btn small primary" data-act="buyclubs" data-arg="${e.id}" ${(!shop && e.needsShop) ? 'disabled' : ''}>${!shop && e.needsShop ? 'Needs Pro Shop' : 'Buy ' + money(e.cost)}</button>`}</div></div>`;
          }).join('')}</div>`;
      }
      const tour = g.tournament && !g.tournament.playerScore;
      return `<p class="muted" style="margin-top:0;line-height:1.5">Step up and play yourself. Practise on your range, take on challenges for prize money, or play your own course. Every shot earns XP for your golfer.</p>
        ${tour ? `<div class="tile active" style="margin-bottom:12px"><div class="flex between"><h4>${esc(g.tournament!.def.name)} is on today!</h4><button class="btn primary" data-act="tournament">${icon('trophy')} Play your tournament round</button></div></div>` : ''}
        <div class="section-title">Driving range</div>
        ${bays.length ? '' : '<p class="muted">Build a range bay to practise on your own range. Until then you can use the club practice tee.</p>'}
        <div class="grid3">
          <div class="tile"><h4>Free practice</h4><p>Hit as many balls as you like with any club. See carry, total distance and ball data.</p><div class="tfoot"><span></span><button class="btn small primary" data-act="range" data-arg="free">Practise</button></div></div>
          <div class="tile"><h4>Long drive</h4><p>Five drives. Your longest one in the fairway counts. Prize money for 250, 280, 300 and 330 yards.</p><div class="tfoot"><span class="muted">Best ${pl.challenges.longdrive ?? 0} yds</span><button class="btn small primary" data-act="range" data-arg="longdrive">Play</button></div></div>
          <div class="tile"><h4>Target challenge</h4><p>Ten balls at targets of different distances. Score points for landing close.</p><div class="tfoot"><span class="muted">Best ${pl.challenges.target ?? 0} pts</span><button class="btn small primary" data-act="range" data-arg="target">Play</button></div></div>
          <div class="tile"><h4>Closest to the pin</h4><p>Five shots at a flag. Get within 10 feet to win prize money.</p><div class="tfoot"><span class="muted">Best ${pl.challenges.closest ? pl.challenges.closest.toFixed(1) + ' ft' : '—'}</span><button class="btn small primary" data-act="range" data-arg="closest">Play</button></div></div>
        </div>
        <div class="section-title">Your course</div>
        ${holes.length ? `<div class="flex">${holes.map((h) => `<button class="btn" data-act="hole" data-arg="${h.save.id}"><b>${h.num}</b> <span class="muted">Par ${h.par} · ${h.yards}y</span></button>`).join('')}</div>
          ${holes.length >= 2 ? `<div class="flex" style="margin-top:10px"><button class="btn primary" data-act="round" data-arg="all">${icon('flag')} Full round · ${holes.length} holes</button>${holes.length >= 18 ? '<button class="btn" data-act="round" data-arg="front">Front nine</button><button class="btn" data-act="round" data-arg="back">Back nine</button>' : ''}</div>` : ''}` : '<p class="muted">Build a hole to play it yourself.</p>'}`;
    },
    act: ({ app, ui }, act, arg) => {
      const g = app.game;
      const pl = g.state.player;
      if (act === 'range') app.startPlay({ mode: 'range', challenge: arg as 'free' });
      else if (act === 'hole') app.startPlay({ mode: 'course', holes: [+arg] });
      else if (act === 'round') {
        const ids = g.course.validHoles().map((h) => h.save.id);
        app.startPlay({ mode: 'course', holes: arg === 'front' ? ids.slice(0, 9) : arg === 'back' ? ids.slice(9, 18) : ids.slice(0, 18) });
      } else if (act === 'tournament') app.startPlay({ mode: 'course', holes: g.course.validHoles().slice(0, 18).map((h) => h.save.id), tournament: true });
      else if (act === 'stat') {
        const s = arg as PlayerStat;
        if (pl.points > 0 && pl.stats[s] < MAX_STAT) {
          pl.points--;
          pl.stats[s]++;
          app.sfx('levelup', { volume: 0.5 });
        }
      } else if (act === 'equip') pl.equipment = arg;
      else if (act === 'buyclubs') {
        const e = EQUIPMENT.find((x) => x.id === arg)!;
        if (!g.canAfford(e.cost)) {
          ui.toast('Not enough money', 'bad');
          return;
        }
        g.spend('supplies', e.cost);
        pl.owned.push(e.id);
        pl.equipment = e.id;
        ui.toast(`${e.name} added to your bag`, 'good');
      }
    },
  },

  // ------------------------------------------------------------------ menu
  menu: {
    title: 'Menu', icon: 'menu', narrow: true,
    render: ({ app }) => {
      return `<div style="display:grid;gap:8px">
        <button class="btn" data-act="resume">${icon('play')} Resume</button>
        <button class="btn" data-act="save" data-arg="slot1">${icon('save')} Save game</button>
        <button class="btn" data-act="settings">${icon('settings')} Settings</button>
        <button class="btn" data-act="help">${icon('info')} How to play</button>
        <button class="btn danger" data-act="quit">${icon('home')} Save and quit to title</button>
        <p class="muted" style="font-size:12px;margin:6px 0 0">${app.settings.autosave ? 'The game autosaves every night.' : 'Autosave is off.'}</p></div>`;
    },
    act: ({ app, ui }, act) => {
      if (act === 'save') {
        const ok = app.saveGame('slot1');
        ui.toast(ok ? 'Game saved' : 'Could not save — browser storage is unavailable', ok ? 'good' : 'bad');
      } else if (act === 'settings') ui.openPanel('settings');
      else if (act === 'help') ui.openPanel('help');
      else if (act === 'quit') {
        app.saveGame('slot1');
        app.quitToMenu();
      }
    },
  },

  settings: {
    title: 'Settings', icon: 'settings', narrow: true,
    render: ({ app }) => {
      const s = app.settings;
      const vol = (k: 'master' | 'sfx' | 'ambience' | 'music', n: string) => `<div class="field"><label class="label" for="set-${k}">${n}</label><input type="range" id="set-${k}" min="0" max="1" step="0.05" value="${s[k]}" data-set="${k}"></div>`;
      return `<div class="field"><span class="label">Graphics quality</span><div class="seg">${(['low', 'medium', 'high'] as const).map((q) => `<button class="${s.quality === q ? 'on' : ''}" data-act="quality" data-arg="${q}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}</div>
        <span class="muted" style="font-size:11.5px">High adds multisample anti-aliasing and sharper shadows. Use Low on older laptops.</span></div>
        ${vol('master', 'Master volume')}${vol('sfx', 'Sound effects')}${vol('ambience', 'Ambience')}${vol('music', 'Music')}
        <div class="flex" style="margin-top:6px"><button class="btn small" data-act="toggle" data-arg="musicOn">${s.musicOn ? 'Music on' : 'Music off'}</button><button class="btn small" data-act="toggle" data-arg="autosave">${s.autosave ? 'Autosave on' : 'Autosave off'}</button></div>`;
    },
    after: ({ app, body }) => {
      for (const inp of Array.from(body.querySelectorAll('input[data-set]')) as HTMLInputElement[]) {
        inp.addEventListener('input', () => {
          (app.settings as unknown as Record<string, number>)[inp.dataset.set!] = +inp.value;
          app.applySettings();
        });
      }
    },
    act: ({ app }, act, arg) => {
      if (act === 'quality') app.settings.quality = arg as 'low';
      else if (act === 'toggle') (app.settings as unknown as Record<string, boolean>)[arg] = !(app.settings as unknown as Record<string, boolean>)[arg];
      app.applySettings();
    },
  },

  help: {
    title: 'How to Play', icon: 'info',
    render: () => `<div class="grid2">
      <div class="tile"><h4>Camera</h4><p><span class="kbd">W A S D</span> or arrow keys to move · <span class="kbd">Q</span> <span class="kbd">E</span> to rotate · mouse wheel to zoom · right-drag to orbit · drag the map to pan. Click the minimap to jump.</p></div>
      <div class="tile"><h4>Time</h4><p><span class="kbd">Space</span> pauses · <span class="kbd">1</span>–<span class="kbd">4</span> set the speed. Each night wages and upkeep are paid and the game autosaves.</p></div>
      <div class="tile"><h4>The range</h4><p>Build bays facing open land you own, plus a Ball Dispenser. Range Assistants collect balls from the field and refill the dispensers. Balls that land off your land are lost.</p></div>
      <div class="tile"><h4>Holes</h4><p>Paint a Tee Box, Fairway and Green, then use New Hole: click the tee, then the green. Bunkers, water and trees improve ratings. Greenkeepers repair worn turf.</p></div>
      <div class="tile"><h4>Happy visitors</h4><p>Fair prices, short queues, toilets, food, scenery and well-kept turf make visitors happy. Happy visitors raise your reputation, which brings more and wealthier visitors.</p></div>
      <div class="tile"><h4>Progress</h4><p>Complete chapter goals to unlock new buildings and earn rewards. Research upgrades, buy more land, host tournaments and grow into a legendary resort.</p></div>
      <div class="tile"><h4>Have a Go</h4><p>Click to start the swing meter, click again to set power, and once more as the marker returns to the line to set accuracy. Aim with <span class="kbd">A</span>/<span class="kbd">D</span> or by dragging, change club with the mouse wheel or <span class="kbd">Q</span>/<span class="kbd">E</span>.</p></div>
      <div class="tile"><h4>Shortcuts</h4><p><span class="kbd">C</span> course · <span class="kbd">B</span> buildings · <span class="kbd">X</span> remove · <span class="kbd">H</span> holes · <span class="kbd">F</span> finances · <span class="kbd">R</span> rotate · <span class="kbd">[</span> <span class="kbd">]</span> brush size · <span class="kbd">Esc</span> cancel</p></div>
    </div>`,
  },
};

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function openPanel(app: AppApi, ui: UI, id: PanelId, data?: unknown): { id: PanelId; refresh: () => void; close: () => void } {
  const def = PANELS[id];
  const back = el('div', 'modal-back');
  const win = el('div', 'window' + (def.narrow ? ' narrow' : ''));
  back.appendChild(win);
  const ctx: PanelCtx = { app, ui, body: el('div', 'wbody'), tab: def.tabs?.[0][0] ?? '', data };
  win.innerHTML = `<div class="whead"><div class="wic">${icon(def.icon)}</div><h2>${def.title}</h2><button class="close" data-act="close" title="Close (Esc)">${icon('close')}</button></div>`;
  let tabs: HTMLDivElement | null = null;
  if (def.tabs) {
    tabs = el('div', 'tabs', def.tabs.map(([k, n]) => `<button data-act="tab" data-arg="${k}">${n}</button>`).join(''));
    win.appendChild(tabs);
  }
  win.appendChild(ctx.body);
  ui.root.appendChild(back);
  app.sfx('open');
  let lastHtml = '';
  const render = (force = false) => {
    const html = def.render(ctx);
    if (!force && html === lastHtml) return;
    const scroll = ctx.body.scrollTop;
    lastHtml = html;
    ctx.body.innerHTML = html;
    ctx.body.scrollTop = scroll;
    def.after?.(ctx);
    if (tabs) for (const b of Array.from(tabs.querySelectorAll('button'))) b.classList.toggle('on', (b as HTMLElement).dataset.arg === ctx.tab);
  };
  render(true);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    back.remove();
    window.removeEventListener('keydown', onKey, true);
    ui.panelClosed();
    app.sfx('close');
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  listen(window, 'keydown', onKey, true);
  back.addEventListener('pointerdown', (e) => {
    if (e.target === back) close();
  });
  delegate(win, (act, arg, t, e) => {
    if (act === 'close' || act === 'resume') {
      close();
      return;
    }
    if (act === 'tab') {
      ctx.tab = arg;
      app.sfx('click');
      render(true);
      return;
    }
    e.preventDefault();
    app.sfx('click');
    def.act?.(ctx, act, arg, t);
    if (!closed) render(true);
  });
  let t = 0;
  return {
    id,
    close,
    refresh: () => {
      if (!def.live || closed) return;
      t++;
      if (t % 4 !== 0) return; // about once a second
      const active = document.activeElement;
      if (active && active.tagName === 'INPUT' && ctx.body.contains(active)) return;
      render();
    },
  };
}
