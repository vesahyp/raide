// A look at the game on an emulated iPhone 16: starts a preview of the built game, opens a
// scenario, lets the careful bot play (BOT=0: nobody plays) for some game seconds, and takes
// screenshots into shots/look/: the opening view, the network after the time, zoomed out, and a
// card. `node scripts/look.mjs [scenario] [seconds]`. The quick check for a renderer change.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

const scenario = process.argv[2] || 'harju';
const seconds = Number(process.argv[3] || 60);
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
const browser = await chromium.launch();
const errors = [];
try {
  for (const orient of process.env.ORIENT ? [process.env.ORIENT] : ['portrait']) {
    const ctx = await browser.newContext({ ...devices[orient === 'landscape' ? 'iPhone 16 landscape' : 'iPhone 16'], hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`http://localhost:${port}/raide/?${bot ? 'bot=1&' : ''}speed=${process.env.SPEED || 8}&lang=${process.env.LANG_UI || 'en'}`);
    await page.screenshot({ path: `shots/look/title-${orient}.png` });
    await page.locator(`[data-scenario="${scenario}"]`).tap();
    await page.waitForFunction(() => window.__sim, null, { timeout: 10000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `shots/look/${scenario}-${orient}-0.png` });
    await page.waitForFunction((t) => window.__sim.time >= t || window.__sim.result, seconds, { timeout: 180000 });
    await page.screenshot({ path: `shots/look/${scenario}-${orient}-${seconds}.png` });
    // the whole map
    await page.evaluate(() => window.__renderer.setView(window.__sim.w / 2, window.__sim.h / 2, 1));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `shots/look/${scenario}-${orient}-whole.png` });
    // close on the first train, and its card
    const pt = await page.evaluate(() => {
      const s = window.__sim; const r = window.__renderer;
      const t = s.trains[0]; if (!t) return null;
      const c = t.path[Math.min(t.path.length - 1, Math.floor(t.pos))];
      r.setView((c % s.w) + 0.5, Math.floor(c / s.w) + 0.5, 34);
      return true;
    });
    if (pt) {
      await page.waitForTimeout(600);
      await page.screenshot({ path: `shots/look/${scenario}-${orient}-close.png` });
      await page.locator('[data-tool="trains"]').tap();
      await page.waitForTimeout(300);
      await page.locator('.list .item').first().tap();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `shots/look/${scenario}-${orient}-train.png` });
    }
    await page.locator('[data-act="money"]').tap();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `shots/look/${scenario}-${orient}-money.png` });
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('shots/look/');
