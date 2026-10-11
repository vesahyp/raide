// The measure of done (ADR 0007): two human-like players play a scenario by touch on an emulated
// iPhone 16 in portrait. Every move is a touch (CDP touch events): a one-finger pan, a two-finger
// pinch, a drag in track mode, a drag of the station square, taps on stations to make a route,
// taps on the cards' buttons. They read what the screen shows (the cards, the HUD) and the map's
// positions, as a person reads the glass.
//
// The careful player builds the chains in order, picks the level route where the grade would slow
// heavy trains, borrows once to build the second chain sooner, replaces worn locomotives and pays
// the bonds back. The careless player borrows to the limit, lays a long level line to a far forest,
// runs too many weak trains on one forest's logs, and never looks at the money.
//
// `make human` (SCENARIO=harju). Writes shots/human/: a video per player, a picture at every
// decision, log.md (the decision log, the trade-offs met, the years) and log.json. Exits non-zero
// unless the careful player wins and the careless one loses.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';

const SCENARIO = process.argv[2] || process.env.SCENARIO || 'harju';
const PACE = Number(process.env.PACE || 4);
const ONLY = process.env.ONLY;
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

const PLAYS = {
  harju: {
    careful: [
      { do: 'link', a: 'kuusikko', b: 'koskensaha', level: 'if-steep' },
      { do: 'station', at: 'kuusikko', size: 0 },
      { do: 'station', at: 'koskensaha', size: 0 },
      { do: 'link', a: 'koskensaha', b: 'hameenlinna', level: 'if-steep' },
      { do: 'station', at: 'hameenlinna', size: 1 },
      { do: 'train', stops: ['kuusikko', 'koskensaha', 'hameenlinna'], loco: 'jyry' },
      { do: 'bond', n: 1, why: 'borrow to build the paper chain a year sooner' },
      { do: 'link', a: 'korpi', b: 'valkeakoski', level: 'if-steep' },
      { do: 'station', at: 'korpi', size: 0 },
      { do: 'station', at: 'valkeakoski', size: 0 },
      { do: 'link', a: 'valkeakoski', b: 'tampere', level: 'if-steep' },
      { do: 'station', at: 'tampere', size: 1 },
      { do: 'train', stops: ['korpi', 'valkeakoski', 'tampere'], loco: 'jyry' },
      { do: 'link', a: 'hameenlinna', b: 'tampere', level: 'no' },
      { do: 'train', stops: ['tampere', 'hameenlinna'], loco: 'hilma' },
      { do: 'link', a: 'peltola', b: 'lahti', level: 'if-steep' },
      { do: 'station', at: 'peltola', size: 0 },
      { do: 'station', at: 'lahti', size: 1 },
      { do: 'link', a: 'lahti', b: 'myllykyla', level: 'if-steep' },
      { do: 'station', at: 'myllykyla', size: 0 },
      { do: 'train', stops: ['peltola', 'lahti', 'myllykyla'], loco: 'jyry' },
      { do: 'link', a: 'myllykyla', b: 'helsinki', level: 'if-steep' },
      { do: 'station', at: 'helsinki', size: 1 },
      { do: 'train', stops: ['myllykyla', 'helsinki'], loco: 'jyry', cars: [['food', 'food', 'food', 'food'], []] },
      { do: 'train', stops: ['kuusikko', 'koskensaha'], loco: 'jyry' },
      { do: 'link', a: 'hameenlinna', b: 'riihimaki', level: 'no' },
      { do: 'station', at: 'riihimaki', size: 1 },
      { do: 'link', a: 'riihimaki', b: 'helsinki', level: 'no' },
      { do: 'train', stops: ['hameenlinna', 'riihimaki', 'helsinki'], loco: 'ukko' },
    ],
    careless: [
      { do: 'bond', n: 3, why: 'borrow as much as the bank gives' },
      { do: 'link', a: 'salo', b: 'koskensaha', level: 'yes' },
      { do: 'station', at: 'salo', size: 2 },
      { do: 'station', at: 'koskensaha', size: 2 },
      { do: 'train', stops: ['salo', 'koskensaha'], loco: 'hilma', cars: [['logs', 'logs', 'logs', 'logs', 'logs', 'logs', 'logs', 'logs'], ['logs', 'logs', 'logs', 'logs']] },
      { do: 'train', stops: ['salo', 'koskensaha'], loco: 'hilma', cars: [['logs', 'logs', 'logs', 'logs', 'logs', 'logs', 'logs', 'logs'], ['logs', 'logs', 'logs', 'logs']] },
      { do: 'link', a: 'koskensaha', b: 'lahti', level: 'yes' },
      { do: 'station', at: 'lahti', size: 2 },
      { do: 'train', stops: ['koskensaha', 'lahti'], loco: 'hilma' },
      { do: 'train', stops: ['salo', 'koskensaha'], loco: 'hilma', cars: [['logs', 'logs', 'logs', 'logs', 'logs', 'logs', 'logs', 'logs'], ['logs', 'logs', 'logs', 'logs']] },
    ],
  },
};

