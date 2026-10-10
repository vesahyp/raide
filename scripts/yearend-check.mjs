// The year end must never close or replace what the player is doing. On an emulated iPhone 16,
// by real touches, on Harju: Kuusikko to Koskensaha is built and the log train runs it. Then the
// clock runs to two seconds before a year end and the player starts the Koskensaha to Tampere
// track three ways: (a) a drag held across the year end, (b) a drag lifted just before it, so
// the card after the lift is open when the year ends, (c) the site card's "Lay track from here"
// pick mode across the year end. In each case the ledger must wait (a small pill says so) and
// open when the player closes their card or lifts the finger. And the log train must never be
// sent on to Tampere, where its wagons have nothing to do, by a lengthening the player did not
// choose. `make yearend-check` (PORT=5187 when another repo's dev server holds the default).
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const port = Number(process.env.PORT) || 5199;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch();
mkdirSync('shots/yearend', { recursive: true });
let failed = false;
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed = true;
};

// a fresh game in its own page: the log line built and the log train bought
async function fresh(orient = 'portrait') {
  const phone = devices['iPhone 16'];
  const viewport = orient === 'portrait' ? phone.viewport : { width: phone.viewport.height, height: phone.viewport.width };
  const context = await browser.newContext({ ...phone, viewport, hasTouch: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tap = async (x, y) => {
    await touch('touchStart', [{ x, y, id: 1 }]);
    await page.waitForTimeout(60);
    await touch('touchEnd', []);
  };
  const tapButton = async (locator) => {
    await locator.waitFor({ timeout: 4000 });
    let b = await locator.boundingBox();
    for (let k = 0; k < 20; k++) {
      await page.waitForTimeout(50);
      const n = await locator.boundingBox();
      if (n && b && Math.abs(n.x - b.x) < 0.5 && Math.abs(n.y - b.y) < 0.5) break;
      b = n;
    }
    await tap(b.x + b.width / 2, b.y + b.height / 2);
  };
  const pos = () =>
    page.evaluate(() => {
      const s = window.__sim;
      const out = {};
      for (const site of s.sites) out[site.id] = window.__renderer.project(site.cx + 0.5, site.cy + 0.5, 2);
      return out;
    });
  const move = async (a, b, steps, ms) => {
    for (let i = 1; i <= steps; i++) {
      await page.waitForTimeout(ms);
      await touch('touchMove', [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps, id: 1 }]);
    }
  };
  // the card or mode open now, and what the sim looks like
  const state = () =>
    page.evaluate(() => {
      const s = window.__sim;
      const cards = [...document.querySelectorAll('.card')].map((c) => (c.classList.contains('ledger') ? 'ledger' : c.classList.contains('choice-card') ? 'choice' : c.classList.contains('train-card') ? 'train' : c.classList.contains('site-card') ? 'site' : c.classList.contains('buy-card') ? 'line' : c.classList.contains('money-card') ? 'money' : c.classList.contains('goal-card') ? 'goal' : c.className));
      const name = (id) => s.sites.find((x) => x.id === s.stations.find((st) => st.id === id)?.siteId)?.id;
      return {
        cards,
        drag: !!window.__input.drag,
        pick: !!document.querySelector('.pick-banner'),
        pill: !!document.querySelector('[data-sec="yearend-pill"]'),
        yearEnd: !!s.yearEnd,
        year: s.year,
        frac: Math.round(s.yearFrac * 1000) / 1000,
        lines: s.lines.map((l) => l.stops.map(name).join('>')),
        trainStops: s.trains.map((t) => s.lines.find((l) => l.id === t.lineId)?.stops.map(name).join('>')),
      };
    });
  await page.goto(`http://localhost:${port}/?lang=en`);
  await tapButton(page.locator('[data-scenario="harju"]'));
  await page.waitForFunction(() => window.__sim && window.__renderer, null, { timeout: 10000 });
  await page.waitForTimeout(400);
  // the camera shows Kuusikko to Tampere at once
  await page.evaluate(([w, h]) => { const r = window.__renderer; r.follow(null); (w < h ? r.setView(25, 51, Math.min(w / 26, (h - 230) / 43)) : r.setView(25.5, 32, 15)); }, [viewport.width, viewport.height]);
  await page.waitForTimeout(300);
  // Harju starts with a station at Korpela: the first line (Korpela to Kuusikko) is laid by the game's own move, the rest by touch
  await page.evaluate(() => {
    const s = window.__sim;
    const cell = (id) => { const o = s.sites.find((x) => x.id === id); return o.cy * s.w + o.cx; };
    window.__act.build(window.__act.plan(cell('korpela'), cell('forest'))[0]);
  });
  await page.waitForTimeout(900);
  await page.evaluate(([w, h]) => { const r = window.__renderer; r.follow(null); (w < h ? r.setView(25, 51, Math.min(w / 26, (h - 230) / 43)) : r.setView(25.5, 32, 15)); }, [viewport.width, viewport.height]);
  await page.waitForTimeout(400);
  let p = await pos();
  await touch('touchStart', [{ x: p.forest.x, y: p.forest.y, id: 1 }]);
  await move(p.forest, p.sawmill, 12, 25);
  await page.waitForTimeout(100);
  await touch('touchEnd', []);
  await page.waitForTimeout(300);
  // Kuusikko ends the Korpela line, so the lift may ask: take the new line
  if ((await page.locator('.choice-card').count()) > 0) await tapButton(page.locator('[data-group-route="new"], [data-group-route="way"]').first());
  // the lift builds nothing: the drawn route waits for Build
  await tapButton(page.locator('[data-act="plan-build"]'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/yearend/setup.png' });
  await tapButton(page.locator('[data-track="card-buy-train"]'));
  await page.waitForTimeout(300);
  const st = await state();
  if (st.cards.length) await tapButton(page.locator('.card .round.close')).catch(() => undefined);
  await page.waitForTimeout(200);
  // the view eased to the route while it waited for Build: back to the one the checks aim from
  await page.evaluate(([w, h]) => { const r = window.__renderer; r.follow(null); (w < h ? r.setView(25, 51, Math.min(w / 26, (h - 230) / 43)) : r.setView(25.5, 32, 15)); }, [viewport.width, viewport.height]);
  await page.waitForTimeout(500);
  return { page, context, touch, tap, tapButton, pos, move, state };
}

// seconds before the year end, on the sim's own clock
const nearYearEnd = (page, seconds) => page.evaluate((sec) => { window.__sim.yearFrac = 1 - sec / 90; }, seconds);
const closeCard = async (g) => {
  const close = g.page.locator('.card .round.close, [data-act="plan-cancel"]').first();
  if ((await close.count()) > 0) await g.tapButton(close);
};

try {
  // (a) the drag is held across the year end
  {
    const g = await fresh();
    const p = await g.pos();
    const base = await g.state();
    check(base.lines.length === 2 && base.trainStops[0] === 'forest>sawmill', `setup: the Korpela line, the log line and one train (${base.lines.join(' ')})`);
    await nearYearEnd(g.page, 2);
    await g.touch('touchStart', [{ x: p.sawmill.x, y: p.sawmill.y, id: 1 }]);
    await g.move(p.sawmill, { x: p.tampere.x, y: p.tampere.y - 30 }, 20, 100);
    const before = await g.state();
    await g.page.waitForTimeout(1500);
    await g.move({ x: p.tampere.x, y: p.tampere.y - 30 }, p.tampere, 6, 60);
    const held = await g.state();
    console.log('  (a) held across the year end:', JSON.stringify({ before: before.cards, held }));
    check(held.yearEnd && held.drag && !held.cards.includes('ledger'), '(a) the held drag stays and no ledger covers it');
    check(held.pill, '(a) the "Year ended" pill shows while the drag is held');
    await g.page.screenshot({ path: 'shots/yearend/a-held.png' });
    await g.touch('touchEnd', []);
    await g.page.waitForTimeout(500);
    const lifted = await g.state();
    console.log('  (a) after the lift:', JSON.stringify(lifted));
    check(!lifted.cards.includes('ledger') && lifted.cards.length > 0, '(a) after the lift the build card is open and the ledger still waits');
    check(lifted.trainStops[0] === 'forest>sawmill', `(a) the log train still runs forest>sawmill (${lifted.trainStops})`);
    await g.page.screenshot({ path: 'shots/yearend/a-lifted.png' });
    // the choice offers no lengthening: the log wagons have nothing at Tampere
    const extendOffered = await g.page.locator('[data-group^="extend"]').count();
    check(extendOffered === 0, `(a) the card does not offer to lengthen the log line to Tampere (${extendOffered} groups)`);
    await closeCard(g);
    await g.page.waitForTimeout(500);
    const closed = await g.state();
    check(closed.cards.includes('ledger'), `(a) the ledger opens when the card closes (${closed.cards})`);
    await g.context.close();
  }
  // (b) the drag is lifted just before the year end; the card after the lift is open when it comes
  {
    const g = await fresh();
    const p = await g.pos();
    await nearYearEnd(g.page, 4);
    await g.touch('touchStart', [{ x: p.sawmill.x, y: p.sawmill.y, id: 1 }]);
    await g.move(p.sawmill, p.tampere, 12, 40);
    await g.page.waitForTimeout(100);
    await g.touch('touchEnd', []);
    await g.page.waitForTimeout(400);
    let s1 = await g.state();
    console.log('  (b) after the lift:', JSON.stringify(s1));
    // the log wagons have nothing at Tampere: the card never offers to lengthen the log line there, and a new line is the way
    check((await g.page.locator('[data-group^="extend"]').count()) === 0, '(b) a drag from the end of the log line does not offer to lengthen it to Tampere');
    if (s1.cards.includes('choice')) {
      const way = g.page.locator('[data-group-route="new"], [data-group-route="way"]').first();
      await g.tapButton(way);
      await g.page.waitForTimeout(300);
      await g.tapButton(g.page.locator('[data-act="plan-build"]'));
      await g.page.waitForTimeout(400);
    }
    s1 = await g.state();
    check(s1.cards.includes('line'), `(b) the line card is open after the build (${s1.cards})`);
    await nearYearEnd(g.page, 0.5);
    await g.page.waitForTimeout(2500);
    const s2 = await g.state();
    console.log('  (b) after the year end:', JSON.stringify(s2));
    check(s2.yearEnd && s2.cards.includes('line') && !s2.cards.includes('ledger'), `(b) the line card stays open at the year end (${s2.cards})`);
    check(s2.pill, '(b) the pill shows over the open line card');
    await g.page.screenshot({ path: 'shots/yearend/b-pill-portrait.png' });
    check(s2.trainStops[0] === 'forest>sawmill', `(b) the log train still runs forest>sawmill (${s2.trainStops})`);
    await closeCard(g);
    await g.page.waitForTimeout(500);
    check((await g.state()).cards.includes('ledger'), '(b) the ledger opens when the line card closes');
    await g.context.close();
  }
  // (c) the site card's pick mode across the year end
  {
    const g = await fresh();
    const p = await g.pos();
    await g.tap(p.sawmill.x, p.sawmill.y);
    await g.page.locator('[data-act="lay"]').waitFor({ timeout: 3000 });
    await g.tapButton(g.page.locator('[data-act="lay"]'));
    await g.page.waitForTimeout(400);
    const picking = await g.state();
    check(picking.pick, `(c) pick mode is on (${picking.pick})`);
    await nearYearEnd(g.page, 1.5);
    await g.page.waitForTimeout(3000);
    const across = await g.state();
    console.log('  (c) pick mode across the year end:', JSON.stringify(across));
    check(across.yearEnd && across.pick && !across.cards.includes('ledger'), '(c) pick mode survives the year end and no ledger covers it');
    check(across.pill, '(c) the pill shows during pick mode');
    // pick mode eased the view to the marked sites: read where Tampere is now
    await g.page.waitForFunction(() => window.__renderer.zoomTo === null, null, { timeout: 10000 });
    const q = await g.pos();
    await g.tap(q.tampere.x, q.tampere.y);
    await g.page.waitForTimeout(500);
    const tapped = await g.state();
    console.log('  (c) after the tap:', JSON.stringify(tapped));
    check(!tapped.cards.includes('ledger') && tapped.cards.length > 0, `(c) the tap offers the build and the ledger waits (${tapped.cards})`);
    check(tapped.trainStops[0] === 'forest>sawmill', `(c) the log train still runs forest>sawmill (${tapped.trainStops})`);
    await g.context.close();
  }
  // (d) landscape: the pill over an open line card
  {
    const g = await fresh('landscape');
    const spot = await g.page.evaluate(() => {
      const s = window.__sim;
      const line = s.lines.find((l) => l.stops.length === 2 && s.trains.some((t) => t.lineId === l.id));
      const c = line.path[Math.floor(line.path.length / 2)];
      return window.__renderer.project((c % s.w) + 0.5, Math.floor(c / s.w) + 0.5, 2);
    });
    await g.tap(spot.x, spot.y);
    await g.page.waitForTimeout(400);
    await nearYearEnd(g.page, 0.5);
    await g.page.waitForTimeout(1500);
    const st = await g.state();
    check((st.cards.includes('line') || st.cards.includes('train')) && st.yearEnd && st.pill && !st.cards.includes('ledger'), `(d) landscape: the pill shows over the open card (${st.cards})`);
    const box = await g.page.locator('[data-sec="yearend-pill"]').boundingBox();
    const sheet = await g.page.locator('.card.sheet').first().boundingBox();
    check(!!box && !!sheet && (box.y + box.height <= sheet.y || box.x + box.width <= sheet.x || box.x >= sheet.x + sheet.width), '(d) the pill does not sit on the line card');
    await g.page.screenshot({ path: 'shots/yearend/b-pill-landscape.png' });
    await g.context.close();
  }
} catch (e) {
  check(false, String(e).split('\n')[0] + ' ' + (String(e.stack).match(/yearend-check\.mjs:\d+/) || ''));
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? 'yearend-check failed' : 'yearend-check ok');
process.exitCode = failed ? 1 : 0;
