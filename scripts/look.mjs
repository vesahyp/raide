// A look at the game on an emulated iPhone: starts a preview of the built game, opens a
// scenario, lets the bot play for a few seconds (or not: BOT=0), and takes screenshots in
// portrait and landscape into shots/look/. `node scripts/look.mjs [scenario] [seconds]`.
// The quick check for a renderer change: look at the pictures, then commit.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

const GPU = {};
const scenario = process.argv[2] || 'harju';
const seconds = Number(process.argv[3] || 20);
const bot = process.env.BOT !== '0';
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
const browser = await chromium.launch(GPU);
const errors = [];
try {
  for (const orient of process.env.ORIENT ? [process.env.ORIENT] : ['portrait', 'landscape']) {
    const ctx = await browser.newContext({ ...devices[orient === 'landscape' ? 'iPhone 15 landscape' : 'iPhone 15'], hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`http://localhost:${port}/raide/?${bot ? 'bot=1&' : ''}speed=${process.env.SPEED || 2}&lang=en`);
    await page.locator(`[data-scenario="${scenario}"]`).tap();
    await page.waitForFunction(() => window.__sim, null, { timeout: 10000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `shots/look/${scenario}-${orient}-0.png` });
    await page.waitForFunction((t) => window.__sim.time >= t || window.__sim.result, seconds, { timeout: 120000 });
    await page.screenshot({ path: `shots/look/${scenario}-${orient}-${seconds}.png` });
    // zoomed in on the first train, by a tap on it
    const pt = await page.evaluate(() => {
      const s = window.__sim; const r = window.__renderer;
      const t = s.trains.find((o) => o.state === 'run') || s.trains[0]; if (!t) return null;
      const line = s.lines.find((l) => l.id === t.lineId);
      const n = line.path.length;
      // the cell under the leading end
      let k = 0; while (k < n - 1 && line.dist[k + 1] <= t.s) k++;
      const c = line.path[k];
      return r.project((c % s.w) + 0.5, Math.floor(c / s.w) + 0.5, 3);
    });
    if (pt) {
      await page.touchscreen.tap(pt.x, pt.y);
      await page.waitForTimeout(400);
      // whatever the tap hit, the follow is what the picture is for
      await page.evaluate(() => { const s = window.__sim; const t = s.trains.find((o) => o.state === 'run') || s.trains[0]; window.__renderer.follow(t); });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `shots/look/${scenario}-${orient}-train.png` });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('shots/look/');