const results = {};
const allLogs = {};

for (const who of ['careful', 'careless']) {
  if (ONLY && ONLY !== who) continue;
  const context = await browser.newContext({ ...phone, hasTouch: true, recordVideo: { dir: join(OUT, 'tmp'), size: phone.viewport } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const cdp = await context.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const wait = (ms) => page.waitForTimeout(ms);
  const think = (base = 600) => wait(base + Math.random() * 400);
  const W = phone.viewport.width;
  const H = phone.viewport.height;

  const tap = async (x, y) => {
    await touch('touchStart', [{ x, y, id: 1 }]);
    await wait(60);
    await touch('touchEnd', []);
    await wait(120);
  };
  const tapSel = async (sel) => {
    const loc = page.locator(sel).first();
    if (!(await loc.count())) return false;
    if (await loc.isDisabled().catch(() => true)) return false;
    await loc.evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
    await wait(100);
    const b = await loc.boundingBox().catch(() => null);
    if (!b) return false;
    await tap(b.x + b.width / 2, b.y + b.height / 2);
    return true;
  };
  /** a thumb's drag along a path of screen points, resting `rest` ms at the inner points */
  const drag = async (pts, rest = 0) => {
    await touch('touchStart', [{ x: pts[0].x, y: pts[0].y, id: 1 }]);
    await wait(100);
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1];
      const b = pts[k];
      const n = Math.max(6, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 14));
      for (let i = 1; i <= n; i++) {
        const u = i / n;
        await touch('touchMove', [{ x: a.x + (b.x - a.x) * u + Math.sin(Math.PI * u) * 3, y: a.y + (b.y - a.y) * u, id: 1 }]);
        await wait(16);
      }
      if (k < pts.length - 1 && rest) await wait(rest);
    }
    await wait(200);
    await touch('touchEnd', []);
    await wait(150);
  };
  /** two fingers apart or together about the screen's middle, by a factor */
  const pinch = async (factor) => {
    const cx = W / 2;
    const cy = H / 2;
    const d0 = 60;
    const d1 = Math.max(10, Math.min(170, d0 * factor));
    const steps = 10;
    await touch('touchStart', [{ x: cx - d0, y: cy, id: 1 }, { x: cx + d0, y: cy, id: 2 }]);
    for (let i = 1; i <= steps; i++) {
      const d = d0 + ((d1 - d0) * i) / steps;
      await touch('touchMove', [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }]);
      await wait(16);
    }
    await touch('touchEnd', []);
    await wait(150);
  };
  /** one finger pans the map by a screen delta, in strokes a thumb can make (browse mode) */
  const pan = async (dx, dy) => {
    let left = { x: dx, y: dy };
    for (let i = 0; i < 8 && Math.hypot(left.x, left.y) > 4; i++) {
      const k = Math.min(1, 220 / Math.hypot(left.x, left.y));
      const sx = W / 2 - (left.x * k) / 2;
      const sy = H / 2 - (left.y * k) / 2;
      await drag([{ x: sx, y: sy }, { x: sx + left.x * k, y: sy + left.y * k }]);
      left = { x: left.x * (1 - k), y: left.y * (1 - k) };
    }
  };
  const view = () => page.evaluate(() => ({ scale: window.__renderer.scale }));
  const toScreen = (x, y) => page.evaluate(([x, y]) => window.__renderer.project(x, y, 0), [x, y]);
  /** bring two tile points into the free area together: pinch to a scale that fits both, then pan their middle to the centre */
  const frame = async (a, b, minScale = 11, maxScale = 24) => {
    const dx = Math.abs(a.x - b.x) + 6;
    const dy = Math.abs(a.y - b.y) + 6;
    const want = Math.max(minScale, Math.min(maxScale, (W - 40) / dx, (H - 260) / dy));
    for (let i = 0; i < 4; i++) {
      const { scale } = await view();
      const f = want / scale;
      if (Math.abs(Math.log(f)) < 0.08) break;
      await pinch(Math.max(0.4, Math.min(2.6, f)));
    }
    const mid = await toScreen((a.x + b.x) / 2, (a.y + b.y) / 2);
    await pan(W / 2 - mid.x, H / 2 - 20 - mid.y);
  };
  const look = () =>
    page.evaluate(() => {
      const s = window.__sim;
      return { time: s.time, year: s.year, cash: Math.round(s.cash), result: s.result };
    });

  const log = [];
  const waitedOn = new Set();
  let shot = 0;
  const decide = async (kind, what, extra = {}) => {
    const v = await look();
    const entry = { t: Math.round(v.time), year: v.year, cash: v.cash, kind, what, ...extra };
    log.push(entry);
    console.log(`${who.padEnd(8)} ${String(entry.t).padStart(5)} s  ${v.year}  ${String(v.cash).padStart(6)}k  ${kind.padEnd(8)} ${what}`);
    shot++;
    await page.screenshot({ path: join(OUT, `${who}-${String(shot).padStart(3, '0')}-${kind}.png`) });
  };
  const speed = async (i) => {
    await tapSel(`[data-act="speed-${i}"]`);
  };
  const closeCard = async () => {
    if (await page.locator('.card.sheet').count()) await tapSel('.card.sheet [data-act="close"]');
  };
  /** the tool bar back to browsing: a tool that is on is tapped off */
  const toolOff = async () => {
    const on = await page.$eval('.tool.on', (e) => e.dataset.tool).catch(() => null);
    if (on) await tapSel(`[data-tool="${on}"]`);
    await closeCard();
  };

  /** a free tile beside a site toward a point, where track can start or end (what the eye picks on the glass) */
  const spotNear = (siteId, toward) =>
    page.evaluate(
      ([id, toward]) => {
        const s = window.__sim;
        const site = s.sites.find((o) => o.id === id);
        const st = s.stations.find((o) => Math.abs((o.cell % s.w) - site.cx) <= 5 && Math.abs(Math.floor(o.cell / s.w) - site.cy) <= 5);
        if (st) return { x: (st.cell % s.w) + 0.5, y: Math.floor(st.cell / s.w) + 0.5, station: true };
        let best = null;
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            const x = site.cx + dx;
            const y = site.cy + dy;
            const i = y * s.w + x;
            if (x < 1 || y < 1 || x >= s.w - 1 || y >= s.h - 1 || s.blocked[i] || s.water[i] || s.track[i]) continue;
            const near = site.kind === 'town' ? site.homes.filter((h) => Math.abs((h % s.w) - x) <= 2 && Math.abs(Math.floor(h / s.w) - y) <= 2).length >= 4 : Math.max(Math.abs(dx), Math.abs(dy)) <= 3;
            if (!near) continue;
            const d = Math.hypot(x - toward[0], y - toward[1]);
            if (!best || d < best.d) best = { x: x + 0.5, y: y + 0.5, d };
          }
        return best;
      },
      [siteId, toward],
    );
  const siteXY = (id) => page.evaluate((id) => { const o = window.__sim.sites.find((x) => x.id === id); return { x: o.cx + 0.5, y: o.cy + 0.5 }; }, id);

  /** lay track from beside one site to beside another: frame both, Track tool, drag, read the card, choose, build */
  const link = async (step) => {
    const A = await siteXY(step.a);
    const B = await siteXY(step.b);
    const a = await spotNear(step.a, [B.x, B.y]);
    const b = await spotNear(step.b, [A.x, A.y]);
    if (!a || !b) return decide('skip', `no free tile by ${step.a} or ${step.b}`);
    await frame(a, b);
    await tapSel('[data-tool="track"]');
    await think();
    const pa = await toScreen(a.x, a.y);
    const pb = await toScreen(b.x, b.y);
    await drag([pa, pb]);
    await think(500);
    if (!(await page.locator('[data-card="plan"]').count())) {
      await decide('skip', `no route ${step.a} to ${step.b}`);
      await toolOff();
      return;
    }
    const opts = await page.$$eval('[data-card="plan"] .seg button', (bs) => bs.map((b) => ({ act: b.dataset.act, text: b.textContent })));
    let pick = 'cheap';
    if (opts.length > 1) {
      const cheap = opts.find((o) => o.act === 'option-cheap');
      const grade = Number((cheap?.text.match(/([\d.]+) %/) || [])[1] || 0);
      pick = step.level === 'yes' || (step.level === 'if-steep' && grade >= 3) ? 'level' : 'cheap';
      await decide('tradeoff', `route ${step.a} to ${step.b}: ${opts.map((o) => o.text.replace(/\s+/g, ' ')).join(' or ')}; took ${pick}`, { options: opts.map((o) => o.text) });
      if (pick === 'level') await tapSel('[data-act="option-level"]');
      await think(400);
    }
    if (await page.locator('[data-card="plan"] [data-act="build"]').isDisabled()) {
      if (who === 'careful') {
        if (!waitedOn.has(step)) await decide('wait', `track ${step.a} to ${step.b} costs more than the cash: wait`);
        waitedOn.add(step);
        await tapSel('[data-card="plan"] [data-act="cancel"]');
        await toolOff();
        return 'cash';
      }
      await tapSel('[data-card="plan"] [data-act="bond"]');
      await decide('borrow', 'a bond from the track card');
    }
    const f2 = await page.$$eval('[data-card="plan"] .facts > div b', (bs) => bs.map((b) => b.textContent));
    await tapSel('[data-card="plan"] [data-act="build"]');
    await decide('track', `${step.a} to ${step.b}: ${f2[0]}, steepest ${f2[1]}, ${f2[2]} bridge tiles`);
    await toolOff();
  };

  /** a station by a site: the Station tool, the square dragged onto the track there, a size, Build */
  const station = async (step) => {
    const site = await siteXY(step.at);
    const target = await page.evaluate((site) => {
      const s = window.__sim;
      let best = null;
      for (let i = 0; i < s.track.length; i++) {
        if (!s.track[i]) continue;
        const x = i % s.w;
        const y = Math.floor(i / s.w);
        const d = Math.hypot(x + 0.5 - site.x, y + 0.5 - site.y);
        if (d > 6) continue;
        const links = [0, 1, 2, 3, 4, 5, 6, 7].filter((k) => s.track[i] & (1 << k)).length;
        const score = d - (links === 1 ? 1.5 : 0);
        if (!best || score < best.score) best = { x: x + 0.5, y: y + 0.5, score };
      }
      return best;
    }, site);
    if (!target) return decide('skip', `no track by ${step.at}`);
    if (await page.evaluate((t) => window.__sim.stations.some((o) => Math.abs((o.cell % window.__sim.w) + 0.5 - t.x) < 4 && Math.abs(Math.floor(o.cell / window.__sim.w) + 0.5 - t.y) < 4), target)) return;
    await frame(target, target, 20, 26);
    await tapSel('[data-tool="station"]');
    await think();
    const p = await toScreen(target.x, target.y);
    await drag([{ x: p.x + 40, y: p.y - 60 }, p]);
    await think(400);
    if (!(await page.locator('[data-card="spot"]').count())) {
      await toolOff();
      return decide('skip', `no station card at ${step.at}`);
    }
    await tapSel(`[data-act="size-${step.size}"]`);
    await think(300);
    const sizes = await page.$$eval('[data-card="spot"] .seg button', (bs) => bs.map((b) => b.textContent));
    const gathers = await page.$$eval('[data-card="spot"] .lines > div', (rows) =>
      rows.map((r) => `${r.querySelector('small').textContent.toLowerCase()} ${[...r.querySelectorAll('.cg')].map((c) => `${c.querySelector('use').getAttribute('href').slice(3)} ${c.textContent.trim()}`.trim()).join(', ') || 'nothing'}`).join('; '),
    );
    if (await page.locator('[data-card="spot"] [data-act="build"]').isDisabled()) {
      const warn = await page.locator('[data-card="spot"] .warn').textContent().catch(() => '');
      if (!warn && who === 'careless' && (await page.locator('[data-card="spot"] [data-act="bond"]').count())) {
        await tapSel('[data-card="spot"] [data-act="bond"]');
        await decide('borrow', 'a bond from the station card');
      } else {
        if (!waitedOn.has(step)) await decide(warn ? 'skip' : 'wait', `station at ${step.at} not built: ${warn || 'not enough cash'}`);
        waitedOn.add(step);
        await toolOff();
        return warn ? undefined : 'cash';
      }
    }
    await tapSel('[data-card="spot"] [data-act="build"]');
    await decide(step.size ? 'tradeoff' : 'station', `station at ${step.at}, ${['small', 'medium', 'large'][step.size]} (${sizes[step.size]}): ${gathers}`);
    await toolOff();
  };

  /** a train: the Train tool, the stops tapped on the map, the cars, the locomotive, Buy */
  const train = async (step) => {
    const cells = await page.evaluate((ids) => {
      const s = window.__sim;
      return ids.map((id) => {
        const site = s.sites.find((o) => o.id === id);
        let best = null;
        for (const st of s.stations) {
          const d = Math.hypot((st.cell % s.w) - site.cx, Math.floor(st.cell / s.w) - site.cy);
          if (d < 7 && (!best || d < best.d)) best = { x: (st.cell % s.w) + 0.5, y: Math.floor(st.cell / s.w) + 0.5, d };
        }
        return best;
      });
    }, step.stops);
    if (cells.some((c) => !c)) return decide('skip', `train ${step.stops.join('>')}: a stop has no station`);
    const xs = cells.map((c) => c.x);
    const ys = cells.map((c) => c.y);
    await frame({ x: Math.min(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.max(...ys) });
    await tapSel('[data-tool="route"]');
    await think();
    for (const c of cells) {
      const p = await toScreen(c.x, c.y);
      await tap(p.x, p.y);
      await think(300);
    }
    const n = await page.$$eval('[data-card="route"] .stop-chip', (e) => e.length);
    if (n < cells.length) await decide('note', `only ${n} of ${cells.length} stops took the tap`);
    if (!(await tapSel('[data-act="next"]'))) {
      await decide('skip', `train ${step.stops.join(' > ')}: the stops did not take`);
      await toolOff();
      return;
    }
    await think(400);
    if (step.cars) {
      for (let k = 0; k < step.cars.length; k++) {
        for (let g = 0; g < 10 && (await page.locator(`[data-act="car-${k}-0"]`).count()); g++) await tapSel(`[data-act="car-${k}-0"]`);
        for (const c of step.cars[k]) {
          await tapSel(`[data-act="add-car-${k}"]`);
          await tapSel(`[data-act="pick-${c}"]`);
          await tapSel(`[data-act="add-car-${k}"]`);
        }
      }
    }
    await tapSel(`[data-act="loco-${step.loco}"]`);
    await think(500);
    const est = await page.$$eval('[data-card="route"] .facts > div b', (bs) => bs.map((b) => b.textContent));
    const consist = await page.$$eval('[data-card="route"] .stop', (rows) => rows.map((r) => `${r.querySelector('.nm').textContent} ${r.querySelectorAll('.car:not(.add)').length}`).join(', '));
    if (await page.locator('[data-card="route"] [data-act="buy"]').isDisabled()) {
      if (!waitedOn.has(step)) await decide('wait', `train ${step.stops.join(' > ')} with ${step.loco}: not now (${est.join(', ') || 'stops missing'})`);
      waitedOn.add(step);
      await toolOff();
      return 'cash';
    }
    await tapSel('[data-card="route"] [data-act="buy"]');
    await decide('train', `${step.loco} on ${step.stops.join(' > ')}, cars ${consist}; a round ${est[0]}, a full round pays ${est[2]}`);
    await toolOff();
  };

  const bond = async (step) => {
    await tapSel('[data-act="money"]');
    await think(700);
    let n = 0;
    for (let k = 0; k < step.n; k++) if (await tapSel('[data-act="issue"]')) n++;
    await decide('borrow', `${n} bonds: ${step.why}`);
    await closeCard();
  };

  /** a look at the trains and the money: worn locomotives replaced, a bond paid back when the cash allows */
  const upkeep = async () => {
    const worn = await page.evaluate(() => {
      const s = window.__sim;
      return s.trains.filter((t) => Math.max(0.3, { hilma: 0.82, jyry: 0.9, ukko: 0.86, karhu: 0.92 }[t.loco] - 0.035 * (s.year + s.yearFrac - t.built)) < 0.66).map((t) => t.id);
    });
    for (const id of worn) {
      await tapSel('[data-tool="trains"]');
      await think(400);
      await tapSel(`[data-act="train-${id}"]`);
      await think(600);
      const rel = await page.locator('[data-card="train"] .facts > div:nth-child(4) b').textContent().catch(() => '?');
      await tapSel('[data-act="replace"]');
      const ok = (await tapSel('[data-act="replace-karhu"]')) || (await tapSel('[data-act="replace-jyry"]'));
      await decide('tradeoff', `train ${id} at ${rel} reliability: ${ok ? 'a new locomotive' : 'keep it, the cash is short'}`);
      await closeCard();
    }
    await tapSel('[data-act="money"]');
    await think(600);
    const cash = await page.evaluate(() => window.__sim.cash);
    const bonds = await page.evaluate(() => window.__sim.bonds.length);
    if (bonds && cash > 160) {
      await tapSel('[data-act="repay"]');
      await decide('tradeoff', `cash ${Math.round(cash)}k: repay a bond and stop its interest`);
    } else await decide('look', `the money: cash ${Math.round(cash)}k, ${bonds} bonds`);
    await closeCard();
  };

  await page.goto(`http://localhost:${port}/raide/?speed=${PACE}&lang=en`);
  await wait(800);
  await tapSel(`[data-scenario="${SCENARIO}"]`);
  await page.waitForFunction(() => window.__sim, null, { timeout: 15000 });
  await wait(1000);
  await speed(0);
  await decide('start', `the ${who} player opens ${SCENARIO}`);
  await pinch(0.3);
  await think(1200);
  await decide('look', 'the whole map: where the forests, the mills and the towns are');
  await pinch(2.6);

  const plan = PLAYS[SCENARIO][who];
  let k = 0;
  let lastCare = 0;
  const waited = {};
  for (let guard = 0; guard < 400; guard++) {
    const v = await look();
    if (v.result) break;
    if (k < plan.length) {
      await speed(0);
      const step = plan[k];
      const r = step.do === 'link' ? await link(step) : step.do === 'station' ? await station(step) : step.do === 'train' ? await train(step) : await bond(step);
      if (r === 'cash') {
        // short of cash: let the clock run a month or two and try again; after two years of waiting the step is dropped
        waited[k] = (waited[k] ?? 0) + 1;
        if (waited[k] > 16) {
          await decide('skip', `gave up on step ${k + 1} (${step.do} ${step.a ?? step.at ?? step.stops?.join('>') ?? ''}) after two years short of cash`);
          k++;
          continue;
        }
        if (who === 'careful' && waited[k] % 8 === 0) await upkeep();
        await speed(2);
        const t0 = (await look()).time;
        await page.waitForFunction((t) => window.__sim.time > t + 30 || window.__sim.result, t0, { timeout: 180000 });
        continue;
      }
      k++;
      await speed(1);
      continue;
    }
    await speed(2);
    const t0 = (await look()).time;
    await page.waitForFunction((t) => window.__sim.time > t + 60 || window.__sim.result, t0, { timeout: 180000 });
    if (who === 'careful' && v.time - lastCare > 200) {
      lastCare = v.time;
      await speed(0);
      await upkeep();
    }
  }
  await wait(1500);
  const end = await page.evaluate(() => {
    const s = window.__sim;
    return { result: s.result, history: s.history.map((y) => ({ year: y.year, revenue: Math.round(y.revenue), costs: Math.round(y.fuel + y.upkeep + y.repairs + y.interest), profit: Math.round(y.profit), cash: Math.round(y.cash), debt: Math.round(y.debt), worth: Math.round(y.worth) })), trains: s.trains.length, breakdowns: s.trains.reduce((n, t) => n + t.breakdowns, 0) };
  });
  if (!end.result) end.result = { won: false, tier: 0, reason: 'unfinished', year: 0, worth: 0 };
  await decide('end', `${end.result.won ? 'WON' : 'LOST'} tier ${end.result.tier}, ${end.result.reason} ${end.result.year}, worth ${Math.round(end.result.worth)}k`);
  results[who] = end;
  allLogs[who] = { log, errors };
  await context.close();
  for (const f of readdirSync(join(OUT, 'tmp'))) renameSync(join(OUT, 'tmp', f), join(OUT, `${SCENARIO}-${who}.webm`));
  rmSync(join(OUT, 'tmp'), { recursive: true, force: true });
}
await browser.close();
server.kill();

