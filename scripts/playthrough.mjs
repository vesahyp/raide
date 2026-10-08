// The scenario played on a phone by a thumb that is not the bot: on an emulated iPhone, in
// portrait and then in landscape, every input a real touch (CDP touch events, the ones a
// finger makes), a video of each run. The hand in tools/hand.ts decides what to do and how a
// thumb moves; this script finds the stations on the screen through the game's camera, turns
// the hand's drag into touch events, taps the cards' buttons, and keeps the tally.
//
// `make playthrough` (SCENARIO=harju by default, sawmill for the tutorial; ORIENT=portrait or
// landscape for one; SPEED=0.5 on a loaded machine; PORT= to pin the preview port). Needs `make shots-setup`. Writes shots/playthrough/: a .webm
// per run, the result sheet, frame sheets (a frame a second, six by six), summary.md and
// summary.json. Exits non-zero when the slice is not fun by its rules: a run not won, the first
// paid delivery later than 90 s, a page error.
import { chromium, devices } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const freePort = () => new Promise((resolve) => { const srv = createServer(); srv.listen(0, () => { const p = srv.address().port; srv.close(() => resolve(p)); }); });
const port = Number(process.env.PORT) || (await freePort());
const SPEED = Number(process.env.SPEED || 1);
const ORIENTS = process.env.ORIENT ? [process.env.ORIENT] : ['portrait', 'landscape'];
const SCENARIO = process.env.SCENARIO || 'harju';
const OUT = 'shots/playthrough';

// a production build, served still: the dev server reloads the game when a file is saved
execFileSync('npx', ['vite', 'build', '--logLevel', 'error'], { stdio: 'inherit' });
execFileSync('npx', ['vite', 'build', '--ssr', 'tools/hand.ts', '--outDir', '.hand-check', '--logLevel', 'error'], { stdio: 'inherit' });
const HAND_JS = readFileSync('.hand-check/hand.js', 'utf8').replace(/export\s*\{[^}]*\};?/g, '') + '\nwindow.__Hand = Hand; window.__PLANS = PLANS;';

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) rmSync(join(OUT, f), { recursive: true, force: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; ; i++) {
  const up = await fetch(`http://localhost:${port}/raide/`).then((r) => r.ok, () => false);
  if (up) break;
  if (i > 120) throw new Error(`no preview server on port ${port} after 60 s`);
  await new Promise((r) => setTimeout(r, 500));
}
const browser = await chromium.launch();
let failed = false;
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed = true;
};
const summary = [];

