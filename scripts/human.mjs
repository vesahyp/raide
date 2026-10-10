// The measure of done (ADR 0006): a human-like player plays a scenario by touch on an emulated
// iPhone 16 in portrait. It is not the bot: it reads what the screen shows (the tip, the goal
// strip, the prices on the sites, the cards), it waits as a person would before each move, and it
// makes every move as a touch (CDP touch events): a drag from a station to a site, a tap on a card's
// button, a tap on the pick. Every decision is logged with its game time.
//
// `make human` (SCENARIO=harju by default; SPEED=2 runs the clock twice as fast, the player's
// waits are real time, so a faster clock makes the player slower in game time). Writes
// shots/human/: the video, a picture at every decision, log.md (the decision log and the measures)
// and log.json. Exits non-zero when the run misses the measures: a decision at least every 30 s of
// game time, a town growing inside the first 2 minutes, a win in 10 to 15 minutes.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';

const SCENARIO = process.argv[2] || process.env.SCENARIO || 'harju';
const SPEED = Number(process.env.SPEED || 1);
const OUT = 'shots/human';
const freePort = () => new Promise((resolve) => { const srv = createServer(); srv.listen(0, () => { const p = srv.address().port; srv.close(() => resolve(p)); }); });
const port = Number(process.env.PORT) || (await freePort());

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) rmSync(join(OUT, f), { recursive: true, force: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; ; i++) {
  if (await fetch(`http://localhost:${port}/raide/`).then((r) => r.ok, () => false)) break;
  if (i > 120) throw new Error('no preview server');
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch();
const phone = devices['iPhone 16'];
const context = await browser.newContext({ ...phone, hasTouch: true, recordVideo: { dir: join(OUT, 'tmp'), size: phone.viewport } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const cdp = await context.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
const wait = (ms) => page.waitForTimeout(ms);
// a person's pause before a move: a little longer for a card to read
const think = (base = 900) => wait(base + Math.random() * 600);

const tap = async (x, y) => {
  await touch('touchStart', [{ x, y, id: 1 }]);
  await wait(70);
  await touch('touchEnd', []);
};
/** tap a button by its selector, scrolling its card to it first; false when it is not there or is disabled */
const tapButton = async (sel) => {
  const loc = page.locator(sel).first();
  if (!(await loc.count())) return false;
  if (await loc.isDisabled().catch(() => true)) return false;
  await loc.evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
  await wait(120);
  const b = await loc.boundingBox().catch(() => null);
  if (!b) return false;
  await tap(b.x + b.width / 2, b.y + b.height / 2);
  return true;
};
/** a thumb's drag: down, a short hold, then along a slightly curved path at a thumb's speed */
const drag = async (a, b) => {
  await touch('touchStart', [{ x: a.x, y: a.y, id: 1 }]);
  await wait(120);
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(8, Math.round(d / 18));
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const bend = Math.sin(Math.PI * k) * 10;
    await touch('touchMove', [{ x: a.x + (b.x - a.x) * k + bend, y: a.y + (b.y - a.y) * k, id: 1 }]);
    await wait(16);
  }
  await wait(250);
  await touch('touchEnd', []);
};

/** what the player sees: the clock, the cash, the sites on the glass, the cards, the tip, the goal strip */
const look = () =>
  page.evaluate(() => {
    const s = window.__sim;
    const r = window.__renderer;
    const at = (o) => r.project(o.cx + 0.5, o.cy + 0.5, 0);
    const el = (q) => document.querySelector(q);
    const tipEl = el('.hud-tip');
    const siteOf = (cell) => s.sites.find((o) => o.cy * s.w + o.cx === cell);
    return {
      time: s.time,
      year: s.year,
      cash: Math.floor(s.cash),
      result: s.result,
      pick: s.pick ? { options: s.pick.options, titles: [...document.querySelectorAll('.btn.pick b')].map((b) => b.textContent) } : null,
      card: el('.pick-card') ? 'pick' : el('.card.result') ? 'result' : el('.choice-card') ? 'choice' : el('.buy-card') ? 'line' : el('.train-card') ? 'train' : el('.site-card') ? 'site' : el('.card.sheet, .card.overlay') ? 'other' : 'none',
      buy: el('[data-act="buy"]') ? { disabled: el('[data-act="buy"]').disabled, text: el('[data-act="buy"]').textContent } : null,
      lineCard: el('.buy-card') ? Number(el('.buy-card').dataset.lineCard) : null,
      tip: tipEl ? { kind: tipEl.dataset.tip, text: tipEl.textContent.replace(/[!×]/g, '').trim() } : null,
      goal: [...document.querySelectorAll('[data-goal-town]')].map((e) => e.dataset.goalTown),
      sites: Object.fromEntries(s.sites.map((o) => [o.id, { ...at(o), kind: o.kind, stock: Math.floor(o.stock), size: o.size, station: s.stations.some((st) => st.siteId === o.id), growth: o.growth }])),
      lines: s.lines.map((l) => ({ id: l.id, a: siteOf(l.path[0]).id, b: siteOf(l.path[l.path.length - 1]).id, trains: s.trains.filter((t) => t.lineId === l.id).length, waiting: s.trains.some((t) => t.lineId === l.id && t.state === 'stop' && t.waited > 2) })),
      // the price on each site while the finger holds a drag or pick mode is on: what the screen shows
      costs: Object.fromEntries([...document.querySelectorAll('.site-tag')].map((e) => [e.dataset.key?.replace('site:', ''), Number(e.querySelector('.chip.cost b')?.textContent ?? NaN)])),
      trainPrice: window.__act.price('hilma', 2),
      free: s.perks.freeTrains > 0,
      buyMarks: [...document.querySelectorAll('[data-buy-line]')].map((e) => { const b = e.getBoundingClientRect(); return { line: Number(e.dataset.buyLine), x: b.x + b.width / 2, y: b.y + b.height / 2 }; }),
    };
  });

const log = [];
let shot = 0;
const decide = async (v, kind, what, extra = {}) => {
  const entry = { t: Math.round(v.time * 10) / 10, year: v.year, cash: v.cash, kind, what, ...extra };
  log.push(entry);
  console.log(`${String(entry.t.toFixed(1)).padStart(6)} s  ${v.year}  ${String(v.cash).padStart(5)}  ${kind.padEnd(6)} ${what}`);
  shot++;
  await page.screenshot({ path: join(OUT, `${String(shot).padStart(3, '0')}-${kind}.png` ) });
};
const snapshots = [];

// ---------------------------------------------------------------------------- the game

await page.goto(`http://localhost:${port}/raide/?lang=en&speed=${SPEED}`);
await page.locator(`[data-scenario="${SCENARIO}"]`).tap();
await page.waitForFunction(() => window.__sim && window.__renderer);
await wait(1500);

const near = (v, a, b) => Math.hypot(v.sites[a].x - v.sites[b].x, v.sites[a].y - v.sites[b].y);
const MAKES = { forest: 'timber', sawmill: 'boards', farm: 'grain', mill: 'flour', town: null };
const TAKES = { forest: [], sawmill: ['timber'], farm: [], mill: ['grain'], town: ['boards', 'flour'] };
const trades = (v, a, b) => { const ka = v.sites[a].kind; const kb = v.sites[b].kind; return (MAKES[ka] && TAKES[kb].includes(MAKES[ka])) || (MAKES[kb] && TAKES[ka].includes(MAKES[kb])); };
const joined = (v, a, b) => v.lines.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));

/**
 * The lines this player wants, in order: what feeds the goal towns. The chain's first link, then the
 * refinery to the goal towns, nearest first; then the second chain the same way. A player reads this
 * off the map: the goal strip names the towns, the NEEDS chips say what they take.
 */
const wanted = (v) => {
  const towns = v.goal.length ? v.goal : Object.keys(v.sites).filter((id) => v.sites[id].kind === 'town');
  const list = [];
  for (const [raw, ref] of [['forest', 'sawmill'], ['farm', 'mill']]) {
    const raws = Object.keys(v.sites).filter((id) => v.sites[id].kind === raw);
    const refs = Object.keys(v.sites).filter((id) => v.sites[id].kind === ref);
    for (const r of refs) {
      const src = raws.sort((a, b) => near(v, a, r) - near(v, b, r))[0];
      if (src) list.push([src, r]);
      for (const t of [...towns].sort((a, b) => near(v, r, a) - near(v, r, b))) list.push([r, t]);
    }
  }
  return list.filter(([a, b]) => !joined(v, a, b));
};

/** lay a line by a drag from the end with a station to the other; settles the choice card, logs it */
const layLine = async (v, a, b, why) => {
  const [from, to] = v.sites[a].station ? [a, b] : [b, a];
  if (!v.sites[from].station) return false;
  const cost = await page.evaluate(([x, y]) => {
    const s = window.__sim; const o = s.sites.find((q) => q.id === x); const p = s.sites.find((q) => q.id === y);
    const opts = window.__plan(o.cy * s.w + o.cx, p.cy * s.w + p.cx);
    return opts.map((r) => ({ mode: r.mode, cost: r.cost }));
  }, [from, to]);
  if (!cost.length || Math.min(...cost.map((c) => c.cost)) > v.cash) return false;
  await think();
  const before = v.lines.length;
  await drag(v.sites[from], v.sites[to]);
  await wait(500);
  let w = await look();
  let paid = cost.length === 1 ? cost[0].cost : cost.find((c) => c.mode === 'cheap')?.cost;
  if (w.card === 'choice') {
    // two ways: the faster one when the cash allows a train after it, else the cheap one
    const short = cost.find((c) => c.mode === 'short');
    const cheap = cost.find((c) => c.mode === 'cheap');
    const pickShort = short && v.cash - short.cost >= w.trainPrice * 0.6;
    await decide(w, 'route', `${pickShort ? 'short' : 'cheap'} way ${from} to ${to} (${cheap?.cost} cheap, ${short?.cost} short)`);
    await think(1300);
    await tapButton(`[data-route="${pickShort ? 'short' : 'cheap'}"]`);
    paid = (pickShort ? short : cheap)?.cost;
    await wait(500);
    w = await look();
  }
  if (w.lines.length > before) {
    const l = w.lines[w.lines.length - 1];
    await decide(w, 'line', `${from} to ${to} for ${paid} (${why})`, { line: l.id });
    return true;
  }
  return false;
};

/** buy a train on the open line card, or open it from the map's buy button first */
const buyTrain = async (lineId, why) => {
  let v = await look();
  if (v.lineCard !== lineId) {
    if (v.card !== 'none') await tapButton('.card .close');
    const mark = (await look()).buyMarks.find((m) => m.line === lineId);
    if (!mark) return false;
    await think(700);
    await tap(mark.x, mark.y);
    await wait(500);
    v = await look();
  }
  if (v.lineCard !== lineId || !v.buy || v.buy.disabled) return false;
  const adds = (await page.locator('[data-sec="buy-trips"]').first().textContent().catch(() => '')) ?? '';
  await think(1200);
  // the card says this train would add nothing: a player reads that and keeps the cash
  if (/^\+0\.0/.test(adds.trim()) && !/no train/.test(why)) {
    await tapButton('.card .close');
    return false;
  }
  const price = /(free|ilmainen|\d+)/.exec(v.buy.text.replace(/Buy train\s*/, ''))?.[1] ?? '?';
  if (!(await tapButton('[data-act="buy"]'))) return false;
  await wait(400);
  const w = await look();
  await decide(w, 'train', `on ${lineName(w, lineId)} for ${price} (${adds.trim()}; ${why})`);
  return true;
};
const lineName = (v, id) => { const l = v.lines.find((o) => o.id === id); return l ? `${l.a}–${l.b}` : `line ${id}`; };

/** the pick: read the two cards, take one */
const PREF = ['train', 'output', 'wagon', 'speed', 'track', 'fair', 'loading', 'cash'];
const takePick = async (v) => {
  await think(1800);
  const [a, b] = v.pick.options;
  // a player whose trains wait for loads wants more output; one with idle cash and lines to build wants cheaper track
  const starving = v.lines.some((l) => l.waiting);
  const rank = (p) => (starving && p === 'output' ? -1 : PREF.indexOf(p));
  const c = rank(a) <= rank(b) ? 0 : 1;
  await decide(v, 'pick', `${v.pick.options[c]} over ${v.pick.options[1 - c]} (${v.pick.titles.join(' / ')})`);
  await tapButton(`[data-act="pick-${c}"]`);
  await wait(400);
};

const start = Date.now();
let lastSnap = -30;
let idleSince = null;
for (;;) {
  const v = await look();
  if (v.time - lastSnap >= 30) {
    lastSnap = v.time;
    snapshots.push({ t: Math.round(v.time), towns: Object.fromEntries(Object.entries(v.sites).filter(([, o]) => o.kind === 'town').map(([id, o]) => [id, `${o.size}+${Math.round(o.growth)}`])), cash: v.cash, lines: v.lines.length, trains: v.lines.reduce((a, l) => a + l.trains, 0) });
  }
  if (v.result) {
    await wait(1500);
    await decide(v, 'end', `${v.result.won ? 'won' : 'lost'} ${v.result.year} (${v.result.reason}) at ${(v.result.time / 60).toFixed(1)} min, ${v.result.stars} stars`);
    break;
  }
  if ((Date.now() - start) / 60000 > 90) {
    await decide(v, 'end', 'stopped: 90 minutes of real time');
    break;
  }
  if (v.pick) {
    await takePick(v);
    continue;
  }
  if (v.card === 'choice') {
    await tapButton('[data-route="cheap"]');
    continue;
  }
  // a line with no train comes first: it earns nothing yet
  const idle = v.lines.find((l) => l.trains === 0);
  if (idle && (v.cash >= v.trainPrice || v.free)) {
    if (await buyTrain(idle.id, 'the line had no train')) continue;
  }
  // the tip, when it says the trains wait for loads at a forest or a farm: tap it, and expand the site from its card
  if (v.tip?.kind === 'expand') {
    await think(1200);
    await tapButton('[data-act="tip"]');
    await wait(500);
    const levels = () => page.evaluate(() => window.__sim.sites.reduce((n, o) => n + o.level, 0));
    const before = await levels();
    const price = await page.locator('[data-act="expand"] small').first().textContent().catch(() => '?');
    if ((await tapButton('[data-act="expand"]')) && (await levels()) > before) {
      const w = await look();
      await decide(w, 'expand', `${v.tip.text.replace(/: expand it for \d+$/, '')}: expanded for ${price}`);
      await tapButton('.card .close');
      continue;
    }
    await tapButton('.card .close');
  }
  // the tip, when it says to buy a train on a line where the goods wait
  if (v.tip?.kind === 'more' && (v.cash >= v.trainPrice || v.free)) {
    const lineId = await page.evaluate(() => { const r = window.__renderer; return r.advice?.onLine ?? null; });
    if (lineId !== null && (await buyTrain(lineId, `the tip: ${v.tip.text}`))) continue;
  }
  // the next line this player wants, when the cash covers it and leaves room for its train soon
  if (!idle) {
    const next = wanted(v).find(([a, b]) => trades(v, a, b) && (v.sites[a].station || v.sites[b].station));
    if (next && (await layLine(v, next[0], next[1], v.tip ? `tip: ${v.tip.text}` : 'feeds a goal town'))) continue;
  }
  // spare cash and a pile waiting at a line's loading end: one more train there
  if (v.cash >= v.trainPrice + 40 || v.free) {
    const busy = v.lines.filter((l) => l.trains > 0 && l.trains < 5).find((l) => {
      const src = [l.a, l.b].find((id) => ['forest', 'farm', 'sawmill', 'mill'].includes(v.sites[id].kind) && MAKES[v.sites[id].kind] && TAKES[v.sites[l.a === id ? l.b : l.a].kind].includes(MAKES[v.sites[id].kind]));
      return src && v.sites[src].stock >= 3;
    });
    if (busy && (await buyTrain(busy.id, `a pile of ${Math.max(...[busy.a, busy.b].map((id) => v.sites[id].stock))} waits`))) continue;
  }
  // nothing to do: a close card is closed, and the player watches
  if (v.card === 'line' || v.card === 'site' || v.card === 'train' || v.card === 'other') await tapButton('.card .close');
  if (idleSince === null) idleSince = v.time;
  await wait(1000);
}

// ---------------------------------------------------------------------------- the measures

await page.close();
await context.close();
const vids = readdirSync(join(OUT, 'tmp'));
if (vids[0]) renameSync(join(OUT, 'tmp', vids[0]), join(OUT, `${SCENARIO}.webm`));
rmSync(join(OUT, 'tmp'), { recursive: true, force: true });
await browser.close();
server.kill();

const moves = log.filter((d) => ['line', 'train', 'pick', 'route', 'expand'].includes(d.kind));
const times = [0, ...moves.map((d) => d.t)];
const gaps = times.slice(1).map((t, i) => t - times[i]);
const maxGap = Math.max(...gaps);
const end = log.find((d) => d.kind === 'end');
const won = /won/.test(end?.what ?? '');
const winMin = won ? Number(/at ([\d.]+) min/.exec(end.what)?.[1]) : null;
const firstGrow = snapshots.find((x) => Object.values(x.towns).some((v) => !/\+0$/.test(v)));
const firstGrowT = await (async () => firstGrow?.t ?? null)();
const md = [
  `# Human-like playthrough: ${SCENARIO}`,
  '',
  `iPhone 16 portrait, clock ×${SPEED}, ${new Date().toISOString().slice(0, 16)}; the game ran at ${(log[log.length - 1].t / ((Date.now() - start) / 1000)).toFixed(2)} game seconds a real second.`,
  '',
  `- Result: ${end?.what ?? 'none'}`,
  `- Decisions: ${moves.length} (${moves.filter((d) => d.kind === 'line').length} lines, ${moves.filter((d) => d.kind === 'train').length} trains, ${moves.filter((d) => d.kind === 'expand').length} expansions, ${moves.filter((d) => d.kind === 'pick').length} picks, ${moves.filter((d) => d.kind === 'route').length} route choices)`,
  `- Longest gap between decisions: ${maxGap.toFixed(0)} s of game time; mean ${(gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length)).toFixed(0)} s`,
  `- First town growth seen at the 30 s snapshot of ${firstGrowT ?? 'none'} s`,
  '',
  '| game time | year | cash | kind | decision |',
  '|---|---|---|---|---|',
  ...log.map((d) => `| ${d.t.toFixed(0)} s | ${d.year} | ${d.cash} | ${d.kind} | ${d.what} |`),
  '',
  '## Towns every 30 s (size + growth points)',
  '',
  '| t | ' + Object.keys(snapshots[0]?.towns ?? {}).join(' | ') + ' | cash | lines | trains |',
  '|---|' + Object.keys(snapshots[0]?.towns ?? {}).map(() => '---|').join('') + '---|---|---|',
  ...snapshots.map((x) => `| ${x.t} s | ${Object.values(x.towns).join(' | ')} | ${x.cash} | ${x.lines} | ${x.trains} |`),
  '',
  errors.length ? `Page errors: ${errors.slice(0, 5).join('; ')}` : 'No page errors.',
].join('\n');
writeFileSync(join(OUT, 'log.md'), md);
writeFileSync(join(OUT, 'log.json'), JSON.stringify({ log, snapshots, errors }, null, 2));
console.log(`\n${md.split('\n').slice(0, 9).join('\n')}`);

let failed = false;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed = true; };
check(!errors.length, 'no page errors');
check(maxGap <= 30.5, `a decision at least every 30 s of game time (longest gap ${maxGap.toFixed(0)} s)`);
check(firstGrowT !== null && firstGrowT <= 120, `a town grows inside the first 2 minutes (${firstGrowT} s)`);
if (SCENARIO === 'harju') check(won && winMin >= 9 && winMin <= 15.5, `a win in about 10 to 15 minutes (${winMin ?? 'no win'})`);
else check(won, 'the tutorial is won');
process.exitCode = failed ? 1 : 0;