const md = [`# Human-like run: ${SCENARIO}`, '', `Pace ${PACE}x, iPhone 16 portrait, every input a touch.`, ''];
for (const who of Object.keys(allLogs)) {
  const r = results[who];
  md.push(`## The ${who} player`, '', `Result: **${r.result.won ? 'won' : 'lost'}**, tier ${r.result.tier}, ${r.result.reason} in ${r.result.year}, worth ${Math.round(r.result.worth)}k. ${r.trains} trains, ${r.breakdowns} breakdowns.`, '');
  md.push('| game s | year | cash | kind | decision |', '|---:|---:|---:|---|---|');
  for (const e of allLogs[who].log) md.push(`| ${e.t} | ${e.year} | ${e.cash} | ${e.kind} | ${e.what.replace(/\|/g, '/')} |`);
  md.push('', '| year | revenue | costs | profit | cash | debt | worth |', '|---:|---:|---:|---:|---:|---:|---:|');
  for (const y of r.history) md.push(`| ${y.year} | ${y.revenue} | ${y.costs} | ${y.profit} | ${y.cash} | ${y.debt} | ${y.worth} |`);
  if (allLogs[who].errors.length) md.push('', 'Page errors:', ...allLogs[who].errors.map((e) => `- ${e}`));
  md.push('');
}
const pass = (!results.careful || results.careful.result.won) && (!results.careless || !results.careless.result.won);
md.push(`Verdict: ${pass ? 'PASS' : 'FAIL'} (the careful player must win, the careless player must lose).`);
writeFileSync(join(OUT, 'log.md'), md.join('\n'));
writeFileSync(join(OUT, 'log.json'), JSON.stringify({ results, logs: allLogs }, null, 1));
console.log(md[md.length - 1]);
if (!pass || Object.values(allLogs).some((l) => l.errors.length)) process.exit(1);