/** the game as the thumb sees it: the sim's numbers and where things are on the glass */
const look = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const r = window.__renderer;
    const hand = window.__hand;
    if (!s || !r) return null;
    const toS = (x, y) => r.project(x, y, 2);
    const cellS = (c) => toS((c % s.w) + 0.5, Math.floor(c / s.w) + 0.5);
    const sites = {};
    for (const site of s.sites) sites[site.id] = cellS(site.cy * s.w + site.cx);
    const siteOf = (cell) => s.sites.find((o) => o.cy * s.w + o.cx === cell)?.id;
    const pair = (l) => [siteOf(l.path[0]), siteOf(l.path[l.path.length - 1])];
    const lines = s.lines.map(pair);
    const trains = s.trains.map((t) => {
      const l = s.lines.find((o) => o.id === t.lineId);
      // the last wagon's middle on the glass, to tap it: the engine stands on the station cell, where a tap is the site's
      const L = 1.1 + 0.9 * t.nWagons;
      const d = t.s - t.dir * (L - 0.45);
      const n = l.path.length;
      let k = 1;
      while (k < n - 1 && l.dist[k] < d) k++;
      const a = l.path[k - 1], b = l.path[k];
      const seg = l.dist[k] - l.dist[k - 1];
      const f = seg > 0 ? Math.max(0, Math.min(1, (d - l.dist[k - 1]) / seg)) : 0;
      const ax = (a % s.w) + 0.5, ay = Math.floor(a / s.w) + 0.5, bx = (b % s.w) + 0.5, by = Math.floor(b / s.w) + 0.5;
      return { id: t.id, line: pair(l), at: toS(ax + (bx - ax) * f, ay + (by - ay) * f), stopped: t.state === 'stop' };
    });
    const glass = { ...r.area(), scale: r.scale };
    const el = (q) => document.querySelector(q);
    const card = el('.card.result') ? 'result' : el('.money-card') ? 'money' : el('.card.ledger') ? 'yearEnd' : el('.choice-card') ? 'choice' : el('[data-act="wagon"]') ? 'train' : el('[data-track="card-buy-train"]') ? 'line' : el('.want, .card.sheet') ? 'site' : 'none';
    const head = el('.card.sheet h2')?.textContent ?? '';
    const nameOf = (id) => s.sites.find((o) => o.id === id)?.name.fi;
    const cardLine = card === 'line' ? lines.find((l) => head.includes(nameOf(l[0])) && head.includes(nameOf(l[1]))) ?? null : null;
    const cardSite = card === 'site' ? s.sites.find((o) => head.includes(o.name.fi))?.id ?? null : null;
    const crews = s.stations.filter((st) => st.crew).map((st) => st.siteId);
    const platforms = Object.fromEntries(s.stations.map((st) => [st.siteId, st.platforms]));
    let cardTrain = null;
    if (card === 'train') {
      const earned = (el('.train-row.still .row-text')?.textContent ?? '').match(/(\d+)\s*$/)?.[1];
      const lineName = el('.line-name')?.textContent ?? '';
      const cands = s.trains.filter((t) => { const p = pair(s.lines.find((o) => o.id === t.lineId)); return lineName.includes(nameOf(p[0])) && lineName.includes(nameOf(p[1])); });
      cardTrain = (cands.find((t) => String(Math.round(t.earned)) === earned) ?? cands[0])?.id ?? null;
    }
    // the next line's cost by mode, read the way the cost shows on the line
    let nextCost = null;
    const step = hand && hand.steps[hand.done];
    if (step && step.kind === 'line' && window.__plan) {
      const cell = (id) => { const o = s.sites.find((x) => x.id === id); return o.cy * s.w + o.cx; };
      const opts = window.__plan(cell(step.from), cell(step.to));
      if (opts.length) nextCost = { cheap: opts[0].cost, short: opts[1] ? opts[1].cost : null };
    }
    // the middle of each line on the glass, two points to try, to tap the track
    const lineTaps = s.lines.map((l) => [cellS(l.path[Math.floor(l.path.length * 0.4)]), cellS(l.path[Math.floor(l.path.length * 0.6)])]);
    return {
      glass, cash: s.cash, sites, lines, trains, yearEnd: !!s.yearEnd, result: s.result, card, cardLine, cardTrain, cardSite, crews, platforms, nextCost, trainPrice: (() => { const n = Math.min(4, 2 + (s.perks.includes('wagon') ? 1 : 0)); return { hilma: window.__act.price('hilma', n), jyry: window.__act.price('jyry', n) }; })(), lineTaps,
      loan: s.loan, ceiling: window.__act.ceiling(), delivered: Object.fromEntries(s.sites.map((o) => [o.id, o.delivered])),
      // whether a train bought now for the line the hand wants would stand on a platform and not park
      spotFree: (() => { const st = hand && hand.steps[hand.done]; if (!st || st.kind !== 'train') return true; const l = s.lines.find((o) => { const p = pair(o); return (p[0] === st.line[0] && p[1] === st.line[1]) || (p[0] === st.line[1] && p[1] === st.line[0]); }); return l ? window.__act.spotFree(l.id, 2) : true; })(),
      time: s.time, year: s.year, firstPayAt: s.firstPayAt, towns: s.sites.filter((x) => x.kind === 'town').map((x) => x.size), bridges: s.lines.reduce((a, l) => a + l.path.filter((c) => s.water[c]).length, 0), cuttings: s.lines.reduce((a, l) => a + l.path.filter((c, k) => l.rail[k] < s.height[c] - 1 && !s.water[c]).length, 0),
    };
  });

