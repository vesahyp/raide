// The train orders by touch on an emulated iPhone 16 in portrait: build Kuusikko to Koskensaha to
// Hämeenlinna with two drags, buy a train, open its card, tap Koskensaha to pass through and check
// by the sim that the train runs past it without stopping, tap it back and check it stops again.
// Pictures into shots/orders/ in portrait and landscape: the card's Orders with Koskensaha passed
// through, and the followed train on the map with its stop pills and the struck ring.
// `make orders-check` (builds first). It fails when a middle row is under 44 px tall, an end is
// tappable, the train stops at a station it was told to pass, or does not stop once told to.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

const OUT = 'shots/orders';
const freePort = () => new Promise((resolve) => { const srv = createServer(); srv.listen(0, () => { const p = srv.address().port; srv.close(() => resolve(p)); }); });
const port = await freePort();
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; ; i++) {
  const up = await fetch(`http://localhost:${port}/raide/`).then((r) => r.ok, () => false);
  if (up) break;
  if (i > 60) throw new Error('no preview server');
  await new Promise((r) => setTimeout(r, 500));
}
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const errors = [];
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) errors.push(what);
};
try {
  for (const [orient, device] of [['portrait', 'iPhone 16'], ['landscape', 'iPhone 16 landscape']].filter(([o]) => !process.env.ORIENT || o === process.env.ORIENT)) {
    const ctx = await browser.newContext({ ...devices[device], hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${orient}: ${e}`));
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    const shot = (name) => page.screenshot({ path: `${OUT}/${name}-${orient}.png` });
    const at = (id) => page.evaluate((id) => { const o = window.__sim.sites.find((x) => x.id === id); return window.__renderer.project(o.cx + 0.5, o.cy + 0.5, 1); }, id);
    const between = async (a, b, scale) => {
      await page.evaluate(([a, b, scale]) => {
        const r = window.__renderer; const f = (id) => window.__sim.sites.find((x) => x.id === id);
        r.follow(null); r.setScale(scale); r.cam.x = (f(a).cx + f(b).cx) / 2 + 0.5; r.cam.y = (f(a).cy + f(b).cy) / 2 + 0.5; r.clampCam?.();
      }, [a, b, scale]);
      await page.waitForTimeout(700);
    };
    const onScreen = (p) => page.evaluate((p) => { const a = window.__renderer.area(); return p.x > a.l + 60 && p.x < a.l + a.w - 60 && p.y > a.t + 60 && p.y < a.t + a.h - 60; }, p);
    const drag = async (from, to) => {
      const a = await at(from);
      await touch('touchStart', [{ x: a.x, y: a.y, id: 1 }]);
      let p = a;
      for (let i = 0; i < 80; i++) {
        const b = await at(to);
        p = { x: p.x + (b.x - p.x) * 0.25, y: p.y + (b.y - p.y) * 0.25 };
        await touch('touchMove', [{ x: p.x, y: p.y, id: 1 }]);
        await page.waitForTimeout(50);
        if (Math.hypot(b.x - p.x, b.y - p.y) < 6 && (await onScreen(b))) break;
      }
      await page.waitForTimeout(400);
      await touch('touchEnd', []);
      await page.waitForTimeout(600);
    };
    const closeCards = async () => { while (await page.locator('.round.close').count()) { await page.locator('.round.close').first().tap(); await page.waitForTimeout(250); } };
    const train = () => page.evaluate(() => { const t = window.__sim.trains[0]; return { id: t.id, state: t.state, at: t.at, idx: t.idx, to: t.to, dir: t.dir, skip: t.skip.slice(), time: window.__sim.time }; });
    const until = async (fn, arg, what, ms = 120000) => {
      if (arg === undefined) arg = null;
      try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 25 }); return true; } catch { check(false, `${orient}: ${what}`); return false; }
    };
    await page.goto(`http://localhost:${port}/raide/?lang=en&speed=3`);
    await page.locator('[data-scenario="harju"]').tap();
    await page.waitForFunction(() => window.__sim, null, { timeout: 10000 });
    await page.waitForTimeout(1000);
    await page.evaluate(() => { window.__sim.cash = 9999; });
    // a year end opens the ledger and holds the sim: this check is not about the ledger, so it is closed at once
    await page.evaluate(() => setInterval(() => { document.querySelector('.card.ledger .btn.choice.continue, .card.ledger [data-act="skip"]')?.click(); }, 250));

    // the line Kuusikko, Koskensaha with a train, then lengthened to Hämeenlinna: a lengthening is offered
    // only when a train on the line carries something at the new stop, so the train gets a box wagon first
    await between('forest', 'sawmill', 13);
    await drag('forest', 'sawmill');
    await page.locator('[data-act="plan-build"]').tap();
    await page.waitForTimeout(500);
    await page.locator('[data-track="card-buy-train"]').tap();
    await page.waitForTimeout(500);
    check((await page.evaluate(() => window.__sim.trains.length)) === 1, `${orient}: the first train is bought`);
    const first = await page.evaluate(() => { const t = window.__sim.trains[0]; window.__renderer.setScale(23); window.__renderer.follow(t); return t.id; });
    await page.waitForTimeout(1500);
    const vp0 = await page.evaluate((id) => { const v = window.__renderer.vehicles(window.__sim.trains.find((t) => t.id === id))[0]; return { x: v.px, y: v.py }; }, first);
    await page.touchscreen.tap(vp0.x, vp0.y);
    await page.waitForTimeout(600);
    await page.locator('.train-card [data-add="box"]').tap();
    await page.waitForTimeout(300);
    await closeCards();
    await between('sawmill', 'hameenlinna', 9.5);
    await drag('sawmill', 'hameenlinna');
    await page.locator('.choice-card [data-group^="extend-"] [data-route]').first().tap();
    await page.locator('[data-act="plan-build"]').tap();
    await page.waitForTimeout(600);
    await closeCards();
    check(await page.evaluate(() => window.__sim.lines.length === 1 && window.__sim.lines[0].stops.length === 3), `${orient}: the drags make one line of three stops, Kuusikko, Koskensaha, Hämeenlinna`);
    const ids = await page.evaluate(() => { const l = window.__sim.lines[0]; return { mid: l.stops[1], first: l.stops[0], last: l.stops[2], midCell: l.path[l.stopAt[1]] }; });

    // open the train card by a tap on the train
    const tid = await page.evaluate(() => { const t = window.__sim.trains[0]; window.__renderer.setScale(23); window.__renderer.follow(t); return t.id; });
    await page.waitForTimeout(1500);
    const vp = await page.evaluate((id) => { const v = window.__renderer.vehicles(window.__sim.trains.find((t) => t.id === id))[0]; return { x: v.px, y: v.py }; }, tid);
    await page.touchscreen.tap(vp.x, vp.y);
    await page.waitForTimeout(600);
    check((await page.locator('.train-card').count()) === 1, `${orient}: a tap on the train opens its card`);
    const rows = page.locator('.train-card [data-sec="orders"] .ord');
    check((await rows.count()) === 3, `${orient}: the Orders strip lists the three stations`);
    check((await page.locator('.train-card .ord.turns').count()) === 2 && (await page.locator('.train-card .ord.stops').count()) === 1, `${orient}: both ends say "turns here" and Koskensaha stops`);
    const midBtn = page.locator(`.train-card [data-order-station="${ids.mid}"]`);
    const box = await midBtn.boundingBox();
    check(!!box && box.height >= 44 && box.width >= 200, `${orient}: the Koskensaha row is a big tap target (${box && Math.round(box.width)} by ${box && Math.round(box.height)} px)`);
    check((await page.locator(`.train-card [data-order-station="${ids.first}"], .train-card [data-order-station="${ids.last}"]`).count()) === 0, `${orient}: the ends are not tappable`);
    check((await page.locator('.train-card .ord.stops [data-work]').count()) > 0, `${orient}: the stopping station says what the train loads or unloads`);
    await shot('orders-stops');

    // one tap: Koskensaha is passed through
    await midBtn.scrollIntoViewIfNeeded();
    await midBtn.tap();
    await page.waitForTimeout(400);
    let t = await train();
    check(t.skip.join() === `${ids.mid}`, `${orient}: one tap sets Koskensaha to pass through (skip ${t.skip.join()})`);
    check((await page.locator('.train-card .ord.passes').count()) === 1 && (await page.locator('.train-card .ord.passes .ord-name').evaluate((e) => getComputedStyle(e).textDecorationLine)) === 'line-through', `${orient}: the row shows the struck name`);
    await page.evaluate(() => { const c = document.querySelector('.train-card'); const o = document.querySelector('[data-sec="orders"]'); if (c && o) c.scrollTop = o.offsetTop - 70; });
    await page.waitForTimeout(300);
    await shot('orders-passes');
    await closeCards();

    // the followed train on the map: the pills on the stops, the struck ring on Koskensaha, the express tag
    await page.evaluate(() => { const r = window.__renderer; r.setScale(23); r.follow(window.__sim.trains[0]); });
    await page.waitForTimeout(1200);
    check((await page.locator('.order-mark').count()) === 3, `${orient}: the followed train has a mark for each of the three stations`);
    check((await page.locator('.order-mark.skip').count()) === 1, `${orient}: one of them is the struck ring`);
    check((await page.locator('.express-tag').evaluateAll((els) => els.filter((e) => e.style.display !== 'none').length)) === 1, `${orient}: the train wears the express tag`);
    // the picture: the followed train a few tiles before Koskensaha, play zoom, its marks on the stations
    await until((mid) => { const s = window.__sim; const t = s.trains[0]; const l = s.lines[0]; const d = Math.abs(t.s - l.dist[l.stopAt[1]]); return t.state === 'run' && d < 6 && d > 3; }, null, 'the train comes near Koskensaha');
    await page.waitForTimeout(150);
    await shot('map-marks');
    // the train runs past Koskensaha without stopping, in both directions
    await page.evaluate(() => window.__renderer.follow(window.__sim.trains[0]));
    const seen = { spans: new Set(), stoppedAfter: 0 };
    let counting = false;
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline && seen.spans.size < 2) {
      t = await train();
      if (process.env.TRACE && Math.round(Date.now() / 1000) % 5 === 0) console.log(JSON.stringify(t));
      if (t.state === 'run' && Math.abs(t.idx - t.to) === 2) {
        counting = true;
        seen.spans.add(t.dir);
      }
      if (counting && t.state === 'stop' && t.at === ids.midCell) seen.stoppedAfter++;
      await page.waitForTimeout(40);
    }
    check(seen.spans.size === 2, `${orient}: the train runs from end to end in both directions (${[...seen.spans].join(' ')}; train ${JSON.stringify(await train())})`);
    check(seen.stoppedAfter === 0, `${orient}: and never stops at Koskensaha (${seen.stoppedAfter} samples)`);

    // tap it back: the train stops there again
    await page.evaluate((id) => { const t = window.__sim.trains.find((o) => o.id === id); window.__renderer.setScale(23); window.__renderer.follow(t); }, tid);
    await page.waitForTimeout(1200);
    const vp2 = await page.evaluate((id) => { const v = window.__renderer.vehicles(window.__sim.trains.find((t) => t.id === id))[0]; return { x: v.px, y: v.py }; }, tid);
    await page.touchscreen.tap(vp2.x, vp2.y);
    await page.waitForTimeout(600);
    if (!(await page.locator('.train-card').count())) check(false, `${orient}: a tap on the train opens its card again`);
    else {
      const again = page.locator(`.train-card [data-order-station="${ids.mid}"]`);
      await again.scrollIntoViewIfNeeded();
      await again.tap();
      await page.waitForTimeout(400);
      t = await train();
      check(t.skip.length === 0, `${orient}: a second tap sets Koskensaha to stop again`);
      await closeCards();
      const stopped = await until((mid) => { const t = window.__sim.trains[0]; return t.state === 'stop' && t.at === mid; }, ids.midCell, 'the train stops at Koskensaha again');
      check(stopped, `${orient}: and the train stands at Koskensaha again`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('orders-check ok: shots/orders/');
