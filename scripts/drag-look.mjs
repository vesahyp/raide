// Where a track can start and end, as the thumb sees it, on Harju in portrait and landscape:
// the idle start rings, a drag held toward Koskensaha with the green and amber targets, the
// same drag on the whole-map zoom, and the view after the first line is built; then the
// route under the finger over the Harju ridge (both bands, chevrons, cuttings, the plate) and the
// choice card after the lift.
// `node scripts/drag-look.mjs` into shots/look/targets-*.png and route-*.png.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

const freePort = () => new Promise((resolve) => { const srv = createServer(); srv.listen(0, () => { const p = srv.address().port; srv.close(() => resolve(p)); }); });
const port = await freePort();
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; ; i++) {
  const up = await fetch(`http://localhost:${port}/raide/`).then((r) => r.ok, () => false);
  if (up) break;
  if (i > 60) throw new Error('no preview server');
  await new Promise((r) => setTimeout(r, 500));
}
mkdirSync('shots/look', { recursive: true });
const browser = await chromium.launch();
const errors = [];
for (const [orient, device] of [['portrait', 'iPhone 15'], ['landscape', 'iPhone 15 landscape']]) {
  const ctx = await browser.newContext({ ...devices[device], hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const at = (id) => page.evaluate((id) => { const s = window.__sim; const o = s.sites.find((x) => x.id === id); return window.__renderer.project(o.cx + 0.5, o.cy + 0.5, 1); }, id);
  const shot = (name) => page.screenshot({ path: `shots/look/targets-${name}-${orient}.png` });
  try {
    const start = async () => {
      await page.goto('http://localhost:' + port + '/raide/?lang=en&speed=1');
      await page.locator('[data-scenario="harju"]').tap();
      await page.waitForFunction(() => window.__sim, null, { timeout: 10000 });
      await page.waitForTimeout(1200);
    };
    const wholeView = async () => {
      for (let i = 0; i < 6; i++) await page.evaluate(() => window.__renderer.zoomStep(-1));
      await page.waitForTimeout(1800);
    };
    const hold = async (n) => {
      const a = await at('forest');
      const b = await at('sawmill');
      await touch('touchStart', [{ x: a.x, y: a.y, id: 1 }]);
      for (let i = 1; i <= n; i++) {
        await touch('touchMove', [{ x: a.x + ((b.x - a.x) * i) / 16, y: a.y + ((b.y - a.y) * i) / 16, id: 1 }]);
        await page.waitForTimeout(40);
      }
      await page.waitForTimeout(500);
    };
    await start();
    await shot('idle-play');
    await wholeView();
    await shot('idle-whole');
    // a drag from Kuusikko held part way toward Koskensaha, then the same drag on the whole map
    await start();
    await hold(12);
    await shot('drag-play');
    await wholeView();
    await shot('drag-whole');
    await touch('touchCancel', []);
    // build Kuusikko to Koskensaha and lift
    await start();
    await hold(16);
    await touch('touchEnd', []);
    await page.waitForTimeout(800);
    if (await page.locator('.round.close').count()) await page.locator('.round.close').first().tap();
    await page.waitForTimeout(600);
    await shot('idle-two');

    // the route under the finger: Kuusikko to Koskensaha, then to Hämeenlinna, then toward Peltola over the ridge
    const shotRoute = (name) => page.screenshot({ path: `shots/look/${name}-${orient}.png` });
    const view = (id, s) => page.evaluate(([id, s]) => {
      const r = window.__renderer; const o = window.__sim.sites.find((x) => x.id === id);
      r.setScale(s); r.cam.x = o.cx + 0.5; r.cam.y = o.cy + 0.5; r.clampCam?.();
    }, [id, s]);
    const between = (a, b, s) => page.evaluate(([a, b, s]) => {
      const r = window.__renderer; const f = (id) => window.__sim.sites.find((x) => x.id === id);
      r.setScale(s); r.cam.x = (f(a).cx + f(b).cx) / 2 + 0.5; r.cam.y = (f(a).cy + f(b).cy) / 2 + 0.5;
    }, [a, b, s]);
    const onScreen = (p) => page.evaluate((p) => { const a = window.__renderer.area(); return p.x > a.l + 70 && p.x < a.l + a.w - 70 && p.y > a.t + 70 && p.y < a.t + a.h - 70; }, p);
    // a real touch drag from one station to another; the edge scroll brings a far target into view
    const dragBetween = async (from, to, lift) => {
      const a = await at(from);
      await touch('touchStart', [{ x: a.x, y: a.y, id: 1 }]);
      const dims = await page.evaluate(() => { const a = window.__renderer.area(); return a; });
      let p = a;
      for (let i = 0; i < 80; i++) {
        const b = await at(to);
        const target = (await onScreen(b)) ? b : { x: Math.min(dims.l + dims.w - 20, Math.max(dims.l + 20, b.x)), y: Math.min(dims.t + dims.h - 20, Math.max(dims.t + 20, b.y)) };
        p = { x: p.x + (target.x - p.x) * 0.25, y: p.y + (target.y - p.y) * 0.25 };
        await touch('touchMove', [{ x: p.x, y: p.y, id: 1 }]);
        await page.waitForTimeout(60);
        if (Math.hypot(b.x - p.x, b.y - p.y) < 6 && (await onScreen(b))) break;
      }
      await page.waitForTimeout(500);
      if (lift) { await touch('touchEnd', []); await page.waitForTimeout(700); }
    };
    await start();
    await page.evaluate(() => { window.__sim.cash = 9999; });
    await between('forest', 'sawmill', 13);
    await dragBetween('forest', 'sawmill', true);
    if (await page.locator('.round.close').count()) await page.locator('.round.close').first().tap();
    await between('sawmill', 'hameenlinna', 9.5);
    await dragBetween('sawmill', 'hameenlinna', true);
    if (await page.locator('[data-route]').count()) await page.locator('[data-route]').first().tap();
    await page.waitForTimeout(600);
    if (await page.locator('.round.close').count()) await page.locator('.round.close').first().tap();
    await page.waitForTimeout(500);
    await view('hameenlinna', 15);
    await page.waitForTimeout(400);
    await dragBetween('hameenlinna', 'farm', false);
    await shotRoute('route-ridge');
    await touch('touchEnd', []);
    await page.waitForTimeout(900);
    await shotRoute('route-choice');
  } finally {
    await ctx.close();
  }
}
await browser.close();
server.kill();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('shots/look/targets-*.png');