async function run(orient) {
  const phone = devices[orient === 'landscape' ? 'iPhone 15 landscape' : 'iPhone 15'];
  const context = await browser.newContext({ ...phone, hasTouch: true, recordVideo: { dir: join(OUT, 'tmp'), size: phone.viewport } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const name = `${SCENARIO}-${orient}`;
  const cdp = await context.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tap = async (x, y) => {
    await touch('touchStart', [{ x, y, id: 1 }]);
    await page.waitForTimeout(60);
    await touch('touchEnd', []);
  };
  // a button that is gone by the time the thumb reaches it is a missed tap, not a crash: the
  // hand looks again next round
  const tapButton = async (locator) => {
    let b = null;
    try {
      b = await locator.first().boundingBox({ timeout: 3000 });
    } catch {
      b = null;
    }
    if (!b) return false;
    await tap(b.x + b.width / 2, b.y + b.height / 2);
    return true;
  };
  // bring points into view the way a player does: the zoom button, and one-finger pans that start
  // on bare ground (away from every site and train, or the finger would build or tap instead)
  const frameOn = async (pointsOf) => {
    for (let n = 0; n < 8; n++) {
      const v = await look(page);
      const pts = pointsOf(v);
      const m = await page.evaluate(({ pts, g }) => window.__hand.frame(pts, g), { pts, g: v.glass });
      if (m.kind === 'ok') return true;
      if (m.kind === 'zoom') {
        await tapButton(page.locator('[data-zoom="out"]'));
        // the zoom eases: look again only when the picture has stopped changing
        let last = -1;
        for (let k = 0; k < 40; k++) {
          await page.waitForTimeout(200);
          const now = (await look(page)).glass.scale;
          if (Math.abs(now - last) < 0.01) break;
          last = now;
        }
        continue;
      }
      const busy = [...Object.values(v.sites), ...v.trains.map((t) => t.at)];
      const g = v.glass;
      let best = null;
      // the middle of the glass, so the stroke stays clear of the HUD and the zoom buttons
      for (let i = 2; i < 6; i++)
        for (let j = 2; j < 6; j++) {
          const p = { x: g.l + (g.w * i) / 8, y: g.t + (g.h * j) / 8 };
          const d = Math.min(...busy.map((b) => Math.hypot(b.x - p.x, b.y - p.y)));
          if (!best || d > best.d) best = { p, d };
        }
      // the finger keeps to the glass: a long pan is made in several strokes
      const dx = Math.max(-g.w / 3, Math.min(g.w / 3, m.dx));
      const dy = Math.max(-g.h / 3, Math.min(g.h / 3, m.dy));
      const a = { x: best.p.x - dx / 2, y: best.p.y - dy / 2 };
      const path = await page.evaluate(({ a, b }) => window.__hand.path(a, b), { a, b: { x: a.x + dx, y: a.y + dy } });
      await touch('touchStart', [{ x: a.x, y: a.y, id: 1 }]);
      let at = 0;
      for (const q of path) {
        await page.waitForTimeout(Math.max(0, q.at - at));
        at = q.at;
        await touch('touchMove', [{ x: q.x, y: q.y, id: 1 }]);
      }
      await touch('touchEnd', []);
      await page.waitForTimeout(300);
    }
    return false;
  };
  const stats = { drags: 0, buys: 0, choices: 0, taps: 0, routes: { cheap: 0, short: 0 }, acts: 0, error: null, won: false, year: 0, cash: 0, stars: 0, firstPayAt: null, seconds: 0 };
  const t0 = Date.now();
  const same = (a, b) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
  try {
    await page.goto(`http://localhost:${port}/raide/?lang=en${SPEED !== 1 ? `&speed=${SPEED}` : ''}`);
    await page.addScriptTag({ content: HAND_JS });
    await page.evaluate((sc) => { window.__hand = new window.__Hand(sc, 0.6); }, SCENARIO);
    await page.waitForTimeout(800);
    await tapButton(page.locator(`[data-scenario="${SCENARIO}"]`));
    await page.waitForFunction(() => window.__sim && window.__renderer, null, { timeout: 10000 });
    await page.waitForTimeout(600);
    const react = async () => page.waitForTimeout(Math.round(1000 * (await page.evaluate(() => window.__hand.reaction))));
    let idle = 0;
    let stuck = 0;
    let mark = '';
    for (let i = 0; i < 6000; i++) {
      const v = await look(page);
      if (!v) throw new Error('the game is gone');
      const act = await page.evaluate((view) => window.__hand.next(view), v);
      if (act.kind === 'done') break;
      // the plan must move: a hundred rounds of taps with no new line, train or step is a loop
      const now = `${v.lines.length}/${v.trains.length}/${await page.evaluate(() => window.__hand.done)}`;
      if (now === mark && act.kind !== 'wait') {
        if (++stuck > 100) throw new Error(`stuck at ${now} doing ${act.kind}`);
      } else stuck = 0;
      mark = now;
      if (act.kind === 'wait') {
        await page.waitForTimeout(250);
        if (++idle > 2400 / SPEED) throw new Error('the hand waited ten minutes with nothing to do');
        continue;
      }
      idle = 0;
      await react();
      if (act.kind === 'drag') {
        await frameOn((w) => [w.sites[act.from], w.sites[act.to]]);
        let w = await look(page);
        const a = w.sites[act.from];
        let b = w.sites[act.to];
        const stroke = async (from, to) => {
          const pts = await page.evaluate(({ a, b }) => window.__hand.path(a, b), { a: from, b: to });
          let at = 0;
          for (const p of pts) {
            await page.waitForTimeout(Math.max(0, p.at - at));
            at = p.at;
            await touch('touchMove', [{ x: p.x, y: p.y, id: 1 }]);
          }
        };
        await touch('touchStart', [{ x: a.x, y: a.y, id: 1 }]);
        let at = a;
        if (!(await page.evaluate(({ b, g }) => window.__hand.seen(b, g), { b, g: w.glass }))) {
          // the target is off the glass: hold the finger near the edge it lies past until it scrolls in
          const g = w.glass;
          at = { x: Math.max(g.l + 8, Math.min(g.l + g.w - 8, b.x)), y: Math.max(g.t + 8, Math.min(g.t + g.h - 8, b.y)) };
          await stroke(a, at);
          for (let n = 0; n < 200; n++) {
            await page.waitForTimeout(100);
            w = await look(page);
            b = w.sites[act.to];
            if (await page.evaluate(({ b, g }) => window.__hand.seen(b, g), { b, g: w.glass })) break;
          }
        }
        // the map may still be scrolling under the finger while it leaves the edge: aim at the site as it is now
        let fx = at.x;
        let fy = at.y;
        for (let n = 0; n < 120; n++) {
          b = (await look(page)).sites[act.to];
          const d = Math.hypot(b.x - fx, b.y - fy);
          if (d < 3) break;
          const k = Math.min(1, 22 / d);
          fx += (b.x - fx) * k;
          fy += (b.y - fy) * k;
          await touch('touchMove', [{ x: fx, y: fy, id: 1 }]);
          await page.waitForTimeout(25);
        }
        await page.waitForTimeout(150);
        await touch('touchEnd', []);
        stats.drags++;
        await page.waitForTimeout(300);
        const after = await look(page);
        // a year end that opens under the finger ends the drag: the hand makes it again after the choice
        if (!(after.lines.length > v.lines.length || after.card === 'choice' || after.yearEnd)) {
          stats.error = `drag ${act.from} -> ${act.to} built nothing and offered nothing`;
          await page.screenshot({ path: join(OUT, `${name}-drag.png`) });
          break;
        }
      } else if (act.kind === 'route') {
        const btn = page.locator(`[data-route="${act.mode}"]`);
        if (!(await btn.count())) { stats.error = `no ${act.mode} route offered`; break; }
        await tapButton(btn);
        stats.routes[act.mode]++;
        await page.waitForTimeout(300);
      } else if (act.kind === 'openLine') {
        const idx = v.lines.findIndex((l) => same(l, act.line));
        await frameOn((w) => [w.lineTaps[idx][0]]);
        const [p1, p2] = (await look(page)).lineTaps[idx];
        await tap(p1.x, p1.y);
        stats.taps++;
        await page.waitForTimeout(300);
        let after = await look(page);
        if (after.card !== 'line') {
          if (after.card !== 'none') { await tapButton(page.locator('.round.close')); await page.waitForTimeout(200); }
          await tap(p2.x, p2.y);
          stats.taps++;
          await page.waitForTimeout(300);
          after = await look(page);
        }
      } else if (act.kind === 'buy') {
        const w = page.locator(`[data-wagon="${act.wagons}"]`);
        if (await w.count()) {
          if (!(await w.evaluate((el) => el.classList.contains('on')))) { await tapButton(w); await page.waitForTimeout(150); }
        }
        const e = page.locator(`[data-engine="${act.engine}"]`);
        if (await e.count()) {
          if (!(await e.evaluate((el) => el.classList.contains('on')))) { await tapButton(e); await page.waitForTimeout(150); }
        }
        await tapButton(page.locator('[data-track="card-buy-train"]'));
        stats.buys++;
        await page.waitForTimeout(300);
        const after = await look(page);
        if (after.trains.length <= v.trains.length) {
          stats.error = `buy ${act.wagons} ${act.engine} bought nothing`;
          await page.screenshot({ path: join(OUT, `${name}-buy.png`) });
          break;
        }
      } else if (act.kind === 'openTrain') {
        await frameOn((w) => [w.trains.find((o) => o.id === act.train).at]);
        const t = (await look(page)).trains.find((o) => o.id === act.train);
        await tap(t.at.x, t.at.y);
        stats.taps++;
        await page.waitForTimeout(300);
        const after = await look(page);
        if (after.card !== 'train' && after.card !== 'none') { await tapButton(page.locator('.round.close')); await page.waitForTimeout(200); }
      } else if (act.kind === 'openSite') {
        await frameOn((w) => [w.sites[act.site]]);
        const p = (await look(page)).sites[act.site];
        await tap(p.x, p.y);
        stats.taps++;
        await page.waitForTimeout(300);
        const after = await look(page);
        if (after.card !== 'site' && after.card !== 'none') { await tapButton(page.locator('.round.close')); await page.waitForTimeout(200); }
      } else if (act.kind === 'openMoney') {
        await tapButton(page.locator('[data-act="money"]'));
        await page.waitForTimeout(300);
      } else if (act.kind === 'borrow' || act.kind === 'repay') {
        if (await tapButton(page.locator(`[data-act="${act.kind}"]:not([disabled])`))) stats.acts++;
        await page.waitForTimeout(200);
      } else if (act.kind === 'platform') {
        if (await tapButton(page.locator('[data-act="platform"]'))) stats.acts++;
        await page.waitForTimeout(250);
        await tapButton(page.locator('.round.close'));
        await page.waitForTimeout(200);
      } else if (act.kind === 'crew') {
        if (await tapButton(page.locator('[data-act="crew"]'))) stats.acts++;
        await page.waitForTimeout(250);
        await tapButton(page.locator('.round.close'));
        await page.waitForTimeout(200);
      } else if (act.kind === 'act') {
        const b = page.locator(`[data-act="${act.what}"]`);
        if (!(await b.count())) { stats.error = `no ${act.what} on the train card`; break; }
        await tapButton(b);
        stats.acts++;
        await page.waitForTimeout(250);
        await tapButton(page.locator('.round.close'));
        await page.waitForTimeout(200);
      } else if (act.kind === 'close') {
        const c = page.locator('.round.close');
        if (await c.count()) await tapButton(c);
        await page.waitForTimeout(200);
      } else if (act.kind === 'choose') {
        await page.locator('.card.ledger').waitFor({ timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(700);
        if (await tapButton(page.locator('.btn.choice:not([disabled])'))) stats.choices++;
        await page.waitForTimeout(400);
        await tapButton(page.locator('.btn.choice.continue'));
        await page.waitForTimeout(400);
      }
    }
    await page.locator('.card.result').waitFor({ timeout: 10000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(OUT, `${name}-result.png`) });
    const v = await look(page);
    Object.assign(stats, { won: v.result.won, year: v.result.year, cash: v.result.cash, stars: v.result.stars, firstPayAt: v.firstPayAt, simSeconds: v.time, towns: v.towns, bridges: v.bridges, cuttings: v.cuttings, lines: v.lines.length, trains: v.trains.length });
  } catch (e) {
    stats.error = stats.error ?? String(e).split('\n')[0];
    await page.screenshot({ path: join(OUT, `${name}-error.png`) }).catch(() => undefined);
  }
  stats.seconds = (Date.now() - t0) / 1000;
  stats.errors = errors;
  const video = page.video();
  await context.close();
  renameSync(await video.path(), join(OUT, `${name}.webm`));
  return { name, orient, ...stats, video: `${name}.webm` };
}

try {
  for (const o of ORIENTS) {
    const r = await run(o);
    summary.push(r);
    console.log(`${r.name}: ${r.error ? `ERROR ${r.error}` : `${r.won ? 'won' : 'lost'} ${r.year} cash ${r.cash} stars ${r.stars} first pay ${r.firstPayAt?.toFixed(0)} s towns ${r.towns?.join('/')} lines ${r.lines} trains ${r.trains} bridge cells ${r.bridges} cutting cells ${r.cuttings}`} drags ${r.drags} routes cheap ${r.routes.cheap} short ${r.routes.short} buys ${r.buys} acts ${r.acts} choices ${r.choices} in ${r.seconds.toFixed(0)} s real, ${r.simSeconds?.toFixed(0) ?? '-'} s sim`);
  }
} finally {
  await browser.close();
  server.kill();
}
rmSync(join(OUT, 'tmp'), { recursive: true, force: true });

// frame sheets: a frame a second of each video, six by six, to read a run at a glance
const cache = join(homedir(), 'Library/Caches/ms-playwright');
const ffmpegDir = existsSync(cache) && readdirSync(cache).find((d) => d.startsWith('ffmpeg-'));
const ffmpeg = ffmpegDir && join(cache, ffmpegDir, 'ffmpeg-mac');
if (ffmpeg && existsSync(ffmpeg)) {
  mkdirSync(join(OUT, 'sheets'), { recursive: true });
  const sheets = await chromium.launch();
  for (const r of summary) {
    const frames = join(OUT, 'tmp-frames');
    rmSync(frames, { recursive: true, force: true });
    mkdirSync(frames, { recursive: true });
    try {
      const size = r.orient === 'landscape' ? '426x197' : '197x426';
      execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(OUT, r.video), '-r', '0.5', '-s', size, join(frames, '%03d.png')]);
      const files = readdirSync(frames).sort();
      const [fw, fh] = size.split('x').map(Number);
      const page = await sheets.newPage();
      for (let k = 0; k * 36 < files.length; k++) {
        const batch = files.slice(k * 36, k * 36 + 36).map((f) => `data:image/png;base64,${readFileSync(join(frames, f)).toString('base64')}`);
        await page.setContent(`<body style="margin:0;background:#111"><div style="display:grid;grid-template-columns:repeat(6,${fw}px);gap:1px;width:${6 * (fw + 1)}px">${batch.map((src, i) => `<div style="position:relative"><img src="${src}" style="display:block"><span style="position:absolute;left:4px;top:2px;color:#ffd870;font:bold 14px monospace;text-shadow:0 0 3px #000">${(k * 36 + i) * 2}s</span></div>`).join('')}</div></body>`);
        await page.setViewportSize({ width: 6 * (fw + 1), height: Math.ceil(batch.length / 6) * (fh + 1) });
        await page.screenshot({ path: join(OUT, 'sheets', `${r.name}-${k + 1}.png`), fullPage: true });
      }
      await page.close();
    } catch (e) {
      console.log(`no sheet for ${r.name}: ${String(e).split('\n')[0]}`);
    }
    rmSync(frames, { recursive: true, force: true });
  }
  await sheets.close();
}

writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(OUT, 'summary.md'), `| run | result | year | cash | stars | first pay | drags | short routes | buys | acts | choices | real s |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n${summary.map((r) => `| ${r.name} | ${r.error ? `error: ${r.error}` : r.won ? 'won' : 'lost'} | ${r.year} | ${r.cash} | ${r.stars} | ${r.firstPayAt?.toFixed(0) ?? ''} s | ${r.drags} | ${r.routes.short} | ${r.buys} | ${r.acts} | ${r.choices} | ${r.seconds.toFixed(0)} |`).join('\n')}\n`);

// the rules of a fun slice
check(summary.every((r) => !r.error && r.won), `the thumb wins ${SCENARIO} in both orientations`);
check(summary.every((r) => !r.errors?.length), `no page errors (${summary.flatMap((r) => r.errors ?? []).slice(0, 3).join('; ') || 'none'})`);
check(summary.every((r) => r.firstPayAt !== null && r.firstPayAt < 90), `the first paid delivery lands inside 90 s (${summary.map((r) => r.firstPayAt?.toFixed(0) ?? '-').join(' ')})`);
if (SCENARIO === 'sawmill') check(summary.every((r) => r.drags === 2 && r.buys === 2), `two drags and two trains do the whole scenario (${summary.map((r) => `${r.drags}/${r.buys}`).join(' ')})`);
if (SCENARIO === 'harju') {
  check(summary.every((r) => r.lines === 6 && r.trains === 6), `the thumb builds the whole network: six lines, six trains (${summary.map((r) => `${r.lines}/${r.trains}`).join(' ')})`);
  check(summary.every((r) => r.routes.short >= 3 && r.bridges >= 5 && r.cuttings >= 2), `the thumb picks the short route where the plan says, with a bridge and a cutting built (${summary.map((r) => `${r.routes.short} short, ${r.bridges} bridge, ${r.cuttings} cutting`).join('; ')})`);
  check(summary.every((r) => r.acts >= 4), `the thumb works the train cards: wagons and the full-load switch (${summary.map((r) => r.acts).join(' ')})`);
}
console.log(failed ? 'playthrough failed' : 'playthrough ok');
process.exitCode = failed ? 1 : 0;
