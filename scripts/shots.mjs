// Phone screenshots of the game, repeatable: the title, the map at the start, the bot playing
// at a few points, the year-end card, the result. `make shots-setup` once, then `make shots`.
// Starts its own dev server on port 5199. `node scripts/shots.mjs en` takes the English set
// into shots/en/; `ORIENT=landscape` turns the phone.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const port = 5199;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const lang = process.argv[2] === 'en' ? 'en' : 'fi';
const landscape = process.env.ORIENT === 'landscape';
const scenario = process.env.SCENARIO || 'sawmill';
const dir = `shots/${scenario}${lang === 'en' ? '/en' : ''}${landscape ? '/landscape' : ''}`;
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices[landscape ? 'iPhone 15 landscape' : 'iPhone 15'], hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = (name) => page.screenshot({ path: `${dir}/${name}.png` });
const at = async (sec, name) => {
  await page.waitForFunction((t) => window.__sim && (window.__sim.time >= t || window.__sim.result), sec, { timeout: 300000 });
  await shot(name);
};
try {
  await page.goto(`http://localhost:${port}/?bot=1&speed=4&lang=${lang}`);
  await shot('01-title');
  await page.locator(`[data-scenario="${scenario}"]`).tap();
  await page.waitForFunction(() => window.__sim, null, { timeout: 10000 });
  await shot('02-start');
  await at(8, '03-first-train');
  await at(60, '04-two-lines');
  await at(140, '05-network');
  await page.waitForFunction(() => window.__sim.year >= 1864, null, { timeout: 300000 });
  await shot('06-year-three');
  // the cards, opened on the running game: a train, a site, a line
  await page.evaluate(() => { const s = window.__sim; const m = window.__renderer.cam.m; const c = s.lines[0].path[2]; const x = (c % s.w) + 0.5, y = Math.floor(c / s.w) + 0.5; window.__pt = { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }; });
  const pt = await page.evaluate(() => window.__pt);
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(400);
  await shot('07-line-card');
  const row = page.locator('.train-row').first();
  if (await row.count()) { await row.tap(); await page.waitForTimeout(400); await shot('08-train-card'); }
  await page.locator('.round.close').tap();
  const site = await page.evaluate(() => { const s = window.__sim; const m = window.__renderer.cam.m; const o = s.sites.find((x) => x.kind === 'town'); const x = o.cx + 0.5, y = o.cy + 0.5; return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }; });
  await page.touchscreen.tap(site.x, site.y);
  await page.waitForTimeout(400);
  await shot('09-site-card');
  await page.locator('.round.close').tap();
  await page.waitForFunction(() => window.__sim.result, null, { timeout: 300000 });
  await page.waitForTimeout(400);
  await shot('07-result');
} catch (e) {
  console.error(e);
  await shot('error');
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) {
  console.error('page errors:', errors.join('\n'));
  process.exitCode = 1;
} else console.log(`shots in ${dir}/`);
