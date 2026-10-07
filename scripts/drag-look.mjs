// The drag as the thumb sees it: a finger from the forest station toward a site, held mid-way
// and at the site, screenshots of the route under it; then the lift and the choice card when
// the lake or the ridge offers two routes. `node scripts/drag-look.mjs [scenario]` into
// shots/look/drag-*.png. The check for a change to the route plate or the ghost route.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

const scenario = process.argv[2] || 'harju';
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
const ctx = await browser.newContext({ ...devices['iPhone 15'], hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
const cdp = await ctx.newCDPSession(page);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
const at = (id) => page.evaluate((id) => { const s = window.__sim; const o = s.sites.find((x) => x.id === id); return window.__renderer.project(o.cx + 0.5, o.cy + 0.5, 1); }, id);
try {
  await page.goto(`http://localhost:${port}/raide/?lang=en&speed=1`);
  await page.locator(`[data-scenario="${scenario}"]`).tap();
  await page.waitForFunction(() => window.__sim, null, { timeout: 10000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `shots/look/drag-0-start.png` });
  const from = await at('forest');
  const to = await at(scenario === 'harju' ? 'sawmill' : 'sawmill');
  await touch('touchStart', [{ x: from.x, y: from.y, id: 1 }]);
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', [{ x: from.x + ((to.x - from.x) * i) / 16, y: from.y + ((to.y - from.y) * i) / 16, id: 1 }]);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `shots/look/drag-1-midway.png` });
  for (let i = 9; i <= 16; i++) {
    await touch('touchMove', [{ x: from.x + ((to.x - from.x) * i) / 16, y: from.y + ((to.y - from.y) * i) / 16, id: 1 }]);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `shots/look/drag-2-at-site.png` });
  await touch('touchEnd', []);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `shots/look/drag-3-built.png` });
  if (scenario === 'harju') {
    // close the card, then the ridge: sawmill to farm offers two routes
    await page.locator('.round.close').tap();
    await page.waitForTimeout(300);
    const a = await at('sawmill');
    const b = await at('farm');
    await touch('touchStart', [{ x: a.x, y: a.y, id: 1 }]);
    for (let i = 1; i <= 16; i++) {
      await touch('touchMove', [{ x: a.x + ((b.x - a.x) * i) / 16, y: a.y + ((b.y - a.y) * i) / 16, id: 1 }]);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: `shots/look/drag-4-ridge.png` });
    await touch('touchEnd', []);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `shots/look/drag-5-choice.png` });
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('shots/look/drag-*.png');
