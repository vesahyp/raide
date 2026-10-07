// Where a track can start and end, as the thumb sees it, on Harju in portrait and landscape:
// the idle start rings, a drag held toward Koskensaha with the green and amber targets, the
// same drag on the whole-map zoom, and the view after the first line is built.
// `node scripts/drag-look.mjs` into shots/look/targets-*.png.
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
  } finally {
    await ctx.close();
  }
}
await browser.close();
server.kill();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('shots/look/targets-*.png');
