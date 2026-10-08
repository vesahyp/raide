// The mixed trains check: the pictures of economy step 4, on Harju in portrait and landscape, into shots/mixed/.
//   extend-card   the lift of a drag from Koskensaha to Hämeenlinna: lengthen Kuusikko–Koskensaha, or a new line
//   line-card     the three-stop line: its stops in order with arrows, its train rows
//   buy-card      the buy card with a mixed consist and a hopper wagon that carries nothing here (red)
//   unload-close  a mixed train at Koskensaha, close up: a flat wagon unloading timber
//   load-close    the same stop a moment later: the box wagons taking boards
//   train-card    the train card with each wagon's load and what it carries on the line
// It fails when a card is missing a part, a wagon with nothing to carry is not marked, or a stop is not served.
// Run `make mixed` (builds first), then look at the pictures.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

const OUT = 'shots/mixed';
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
try {
  for (const [orient, device] of [['portrait', 'iPhone 15'], ['landscape', 'iPhone 15 landscape']]) {
    const ctx = await browser.newContext({ ...devices[device], hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${orient}: ${e}`));
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    const shot = (name) => page.screenshot({ path: `${OUT}/${name}-${orient}.png` });
    const at = (id) => page.evaluate((id) => { const o = window.__sim.sites.find((x) => x.id === id); return window.__renderer.project(o.cx + 0.5, o.cy + 0.5, 1); }, id);
    const view = (x, y, scale) => page.evaluate(([x, y, scale]) => { const r = window.__renderer; r.follow(null); r.setScale(scale); r.cam.x = x; r.cam.y = y; r.clampCam?.(); }, [x, y, scale]);
    const between = async (a, b, scale) => {
      await page.evaluate(([a, b, scale]) => {
        const r = window.__renderer; const f = (id) => window.__sim.sites.find((x) => x.id === id);
        r.follow(null); r.setScale(scale); r.cam.x = (f(a).cx + f(b).cx) / 2 + 0.5; r.cam.y = (f(a).cy + f(b).cy) / 2 + 0.5; r.clampCam?.();
      }, [a, b, scale]);
      await page.waitForTimeout(700);
    };
    const onScreen = (p) => page.evaluate((p) => { const a = window.__renderer.area(); return p.x > a.l + 60 && p.x < a.l + a.w - 60 && p.y > a.t + 60 && p.y < a.t + a.h - 60; }, p);
    // a real touch drag from one station to the next, held until the finger is on the site, then lifted
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
    await page.goto(`http://localhost:${port}/raide/?lang=en&speed=1`);
    await page.locator('[data-scenario="harju"]').tap();
    await page.waitForFunction(() => window.__sim, null, { timeout: 10000 });
    await page.waitForTimeout(1000);
    await page.evaluate(() => { window.__sim.cash = 9999; });

    // 1. Kuusikko to Koskensaha by a drag, then the drag from Koskensaha to Hämeenlinna: the card offers to lengthen the line
    await between('forest', 'sawmill', 13);
    await drag('forest', 'sawmill');
    await closeCards();
    await between('sawmill', 'hameenlinna', 9.5);
    await drag('sawmill', 'hameenlinna');
    if (!(await page.locator('.choice-card [data-group^="extend-"]').count())) errors.push(`${orient}: the lift of a drag from the end of a line offers no extension`);
    if (!(await page.locator('.choice-card [data-group="new"]').count())) errors.push(`${orient}: the extension card has no new line`);
    await shot('extend-card');
    await page.locator('.choice-card [data-group^="extend-"] [data-route]').first().tap();
    await page.waitForTimeout(600);
    const stops = await page.evaluate(() => window.__sim.lines.map((l) => l.stops.length));
    if (stops.join() !== '3') errors.push(`${orient}: the lengthening did not make one line of three stops (${stops.join()})`);
    // 2. the line card of the three-stop line
    if (!(await page.locator('.buy-card [data-sec="stops"] [data-stop]').count() === 3)) errors.push(`${orient}: the line card does not list three stops`);
    await shot('line-card');

    // 3. the buy card: the default consist is two flat, two box; swap a box for a hopper, which carries nothing on this line
    const consist = () => page.locator('[data-sec="consist"] [data-consist]').evaluateAll((els) => els.map((e) => e.dataset.type));
    if ((await consist()).join() !== 'flat,flat,box,box') errors.push(`${orient}: the default consist is not two flat and two box (${(await consist()).join(' ')})`);
    await page.locator('[data-consist="3"]').tap();
    await page.waitForTimeout(300);
    if ((await consist()).join() !== 'flat,flat,box') errors.push(`${orient}: the consist after taking a wagon off is ${(await consist()).join(' ')}`);
    // a type that carries nothing on this line is dimmed, says so, shows no price and cannot be added from the sheet
    if (!(await page.locator('.picker [data-wagon="hopper"].dim [data-carries="nothing"]').count())) errors.push(`${orient}: the hopper row is not dimmed with "carries nothing here"`);
    if (!(await page.locator('.picker [data-add="hopper"]').isDisabled())) errors.push(`${orient}: the hopper + is not disabled`);
    if (await page.locator('.picker [data-wagon="hopper"] .addcol small').count()) errors.push(`${orient}: the dimmed hopper row shows a price`);
    await page.evaluate(() => { const c = document.querySelector('.buy-scroll'); const t = document.querySelector('[data-sec="consist"]'); if (c && t) c.scrollTop = t.offsetTop - 30; });
    await page.waitForTimeout(300);
    await shot('buy-card');
    // put it right and buy
    await page.locator('[data-add="box"]').tap();
    await page.locator('[data-act="buy"]').tap();
    await page.waitForTimeout(500);
    if ((await page.evaluate(() => window.__sim.trains.length)) !== 1) errors.push(`${orient}: the mixed train was not bought`);

    // 4. at Koskensaha, close up: a flat wagon unloads timber, then the box wagons take boards
    await page.evaluate(() => { const f = window.__sim.sites.find((x) => x.id === 'forest'); f.stock = 6; f.rate = 0; });
    const sc = await page.evaluate(() => { const o = window.__sim.sites.find((x) => x.id === 'sawmill'); return { x: o.cx + 0.5, y: o.cy + 0.5 }; });
    await view(sc.x, sc.y + 0.4, 34);
    const wait = (fn, what, ms = 90000) => page.waitForFunction(fn, null, { timeout: ms, polling: 20 }).catch(() => errors.push(`${orient}: ${what}`));
    await wait(() => { const t = window.__sim.trains[0]; return t && t.dock === 'unload' && t.job === 1 && t.work < 0.25; }, 'no flat wagon unloading at Koskensaha');
    await shot('unload-close');
    await wait(() => { const t = window.__sim.trains[0]; return t && t.dock === 'load' && t.job === 3 && t.work < 0.25; }, 'no box wagon loading at Koskensaha');
    await shot('load-close');

    // 5. the train card, with the train running loaded: tap it
    await wait(() => { const t = window.__sim.trains[0]; return t && t.state === 'run' && t.cargo >= 2; }, 'the train never ran loaded');
    await page.waitForTimeout(1200);
    const tid = await page.evaluate(() => { const t = window.__sim.trains[0]; window.__renderer.follow(t); return t.id; });
    await page.waitForTimeout(1200);
    const vp = await page.evaluate((id) => { const v = window.__renderer.vehicles(window.__sim.trains.find((t) => t.id === id))[0]; return { x: v.px, y: v.py }; }, tid);
    await page.touchscreen.tap(vp.x, vp.y);
    await page.waitForTimeout(500);
    if (!(await page.locator('.train-card').count())) errors.push(`${orient}: a tap on the train did not open its card`);
    if ((await page.locator('.train-card [data-wagon-row]').count()) !== 4) errors.push(`${orient}: the train card does not list its four wagons`);
    if (!(await page.locator('.train-card [data-wagon-row] [data-carries="some"]').count())) errors.push(`${orient}: the train card does not say what the wagons carry`);
    await page.evaluate(() => { const c = document.querySelector('.train-card'); const t = document.querySelector('[data-sec="wagons"]'); if (c && t) c.scrollTop = t.offsetTop - 60; });
    await page.waitForTimeout(300);
    await shot('train-card');
    // a hopper added on the card is marked as waste
    await page.evaluate(() => { const s = window.__sim; s.cash = 9999; });
    await page.locator('.train-card [data-act="drop-wagon"]').first().tap();
    await page.locator('.train-card [data-add="hopper"]').tap();
    await page.waitForTimeout(300);
    if (!(await page.locator('.train-card [data-wagon-row].waste').count())) errors.push(`${orient}: a hopper on the train card is not marked as waste`);
    await closeCards();
    console.log(orient, 'done');
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
console.log('mixed ok: shots/mixed/');
